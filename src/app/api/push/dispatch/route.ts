import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers log ───────────────── */
function rid() {
  return Math.random().toString(36).slice(2, 8);
}
function shortId(x: string | null | undefined, n = 8) {
  const s = String(x || "");
  if (s.length <= n) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
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
function normalizeEmail(e: string | null | undefined) {
  return String(e || "").trim().toLowerCase();
}

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

/* Seuil en minutes avant alerte « appel non réalisé » */
const ATTENDANCE_LATE_THRESHOLD_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN)))
    : 15;

/* ───────────────── Auth ───────────────── */
function okAuth(req: Request) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");
  const allowed = fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
  console.info("[push/dispatch] auth", {
    fromVercelCron,
    xCronPresent: !!xCron,
    bearerPresent: !!bearer,
    secretPresent: !!secret,
    allowed,
  });
  return allowed;
}

/* ──────────────── WebPush (VAPID) ──────────────── */
function ensureWebPushConfigured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const prv = process.env.VAPID_PRIVATE_KEY;
  console.info("[push/dispatch] vapid_env", {
    pubLen: pub?.length || 0,
    prvLen: prv?.length || 0,
    pubPreview: pub ? shortId(pub, 12) : null,
  });
  if (!pub || !prv) throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
  webpush.setVapidDetails("mailto:no-reply@example.com", pub, prv);
}

