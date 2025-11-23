// src/app/api/teacher/classes/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// On ne se bat pas avec les types générés par Supabase pour les relations : on lit en `any`.
type ItemOut = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;   // ⚠️ sera toujours un subjects.id canonique si possible
  subject_name: string | null;
};

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // classes affectées au prof (+ matière éventuelle)
    const { data, error } = await supa
      .from("class_teachers")
      .select("class_id, subject_id, classes:class_id(label,level)")
      .eq("teacher_id", user.id);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });

    const items: ItemOut[] = [];

    for (const raw of (data || []) as any[]) {
      const cls = (raw as any).classes as any; // objet 1-1 { label, level }
      if (!cls) continue;

      let subject_name: string | null = null;
      let subject_id: string | null = (raw.subject_id ?? null) as string | null;

      if (raw.subject_id) {
        // On essaie de retrouver la ligne institution_subjects correspondante,
        // QUE raw.subject_id soit l'id de institution_subjects OU l'id de subjects.
        const { data: isub } = await supa
          .from("institution_subjects")
          .select(
            "id, subject_id, custom_name, subjects:subject_id(id,name)"
          )
          .or(`id.eq.${raw.subject_id},subject_id.eq.${raw.subject_id}`)
          .limit(1)
          .maybeSingle();

        if (isub) {
          const anySub = isub as any;
          const subj = (anySub.subjects as any) || {};

          subject_name =
            (anySub.custom_name as string | null) ??
            (subj.name as string | null) ??
            null;

          // ⚠️ Id canonique de la matière : subjects.id si dispo, sinon institution_subjects.subject_id, sinon fallback raw.subject_id
          const canonical =
            (subj.id as string | undefined) ??
            (anySub.subject_id as string | undefined) ??
            (raw.subject_id as string | undefined);

          subject_id = canonical ?? null;
        }
      }

      items.push({
        class_id: raw.class_id as string,
        class_label: String(cls.label ?? " "),
        level: String(cls.level ?? " "),
        subject_id,
        subject_name,
      });
    }

    // dé-doublonner (class_id + subject_id)
    const seen = new Set<string>();
    const uniq = items
      .filter((it) => {
        const k = `${it.class_id}|${it.subject_id || ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) =>
        a.class_label.localeCompare(b.class_label, undefined, { numeric: true })
      );

    return NextResponse.json({ items: uniq });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "classes_failed" },
      { status: 400 }
    );
  }
}
