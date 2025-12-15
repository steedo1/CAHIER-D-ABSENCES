// src/app/api/admin/statistics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

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
  const ln = String(p?.last_name ?? "").trim();
  const fn = String(p?.first_name ?? "").trim();
  const em = String(p?.email ?? "").trim();
  const ph = String(p?.phone ?? "").trim();
  const emLocal = em.includes("@") ? em.split("@")[0] : em;
  const id = String(p?.id ?? "");
  return dn || `${ln} ${fn}`.trim() || emLocal || ph || `(enseignant ${id.slice(0, 6)})`;
}

async function tableExists(db: any, name: string) {
  const { error } = await db.from(name).select("*").limit(1);
  return !error;
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
 * - si expected_minutes manquant/0 → on prend 60 min par défaut (évite de perdre des séances)
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
  return actual >= start && actual < end; // strict : 08:00 n'appartient pas à 07:00–08:00
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

    if (!from || !to)
      return NextResponse.json(
        { error: "from & to requis (YYYY-MM-DD)" },
        { status: 400 }
      );

    const { fromISO, toISOExclusive } = toDayRange(from, to);

    // Établissement de l’utilisateur courant (RLS)
    const {
      data: { user },
    } = await rls.auth.getUser();
    let inst: string | null = null;
    if (user) {
      const { data: me } = await rls
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle();
      inst = (me?.institution_id as string) || null;
    }

    /* ============================ TIMESHEET ============================ */
    if (mode === "timesheet") {
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

      let instForSlots = inst;
      if (usePeriods && !instForSlots) {
        const { data: profInst } = await srv
          .from("profiles")
          .select("institution_id")
          .eq("id", teacher_id)
          .maybeSingle();
        instForSlots = (profInst?.institution_id as string) || null;
      }

      const subjectsSet = new Set<string>();
      let teacherName: string | null = null;
      {
        let q = srv
          .from("teacher_subjects")
          .select("profile_id, subject_name, teacher_name");
        if (inst) q = q.eq("institution_id", inst);
        const { data: ts } = await q.eq("profile_id", teacher_id);
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
            .select("id, display_name, first_name, last_name, email, phone")
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

      let qCT = srv
        .from("class_teachers")
        .select("class_id, subject_id")
        .eq("teacher_id", teacher_id);
      if (inst) qCT = qCT.eq("institution_id", inst);
      const { data: ctPairs } = await qCT;

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
        .eq("teacher_id", teacher_id)
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);
      if (inst) q1 = q1.eq("institution_id", inst);
      const { data: sOwn } = await q1;

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
          .in("class_id", classIdsForTeacher)
          .gte("started_at", fromISO)
          .lt("started_at", toISOExclusive);
        if (inst) q2 = q2.eq("institution_id", inst);
        const { data: sRaw } = await q2;
        sFromClass = (sRaw || []).filter((r) =>
          allowedPairs.has(
            pairKey(
              r.class_id ? String(r.class_id) : null,
              r.subject_id ? String(r.subject_id) : null
            )
          )
        );
      }

      // Dédupe par ID seulement (on dédoublonnera ensuite PAR CRÉNEAU dans les cells)
      const byId = new Map<string, any>();
      for (const s of sOwn || []) byId.set(String(s.id), s);
      for (const s of sFromClass || []) byId.set(String(s.id), s);

      const sessions = Array.from(byId.values()).map((s: any) => ({
        id: String(s.id),
        class_id: s.class_id ? String(s.class_id) : null,
        subject_id: s.subject_id ? String(s.subject_id) : null,
        started_at: String(s.started_at),
        actual_call_at: s.actual_call_at ? String(s.actual_call_at) : null,
        expected_minutes: Number(s.expected_minutes || 0),
        teacher_id: s.teacher_id ? String(s.teacher_id) : null,
        created_by: s.created_by ? String(s.created_by) : null,
      }));

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

      // ✅ Remplit les cellules uniquement si :
      // - actual_call_at existe
      // - clic DANS le créneau (pas après la fin)
      // - et on garde UN SEUL clic (le plus tôt) par cellule
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

        // ✅ clic doit être dans le créneau (basé sur la durée du slot)
        const delta = diffMinutes(s.started_at, s.actual_call_at);
        if (delta < 0 || delta >= slotLen) continue;

        const click = new Date(s.actual_call_at);
        const clickHM = (() => {
          const { h, m } = getHM(click);
          return `${pad2(h)}:${pad2(m)}`;
        })();

        const key = `${dateKey}|${slotKey}|${s.class_id}`;

        // Garder uniquement le clic le plus tôt (évite double comptage prof + compte-classe)
        const prev = cells[key]?.[0];
        if (!prev || clickHM < prev) {
          cells[key] = [clickHM];

          let origin: "teacher" | "class_device" | "other" = "other";
          if (s.created_by && s.teacher_id && s.created_by === s.teacher_id)
            origin = "teacher";
          else if (s.created_by) origin = "class_device";

          cellsMeta[key] = [{ hhmm: clickHM, origin }];
        }
      }

      // ✅ Total minutes effectives sur la période (toutes classes), basé sur les cells (donc déjà dédoublonné)
      const slotByStart = new Map(slots.map((s) => [s.start, s]));
      let total_minutes = 0;

      for (const k of Object.keys(cells)) {
        const [d, slotStart] = k.split("|"); // d non utilisé ici, mais ok
        const sl = slotByStart.get(slotStart);
        if (!sl) continue;

        const slotLen = Math.max(0, hmToMin(sl.end) - hmToMin(sl.start));
        const clickHM = cells[k]?.[0];
        if (!clickHM) continue;

        const lateness = Math.max(0, hmToMin(clickHM) - hmToMin(sl.start));
        const eff = Math.max(0, slotLen - lateness);
        total_minutes += eff;
      }

      return NextResponse.json({
        teacher: {
          id: teacher_id,
          name: teacherName || "(enseignant)",
          subjects: Array.from(subjectsSet).sort((a, b) => a.localeCompare(b, "fr")),
          total_minutes,
        },
        dates,
        classes,
        slots,
        cells,
        cellsMeta,
      });
    }

    /* ====================== SUMMARY / DETAIL ====================== */

    // 1) Base enseignants (de l’établissement)
    let qUR = srv.from("user_roles").select("profile_id").eq("role", "teacher");
    if (inst) qUR = qUR.eq("institution_id", inst);
    const { data: ur } = await qUR;

    const allTeacherIds = Array.from(
      new Set((ur || []).map((r: any) => String(r.profile_id)))
    );

    // 2) Noms & disciplines depuis teacher_subjects
    let qTS = srv
      .from("teacher_subjects")
      .select("profile_id, subject_id, teacher_name, subject_name, institution_id");
    if (inst) qTS = qTS.eq("institution_id", inst);
    if (allTeacherIds.length) qTS = qTS.in("profile_id", allTeacherIds);
    if (subject_id) qTS = qTS.eq("subject_id", subject_id);
    const { data: tsRows } = await qTS;

    const teacherNameById = new Map<string, string>();
    for (const r of tsRows || []) {
      const pid = String(r.profile_id);
      const nm = String(r.teacher_name ?? "").trim();
      if (!teacherNameById.has(pid) && nm) teacherNameById.set(pid, nm);
    }

    const missing = allTeacherIds.filter((id) => !teacherNameById.has(id));
    if (missing.length) {
      const { data: profs } = await srv
        .from("profiles")
        .select("id, display_name, first_name, last_name, email, phone")
        .in("id", missing);
      for (const p of profs || []) teacherNameById.set(String(p.id), niceName(p));
    }

    const subjectNamesPerTeacher: Record<string, string[]> = {};
    for (const r of tsRows || []) {
      const tid = String(r.profile_id);
      const nm = String(r.subject_name ?? "").trim();
      if (!nm) continue;
      if (!subjectNamesPerTeacher[tid]) subjectNamesPerTeacher[tid] = [];
      if (!subjectNamesPerTeacher[tid].includes(nm)) {
        subjectNamesPerTeacher[tid].push(nm);
      }
    }

    for (const k of Object.keys(subjectNamesPerTeacher)) {
      subjectNamesPerTeacher[k].sort((a, b) => a.localeCompare(b, "fr"));
    }

    let teacherScope: string[] = allTeacherIds;
    if (subject_id) {
      const allowed = new Set((tsRows || []).map((r: any) => String(r.profile_id)));
      teacherScope = teacherScope.filter((id) => allowed.has(id));
    }

    // 3) Séances
    const sessionsTable2 =
      (await tableExists(srv, "teacher_sessions"))
        ? "teacher_sessions"
        : (await tableExists(srv, "class_sessions"))
          ? "class_sessions"
          : "sessions";

    const baseSessions = () => {
      let q = srv
        .from(sessionsTable2)
        .select(
          "id, teacher_id, subject_id, class_id, started_at, actual_call_at, expected_minutes, institution_id"
        )
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);
      if (inst) q = q.eq("institution_id", inst);
      return q;
    };

    const allowedSessionSubjectIds = subject_id
      ? await resolveSessionSubjectIds(srv, subject_id, inst)
      : [];

    let sessRows: any[] = [];
    if (mode === "detail") {
      if (!teacher_id) {
        return NextResponse.json(
          { error: "teacher_id requis pour mode=detail" },
          { status: 400 }
        );
      }
      let q = baseSessions().eq("teacher_id", teacher_id);
      if (subject_id) {
        const { data: withSubj } = await q.in("subject_id", allowedSessionSubjectIds);
        const { data: noSubj } = await baseSessions()
          .eq("teacher_id", teacher_id)
          .is("subject_id", null);
        sessRows = [...(withSubj || []), ...(noSubj || [])];
      } else {
        const { data } = await q;
        sessRows = data || [];
      }
    } else {
      let q = baseSessions();
      if (teacherScope.length) q = q.in("teacher_id", teacherScope);
      if (subject_id) {
        const { data: withSubj } = await q.in("subject_id", allowedSessionSubjectIds);
        const { data: noSubj } = await baseSessions()
          .in("teacher_id", teacherScope)
          .is("subject_id", null);
        sessRows = [...(withSubj || []), ...(noSubj || [])];
      } else {
        const { data } = await q;
        sessRows = data || [];
      }
    }

    // 3.a on enlève les *mêmes id* (au cas où)
    const seen = new Set<string>();
    type SessionRow = {
      id: string;
      teacher_id: string | null;
      subject_id: string | null;
      class_id: string | null;
      started_at: string;
      actual_call_at: string | null;
      expected_minutes: number;
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
      }));

    /**
     * 3.b DÉDOUBLONNAGE PAR CRÉNEAU (1 séance = 1 prof + 1 classe + 1 jour + 1 HH:MM)
     * ✅ ET on ne garde que les séances réellement effectuées (clic valide dans le créneau)
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

    const sessionsBySlot = new Map<string, any>();

    for (const s of sessionsRaw) {
      const tid = s.teacher_id || "";
      const cid = s.class_id || "";
      const day = getDateKeyFromISO(s.started_at);
      const hm = getHMKeyFromISO(s.started_at);
      const key = `${tid}|${cid}|${day}|${hm}`;

      const validCall =
        s.actual_call_at && isCallWithinPlannedSlot(s.started_at, s.actual_call_at, s.expected_minutes)
          ? s.actual_call_at
          : null;

      const existing = sessionsBySlot.get(key);
      if (!existing) {
        sessionsBySlot.set(key, { ...s, _valid_call_at: validCall });
      } else {
        if (s.started_at < existing.started_at) existing.started_at = s.started_at;

        // ✅ on garde le 1er clic VALIDE (le plus tôt)
        if (validCall) {
          if (!existing._valid_call_at || validCall < existing._valid_call_at) {
            existing._valid_call_at = validCall;
          }
        }

        if ((s.expected_minutes || 0) > (existing.expected_minutes || 0)) {
          existing.expected_minutes = s.expected_minutes;
        }
        if (!existing.subject_id && s.subject_id) {
          existing.subject_id = s.subject_id;
        }
      }
    }

    // ✅ liste finale : 1 entrée par créneau + UNIQUEMENT si séance effectuée (clic valide)
    const sessions: SessionRow[] = Array.from(sessionsBySlot.values())
      .map(({ _valid_call_at, ...rest }) => ({ ...rest, actual_call_at: _valid_call_at }))
      .filter((s: any) => !!s.actual_call_at);

    /* ======================== SUMMARY ======================== */
    if (mode === "summary") {
      const minutesByTeacher = new Map<string, number>();
      const sessionsByTeacher = new Map<string, number>();

      for (const id of teacherScope) {
        minutesByTeacher.set(id, 0);
        sessionsByTeacher.set(id, 0);
      }

      for (const r of sessions) {
        const tid = r.teacher_id || "";
        if (!tid || !minutesByTeacher.has(tid)) continue;

        const real = effectiveMinutesFromSession(
          r.expected_minutes || 0,
          r.started_at,
          r.actual_call_at || null
        );

        minutesByTeacher.set(tid, (minutesByTeacher.get(tid) || 0) + real);
        sessionsByTeacher.set(tid, (sessionsByTeacher.get(tid) || 0) + 1);
      }

      const items = teacherScope.map((id) => ({
        teacher_id: id,
        teacher_name: teacherNameById.get(id) || `(enseignant ${id.slice(0, 6)})`,
        total_minutes: minutesByTeacher.get(id) || 0,
        sessions_count: sessionsByTeacher.get(id) || 0,
        subject_names: subjectNamesPerTeacher[id] || [],
      }));

      items.sort(
        (a, b) =>
          (b.sessions_count || 0) - (a.sessions_count || 0) ||
          a.teacher_name.localeCompare(b.teacher_name, "fr")
      );

      return NextResponse.json({ items });
    }

    /* ======================== DETAIL ======================== */
    const subIds = Array.from(
      new Set(sessions.map((s) => s.subject_id).filter(Boolean))
    ) as string[];

    const subjectNameById: Record<string, string> = {};
    if (subIds.length) {
      const { data: subs } = await srv.from("subjects").select("id,name").in("id", subIds);
      for (const s of subs || []) {
        subjectNameById[String(s.id)] = String(s.name ?? "");
      }
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

    const classIds = Array.from(
      new Set(sessions.map((s) => s.class_id).filter(Boolean))
    ) as string[];

    const classLabelById: Record<string, string> = {};
    if (classIds.length) {
      const { data: klass } = await srv.from("classes").select("id,label").in("id", classIds);
      for (const c of klass || []) {
        classLabelById[String(c.id)] = String(c.label ?? "");
      }
    }

    const detailed = sessions
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((r) => {
        const real = effectiveMinutesFromSession(
          r.expected_minutes || 0,
          r.started_at,
          r.actual_call_at || null
        );
        return {
          id: r.id,
          dateISO: r.started_at,
          subject_name: r.subject_id
            ? subjectNameById[r.subject_id] || "Discipline non renseignée"
            : "Discipline non renseignée",
          class_id: r.class_id,
          class_label: r.class_id ? classLabelById[r.class_id] || null : null,
          expected_minutes: r.expected_minutes || 0,
          real_minutes: real,
          actual_call_iso: r.actual_call_at || null,
        };
      });

    const total_minutes = detailed.reduce((acc, it) => acc + (it.real_minutes || 0), 0);

    return NextResponse.json({
      rows: detailed,
      count: detailed.length,
      total_minutes,
    });
  } catch (e: any) {
    console.error("/api/admin/statistics error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
