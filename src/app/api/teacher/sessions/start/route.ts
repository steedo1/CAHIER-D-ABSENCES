// src/app/api/teacher/sessions/start/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Body = {
  class_id: string;
  subject_id?: string | null;        // optionnel (peut être null)
  started_at?: string;               // ISO optionnel, utilisé pour le créneau
  expected_minutes?: number | null;  // OBLIGATOIRE (>= 1)
};

export async function POST(req: Request) {
  try {
    const supa = await getSupabaseServerClient();   // client (RLS)
    const srv  = getSupabaseServiceClient();        // service (no RLS)

    // 1) Auth
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // 2) Payload
    const b = (await req.json().catch(() => ({}))) as Body;

    const class_id = String(b?.class_id ?? "").trim();
    const subject_id =
      b?.subject_id && String(b.subject_id).trim() ? String(b.subject_id).trim() : null;

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }

    // Heure de début (créneau) : si fournie par l'UI, on la garde ; sinon maintenant.
    const startedAtRaw = b?.started_at ? new Date(b.started_at) : new Date();
    const startedAt = isNaN(startedAtRaw.getTime()) ? new Date() : startedAtRaw;

    // Heure réelle du clic (indépendante de l'horloge du téléphone)
    const clickNow = new Date();

    // Durée attendue obligatoire (arrondie et clampée à >= 1)
    const raw = Number(b?.expected_minutes);
    const expected_minutes = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : NaN;
    if (!Number.isFinite(expected_minutes)) {
      return NextResponse.json({ error: "expected_minutes_required" }, { status: 400 });
    }

    // 3) Établissement du prof
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

    const institution_id = (me?.institution_id as string) || null;
    if (!institution_id) {
      return NextResponse.json({ error: "no_institution" }, { status: 400 });
    }

    // 4) Vérifier que la classe appartient à cet établissement
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id,label")
      .eq("id", class_id)
      .maybeSingle();
    if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
    if (!cls || cls.institution_id !== institution_id) {
      return NextResponse.json({ error: "invalid_class" }, { status: 400 });
    }

    // 5) Insertion séance
    const insertRow = {
      institution_id,
      teacher_id: user.id,
      class_id,
      subject_id, // nullable
      started_at: startedAt.toISOString(),     // sert au créneau (rangement)
      actual_call_at: clickNow.toISOString(),  // heure du clic (affichage)
      expected_minutes,
      status: "open" as const,
      created_by: user.id,
    };

    const { data: inserted, error: insErr } = await srv
      .from("teacher_sessions")
      .insert(insertRow)
      .select("id,class_id,subject_id,started_at,expected_minutes")
      .maybeSingle();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    // 6) Enrichissement (facultatif mais utile côté UI)
    const class_label = cls.label ?? null;
    let subject_name: string | null = null;
    if (inserted?.subject_id) {
      const { data: subj } = await srv
        .from("institution_subjects")
        .select("custom_name, subjects:subject_id(name)")
        .eq("id", inserted.subject_id)
        .maybeSingle();
      subject_name = (subj as any)?.custom_name ?? (subj as any)?.subjects?.name ?? null;
    }

    return NextResponse.json({
      item: {
        id: inserted!.id as string,
        class_id: inserted!.class_id as string,
        class_label,
        subject_id: (inserted!.subject_id as string) ?? null,
        subject_name,
        started_at: inserted!.started_at as string,
        expected_minutes: (inserted!.expected_minutes as number) ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "start_failed" }, { status: 400 });
  }
}
