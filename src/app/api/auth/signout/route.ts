import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function POST() {
  const supabase = await getSupabaseServerClient();
  return NextResponse.json({ ok: true });
}


