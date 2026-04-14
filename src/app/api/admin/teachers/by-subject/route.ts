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
  const srv = getSupabaseServiceClient();

  // ── Auth requise
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const subject_id_qs = (url.searchParams.get("subject_id") || "").trim();

  // ── Établissement courant = celui du profil connecté
  // On évite toute logique "intelligente" qui peut basculer sur un autre établissement.
  const profCtx = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profCtx.error) {
    return NextResponse.json({ error: profCtx.error.message }, { status: 400 });
  }

  const institution_id = (profCtx.data?.institution_id as string) ?? null;

  if (!institution_id) {
    return NextResponse.json(
      { error: "no_institution", items: [] },
      { status: 400 }
    );
  }

  // ── Vérifier que l’utilisateur a bien le droit admin sur CET établissement
  const adminCheck = await srv
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (adminCheck.error) {
    return NextResponse.json({ error: adminCheck.error.message }, { status: 400 });
  }

  if (!adminCheck.data) {
    return NextResponse.json({ error: "forbidden", items: [] }, { status: 403 });
  }

  // ── 1) Tous les teachers rattachés à l’établissement
  const ur = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institution_id)
    .eq("role", "teacher");

  if (ur.error) {
    return NextResponse.json({ error: ur.error.message }, { status: 400 });
  }

  let teacherIds = new Set<string>(
    (ur.data ?? []).map((r: any) => String(r.profile_id))
  );

  if (teacherIds.size === 0) {
    return NextResponse.json({ items: [] });
  }

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

    if (filtered) {
      teacherIds = new Set(
        [...teacherIds].filter((id) => filtered!.has(id))
      );

      if (teacherIds.size === 0) {
        return NextResponse.json({ items: [] });
      }
    }
  }

  // ── 3) Profils
  const ids = Array.from(teacherIds);

  const pf = await srv
    .from("profiles")
    .select("id, display_name, email, phone")
    .eq("institution_id", institution_id)
    .in("id", ids)
    .order("display_name", { ascending: true });

  if (pf.error) {
    return NextResponse.json({ error: pf.error.message }, { status: 400 });
  }

  return NextResponse.json({
    items: (pf.data ?? []).map((p: any) => ({
      id: p.id as string,
      display_name: (p.display_name ?? "") as string | null,
      email: (p.email ?? null) as string | null,
      phone: (p.phone ?? null) as string | null,
    })),
  });
}