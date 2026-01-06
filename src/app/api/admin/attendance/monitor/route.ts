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

/**
 * Détecte l'encodage weekday réellement utilisé par l'établissement, à partir de institution_periods.weekday.
 * Objectif: éviter les variantes ambiguës (vendredi=5 vs samedi=5 selon convention).
 */
type WeekdayMode = "iso" | "js" | "mon0";

/**
 * Heuristique sûre:
 * - si on voit 7 -> ISO (lun=1..dim=7)
 * - sinon si max==5 -> mon0 (lun=0..sam=5) [cas le plus courant quand on a 6 jours école]
 * - sinon si on voit 0 et max==6 -> JS (dim=0..sam=6)
 * - sinon -> ISO (lun=1..sam=6)
 */
function detectWeekdayMode(periods: any[]): WeekdayMode {
  const vals = Array.from(
    new Set(
      (periods || [])
        .map((p) => parseWeekday(p?.weekday))
        .filter((v): v is number => v !== null && v !== undefined),
    ),
  );

  if (vals.includes(7)) return "iso";

  const max = vals.length ? Math.max(...vals) : 6;

  // Mon..Sat encodé 0..5 (pas de dimanche)
  if (max === 5) return "mon0";

  // Dim..Sat 0..6
  if (vals.includes(0) && max === 6) return "js";

  // Par défaut: lun=1..sam=6 (ISO-like sans dimanche)
  return "iso";
}

function jsDayToDbWeekday(jsDay0to6: number, mode: WeekdayMode): number {
  if (mode === "js") return jsDay0to6; // 0=dim..6=sam
  if (mode === "iso") return jsDay0to6 === 0 ? 7 : jsDay0to6; // 1=lun..7=dim
  // mon0: 0=lun..6=dim
  return (jsDay0to6 + 6) % 7;
}

/* Seuil en minutes au-delà duquel on considère l’appel « en retard » (pur affichage) */
const LATE_THRESHOLD_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_LATE_THRESHOLD_MIN)))
    : 15;

/* Fenêtre (en minutes) avant de considérer un appel comme « manquant ». */
const MISSING_CONTROL_WINDOW_MIN =
  Number.isFinite(Number(process.env.ATTENDANCE_MISSING_CONTROL_WINDOW_MIN))
    ? Math.max(1, Math.floor(Number(process.env.ATTENDANCE_MISSING_CONTROL_WINDOW_MIN)))
    : LATE_THRESHOLD_MIN;

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const debug = url.searchParams.get("debug") === "1";

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

  // liste des dates inclusives
  const dates: { ymd: string; weekdayJs: number }[] = [];
  const cursor = new Date(fromDate.getTime());
  while (cursor.getTime() <= toDate.getTime()) {
    dates.push({
      ymd: toYMD(cursor),
      weekdayJs: cursor.getUTCDay(), // 0=dim, 1=lun...
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
    // On ne bloque pas
  }

  const dateMinIso = new Date(fromDate.getTime());
  dateMinIso.setUTCHours(0, 0, 0, 0);
  const dateMaxIso = new Date(toDate.getTime());
  dateMaxIso.setUTCDate(dateMaxIso.getUTCDate() + 1);
  dateMaxIso.setUTCHours(0, 0, 0, 0);

  const { data: sessions, error: sessErr } = await srv
    .from("teacher_sessions")
    .select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,origin")
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
      weekday: parseWeekday(p.weekday) ?? 0,
      label: (p.label as string | null) ?? null,
      start_time: startNorm,
      end_time: endNorm,
      startMin,
      endMin,
      institution_id: String(p.institution_id),
    });
  });

  // ✅ Détecte UNE convention weekday (source de vérité: institution_periods)
  const weekdayMode = detectWeekdayMode(periods || []);

  // ✅ Map weekday(db) -> dates (UNE seule convention, pas de variantes ambiguës)
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

  const subjectNameById = new Map<string, string>(); // institution_subject_id -> name
  const instSubjectIdsByBaseId = new Map<string, string[]>(); // base_subject_id -> [instIds]

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

  /**
   * Affectations officielles :
   * - teacher_subjects.subject_id peut être :
   *   A) base_subject_id
   *   B) institution_subject_id
   */
  const teacherHasSubjects = new Set<string>();
  const allowedByTeacher = new Map<string, Set<string>>(); // teacherId -> Set(institution_subject_id)

  (teacherSubjects || []).forEach((ts: any) => {
    const teacherId = String(ts.profile_id);
    const rawSubjId = ts.subject_id ? String(ts.subject_id) : "";
    if (!rawSubjId) return;

    teacherHasSubjects.add(teacherId);

    // cas B : déjà institution_subject_id
    let instIds: string[] = [];
    if (subjectNameById.has(rawSubjId)) {
      instIds = [rawSubjId];
    } else {
      // cas A : base_subject_id
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
        s.origin === "class_device" ? "class_device" : s.origin === "teacher" ? "teacher" : null,
    });
    sessionsIndex.set(key, arr);
  });

  // Calcul final des lignes
  const rows: MonitorRow[] = [];

  (tts || []).forEach((tt: any) => {
    const period = periodById.get(String(tt.period_id));
    if (!period) return;

    // ✅ Source de vérité pour le jour : institution_periods.weekday
    const weekday = period.weekday;
    const datesForDay = datesByWeekday.get(weekday);
    if (!datesForDay || !datesForDay.length) return;

    const startMin = period.startMin;
    const endMin = period.endMin;

    const classId = String(tt.class_id);
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id);

    // Filtre affectations : seulement si le prof a des affectations ET qu'on a quelque chose de fiable
    if (subjectId && teacherHasSubjects.has(teacherId)) {
      const allowed = allowedByTeacher.get(teacherId);

      // si on a un set non vide, on vérifie
      if (allowed && allowed.size > 0) {
        let ok = allowed.has(subjectId);

        // si subjectId est potentiellement un base_subject_id, on tente le mapping
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

    // subject_name : si subjectId est base id, on map vers 1 inst id
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

      // Séance la plus ancienne dans le créneau (si plusieurs)
      let best: SessIndexItem | null = null;
      for (const s of sessList) {
        if (s.callMin < startMin || s.callMin > endMin + 120) continue;
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
      }

      const periodLabel =
        period.label ||
        [normalizeTimeFromDb(period.start_time) || "", normalizeTimeFromDb(period.end_time) || ""]
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
      });
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

  if (debug) {
    const distinctNums = (arr: any[], key: string) =>
      Array.from(
        new Set(
          (arr || [])
            .map((x) => x?.[key])
            .filter((v) => v !== null && v !== undefined)
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n)),
        ),
      ).sort((a, b) => a - b);

    return NextResponse.json({
      rows,
      debug: {
        todayYmd,
        nowUtcHHMM: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
        nowMinutes,
        range: { from: toYMD(fromDate), to: toYMD(toDate), days: dates.length },
        counts: {
          periods: (periods || []).length,
          tts: (tts || []).length,
          sessions: (sessions || []).length,
          teacherSubjects: (teacherSubjects || []).length,
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
