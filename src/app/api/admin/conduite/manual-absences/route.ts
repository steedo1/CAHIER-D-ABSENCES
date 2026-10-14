import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole, getRequestRoles } from "@/lib/auth/server-context";
import { educatorNeedsAssignedClasses, educatorAssignmentCoversClass, loadEducatorAssignments } from "@/lib/auth/educator-class-scope";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { calculateAssiduity, DEFAULT_ASSIDUITY_RULES, MANUAL_CONDUCT_ROLES, manualAbsenceReason, parseAbsenceHours, parseManualAbsenceReason } from "@/lib/manual-conduct-absences";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const failure = (message: string, status = 400) => json({ ok: false, error: message }, status);
export async function POST(req: NextRequest) {
  const auth = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const ctx = await requireInstitutionRole(auth, srv, MANUAL_CONDUCT_ROLES);
  if ("error" in ctx) return failure(ctx.error === "unauthorized" ? "Session expirée. Reconnectez-vous." : "Saisie réservée à l’administration et aux éducateurs de cet établissement.", ctx.error === "unauthorized" ? 401 : 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Données de saisie invalides.");
    const classId = text(body.class_id), year = text(body.academic_year), periodCode = text(body.period_code);
    if (!classId || !year || !periodCode) return failure("Choisissez une classe, une année scolaire et un trimestre.");
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 500) return failure("La liste d’absences à enregistrer est invalide.");
    const entries: Array<{ studentId: string; hours: number }> = [];
    const seen = new Set<string>();
    for (const item of body.items) {
      const studentId = text(item?.student_id), hours = parseAbsenceHours(item?.absence_hours);
      if (!studentId || hours === null || seen.has(studentId)) return failure("Chaque élève doit apparaître une seule fois avec un nombre d’heures valide (0 à 5000).");
      seen.add(studentId); entries.push({ studentId, hours });
    }
    const { data: classroom, error: classError } = await srv.from("classes").select("id,institution_id,academic_year,level,education_type").eq("id", classId).eq("institution_id", ctx.instId).maybeSingle();
    if (classError) throw classError;
    if (!classroom || (classroom.academic_year && classroom.academic_year !== year)) return failure("Classe ou année scolaire invalide.");
    const rolesResult = await getRequestRoles(auth, srv, ctx.user.id);
    if (rolesResult.error) return failure("Accès éducateur indisponible.", 503);
    const roles = new Set((rolesResult.data || []).filter(row =>
      row.role === "super_admin" || row.institution_id === ctx.instId,
    ).map(row => row.role));
    if (educatorNeedsAssignedClasses(roles)) {
      const assigned = await loadEducatorAssignments(srv, ctx.instId, ctx.user.id);
      if (!educatorAssignmentCoversClass(classroom, assigned)) return failure("Classe non affectée à cet éducateur.", 403);
    }
    const resolved = await listApplicableGradePeriods(srv, ctx.instId, year, classId);
    const period = resolved.items.find(p => p.code === periodCode && p.is_active !== false);
    if (!period) return failure("Cette période n’est pas définie pour la classe et l’année choisies.");
    const ids = entries.map(e => e.studentId);
    let enrollmentQuery = srv.from("class_enrollments").select("student_id").eq("institution_id", ctx.instId).eq("class_id", classId).in("student_id", ids);
    if (period.end_date) enrollmentQuery = enrollmentQuery.or(`start_date.lte.${period.end_date},start_date.is.null`);
    if (period.start_date) enrollmentQuery = enrollmentQuery.or(`end_date.gte.${period.start_date},end_date.is.null`);
    const [enrollment, previous, assOverrides, settings] = await Promise.all([
      enrollmentQuery,
      srv.from("conduct_average_overrides").select("student_id,reason").eq("institution_id", ctx.instId).eq("class_id", classId).eq("academic_year", year).eq("period_code", periodCode).in("student_id", ids),
      srv.from("conduct_rubric_overrides").select("student_id").eq("institution_id", ctx.instId).eq("class_id", classId).eq("academic_year", year).eq("period_code", periodCode).eq("rubric_key", "assiduite").in("student_id", ids),
      srv.from("conduct_settings").select("assiduite_max,tenue_max,moralite_max,discipline_max,points_per_absent_hour,absent_hours_zero_threshold,absent_hours_note_after_threshold").eq("institution_id", ctx.instId).maybeSingle(),
    ]);
    for (const result of [enrollment, previous, assOverrides, settings]) if (result.error) throw result.error;
    const enrolled = new Set((enrollment.data || []).map(r => String(r.student_id)));
    if (ids.some(id => !enrolled.has(id))) return failure("Un élève ne fait pas partie de cette classe pour la période choisie.");
    if ((previous.data || []).some(r => !parseManualAbsenceReason(r.reason)) || (assOverrides.data || []).length) return failure("Une moyenne ou une note d’assiduité a déjà été corrigée manuellement. Réinitialisez cette correction dans le calcul automatique avant de saisir les absences.", 409);
    const s = settings.data;
    const number = (value: unknown, fallback: number) => value === null || value === undefined || !Number.isFinite(Number(value)) ? fallback : Number(value);
    const assMax = number(s?.assiduite_max, 6), other = number(s?.tenue_max, 3) + number(s?.moralite_max, 4) + number(s?.discipline_max, 7);
    const rules = { ...DEFAULT_ASSIDUITY_RULES, penalty_per_hour: number(s?.points_per_absent_hour, 0.5), max_hours_before_zero: number(s?.absent_hours_zero_threshold, 10), note_after_threshold: number(s?.absent_hours_note_after_threshold, 0) };
    const now = new Date().toISOString();
    // Store the source hours alongside a calculated snapshot; readers recalculate from the hours.
    const payload = entries.map(e => {
      const totalMax = assMax + other;
      const raw = calculateAssiduity(e.hours, assMax, rules) + other;
      // Existing snapshot columns are constrained to /20; the hours remain authoritative.
      const snapshot = Number(Math.min(20, Math.max(0, totalMax > 0 ? raw / totalMax * 20 : 0)).toFixed(2));
      return { institution_id: ctx.instId, class_id: classId, student_id: e.studentId, academic_year: year, period_code: periodCode,
        from_date: period.start_date, to_date: period.end_date, calculated_total: snapshot, override_total: snapshot,
        reason: manualAbsenceReason({ hours: e.hours, periodId: period.id }), edited_by: ctx.user.id, updated_at: now };
    });
    const saved = await srv.from("conduct_average_overrides").upsert(payload, { onConflict: "institution_id,class_id,student_id,academic_year,period_code" }).select("student_id,updated_at");
    if (saved.error) throw saved.error;
    return json({ ok: true, saved: saved.data?.length || payload.length, items: saved.data });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Impossible d’enregistrer les absences.", 500);
  }
}
