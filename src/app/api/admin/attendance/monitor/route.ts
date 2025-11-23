// src/app/api/admin/attendance/monitor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MonitorStatus = "missing" | "late" | "ok";

type MonitorRow = {
  id: string;
  date: string; // "YYYY-MM-DD"
  weekday_label?: string | null;
  period_label?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  class_label?: string | null;
  subject_name?: string | null;
  teacher_name: string;
  status: MonitorStatus;
  late_minutes?: number | null;
  opened_from?: "teacher" | "class_device" | null;
};

/* ───────── helpers dates / heures (UTC ~= Africa/Abidjan) ───────── */

function parseYMD(ymd: string | null): Date | null {
  if (!ymd) return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || mo < 0 || d < 1) return null;
  // on crée la date en UTC pour coller au TZ Africa/Abidjan
  return new Date(Date.UTC(y, mo, d));
}

function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isoToYMD(iso: string): string {
  return toYMD(new Date(iso));
}

function isoToHM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "HH:MM" -> minutes depuis minuit */
function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/** "HH:MM[:SS]" -> minutes depuis minuit */
function hmsToMin(hms: string | null | undefined): number {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/** Normalise un time DB "07:10" / "07:10:00" -> "07:10" */
function normalizeTimeFromDb(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

/* Seuil en minutes au-delà duquel on considère l’appel « en retard » (pur affichage) */
const LATE_THRESHOLD_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN)))
    : 15;

