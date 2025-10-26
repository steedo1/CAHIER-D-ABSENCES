// src/app/api/admin/subjects/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/** Renvoie les matières disponibles pour l'établissement courant (triées par nom). */
export async function GET() {
  const supa = await getSupabaseServerClient();

  // 1) Auth obligatoire
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) Récupération de l'établissement de l'admin courant
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ items: [] });
  }

  const institutionId = (me?.institution_id as string) || null;
  if (!institutionId) {
    return NextResponse.json({ items: [] });
  }

  // 3) Lecture principale via la table de liaison institution_subjects â†’ subjects
  try {
    const { data, error } = await supa
      .from("institution_subjects")
      // NOTE : selon la définition de la relation, Supabase peut renvoyer
      // subjects comme objet OU comme tableau. On gère les deux.
      .select("subject_id, subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .eq("is_active", true);

    if (error) {
      const fallback = await tryFallbackSubjects(supa);
      return NextResponse.json({ items: fallback });
    }

    // On traite de façon sÃ»re, sans assertions de types fragiles
    const rows: any[] = data ?? [];

    const map = new Map<string, string>();
    for (const r of rows) {
      const id = String(r?.subject_id ?? "");
      let nm = "";

      const s = r?.subjects;
      if (Array.isArray(s)) {
        // Relation renvoyée sous forme de tableau
        if (s.length > 0) nm = String(s[0]?.name ?? "").trim();
      } else if (s && typeof s === "object") {
        // Relation renvoyée sous forme d'objet
        nm = String((s as any)?.name ?? "").trim();
      }

      if (id && nm) map.set(id, nm);
    }

    // Tableau typé puis tri (évite les erreurs d'inférence)
    const items: Array<{ id: string; name: string }> = [];
    for (const [id, nm] of map.entries()) items.push({ id, name: nm });
    items.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    return NextResponse.json({ items });
  } catch {
    const fallback = await tryFallbackSubjects(supa);
    return NextResponse.json({ items: fallback });
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Fallback : si institution_subjects indisponible,
   on renvoie (si possible) la table subjects globale.
   On garde la même forme { id, name } et tri par nom.
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function tryFallbackSubjects(supa: any) {
  try {
    const { data, error } = await supa
      .from("subjects")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) return [];
    const list: Array<{ id: string; name: string }> = [];
    for (const s of data ?? []) {
      const id = s?.id ? String(s.id) : "";
      const nm = s?.name ? String(s.name) : "";
      if (id && nm) list.push({ id, name: nm });
    }
    // DéjÃ  trié en SQL ; tri JS par sécurité
    list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return list;
  } catch {
    return [];
  }
}


