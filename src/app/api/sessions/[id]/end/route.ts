//src/app/api/sessions/[id]/end/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/**
 * PATCH /api/sessions/:id/end
 * Marque la fin d�"une session d�"appel.
 */
export async function PATCH(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("attendance_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ session: data });
}