export async function GET(req: NextRequest) {
  // ⭐️ bien faire l'await ici
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Auth + institution + rôle admin
  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();
  if (userErr) {
    console.warn("[attendance/monitor] auth_getUser_err", { error: userErr.message });
  }
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) {
    console.error("[attendance/monitor] profiles_err", { error: meErr.message });
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) {
    return NextResponse.json(
      { error: "no_institution", message: "Aucune institution associée." },
      { status: 400 },
    );
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  if (roleErr) {
    console.error("[attendance/monitor] role_err", { error: roleErr.message });
  }

  const role = (roleRow?.role as string | undefined) || "";
  if (!["admin", "super_admin"].includes(role)) {
    return NextResponse.json(
      { error: "forbidden", message: "Droits insuffisants pour cette vue." },
      { status: 403 },
    );
  }

  // Fenêtre de dates
  const today = new Date();
  const defaultTo = parseYMD(toParam) ?? new Date(today); // aujourd'hui
  const defaultFrom = parseYMD(fromParam) ?? new Date(today);
  if (!fromParam && !toParam) {
    // par défaut : les 7 derniers jours
    defaultFrom.setUTCDate(defaultTo.getUTCDate() - 7);
  }

  let fromDate = defaultFrom;
  let toDate = defaultTo;
  if (toDate.getTime() < fromDate.getTime()) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  // liste des dates inclusives
  const dates: { ymd: string; weekday: number }[] = [];
  const cursor = new Date(fromDate.getTime());
  while (cursor.getTime() <= toDate.getTime()) {
    dates.push({
      ymd: toYMD(cursor),
      weekday: cursor.getUTCDay(), // 0=dim, 1=lun...
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Pré-chargement des données de l’établissement
  const [
    { data: periods, error: pErr },
    { data: tts, error: ttErr },
    { data: classes, error: cErr },
    { data: subjects, error: sErr },
    { data: teachers, error: tErr },
  ] = await Promise.all([
    srv
      .from("institution_periods")
      // ⚠️ on ne sélectionne que des colonnes sûres
      .select("id,institution_id,weekday,label,start_time,end_time")
      .eq("institution_id", institution_id),
    srv
      .from("teacher_timetables")
      .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
      .eq("institution_id", institution_id),
    srv.from("classes").select("id,label").eq("institution_id", institution_id),
    srv
      .from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(name)")
      .eq("institution_id", institution_id),
    srv
      .from("profiles")
      .select("id,display_name,email,phone")
      .eq("institution_id", institution_id),
  ]);

  if (pErr) {
    console.error("[attendance/monitor] periods_err", { error: pErr.message });
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }
  if (ttErr) {
    console.error("[attendance/monitor] tts_err", { error: ttErr.message });
    return NextResponse.json({ error: ttErr.message }, { status: 400 });
  }
  if (cErr) {
    console.error("[attendance/monitor] classes_err", { error: cErr.message });
    return NextResponse.json({ error: cErr.message }, { status: 400 });
  }
  if (sErr) {
    console.error("[attendance/monitor] subjects_err", { error: sErr.message });
    return NextResponse.json({ error: sErr.message }, { status: 400 });
  }
  if (tErr) {
    console.error("[attendance/monitor] teachers_err", { error: tErr.message });
    return NextResponse.json({ error: tErr.message }, { status: 400 });
  }

  const dateMinIso = new Date(fromDate.getTime());
  dateMinIso.setUTCHours(0, 0, 0, 0);
  const dateMaxIso = new Date(toDate.getTime());
  dateMaxIso.setUTCDate(dateMaxIso.getUTCDate() + 1);
  dateMaxIso.setUTCHours(0, 0, 0, 0);

  const { data: sessions, error: sessErr } = await srv
    .from("teacher_sessions")
    // ⚠️ on ne demande plus opened_from, mais origin (schéma réel)
    .select(
      "id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,origin",
    )
    .eq("institution_id", institution_id)
    .gte("started_at", dateMinIso.toISOString())
    .lt("started_at", dateMaxIso.toISOString());

  if (sessErr) {
    console.error("[attendance/monitor] sessions_err", { error: sessErr.message });
    return NextResponse.json({ error: sessErr.message }, { status: 400 });
  }

  // Index / maps
  type PeriodRow = {
    id: string;
    weekday: number;
    label: string | null;
    start_time: string | null;
    end_time: string | null;
    startMin: number;
    endMin: number;
    institution_id: string;
  };

  const periodById = new Map<string, PeriodRow>();
  (periods || []).forEach((p: any) => {
    const startNorm = normalizeTimeFromDb(p.start_time);
    const endNorm = normalizeTimeFromDb(p.end_time);
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    periodById.set(String(p.id), {
      id: String(p.id),
      weekday: typeof p.weekday === "number" ? p.weekday : 0,
      label: (p.label as string | null) ?? null,
      start_time: startNorm,
      end_time: endNorm,
      startMin,
      endMin,
      institution_id: String(p.institution_id),
    });
  });

  const classLabelById = new Map<string, string>();
  (classes || []).forEach((c: any) => {
    classLabelById.set(String(c.id), String(c.label || ""));
  });

  const subjectNameById = new Map<string, string>();
  (subjects || []).forEach((row: any) => {
    const id = String(row.id);
    const cname = (row.custom_name as string | null) || "";
    let baseName = "";
    if (Array.isArray(row.subjects)) {
      baseName = row.subjects[0]?.name || "";
    } else if (row.subjects && typeof row.subjects === "object") {
      baseName = (row.subjects as any).name || "";
    }
    const name = (cname || baseName || "").trim() || "Discipline";
    subjectNameById.set(id, name);
  });

  const teacherNameById = new Map<string, string>();
  (teachers || []).forEach((t: any) => {
    const id = String(t.id);
    const disp = (t.display_name as string | null) || "";
    const email = (t.email as string | null) || "";
    const phone = (t.phone as string | null) || "";
    const name = disp.trim() || email.trim() || phone.trim() || "Enseignant";
    teacherNameById.set(id, name);
  });

  // Index des séances par (date|class|subject|teacher)
  type SessIndexItem = {
    callMin: number;
    opened_from: "teacher" | "class_device" | null;
  };

  const sessionsIndex = new Map<string, SessIndexItem[]>();

  (sessions || []).forEach((s: any) => {
    const callIso = (s.actual_call_at as string | null) || (s.started_at as string | null);
    if (!callIso) return;
    const ymd = isoToYMD(callIso);
    const hm = isoToHM(callIso);
    const callMin = hmToMin(hm);

    const origin = (s.origin as string | null) || null;
    const opened_from: "teacher" | "class_device" | null =
      origin === "class_device"
        ? "class_device"
        : origin === "teacher"
        ? "teacher"
        : null;

    const key = [
      ymd,
      String(s.class_id || ""),
      String(s.subject_id || ""),
      String(s.teacher_id || ""),
    ].join("|");
    const arr = sessionsIndex.get(key) || [];
    arr.push({
      callMin,
      opened_from,
    });
    sessionsIndex.set(key, arr);
  });

  // On prépare une map weekday -> dates
  const datesByWeekday = new Map<number, string[]>();
  for (const d of dates) {
    const arr = datesByWeekday.get(d.weekday) || [];
    arr.push(d.ymd);
    datesByWeekday.set(d.weekday, arr);
  }

  // Calcul final des lignes
  const rows: MonitorRow[] = [];

  (tts || []).forEach((tt: any) => {
    const weekday = typeof tt.weekday === "number" ? tt.weekday : null;
    if (weekday === null) return;
    const datesForDay = datesByWeekday.get(weekday);
    if (!datesForDay || !datesForDay.length) return;

    const period = periodById.get(String(tt.period_id));
    if (!period) return;

    const startMin = period.startMin;
    const endMin = period.endMin;

    const classId = String(tt.class_id);
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id);

    const classLabel = classLabelById.get(classId) || "";
    const subjName = subjectNameById.get(subjectId) || "Discipline";
    const teacherName = teacherNameById.get(teacherId) || "Enseignant";

    for (const ymd of datesForDay) {
      const key = [ymd, classId, subjectId, teacherId].join("|");
      const sessList = sessionsIndex.get(key) || [];

      // Séance la plus ancienne dans le créneau (si plusieurs)
      let best: SessIndexItem | null = null;
      for (const s of sessList) {
        if (s.callMin < startMin || s.callMin > endMin + 120) {
          // en dehors de la plage + 2h de marge : on ignore
          continue;
        }
        if (!best || s.callMin < best.callMin) best = s;
      }

      let status: MonitorStatus;
      let lateMinutes: number | null = null;
      let opened_from: "teacher" | "class_device" | null = null;

      if (best) {
        const delta = best.callMin - startMin;
        if (delta <= LATE_THRESHOLD_MIN) {
          status = "ok";
        } else {
          status = "late";
          lateMinutes = delta;
        }
        opened_from = best.opened_from;
      } else {
        status = "missing";
      }

      const periodLabel =
        period.label ||
        [
          normalizeTimeFromDb(period.start_time) || "",
          normalizeTimeFromDb(period.end_time) || "",
        ]
          .filter(Boolean)
          .join(" – ");

      const row: MonitorRow = {
        id: [ymd, tt.period_id, classId, subjectId, teacherId].join("|"),
        date: ymd,
        weekday_label: null,
        period_label: periodLabel || null,
        planned_start: normalizeTimeFromDb(period.start_time),
        planned_end: normalizeTimeFromDb(period.end_time),
        class_label: classLabel || null,
        subject_name: subjName || null,
        teacher_name: teacherName,
        status,
        late_minutes: lateMinutes,
        opened_from,
      };

      rows.push(row);
    }
  });

  // tri : date, puis heure de début, puis classe
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const sa = (a.planned_start || "00:00") as string;
    const sb = (b.planned_start || "00:00") as string;
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ca = (a.class_label || "") as string;
    const cb = (b.class_label || "") as string;
    return ca.localeCompare(cb);
  });

  return NextResponse.json({ rows });
}
