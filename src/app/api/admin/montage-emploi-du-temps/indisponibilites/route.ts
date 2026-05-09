import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HalfDay = "morning" | "afternoon" | null;
type ConstraintType = "strict" | "preference";

type Payload = {
  id?: string;
  teacher_id?: string;
  weekday?: number | string;
  weekdays?: Array<number | string>;
  period_id?: string | null;
  period_no?: number | string | null;
  half_day?: "morning" | "afternoon" | "" | null;
  constraint_type?: ConstraintType | string;
  reason?: string | null;
  is_active?: boolean;
};

function clean(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeWeekdays(input: Payload): number[] {
  const raw = Array.isArray(input.weekdays) && input.weekdays.length > 0 ? input.weekdays : [input.weekday];
  return Array.from(
    new Set(
      raw
        .map((value) => toNumber(value, 0))
        .filter((value) => value >= 1 && value <= 7),
    ),
  ).sort((a, b) => a - b);
}

function normalizeHalfDay(value: unknown): HalfDay {
  const raw = clean(value);
  if (raw === "morning" || raw === "afternoon") return raw;
  return null;
}

function normalizeConstraintType(value: unknown): ConstraintType {
  return clean(value) === "preference" ? "preference" : "strict";
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "auth_failed", message: userErr.message }, { status: 401 }),
    };
  }

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "unauthorized", message: "Utilisateur non connectÃ©." }, { status: 401 }),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "profile_failed", message: meErr.message }, { status: 400 }),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "no_institution", message: "Aucune institution associÃ©e Ã  ce compte." }, { status: 400 }),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "role_failed", message: roleErr.message }, { status: 400 }),
    };
  }

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "forbidden", message: "Droits insuffisants." }, { status: 403 }),
    };
  }

  return { ok: true as const, srv, userId: user.id, institutionId };
}

function teacherName(teacher: any) {
  return clean(teacher?.display_name || teacher?.full_name || teacher?.email, "Enseignant");
}

