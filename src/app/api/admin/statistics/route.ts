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
  return { fromISO: fromLocal.toISOString(), toISOExclusive: toLocalNext.toISOString() };
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
async function resolveSessionSubjectIds(db: any, baseSubjectId: string, institutionId: string | null): Promise<string[]> {
  const ids = new Set<string>([baseSubjectId]);
  try {
    let q = db.from("institution_subjects").select("id, subject_id").eq("subject_id", baseSubjectId);
    if (institutionId) q = q.eq("institution_id", institutionId);
    const { data: links } = await q;
    for (const l of links || []) ids.add(String(l.id));
  } catch {}
  return Array.from(ids);
}

/* ───────── helpers timesheet ───────── */
const pad2 = (n: number) => String(n).padStart(2, "0");
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
function buildSlots(startHour: number, endHour: number, slotMin: number) {
  const slots: { start: string; end: string }[] = [];
  const first = startHour * 60;
  const last = endHour * 60;
  for (let m = first; m + slotMin <= last; m += slotMin) {
    const sh = Math.floor(m / 60), sm = m % 60;
    const eh = Math.floor((m + slotMin) / 60), em = (m + slotMin) % 60;
    slots.push({ start: `${pad2(sh)}:${pad2(sm)}`, end: `${pad2(eh)}:${pad2(em)}` });
  }
  return slots;
}
/** ancre l’arrondi sur startHour et coupe hors plage */
function bucketToSlotStartAligned(h: number, min: number, slotMin: number, startHour: number, endHour: number): string | null {
  const t = h * 60 + min;
  const first = startHour * 60;
  const last  = endHour   * 60;
  if (t < first || t >= last) return null;
  const k = Math.floor((t - first) / slotMin);
  const v = first + k * slotMin;
  return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
}

