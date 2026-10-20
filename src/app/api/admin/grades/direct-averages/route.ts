import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "@/lib/school-cycles";
import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "../../_helpers/institutionAccess";
import { getApplicableGradePeriodById } from "@/lib/education-grading-periods";
import { directAverage, readDirectAverages, parseAverage20, setDirectAverage } from "@/lib/grades/direct-subject-averages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const roles = ["admin", "super_admin", "file_correspondent"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function context(input: Record<string, unknown>) {
  const access = await requireInstitutionAccess({ allowedRoles: roles });
  if ("error" in access) return { error: access.error };
  const classId = String(input.class_id || ""), rawSubjectId = String(input.subject_id || ""), periodId = String(input.grading_period_id || "");
  if (![classId, rawSubjectId, periodId].every(id => uuid.test(id)))
    return { error: reply({ ok: false, error: "Choisissez une classe, une matière et un trimestre précis." }, 400) };
  const { srv, institutionId } = access;
  const cls = await srv.from("classes").select("id,academic_year,level,education_type")
    .eq("id", classId).eq("institution_id", institutionId).maybeSingle();
  if (cls.error) throw cls.error;
  if (!cls.data) return { error: reply({ ok: false, error: "Classe inaccessible." }, 403) };
  // The secondary /20 flow does not replace primary composition scales.
  if (/^(cp|ce|cm|ps|ms|gs)\d?$/i.test(String(cls.data.level || "").trim()) ||
      ["primary", "preschool"].includes(String(cls.data.education_type || "")))
    return { error: reply({ ok: false, error: "Utilisez le cahier de compositions pour cette classe." }, 400) };
  const year = String(cls.data.academic_year || "");
  const [period, school] = await Promise.all([
    getApplicableGradePeriodById(srv, institutionId, year, classId, periodId),
    srv.from("institutions").select("settings_json").eq("id", institutionId).maybeSingle(),
  ]);
  if (school.error) throw school.error;
  const cycles = parseSchoolCyclesSettings(school.data?.settings_json);
  if (cycles.enabled && resolveSchoolCycleForClass(cls.data, cycles) !== "secondary")
    return { error: reply({ ok: false, error: "Utilisez le cahier de compositions pour cette classe." }, 400) };
  if (!period || period.is_active === false)
    return { error: reply({ ok: false, error: "Trimestre invalide pour cette classe et cette année." }, 400) };
  const sub = await srv.from("institution_subjects").select("id,subject_id")
    .eq("institution_id", institutionId).or(`id.eq.${rawSubjectId},subject_id.eq.${rawSubjectId}`).limit(1).maybeSingle();
  if (sub.error) throw sub.error;
  if (!sub.data?.subject_id) return { error: reply({ ok: false, error: "Matière inaccessible." }, 403) };
  const institutionSubjectId = String(sub.data.id);
  const subjectId = String(sub.data.subject_id);
  const assignments = await srv.from("class_teachers").select("subject_id").eq("institution_id", institutionId).eq("class_id", classId).is("end_date", null);
  if (assignments.error) throw assignments.error;
  if (assignments.data?.length && !assignments.data.some(row => [institutionSubjectId, subjectId].includes(String(row.subject_id))))
    return { error: reply({ ok: false, error: "Cette matière n’est pas affectée à la classe." }, 400) };
  const roster = await srv.from("class_enrollments").select("student_id,students:student_id(first_name,last_name,full_name,matricule)")
    .eq("institution_id", institutionId).eq("class_id", classId).is("end_date", null);
  if (roster.error) throw roster.error;
  const students = Array.from(new Map((roster.data || []).map((row: any) => [String(row.student_id), {
    student_id: String(row.student_id), full_name: [row.students?.last_name, row.students?.first_name].filter(Boolean).join(" ") || row.students?.full_name || "Élève",
    matricule: row.students?.matricule || null,
  }])).values()).sort((a,b) => a.full_name.localeCompare(b.full_name, "fr"));
  return { ...access, classId, subjectId, periodId, year, students };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await context(Object.fromEntries(req.nextUrl.searchParams));
    if ("error" in ctx) return ctx.error;
    const saved = await ctx.srv.from("grade_adjustments").select("student_id,reason")
      .eq("class_id", ctx.classId).eq("subject_id", ctx.subjectId).eq("academic_year", ctx.year);
    if (saved.error) throw saved.error;
    const values = new Map((saved.data || []).map(row => [String(row.student_id), directAverage(row.reason, ctx.periodId)]));
    return reply({ ok: true, items: ctx.students.map(row => ({ ...row, average: values.get(row.student_id) ?? null })) });
  } catch (error: any) { return reply({ ok: false, error: error.message || "Chargement impossible." }, 500); }
}