/* ──────────────── FCM mobile (optionnel) ──────────────── */
const FCM_KEY = process.env.FCM_SERVER_KEY || "";
async function sendFCM(to: string, title: string, body: string, url: string, data: any) {
  if (!FCM_KEY) throw new Error("missing FCM_SERVER_KEY");
  const payload = {
    to,
    notification: { title, body, click_action: url },
    data: { url, ...data },
    priority: "high",
  };
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `key=${FCM_KEY}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`FCM ${res.status} ${text}`);
}

/* ──────────────── Types ──────────────── */
type QueueRow = {
  id: string;
  parent_id: string | null;
  student_id: string | null;
  profile_id: string | null; // ⭐ admin / profil cible
  channels: any;
  payload: any;
  title: string | null;
  body: string | null;
  status: string;
  attempts: number | null;
  created_at: string;
  meta: any | null;
};
type SubRow = {
  user_id: string;
  platform: string | null;
  device_id: string | null;
  subscription_json: any;
  fcm_token: string | null;
};

/* "HH:MM[:SS]" -> minutes depuis minuit */
function hmsToMin(hms: string | null | undefined): number {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/* "HH:MM" -> minutes depuis minuit */
function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function isoToYMD(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function isoToHM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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

function hasPushChannel(row: QueueRow) {
  try {
    const raw = row.channels;
    const arr = Array.isArray(raw) ? raw : raw ? JSON.parse(String(raw)) : [];
    const ok = Array.isArray(arr) && arr.includes("push");
    if (!ok) console.debug("[push/dispatch] skip_no_push_channel", { id: row.id, channels: raw });
    return ok;
  } catch (e: any) {
    console.warn("[push/dispatch] channels_parse_error", {
      id: row.id,
      error: String(e?.message || e),
    });
    return false;
  }
}

/* ──────────────── ALERTES ADMIN : appel non réalisé ──────────────── */

async function enqueueAdminAttendanceMissingAlerts(
  srv: ReturnType<typeof getSupabaseServiceClient>,
) {
  const id = rid();
  const now = new Date();
  const todayYmd = now.toISOString().slice(0, 10);
  const weekday = now.getUTCDay(); // 0 = dimanche
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const thresholdMin = ATTENDANCE_LATE_THRESHOLD_MIN;

  console.info("[push/dispatch] admin_attendance_alerts_start", {
    id,
    todayYmd,
    weekday,
    nowMin,
    thresholdMin,
  });

  // 1) Périodes du jour (toutes institutions)
  const { data: periods, error: pErr } = await srv
    .from("institution_periods")
    .select("id,institution_id,weekday,label,start_time,end_time")
    .eq("weekday", weekday);

  if (pErr) {
    console.warn("[push/dispatch] admin_attendance_alerts_periods_err", {
      id,
      error: pErr.message,
    });
    return;
  }
  if (!periods || !periods.length) {
    console.info("[push/dispatch] admin_attendance_alerts_no_periods", { id, weekday });
    return;
  }

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

  const periodById = new Map<string, PeriodRow>();
  const candidatePeriodIds = new Set<string>();
  const instIdsSet = new Set<string>();

  for (const p of periods as any[]) {
    const pid = String(p.id);
    const instId = String(p.institution_id);
    instIdsSet.add(instId);

    const startNorm = normalizeTimeFromDb(p.start_time);
    const endNorm = normalizeTimeFromDb(p.end_time);
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);

    periodById.set(pid, {
      id: pid,
      institution_id: instId,
      weekday: typeof p.weekday === "number" ? p.weekday : weekday,
      label: (p.label as string | null) ?? null,
      start_time: startNorm,
      end_time: endNorm,
      startMin,
      endMin,
    });

    const earlyFrom = startMin + thresholdMin;
    const lastAllowed = endMin + 60; // on laisse 1h de marge max après la fin
    if (nowMin >= earlyFrom && nowMin <= lastAllowed) {
      candidatePeriodIds.add(pid);
    }
  }

  if (!candidatePeriodIds.size) {
    console.info("[push/dispatch] admin_attendance_alerts_no_candidate_periods", {
      id,
      nowMin,
      thresholdMin,
    });
    return;
  }

  const instIds = Array.from(instIdsSet);
  const periodIds = Array.from(candidatePeriodIds);

  // 2) Emplois du temps des créneaux candidats
  const { data: tts, error: ttErr } = await srv
    .from("teacher_timetables")
    .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
    .in("institution_id", instIds)
    .eq("weekday", weekday)
    .in("period_id", periodIds);

  if (ttErr) {
    console.warn("[push/dispatch] admin_attendance_alerts_timetables_err", {
      id,
      error: ttErr.message,
    });
    return;
  }
  if (!tts || !tts.length) {
    console.info(
      "[push/dispatch] admin_attendance_alerts_no_timetables_for_candidates",
      { id },
    );
    return;
  }

  // 3) Préparation des IDs (classes, subjects, teachers, institutions)
  const classIdsSet = new Set<string>();
  const subjectIdsSet = new Set<string>();
  const teacherIdsSet = new Set<string>();
  const instIdsForTtsSet = new Set<string>();

  for (const tt of tts as any[]) {
    if (tt.class_id) classIdsSet.add(String(tt.class_id));
    if (tt.subject_id) subjectIdsSet.add(String(tt.subject_id));
    if (tt.teacher_id) teacherIdsSet.add(String(tt.teacher_id));
    if (tt.institution_id) instIdsForTtsSet.add(String(tt.institution_id));
  }

  const classIds = Array.from(classIdsSet);
  const instSubjectIds = Array.from(subjectIdsSet);
  const teacherIds = Array.from(teacherIdsSet);
  const instIdsForTts = Array.from(instIdsForTtsSet);

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // 4) Chargements parallèles
  const [
    { data: classes, error: cErr },
    { data: subjects, error: sErr },
    { data: teachers, error: tErr },
    { data: sessions, error: sessErr },
    { data: roles, error: rErr },
    { data: existingAlerts, error: exErr },
  ] = await Promise.all([
    classIds.length
      ? srv
          .from("classes")
          .select("id,label,institution_id")
          .in("id", classIds)
      : Promise.resolve({ data: [], error: null as any }),
    instSubjectIds.length
      ? srv
          .from("institution_subjects")
          .select("id,institution_id,custom_name,subjects:subject_id(name)")
          .in("id", instSubjectIds)
      : Promise.resolve({ data: [], error: null as any }),
    teacherIds.length
      ? srv
          .from("profiles")
          .select("id,display_name,email,phone")
          .in("id", teacherIds)
      : Promise.resolve({ data: [], error: null as any }),
    instIdsForTts.length
      ? srv
          .from("teacher_sessions")
          .select(
            "id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,opened_from",
          )
          .in("institution_id", instIdsForTts)
          .gte("started_at", dayStart.toISOString())
          .lt("started_at", dayEnd.toISOString())
      : Promise.resolve({ data: [], error: null as any }),
    instIdsForTts.length
      ? srv
          .from("user_roles")
          .select("profile_id,institution_id,role")
          .in("institution_id", instIdsForTts)
          .in("role", ["admin", "super_admin"])
      : Promise.resolve({ data: [], error: null as any }),
    instIdsForTts.length
      ? srv
          .from("notifications_queue")
          .select("profile_id,meta,institution_id,created_at")
          .in("institution_id", instIdsForTts)
          .gte("created_at", dayStart.toISOString())
          .lt("created_at", dayEnd.toISOString())
      : Promise.resolve({ data: [], error: null as any }),
  ]);

  if (cErr) console.warn("[push/dispatch] admin_attendance_alerts_classes_err", { id, error: cErr.message });
  if (sErr) console.warn("[push/dispatch] admin_attendance_alerts_subjects_err", { id, error: sErr.message });
  if (tErr) console.warn("[push/dispatch] admin_attendance_alerts_teachers_err", { id, error: tErr.message });
  if (sessErr) console.warn("[push/dispatch] admin_attendance_alerts_sessions_err", { id, error: sessErr.message });
  if (rErr) console.warn("[push/dispatch] admin_attendance_alerts_roles_err", { id, error: rErr.message });
  if (exErr) console.warn("[push/dispatch] admin_attendance_alerts_existing_err", { id, error: exErr.message });

  // Maps pour affichage
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

  // Séances indexées par (date|class|subject|teacher)
  type SessIndexItem = {
    callMin: number;
    opened_from: "teacher" | "class_device" | null;
  };
  const sessionsIndex = new Map<string, SessIndexItem[]>();

  (sessions || []).forEach((s: any) => {
    const callIso = (s.actual_call_at as string | null) || (s.started_at as string | null);
    if (!callIso) return;
    const ymd = isoToYMD(callIso);
    if (ymd !== todayYmd) return;
    const hm = isoToHM(callIso);
    const callMin = hmToMin(hm);
    const key = [
      ymd,
      String(s.class_id || ""),
      String(s.subject_id || ""),
      String(s.teacher_id || ""),
    ].join("|");
    const arr = sessionsIndex.get(key) || [];
    arr.push({
      callMin,
      opened_from:
        s.opened_from === "class_device"
          ? "class_device"
          : s.opened_from === "teacher"
          ? "teacher"
          : null,
    });
    sessionsIndex.set(key, arr);
  });

  // Admins par institution
  const adminsByInstitution = new Map<string, string[]>();
  (roles || []).forEach((r: any) => {
    const instId = String(r.institution_id);
    const pid = String(r.profile_id);
    const arr = adminsByInstitution.get(instId) || [];
    if (!arr.includes(pid)) arr.push(pid);
    adminsByInstitution.set(instId, arr);
  });

  // Alertes déjà créées aujourd’hui (pour éviter les doublons)
  const existingSet = new Set<string>(); // `${kind}|${profile_id}|${alert_key}`
  (existingAlerts || []).forEach((row: any) => {
    const m = safeParse<any>(row.meta) || {};
    const kind = String(m.kind || "");
    if (
      kind !== "admin_attendance_missing_early" &&
      kind !== "admin_attendance_missing_final"
    ) {
      return;
    }
    const alertKey = String(m.alert_key || "");
    const pid = String(row.profile_id || "");
    if (!alertKey || !pid) return;
    existingSet.add(`${kind}|${pid}|${alertKey}`);
  });

  const humanDate = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const inserts: any[] = [];

  for (const tt of tts as any[]) {
    const instId = String(tt.institution_id);
    const admins = adminsByInstitution.get(instId);
    if (!admins || !admins.length) continue;

    const period = periodById.get(String(tt.period_id));
    if (!period) continue;

    const earlyFrom = period.startMin + thresholdMin;
    const lastAllowed = period.endMin + 60;

    // Fenêtre globale pour ce créneau (on ne traite que si on est dans la plage utile)
    if (nowMin < earlyFrom || nowMin > lastAllowed) continue;

    const classId = String(tt.class_id || "");
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id || "");

    const classLabel = classLabelById.get(classId) || "";
    const subjName = subjectNameById.get(subjectId) || "Discipline";
    const teacherName = teacherNameById.get(teacherId) || "Enseignant";

    const baseAlertKey = [todayYmd, tt.period_id, classId, subjectId, teacherId].join("|");
    const startLabel = normalizeTimeFromDb(period.start_time) || "?";
    const endLabel = normalizeTimeFromDb(period.end_time) || "?";
    const periodLabel =
      period.label ||
      [startLabel, endLabel].filter(Boolean).join(" – ") ||
      null;

    const key = [todayYmd, classId, subjectId, teacherId].join("|");
    const sessList = sessionsIndex.get(key) || [];

    // Est-ce qu'on a déjà AU MOINS un appel (peu importe le retard) ?
    let hasCall = false;
    for (const s of sessList) {
      if (s.callMin >= period.startMin && s.callMin <= period.endMin + 120) {
        hasCall = true;
        break;
      }
    }
    // Pour ces alertes, on veut le cas « aucun appel du tout » (à l’instant T)
    if (hasCall) continue;

    const basePayloadCore = {
      status: "missing" as const,
      date: todayYmd,
      period: {
        id: String(tt.period_id),
        label: periodLabel,
        start: startLabel,
        end: endLabel,
      },
      class: { id: classId, label: classLabel || null },
      subject: { id: subjectId || null, name: subjName },
      teacher: { id: teacherId, name: teacherName },
      institution: { id: instId },
      threshold_min: thresholdMin,
      url: "/admin/notes" /* ou une future page dédiée surveillance appels */,
    };

    const sendAfterIso = now.toISOString();

    // 1) Alerte "après 15 minutes, aucun appel n'a ENCORE été fait"
    if (nowMin >= earlyFrom && nowMin < period.endMin) {
      const kind = "admin_attendance_missing_early" as const;
      const title = `Appel non réalisé – ${classLabel || "Classe"} • ${subjName}`;
      const body =
        `Ce ${humanDate} entre ${startLabel} et ${endLabel}, ` +
        `aucun appel n'a encore été enregistré pour la classe ${classLabel || "?"} ` +
        `en ${subjName} (${teacherName}).`;

      for (const adminId of admins) {
        const exKey = `${kind}|${adminId}|${baseAlertKey}`;
        if (existingSet.has(exKey)) continue; // déjà notifié aujourd’hui pour cette alerte
        existingSet.add(exKey);

        inserts.push({
          institution_id: instId,
          profile_id: adminId,
          student_id: null,
          session_id: null,
          mark_id: null,
          parent_id: null,
          channels: ["inapp", "push"],
          channel: null,
          payload: { kind, ...basePayloadCore },
          status: WAIT_STATUS,
          attempts: 0,
          last_error: null,
          title,
          body,
          send_after: sendAfterIso,
          meta: {
            kind,
            alert_key: baseAlertKey,
            date: todayYmd,
            period_id: tt.period_id,
            class_id: classId,
            subject_id: subjectId || null,
            teacher_id: teacherId,
          },
          severity: "normal",
        });
      }
    }

    // 2) Alerte de fin de créneau "aucun appel pendant tout le créneau"
    if (nowMin >= period.endMin) {
      const kind = "admin_attendance_missing_final" as const;
      const title = `Aucun appel effectué – ${classLabel || "Classe"} • ${subjName}`;
      const body =
        `Ce ${humanDate} entre ${startLabel} et ${endLabel}, ` +
        `aucun appel n'a été enregistré pour la classe ${classLabel || "?"} ` +
        `en ${subjName} (${teacherName}) pendant tout ce créneau.`;

      for (const adminId of admins) {
        const exKey = `${kind}|${adminId}|${baseAlertKey}`;
        if (existingSet.has(exKey)) continue; // déjà notifié aujourd’hui pour cette alerte finale
        existingSet.add(exKey);

        inserts.push({
          institution_id: instId,
          profile_id: adminId,
          student_id: null,
          session_id: null,
          mark_id: null,
          parent_id: null,
          channels: ["inapp", "push"],
          channel: null,
          payload: { kind, ...basePayloadCore },
          status: WAIT_STATUS,
          attempts: 0,
          last_error: null,
          title,
          body,
          send_after: sendAfterIso,
          meta: {
            kind,
            alert_key: baseAlertKey,
            date: todayYmd,
            period_id: tt.period_id,
            class_id: classId,
            subject_id: subjectId || null,
            teacher_id: teacherId,
          },
          severity: "normal",
        });
      }
    }
  }

  if (!inserts.length) {
    console.info("[push/dispatch] admin_attendance_alerts_no_new", {
      id,
      nowMin,
      thresholdMin,
    });
    return;
  }

  const { error: insErr, data: insData } = await srv
    .from("notifications_queue")
    .insert(inserts)
    .select("id");

  if (insErr) {
    console.error("[push/dispatch] admin_attendance_alerts_insert_err", {
      id,
      error: insErr.message,
    });
    return;
  }

  console.info("[push/dispatch] admin_attendance_alerts_insert_ok", {
    id,
    count: insData?.length || inserts.length,
  });
}

