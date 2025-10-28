// src/app/api/admin/statistics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

/** Interprète les YYYY-MM-DD venant de <input type="date"> en heure locale.
 *  Renvoie [fromISO inclusif ; toISOExclusive exclusif] pour la requête SQL.
 */
function toDayRange(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);

  // Minuit local du jour de début (inclusif)
  const fromLocal = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  // Minuit local du lendemain du jour de fin (exclusif)
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

/** Pour un subjects.id, renvoie tous les IDs susceptibles d’apparaître dans sessions.subject_id :
 *  - le subjects.id lui-même
 *  - les institution_subjects.id correspondants (dans l’établissement courant si fourni)
 */
async function resolveSessionSubjectIds(
  db: any,
  baseSubjectId: string,
  institutionId: string | null
): Promise<string[]> {
  const ids = new Set<string>([baseSubjectId]);
  try {
    let q = db.from("institution_subjects").select("id, subject_id").eq("subject_id", baseSubjectId);
    if (institutionId) q = q.eq("institution_id", institutionId);
    const { data: links } = await q;
    for (const l of links || []) ids.add(String(l.id));
  } catch {}
  return Array.from(ids);
}

/* ────────────────────────────────────────────────────────────────────────────
   Route
──────────────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient(); // service client (no RLS)
  const rls = await getSupabaseServerClient(); // RLS pour connaître l’établissement

  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "summary") as "summary" | "detail";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const subject_id = searchParams.get("subject_id") || null; // subjects.id attendu
    const teacher_id = searchParams.get("teacher_id") || null;

    if (!from || !to) {
      return NextResponse.json({ error: "from & to requis (YYYY-MM-DD)" }, { status: 400 });
    }
    const { fromISO, toISOExclusive } = toDayRange(from, to);

    // Établissement courant
    const {
      data: { user },
    } = await rls.auth.getUser();
    let inst: string | null = null;
    if (user) {
      const { data: me } = await rls.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
      inst = (me?.institution_id as string) || null;
    }

    // 1) Base enseignants (de l’établissement)
    let qUR = srv.from("user_roles").select("profile_id").eq("role", "teacher");
    if (inst) qUR = qUR.eq("institution_id", inst);
    const { data: ur } = await qUR;
    const allTeacherIds = Array.from(new Set((ur || []).map((r: any) => String(r.profile_id))));

    // 2) Noms & disciplines dénormalisés depuis teacher_subjects
    let qTS = srv
      .from("teacher_subjects")
      .select("profile_id, subject_id, teacher_name, subject_name, institution_id");
    if (inst) qTS = qTS.eq("institution_id", inst);
    if (allTeacherIds.length) qTS = qTS.in("profile_id", allTeacherIds);
    if (subject_id) qTS = qTS.eq("subject_id", subject_id); // filtre disciplinaire (subjects.id)
    const { data: tsRows } = await qTS;

    // map teacher_id -> teacher_name
    const teacherNameById = new Map<string, string>();
    for (const r of tsRows || []) {
      const pid = String(r.profile_id);
      const nm = String(r.teacher_name ?? "").trim();
      if (!teacherNameById.has(pid) && nm) teacherNameById.set(pid, nm);
    }
    // fallback profils si besoin
    const missing = allTeacherIds.filter((id) => !teacherNameById.has(id));
    if (missing.length) {
      const { data: profs } = await srv
        .from("profiles")
        .select("id, display_name, first_name, last_name, email, phone")
        .in("id", missing);
      for (const p of profs || []) teacherNameById.set(String(p.id), niceName(p));
    }

    // map teacher_id -> [subject_names] (distinct triés)
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

    // Si on a filtré par discipline, ne garder que les profs qui ont cette discipline dans teacher_subjects
    let teacherScope: string[] = allTeacherIds;
    if (subject_id) {
      const allowed = new Set((tsRows || []).map((r: any) => String(r.profile_id)));
      teacherScope = teacherScope.filter((id) => allowed.has(id));
    }

    // 3) Séances de la période (pour minutes)
    const sessionsTable =
      (await tableExists(srv, "teacher_sessions")) ? "teacher_sessions" :
      (await tableExists(srv, "class_sessions")) ? "class_sessions" : "sessions";

    const baseSessions = () => {
      let q = srv
        .from(sessionsTable)
        .select("id, teacher_id, subject_id, started_at, expected_minutes, institution_id")
        .gte("started_at", fromISO)
        .lt("started_at", toISOExclusive);
      if (inst) q = q.eq("institution_id", inst);
      return q;
    };

    // IMPORTANT : si on filtre par discipline, inclure sessions.subject_id ∈ {subjects.id, institution_subjects.id}
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

    // dédoublonnage
    const seen = new Set<string>();
    const sessions = (sessRows || [])
      .filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((s: any) => ({
        id: String(s.id),
        teacher_id: s.teacher_id ? String(s.teacher_id) : null,
        subject_id: s.subject_id ? String(s.subject_id) : null,
        started_at: String(s.started_at),
        expected_minutes: Number(s.expected_minutes || 0),
      }));

    // 4) SUMMARY
    if (mode === "summary") {
      // minutes par enseignant (init 0 pour que tout le monde apparaisse)
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

      items.sort(
        (a, b) => b.total_minutes - a.total_minutes || a.teacher_name.localeCompare(b.teacher_name, "fr")
      );

      return NextResponse.json({ items });
    }

    // 5) DETAIL (libellé de discipline par séance)
    const subIds = Array.from(new Set(sessions.map((s) => s.subject_id).filter(Boolean))) as string[];

    // 5.a) map raw subject_id -> subject_name via subjects
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

    const detailed = sessions
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((r) => ({
        id: r.id,
        dateISO: r.started_at,
        subject_name: r.subject_id ? subjectNameById[r.subject_id] || "Discipline non renseignée" : "Discipline non renseignée",
        expected_minutes: r.expected_minutes || 0,
      }));

    const total_minutes = detailed.reduce((acc, it) => acc + (it.expected_minutes || 0), 0);
    return NextResponse.json({ rows: detailed, count: detailed.length, total_minutes });
  } catch (e: any) {
    console.error("/api/admin/statistics error", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
