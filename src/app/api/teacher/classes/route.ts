// src/app/api/teacher/classes/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

// On ne se bat pas avec les types gÃ©nÃ©rÃ©s par Supabase pour les relations : on lit en `any`.
type ItemOut = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // classes affectÃ©es au prof (+ matiÃ¨re Ã©ventuelle)
    const { data, error } = await supa
      .from("class_teachers")
      .select("class_id, subject_id, classes:class_id(label,level)")
      .eq("teacher_id", user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const items: ItemOut[] = [];

    for (const raw of (data || []) as any[]) {
      const cls = (raw as any).classes as any; // objet 1-1 { label, level }
      if (!cls) continue;

      let subject_name: string | null = null;
      if (raw.subject_id) {
        const { data: isub } = await supa
          .from("institution_subjects")
          .select("custom_name, subjects:subject_id(name)")
          .or(`id.eq.${raw.subject_id},subject_id.eq.${raw.subject_id}`)
          .limit(1)
          .maybeSingle();

        // isub?.subjects peut Ãªtre typÃ© comme tableau â†’ on force en any
        subject_name =
          (isub as any)?.custom_name ??
          (isub as any)?.subjects?.name ??
          null;
      }

      items.push({
        class_id: raw.class_id as string,
        class_label: String(cls.label ?? "â€”"),
        level: String(cls.level ?? "â€”"),
        subject_id: (raw.subject_id ?? null) as string | null,
        subject_name,
      });
    }

    // dÃ©doublonner (class_id + subject_id)
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
    return NextResponse.json({ error: e?.message || "classes_failed" }, { status: 400 });
  }
}
