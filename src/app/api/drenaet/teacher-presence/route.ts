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
  started_at: string | null;
  ended_at: string | null;
  actual_call_at?: string | null;
  origin?: string | null;
};

type AbsenceRequestRow = {
  id: string;
  institution_id: string;
  teacher_profile_id: string | null;
  start_date: string | null;
  end_date: string | null;
  reason_label: string | null;
  status: "pending" | "approved" | string;
};

type InstitutionStats = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  scheduled: number;
  opened: number;
  ended: number;
  not_ended: number;
  permission_approved_raw: number;
  permission_pending_raw: number;
  permission_approved: number;
  permission_pending: number;
  not_opened: number;
  absent_unjustified: number;
  teachers: Set<string>;
};

type DailyStats = {
  date: string;
  scheduled: number;
  opened: number;
  ended: number;
  not_ended: number;
  permission_approved_raw: number;
  permission_pending_raw: number;
  permission_approved: number;
  permission_pending: number;
  not_opened: number;
  absent_unjustified: number;
};

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function clampPositive(value: number) {
  return Math.max(0, Math.trunc(Number(value || 0)));
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

  // Convention utilisée par l'app : 0 = dimanche, 1 = lundi, ..., 6 = samedi.
  // Une semaine scolaire lundi-vendredi (1..5) ne doit pas être interprétée
  // comme une convention legacy "lundi = 0".
  if (values.includes(7)) return "iso";
  if (values.includes(6)) return "js";
  if (values.includes(0) && !values.includes(5)) return "mon0";

  return "js";
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
  return {
    date,
    scheduled: 0,
    opened: 0,
    ended: 0,
    not_ended: 0,
    permission_approved_raw: 0,
    permission_pending_raw: 0,
    permission_approved: 0,
    permission_pending: 0,
    not_opened: 0,
    absent_unjustified: 0,
  };
}

function getOperationalStatus(stats: {
  scheduled: number;
  opened: number;
  permission_approved: number;
  absent_unjustified: number;
  presence_rate: number;
}) {
  if (stats.scheduled <= 0) return "no_schedule";
  if (stats.opened <= 0 && stats.permission_approved <= 0) return "silent";
  if (stats.presence_rate < 50 || stats.absent_unjustified >= Math.max(10, Math.ceil(stats.scheduled * 0.4))) return "critical";
  if (stats.presence_rate < 80 || stats.absent_unjustified > 0) return "watch";
  return "stable";
}

function emptyInstitutionStats(inst: any): InstitutionStats {
  return {
    institution_id: String(inst.id),
    institution_name: inst.name || "Établissement sans nom",
    regional_direction: inst.regional_direction || "",
    scheduled: 0,
    opened: 0,
    ended: 0,
    not_ended: 0,
    permission_approved_raw: 0,
    permission_pending_raw: 0,
    permission_approved: 0,
    permission_pending: 0,
    not_opened: 0,
    absent_unjustified: 0,
    teachers: new Set<string>(),
  };
}

function finalizeDerived<T extends { scheduled: number; opened: number; permission_approved_raw: number; permission_pending_raw: number; permission_approved: number; permission_pending: number; not_opened: number; absent_unjustified: number }>(stats: T) {
  const scheduled = clampPositive(stats.scheduled);
  const opened = clampPositive(stats.opened);
  const nonOpened = Math.max(0, scheduled - opened);
  const approved = Math.min(clampPositive(stats.permission_approved_raw), nonOpened);
  const pending = Math.min(clampPositive(stats.permission_pending_raw), Math.max(0, nonOpened - approved));

  stats.not_opened = nonOpened;
  stats.permission_approved = approved;
  stats.permission_pending = pending;
  stats.absent_unjustified = Math.max(0, nonOpened - approved - pending);
  return stats;
}

