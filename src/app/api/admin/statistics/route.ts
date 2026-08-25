// src/app/api/admin/statistics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { isEducationType } from "@/lib/education-organization";
import {
  ALL_EDUCATION_TYPES,
  readEducationScopeFromSearchParams,
  type EducationScopeValue,
} from "@/lib/education-scope";

/* ───────── helpers communs ───────── */
function toDayRange(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromLocal = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const toLocalNext = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0);
  return {
    fromISO: fromLocal.toISOString(),
    toISOExclusive: toLocalNext.toISOString(),
  };
}

function niceName(p: any) {
  const dn = String(p?.display_name ?? "").trim();
  const em = String(p?.email ?? "").trim();
  const ph = String(p?.phone ?? "").trim();
  const emLocal = em.includes("@") ? em.split("@")[0] : em;
  const id = String(p?.id ?? "");
  return (
    dn ||
    emLocal ||
    ph ||
    `(enseignant ${id.slice(0, 6)})`
  );
}

async function tableExists(db: any, name: string) {
  const { error } = await db.from(name).select("*").limit(1);
  return !error;
}

const EDUCATION_SCOPE_PARAMS = [
  "education_type",
  "formation_code",
  "formation_level_code",
  "level_code",
  "class_id",
  "classId",
] as const;

function readValidatedEducationScope(params: URLSearchParams):
  | { ok: true; scope: EducationScopeValue; active: boolean }
  | { ok: false; error: string } {
  const active = EDUCATION_SCOPE_PARAMS.some((name) => params.has(name));
  const rawType = String(params.get("education_type") || "").trim();

  if (
    rawType &&
    rawType !== ALL_EDUCATION_TYPES &&
    !isEducationType(rawType)
  ) {
    return { ok: false, error: "Type d'enseignement invalide." };
  }

  const scope = active
    ? readEducationScopeFromSearchParams(params)
    : {
        educationType: ALL_EDUCATION_TYPES,
        formationCode: "",
        levelCode: "",
        classId: "",
      };

  if (
    scope.formationCode &&
    (scope.educationType === ALL_EDUCATION_TYPES ||
      scope.educationType === "general_secondary")
  ) {
    return {
      ok: false,
      error: "Une formation exige un type d'enseignement non général.",
    };
  }

  if (scope.levelCode && scope.educationType === ALL_EDUCATION_TYPES) {
    return {
      ok: false,
      error: "Un niveau exige un type d'enseignement précis.",
    };
  }

  return { ok: true, scope, active };
}

async function resolveScopedClassIds(
  db: any,
  institutionId: string,
  scope: EducationScopeValue,
  scopeParamsPresent: boolean,
): Promise<string[] | null> {
  const hasRestriction =
    scopeParamsPresent &&
    (scope.educationType !== ALL_EDUCATION_TYPES ||
      Boolean(scope.formationCode) ||
      Boolean(scope.levelCode) ||
      Boolean(scope.classId));

  if (!hasRestriction) return null;

  let query = db
    .from("classes")
    .select("id")
    .eq("institution_id", institutionId);

  if (scope.classId) query = query.eq("id", scope.classId);

  if (scope.educationType === "general_secondary") {
    query = query.or(
      "education_type.eq.general_secondary,education_type.is.null",
    );
  } else if (scope.educationType !== ALL_EDUCATION_TYPES) {
    query = query.eq("education_type", scope.educationType);
  }

  if (scope.formationCode) {
    query = query.eq("formation_code", scope.formationCode);
  }

  if (scope.levelCode) {
    query =
      scope.educationType === "general_secondary"
        ? query.eq("level", scope.levelCode)
        : query.eq("formation_level_code", scope.levelCode);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return Array.from(
    new Set((data || []).map((row: any) => String(row.id)).filter(Boolean)),
  );
}

async function resolveSubjectNameMap(
  db: any,
  subjectIds: string[],
  institutionId: string,
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(subjectIds.map(String).filter(Boolean)));
  const names: Record<string, string> = {};
  if (!ids.length) return names;

  const { data: baseSubjects } = await db
    .from("subjects")
    .select("id,name")
    .in("id", ids);

  for (const row of baseSubjects || []) {
    names[String(row.id)] = String(row.name || "").trim();
  }

  const unresolved = ids.filter((id) => !names[id]);
  if (!unresolved.length) return names;

  const { data: links } = await db
    .from("institution_subjects")
    .select("id,subject_id,custom_name,subjects:subject_id(id,name)")
    .eq("institution_id", institutionId)
    .in("id", unresolved);

  for (const row of links || []) {
    const relation = (row as any).subjects;
    names[String((row as any).id)] = String(
      (row as any).custom_name || relation?.name || "",
    ).trim();
  }

  return names;
}