/* ──────────────── Main ──────────────── */
export const GET = run;
export const POST = run;

async function run(req: Request) {
  const id = rid();
  const t0 = Date.now();
  console.info("[push/dispatch] start", {
    id,
    when: new Date().toISOString(),
    method: req.method,
    waitStatus: WAIT_STATUS,
  });

  if (!okAuth(req)) {
    console.warn("[push/dispatch] forbidden", { id });
    return NextResponse.json({ ok: false, error: "forbidden", id }, { status: 403 });
  }

  try {
    ensureWebPushConfigured();
  } catch (e: any) {
    console.error("[push/dispatch] vapid_config_error", { id, error: String(e?.message || e) });
    return NextResponse.json({ ok: false, error: String(e?.message || e), id }, { status: 500 });
  }

  const srv = getSupabaseServiceClient();

  // ⭐ Avant d'envoyer quoi que ce soit : générer les alertes "appel non réalisé"
  try {
    await enqueueAdminAttendanceMissingAlerts(srv);
  } catch (e: any) {
    console.error("[push/dispatch] admin_attendance_alerts_unhandled", {
      id,
      error: String(e?.message || e),
    });
  }

  // 1) Récupérer les items en attente (+ on prend student_id + meta + profile_id)
  console.info("[push/dispatch] pick_pending_query", { id });
  const { data: raw, error: pickErr } = await srv
    .from("notifications_queue")
    .select(
      "id,parent_id,student_id,profile_id,channels,payload,title,body,status,attempts,created_at,meta",
    )
    .eq("status", WAIT_STATUS)
    .order("created_at", { ascending: true })
    .limit(400);

  if (pickErr) {
    console.error("[push/dispatch] select_error", { id, error: pickErr.message });
    return NextResponse.json(
      { ok: false, error: pickErr.message, stage: "select", id },
      { status: 200 },
    );
  }

  const rows: QueueRow[] = (raw || []).filter(hasPushChannel);
  console.info("[push/dispatch] picked_effective", {
    id,
    total: rows.length,
    sample: rows.slice(0, 3).map((r) => {
      const p = safeParse<any>(r.payload) || {};
      return {
        id: r.id,
        parent: shortId(r.parent_id),
        student: shortId(r.student_id),
        profile: shortId(r.profile_id),
        metaDev: shortId((safeParse<any>(r.meta) || {}).device_id),
        typ: p?.type || p?.kind || p?.event || "notification",
        title: r.title || p?.title || null,
        created_at: r.created_at,
      };
    }),
  });

  if (!rows.length) {
    const ms = Date.now() - t0;
    console.info("[push/dispatch] done_empty", { id, ms });
    return NextResponse.json({
      ok: true,
      id,
      attempted: 0,
      sent_device_sends: 0,
      dropped: 0,
      ms,
    });
  }

  // 2) Résoudre les user_ids (parents + admins) à partir de parent_id | profile_id | meta.device_id | student_guardians | meta.admin_email
  const noParent = rows.filter((r) => !r.parent_id);
  const deviceIds = Array.from(
    new Set(
      noParent
        .map((r) => (safeParse<any>(r.meta) || {}).device_id as string | undefined)
        .filter(Boolean),
    ),
  );
  const studentIds = Array.from(new Set(noParent.map((r) => r.student_id).filter(Boolean))) as string[];

  const deviceToParent = new Map<string, string>(); // device_id -> parent_profile_id
  if (deviceIds.length) {
    const { data: mapDev, error: mapErr } = await srv
      .from("parent_devices")
      .select("device_id,parent_profile_id")
      .in("device_id", deviceIds);
    if (mapErr)
      console.warn("[push/dispatch] parent_devices_err", {
        id,
        error: mapErr.message,
      });
    for (const row of mapDev || []) {
      if (row.device_id && row.parent_profile_id) {
        deviceToParent.set(String(row.device_id), String(row.parent_profile_id));
      }
    }
  }

  const studToParents = new Map<string, string[]>();
  if (studentIds.length) {
    const { data: sgs, error: sgErr } = await srv
      .from("student_guardians")
      .select("student_id,parent_id,notifications_enabled")
      .in("student_id", studentIds);
    if (sgErr)
      console.warn("[push/dispatch] student_guardians_err", { id, error: sgErr.message });
    for (const row of sgs || []) {
      if (row.notifications_enabled === false) continue;
      const st = String((row as any).student_id);
      const pid = String((row as any).parent_id || "");
      if (!pid) continue;
      const arr = studToParents.get(st) || [];
      arr.push(pid);
      studToParents.set(st, Array.from(new Set(arr)));
    }
  }

  // 2-bis) Résolution des admins par email (meta.admin_email / meta.admin_emails)
  const adminEmailsByRow = new Map<string, string[]>(); // queue_id -> [emails normalisés]
  const adminEmailSet = new Set<string>(); // emails global

  for (const r of rows) {
    const meta = safeParse<any>(r.meta) || {};
    let candidates: string[] = [];

    if (typeof meta.admin_email === "string") {
      candidates.push(meta.admin_email);
    }
    if (Array.isArray(meta.admin_emails)) {
      candidates.push(
        ...meta.admin_emails.filter((x: any) => typeof x === "string"),
      );
    } else if (typeof meta.admin_emails === "string") {
      // support "a@b.c;c@d.e" ou "a@b.c,c@d.e"
      candidates.push(
        ...String(meta.admin_emails)
          .split(/[;,]/)
          .map((s: string) => s.trim())
          .filter(Boolean),
      );
    }

    const norm = Array.from(
      new Set(
        candidates
          .map((e) => normalizeEmail(e))
          .filter(Boolean),
      ),
    );

    if (norm.length) {
      adminEmailsByRow.set(r.id, norm);
      norm.forEach((e) => adminEmailSet.add(e));
    }
  }

  const emailToProfileId = new Map<string, string>(); // email normalisé -> profiles.id
  if (adminEmailSet.size) {
    const emailList = Array.from(adminEmailSet);
    const { data: profs, error: profErr } = await srv
      .from("profiles")
      .select("id,email")
      .in("email", emailList);

    if (profErr) {
      console.warn("[push/dispatch] admin_email_profiles_error", {
        id,
        error: profErr.message,
      });
    } else {
      for (const p of profs || []) {
        const em = normalizeEmail((p as any).email);
        if (em) emailToProfileId.set(em, String((p as any).id));
      }
    }

    console.info("[push/dispatch] admin_email_resolved", {
      id,
      distinctEmails: emailList.length,
      resolved: emailToProfileId.size,
    });
  }

  // Pour chaque queue row, liste de user_ids cibles (parents + admins)
  const targetUserIdsByRow = new Map<string, string[]>();
  for (const r of rows) {
    let ids: string[] = [];

    // ⭐ Admin direct via profile_id
    if (r.profile_id) ids.push(String(r.profile_id));

    // Parents : parent_id direct
    if (r.parent_id) ids.push(String(r.parent_id));

    // Parents : via device (pour les parents qui ont un device mappé)
    if (!ids.length) {
      const dev = (safeParse<any>(r.meta) || {}).device_id as string | undefined;
      if (dev && deviceToParent.has(dev)) ids.push(deviceToParent.get(dev)!);
    }

    // Parents : via student_guardians (si aucun parent direct ou device)
    if (!ids.length && r.student_id && studToParents.has(r.student_id)) {
      ids.push(...(studToParents.get(r.student_id) || []));
    }

    // Admins : via meta.admin_email(s)
    const adminEmails = adminEmailsByRow.get(r.id) || [];
    for (const em of adminEmails) {
      const uid = emailToProfileId.get(em);
      if (uid) {
        ids.push(uid);
      } else {
        console.warn("[push/dispatch] admin_email_not_found_profile", {
          id,
          qid: r.id,
          email: em,
        });
      }
    }

    ids = Array.from(new Set(ids.filter(Boolean)));
    targetUserIdsByRow.set(r.id, ids);
  }

  const allUserIds = Array.from(
    new Set(Array.from(targetUserIdsByRow.values()).flatMap((a) => a)),
  );

  // 3) Subscriptions (web + mobile) pour ces user_ids
  console.info("[push/dispatch] subs_fetch", { id, userCount: allUserIds.length });
  const { data: subs, error: subsErr } = allUserIds.length
    ? await srv
        .from("push_subscriptions")
        .select("user_id,platform,device_id,subscription_json,fcm_token")
        .in("user_id", allUserIds)
    : { data: [], error: null as any };

  if (subsErr)
    console.error("[push/dispatch] subs_select_error", {
      id,
      error: subsErr.message,
    });

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of (subs || []) as SubRow[]) {
    let subJson = s.subscription_json as any;
    if (subJson && typeof subJson === "string") {
      try {
        subJson = JSON.parse(subJson);
      } catch {}
    }
    const k = String(s.user_id);
    const arr = subsByUser.get(k) || [];
    arr.push({ ...s, subscription_json: subJson });
    subsByUser.set(k, arr);
  }

  // 4) Envois
  let sentDeviceSends = 0,
    dropped = 0;

  for (const n of rows) {
    const core = safeParse<any>(n.payload) || {};
    const typ = core?.type || core?.kind || core?.event || "notification";
    const title =
      core?.title ||
      n?.title ||
      (typ === "conduct_penalty" || typ === "penalty"
        ? "Sanction"
        : typ === "attendance" || typ === "absent" || typ === "late"
        ? "Absence / Retard"
        : "Notification");
    const fallbackUrl = "/parents";
    const url = core?.url || fallbackUrl;
    const body = core?.body || n?.body || "";

    const targetUsers = targetUserIdsByRow.get(n.id) || [];
    const list: SubRow[] = targetUsers.flatMap((uid) => subsByUser.get(uid) || []);

    console.info("[push/dispatch] item_begin", {
      id,
      qid: n.id,
      targetUserCount: targetUsers.length,
      subs: list.length,
      parent_id: shortId(n.parent_id),
      student: shortId(n.student_id),
      profile: shortId(n.profile_id),
    });

    const payloadStr = JSON.stringify({ title, body, url, data: core });

    let successes = 0;
    let lastError = list.length ? "" : "no_subscriptions";

    if (!list.length) {
      console.warn("[push/dispatch] no_resolved_subscriptions", {
        id,
        qid: n.id,
        parent_id: n.parent_id,
        student_id: n.student_id,
        profile_id: n.profile_id,
        metaDev: shortId((safeParse<any>(n.meta) || {}).device_id),
      });
    }

    for (const s of list) {
      const platform = (s.platform || "").toLowerCase();
      const endpoint = s.subscription_json?.endpoint || s.device_id || s.fcm_token;
      const endpointShort = shortId(endpoint, 20);

      // WEB via WebPush
      if (s.subscription_json && platform === "web") {
        try {
          const res: any = await webpush.sendNotification(
            s.subscription_json,
            payloadStr,
          );
          console.info("[push/dispatch] web_send_ok", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
            endpoint: endpointShort,
            statusCode: res?.statusCode ?? null,
          });
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || err);
          lastError = msg;
          console.warn("[push/dispatch] web_send_fail", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
            endpoint: endpointShort,
            error: msg.slice(0, 500),
          });
          if (/(410|404|not a valid|unsubscribe|expired|Gone)/i.test(msg)) {
            dropped++;
            let q = srv
              .from("push_subscriptions")
              .delete()
              .eq("user_id", s.user_id)
              .eq("platform", s.platform || "");
            if (s.device_id) q = q.eq("device_id", s.device_id);
            const { error: delErr } = await q;
            if (delErr) {
              console.warn("[push/dispatch] sub_delete_fail", {
                id,
                qid: n.id,
                endpoint: endpointShort,
                error: delErr.message,
              });
            } else {
              console.info("[push/dispatch] sub_deleted", {
                id,
                qid: n.id,
                endpoint: endpointShort,
              });
            }
          }
        }
        continue;
      }

      // MOBILE via FCM
      if (s.fcm_token) {
        try {
          await sendFCM(s.fcm_token, title, body, url, core);
          console.info("[push/dispatch] fcm_send_ok", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
            token: shortId(s.fcm_token, 20),
          });
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || err);
          lastError = msg;
          console.warn("[push/dispatch] fcm_fail", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
            error: msg.slice(0, 500),
          });
          if (/(NotRegistered|InvalidRegistration|410|404)/i.test(msg)) {
            dropped++;
            let q = srv.from("push_subscriptions").delete().eq("user_id", s.user_id);
            if (s.device_id) q = q.eq("device_id", s.device_id);
            const { error: delErr } = await q;
            if (delErr) {
              console.warn("[push/dispatch] sub_delete_fail", {
                id,
                qid: n.id,
                error: delErr.message,
              });
            } else {
              console.info("[push/dispatch] sub_deleted", {
                id,
                qid: n.id,
                token: shortId(s.fcm_token, 20),
              });
            }
          }
        }
        continue;
      }

      console.debug("[push/dispatch] skip_sub_unknown_channel", {
        id,
        qid: n.id,
        platform,
        hasWebSub: !!s.subscription_json,
        hasFcm: !!s.fcm_token,
      });
    }

    const attempts = (Number(n.attempts) || 0) + 1;

    if (successes > 0) {
      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts,
          last_error: null,
        })
        .eq("id", n.id);
      if (updErr) {
        console.error("[push/dispatch] queue_update_sent_fail", {
          id,
          qid: n.id,
          error: updErr.message,
        });
      } else {
        console.info("[push/dispatch] queue_update_sent_ok", {
          id,
          qid: n.id,
          attempts,
          successes,
        });
      }
    } else {
      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({
          status: WAIT_STATUS,
          attempts,
          last_error: (lastError || "").slice(0, 300),
        })
        .eq("id", n.id);
      if (updErr) {
        console.error("[push/dispatch] queue_update_retry_fail", {
          id,
          qid: n.id,
          attempts,
          error: updErr.message,
        });
      } else {
        console.warn("[push/dispatch] queue_update_retry_ok", {
          id,
          qid: n.id,
          attempts,
          lastError: (lastError || "").slice(0, 200),
        });
      }
    }
  }

  const ms = Date.now() - t0;
  console.info("[push/dispatch] done", {
    id,
    attempted: rows.length,
    sent_device_sends: sentDeviceSends,
    dropped,
    ms,
  });
  return NextResponse.json({
    ok: true,
    id,
    attempted: rows.length,
    sent_device_sends: sentDeviceSends,
    dropped,
    ms,
  });
}
