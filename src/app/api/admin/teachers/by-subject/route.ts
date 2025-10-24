// src/app/api/admin/teachers/by-subject/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

// petit helper : essaye une requÃªte; si la table n'existe pas (ou autre), renvoie null
async function trySelect<T>(fn: () => any): Promise<T | null> {
  try {
    const { data, error } = await fn();
    if (error) return null;
    return (data ?? null) as T;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  const inst = me?.institution_id as string;

  const url = new URL(req.url);
  const subject_id = url.searchParams.get("subject_id") || "";

  // Tous les profs de l'Ã©tablissement
  const { data: roleRows, error: rErr } = await supa
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", inst)
    .eq("role", "teacher");
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });

  let teacherIds = new Set((roleRows ?? []).map(r => r.profile_id as string));

  // Filtre par matiÃ¨re si demandÃ©
  if (subject_id) {
    // (a) premier choix : teacher_subjects
    const ts = await trySelect<any[]>(() =>
      supa.from("teacher_subjects")
        .select("profile_id")
        .eq("institution_id", inst)
        .eq("subject_id", subject_id)
    );

    if (Array.isArray(ts)) {
      const ids = new Set(ts.map(x => x.profile_id as string));
      teacherIds = new Set([...teacherIds].filter(id => ids.has(id)));
    } else {
      // (b) fallback : class_teachers
      const { data: ctRows, error: ctErr } = await supa
        .from("class_teachers")
        .select("teacher_id")
        .eq("institution_id", inst)
        .eq("subject_id", subject_id);
      if (ctErr) return NextResponse.json({ error: ctErr.message }, { status: 400 });

      const ids = new Set((ctRows ?? []).map(x => x.teacher_id as string));
      teacherIds = new Set([...teacherIds].filter(id => ids.has(id)));
    }
  }

  if (teacherIds.size === 0) return NextResponse.json({ items: [] });

  const { data: profs, error: pErr } = await supa
    .from("profiles")
    .select("id, display_name, email, phone")
    .in("id", [...teacherIds])
    .order("display_name", { ascending: true });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  return NextResponse.json({
    items: (profs ?? []).map(p => ({
      id: p.id,
      display_name: (p as any).display_name ?? "â€”",
      email: (p as any).email ?? null,
      phone: (p as any).phone ?? null,
    })),
  });
}
