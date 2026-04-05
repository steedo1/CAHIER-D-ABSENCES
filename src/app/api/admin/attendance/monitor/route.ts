import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MonitorStatus =
  | "missing"
  | "late"
  | "ok"
  | "pending_absence"
  | "justified_absence";

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

  absence_request_status?: "pending" | "approved" | "rejected" | "cancelled" | null;
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
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

function parseWeekday(raw: any): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw ?? ""), 10);
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

/* Seuil en minutes au-delà duquel on considère l’appel « en retard » */
const LATE_THRESHOLD_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN)))
    : 15;

/* Fenêtre avant de considérer un appel comme « manquant ». */
const MISSING_CONTROL_WINDOW_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_MISSING_CONTROL_WINDOW_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_MISSING_CONTROL_WINDOW_MIN)))
    : LATE_THRESHOLD_MIN;

const MAX_CARRY_AFTER_END_MIN = 120;

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const debug = url.searchParams.get("debug") === "1";

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
      { status: 400 }
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
      { status: 403 }
    );
  }

  const now = new Date();
  const todayYmd = toYMD(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const defaultTo = parseYMD(toParam) ?? new Date(now);
  const defaultFrom = parseYMD(fromParam) ?? new Date(now);
  if (!fromParam && !toParam) {
    defaultFrom.setUTCDate(defaultTo.getUTCDate() - 7);
  }

  let fromDate = defaultFrom;
  let toDate = defaultTo;
  if (toDate.getTime() < fromDate.getTime()) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  const dates: { ymd: string; weekdayJs: number }[] = [];
  const cursor = new Date(fromDate.getTime());
  while (cursor.getTime() <= toDate.getTime()) {
    dates.push({
      ymd: toYMD(cursor),
      weekdayJs: cursor.getUTCDay(),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const [
    { data: periods, error: pErr },
    { data: tts, error: ttErr },
    { data: classes, error: cErr },
    { data: subjects, error: sErr },
    { data: teachers, error: tErr },
    { data: teacherSubjects, error: tsErr },
  ] = await Promise.all([
    srv
      .from("institution_periods")
      .select("id,institution_id,weekday,label,start_time,end_time")
      .eq("institution_id", institution_id),
    srv
      .from("teacher_timetables")
      .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
      .eq("institution_id", institution_id),
    srv.from("classes").select("id,label").eq("institution_id", institution_id),
    srv
      .from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(id,name)")
      .eq("institution_id", institution_id),
    srv
      .from("profiles")
      .select("id,display_name,email,phone")
      .eq("institution_id", institution_id),
    srv
      .from("teacher_subjects")
      .select("profile_id,subject_id,institution_id")
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
  if (tsErr) {
    console.error("[attendance/monitor] teacher_subjects_err", { error: tsErr.message });
  }

  const dateMinIso = new Date(fromDate.getTime());
  dateMinIso.setUTCHours(0, 0, 0, 0);
  const dateMaxIso = new Date(toDate.getTime());
  dateMaxIso.setUTCDate(dateMaxIso.getUTCDate() + 1);
  dateMaxIso.setUTCHours(0, 0, 0, 0);

  const [
    { data: sessions, error: sessErr },
    { data: absenceRequests, error: absErr },
  ] = await Promise.all([
    srv
      .from("teacher_sessions")
      .select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,origin")
      .eq("institution_id", institution_id)
      .gte("started_at", dateMinIso.toISOString())
      .lt("started_at", dateMaxIso.toISOString()),
    srv
      .from("teacher_absence_requests")
      .select(
        "id,institution_id,teacher_profile_id,start_date,end_date,reason_label,status,admin_comment"
      )
      .eq("institution_id", institution_id)
      .in("status", ["pending", "approved"])
      .lte("start_date", toYMD(toDate))
      .gte("end_date", toYMD(fromDate)),
  ]);

  if (sessErr) {
    console.error("[attendance/monitor] sessions_err", { error: sessErr.message });
    return NextResponse.json({ error: sessErr.message }, { status: 400 });
  }
  if (absErr) {
    console.error("[attendance/monitor] absence_requests_err", { error: absErr.message });
    return NextResponse.json({ error: absErr.message }, { status: 400 });
  }

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
      weekday: parseWeekday(p.weekday) ?? 0,
      label: (p.label as string | null) ?? null,
      start_time: startNorm,
      end_time: endNorm,
      startMin,
      endMin,
      institution_id: String(p.institution_id),
    });
  });

  const weekdayMode = detectWeekdayMode(periods || []);

  const datesByWeekday = new Map<number, string[]>();
  for (const d of dates) {
    const wdDb = jsDayToDbWeekday(d.weekdayJs, weekdayMode);
    const arr = datesByWeekday.get(wdDb) || [];
    arr.push(d.ymd);
    datesByWeekday.set(wdDb, arr);
  }

  const classLabelById = new Map<string, string>();
  (classes || []).forEach((c: any) => {
    classLabelById.set(String(c.id), String(c.label || ""));
  });

  const subjectNameById = new Map<string, string>();
  const instSubjectIdsByBaseId = new Map<string, string[]>();

  (subjects || []).forEach((row: any) => {
    const instId = String(row.id);
    const cname = (row.custom_name as string | null) || "";

    let baseName = "";
    let baseId: string | null = null;

    if (Array.isArray(row.subjects)) {
      const first = row.subjects[0] || {};
      baseName = first.name || "";
      if (first.id) baseId = String(first.id);
    } else if (row.subjects && typeof row.subjects === "object") {
      const sObj: any = row.subjects;
      baseName = sObj.name || "";
      if (sObj.id) baseId = String(sObj.id);
    }

    const name = (cname || baseName || "").trim() || "Discipline";
    subjectNameById.set(instId, name);

    if (baseId) {
      const arr = instSubjectIdsByBaseId.get(baseId) || [];
      arr.push(instId);
      instSubjectIdsByBaseId.set(baseId, arr);
    }
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

  const teacherHasSubjects = new Set<string>();
  const allowedByTeacher = new Map<string, Set<string>>();

  (teacherSubjects || []).forEach((ts: any) => {
    const teacherId = String(ts.profile_id);
    const rawSubjId = ts.subject_id ? String(ts.subject_id) : "";
    if (!rawSubjId) return;

    teacherHasSubjects.add(teacherId);

    let instIds: string[] = [];
    if (subjectNameById.has(rawSubjId)) {
      instIds = [rawSubjId];
    } else {
      instIds = instSubjectIdsByBaseId.get(rawSubjId) || [];
    }

    if (!instIds.length) return;

    let set = allowedByTeacher.get(teacherId);
    if (!set) {
      set = new Set<string>();
      allowedByTeacher.set(teacherId, set);
    }
    instIds.forEach((id) => set!.add(id));
  });

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
        s.origin === "class_device"
          ? "class_device"
          : s.origin === "teacher"
          ? "teacher"
          : null,
    });
    sessionsIndex.set(key, arr);
  });

  type AbsenceInfo = {
    status: "pending" | "approved";
    reason_label: string | null;
    admin_comment: string | null;
  };

  const absenceIndex = new Map<string, AbsenceInfo>();

  (absenceRequests || []).forEach((r: any) => {
    const teacherId = String(r.teacher_profile_id || "");
    const start = String(r.start_date || "");
    const end = String(r.end_date || "");
    const status = String(r.status || "") as "pending" | "approved";
    if (!teacherId || !start || !end || !status) return;

    let c = parseYMD(start);
    const e = parseYMD(end);
    if (!c || !e) return;

    while (c.getTime() <= e.getTime()) {
      const ymd = toYMD(c);
      const key = `${ymd}|${teacherId}`;
      const existing = absenceIndex.get(key);

      const nextInfo: AbsenceInfo = {
        status,
        reason_label: (r.reason_label as string | null) ?? null,
        admin_comment: (r.admin_comment as string | null) ?? null,
      };

      // priorité approved > pending
      if (!existing) {
        absenceIndex.set(key, nextInfo);
      } else if (existing.status !== "approved" && status === "approved") {
        absenceIndex.set(key, nextInfo);
      }

      c.setUTCDate(c.getUTCDate() + 1);
    }
  });

  type SlotLite = { period_id: string; startMin: number };
  const nextStartMinBySlot = new Map<string, number | null>();
  const slotsByGroup = new Map<string, Map<string, SlotLite>>();

  (tts || []).forEach((tt: any) => {
    const period = periodById.get(String(tt.period_id));
    if (!period) return;

    const weekday = period.weekday;
    const classId = String(tt.class_id);
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id);
    const periodId = String(tt.period_id);

    const group = `${weekday}|${classId}|${subjectId}|${teacherId}`;

    let m = slotsByGroup.get(group);
    if (!m) {
      m = new Map<string, SlotLite>();
      slotsByGroup.set(group, m);
    }
    if (!m.has(periodId)) {
      m.set(periodId, { period_id: periodId, startMin: period.startMin });
    }
  });

  for (const [group, m] of slotsByGroup.entries()) {
    const arr = Array.from(m.values()).sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      const next = arr[i + 1] || null;
      nextStartMinBySlot.set(`${group}|${cur.period_id}`, next ? next.startMin : null);
    }
  }

  const rows: MonitorRow[] = [];

  (tts || []).forEach((tt: any) => {
    const period = periodById.get(String(tt.period_id));
    if (!period) return;

    const weekday = period.weekday;
    const datesForDay = datesByWeekday.get(weekday);
    if (!datesForDay || !datesForDay.length) return;

    const startMin = period.startMin;
    const endMin = period.endMin;

    const classId = String(tt.class_id);
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id);

    if (subjectId && teacherHasSubjects.has(teacherId)) {
      const allowed = allowedByTeacher.get(teacherId);

      if (allowed && allowed.size > 0) {
        let ok = allowed.has(subjectId);

        if (!ok) {
          const mappedInst = instSubjectIdsByBaseId.get(subjectId) || [];
          ok = mappedInst.some((instId) => allowed.has(instId));
        }

        if (!ok) {
          return;
        }
      }
    }

    const classLabel = classLabelById.get(classId) || "";

    let subjName = subjectNameById.get(subjectId) || "";
    if (!subjName) {
      const mappedInst = instSubjectIdsByBaseId.get(subjectId) || [];
      if (mappedInst.length) {
        subjName = subjectNameById.get(mappedInst[0]) || "";
      }
    }
    subjName = subjName.trim() || "Discipline";

    const teacherName = teacherNameById.get(teacherId) || "Enseignant";

    for (const ymd of datesForDay) {
      const key = [ymd, classId, subjectId, teacherId].join("|");
      const sessList = sessionsIndex.get(key) || [];

      let best: SessIndexItem | null = null;

      const group = `${weekday}|${classId}|${subjectId}|${teacherId}`;
      const nextStartMin =
        nextStartMinBySlot.get(`${group}|${String(tt.period_id)}`) ?? null;

      for (const s of sessList) {
        if (s.callMin < startMin) continue;
        if (s.callMin > endMin + MAX_CARRY_AFTER_END_MIN) continue;
        if (nextStartMin !== null && s.callMin >= nextStartMin) continue;
        if (!best || s.callMin < best.callMin) best = s;
      }

      let status: MonitorStatus;
      let lateMinutes: number | null = null;
      let opened_from: "teacher" | "class_device" | null = null;

      let absence_request_status: "pending" | "approved" | "rejected" | "cancelled" | null =
        null;
      let absence_reason_label: string | null = null;
      let absence_admin_comment: string | null = null;

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
        const isBeforeToday = ymd < todayYmd;
        const isToday = ymd === todayYmd;
        const controlLimitMin = startMin + MISSING_CONTROL_WINDOW_MIN;

        if (isBeforeToday) {
          status = "missing";
        } else if (isToday) {
          if (nowMinutes >= controlLimitMin) {
            status = "missing";
          } else {
            continue;
          }
        } else {
          continue;
        }

        // 🔥 si c'était missing, on vérifie s'il existe une demande d'absence
        const absence = absenceIndex.get(`${ymd}|${teacherId}`);
        if (absence) {
          absence_request_status = absence.status;
          absence_reason_label = absence.reason_label;
          absence_admin_comment = absence.admin_comment;

          if (absence.status === "approved") {
            status = "justified_absence";
          } else if (absence.status === "pending") {
            status = "pending_absence";
          }
        }
      }

      const periodLabel =
        period.label ||
        [
          normalizeTimeFromDb(period.start_time) || "",
          normalizeTimeFromDb(period.end_time) || "",
        ]
          .filter(Boolean)
          .join(" – ");

      rows.push({
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
        absence_request_status,
        absence_reason_label,
        absence_admin_comment,
      });
    }
  });

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const sa = (a.planned_start || "00:00") as string;
    const sb = (b.planned_start || "00:00") as string;
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ca = (a.class_label || "") as string;
    const cb = (b.class_label || "") as string;
    return ca.localeCompare(cb);
  });

  if (debug) {
    const distinctNums = (arr: any[], key: string) =>
      Array.from(
        new Set(
          (arr || [])
            .map((x) => x?.[key])
            .filter((v) => v !== null && v !== undefined)
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n))
        )
      ).sort((a, b) => a - b);

    return NextResponse.json({
      rows,
      debug: {
        todayYmd,
        nowUtcHHMM: `${String(now.getUTCHours()).padStart(2, "0")}:${String(
          now.getUTCMinutes()
        ).padStart(2, "0")}`,
        nowMinutes,
        range: { from: toYMD(fromDate), to: toYMD(toDate), days: dates.length },
        counts: {
          periods: (periods || []).length,
          tts: (tts || []).length,
          sessions: (sessions || []).length,
          teacherSubjects: (teacherSubjects || []).length,
          absenceRequests: (absenceRequests || []).length,
          rows: rows.length,
        },
        weekdayMode,
        weekdays: {
          periodWeekdaysDistinct: distinctNums(periods || [], "weekday"),
          ttWeekdaysDistinct: distinctNums(tts || [], "weekday"),
          datesByWeekdayKeys: Array.from(datesByWeekday.keys()).sort((a, b) => a - b),
        },
      },
    });
  }

  return NextResponse.json({ rows });
}