import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  id?: string;
  teacher_id?: string;
  weekday?: number | string;
  period_id?: string | null;
  period_no?: number | string | null;
  half_day?: "morning" | "afternoon" | "evening" | "" | null;
  constraint_type?: "strict" | "preference" | string;
  reason?: string | null;
  is_active?: boolean;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 },
      ),
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
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 },
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";

  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 },
      ),
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
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 },
      ),
    };
  }

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "forbidden", message: "Droits insuffisants." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, srv, userId: user.id, institutionId };
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const [teachersRes, periodsRes, itemsRes] = await Promise.all([
      guard.srv
        .from("class_teachers")
        .select("teacher_id,teacher:profiles(id,display_name,email)")
        .eq("institution_id", guard.institutionId)
        .is("end_date", null)
        .limit(10000),
      guard.srv
        .from("institution_periods")
        .select("id,weekday,period_no,label,start_time,end_time")
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

    if (teachersRes.error) return NextResponse.json({ ok: false, error: "teachers_fetch_failed", message: teachersRes.error.message }, { status: 400 });
    if (periodsRes.error) return NextResponse.json({ ok: false, error: "periods_fetch_failed", message: periodsRes.error.message }, { status: 400 });
    if (itemsRes.error) return NextResponse.json({ ok: false, error: "unavailability_fetch_failed", message: itemsRes.error.message }, { status: 400 });

    const teacherMap = new Map<string, any>();
    for (const row of teachersRes.data || []) {
      const teacher = Array.isArray((row as any).teacher) ? (row as any).teacher[0] : (row as any).teacher;
      const id = String((row as any).teacher_id || teacher?.id || "");
      if (id && !teacherMap.has(id)) {
        teacherMap.set(id, {
          id,
          name: String(teacher?.display_name || teacher?.email || "Enseignant"),
        });
      }
    }

    const teachers = Array.from(teacherMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    const periods = (periodsRes.data || []).map((period: any) => ({
      id: String(period.id),
      weekday: Number(period.weekday || 0),
      period_no: Number(period.period_no || 0),
      label: String(period.label || `Créneau ${period.period_no || ""}`),
      start_time: period.start_time || null,
      end_time: period.end_time || null,
    }));

    const periodMap = new Map(periods.map((period) => [period.id, period]));
    const items = (itemsRes.data || []).map((item: any) => {
      const teacher = teacherMap.get(String(item.teacher_id));
      const period = item.period_id ? periodMap.get(String(item.period_id)) : null;
      return {
        ...item,
        teacher_name: teacher?.name || "Enseignant",
        period_label: period ? `${period.label} (${period.start_time || ""} - ${period.end_time || ""})` : null,
      };
    });

    return NextResponse.json({ ok: true, teachers, periods, items });
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
    const weekday = toNumber(body.weekday, 0);
    const periodId = clean(body.period_id) || null;
    const periodNo = body.period_no === null || body.period_no === "" ? null : toNumber(body.period_no, 0);
    const halfDay = clean(body.half_day) || null;
    const constraintType = clean(body.constraint_type) === "preference" ? "preference" : "strict";

    if (!teacherId || weekday < 1 || weekday > 7) {
      return NextResponse.json({ ok: false, error: "invalid_payload", message: "Enseignant et jour obligatoires." }, { status: 400 });
    }

    const payload = {
      institution_id: guard.institutionId,
      teacher_id: teacherId,
      weekday,
      period_id: periodId,
      period_no: periodNo && periodNo > 0 ? periodNo : null,
      half_day: halfDay,
      constraint_type: constraintType,
      reason: clean(body.reason) || null,
      is_active: body.is_active !== false,
      created_by: guard.userId,
      updated_by: guard.userId,
    };

    const query = body.id
      ? guard.srv
          .from("montage_timetable_teacher_unavailability")
          .update({ ...payload, created_by: undefined })
          .eq("id", body.id)
          .eq("institution_id", guard.institutionId)
          .select()
          .single()
      : guard.srv
          .from("montage_timetable_teacher_unavailability")
          .insert(payload)
          .select()
          .single();

    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: "save_failed", message: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, item: data, message: "Indisponibilité sauvegardée." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const id = clean(new URL(req.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "missing_id", message: "Identifiant manquant." }, { status: 400 });

    const { error } = await guard.srv
      .from("montage_timetable_teacher_unavailability")
      .delete()
      .eq("id", id)
      .eq("institution_id", guard.institutionId);

    if (error) return NextResponse.json({ ok: false, error: "delete_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Indisponibilité supprimée." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}
