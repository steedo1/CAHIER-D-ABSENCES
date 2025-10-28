// src/app/api/admin/affectations/current/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type CurrentItem = {
  teacher: { id: string; display_name: string | null; email: string | null; phone: string | null };
  subject: { id: string | null; label: string };
  classes: Array<{ id: string; name: string; level: string | null }>;
};

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();
const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  // Auth
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Institution
  const { data: me, error: meErr } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // Filters
  const { searchParams } = new URL(req.url);
  const qRaw       = searchParams.get("q") || "";
  const subjectRaw = searchParams.get("subject_id") || ""; // institution_subjects.id OU subjects.id
  const q = norm(qRaw);
  const subjectFilter = (subjectRaw || "").trim();

  // Query (no hard-coded class columns â†’ schema tolerant)
  const { data, error } = await srv
    .from("class_teachers")
    .select(`
      teacher_id,
      subject_id,
      end_date,
      teacher:profiles(id,display_name,email,phone),
      class:classes(*),
      instsub:institution_subjects(
        id,
        custom_name,
        subj:subjects(id,name,code)
      )
    `)
    .eq("institution_id", institution_id)
    .is("end_date", null)
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Group by (teacher_id, subject_id/institution_subjects)
  const groups = new Map<
    string,
    CurrentItem & { _subjectIds: { instSubId: string | null; subjId: string | null } }
  >();

  for (const row of data || []) {
    const t  = (row as any).teacher;
    const c  = (row as any).class || {};
    const is = (row as any).instsub;

    const teacher_id = t?.id as string;
    const instSubId  = (is?.id as string) ?? null;
    const subjId     = (is?.subj?.id as string) ?? null;
    const subjectKey = instSubId || "NULL";
    const key = `${teacher_id}::${subjectKey}`;

    const subjectLabel =
      (is?.custom_name as string) ||
      (is?.subj?.name as string) ||
      "—";

    if (!groups.has(key)) {
      groups.set(key, {
        teacher: {
          id: teacher_id,
          display_name: t?.display_name ?? null,
          email: t?.email ?? null,
          phone: t?.phone ?? null,
        },
        subject: { id: instSubId, label: subjectLabel },
        classes: [],
        _subjectIds: { instSubId, subjId },
      });
    }

    const g = groups.get(key)!;

    // Pick class name & level robustly (whatever exists in your schema)
    const clsId    = c?.id as string | undefined;
    const clsName  =
      c?.name ??
      c?.label ??
      c?.class_name ??
      c?.code ??
      c?.short_name ??
      c?.short_label ??
      "(sans nom)";
    const clsLevel = c?.level ?? c?.grade ?? c?.niveau ?? null;

    if (clsId && !g.classes.some(x => x.id === clsId)) {
      g.classes.push({ id: clsId, name: String(clsName), level: clsLevel ? String(clsLevel) : null });
    }
  }

  // Filter by subject (accepts institution_subjects.id OR subjects.id)
  let items = Array.from(groups.values());
  if (subjectFilter) {
    items = items.filter(g =>
      g._subjectIds.instSubId === subjectFilter || g._subjectIds.subjId === subjectFilter
    );
  }

  // Text filter
  if (q) {
    items = items.filter(g => {
      const hay = [
        norm(g.teacher.display_name),
        norm(g.teacher.email),
        norm(g.teacher.phone),
        norm(g.subject.label),
        ...g.classes.map(cl => norm(cl.name)),
      ].join(" ");
      return hay.includes(q);
    });
  }

  // Sort: teacher then subject
  items.sort((a, b) => {
    const ta = lc(a.teacher.display_name) || lc(a.teacher.phone) || lc(a.teacher.email);
    const tb = lc(b.teacher.display_name) || lc(b.teacher.phone) || lc(b.teacher.email);
    if (ta !== tb) return ta.localeCompare(tb);
    return lc(a.subject.label).localeCompare(lc(b.subject.label));
  });

  // Strip internals
  const out: CurrentItem[] = items.map(({ _subjectIds, ...rest }) => rest);

  return NextResponse.json({ items: out });
}


