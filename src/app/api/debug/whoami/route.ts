import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return NextResponse.json({
    ok: !error,
    userId: user?.id ?? null,
    email: user?.email ?? null,
  });
}
