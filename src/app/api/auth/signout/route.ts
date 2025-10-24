import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST() {
  const supabase = await getSupabaseServerClient();
  return NextResponse.json({ ok: true });
}