/* ───────────────────────────────────── */
export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const rls = await getSupabaseServerClient();

  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "summary") as "summary" | "detail" | "timesheet";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const subject_id = searchParams.get("subject_id") || null;
    const teacher_id = searchParams.get("teacher_id") || null;

    if (!from || !to) return NextResponse.json({ error: "from & to requis (YYYY-MM-DD)" }, { status: 400 });
    const { fromISO, toISOExclusive } = toDayRange(from, to);

    // Établissement de l’utilisateur courant (RLS)
    const { data: { user } } = await rls.auth.getUser();
    let inst: string | null = null;
    if (user) {
      const { data: me } = await rls.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
      inst = (me?.institution_id as string) || null;
    }

    /* ============================ TIMESHEET ============================ */
    if (mode === "timesheet") {
      if (!teacher_id) return NextResponse.json({ error: "teacher_id requis pour mode=timesheet" }, { status: 400 });

      const slotMin   = Math.max(1, parseInt(searchParams.get("slot") || "60", 10));
      const startHour = Math.min(23, Math.max(0, parseInt(searchParams.get("start_hour") || "7", 10)));
      const endHour   = Math.min(24, Math.max(1, parseInt(searchParams.get("end_hour") || "18", 10)));

      const dates = rangeDates(from, to);
      const slots = buildSlots(startHour, endHour, slotMin);

      // Nom + disciplines
      const subjectsSet = new Set<string>();
      let teacherName: string | null = null;
      {
        let q = srv.from("teacher_subjects").select("profile_id, subject_name, teacher_name");
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
            .eq("id", teacher_id).maybeSingle();
          if (p) teacherName = niceName(p);
        }
      }

      // tables
      const sessionsTable =
        (await tableExists(srv, "teacher_sessions")) ? "teacher_sessions" :
        (await tableExists(srv, "class_sessions"))   ? "class_sessions"   : "sessions";

      // ➤ Paires (class_id, subject_id) attribuées à CE prof
      let qCT = srv.from("class_teachers").select("class_id, subject_id").eq("teacher_id", teacher_id);
      if (inst) qCT = qCT.eq("institution_id", inst);
      const { data: ctPairs } = await qCT;
      const pairKey = (c?: string|null, s?: string|null) => `${c ?? ""}|${s ?? ""}`;
      const allowedPairs = new Set<string>((ctPairs || []).map(r => pairKey(String(r.class_id), r.subject_id ? String(r.subject_id) : null)));

      // 1) séances où teacher_id == prof
      let q1 = srv.from(sessionsTable)
        .select("id, teacher_id, class_id, subject_id, started_at, actual_call_at, expected_minutes, institution_id")
        .eq("teacher_id", teacher_id)
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);
      if (inst) q1 = q1.eq("institution_id", inst);
      const { data: sOwn } = await q1;

      // 2) + séances ouvertes par un compte-classe mais attribuables au prof via class_teachers
      const classIdsForTeacher = Array.from(new Set((ctPairs || []).map(r => String(r.class_id))));
      let sFromClass: any[] = [];
      if (classIdsForTeacher.length) {
        let q2 = srv.from(sessionsTable)
          .select("id, teacher_id, class_id, subject_id, started_at, actual_call_at, expected_minutes, institution_id, created_by")
          .in("class_id", classIdsForTeacher)
          .gte("started_at", fromISO)
          .lt("started_at", toISOExclusive);
        if (inst) q2 = q2.eq("institution_id", inst);
        const { data: sRaw } = await q2;
        sFromClass = (sRaw || []).filter(r =>
          allowedPairs.has(pairKey(r.class_id ? String(r.class_id) : null, r.subject_id ? String(r.subject_id) : null))
        );
      }

      // union dédupliquée
      const byId = new Map<string, any>();
      for (const s of (sOwn || [])) byId.set(String(s.id), s);
      for (const s of (sFromClass || [])) byId.set(String(s.id), s);
      const sessions = Array.from(byId.values()).map((s: any) => ({
        id: String(s.id),
        class_id: s.class_id ? String(s.class_id) : null,
        subject_id: s.subject_id ? String(s.subject_id) : null,
        started_at: String(s.started_at),
        actual_call_at: s.actual_call_at ? String(s.actual_call_at) : null,
        expected_minutes: Number(s.expected_minutes || 0),
      }));

      // Colonnes = classes pivot ∪ classes vues
      const classIdsFromSessions = Array.from(new Set(sessions.map(s => s.class_id).filter(Boolean))) as string[];
      let classes: { id: string; label: string }[] = [];
      if (classIdsForTeacher.length) {
        const { data: clsA } = await srv.from("classes").select("id,label").in("id", classIdsForTeacher);
        classes = (clsA || []).map((c: any) => ({ id: String(c.id), label: String(c.label ?? "") }));
      }
      const known = new Set(classes.map(c => c.id));
      const missing = classIdsFromSessions.filter(id => !known.has(id));
      if (missing.length) {
        const { data: clsB } = await srv.from("classes").select("id,label").in("id", missing);
        const extra = (clsB || []).map((c: any) => ({ id: String(c.id), label: String(c.label ?? "") }));
        classes = [...classes, ...extra];
      }
      classes.sort((a, b) => a.label.localeCompare(b.label, "fr"));

      // === Placement en cellules ===
      // Règle : le BUCKET (créneau) est basé sur started_at (horaire prévu),
      //         l'heure affichée dans la cellule est actual_call_at (heure du clic), sinon fallback started_at.
      // Tout est calculé/affiché en zone Africa/Abidjan.
      const TZ = "Africa/Abidjan";
      const fmtYMD = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
      const fmtHM  = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
      const getHM = (d: Date) => {
        const parts = fmtHM.formatToParts(d);
        const h = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
        const m = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
        return { h, m };
      };

      const classIdSet = new Set(classes.map(c => c.id));
      const datesSet = new Set(dates);
      const cells: Record<string, string[]> = {};

      for (const s of sessions) {
        if (!s.class_id || !classIdSet.has(s.class_id)) continue;

        const sched = new Date(s.started_at);                     // pour le créneau
        const click = new Date(s.actual_call_at || s.started_at); // pour l'heure affichée

        // Date de rangement (créneau) en Abidjan
        const dateKey = fmtYMD.format(sched);                     // "YYYY-MM-DD"
        if (!datesSet.has(dateKey)) continue;

        // Slot basé sur l'heure/min du "sched" (Abidjan)
        const { h: sh, m: sm } = getHM(sched);
        const slotKey = bucketToSlotStartAligned(sh, sm, slotMin, startHour, endHour);
        if (!slotKey) continue;

        // Heure affichée dans la cellule = click (Abidjan)
        const { h, m } = getHM(click);
        const hhmm = `${pad2(h)}:${pad2(m)}`;

        const key = `${dateKey}|${slotKey}|${s.class_id}`;
        if (!cells[key]) cells[key] = [];
        if (!cells[key].includes(hhmm)) cells[key].push(hhmm);
      }
      for (const k of Object.keys(cells)) cells[k].sort((a, b) => a.localeCompare(b));

      const total_minutes = sessions.reduce((acc, s) => acc + (s.expected_minutes || 0), 0);

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
      });
    }

    /* ====================== SUMMARY / DETAIL (corrigés) ====================== */

    // 1) Base enseignants (de l’établissement)
    let qUR = srv.from("user_roles").select("profile_id").eq("role", "teacher");
    if (inst) qUR = qUR.eq("institution_id", inst);
    const { data: ur } = await qUR;
    const allTeacherIds = Array.from(new Set((ur || []).map((r: any) => String(r.profile_id))));

    // 2) Noms & disciplines depuis teacher_subjects
    let qTS = srv.from("teacher_subjects").select("profile_id, subject_id, teacher_name, subject_name, institution_id");
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
      if (!subjectNamesPerTeacher[tid].includes(nm)) subjectNamesPerTeacher[tid].push(nm);
    }
    for (const k of Object.keys(subjectNamesPerTeacher)) {
      subjectNamesPerTeacher[k].sort((a, b) => a.localeCompare(b, "fr"));
    }

    let teacherScope: string[] = allTeacherIds;
    if (subject_id) {
      const allowed = new Set((tsRows || []).map((r: any) => String(r.profile_id)));
      teacherScope = teacherScope.filter((id) => allowed.has(id));
    }

    // 3) Séances (⚠️ on inclut class_id)
    const sessionsTable2 =
      (await tableExists(srv, "teacher_sessions")) ? "teacher_sessions" :
      (await tableExists(srv, "class_sessions")) ? "class_sessions" : "sessions";

    const baseSessions = () => {
      let q = srv
        .from(sessionsTable2)
        .select("id, teacher_id, subject_id, class_id, started_at, expected_minutes, institution_id")
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);
      if (inst) q = q.eq("institution_id", inst);
      return q;
    };

    const allowedSessionSubjectIds = subject_id ? await resolveSessionSubjectIds(srv, subject_id, inst) : [];

    let sessRows: any[] = [];
    if (mode === "detail") {
      if (!teacher_id) return NextResponse.json({ error: "teacher_id requis pour mode=detail" }, { status: 400 });
      let q = baseSessions().eq("teacher_id", teacher_id);
      if (subject_id) {
        const { data: withSubj } = await q.in("subject_id", allowedSessionSubjectIds);
        const { data: noSubj } = await baseSessions().eq("teacher_id", teacher_id).is("subject_id", null);
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
        const { data: noSubj } = await baseSessions().in("teacher_id", teacherScope).is("subject_id", null);
        sessRows = [...(withSubj || []), ...(noSubj || [])];
      } else {
        const { data } = await q;
        sessRows = data || [];
      }
    }

    const seen = new Set<string>();
    const sessions = (sessRows || [])
      .filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((s: any) => ({
        id: String(s.id),
        teacher_id: s.teacher_id ? String(s.teacher_id) : null,
        subject_id: s.subject_id ? String(s.subject_id) : null,
        class_id: s.class_id ? String(s.class_id) : null,
        started_at: String(s.started_at),
        expected_minutes: Number(s.expected_minutes || 0),
      }));

    if (mode === "summary") {
      const minutesByTeacher = new Map<string, number>();
      for (const id of teacherScope) minutesByTeacher.set(id, 0);
      for (const r of sessions) {
        const tid = r.teacher_id || "";
        if (!tid || !minutesByTeacher.has(tid)) continue;
        minutesByTeacher.set(tid, (minutesByTeacher.get(tid) || 0) + (r.expected_minutes || 0));
      }

      const items = teacherScope.map((id) => ({
        teacher_id: id,
        teacher_name: teacherNameById.get(id) || `(enseignant ${id.slice(0, 6)})`,
        total_minutes: minutesByTeacher.get(id) || 0,
        subject_names: subjectNamesPerTeacher[id] || [],
      }));

      items.sort((a, b) => b.total_minutes - a.total_minutes || a.teacher_name.localeCompare(b.teacher_name, "fr"));
      return NextResponse.json({ items });
    }

    // DETAIL (avec classe)
    const subIds = Array.from(new Set(sessions.map((s) => s.subject_id).filter(Boolean))) as string[];
    const subjectNameById: Record<string, string> = {};
    if (subIds.length) {
      const { data: subs } = await srv.from("subjects").select("id,name").in("id", subIds);
      for (const s of subs || []) subjectNameById[String(s.id)] = String(s.name ?? "");
      const unresolved = subIds.filter((id) => !subjectNameById[id]);
      if (unresolved.length) {
        const { data: links } = await srv.from("institution_subjects").select("id,subject_id").in("id", unresolved);
        const baseIds = Array.from(new Set((links || []).map((l: any) => String(l.subject_id)).filter(Boolean)));
        if (baseIds.length) {
          const { data: subs2 } = await srv.from("subjects").select("id,name").in("id", baseIds);
          const nameByBase = new Map<string, string>();
          for (const s of subs2 || []) nameByBase.set(String(s.id), String(s.name ?? ""));
          for (const l of links || []) {
            const nm = nameByBase.get(String(l.subject_id));
            if (nm) subjectNameById[String(l.id)] = nm;
          }
        }
      }
    }

    // Libellés classe
    const classIds = Array.from(new Set(sessions.map((s) => s.class_id).filter(Boolean))) as string[];
    const classLabelById: Record<string, string> = {};
    if (classIds.length) {
      const { data: klass } = await srv.from("classes").select("id,label").in("id", classIds);
      for (const c of klass || []) classLabelById[String(c.id)] = String(c.label ?? "");
    }

    const detailed = sessions
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((r) => ({
        id: r.id,
        dateISO: r.started_at,
        subject_name: r.subject_id ? subjectNameById[r.subject_id] || "Discipline non renseignée" : "Discipline non renseignée",
        class_id: r.class_id,
        class_label: r.class_id ? (classLabelById[r.class_id] || null) : null,
        expected_minutes: r.expected_minutes || 0,
      }));

    const total_minutes = detailed.reduce((acc, it) => acc + (it.expected_minutes || 0), 0);
    return NextResponse.json({ rows: detailed, count: detailed.length, total_minutes });
  } catch (e: any) {
    console.error("/api/admin/statistics error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