function subjectLabel(instsub: any, subj: any) {
  return clean(instsub?.custom_name || subj?.name || subj?.code, "MatiÃ¨re");
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const [affectationsRes, periodsRes, itemsRes] = await Promise.all([
      guard.srv
        .from("class_teachers")
        .select(
          `
          teacher_id,
          subject_id,
          teacher:profiles(id,display_name,full_name,email),
          instsub:institution_subjects(
            id,
            custom_name,
            subj:subjects(id,name,code)
          )
        `,
        )
        .eq("institution_id", guard.institutionId)
        .is("end_date", null)
        .limit(10000),
      guard.srv
        .from("institution_periods")
        .select("id,weekday,period_no,label,start_time,end_time,duration_min")
        .eq("institution_id", guard.institutionId)
        .order("weekday", { ascending: true })
        .order("period_no", { ascending: true }),
      guard.srv
        .from("montage_timetable_teacher_unavailability")
        .select("id,institution_id,teacher_id,weekday,period_id,period_no,half_day,constraint_type,reason,is_active,created_at,updated_at")
        .eq("institution_id", guard.institutionId)
        .order("weekday", { ascending: true })
        .order("period_no", { ascending: true }),
    ]);

    const firstError = affectationsRes.error || periodsRes.error || itemsRes.error;
    if (firstError) {
      return NextResponse.json({ ok: false, error: "unavailability_fetch_failed", message: firstError.message }, { status: 400 });
    }

    const subjectMap = new Map<string, { id: string; label: string }>();
    const teacherMap = new Map<string, { id: string; name: string; email: string | null; subject_ids: string[]; subject_labels: string[] }>();

    for (const row of affectationsRes.data || []) {
      const teacher = Array.isArray((row as any).teacher) ? (row as any).teacher[0] : (row as any).teacher;
      const instsub = Array.isArray((row as any).instsub) ? (row as any).instsub[0] : (row as any).instsub;
      const subj = Array.isArray(instsub?.subj) ? instsub.subj[0] : instsub?.subj;
      const teacherId = clean((row as any).teacher_id || teacher?.id);
      const subjectId = clean((row as any).subject_id || instsub?.id);
      const label = subjectLabel(instsub, subj);

      if (subjectId && !subjectMap.has(subjectId)) subjectMap.set(subjectId, { id: subjectId, label });

      if (!teacherId) continue;
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          id: teacherId,
          name: teacherName(teacher),
          email: teacher?.email ? String(teacher.email) : null,
          subject_ids: [],
          subject_labels: [],
        });
      }
      const entry = teacherMap.get(teacherId)!;
      if (subjectId && !entry.subject_ids.includes(subjectId)) entry.subject_ids.push(subjectId);
      if (label && !entry.subject_labels.includes(label)) entry.subject_labels.push(label);
    }

    const periods = (periodsRes.data || []).map((period: any) => ({
      id: String(period.id),
      weekday: Number(period.weekday || 0),
      period_no: Number(period.period_no || 0),
      label: clean(period.label, `CrÃ©neau ${period.period_no || ""}`),
      start_time: period.start_time || null,
      end_time: period.end_time || null,
      duration_min: period.duration_min == null ? null : Number(period.duration_min),
    }));

    const periodMap = new Map(periods.map((period) => [period.id, period]));
    const teachers = Array.from(teacherMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const subjects = Array.from(subjectMap.values()).sort((a, b) => a.label.localeCompare(b.label));

    const items = (itemsRes.data || []).map((item: any) => {
      const teacher = teacherMap.get(String(item.teacher_id));
      const period = item.period_id ? periodMap.get(String(item.period_id)) : null;
      return {
        ...item,
        teacher_name: teacher?.name || "Enseignant",
        subject_labels: teacher?.subject_labels || [],
        period_label: period ? `${period.label}${period.start_time && period.end_time ? ` (${period.start_time} - ${period.end_time})` : ""}` : null,
      };
    });

    return NextResponse.json({
      ok: true,
      source: "mon_cahier_affectations_and_official_periods",
      message: "Les indisponibilitÃ©s utilisent les enseignants dÃ©jÃ  affectÃ©s dans Mon Cahier et les crÃ©neaux officiels institution_periods.",
      subjects,
      teachers,
      periods,
      items,
      totals: {
        teachers: teachers.length,
        subjects: subjects.length,
        periods: periods.length,
        items: items.length,
      },
      warnings: [
        ...(teachers.length === 0 ? ["Aucun enseignant affectÃ© dÃ©tectÃ© dans Mon Cahier."] : []),
        ...(periods.length === 0 ? ["Aucun crÃ©neau officiel configurÃ© dans Mon Cahier."] : []),
      ],
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await req.json().catch(() => ({}))) as Payload;
    const teacherId = clean(body.teacher_id);
    const periodId = clean(body.period_id) || null;
    const halfDay = normalizeHalfDay(body.half_day);
    const constraintType = normalizeConstraintType(body.constraint_type);
    const reason = clean(body.reason) || null;
    const isActive = body.is_active !== false;

    if (!teacherId) {
      return NextResponse.json({ ok: false, error: "invalid_payload", message: "Professeur obligatoire." }, { status: 400 });
    }

    if (body.id) {
      const weekdays = normalizeWeekdays(body);
      const weekday = weekdays[0];
      if (!weekday) {
        return NextResponse.json({ ok: false, error: "invalid_payload", message: "Jour obligatoire." }, { status: 400 });
      }

      const payload = {
        teacher_id: teacherId,
        weekday,
        period_id: periodId,
        period_no: body.period_no === null || body.period_no === "" ? null : toNumber(body.period_no, 0) || null,
        half_day: periodId ? null : halfDay,
        constraint_type: constraintType,
        reason,
        is_active: isActive,
        updated_by: guard.userId,
      };

      const { data, error } = await guard.srv
        .from("montage_timetable_teacher_unavailability")
        .update(payload)
        .eq("id", body.id)
        .eq("institution_id", guard.institutionId)
        .select()
        .single();

      if (error) return NextResponse.json({ ok: false, error: "save_failed", message: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, item: data, inserted_count: 0, skipped_count: 0, message: "IndisponibilitÃ© mise Ã  jour." });
    }

    let targetRows: Array<{
      institution_id: string;
      teacher_id: string;
      weekday: number;
      period_id: string | null;
      period_no: number | null;
      half_day: HalfDay;
      constraint_type: ConstraintType;
      reason: string | null;
      is_active: boolean;
      created_by: string;
      updated_by: string;
    }> = [];

    if (periodId) {
      const { data: period, error: periodErr } = await guard.srv
        .from("institution_periods")
        .select("id,weekday,period_no")
        .eq("institution_id", guard.institutionId)
        .eq("id", periodId)
        .maybeSingle();

      if (periodErr) return NextResponse.json({ ok: false, error: "period_fetch_failed", message: periodErr.message }, { status: 400 });
      if (!period) return NextResponse.json({ ok: false, error: "period_not_found", message: "CrÃ©neau officiel introuvable." }, { status: 404 });

      targetRows = [
        {
          institution_id: guard.institutionId,
          teacher_id: teacherId,
          weekday: Number((period as any).weekday || 0),
          period_id: periodId,
          period_no: Number((period as any).period_no || 0) || null,
          half_day: null,
          constraint_type: constraintType,
          reason,
          is_active: isActive,
          created_by: guard.userId,
          updated_by: guard.userId,
        },
      ];
    } else {
      const weekdays = normalizeWeekdays(body);
      if (weekdays.length === 0) {
        return NextResponse.json({ ok: false, error: "invalid_payload", message: "Choisis au moins un jour." }, { status: 400 });
      }

      targetRows = weekdays.map((weekday) => ({
        institution_id: guard.institutionId,
        teacher_id: teacherId,
        weekday,
        period_id: null,
        period_no: null,
        half_day: halfDay,
        constraint_type: constraintType,
        reason,
        is_active: isActive,
        created_by: guard.userId,
        updated_by: guard.userId,
      }));
    }

    const { data: existingRows, error: existingErr } = await guard.srv
      .from("montage_timetable_teacher_unavailability")
      .select("id,teacher_id,weekday,period_id,half_day,constraint_type")
      .eq("institution_id", guard.institutionId)
      .eq("teacher_id", teacherId);

    if (existingErr) return NextResponse.json({ ok: false, error: "existing_fetch_failed", message: existingErr.message }, { status: 400 });

    const existing = new Set(
      (existingRows || []).map((item: any) => [item.teacher_id, item.weekday, item.period_id || "", item.half_day || "", item.constraint_type || "strict"].join("|")),
    );

    const rowsToInsert = targetRows.filter((item) => {
      const key = [item.teacher_id, item.weekday, item.period_id || "", item.half_day || "", item.constraint_type].join("|");
      return !existing.has(key);
    });

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ ok: true, inserted_count: 0, skipped_count: targetRows.length, message: "Cette indisponibilitÃ© existe dÃ©jÃ ." });
    }

    const { data, error } = await guard.srv
      .from("montage_timetable_teacher_unavailability")
      .insert(rowsToInsert)
      .select();

    if (error) return NextResponse.json({ ok: false, error: "save_failed", message: error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      items: data || [],
      inserted_count: rowsToInsert.length,
      skipped_count: targetRows.length - rowsToInsert.length,
      message: `${rowsToInsert.length} indisponibilitÃ©(s) sauvegardÃ©e(s).`,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const params = new URL(req.url).searchParams;
    const id = clean(params.get("id"));
    const teacherId = clean(params.get("teacher_id"));
    const allForTeacher = params.get("all") === "1";

    if (id) {
      const { error } = await guard.srv
        .from("montage_timetable_teacher_unavailability")
        .delete()
        .eq("id", id)
        .eq("institution_id", guard.institutionId);

      if (error) return NextResponse.json({ ok: false, error: "delete_failed", message: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, message: "IndisponibilitÃ© supprimÃ©e." });
    }

    if (allForTeacher && teacherId) {
      const { error } = await guard.srv
        .from("montage_timetable_teacher_unavailability")
        .delete()
        .eq("institution_id", guard.institutionId)
        .eq("teacher_id", teacherId);

      if (error) return NextResponse.json({ ok: false, error: "delete_failed", message: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, message: "Toutes les indisponibilitÃ©s du professeur ont Ã©tÃ© supprimÃ©es." });
    }

    return NextResponse.json({ ok: false, error: "missing_id", message: "Identifiant manquant." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

