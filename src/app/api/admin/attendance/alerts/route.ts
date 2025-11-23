// src/app/api/admin/attendance/alerts/route.ts 
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  buildAdminAttendancePushPayload,
  type AdminAttendanceEvent,
  type MonitorStatus,
} from "@/lib/push/admin-attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

/* ───────────────── helpers log / parse ───────────────── */
function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function safeParse<T = any>(x: any): T | null {
  if (!x) return null;
  if (typeof x === "object") return x as T;
  try {
    return JSON.parse(String(x)) as T;
  } catch {
    return null;
  }
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

function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/* Seuil en minutes pour déclencher les alertes */
const LATE_THRESHOLD_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN)))
    : 15;

/* ───────────────── Auth CRON ───────────────── */
function okAuth(req: Request) {
  const secret = (
    process.env.CRON_SECRET ||
    process.env.CRON_PUSH_SECRET ||
    ""
  ).trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");
  const allowed =
    fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
  console.info("[attendance/alerts] auth", {
    fromVercelCron,
    xCronPresent: !!xCron,
    bearerPresent: !!bearer,
    secretPresent: !!secret,
    allowed,
  });
  return allowed;
}

/* ───────────────── Types locaux ───────────────── */
type PeriodRow = {
  id: string;
  institution_id: string;
  weekday: number;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  startMin: number;
  endMin: number;
};

type SessIndexItem = {
  callMin: number;
};

type ExistingAlertRow = {
  institution_id: string | null;
  parent_id: string | null;
  meta: any | null;
};

export const GET = run;
export const POST = run;

