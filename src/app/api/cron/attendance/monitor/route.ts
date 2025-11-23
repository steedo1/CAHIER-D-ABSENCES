// src/app/api/cron/attendance/monitor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function okAuth(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");
  const allowed =
    fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
  console.info("[attendance/monitor] auth", {
    fromVercelCron,
    xCronPresent: !!xCron,
    bearerPresent: !!bearer,
    secretPresent: !!secret,
    allowed,
  });
  return allowed;
}

/* ───────── helpers time ───────── */

const LATE_THRESHOLD_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN)))
    : 15;

const END_GRACE_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_END_GRACE_MIN))
    ? Math.max(0, Math.floor(Number(process.env.ATTENDANCE_END_GRACE_MIN)))
    : 5;

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

/** retourne "YYYY-MM-DD" (UTC ~= Abidjan) */
function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** "YYYY-MM-DDTHH:MM:SSZ" -> "HH:MM" */
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

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

export const GET = run;
export const POST = run;

async function run(req: NextRequest) {
  const id = rid();
  const t0 = Date.now();
  console.info("[attendance/monitor] start", {
    id,
    when: new Date().toISOString(),
  });

  if (!okAuth(req)) {
    console.warn("[attendance/monitor] forbidden", { id });
    return NextResponse.json({ ok: false, error: "forbidden", id }, { status: 403 });
  }

  const srv = getSupabaseServiceClient();

  // Référence : maintenant (UTC ~= Abidjan)
  const now = new Date();
  const todayYMD = toYMD(now);
  const weekday = now.getUTCDay(); // 0=dimanche..6=samedi
  const nowHM = isoToHM(now.toISOString());
  const nowMin = hmToMin(nowHM);

  // On ne regarde que les séances du jour (par précaution on limite les sessions chargées)
  const sinceSessions = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // 1) données brutes
  const [
    { data: institutions, error: instErr },
    { data: periods, error: pErr },
    { data: timetables, error: ttErr },
    { data: sessions, error: sessErr },
    { data: admins, error: admErr },
    { data: classes, error: cErr },
    { data: subjects, error: sErr },
    { data: teachers, error: tErr },
    { data: existing, error: evErr },
  ] = await Promise.all([
    srv.from("institutions").select("id"),
    srv
      .from("institution_periods")
      .select("id,institution_id,weekday,label,start_time,end_time"),
    srv
      .from("teacher_timetables")
      .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id"),
    srv
      .from("teacher_sessions")
      .select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at")
      .gte("started_at", sinceSessions),
    srv
      .from("user_roles")
      .select("profile_id,institution_id,role")
      .in("role", ["admin", "super_admin"]),
    srv.from("classes").select("id,label,institution_id"),
    srv
      .from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(name),institution_id"),
    srv.from("profiles").select("id,display_name,institution_id"),
    srv
      .from("attendance_monitor_events")
      .select("institution_id,class_id,subject_id,teacher_id,period_id,slot_date,level")
      .eq("slot_date", todayYMD),
  ]);

  if (instErr) return NextResponse.json({ ok: false, error: instErr.message }, { status: 500 });
  if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
  if (ttErr) return NextResponse.json({ ok: false, error: ttErr.message }, { status: 500 });
  if (sessErr) return NextResponse.json({ ok: false, error: sessErr.message }, { status: 500 });
  if (admErr) return NextResponse.json({ ok: false, error: admErr.message }, { status: 500 });
  if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
  if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 });
  if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });

  // Index existants
  type PeriodRow = {
    id: string;
    institution_id: string;
    weekday: number;
    label: string | null;
    startNorm: string | null;
    endNorm: string | null;
    startMin: number;
    endMin: number;
  };

  const periodsById = new Map<string, PeriodRow>();
  (periods || []).forEach((p: any) => {
    const startNorm = normalizeTimeFromDb(p.start_time);
    const endNorm = normalizeTimeFromDb(p.end_time);
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    periodsById.set(String(p.id), {
      id: String(p.id),
      institution_id: String(p.institution_id),
      weekday: typeof p.weekday === "number" ? p.weekday : 0,
      label: (p.label as string | null) ?? null,
      startNorm,
      endNorm,
      startMin,
      endMin,
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
    const name = disp.trim() || "Enseignant";
    teacherNameById.set(id, name);
  });

  // Admins par institution
  const adminsByInst = new Map<string, string[]>();
  (admins || []).forEach((a: any) => {
    const instId = String(a.institution_id);
    const pid = String(a.profile_id);
    const arr = adminsByInst.get(instId) || [];
    if (!arr.includes(pid)) arr.push(pid);
    adminsByInst.set(instId, arr);
  });

  // Séances indexées par (inst|date|class|subject|teacher)
  type SessIndexItem = { callMin: number };
  const sessionsIndex = new Map<string, SessIndexItem[]>();

  (sessions || []).forEach((s: any) => {
    const callIso = (s.actual_call_at as string | null) || (s.started_at as string | null);
    if (!callIso) return;
    const ymd = toYMD(new Date(callIso));
    if (ymd !== todayYMD) return; // on ne regarde que aujourd’hui pour les notifs
    const hm = isoToHM(callIso);
    const callMin = hmToMin(hm);
    const key = [
      String(s.institution_id),
      ymd,
      String(s.class_id || ""),
      String(s.subject_id || ""),
      String(s.teacher_id || ""),
    ].join("|");
    const arr = sessionsIndex.get(key) || [];
    arr.push({ callMin });
    sessionsIndex.set(key, arr);
  });

  // événements déjà envoyés (pour ne pas dupliquer)
  const sentKey = new Set<string>();
  (existing || []).forEach((e: any) => {
    const k = [
      String(e.institution_id),
      String(e.class_id),
      String(e.subject_id || ""),
      String(e.teacher_id),
      String(e.period_id),
      String(e.slot_date),
      String(e.level),
    ].join("|");
    sentKey.add(k);
  });

  const eventsToInsert: any[] = [];
  const queueToInsert: any[] = [];

  (institutions || []).forEach((inst: any) => {
    const instId = String(inst.id);
    const instAdmins = adminsByInst.get(instId) || [];
    if (!instAdmins.length) return; // pas d’admin => pas de notif

    const instTimetables = (timetables || []).filter(
      (tt: any) =>
        String(tt.institution_id) === instId &&
        typeof tt.weekday === "number" &&
        tt.weekday === weekday
    );
    if (!instTimetables.length) return;

    const instPeriods = (periods || []).filter(
      (p: any) =>
        String(p.institution_id) === instId &&
        typeof p.weekday === "number" &&
        p.weekday === weekday
    );
    if (!instPeriods.length) return;

    const instPeriodById = new Map<string, PeriodRow>();
    instPeriods.forEach((p: any) => {
      const pp = periodsById.get(String(p.id));
      if (pp) instPeriodById.set(pp.id, pp);
    });

    for (const tt of instTimetables) {
      const period = instPeriodById.get(String(tt.period_id));
      if (!period || !period.startNorm || !period.endNorm) continue;

      const startMin = period.startMin;
      const endMin = period.endMin;
      const lateFrom = startMin + LATE_THRESHOLD_MIN;
      const endWithGrace = endMin + END_GRACE_MIN;

      const classId = String(tt.class_id);
      const subjectId = String(tt.subject_id || "");
      const teacherId = String(tt.teacher_id);

      // clé pour les sessions
      const sessKey = [instId, todayYMD, classId, subjectId, teacherId].join("|");
      const sessList = sessionsIndex.get(sessKey) || [];

      let hasSession = false;
      for (const s of sessList) {
        if (s.callMin >= startMin && s.callMin <= endMin + 120) {
          hasSession = true;
          break;
        }
      }

      // cas 1 : notif "late" (appel en retard, mais cours pas fini)
      if (!hasSession && nowMin >= lateFrom && nowMin < endWithGrace) {
        const kLate = [
          instId,
          classId,
          subjectId,
          teacherId,
          String(tt.period_id),
          todayYMD,
          "late",
        ].join("|");
        if (!sentKey.has(kLate)) {
          sentKey.add(kLate);
          eventsToInsert.push({
            institution_id: instId,
            class_id: classId,
            subject_id: subjectId || null,
            teacher_id: teacherId,
            period_id: String(tt.period_id),
            slot_date: todayYMD,
            level: "late",
          });

          const classLabel = classLabelById.get(classId) || "Classe";
          const subjName = subjectNameById.get(subjectId) || "discipline";
          const teacherName = teacherNameById.get(teacherId) || "l’enseignant";

          const title = `Appel en retard — ${classLabel}`;
          const body = [
            `${teacherName} n’a pas encore fait l’appel`,
            `en ${subjName}`,
            `(${classLabel})`,
            `pour le créneau ${period.startNorm}–${period.endNorm}.`,
          ].join(" ");

          const corePayload = {
            kind: "attendance_monitor",
            level: "late",
            class: { id: classId, label: classLabel },
            subject: { id: subjectId || null, name: subjName },
            teacher: { id: teacherId, name: teacherName },
            period: {
              id: String(tt.period_id),
              label: period.label,
              start: period.startNorm,
              end: period.endNorm,
            },
            slot_date: todayYMD,
          };

          for (const adminProfileId of instAdmins) {
            queueToInsert.push({
              parent_id: adminProfileId, // on réutilise le champ pour tout user
              student_id: null,
              channels: ["push"],
              payload: corePayload,
              title,
              body,
              status: WAIT_STATUS,
              meta: null,
            });
          }
        }
      }

      // cas 2 : notif "missing" (appel jamais fait après fin de cours)
      if (!hasSession && nowMin >= endWithGrace) {
        const kMiss = [
          instId,
          classId,
          subjectId,
          teacherId,
          String(tt.period_id),
          todayYMD,
          "missing",
        ].join("|");
        if (!sentKey.has(kMiss)) {
          sentKey.add(kMiss);
          eventsToInsert.push({
            institution_id: instId,
            class_id: classId,
            subject_id: subjectId || null,
            teacher_id: teacherId,
            period_id: String(tt.period_id),
            slot_date: todayYMD,
            level: "missing",
          });

          const classLabel = classLabelById.get(classId) || "Classe";
          const subjName = subjectNameById.get(subjectId) || "discipline";
          const teacherName = teacherNameById.get(teacherId) || "l’enseignant";

          const title = `Appel non effectué — ${classLabel}`;
          const body = [
            `Sur le créneau ${period.startNorm}–${period.endNorm} (${todayYMD}),`,
            `aucun appel n’a été enregistré`,
            `en ${subjName} pour la classe ${classLabel}`,
            `par ${teacherName}.`,
          ].join(" ");

          const corePayload = {
            kind: "attendance_monitor",
            level: "missing",
            class: { id: classId, label: classLabel },
            subject: { id: subjectId || null, name: subjName },
            teacher: { id: teacherId, name: teacherName },
            period: {
              id: String(tt.period_id),
              label: period.label,
              start: period.startNorm,
              end: period.endNorm,
            },
            slot_date: todayYMD,
          };

          for (const adminProfileId of instAdmins) {
            queueToInsert.push({
              parent_id: adminProfileId,
              student_id: null,
              channels: ["push"],
              payload: corePayload,
              title,
              body,
              status: WAIT_STATUS,
              meta: null,
            });
          }
        }
      }
    }
  });

  // Insertion en base
  let insertedEvents = 0;
  let insertedQueue = 0;

  if (eventsToInsert.length) {
    const { error: evInsErr, count } = await srv
      .from("attendance_monitor_events")
      .insert(eventsToInsert, { count: "exact" });
    if (evInsErr) {
      console.error("[attendance/monitor] events_insert_error", {
        id,
        error: evInsErr.message,
      });
    } else {
      insertedEvents = count || eventsToInsert.length;
    }
  }

  if (queueToInsert.length) {
    const { error: qInsErr, count } = await srv
      .from("notifications_queue")
      .insert(queueToInsert, { count: "exact" });
    if (qInsErr) {
      console.error("[attendance/monitor] queue_insert_error", {
        id,
        error: qInsErr.message,
      });
    } else {
      insertedQueue = count || queueToInsert.length;
    }
  }

  const ms = Date.now() - t0;
  console.info("[attendance/monitor] done", {
    id,
    insertedEvents,
    insertedQueue,
    ms,
  });

  return NextResponse.json({
    ok: true,
    id,
    insertedEvents,
    insertedQueue,
    ms,
  });
}