function buildAbsenceIndex(absenceRequests: AbsenceRequestRow[]) {
  const index = new Map<string, { approved: boolean; pending: boolean }>();

  for (const request of absenceRequests || []) {
    const teacherId = String(request.teacher_profile_id || "");
    const institutionId = String(request.institution_id || "");
    const start = parseYMD(request.start_date || "");
    const end = parseYMD(request.end_date || "");
    const status = String(request.status || "");

    if (!teacherId || !institutionId || !start || !end || !["approved", "pending"].includes(status)) continue;

    const cursor = new Date(start.getTime());
    while (cursor.getTime() <= end.getTime()) {
      const ymd = toYMD(cursor);
      const key = `${ymd}|${institutionId}|${teacherId}`;
      const current = index.get(key) || { approved: false, pending: false };
      if (status === "approved") current.approved = true;
      if (status === "pending") current.pending = true;
      index.set(key, current);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return index;
}

async function fetchTeacherSessions(srv: any, institutionIds: string[], fromISO: string, toISO: string) {
  const { data, error } = await srv
    .from("teacher_sessions")
    .select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,ended_at,origin")
    .in("institution_id", institutionIds)
    .gte("started_at", fromISO)
    .lt("started_at", toISO)
    .range(0, 100000);

  if (error) return { data: [], error: error.message };
  return { data: (data || []) as SessionRow[], error: null };
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
        scheduled: "Cours attendus selon les emplois du temps officiels.",
        opened: "Présences déclarées : cours ouverts dans Mon Cahier par les enseignants.",
        ended: "Cours ouverts puis clôturés.",
        not_ended: "Cours ouverts mais non clôturés.",
        permission_approved: "Cours prévus couverts par une autorisation d’absence approuvée. Ce compteur porte sur les cours, pas sur le nombre d’enseignants.",
        absent_unjustified: "Cours prévus non ouverts, sans autorisation approuvée ni demande en attente.",
      },
      totals: {},
      daily: [],
      alerts: [],
      items: [],
    });
  }

  const [periodsRes, ttsRes, sessionsRes, absenceRes] = await Promise.all([
    g.srv
      .from("institution_periods")
      .select("id,institution_id,weekday,label,start_time,end_time")
      .in("institution_id", institutionIds)
      .range(0, 100000),
    g.srv
      .from("teacher_timetables")
      .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
      .in("institution_id", institutionIds)
      .range(0, 100000),
    fetchTeacherSessions(g.srv, institutionIds, range.fromISO, range.toISO),
    g.srv
      .from("teacher_absence_requests")
      .select("id,institution_id,teacher_profile_id,start_date,end_date,reason_label,status")
      .in("institution_id", institutionIds)
      .in("status", ["pending", "approved"])
      .lte("start_date", range.toYmd)
      .gte("end_date", range.fromYmd)
      .range(0, 100000),
  ]);

  if (periodsRes.error) return NextResponse.json({ error: periodsRes.error.message }, { status: 400 });
  if (ttsRes.error) return NextResponse.json({ error: ttsRes.error.message }, { status: 400 });
  if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error }, { status: 400 });
  if (absenceRes.error) return NextResponse.json({ error: absenceRes.error.message }, { status: 400 });

  const rawPeriods = (periodsRes.data || []) as any[];
  const rawTimetables = (ttsRes.data || []) as any[];
  const rawSessions = (sessionsRes.data || []) as SessionRow[];
  const rawAbsences = (absenceRes.data || []) as AbsenceRequestRow[];

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
    subject_id: row.subject_id ? String(row.subject_id) : null,
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
  for (const inst of g.institutions) statsByInstitution.set(String(inst.id), emptyInstitutionStats(inst));

  const dailyMap = new Map<string, DailyStats>();
  dates.forEach((date) => dailyMap.set(date.ymd, emptyDaily(date.ymd)));

  const absenceIndex = buildAbsenceIndex(rawAbsences);

  // 1) Cours prévus : source = emplois du temps officiels.
  for (const tt of timetables) {
    const institutionId = tt.institution_id;
    const stats = statsByInstitution.get(institutionId);
    if (!stats || !tt.teacher_id) continue;

    const period = tt.period_id ? periodById.get(tt.period_id) : null;
    const weekday = period?.weekday ?? tt.weekday;
    if (weekday === null || weekday === undefined) continue;

    const datesForDay = datesByWeekday.get(weekday) || [];
    if (!datesForDay.length) continue;

    for (const ymd of datesForDay) {
      if (ymd > today) continue;
      if (ymd === today && period && period.endMin > nowMinutes) continue;

      stats.scheduled += 1;
      const day = dailyMap.get(ymd) || emptyDaily(ymd);
      day.scheduled += 1;

      const absence = absenceIndex.get(`${ymd}|${institutionId}|${tt.teacher_id}`);
      if (absence?.approved) {
        stats.permission_approved_raw += 1;
        day.permission_approved_raw += 1;
      } else if (absence?.pending) {
        stats.permission_pending_raw += 1;
        day.permission_pending_raw += 1;
      }

      dailyMap.set(ymd, day);
    }
  }

  // 2) Présences constatées : source = teacher_sessions réellement ouvertes.
  const seenSessions = new Set<string>();
  for (const session of rawSessions) {
    const sessionId = String(session.id || "");
    if (!sessionId || seenSessions.has(sessionId) || !session.started_at) continue;
    seenSessions.add(sessionId);

    const institutionId = String(session.institution_id || "");
    const stats = statsByInstitution.get(institutionId);
    if (!stats) continue;

    const ymd = isoToYMD(session.started_at);
    const day = dailyMap.get(ymd) || emptyDaily(ymd);

    stats.opened += 1;
    day.opened += 1;

    if (session.ended_at) {
      stats.ended += 1;
      day.ended += 1;
    } else {
      stats.not_ended += 1;
      day.not_ended += 1;
    }

    if (session.teacher_id) stats.teachers.add(String(session.teacher_id));
    dailyMap.set(ymd, day);
  }

  // 3) Dérivés : non ouverts, permissionnaires pris dans les non ouverts, absences à vérifier.
  for (const stats of statsByInstitution.values()) finalizeDerived(stats);
  for (const day of dailyMap.values()) finalizeDerived(day);

  const items = Array.from(statsByInstitution.values())
    .map((stats) => {
      const presenceRate = pct(stats.opened, stats.scheduled);
      const closureRate = pct(stats.ended, stats.opened);
      const completionRate = pct(stats.ended, stats.scheduled);
      const status = getOperationalStatus({
        scheduled: stats.scheduled,
        opened: stats.opened,
        permission_approved: stats.permission_approved,
        absent_unjustified: stats.absent_unjustified,
        presence_rate: presenceRate,
      });

      return {
        institution_id: stats.institution_id,
        institution_name: stats.institution_name,
        regional_direction: stats.regional_direction,
        scheduled: stats.scheduled,
        opened: stats.opened,
        ended: stats.ended,
        not_ended: stats.not_ended,
        not_opened: stats.not_opened,
        permission_approved: stats.permission_approved,
        permission_pending: stats.permission_pending,
        absent_unjustified: stats.absent_unjustified,
        teachers_seen: stats.teachers.size,
        presence_rate: presenceRate,
        closure_rate: closureRate,
        completion_rate: completionRate,
        status,
        // Compatibilité avec les anciens écrans.
        held: stats.ended,
        incomplete: stats.not_ended,
        not_held: stats.not_opened,
        held_rate: completionRate,
        opening_rate: presenceRate,
        sessions: stats.scheduled,
        confirmed: stats.ended,
        missing: stats.not_opened,
        coverage_rate: presenceRate,
        closed: stats.ended,
        close_rate: closureRate,
      };
    })
    .sort((a, b) => {
      const priority: Record<string, number> = { silent: 0, critical: 1, watch: 2, no_schedule: 3, stable: 4 };
      const pa = priority[a.status] ?? 5;
      const pb = priority[b.status] ?? 5;
      if (pa !== pb) return pa - pb;
      if (a.absent_unjustified !== b.absent_unjustified) return b.absent_unjustified - a.absent_unjustified;
      return a.presence_rate - b.presence_rate;
    });

  const totalsRaw = items.reduce(
    (acc, item) => {
      acc.scheduled += item.scheduled;
      acc.opened += item.opened;
      acc.ended += item.ended;
      acc.not_ended += item.not_ended;
      acc.not_opened += item.not_opened;
      acc.permission_approved += item.permission_approved;
      acc.permission_pending += item.permission_pending;
      acc.absent_unjustified += item.absent_unjustified;
      acc.teachers_seen += item.teachers_seen;
      return acc;
    },
    {
      scheduled: 0,
      opened: 0,
      ended: 0,
      not_ended: 0,
      not_opened: 0,
      permission_approved: 0,
      permission_pending: 0,
      absent_unjustified: 0,
      teachers_seen: 0,
    }
  );

  const totals = {
    ...totalsRaw,
    presence_rate: pct(totalsRaw.opened, totalsRaw.scheduled),
    closure_rate: pct(totalsRaw.ended, totalsRaw.opened),
    completion_rate: pct(totalsRaw.ended, totalsRaw.scheduled),
    // Compatibilité avec les anciens libellés côté front.
    held: totalsRaw.ended,
    incomplete: totalsRaw.not_ended,
    not_held: totalsRaw.not_opened,
    held_rate: pct(totalsRaw.ended, totalsRaw.scheduled),
    opening_rate: pct(totalsRaw.opened, totalsRaw.scheduled),
    sessions: totalsRaw.scheduled,
    confirmed: totalsRaw.ended,
    missing: totalsRaw.not_opened,
    coverage_rate: pct(totalsRaw.opened, totalsRaw.scheduled),
    closed: totalsRaw.ended,
    close_rate: pct(totalsRaw.ended, totalsRaw.opened),
  };

  const daily = Array.from(dailyMap.values()).map((day) => ({
    ...day,
    presence_rate: pct(day.opened, day.scheduled),
    closure_rate: pct(day.ended, day.opened),
    completion_rate: pct(day.ended, day.scheduled),
    held: day.ended,
    incomplete: day.not_ended,
    not_held: day.not_opened,
    held_rate: pct(day.ended, day.scheduled),
    opening_rate: pct(day.opened, day.scheduled),
  }));

  const alerts = items
    .filter((item) => ["silent", "critical", "watch"].includes(item.status) && item.scheduled > 0)
    .slice(0, 10)
    .map((item) => {
      if (item.status === "silent") {
        return {
          institution_id: item.institution_id,
          institution_name: item.institution_name,
          severity: "critical",
          type: "silent",
          message: `${item.institution_name} a ${item.scheduled} cours prévu(s), mais aucune présence enseignant constatée sur la période.`,
          scheduled: item.scheduled,
          presence_rate: item.presence_rate,
          absent_unjustified: item.absent_unjustified,
        };
      }

      if (item.absent_unjustified > 0) {
        return {
          institution_id: item.institution_id,
          institution_name: item.institution_name,
          severity: item.status === "critical" ? "critical" : "warning",
          type: "absent_unjustified",
          message: `${item.institution_name} compte ${item.absent_unjustified} cours prévu(s) non ouvert(s) à justifier sur la période.`,
          scheduled: item.scheduled,
          presence_rate: item.presence_rate,
          absent_unjustified: item.absent_unjustified,
        };
      }

      return {
        institution_id: item.institution_id,
        institution_name: item.institution_name,
        severity: "warning",
        type: "low_presence_rate",
        message: `${item.institution_name} présente un taux de présence enseignant faible (${item.presence_rate}%).`,
        scheduled: item.scheduled,
        presence_rate: item.presence_rate,
        absent_unjustified: item.absent_unjustified,
      };
    });

  return NextResponse.json({
    ok: true,
    range,
    definitions: {
      scheduled: "Cours attendus selon les emplois du temps officiels.",
      opened: "Présences déclarées : cours ouverts dans Mon Cahier par les enseignants.",
      ended: "Cours ouverts puis clôturés.",
      not_ended: "Cours ouverts mais non clôturés.",
      not_opened: "Cours prévus mais jamais ouverts.",
      permission_approved: "Cours prévus couverts par une autorisation d’absence approuvée. Ce compteur porte sur les cours, pas sur le nombre d’enseignants.",
      permission_pending: "Cours prévus couverts par une demande d’autorisation en attente de validation.",
      absent_unjustified: "Cours prévus non ouverts, sans autorisation approuvée ni demande en attente.",
    },
    totals,
    daily,
    alerts,
    items,
    warnings: {
      matching: null,
      note:
        "Les présences déclarées sont comptées à partir des teacher_sessions réelles. Les absences autorisées et les demandes à valider sont exprimées en nombre de cours couverts, pas en nombre d’enseignants. Les absences à justifier sont calculées à partir des cours prévus non ouverts, après déduction des autorisations approuvées/en attente.",
    },
  });
}