async function run(req: Request) {
  const id = rid();
  const t0 = Date.now();
  console.info("[attendance/alerts] start", {
    id,
    when: new Date().toISOString(),
    method: req.method,
    lateThreshold: LATE_THRESHOLD_MIN,
  });

  if (!okAuth(req)) {
    console.warn("[attendance/alerts] forbidden", { id });
    return NextResponse.json({ ok: false, error: "forbidden", id }, { status: 403 });
  }

  const srv = getSupabaseServiceClient();

  // On travaille sur la journée courante (UTC ~ Africa/Abidjan)
  const now = new Date();
  const weekday = now.getUTCDay(); // 0=dim
  const ymd = toYMD(now);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  console.info("[attendance/alerts] context", {
    id,
    ymd,
    weekday,
    nowMin,
  });

  // 1) Emplois du temps du jour (toutes institutions)
  const { data: ttsAll, error: ttErr } = await srv
    .from("teacher_timetables")
    .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
    .eq("weekday", weekday);

  if (ttErr) {
    console.error("[attendance/alerts] tts_err", { id, error: ttErr.message });
    return NextResponse.json(
      { ok: false, error: ttErr.message, stage: "timetables", id },
      { status: 200 },
    );
  }

  if (!ttsAll || ttsAll.length === 0) {
    const msEmpty = Date.now() - t0;
    console.info("[attendance/alerts] no_timetables_for_day", { id, ms: msEmpty });
    return NextResponse.json({ ok: true, id, created: 0, ms: msEmpty });
  }

  const instIds = Array.from(
    new Set(
      (ttsAll || [])
        .map((tt: any) => String(tt.institution_id || ""))
        .filter(Boolean),
    ),
  );

  if (!instIds.length) {
    const msNoInst = Date.now() - t0;
    console.info("[attendance/alerts] no_institutions_from_tts", {
      id,
      ms: msNoInst,
    });
    return NextResponse.json({ ok: true, id, created: 0, ms: msNoInst });
  }

  console.info("[attendance/alerts] institutions", {
    id,
    count: instIds.length,
    instIds,
  });

  // 2) Données de base pour ces institutions
  const [
    { data: periodsAll, error: pErr },
    { data: classesAll, error: cErr },
    { data: subjectsAll, error: sErr },
    { data: teachersAll, error: tErr },
    { data: sessionsAll, error: sessErr },
    { data: adminsAll, error: adminsErr },
    { data: existingAlerts, error: alertsErr },
  ] = await Promise.all([
    srv
      .from("institution_periods")
      .select("id,institution_id,weekday,label,start_time,end_time")
      .in("institution_id", instIds),
    srv
      .from("classes")
      .select("id,institution_id,label")
      .in("institution_id", instIds),
    srv
      .from("institution_subjects")
      .select("id,institution_id,custom_name,subjects:subject_id(name)")
      .in("institution_id", instIds),
    srv
      .from("profiles")
      .select("id,institution_id,display_name,email,phone")
      .in("institution_id", instIds),
    srv
      .from("teacher_sessions")
      .select(
        "id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,origin",
      )
      .in("institution_id", instIds)
      .gte("started_at", dayStart.toISOString())
      .lt("started_at", dayEnd.toISOString()),
    srv
      .from("user_roles")
      .select("profile_id,institution_id,role")
      .in("institution_id", instIds)
      .in("role", ["admin", "super_admin"]),
    srv
      .from("notifications_queue")
      .select("id,institution_id,parent_id,meta,created_at")
      .in("institution_id", instIds)
      .gte("created_at", dayStart.toISOString())
      .lt("created_at", dayEnd.toISOString()),
  ]);

  if (pErr) {
    console.error("[attendance/alerts] periods_err", { id, error: pErr.message });
    return NextResponse.json(
      { ok: false, error: pErr.message, stage: "periods", id },
      { status: 200 },
    );
  }
  if (cErr) {
    console.error("[attendance/alerts] classes_err", { id, error: cErr.message });
    return NextResponse.json(
      { ok: false, error: cErr.message, stage: "classes", id },
      { status: 200 },
    );
  }
  if (sErr) {
    console.error("[attendance/alerts] subjects_err", { id, error: sErr.message });
    return NextResponse.json(
      { ok: false, error: sErr.message, stage: "subjects", id },
      { status: 200 },
    );
  }
  if (tErr) {
    console.error("[attendance/alerts] teachers_err", { id, error: tErr.message });
    return NextResponse.json(
      { ok: false, error: tErr.message, stage: "teachers", id },
      { status: 200 },
    );
  }
  if (sessErr) {
    console.error("[attendance/alerts] sessions_err", { id, error: sessErr.message });
    return NextResponse.json(
      { ok: false, error: sessErr.message, stage: "sessions", id },
      { status: 200 },
    );
  }
  if (adminsErr) {
    console.error("[attendance/alerts] admins_err", { id, error: adminsErr.message });
    return NextResponse.json(
      { ok: false, error: adminsErr.message, stage: "admins", id },
      { status: 200 },
    );
  }
  if (alertsErr) {
    console.error("[attendance/alerts] existing_alerts_err", {
      id,
      error: alertsErr.message,
    });
    // On continue quand même, mais avec moins de dédup
  }

  // 3) Index locaux
  const periodById = new Map<string, PeriodRow>();
  (periodsAll || []).forEach((p: any) => {
    const startNorm = normalizeTimeFromDb(p.start_time);
    const endNorm = normalizeTimeFromDb(p.end_time);
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    periodById.set(String(p.id), {
      id: String(p.id),
      institution_id: String(p.institution_id),
      weekday: typeof p.weekday === "number" ? p.weekday : 0,
      label: (p.label as string | null) ?? null,
      start_time: startNorm,
      end_time: endNorm,
      startMin,
      endMin,
    });
  });

  const classById = new Map<
    string,
    { label: string | null; institution_id: string }
  >();
  (classesAll || []).forEach((c: any) => {
    classById.set(String(c.id), {
      label: (c.label as string | null) ?? null,
      institution_id: String(c.institution_id),
    });
  });

  const subjectNameById = new Map<
    string,
    { name: string | null; institution_id: string }
  >();
  (subjectsAll || []).forEach((row: any) => {
    const idStr = String(row.id);
    const cname = (row.custom_name as string | null) || "";
    let baseName = "";
    if (Array.isArray(row.subjects)) {
      baseName = row.subjects[0]?.name || "";
    } else if (row.subjects && typeof row.subjects === "object") {
      baseName = (row.subjects as any).name || "";
    }
    const name = (cname || baseName || "").trim() || "Discipline";
    subjectNameById.set(idStr, {
      name,
      institution_id: String(row.institution_id),
    });
  });

  const teacherNameById = new Map<
    string,
    { name: string; institution_id: string }
  >();
  (teachersAll || []).forEach((t: any) => {
    const idStr = String(t.id);
    const disp = (t.display_name as string | null) || "";
    const email = (t.email as string | null) || "";
    const phone = (t.phone as string | null) || "";
    const name =
      disp.trim() || email.trim() || phone.trim() || "Enseignant";
    teacherNameById.set(idStr, {
      name,
      institution_id: String(t.institution_id),
    });
  });

  const sessionsIndex = new Map<string, SessIndexItem[]>();
  (sessionsAll || []).forEach((s: any) => {
    const callIso =
      (s.actual_call_at as string | null) ||
      (s.started_at as string | null);
    if (!callIso) return;
    const d = new Date(callIso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const callYmd = `${y}-${m}-${dd}`;
    if (callYmd !== ymd) return;

    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const hm = `${hh}:${mm}`;
    const callMin = hmToMin(hm);

    const key = [
      callYmd,
      String(s.class_id || ""),
      String(s.subject_id || ""),
      String(s.teacher_id || ""),
    ].join("|");

    const arr = sessionsIndex.get(key) || [];
    arr.push({ callMin });
    sessionsIndex.set(key, arr);
  });

  const adminsByInst = new Map<string, string[]>();
  (adminsAll || []).forEach((r: any) => {
    const inst = String(r.institution_id || "");
    const pid = String(r.profile_id || "");
    if (!inst || !pid) return;
    const arr = adminsByInst.get(inst) || [];
    arr.push(pid);
    adminsByInst.set(inst, Array.from(new Set(arr)));
  });

  // Déduplication : clé (inst|alert_type|slot_id)
  const existingKeys = new Set<string>();
  (existingAlerts || []).forEach((row: ExistingAlertRow) => {
    const inst = row.institution_id ? String(row.institution_id) : "";
    if (!inst) return;
    const m = safeParse<any>(row.meta) || row.meta || {};
    const slotId = typeof m?.slot_id === "string" ? m.slot_id : "";
    const alertType = typeof m?.alert_type === "string" ? m.alert_type : "";
    if (!slotId || !alertType) return;
    const key = `${inst}|${alertType}|${slotId}`;
    existingKeys.add(key);
  });

  // 4) Construction des événements d’alerte
  type AlertEvent = {
    ev: AdminAttendanceEvent;
    slotId: string;
    alertType: string; // "missing_early" | "missing_final" | "late"
  };
  const events: AlertEvent[] = [];

  (ttsAll || []).forEach((tt: any) => {
    const instId = String(tt.institution_id || "");
    const period = periodById.get(String(tt.period_id));
    if (!instId || !period) return;
    if (period.weekday !== weekday) return;

    const startMin = period.startMin;
    const endMin = period.endMin;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return;

    const earlyThreshold = startMin + LATE_THRESHOLD_MIN;
    if (nowMin < earlyThreshold) {
      // Avant le seuil : aucune alerte
      return;
    }

    const classId = String(tt.class_id);
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id);

    const classInfo = classById.get(classId) || {
      label: null,
      institution_id: instId,
    };
    const subjInfo = subjectNameById.get(subjectId) || {
      name: null,
      institution_id: instId,
    };
    const teacherInfo = teacherNameById.get(teacherId) || {
      name: "Enseignant",
      institution_id: instId,
    };

    const key = [ymd, classId, subjectId, teacherId].join("|");
    const sessList = sessionsIndex.get(key) || [];

    let best: SessIndexItem | null = null;
    for (const s of sessList) {
      if (s.callMin < startMin || s.callMin > endMin + 120) {
        continue;
      }
      if (!best || s.callMin < best.callMin) best = s;
    }

    const slotId = [ymd, tt.period_id, classId, subjectId, teacherId].join("|");

    // Phase 1 : après 15 min, pendant le créneau → "appel non détecté"
    if (nowMin >= earlyThreshold && nowMin < endMin) {
      if (!best) {
        const ev: AdminAttendanceEvent = {
          institution_id: instId,
          class_id: classId,
          class_label: classInfo.label,
          subject_id: subjectId || null,
          subject_name: subjInfo.name,
          teacher_id: teacherId,
          teacher_name: teacherInfo.name,
          date: ymd,
          period_label: period.label,
          planned_start: normalizeTimeFromDb(period.start_time),
          planned_end: normalizeTimeFromDb(period.end_time),
          status: "missing" as MonitorStatus,
          late_minutes: nowMin - startMin,
        };
        events.push({ ev, slotId, alertType: "missing_early" });
      }
      return;
    }

    // Phase 2 : fin de créneau ou plus tard → "final"
    if (nowMin >= endMin) {
      // Aucun appel pendant tout le créneau
      if (!best) {
        const ev: AdminAttendanceEvent = {
          institution_id: instId,
          class_id: classId,
          class_label: classInfo.label,
          subject_id: subjectId || null,
          subject_name: subjInfo.name,
          teacher_id: teacherId,
          teacher_name: teacherInfo.name,
          date: ymd,
          period_label: period.label,
          planned_start: normalizeTimeFromDb(period.start_time),
          planned_end: normalizeTimeFromDb(period.end_time),
          status: "missing" as MonitorStatus,
          late_minutes: null,
        };
        events.push({ ev, slotId, alertType: "missing_final" });
        return;
      }

      // Appel effectué, mais peut-être en retard
      const delta = best.callMin - startMin;
      if (delta <= LATE_THRESHOLD_MIN) {
        // Appel dans les temps → pas de notif
        return;
      }

      const ev: AdminAttendanceEvent = {
        institution_id: instId,
        class_id: classId,
        class_label: classInfo.label,
        subject_id: subjectId || null,
        subject_name: subjInfo.name,
        teacher_id: teacherId,
        teacher_name: teacherInfo.name,
        date: ymd,
        period_label: period.label,
        planned_start: normalizeTimeFromDb(period.start_time),
        planned_end: normalizeTimeFromDb(period.end_time),
        status: "late" as MonitorStatus,
        late_minutes: delta,
      };
      events.push({ ev, slotId, alertType: "late" });
    }
  });

  if (!events.length) {
    const msNoEvents = Date.now() - t0;
    console.info("[attendance/alerts] no_events_to_push", {
      id,
      ms: msNoEvents,
    });
    return NextResponse.json({ ok: true, id, created: 0, ms: msNoEvents });
  }

  // 5) Insertion dans notifications_queue (UNE ligne par créneau & type d’alerte)
  const insertRows: any[] = [];

  for (const { ev, slotId, alertType } of events) {
    const admins = adminsByInst.get(ev.institution_id) || [];
    if (!admins.length) continue; // aucun admin pour l’établissement → inutile

    const dedupKey = `${ev.institution_id}|${alertType}|${slotId}`;
    if (existingKeys.has(dedupKey)) continue;
    existingKeys.add(dedupKey);

    const { payload, title, body } = buildAdminAttendancePushPayload(ev);
    const severity =
      (payload && (payload.severity as string)) ||
      (ev.status === "missing" ? "warning" : "info");

    insertRows.push({
      institution_id: ev.institution_id,
      student_id: null,
      session_id: null,
      mark_id: null,
      parent_id: null, // 👈 distribué aux admins dans /api/push/dispatch
      channels: ["inapp", "push"],
      payload: JSON.stringify(payload),
      title,
      body,
      status: WAIT_STATUS,
      attempts: 0,
      last_error: null,
      meta: JSON.stringify({
        slot_id: slotId,
        alert_type: alertType,
        source: "admin_attendance_alerts",
      }),
      severity,
    });
  }

  if (!insertRows.length) {
    const msNoInsert = Date.now() - t0;
    console.info("[attendance/alerts] nothing_new_to_insert", {
      id,
      ms: msNoInsert,
    });
    return NextResponse.json({ ok: true, id, created: 0, ms: msNoInsert });
  }

  const { error: insertErr, data: inserted } = await srv
    .from("notifications_queue")
    .insert(insertRows)
    .select("id");

  if (insertErr) {
    console.error("[attendance/alerts] insert_err", {
      id,
      error: insertErr.message,
    });
    return NextResponse.json(
      { ok: false, error: insertErr.message, stage: "insert", id },
      { status: 200 },
    );
  }

  const ms = Date.now() - t0;
  console.info("[attendance/alerts] done", {
    id,
    created: inserted?.length || 0,
    ms,
  });

  return NextResponse.json({
    ok: true,
    id,
    created: inserted?.length || 0,
    ms,
  });
}