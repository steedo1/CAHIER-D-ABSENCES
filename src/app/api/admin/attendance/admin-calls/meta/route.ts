import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AllowedRole = "admin" | "super_admin" | "educator";

type PreviewInfo = {
  teacher_name?: string | null;
  subject_name?: string | null;
  absence_request_status?: "pending" | "approved" | "rejected" | "cancelled" | null;
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
};

function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function normalizeTime(raw: string | null | undefined): string {
  return String(raw || "").slice(0, 5) || "08:00";
}

const LEVEL_ORDER = ["6e", "5e", "4e", "3e", "seconde", "première", "terminale"] as const;

function inferLevelFromClassLabel(label?: string | null): string | null {
  if (!label) return null;
  const s = label.toLowerCase().trim();

  if (s.startsWith("6e") || s.startsWith("6ème") || s.startsWith("6 eme")) return "6e";
  if (s.startsWith("5e") || s.startsWith("5ème") || s.startsWith("5 eme")) return "5e";
  if (s.startsWith("4e") || s.startsWith("4ème") || s.startsWith("4 eme")) return "4e";
  if (s.startsWith("3e") || s.startsWith("3ème") || s.startsWith("3 eme")) return "3e";

  if (s.startsWith("2nde") || s.startsWith("2de") || s.startsWith("2nd")) return "seconde";
  if (s.startsWith("1re") || s.startsWith("1ère") || s.startsWith("1er")) return "première";
  if (s.startsWith("t") || s.startsWith("term")) return "terminale";

  return null;
}

function compareLevels(a: string, b: string): number {
  const ia = LEVEL_ORDER.indexOf(a as any);
  const ib = LEVEL_ORDER.indexOf(b as any);
  if (ia === -1 && ib === -1) return a.localeCompare(b, "fr");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

function parseWeekday(raw: any): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

type WeekdayMode = "iso" | "js" | "mon0";

function detectWeekdayMode(periods: any[]): WeekdayMode {
  const vals = Array.from(
    new Set(
      (periods || [])
        .map((p) => parseWeekday(p?.weekday))
        .filter((v): v is number => v !== null && v !== undefined)
    )
  );

  if (vals.includes(7)) return "iso";

  const max = vals.length ? Math.max(...vals) : 6;
  if (max === 5) return "mon0";
  if (vals.includes(0) && max === 6) return "js";

  return "iso";
}

function jsDayToDbWeekday(jsDay0to6: number, mode: WeekdayMode): number {
  if (mode === "js") return jsDay0to6;
  if (mode === "iso") return jsDay0to6 === 0 ? 7 : jsDay0to6;
  return (jsDay0to6 + 6) % 7;
}

async function requireActor() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    console.warn("[admin-calls/meta] auth_getUser_err", { error: userErr.message });
  }
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  const institution_id = String(me?.institution_id || "");
  if (!institution_id) {
    return {
      error: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  if (roleErr) {
    console.error("[admin-calls/meta] role_err", { error: roleErr.message });
  }

  const role = String(roleRow?.role || "") as AllowedRole | "";
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour cette vue." },
        { status: 403 }
      ),
    };
  }

  return {
    supa,
    srv,
    user_id: user.id,
    institution_id,
    role,
  };
}

