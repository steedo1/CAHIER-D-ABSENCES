// src/app/api/admin/teachers/by-subject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/** Helper: exécute une requête Supabase et retourne data ou null (ex: table absente). */
async function trySelect<T>(
  fn: () => Promise<{ data: T | null; error: any }>
): Promise<T | null> {
  try {
    const { data, error } = await fn();
    if (error) return null;
    return (data ?? null) as T;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  // ── Auth requise
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const subject_id_qs = (url.searchParams.get("subject_id") || "").trim();
  const inst_qs       = (url.searchParams.get("institution_id") || "").trim();

  // ── Déterminer l’établissement courant de façon explicite et sûre
  // 1) Récupérer toutes les institutions où l’utilisateur est ADMIN (via client service → pas de RLS)
  const adminInst = await srv
    .from("user_roles")
    .select("institution_id")
    .eq("profile_id", user.id)
    .eq("role", "admin");

  if (adminInst.error) {
    return NextResponse.json({ error: adminInst.error.message }, { status: 400 });
  }
  const adminSet = new Set<string>((adminInst.data ?? []).map((r: any) => String(r.institution_id)));

  // 2) Préférence à institution_id fourni en query s’il est autorisé
  let institution_id: string | null = null;
  if (inst_qs && adminSet.has(inst_qs)) {
    institution_id = inst_qs;
  } else {
    // 3) Sinon, préférer l’active institution du profil si elle fait partie des droits admin
    const profCtx = await srv
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    const activeInst = (profCtx.data?.institution_id as string) ?? null;
    if (activeInst && adminSet.has(activeInst)) {
      institution_id = activeInst;
    } else {
      // 4) Sinon, prendre la première institution admin (comportement déterministe)
      institution_id = adminInst.data?.[0]?.institution_id ?? null;
    }
  }

  if (!institution_id) {
    // l’utilisateur n’est admin d’aucune institution
    return NextResponse.json({ items: [] });
  }

  // ── 1) Tous les teachers rattachés à l’établissement (source de vérité : user_roles)
  const ur = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institution_id)
    .eq("role", "teacher");

  if (ur.error) return NextResponse.json({ error: ur.error.message }, { status: 400 });

  let teacherIds = new Set<string>((ur.data ?? []).map((r: any) => String(r.profile_id)));
  if (teacherIds.size === 0) return NextResponse.json({ items: [] });

  // ── 2) Filtre par matière (si demandé)
  if (subject_id_qs) {
    let filtered: Set<string> | null = null;

    // (a) préféré : teacher_subjects
    const ts = await trySelect<any[]>(async () =>
      await srv
        .from("teacher_subjects")
        .select("profile_id")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id_qs)
    );
    if (Array.isArray(ts)) {
      filtered = new Set(ts.map((x: any) => String(x.profile_id)));
    } else {
      // (b) fallback : class_teachers si teacher_subjects n'existe pas
      const ct = await trySelect<any[]>(async () =>
        await srv
          .from("class_teachers")
          .select("teacher_id")
          .eq("institution_id", institution_id)
          .eq("subject_id", subject_id_qs)
      );
      if (Array.isArray(ct)) {
        filtered = new Set(ct.map((x: any) => String(x.teacher_id)));
      }
    }

    // Si on a pu déterminer un ensemble filtré, on intersecte. Sinon, on conserve la liste (graceful).
    if (filtered) {
      teacherIds = new Set([...teacherIds].filter((id) => filtered!.has(id)));
      if (teacherIds.size === 0) return NextResponse.json({ items: [] });
    }
  }

  // ── 3) Profils
  const ids = Array.from(teacherIds);
  const pf = await srv
    .from("profiles")
    .select("id, display_name, email, phone")
    .in("id", ids)
    .order("display_name", { ascending: true });

  if (pf.error) return NextResponse.json({ error: pf.error.message }, { status: 400 });

  return NextResponse.json({
    items: (pf.data ?? []).map((p: any) => ({
      id: p.id as string,
      display_name: (p.display_name ?? "") as string | null,
      email: (p.email ?? null) as string | null,
      phone: (p.phone ?? null) as string | null,
    })),
  });
}
