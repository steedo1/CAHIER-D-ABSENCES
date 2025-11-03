// src/app/api/teacher/conduct/penalties/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Item = {
  student_id: string;
  points: number;           // points à retrancher (ex: 0.5, 1, 2 …)
  reason?: string | null;   // optionnel
  rubric?: "assiduite"|"tenue"|"moralite"|"discipline"; // optionnel, défaut discipline
};

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  const institution_id = me?.institution_id as string | null;
  if (!institution_id) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const class_id   = String(body?.class_id || "");
  const subject_id = body?.subject_id ? String(body.subject_id) : null;
  const occurred_at = body?.occurred_at ? new Date(body.occurred_at).toISOString() : null;
  const items = Array.isArray(body?.items) ? (body.items as Item[]) : [];

  if (!class_id || items.length === 0)
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });

  // Vérifie la classe et le tenant
  const { data: cls } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (!cls || (cls as any).institution_id !== institution_id)
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });

  const rows = items
    .filter((it) => it && it.student_id && Number(it.points) > 0)
    .map((it) => ({
      institution_id,
      class_id,
      subject_id,
      student_id: it.student_id,
      rubric: (it.rubric || "discipline") as any,
      points: Number(it.points),
      reason: it.reason ?? null,
      author_id: user.id,
      occurred_at: occurred_at || new Date().toISOString(),
    }));

  if (!rows.length) return NextResponse.json({ inserted: 0 });

  const { error } = await srv.from("conduct_penalties").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // (optionnel) à brancher sur votre mécanique push/WA si dispo
  // await fetch("/api/notify/queue", { method: "POST", body: JSON.stringify({ type: "conduct_penalty", rows }) })

  return NextResponse.json({ inserted: rows.length });
}