async function loadInstitutionSettings(req: NextRequest) {
  try {
    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    const res = await fetch(`${origin}/api/admin/institution/settings`, {
      method: "GET",
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });

    if (!res.ok) return { institution_name: null, academic_year_label: null };

    const json = await res.json().catch(() => ({}));
    return {
      institution_name: String(
        json?.institution_name || json?.name || json?.institution_label || ""
      ).trim() || null,
      academic_year_label: String(
        json?.academic_year_label ||
          json?.current_academic_year_label ||
          json?.active_academic_year ||
          ""
      ).trim() || null,
    };
  } catch {
    return { institution_name: null, academic_year_label: null };
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireActor();
  if ("error" in auth) return auth.error;

  const { srv, institution_id, user_id } = auth;

  const today = new Date();
  const todayYmd = toYMD(today);

  const [
    instSettings,
    { data: classes, error: cErr },
    { data: periods, error: pErr },
    { data: tts, error: ttErr },
    { data: teachers, error: tErr },
    { data: subjects, error: sErr },
    { data: absences, error: aErr },
    { data: openCalls, error: ocErr },
  ] = await Promise.all([
    loadInstitutionSettings(req),
    srv
      .from("classes")
      .select("id,label,level,institution_id")
      .eq("institution_id", institution_id)
      .order("label"),
    srv
      .from("institution_periods")
      .select("id,institution_id,weekday,label,start_time,end_time")
      .eq("institution_id", institution_id),
    srv
      .from("teacher_timetables")
      .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
      .eq("institution_id", institution_id),
    srv
      .from("profiles")
      .select("id,display_name,email,phone")
      .eq("institution_id", institution_id),
    srv
      .from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(id,name)")
      .eq("institution_id", institution_id),
    srv
      .from("teacher_absence_requests")
      .select(
        "teacher_profile_id,start_date,end_date,reason_label,status,admin_comment,institution_id"
      )
      .eq("institution_id", institution_id)
      .in("status", ["pending", "approved", "rejected", "cancelled"])
      .lte("start_date", todayYmd)
      .gte("end_date", todayYmd),
    srv
      .from("admin_student_calls")
      .select("id,class_id,period_id,call_date,started_at,actual_call_at,ended_at")
      .eq("institution_id", institution_id)
      .eq("actor_profile_id", user_id)
      .eq("call_date", todayYmd)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });
  if (ttErr) return NextResponse.json({ error: ttErr.message }, { status: 400 });
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 400 });
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 400 });

  const teacherNameById = new Map<string, string>();
  for (const t of teachers || []) {
    const id = String((t as any).id || "");
    const name =
      String((t as any).display_name || "").trim() ||
      String((t as any).email || "").trim() ||
      String((t as any).phone || "").trim() ||
      "Enseignant";
    if (id) teacherNameById.set(id, name);
  }

  const subjectNameById = new Map<string, string>();
  for (const row of subjects || []) {
    const instId = String((row as any).id || "");
    const custom = String((row as any).custom_name || "").trim();

    let baseName = "";
    const rel = (row as any).subjects;
    if (Array.isArray(rel) && rel[0]) {
      baseName = String(rel[0]?.name || "").trim();
    } else if (rel && typeof rel === "object") {
      baseName = String(rel?.name || "").trim();
    }

    subjectNameById.set(instId, custom || baseName || "Discipline");
  }

  const absenceIndex = new Map<
    string,
    {
      status: "pending" | "approved" | "rejected" | "cancelled";
      reason_label: string | null;
      admin_comment: string | null;
    }
  >();

  for (const r of absences || []) {
    const teacherId = String((r as any).teacher_profile_id || "");
    if (!teacherId) continue;

    absenceIndex.set(teacherId, {
      status: String((r as any).status || "") as any,
      reason_label: String((r as any).reason_label || "").trim() || null,
      admin_comment: String((r as any).admin_comment || "").trim() || null,
    });
  }

  const weekdayMode = detectWeekdayMode(periods || []);
  const todayDbWeekday = jsDayToDbWeekday(today.getUTCDay(), weekdayMode);

  const previews: Record<string, PreviewInfo> = {};
  for (const tt of tts || []) {
    const ttWeekday = parseWeekday((tt as any).weekday);
    if (ttWeekday !== todayDbWeekday) continue;

    const class_id = String((tt as any).class_id || "");
    const period_id = String((tt as any).period_id || "");
    const teacher_id = String((tt as any).teacher_id || "");
    const subject_id = String((tt as any).subject_id || "");
    if (!class_id || !period_id) continue;

    const key = `${class_id}|${period_id}`;
    if (previews[key]) continue;

    const absence = absenceIndex.get(teacher_id);

    previews[key] = {
      teacher_name: teacherNameById.get(teacher_id) || "Enseignant",
      subject_name: subjectNameById.get(subject_id) || "Discipline",
      absence_request_status: absence?.status || null,
      absence_reason_label: absence?.reason_label || null,
      absence_admin_comment: absence?.admin_comment || null,
    };
  }

  const normalizedClasses = (classes || []).map((c: any) => ({
    id: String(c.id),
    label: String(c.label || ""),
    level: String(c.level || "").trim() || inferLevelFromClassLabel(c.label) || null,
  }));

  const levels = Array.from(
    new Set(normalizedClasses.map((c) => c.level).filter((x): x is string => !!x))
  ).sort(compareLevels);

  const normalizedPeriods = (periods || [])
    .map((p: any) => ({
      id: String(p.id),
      weekday: Number(p.weekday || 1),
      label: String(p.label || "Séance"),
      start_time: normalizeTime(p.start_time),
      end_time: normalizeTime(p.end_time),
    }))
    .sort((a, b) => {
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      return a.start_time.localeCompare(b.start_time);
    });

  const openRaw = (openCalls || [])[0] as any;
  const openClassLabel =
    normalizedClasses.find((c) => c.id === String(openRaw?.class_id || ""))?.label || "Classe";
  const openPeriod = normalizedPeriods.find((p) => p.id === String(openRaw?.period_id || ""));

  const open_session = openRaw
    ? {
        id: String(openRaw.id),
        class_id: String(openRaw.class_id),
        class_label: openClassLabel,
        period_id: String(openRaw.period_id),
        period_label: openPeriod?.label || "Séance",
        call_date: String(openRaw.call_date),
        started_at: String(openRaw.started_at),
        actual_call_at: openRaw.actual_call_at ? String(openRaw.actual_call_at) : null,
      }
    : null;

  return NextResponse.json({
    ok: true,
    institution_name: instSettings.institution_name,
    academic_year_label: instSettings.academic_year_label,
    levels,
    classes: normalizedClasses,
    periods: normalizedPeriods,
    previews,
    open_session,
  });
}