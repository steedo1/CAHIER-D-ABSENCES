// src/app/api/admin/absences/matrix/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, any>;

function ymd(x?: string) {
  if (!x) return null;
  const m = String(x).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? x : null;
}

/** Affichage: NOM Prénom (nom avant prénom) */
function normFullName(s: Row) {
  const last = String(s.last_name ?? "").trim();
  const first = String(s.first_name ?? "").trim();
  const full = [last, first].filter(Boolean).join(" ").trim();
  return full || "—";
}

/** Résout les noms de disciplines à partir d'identifiants
 *  - institution_subjects.id → custom_name || subjects.name
 *  - subjects.id             → subjects.name
 *  - défaut                  → id
 */
async function buildSubjectNameMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();
  if (!uniq.length) return map;

  // 1) institution_subjects (avec retombée vers subjects.name)
  {
    const { data } = await srv
      .from("institution_subjects")
      .select("id, custom_name, subject_id, subjects:subject_id(name)")
      .in("id", uniq);

    if (data) {
      for (const r of data as any[]) {
        const custom = String(r.custom_name || "").trim();
        const subjName = String((r.subjects?.name as string) || "").trim();
        const name = custom || subjName;
        if (name) map.set(String(r.id), name);
      }
    }
  }

  // 2) sujets restants → subjects.id
  const remaining = uniq.filter((id) => !map.has(id));
  if (remaining.length) {
    const { data } = await srv.from("subjects").select("id, name").in("id", remaining);
    if (data) {
      for (const r of data as any[]) {
        const name = String(r.name || "").trim();
        if (name) map.set(String(r.id), name);
      }
    }
  }

  // 3) défaut
  for (const id of uniq) if (!map.has(id)) map.set(id, id);
  return map;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const class_id = String(url.searchParams.get("class_id") || "");
  const from = ymd(url.searchParams.get("from") || undefined);
  const to = ymd(url.searchParams.get("to") || undefined);
  const type = (String(url.searchParams.get("type") || "absent").toLowerCase() === "tardy"
    ? "tardy"
    : "absent") as "absent" | "tardy";
  const format = String(url.searchParams.get("format") || "").toLowerCase(); // "csv" | ""

  if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  // ── Auth / tenant
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  const inst = me?.institution_id as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // ── Lignes = élèves inscrits dans la classe
  const { data: enr, error: enrErr } = await srv
    .from("class_enrollments")
    .select(`student_id, students:student_id ( id, first_name, last_name )`)
    .eq("institution_id", inst)
    .eq("class_id", class_id)
    .is("end_date", null);
  if (enrErr) return NextResponse.json({ error: enrErr.message }, { status: 400 });

  const studentsBase = (enr || [])
    .map((r: any) => ({ id: r.student_id, full_name: normFullName(r.students || {}) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }));

  // ── 1/ Séances de la classe (filtrées par dates si fournies)
  let sessQ = srv
    .from("teacher_sessions")
    .select("id, class_id, subject_id, teacher_id, started_at")
    .eq("class_id", class_id);

  if (from) sessQ = (sessQ as any).gte("started_at", `${from}T00:00:00Z`);
  if (to)   sessQ = (sessQ as any).lte("started_at", `${to}T23:59:59.999Z`);

  const { data: sessions, error: sErr } = await sessQ;
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const sessionById = new Map<string, any>();
  const sessionIds: string[] = [];
  for (const s of sessions || []) {
    sessionById.set((s as any).id, s);
    sessionIds.push((s as any).id);
  }

  if (!sessionIds.length) {
    if (format === "csv") {
      // CSV vide avec en-têtes N° + Élève
      return new Response("\uFEFFsep=;\r\nN°;Élève;Total\r\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="matrice_${type}.csv"`,
        },
      });
    }
    return NextResponse.json({
      subjects: [],
      students: studentsBase.map((s, i) => ({ ...s, rank: i + 1 })),
      values: [],
      subjectDistinct: {},
      subjectTotals: {},
      studentTotals: {},
    });
  }

  // ── 2/ Marques pour ces séances
  const { data: marks, error: mErr } = await srv
    .from("attendance_marks")
    .select("student_id, status, minutes_late, hours_absent, session_id")
    .in("session_id", sessionIds);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  // ── Fallback subject_id via class_teachers quand la séance n’a pas de sujet
  const missingTeachers = Array.from(
    new Set(
      (marks || [])
        .map((r: any) => sessionById.get(r.session_id)?.subject_id ? null : sessionById.get(r.session_id)?.teacher_id)
        .filter(Boolean)
    )
  ) as string[];

  const fallbackSubjectByTeacher = new Map<string, string>();
  if (missingTeachers.length) {
    const { data: ct } = await srv
      .from("class_teachers")
      .select("teacher_id, subject_id")
      .eq("class_id", class_id)
      .in("teacher_id", missingTeachers);
    if (ct) {
      const group = new Map<string, Set<string>>();
      for (const r of ct as any[]) {
        const t = String(r.teacher_id);
        const s = String(r.subject_id || "");
        if (!group.has(t)) group.set(t, new Set());
        if (s) group.get(t)!.add(s);
      }
      for (const [t, set] of group) {
        if (set.size === 1) fallbackSubjectByTeacher.set(t, Array.from(set)[0]!);
      }
    }
  }

  // ── Agrégation minutes
  const byKey = new Map<string, number>(); // "student|subject" -> minutes
  const subjSet = new Set<string>();
  const subjDistinctSet = new Map<string, Set<string>>(); // subject -> set(student)

  function add(subject_id: string, student_id: string, minutes: number) {
    if (!subject_id || !student_id || !minutes) return;
    subjSet.add(subject_id);
    const k = `${student_id}|${subject_id}`;
    byKey.set(k, (byKey.get(k) || 0) + minutes);
    if (!subjDistinctSet.has(subject_id)) subjDistinctSet.set(subject_id, new Set());
    subjDistinctSet.get(subject_id)!.add(student_id);
  }

  for (const r of marks || []) {
    const sess = sessionById.get((r as any).session_id) || {};
    const teacherId = String(sess.teacher_id || "");
    let subj = String(sess.subject_id || "");
    if (!subj && teacherId && fallbackSubjectByTeacher.has(teacherId)) {
      subj = fallbackSubjectByTeacher.get(teacherId)!;
    }
    const stu = String((r as any).student_id || "");
    if (!stu || !subj) continue;

    let minutes = 0;
    if (type === "absent") {
      // Arrondir CHAQUE absence à l'entier supérieur (heures), puis * 60
      const h = Number((r as any).hours_absent ?? 0);
      const roundedH = Math.ceil(Math.max(0, h));
      minutes = roundedH * 60;
    } else {
      minutes = Math.max(0, Math.floor(Number((r as any).minutes_late ?? 0)));
    }
    if (minutes > 0) add(subj, stu, minutes);
  }

  const subjectIds = Array.from(subjSet);
  const nameMap = await buildSubjectNameMap(srv, subjectIds);

  // ── Totaux par matière et par élève
  const subjectTotals: Record<string, number> = {};
  const studentTotals: Record<string, number> = {};
  for (const [k, minutes] of byKey) {
    const [student_id, subject_id] = k.split("|");
    subjectTotals[subject_id] = (subjectTotals[subject_id] || 0) + minutes;
    studentTotals[student_id] = (studentTotals[student_id] || 0) + minutes;
  }

  // ── “Hot” = top 20% (au moins 1)
  const subPairs = Object.entries(subjectTotals).sort((a, b) => b[1] - a[1]);
  const stuPairs = Object.entries(studentTotals).sort((a, b) => b[1] - a[1]);
  const hotSubCount = Math.max(1, Math.ceil(subPairs.length * 0.2));
  const hotStuCount = Math.max(1, Math.ceil(stuPairs.length * 0.2));
  const hotSubjects = new Set(subPairs.slice(0, hotSubCount).map(([id]) => id));
  const hotStudents = new Set(stuPairs.slice(0, hotStuCount).map(([id]) => id));

  // ── Listes triées + flags + rang (N°)
  const studentsSorted = studentsBase; // déjà triés par full_name
  const studentsOut = studentsSorted.map((s, i) => ({
    ...s,
    rank: i + 1,
    total_minutes: studentTotals[s.id] || 0,
    is_hot: hotStudents.has(s.id),
  }));

  const subjects = subjectIds
    .map((id) => ({
      id,
      name: (nameMap.get(id) || id),
      total_minutes: subjectTotals[id] || 0,
      is_hot: hotSubjects.has(id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  // ── Values
  const values: Array<{ student_id: string; subject_id: string; minutes: number }> = [];
  for (const [k, minutes] of byKey) {
    const [student_id, subject_id] = k.split("|");
    values.push({ student_id, subject_id, minutes });
  }

  const subjectDistinct: Record<string, number> = {};
  for (const s of subjectIds) subjectDistinct[s] = subjDistinctSet.get(s)?.size || 0;

  // ── CSV
  if (format === "csv") {
    const sep = ";";
    const EOL = "\r\n";
    const idx: Record<string, Record<string, number>> = {};
    for (const v of values) {
      if (!idx[v.student_id]) idx[v.student_id] = {};
      idx[v.student_id][v.subject_id] =
        (idx[v.student_id][v.subject_id] || 0) + v.minutes;
    }

    const lines: string[] = [];
    lines.push("sep=;");
    const head = ["N°", "Élève", ...subjects.map((s) => s.name), "Total"];
    lines.push(head.join(sep));

    for (const stu of studentsOut) {
      const row: string[] = [String(stu.rank), stu.full_name];
      let tot = 0;
      for (const sub of subjects) {
        const min = idx[stu.id]?.[sub.id] || 0;
        tot += min;
        if (type === "absent") {
          const h = min / 60;
          row.push(h ? String(h.toFixed(1)).replace(".", ",") : "");
        } else {
          row.push(min ? String(min) : "");
        }
      }
      if (type === "absent") {
        const ht = tot / 60;
        row.push(ht ? String(ht.toFixed(1)).replace(".", ",") : "");
      } else {
        row.push(tot ? String(tot) : "");
      }
      lines.push(row.join(sep));
    }

    const csv = "\uFEFF" + lines.join(EOL);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="matrice_${type}.csv"`,
      },
    });
  }

  // ── JSON (ajouts non-bloquants: rank, totals, is_hot)
  return NextResponse.json({
    subjects,            // [{ id, name, total_minutes, is_hot }]
    students: studentsOut, // [{ id, full_name (Nom Prénom), rank, total_minutes, is_hot }]
    values,
    subjectDistinct,
    subjectTotals,
    studentTotals,
  });
}