export async function POST(req: NextRequest) {
  const saved: string[] = [];
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ ok: false, error: "Données de saisie invalides." }, 400);
    const ctx = await context(body);
    if ("error" in ctx) return ctx.error;
    const allowed = new Set(ctx.students.map(row => row.student_id));
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 500)
      return reply({ ok: false, error: "Liste de moyennes invalide." }, 400);
    const seen = new Set<string>();
    const items: { student_id: string; average: number | null }[] = [];
    for (const row of body.items) {
      if (!row || typeof row !== "object") return reply({ ok: false, error: "Moyenne invalide." }, 400);
      const average = row.average === null ? null : parseAverage20(row.average);
      if (!allowed.has(row.student_id) || seen.has(row.student_id) || (average === null && row.average !== null))
        return reply({ ok: false, error: "Élève invalide, doublon ou moyenne hors de 0 à 20." }, 400);
      seen.add(row.student_id); items.push({ student_id: row.student_id, average });
    }
    const initial = await ctx.srv.from("grade_adjustments").select("id,student_id,reason,bonus,grading_period_id")
      .eq("class_id", ctx.classId).eq("subject_id", ctx.subjectId).eq("academic_year", ctx.year)
      .in("student_id", items.map(item => item.student_id));
    if (initial.error) throw initial.error;
    const existingByStudent = new Map((initial.data || []).map(row => [String(row.student_id), row]));
    // Validate every stored source before the first write.
    for (const item of items) setDirectAverage(existingByStudent.get(item.student_id)?.reason, ctx.periodId, item.average, ctx.user.id, new Date().toISOString());

    // Compare-and-set the reason only. Concurrent bonus edits are preserved;
    // a concurrent period edit is re-read before retrying, never overwritten.
    for (const item of items) {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const lookup = attempt === 0 ? { data: existingByStudent.get(item.student_id) || null, error: null }
          : await ctx.srv.from("grade_adjustments").select("id,student_id,reason,bonus,grading_period_id")
          .eq("class_id", ctx.classId).eq("subject_id", ctx.subjectId).eq("student_id", item.student_id).eq("academic_year", ctx.year).maybeSingle();
        if (lookup.error) throw lookup.error;
        const reason = setDirectAverage(lookup.data?.reason, ctx.periodId, item.average, ctx.user.id, new Date().toISOString(), !lookup.data);
        if (lookup.data) {
          const removeEmptySource = reason === null && Number(lookup.data.bonus) === 0 && !lookup.data.grading_period_id && readDirectAverages(lookup.data.reason).createdForDirect;
          let query = (removeEmptySource ? ctx.srv.from("grade_adjustments").delete() : ctx.srv.from("grade_adjustments").update({ reason })).eq("id", lookup.data.id);
          if (removeEmptySource) query = query.eq("bonus", 0).is("grading_period_id", null);
          query = lookup.data.reason === null ? query.is("reason", null) : query.eq("reason", lookup.data.reason);
          const changed = await query.select("id");
          if (changed.error) throw changed.error;
          done = !!changed.data?.length;
        } else if (item.average === null) done = true;
        else {
          const created = await ctx.srv.from("grade_adjustments").insert({ class_id: ctx.classId, subject_id: ctx.subjectId,
            student_id: item.student_id, academic_year: ctx.year, grading_period_id: null, bonus: 0, reason, created_by: ctx.user.id });
          if (created.error && created.error.code !== "23505") throw created.error;
          done = !created.error;
        }
      }
      if (!done) throw new Error("Une autre saisie est en cours. Réessayez les lignes restantes.");
      saved.push(item.student_id);
    }
    return reply({ ok: true, saved });
  } catch (error: any) { return reply({ ok: false, error: error.message || "Enregistrement impossible.", saved }, 500); }
}