/** Pour un subjects.id, renvoie tous les IDs possibles pour sessions.subject_id */
async function resolveSessionSubjectIds(
  db: any,
  baseSubjectId: string,
  institutionId: string | null
): Promise<string[]> {
  const ids = new Set<string>([baseSubjectId]);
  try {
    let q = db
      .from("institution_subjects")
      .select("id, subject_id")
      .eq("subject_id", baseSubjectId);
    if (institutionId) q = q.eq("institution_id", institutionId);
    const { data: links } = await q;
    for (const l of links || []) ids.add(String(l.id));
  } catch {}
  return Array.from(ids);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/* ───────── helpers HH:MM / dates (Abidjan) ───────── */
function hmToMin(hhmm: string) {
  const [h, m] = (hhmm || "00:00").split(":").map((x) => parseInt(x, 10));
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
}

function minToHM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Différence (en minutes) entre startISO et actualISO (si null → 0) */
function diffMinutes(startISO: string, actualISO: string | null) {
  try {
    const start = new Date(startISO);
    const end = actualISO ? new Date(actualISO) : start;
    const diffMs = end.getTime() - start.getTime();
    return Math.floor(diffMs / 60000);
  } catch {
    return 0;
  }
}

/**
 * Minutes réellement effectuées = minutes prévues − retard (premier appel − heure prévue)
 * (tout est borné à 0 pour éviter les valeurs négatives)
 */
function effectiveMinutesFromSession(
  expectedMinutes: number,
  startISO: string,
  actualISO: string | null
) {
  const planned = Math.max(0, Math.round(expectedMinutes || 0));
  const delta = diffMinutes(startISO, actualISO);
  const lateness = Math.max(0, delta);
  const eff = Math.max(0, planned - lateness);
  return eff;
}

/**
 * ✅ Séance réellement effectuée = clic "Démarrer" DANS le créneau prévu.
 * - si actual_call_at est null → FAUX
 * - si clic >= fin du créneau → FAUX
 * - si expected_minutes manquant/0 → on prend 60 min par défaut
 */
function isCallWithinPlannedSlot(
  startISO: string,
  actualISO: string | null,
  expectedMinutes: number
) {
  if (!actualISO) return false;

  const planned = Math.max(0, Math.round(expectedMinutes || 0));
  const durMin = planned > 0 ? planned : 60;

  const start = new Date(startISO).getTime();
  const actual = new Date(actualISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(actual)) return false;

  const end = start + durMin * 60_000;
  return actual >= start && actual < end;
}

function rangeDates(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd, 12, 0, 0, 0);
  const end = new Date(ty, tm - 1, td, 12, 0, 0, 0);
  const out: string[] = [];
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

type WeekdayMode = "iso" | "js" | "mon0";

function normalizeDbTime(raw: unknown) {
  const value = String(raw || "").trim();
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function parseWeekday(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectWeekdayMode(rows: Array<{ weekday?: unknown }>): WeekdayMode {
  const values = Array.from(
    new Set(
      rows
        .map((row) => parseWeekday(row?.weekday))
        .filter((value): value is number => value !== null),
    ),
  );

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

function weekdayForYmd(ymd: string) {
  return new Date(`${ymd}T12:00:00.000Z`).getUTCDay();
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function minutesBetweenIso(startIso: string | null, endIso: string | null) {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, Math.floor((end - start) / 60_000));
}

function observedClosedMinutes(input: {
  actualCallAt: string | null;
  endedAt: string | null;
  expectedMinutes: number;
}) {
  const observed = minutesBetweenIso(input.actualCallAt, input.endedAt);
  const expected = Math.max(0, Math.round(input.expectedMinutes || 0));
  if (!observed) return 0;
  return expected > 0 ? Math.min(observed, expected) : observed;
}

/* ───────── slots manuels ───────── */
function buildUniformSlots(startHour: number, endHour: number, slotMin: number) {
  const out: { start: string; end: string }[] = [];
  let cur = startHour * 60;
  const end = endHour * 60;
  while (cur < end) {
    const next = Math.min(cur + slotMin, end);
    out.push({ start: minToHM(cur), end: minToHM(next) });
    cur = next;
  }
  return out;
}

/** ancre l’arrondi sur startHour et coupe hors plage */
function bucketToSlotStartAligned(
  h: number,
  min: number,
  slotMin: number,
  startHour: number,
  endHour: number
): string | null {
  const t = h * 60 + min;
  const first = startHour * 60;
  const last = endHour * 60;
  if (t < first || t >= last) return null;
  const k = Math.floor((t - first) / slotMin);
  const v = first + k * slotMin;
  return minToHM(v);
}

/* ───────── slots établissement (institution_periods) ───────── */
async function buildInstitutionSlots(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { data: per, error } = await srv
    .from("institution_periods")
    .select("weekday, period_no, label, start_time, end_time")
    .eq("institution_id", institutionId)
    .order("weekday", { ascending: true })
    .order("period_no", { ascending: true });
  if (error) throw new Error(error.message);

  // Unifie par heure de début (HH:MM) — on conserve le premier end rencontré
  const firstForStart = new Map<string, { start: string; end: string }>();
  for (const p of per || []) {
    const s = String(p.start_time || "08:00:00").slice(0, 5);
    const e = String(p.end_time || "09:00:00").slice(0, 5);
    if (!firstForStart.has(s)) firstForStart.set(s, { start: s, end: e });
  }
  return Array.from(firstForStart.values()).sort((a, b) =>
    a.start.localeCompare(b.start)
  );
}

/* ───────────────────────────────────── */
export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const rls = await getSupabaseServerClient();

  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "summary") as
      | "summary"
      | "detail"
      | "timesheet";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const subject_id = searchParams.get("subject_id") || null;
    const teacher_id = searchParams.get("teacher_id") || null;

    if (!from || !to) {
      return NextResponse.json(
        { error: "from & to requis (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const { fromISO, toISOExclusive } = toDayRange(from, to);

    // Établissement de l’utilisateur courant (RLS).
    const {
      data: { user },
    } = await rls.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: me, error: meError } = await rls
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meError) {
      return NextResponse.json({ error: meError.message }, { status: 400 });
    }

    const inst = String(me?.institution_id || "").trim();
    if (!inst) {
      return NextResponse.json({ error: "no_institution" }, { status: 400 });
    }

    const scopeResult = readValidatedEducationScope(searchParams);
    if (scopeResult.ok === false) {
      return NextResponse.json({ error: scopeResult.error }, { status: 400 });
    }

    const educationScope = scopeResult.scope;
    const scopedClassIds = await resolveScopedClassIds(
      srv,
      inst,
      educationScope,
      scopeResult.active,
    );
    const classScopeActive = scopedClassIds !== null;
    const allowedSessionSubjectIds = subject_id
      ? await resolveSessionSubjectIds(srv, subject_id, inst)
      : [];

    /* ============================ TIMESHEET ============================ */
    if (mode === "timesheet") {
      if (!teacher_id) {
        return NextResponse.json(
          { error: "teacher_id requis pour mode=timesheet" },
          { status: 400 }
        );
      }

      const usePeriods = searchParams.get("use_periods") === "1";
      const slotMin = Math.max(1, parseInt(searchParams.get("slot") || "60", 10));
      const startHour = Math.min(
        23,
        Math.max(0, parseInt(searchParams.get("start_hour") || "7", 10))
      );
      const endHour = Math.min(
        24,
        Math.max(1, parseInt(searchParams.get("end_hour") || "18", 10))
      );

      const dates = rangeDates(from, to);

      const instForSlots = inst;

      const subjectsSet = new Set<string>();
      let teacherName: string | null = null;
      {
        let q = srv
          .from("teacher_subjects")
          .select("profile_id, subject_name, teacher_name")
          .eq("institution_id", inst)
          .eq("profile_id", teacher_id);
        if (subject_id) q = q.in("subject_id", allowedSessionSubjectIds);
        const { data: ts } = await q;
        for (const r of ts || []) {
          const nm = String(r.subject_name ?? "").trim();
          if (nm) subjectsSet.add(nm);
          if (!teacherName) {
            const tnm = String(r.teacher_name ?? "").trim();
            if (tnm) teacherName = tnm;
          }
        }
        if (!teacherName) {
          const { data: p } = await srv
            .from("profiles")
            .select("id, display_name, email, phone")
            .eq("id", teacher_id)
            .maybeSingle();
          if (p) teacherName = niceName(p);
        }
      }

      const sessionsTable =
        (await tableExists(srv, "teacher_sessions"))
          ? "teacher_sessions"
          : (await tableExists(srv, "class_sessions"))
            ? "class_sessions"
            : "sessions";

      if (classScopeActive && !scopedClassIds?.length) {
        const slots =
          usePeriods && instForSlots
            ? await buildInstitutionSlots(srv, instForSlots)
            : buildUniformSlots(startHour, endHour, slotMin);

        return NextResponse.json({
          teacher: {
            id: teacher_id,
            name: teacherName || "(enseignant)",
            subjects: [],
            total_minutes: 0,
            total_sessions: 0,
          },
          dates,
          classes: [],
          slots,
          cells: {},
          cellsMeta: {},
        });
      }

      let qCT = srv
        .from("class_teachers")
        .select("class_id, subject_id")
        .eq("institution_id", inst)
        .eq("teacher_id", teacher_id);
      if (classScopeActive) qCT = qCT.in("class_id", scopedClassIds || []);
      if (subject_id) qCT = qCT.in("subject_id", allowedSessionSubjectIds);
      const { data: ctPairs, error: ctError } = await qCT;
      if (ctError) throw new Error(ctError.message);

      const pairKey = (c?: string | null, s?: string | null) =>
        `${c ?? ""}|${s ?? ""}`;

      const allowedPairs = new Set<string>(
        (ctPairs || []).map((r) =>
          pairKey(String(r.class_id), r.subject_id ? String(r.subject_id) : null)
        )
      );

      // Sessions créées côté prof
      let q1 = srv
        .from(sessionsTable)
        .select(
          "id, teacher_id, class_id, subject_id, started_at, actual_call_at, expected_minutes, institution_id, created_by"
        )
        .eq("institution_id", inst)
        .eq("teacher_id", teacher_id)
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);
      if (classScopeActive) q1 = q1.in("class_id", scopedClassIds || []);
      if (subject_id) q1 = q1.in("subject_id", allowedSessionSubjectIds);
      const { data: sOwn, error: ownError } = await q1;
      if (ownError) throw new Error(ownError.message);

      // Sessions créées côté compte-classe (mêmes classes du prof)
      const classIdsForTeacher = Array.from(
        new Set((ctPairs || []).map((r) => String(r.class_id)))
      );
      let sFromClass: any[] = [];
      if (classIdsForTeacher.length) {
        let q2 = srv
          .from(sessionsTable)
          .select(
            "id, teacher_id, class_id, subject_id, started_at, actual_call_at, expected_minutes, institution_id, created_by"
          )
          .eq("institution_id", inst)
          .in("class_id", classIdsForTeacher)
          .gte("started_at", fromISO)
          .lt("started_at", toISOExclusive);
        if (subject_id) q2 = q2.in("subject_id", allowedSessionSubjectIds);
        const { data: sRaw, error: classSessionError } = await q2;
        if (classSessionError) throw new Error(classSessionError.message);
        sFromClass = (sRaw || []).filter((r) =>
          allowedPairs.has(
            pairKey(
              r.class_id ? String(r.class_id) : null,
              r.subject_id ? String(r.subject_id) : null
            )
          )
        );
      }

      // Dédupe par ID seulement (on dédoublonnera ensuite PAR CELLULE)
      const byId = new Map<string, any>();
      for (const s of sOwn || []) byId.set(String(s.id), s);
      for (const s of sFromClass || []) byId.set(String(s.id), s);

      const allowedSubjectSet = new Set(allowedSessionSubjectIds);
      const sessions = Array.from(byId.values())
        .map((s: any) => ({
          id: String(s.id),
          class_id: s.class_id ? String(s.class_id) : null,
          subject_id: s.subject_id ? String(s.subject_id) : null,
          started_at: String(s.started_at),
          actual_call_at: s.actual_call_at ? String(s.actual_call_at) : null,
          expected_minutes: Number(s.expected_minutes || 0),
          teacher_id: s.teacher_id ? String(s.teacher_id) : null,
          created_by: s.created_by ? String(s.created_by) : null,
        }))
        .filter(
          (session) =>
            !subject_id ||
            Boolean(
              session.subject_id && allowedSubjectSet.has(session.subject_id),
            ),
        );

      const classIdsFromSessions = Array.from(
        new Set(sessions.map((s) => s.class_id).filter(Boolean))
      ) as string[];

      let classes: { id: string; label: string }[] = [];
      if (classIdsForTeacher.length) {
        const { data: clsA } = await srv
          .from("classes")
          .select("id,label")
          .in("id", classIdsForTeacher);
        classes = (clsA || []).map((c: any) => ({
          id: String(c.id),
          label: String(c.label ?? ""),
        }));
      }

      const known = new Set(classes.map((c) => c.id));
      const missingClasses = classIdsFromSessions.filter((id) => !known.has(id));
      if (missingClasses.length) {
        const { data: clsB } = await srv
          .from("classes")
          .select("id,label")
          .in("id", missingClasses);
        const extra = (clsB || []).map((c: any) => ({
          id: String(c.id),
          label: String(c.label ?? ""),
        }));
        classes = [...classes, ...extra];
      }

      classes.sort((a, b) => a.label.localeCompare(b.label, "fr"));

      let slots: { start: string; end: string }[] = [];
      if (usePeriods && instForSlots) {
        slots = await buildInstitutionSlots(srv, instForSlots);
      } else {
        slots = buildUniformSlots(startHour, endHour, slotMin);
      }

      const TZ = "Africa/Abidjan";
      const fmtYMD = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const fmtHM = new Intl.DateTimeFormat("fr-FR", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const getHM = (d: Date) => {
        const parts = fmtHM.formatToParts(d);
        const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
        const m = parseInt(
          parts.find((p) => p.type === "minute")?.value || "0",
          10
        );
        return { h, m };
      };

      const classIdSet = new Set(classes.map((c) => c.id));
      const datesSet = new Set(dates);

      // key = `${date}|${slotStart}|${classId}` -> ["HH:MM"] (UNIQUE : 1 seul clic)
      const cells: Record<string, string[]> = {};
      const cellsMeta: Record<
        string,
        { hhmm: string; origin?: "teacher" | "class_device" | "other" }[]
      > = {};

      const slotStarts = slots.map((s) => s.start);

      function slotStartForHM(hhmm: string): string | null {
        if (!hhmm) return null;
        if (slotStarts.includes(hhmm)) return hhmm;

        if (usePeriods) {
          const t = hmToMin(hhmm);
          for (const sl of slots) {
            const a = hmToMin(sl.start);
            const b = hmToMin(sl.end);
            if (t >= a && t < b) return sl.start;
          }
          return null;
        }

        const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
        if (!isFinite(h) || !isFinite(m)) return null;
        return bucketToSlotStartAligned(h, m, slotMin, startHour, endHour);
      }

      // Remplit les cellules : 1 cellule = 1 classe, 1 créneau
      for (const s of sessions) {
        if (!s.class_id || !classIdSet.has(s.class_id)) continue;
        if (!s.actual_call_at) continue;

        const sched = new Date(s.started_at);
        const dateKey = fmtYMD.format(sched);
        if (!datesSet.has(dateKey)) continue;

        const schedHM = (() => {
          const { h, m } = getHM(sched);
          return `${pad2(h)}:${pad2(m)}`;
        })();

        const slotKey = slotStartForHM(schedHM);
        if (!slotKey) continue;

        const slotObj = slots.find((x) => x.start === slotKey);
        if (!slotObj) continue;

        const slotLen = Math.max(0, hmToMin(slotObj.end) - hmToMin(slotObj.start));
        if (slotLen <= 0) continue;

        // clic doit être DANS le créneau (slotLen)
        const delta = diffMinutes(s.started_at, s.actual_call_at);
        if (delta < 0 || delta >= slotLen) continue;

        const click = new Date(s.actual_call_at);
        const clickHM = (() => {
          const { h, m } = getHM(click);
          return `${pad2(h)}:${pad2(m)}`;
        })();

        const key = `${dateKey}|${slotKey}|${s.class_id}`;

        // Garder uniquement le clic le plus tôt par cellule (évite double comptage prof + compte-classe)
        const prev = cells[key]?.[0];
        if (!prev || clickHM < prev) {
          cells[key] = [clickHM];

          let origin: "teacher" | "class_device" | "other" = "other";
          if (s.created_by && s.teacher_id && s.created_by === s.teacher_id) origin = "teacher";
          else if (s.created_by) origin = "class_device";

          cellsMeta[key] = [{ hhmm: clickHM, origin }];
        }
      }

      // ✅ Total minutes effectives = 1 fois par CRÉNEAU (date + slotStart), pas par classe
      const slotByStart = new Map(slots.map((s) => [s.start, s]));

      // key = `${date}|${slotStart}` -> earliest clickHM across classes
      const slotClicks: Record<string, string> = {};
      for (const k of Object.keys(cells)) {
        const [dateKey, slotStart] = k.split("|");
        const clickHM = cells[k]?.[0];
        if (!clickHM) continue;
        const sk = `${dateKey}|${slotStart}`;
        const prev = slotClicks[sk];
        if (!prev || clickHM < prev) slotClicks[sk] = clickHM;
      }

      let total_minutes = 0;
      for (const sk of Object.keys(slotClicks)) {
        const [, slotStart] = sk.split("|");
        const sl = slotByStart.get(slotStart);
        if (!sl) continue;

        const slotLen = Math.max(0, hmToMin(sl.end) - hmToMin(sl.start));
        if (slotLen <= 0) continue;

        const clickHM = slotClicks[sk];
        const lateness = Math.max(0, hmToMin(clickHM) - hmToMin(sl.start));
        const eff = Math.max(0, slotLen - lateness);
        total_minutes += eff;
      }

      const total_sessions = Object.keys(slotClicks).length;

      return NextResponse.json({
        teacher: {
          id: teacher_id,
          name: teacherName || "(enseignant)",
          subjects: Array.from(subjectsSet).sort((a, b) => a.localeCompare(b, "fr")),
          total_minutes,
          total_sessions,
        },
        dates,
        classes,
        slots,
        cells,
        cellsMeta,
      });
    }

    /* ====================== SUMMARY / DETAIL ====================== */

    // 1) Base enseignants de l’établissement.
    const { data: ur, error: roleError } = await srv
      .from("user_roles")
      .select("profile_id")
      .eq("institution_id", inst)
      .eq("role", "teacher");

    if (roleError) throw new Error(roleError.message);

    const allTeacherIds: string[] = Array.from(
      new Set<string>(
        (ur || [])
          .map((row: any) => String(row.profile_id || ""))
          .filter(Boolean),
      ),
    );

    // 2) Noms et disciplines connues.
    let qTS = srv
      .from("teacher_subjects")
      .select("profile_id, subject_id, teacher_name, subject_name, institution_id")
      .eq("institution_id", inst);
    if (allTeacherIds.length) qTS = qTS.in("profile_id", allTeacherIds);
    if (subject_id) qTS = qTS.in("subject_id", allowedSessionSubjectIds);
    const { data: tsRows, error: teacherSubjectError } = await qTS;
    if (teacherSubjectError) throw new Error(teacherSubjectError.message);

    const teacherNameById = new Map<string, string>();
    for (const row of tsRows || []) {
      const profileId = String(row.profile_id);
      const name = String(row.teacher_name || "").trim();
      if (name && !teacherNameById.has(profileId)) {
        teacherNameById.set(profileId, name);
      }
    }

    const missingNames = allTeacherIds.filter(
      (id) => !teacherNameById.has(id),
    );
    if (missingNames.length) {
      const { data: profiles, error: profileError } = await srv
        .from("profiles")
        .select("id, display_name, email, phone")
        .eq("institution_id", inst)
        .in("id", missingNames);
      if (profileError) throw new Error(profileError.message);
      for (const profile of profiles || []) {
        teacherNameById.set(String(profile.id), niceName(profile));
      }
    }

    let teacherScope: string[] = allTeacherIds;
    let scopedServiceRows: any[] | null = null;

    if (classScopeActive) {
      if (!scopedClassIds?.length) {
        return mode === "detail"
          ? NextResponse.json({ rows: [], total_minutes: 0, count: 0 })
          : NextResponse.json({ items: [] });
      }

      let servicesQuery = srv
        .from("class_teachers")
        .select("teacher_id,subject_id,class_id")
        .eq("institution_id", inst)
        .in("class_id", scopedClassIds);
      if (subject_id) {
        servicesQuery = servicesQuery.in(
          "subject_id",
          allowedSessionSubjectIds,
        );
      }

      const { data: serviceRows, error: serviceError } = await servicesQuery;
      if (serviceError) throw new Error(serviceError.message);
      const scopedRows: any[] = serviceRows || [];
      scopedServiceRows = scopedRows;

      const allowedTeachers = new Set<string>(
        scopedRows
          .map((row: any) => String(row.teacher_id || ""))
          .filter(Boolean),
      );
      teacherScope = teacherScope.filter((id) => allowedTeachers.has(id));
    } else if (subject_id) {
      const allowedTeachers = new Set(
        (tsRows || []).map((row: any) => String(row.profile_id)),
      );
      teacherScope = teacherScope.filter((id) => allowedTeachers.has(id));
    }

    const subjectNamesPerTeacher: Record<string, string[]> = {};

    if (scopedServiceRows) {
      const serviceSubjectIds = scopedServiceRows
        .map((row: any) => String(row.subject_id || ""))
        .filter(Boolean);
      const serviceSubjectNames = await resolveSubjectNameMap(
        srv,
        serviceSubjectIds,
        inst,
      );

      for (const row of scopedServiceRows) {
        const teacherId = String(row.teacher_id || "");
        const subjectName = serviceSubjectNames[String(row.subject_id || "")];
        if (!teacherId || !subjectName) continue;
        if (!subjectNamesPerTeacher[teacherId]) {
          subjectNamesPerTeacher[teacherId] = [];
        }
        if (!subjectNamesPerTeacher[teacherId].includes(subjectName)) {
          subjectNamesPerTeacher[teacherId].push(subjectName);
        }
      }
    } else {
      for (const row of tsRows || []) {
        const teacherId = String(row.profile_id || "");
        const subjectName = String(row.subject_name || "").trim();
        if (!teacherId || !subjectName) continue;
        if (!subjectNamesPerTeacher[teacherId]) {
          subjectNamesPerTeacher[teacherId] = [];
        }
        if (!subjectNamesPerTeacher[teacherId].includes(subjectName)) {
          subjectNamesPerTeacher[teacherId].push(subjectName);
        }
      }
    }

    for (const teacherId of Object.keys(subjectNamesPerTeacher)) {
      subjectNamesPerTeacher[teacherId].sort((a, b) =>
        a.localeCompare(b, "fr"),
      );
    }

    if (mode === "detail" && teacher_id && !teacherScope.includes(teacher_id)) {
      return NextResponse.json({ rows: [], total_minutes: 0, count: 0 });
    }

    if (!teacherScope.length) {
      return mode === "detail"
        ? NextResponse.json({ rows: [], total_minutes: 0, count: 0 })
        : NextResponse.json({ items: [] });
    }

    // 3) Séances
    const sessionsTable2 =
      (await tableExists(srv, "teacher_sessions"))
        ? "teacher_sessions"
        : (await tableExists(srv, "class_sessions"))
          ? "class_sessions"
          : "sessions";

    const baseSessions = () => {
      let query = srv
        .from(sessionsTable2)
        .select(
          "id, teacher_id, subject_id, class_id, started_at, actual_call_at, expected_minutes, ended_at, status, presence_verified, presence_method, origin, institution_id",
        )
        .eq("institution_id", inst)
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);

      if (classScopeActive) {
        query = query.in("class_id", scopedClassIds || []);
      }

      return query;
    };

    let sessRows: any[] = [];
    if (mode === "detail") {
      if (!teacher_id) {
        return NextResponse.json(
          { error: "teacher_id requis pour mode=detail" },
          { status: 400 },
        );
      }

      let query = baseSessions().eq("teacher_id", teacher_id);
      if (subject_id) {
        query = query.in("subject_id", allowedSessionSubjectIds);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      sessRows = data || [];
    } else {
      let query = baseSessions().in("teacher_id", teacherScope);
      if (subject_id) {
        query = query.in("subject_id", allowedSessionSubjectIds);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      sessRows = data || [];
    }

    // 3.a dédoublonne par ID (au cas où)
    const seen = new Set<string>();
    type SessionRow = {
      id: string;
      teacher_id: string | null;
      subject_id: string | null;
      class_id: string | null;
      started_at: string;
      actual_call_at: string | null;
      expected_minutes: number;
      ended_at: string | null;
      status: string | null;
      presence_verified: boolean | null;
      presence_method: string | null;
      origin: string | null;
    };

    const sessionsRaw: SessionRow[] = (sessRows || [])
      .filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((s: any) => ({
        id: String(s.id),
        teacher_id: s.teacher_id ? String(s.teacher_id) : null,
        subject_id: s.subject_id ? String(s.subject_id) : null,
        class_id: s.class_id ? String(s.class_id) : null,
        started_at: String(s.started_at),
        actual_call_at: s.actual_call_at ? String(s.actual_call_at) : null,
        expected_minutes: Number(s.expected_minutes || 0),
        ended_at: s.ended_at ? String(s.ended_at) : null,
        status: s.status ? String(s.status) : null,
        presence_verified:
          typeof s.presence_verified === "boolean" ? s.presence_verified : null,
        presence_method: s.presence_method ? String(s.presence_method) : null,
        origin: s.origin ? String(s.origin) : null,
      }));

    /**
     * ✅ DÉDOUBLONNAGE "NORMAL" : 1 séance = 1 PROF + 1 JOUR + 1 CRÉNEAU (HH:MM)
     * -> On IGNORE class_id dans la clé de comptage.
     * -> On conserve :
     *    - la 1ère heure started_at (la plus tôt)
     *    - expected_minutes max
     *    - le 1er clic VALIDE (le plus tôt)
     *    - la liste des classes/subjects rencontrés sur ce créneau (pour l’affichage)
     */
    const TZ2 = "Africa/Abidjan";
    const fmtYMD2 = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ2,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const fmtHM2 = new Intl.DateTimeFormat("fr-FR", {
      timeZone: TZ2,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const getDateKeyFromISO = (iso: string) => {
      try {
        return fmtYMD2.format(new Date(iso)); // YYYY-MM-DD
      } catch {
        return String(iso).slice(0, 10);
      }
    };

    const getHMKeyFromISO = (iso: string) => {
      try {
        const parts = fmtHM2.formatToParts(new Date(iso));
        const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
        const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
        const hNum = Number.parseInt(hh, 10);
        const mNum = Number.parseInt(mm, 10);
        return `${pad2(Number.isFinite(hNum) ? hNum : 0)}:${pad2(
          Number.isFinite(mNum) ? mNum : 0
        )}`;
      } catch {
        return "00:00";
      }
    };

    type SlotAgg = SessionRow & {
      _valid_call_at: string | null;
      class_ids: Set<string>;
      subject_ids: Set<string>;
    };

    const sessionsBySlot = new Map<string, SlotAgg>();

    for (const s of sessionsRaw) {
      const tid = s.teacher_id || "";
      if (!tid) continue;

      const day = getDateKeyFromISO(s.started_at);
      const hm = getHMKeyFromISO(s.started_at);

      // ✅ clé "normale" (pas de class_id)
      const key = `${tid}|${day}|${hm}`;

      const validCall =
        s.actual_call_at && isCallWithinPlannedSlot(s.started_at, s.actual_call_at, s.expected_minutes)
          ? s.actual_call_at
          : null;

      const existing = sessionsBySlot.get(key);
      if (!existing) {
        const agg: SlotAgg = {
          ...s,
          _valid_call_at: validCall,
          class_ids: new Set<string>(),
          subject_ids: new Set<string>(),
        };
        if (s.class_id) agg.class_ids.add(String(s.class_id));
        if (s.subject_id) agg.subject_ids.add(String(s.subject_id));
        sessionsBySlot.set(key, agg);
      } else {
        // started_at le plus tôt
        if (s.started_at < existing.started_at) existing.started_at = s.started_at;

        // expected_minutes max
        if ((s.expected_minutes || 0) > (existing.expected_minutes || 0)) {
          existing.expected_minutes = s.expected_minutes;
        }

        if (s.ended_at && (!existing.ended_at || s.ended_at > existing.ended_at)) {
          existing.ended_at = s.ended_at;
        }
        if (!existing.status && s.status) existing.status = s.status;
        if (s.presence_verified === true) existing.presence_verified = true;
        if (!existing.presence_method && s.presence_method) {
          existing.presence_method = s.presence_method;
        }
        if (!existing.origin && s.origin) existing.origin = s.origin;

        // 1er clic VALIDE (le plus tôt)
        if (validCall) {
          if (!existing._valid_call_at || validCall < existing._valid_call_at) {
            existing._valid_call_at = validCall;
          }
        }

        // garde un "représentant" pour compat
        if (!existing.class_id && s.class_id) existing.class_id = s.class_id;
        if (!existing.subject_id && s.subject_id) existing.subject_id = s.subject_id;

        // listes (pour affichage)
        if (s.class_id) existing.class_ids.add(String(s.class_id));
        if (s.subject_id) existing.subject_ids.add(String(s.subject_id));
      }
    }

    // ✅ liste finale : 1 entrée par créneau + UNIQUEMENT si séance effectuée (clic valide)
    type SessionAggOut = SessionRow & { class_ids: string[]; subject_ids: string[] };
    const sessions: SessionAggOut[] = Array.from(sessionsBySlot.values())
      .map(({ _valid_call_at, class_ids, subject_ids, ...rest }) => ({
        ...rest,
        actual_call_at: _valid_call_at,
        class_ids: Array.from(class_ids),
        subject_ids: Array.from(subject_ids),
      }))
      .filter((s: any) => !!s.actual_call_at);

    /* ======================== SUMMARY ======================== */
    if (mode === "summary") {
      type ControlCounters = {
        scheduled_count: number;
        opened_count: number;
        closed_count: number;
        not_opened_count: number;
        not_closed_count: number;
        approved_absence_count: number;
        pending_absence_count: number;
        unjustified_absence_count: number;
        unplanned_opened_count: number;
        observed_minutes: number;
      };

      const emptyCounters = (): ControlCounters => ({
        scheduled_count: 0,
        opened_count: 0,
        closed_count: 0,
        not_opened_count: 0,
        not_closed_count: 0,
        approved_absence_count: 0,
        pending_absence_count: 0,
        unjustified_absence_count: 0,
        unplanned_opened_count: 0,
        observed_minutes: 0,
      });

      const minutesByTeacher = new Map<string, number>();
      const controlByTeacher = new Map<string, ControlCounters>();

      for (const id of teacherScope) {
        minutesByTeacher.set(id, 0);
        controlByTeacher.set(id, emptyCounters());
      }

      for (const session of sessions) {
        const teacherId = session.teacher_id || "";
        if (!teacherId || !minutesByTeacher.has(teacherId)) continue;

        const effective = effectiveMinutesFromSession(
          session.expected_minutes || 0,
          session.started_at,
          session.actual_call_at || null,
        );
        minutesByTeacher.set(
          teacherId,
          (minutesByTeacher.get(teacherId) || 0) + effective,
        );
      }

      const { data: periodRows, error: periodError } = await srv
        .from("institution_periods")
        .select("id,weekday,label,start_time,end_time")
        .eq("institution_id", inst);
      if (periodError) throw new Error(periodError.message);

      let timetableQuery = srv
        .from("teacher_timetables")
        .select("id,teacher_id,class_id,subject_id,weekday,period_id")
        .eq("institution_id", inst)
        .in("teacher_id", teacherScope);
      if (classScopeActive) {
        timetableQuery = timetableQuery.in("class_id", scopedClassIds || []);
      }
      if (subject_id) {
        timetableQuery = timetableQuery.in("subject_id", allowedSessionSubjectIds);
      }
      const { data: timetableRows, error: timetableError } = await timetableQuery;
      if (timetableError) throw new Error(timetableError.message);

      let absenceRows: any[] = [];
      try {
        const { data, error } = await srv
          .from("teacher_absence_requests")
          .select("teacher_profile_id,start_date,end_date,status")
          .eq("institution_id", inst)
          .in("teacher_profile_id", teacherScope)
          .lte("start_date", to)
          .gte("end_date", from);
        if (!error) absenceRows = data || [];
      } catch {
        absenceRows = [];
      }

      type PeriodControlRow = {
        id: string;
        weekday: number | null;
        start: string;
        end: string;
        startMin: number;
        endMin: number;
      };
      const periodById = new Map<string, PeriodControlRow>();
      for (const row of periodRows || []) {
        const start = normalizeDbTime((row as any).start_time);
        const end = normalizeDbTime((row as any).end_time);
        if (!start || !end) continue;
        periodById.set(String((row as any).id), {
          id: String((row as any).id),
          weekday: parseWeekday((row as any).weekday),
          start,
          end,
          startMin: hmToMin(start),
          endMin: hmToMin(end),
        });
      }

      const weekdayMode = detectWeekdayMode(
        (periodRows || []).length ? (periodRows as any[]) : (timetableRows || []),
      );
      const controlDates = rangeDates(from, to);
      const todayYmd = getDateKeyFromISO(new Date().toISOString());
      const now = new Date();
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

      type PlannedOccurrence = {
        key: string;
        teacher_id: string;
        ymd: string;
        start: string;
        end: string;
        expected_minutes: number;
        class_ids: Set<string>;
        subject_ids: Set<string>;
      };
      const plannedByKey = new Map<string, PlannedOccurrence>();

      for (const row of timetableRows || []) {
        const teacherId = String((row as any).teacher_id || "");
        const period = periodById.get(String((row as any).period_id || ""));
        if (!teacherId || !period) continue;

        const rawWeekday = period.weekday ?? parseWeekday((row as any).weekday);
        if (rawWeekday === null) continue;

        for (const ymd of controlDates) {
          if (ymd > todayYmd) continue;
          const dateWeekday = jsDayToDbWeekday(weekdayForYmd(ymd), weekdayMode);
          if (dateWeekday !== rawWeekday) continue;
          if (ymd === todayYmd && period.endMin > nowMinutes) continue;

          const key = `${teacherId}|${ymd}|${period.start}`;
          const existing = plannedByKey.get(key);
          if (existing) {
            const classId = String((row as any).class_id || "");
            const subjectId = String((row as any).subject_id || "");
            if (classId) existing.class_ids.add(classId);
            if (subjectId) existing.subject_ids.add(subjectId);
            continue;
          }

          const planned: PlannedOccurrence = {
            key,
            teacher_id: teacherId,
            ymd,
            start: period.start,
            end: period.end,
            expected_minutes: Math.max(0, period.endMin - period.startMin),
            class_ids: new Set<string>(),
            subject_ids: new Set<string>(),
          };
          const classId = String((row as any).class_id || "");
          const subjectId = String((row as any).subject_id || "");
          if (classId) planned.class_ids.add(classId);
          if (subjectId) planned.subject_ids.add(subjectId);
          plannedByKey.set(key, planned);
        }
      }

      const absenceByTeacherDate = new Map<string, "approved" | "pending">();
      for (const row of absenceRows) {
        const teacherId = String(row.teacher_profile_id || "");
        const startDate = String(row.start_date || "").slice(0, 10);
        const endDate = String(row.end_date || "").slice(0, 10);
        const status = String(row.status || "");
        if (!teacherId || !startDate || !endDate || !["approved", "pending"].includes(status)) {
          continue;
        }
        for (const ymd of controlDates) {
          if (ymd < startDate || ymd > endDate) continue;
          const key = `${teacherId}|${ymd}`;
          const existing = absenceByTeacherDate.get(key);
          if (status === "approved" || !existing) {
            absenceByTeacherDate.set(key, status as "approved" | "pending");
          }
        }
      }

      const sessionByControlKey = new Map<string, SessionAggOut>();
      for (const session of sessions) {
        const teacherId = session.teacher_id || "";
        if (!teacherId) continue;
        const key = `${teacherId}|${getDateKeyFromISO(session.started_at)}|${getHMKeyFromISO(session.started_at)}`;
        sessionByControlKey.set(key, session);
      }

      for (const planned of plannedByKey.values()) {
        const counters = controlByTeacher.get(planned.teacher_id);
        if (!counters) continue;
        counters.scheduled_count += 1;

        const session = sessionByControlKey.get(planned.key);
        if (session) {
          counters.opened_count += 1;
          if (session.ended_at) {
            counters.closed_count += 1;
            counters.observed_minutes += observedClosedMinutes({
              actualCallAt: session.actual_call_at,
              endedAt: session.ended_at,
              expectedMinutes:
                session.expected_minutes || planned.expected_minutes,
            });
          } else {
            counters.not_closed_count += 1;
          }
          continue;
        }

        counters.not_opened_count += 1;
        const absence = absenceByTeacherDate.get(
          `${planned.teacher_id}|${planned.ymd}`,
        );
        if (absence === "approved") counters.approved_absence_count += 1;
        else if (absence === "pending") counters.pending_absence_count += 1;
        else counters.unjustified_absence_count += 1;
      }

      for (const [key, session] of sessionByControlKey.entries()) {
        if (plannedByKey.has(key)) continue;
        const teacherId = session.teacher_id || "";
        const counters = controlByTeacher.get(teacherId);
        if (!counters) continue;
        counters.unplanned_opened_count += 1;
      }

      const items = teacherScope.map((id) => {
        const counters = controlByTeacher.get(id) || emptyCounters();
        return {
          teacher_id: id,
          teacher_name:
            teacherNameById.get(id) || `(enseignant ${id.slice(0, 6)})`,
          total_minutes: minutesByTeacher.get(id) || 0,
          observed_minutes: counters.observed_minutes,
          sessions_count: counters.opened_count,
          scheduled_count: counters.scheduled_count,
          opened_count: counters.opened_count,
          closed_count: counters.closed_count,
          not_opened_count: counters.not_opened_count,
          not_closed_count: counters.not_closed_count,
          approved_absence_count: counters.approved_absence_count,
          pending_absence_count: counters.pending_absence_count,
          unjustified_absence_count: counters.unjustified_absence_count,
          unplanned_opened_count: counters.unplanned_opened_count,
          presence_rate: pct(counters.opened_count, counters.scheduled_count),
          closure_rate: pct(counters.closed_count, counters.opened_count),
          completion_rate: pct(counters.closed_count, counters.scheduled_count),
          subject_names: subjectNamesPerTeacher[id] || [],
        };
      });

      items.sort(
        (a, b) =>
          (b.unjustified_absence_count || 0) -
            (a.unjustified_absence_count || 0) ||
          (b.not_closed_count || 0) - (a.not_closed_count || 0) ||
          (a.presence_rate || 0) - (b.presence_rate || 0) ||
          a.teacher_name.localeCompare(b.teacher_name, "fr"),
      );

      return NextResponse.json({
        items,
        definitions: {
          scheduled_count:
            "Cours arrivés à échéance selon les emplois du temps officiels.",
          opened_count:
            "Cours pour lesquels un démarrage valide a été enregistré dans le créneau.",
          closed_count: "Cours ouverts puis clôturés.",
          not_opened_count: "Cours prévus arrivés à échéance mais non ouverts.",
          not_closed_count: "Cours ouverts mais non clôturés.",
          unplanned_opened_count:
            "Cours ouverts sans occurrence correspondante dans le planning filtré.",
        },
        payroll_basis: false,
      });
    }

    /* ======================== DETAIL ======================== */

    // Subjects à résoudre (tous les subject_ids rencontrés sur les créneaux)
    const subIds = Array.from(
      new Set(sessions.flatMap((s) => (s.subject_ids || []).filter(Boolean)))
    ) as string[];

    const subjectNameById: Record<string, string> = {};
    if (subIds.length) {
      const { data: subs } = await srv
        .from("subjects")
        .select("id,name")
        .in("id", subIds);
      for (const s of subs || []) {
        subjectNameById[String(s.id)] = String(s.name ?? "");
      }

      // résout aussi les institution_subjects.id
      const unresolved = subIds.filter((id) => !subjectNameById[id]);
      if (unresolved.length) {
        const { data: links } = await srv
          .from("institution_subjects")
          .select("id,subject_id")
          .in("id", unresolved);
        const baseIds = Array.from(
          new Set((links || []).map((l: any) => String(l.subject_id)).filter(Boolean))
        );
        if (baseIds.length) {
          const { data: subs2 } = await srv
            .from("subjects")
            .select("id,name")
            .in("id", baseIds);
          const nameByBase = new Map<string, string>();
          for (const s of subs2 || []) {
            nameByBase.set(String(s.id), String(s.name ?? ""));
          }
          for (const l of links || []) {
            const nm = nameByBase.get(String(l.subject_id));
            if (nm) subjectNameById[String(l.id)] = nm;
          }
        }
      }
    }

    // Classes à résoudre (tous les class_ids rencontrés sur les créneaux)
    const classIds = Array.from(
      new Set(sessions.flatMap((s) => (s.class_ids || []).filter(Boolean)))
    ) as string[];

    const classLabelById: Record<string, string> = {};
    if (classIds.length) {
      const { data: klass } = await srv
        .from("classes")
        .select("id,label")
        .in("id", classIds);
      for (const c of klass || []) {
        classLabelById[String(c.id)] = String(c.label ?? "");
      }
    }

    const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

    const detailed = sessions
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((r) => {
        const real = effectiveMinutesFromSession(
          r.expected_minutes || 0,
          r.started_at,
          r.actual_call_at || null
        );

        const classLabels = unique(
          (r.class_ids || [])
            .map((id) => classLabelById[id])
            .filter((x) => !!x)
        );
        const classLabelJoined = classLabels.length ? classLabels.join(" + ") : null;

        const subjNames = unique(
          (r.subject_ids || [])
            .map((id) => subjectNameById[id])
            .filter((x) => !!x)
        );
        const subjJoined = subjNames.length ? subjNames.join(" / ") : "Discipline non renseignée";

        const lateMinutes = Math.max(
          0,
          diffMinutes(r.started_at, r.actual_call_at || null),
        );
        const observedMinutes = observedClosedMinutes({
          actualCallAt: r.actual_call_at || null,
          endedAt: r.ended_at || null,
          expectedMinutes: r.expected_minutes || 0,
        });

        return {
          id: r.id,
          dateISO: r.started_at,
          subject_name: subjJoined,
          subject_ids: r.subject_ids || [],
          class_id: (r.class_ids && r.class_ids[0]) || r.class_id || null, // compat
          class_label: classLabelJoined,
          class_ids: r.class_ids || [],
          expected_minutes: r.expected_minutes || 0,
          real_minutes: real,
          observed_minutes: observedMinutes,
          actual_call_iso: r.actual_call_at || null,
          ended_at: r.ended_at || null,
          session_state: r.ended_at ? "closed" : "open",
          status: r.status || null,
          presence_verified: r.presence_verified,
          presence_method: r.presence_method || null,
          origin: r.origin || null,
          late_minutes: lateMinutes,
        };
      });

    const total_minutes = detailed.reduce((acc, it) => acc + (it.real_minutes || 0), 0);
    const total_observed_minutes = detailed.reduce(
      (acc, it) => acc + (it.observed_minutes || 0),
      0,
    );

    return NextResponse.json({
      rows: detailed,
      count: detailed.length,
      total_minutes,
      total_observed_minutes,
      payroll_basis: false,
    });
  } catch (e: any) {
    console.error("/api/admin/statistics error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
