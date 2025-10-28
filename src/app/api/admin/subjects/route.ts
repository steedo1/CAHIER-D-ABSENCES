// src/app/api/admin/subjects/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/** Renvoie les mati�res disponibles pour l'�tablissement courant (tri�es par nom). */
export async function GET() {
  const supa = await getSupabaseServerClient();

  // 1) Auth obligatoire
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) R�cup�ration de l'�tablissement de l'admin courant
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

  // 3) Lecture principale via la table de liaison institution_subjects �  subjects
  try {
    const { data, error } = await supa
      .from("institution_subjects")
      // NOTE : selon la d�finition de la relation, Supabase peut renvoyer
      // subjects comme objet OU comme tableau. On g�re les deux.
      .select("subject_id, subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .eq("is_active", true);

    if (error) {
      const fallback = await tryFallbackSubjects(supa);
      return NextResponse.json({ items: fallback });
    }

    // On traite de fa�on s�re, sans assertions de types fragiles
    const rows: any[] = data ?? [];

    const map = new Map<string, string>();
    for (const r of rows) {
      const id = String(r?.subject_id ?? "");
      let nm = "";

      const s = r?.subjects;
      if (Array.isArray(s)) {
        // Relation renvoy�e sous forme de tableau
        if (s.length > 0) nm = String(s[0]?.name ?? "").trim();
      } else if (s && typeof s === "object") {
        // Relation renvoy�e sous forme d'objet
        nm = String((s as any)?.name ?? "").trim();
      }

      if (id && nm) map.set(id, nm);
    }

    // Tableau typ� puis tri (�vite les erreurs d'inf�rence)
    const items: Array<{ id: string; name: string }> = [];
    for (const [id, nm] of map.entries()) items.push({ id, name: nm });
    items.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    return NextResponse.json({ items });
  } catch {
    const fallback = await tryFallbackSubjects(supa);
    return NextResponse.json({ items: fallback });
  }
}

/* ��������������������������������������������������������������������������������������������������������������������
   Fallback : si institution_subjects indisponible,
   on renvoie (si possible) la table subjects globale.
   On garde la m�me forme { id, name } et tri par nom.
�������������������������������������������������������������������������������������������������������������������� */
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
    // D�j� tri� en SQL ; tri JS par s�curit�
    list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return list;
  } catch {
    return [];
  }
}


