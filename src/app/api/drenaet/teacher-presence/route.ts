// src/app/api/drenaet/teacher-presence/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dayRangeFromSearchParams, guardDrenaetScope } from "../_helpers/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WeekdayMode = "iso" | "js" | "mon0";

type PeriodRow = {
  id: string;
  institution_id: string;
  weekday: number | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  startMin: number;
  endMin: number;
};

type TimetableRow = {
  id: string;
  institution_id: string;
  class_id: string | null;
  subject_id: string | null;
  teacher_id: string | null;
  weekday: number | null;
  period_id: string | null;
};

type SessionRow = {
  id: string;
  institution_id: string;
  class_id: string | null;
  subject_id: string | null;
  teacher_id: string | null;
  period_id?: string | null;
  started_at: string | null;
  actual_call_at: string | null;
  ended_at: string | null;
  origin: string | null;
};

type MatchableSession = SessionRow & {
  ymd: string;
  startedMin: number;
};

type InstitutionStats = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  scheduled: number;
  opened: number;
  held: number;
  not_held: number;
  incomplete: number;
  teachers: Set<string>;
};

type DailyStats = {
  date: string;
  scheduled: number;
  opened: number;
  held: number;
  not_held: number;
  incomplete: number;
};

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function parseYMD(ymd: string | null | undefined): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function toYMD(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToYMD(iso: string) {
  return toYMD(new Date(iso));
}

function isoToMinutes(iso: string) {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function normalizeTimeFromDb(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function hmsToMin(raw: string | null | undefined) {
  const hm = normalizeTimeFromDb(raw) || "00:00";
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function parseWeekday(raw: any): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function detectWeekdayMode(rows: any[]): WeekdayMode {
  const values = Array.from(
    new Set(
      (rows || [])
        .map((row) => parseWeekday(row?.weekday))
        .filter((value): value is number => value !== null && value !== undefined)
    )
  );

  if (values.includes(7)) return "iso";

  const max = values.length ? Math.max(...values) : 6;
  if (max === 5) return "mon0";
  if (values.includes(0) && max === 6) return "js";
  return "iso";
}

function jsDayToDbWeekday(jsDay0to6: number, mode: WeekdayMode) {
  if (mode === "js") return jsDay0to6;
  if (mode === "iso") return jsDay0to6 === 0 ? 7 : jsDay0to6;
  return (jsDay0to6 + 6) % 7;
}

function listDates(fromYmd: string, toYmd: string) {
  const from = parseYMD(fromYmd) || new Date();
  const to = parseYMD(toYmd) || from;
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;
  const rows: { ymd: string; weekdayJs: number }[] = [];
  const cursor = new Date(start.getTime());

  while (cursor.getTime() <= end.getTime()) {
    rows.push({ ymd: toYMD(cursor), weekdayJs: cursor.getUTCDay() });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return rows;
}

function emptyDaily(date: string): DailyStats {
  return { date, scheduled: 0, opened: 0, held: 0, not_held: 0, incomplete: 0 };
}

function getOperationalStatus(stats: Omit<InstitutionStats, "teachers">) {
  if (stats.scheduled <= 0) return "no_schedule";
  if (stats.opened <= 0) return "silent";
  const rate = pct(stats.held, stats.scheduled);
  if (rate < 50) return "critical";
  if (rate < 80) return "watch";
  return "stable";
}

function indexPush(map: Map<string, MatchableSession[]>, key: string, session: MatchableSession) {
  const arr = map.get(key) || [];
  arr.push(session);
  map.set(key, arr);
}

function sortCandidates(candidates: MatchableSession[], startMin: number) {
  return candidates
    .filter((candidate) => candidate.started_at)
    .sort((a, b) => Math.abs(a.startedMin - startMin) - Math.abs(b.startedMin - startMin));
}

async function fetchTeacherSessions(
  srv: any,
  institutionIds: string[],
  fromISO: string,
  toISO: string
): Promise<{ data?: SessionRow[]; error?: string }> {
  const baseSelect =
    "id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,ended_at,origin";

  const withPeriod = await srv
    .from("teacher_sessions")
    .select(`${baseSelect},period_id`)
    .in("institution_id", institutionIds)
    .gte("started_at", fromISO)
    .lt("started_at", toISO)
    .range(0, 80000);

  if (!withPeriod.error) return { data: (withPeriod.data || []) as SessionRow[] };

  const message = String(withPeriod.error?.message || "");
  const periodColumnMissing =
    message.toLowerCase().includes("period_id") ||
    message.toLowerCase().includes("could not find") ||
    message.toLowerCase().includes("column");

  if (!periodColumnMissing) return { error: message };

  const fallback = await srv
    .from("teacher_sessions")
    .select(baseSelect)
    .in("institution_id", institutionIds)
    .gte("started_at", fromISO)
    .lt("started_at", toISO)
    .range(0, 80000);

  if (fallback.error) return { error: fallback.error.message };
  return { data: (fallback.data || []) as SessionRow[] };
}

export async function GET(req: NextRequest) {
  const g = await guardDrenaetScope();
  if ("error" in g) return g.error;

  if (!g.canViewTeacherPresence && !g.isSuper) {
    return NextResponse.json({ error: "forbidden_teacher_presence" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = dayRangeFromSearchParams(searchParams);
  const institutionIds = g.institutionIds;

  if (!institutionIds.length) {
    return NextResponse.json({
      ok: true,
      range,
      definitions: {
        scheduled: "Cours prévus selon les emplois du temps officiels.",
        held: "Séances démarrées puis terminées dans Mon Cahier.",
        not_held: "Cours prévus mais jamais ouverts par l’enseignant.",
        incomplete: "Séances ouvertes mais non terminées.",
      },
      totals: {
        scheduled: 0,
        opened: 0,
        held: 0,
        not_held: 0,
        incomplete: 0,
        teachers_seen: 0,
        held_rate: 0,
        opening_rate: 0,
        sessions: 0,
        confirmed: 0,
        missing: 0,
        coverage_rate: 0,
        closed: 0,
        close_rate: 0,
      },
      daily: [],
      alerts: [],
      items: [],
    });
  }

  const [periodsRes, ttsRes, sessionsRes] = await Promise.all([
    g.srv
      .from("institution_periods")
      .select("id,institution_id,weekday,label,start_time,end_time")
      .in("institution_id", institutionIds)
      .range(0, 80000),
    g.srv
      .from("teacher_timetables")
      .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
      .in("institution_id", institutionIds)
      .range(0, 80000),
    fetchTeacherSessions(g.srv, institutionIds, range.fromISO, range.toISO),
  ]);

  if (periodsRes.error) return NextResponse.json({ error: periodsRes.error.message }, { status: 400 });
  if (ttsRes.error) return NextResponse.json({ error: ttsRes.error.message }, { status: 400 });
  if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error }, { status: 400 });

  const rawPeriods = (periodsRes.data || []) as any[];
  const rawTimetables = (ttsRes.data || []) as any[];
  const rawSessions = (sessionsRes.data || []) as SessionRow[];

  const periodById = new Map<string, PeriodRow>();
  for (const row of rawPeriods) {
    const id = String(row.id || "");
    if (!id) continue;
    const startMin = hmsToMin(row.start_time);
    let endMin = hmsToMin(row.end_time);
    if (!Number.isFinite(endMin) || endMin <= startMin) endMin = startMin + 60;

    periodById.set(id, {
      id,
      institution_id: String(row.institution_id || ""),
      weekday: parseWeekday(row.weekday),
      label: row.label ?? null,
      start_time: normalizeTimeFromDb(row.start_time),
      end_time: normalizeTimeFromDb(row.end_time),
      startMin,
      endMin,
    });
  }

  const timetables = rawTimetables.map((row): TimetableRow => ({
    id: String(row.id || ""),
    institution_id: String(row.institution_id || ""),
    class_id: row.class_id ? String(row.class_id) : null,
    subject_id: row.subject_id ? String(row.subject_id) : "",
    teacher_id: row.teacher_id ? String(row.teacher_id) : null,
    weekday: parseWeekday(row.weekday),
    period_id: row.period_id ? String(row.period_id) : null,
  }));

  const dates = listDates(range.fromYmd, range.toYmd);
  const today = toYMD(new Date());
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const weekdayMode = detectWeekdayMode(rawPeriods.length ? rawPeriods : rawTimetables);
  const datesByWeekday = new Map<number, string[]>();

  for (const date of dates) {
    const dbWeekday = jsDayToDbWeekday(date.weekdayJs, weekdayMode);
    const arr = datesByWeekday.get(dbWeekday) || [];
    arr.push(date.ymd);
    datesByWeekday.set(dbWeekday, arr);
  }

  const statsByInstitution = new Map<string, InstitutionStats>();
  for (const inst of g.institutions) {
    statsByInstitution.set(String(inst.id), {
      institution_id: String(inst.id),
      institution_name: inst.name || "Établissement sans nom",
      regional_direction: inst.regional_direction || "",
      scheduled: 0,
      opened: 0,
      held: 0,
      not_held: 0,
      incomplete: 0,
      teachers: new Set<string>(),
    });
  }

  const dailyMap = new Map<string, DailyStats>();
  dates.forEach((date) => dailyMap.set(date.ymd, emptyDaily(date.ymd)));

  const periodSessionIndex = new Map<string, MatchableSession[]>();
  const exactSessionIndex = new Map<string, MatchableSession[]>();
  const fallbackSessionIndex = new Map<string, MatchableSession[]>();

  for (const session of rawSessions) {
    if (!session.started_at) continue;
    const institutionId = String(session.institution_id || "");
    const classId = String(session.class_id || "");
    const subjectId = String(session.subject_id || "");
    const teacherId = String(session.teacher_id || "");
    const ymd = isoToYMD(session.started_at);
    const matchable: MatchableSession = {
      ...session,
      institution_id: institutionId,
      class_id: classId,
      subject_id: subjectId,
      teacher_id: teacherId,
      period_id: session.period_id ? String(session.period_id) : null,
      ymd,
      startedMin: isoToMinutes(session.started_at),
    };

    if (matchable.period_id) {
      indexPush(
        periodSessionIndex,
        [institutionId, ymd, matchable.period_id, classId, subjectId, teacherId].join("|"),
        matchable
      );
    }

    indexPush(exactSessionIndex, [institutionId, ymd, classId, subjectId, teacherId].join("|"), matchable);
    indexPush(fallbackSessionIndex, [institutionId, ymd, classId, teacherId].join("|"), matchable);
  }

  const slotsByGroup = new Map<string, { period_id: string; startMin: number }[]>();
  for (const tt of timetables) {
    const period = tt.period_id ? periodById.get(tt.period_id) : null;
    if (!period || !tt.class_id || !tt.teacher_id || !tt.period_id) continue;
    const weekday = period.weekday ?? tt.weekday;
    if (weekday === null || weekday === undefined) continue;
    const key = [tt.institution_id, weekday, tt.class_id, tt.subject_id || "", tt.teacher_id].join("|");
    const arr = slotsByGroup.get(key) || [];
    arr.push({ period_id: tt.period_id, startMin: period.startMin });
    slotsByGroup.set(key, arr);
  }

  const nextStartMinBySlot = new Map<string, number | null>();
  for (const [group, rows] of slotsByGroup.entries()) {
    const sorted = rows.sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < sorted.length; i++) {
      nextStartMinBySlot.set(`${group}|${sorted[i].period_id}`, sorted[i + 1]?.startMin ?? null);
    }
  }

  const consumedSessions = new Set<string>();

  function chooseSession(options: {
    institutionId: string;
    ymd: string;
    periodId: string;
    classId: string;
    subjectId: string;
    teacherId: string;
    startMin: number;
    endMin: number;
    nextStartMin: number | null;
  }) {
    const periodCandidates = periodSessionIndex.get(
      [
        options.institutionId,
        options.ymd,
        options.periodId,
        options.classId,
        options.subjectId,
        options.teacherId,
      ].join("|")
    );

    const buckets = [
      periodCandidates || [],
      exactSessionIndex.get(
        [options.institutionId, options.ymd, options.classId, options.subjectId, options.teacherId].join("|")
      ) || [],
      fallbackSessionIndex.get([options.institutionId, options.ymd, options.classId, options.teacherId].join("|")) || [],
    ];

    for (const bucket of buckets) {
      const candidates = sortCandidates(bucket, options.startMin).filter((session) => {
        if (!session.id || consumedSessions.has(String(session.id))) return false;
        if (session.startedMin < options.startMin) return false;
        if (options.nextStartMin !== null && session.startedMin >= options.nextStartMin) return false;
        return session.startedMin <= options.endMin + 120;
      });

      if (candidates.length) return candidates[0];
    }

    return null;
  }

  for (const tt of timetables) {
    const institutionId = tt.institution_id;
    const stats = statsByInstitution.get(institutionId);
    if (!stats) continue;

    const period = tt.period_id ? periodById.get(tt.period_id) : null;
    if (!period || !tt.class_id || !tt.teacher_id || !tt.period_id) continue;

    const weekday = period.weekday ?? tt.weekday;
    if (weekday === null || weekday === undefined) continue;

    const datesForDay = datesByWeekday.get(weekday) || [];
    if (!datesForDay.length) continue;

    const classId = tt.class_id;
    const subjectId = tt.subject_id || "";
    const teacherId = tt.teacher_id;
    const group = [institutionId, weekday, classId, subjectId, teacherId].join("|");
    const nextStartMin = nextStartMinBySlot.get(`${group}|${tt.period_id}`) ?? null;

    for (const ymd of datesForDay) {
      if (ymd > today) continue;
      if (ymd === today && period.endMin > nowMinutes) continue;

      stats.scheduled += 1;
      const day = dailyMap.get(ymd) || emptyDaily(ymd);
      day.scheduled += 1;
      dailyMap.set(ymd, day);

      const matched = chooseSession({
        institutionId,
        ymd,
        periodId: tt.period_id,
        classId,
        subjectId,
        teacherId,
        startMin: period.startMin,
        endMin: period.endMin,
        nextStartMin,
      });

      if (!matched) {
        stats.not_held += 1;
        day.not_held += 1;
        continue;
      }

      consumedSessions.add(String(matched.id));
      stats.opened += 1;
      day.opened += 1;
      if (matched.teacher_id) stats.teachers.add(String(matched.teacher_id));

      if (matched.started_at && matched.ended_at) {
        stats.held += 1;
        day.held += 1;
      } else {
        stats.incomplete += 1;
        day.incomplete += 1;
      }
    }
  }

  const items = Array.from(statsByInstitution.values())
    .map((stats) => {
      const clean = {
        institution_id: stats.institution_id,
        institution_name: stats.institution_name,
        regional_direction: stats.regional_direction,
        scheduled: stats.scheduled,
        opened: stats.opened,
        held: stats.held,
        not_held: stats.not_held,
        incomplete: stats.incomplete,
        teachers_seen: stats.teachers.size,
        held_rate: pct(stats.held, stats.scheduled),
        opening_rate: pct(stats.opened, stats.scheduled),
      };

      return {
        ...clean,
        status: getOperationalStatus(clean),
        // Compatibilité avec l’ancienne page si besoin.
        sessions: clean.scheduled,
        confirmed: clean.held,
        missing: clean.not_held,
        coverage_rate: clean.held_rate,
        closed: clean.held,
        close_rate: clean.held_rate,
      };
    })
    .sort((a, b) => {
      if (a.status === "silent" && b.status !== "silent") return -1;
      if (b.status === "silent" && a.status !== "silent") return 1;
      if (a.scheduled === 0 && b.scheduled !== 0) return 1;
      if (b.scheduled === 0 && a.scheduled !== 0) return -1;
      return a.held_rate - b.held_rate;
    });

  const totalsRaw = items.reduce(
    (acc, item) => {
      acc.scheduled += item.scheduled;
      acc.opened += item.opened;
      acc.held += item.held;
      acc.not_held += item.not_held;
      acc.incomplete += item.incomplete;
      acc.teachers_seen += item.teachers_seen;
      return acc;
    },
    { scheduled: 0, opened: 0, held: 0, not_held: 0, incomplete: 0, teachers_seen: 0 }
  );

  const daily = Array.from(dailyMap.values()).map((day) => ({
    ...day,
    held_rate: pct(day.held, day.scheduled),
    opening_rate: pct(day.opened, day.scheduled),
  }));

  const alerts = items
    .filter((item) => ["silent", "critical", "watch"].includes(item.status) && item.scheduled > 0)
    .slice(0, 8)
    .map((item) => {
      if (item.status === "silent") {
        return {
          institution_id: item.institution_id,
          institution_name: item.institution_name,
          severity: "critical",
          type: "silent",
          message: `${item.institution_name} a ${item.scheduled} séance(s) prévue(s), mais aucune séance tenue sur la période.`,
          scheduled: item.scheduled,
          held_rate: item.held_rate,
          not_held: item.not_held,
        };
      }

      if (item.status === "critical") {
        return {
          institution_id: item.institution_id,
          institution_name: item.institution_name,
          severity: "critical",
          type: "low_held_rate",
          message: `${item.institution_name} présente un taux de tenue faible (${item.held_rate}%).`,
          scheduled: item.scheduled,
          held_rate: item.held_rate,
          not_held: item.not_held,
        };
      }

      return {
        institution_id: item.institution_id,
        institution_name: item.institution_name,
        severity: "warning",
        type: "watch",
        message: `${item.institution_name} est à surveiller : ${item.not_held} séance(s) non tenue(s).`,
        scheduled: item.scheduled,
        held_rate: item.held_rate,
        not_held: item.not_held,
      };
    });

  const totals = {
    ...totalsRaw,
    held_rate: pct(totalsRaw.held, totalsRaw.scheduled),
    opening_rate: pct(totalsRaw.opened, totalsRaw.scheduled),
    // Compatibilité avec les anciens libellés côté front.
    sessions: totalsRaw.scheduled,
    confirmed: totalsRaw.held,
    missing: totalsRaw.not_held,
    coverage_rate: pct(totalsRaw.held, totalsRaw.scheduled),
    closed: totalsRaw.held,
    close_rate: pct(totalsRaw.held, totalsRaw.scheduled),
  };

  return NextResponse.json({
    ok: true,
    range,
    definitions: {
      scheduled: "Cours prévus selon les emplois du temps officiels.",
      held: "Séances démarrées puis terminées dans Mon Cahier.",
      not_held: "Cours prévus mais jamais ouverts par l’enseignant.",
      incomplete: "Séances ouvertes mais non terminées.",
    },
    totals,
    daily,
    alerts,
    items,
  });
}
