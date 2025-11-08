// src/app/api/institution/config/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ auto_lateness: true, tz: "Africa/Abidjan" });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const instId = me?.institution_id as string | null;
  if (!instId) return NextResponse.json({ auto_lateness: true, tz: "Africa/Abidjan" });

  const { data: inst } = await supa
    .from("institutions")
    .select("auto_lateness, tz")
    .eq("id", instId)
    .maybeSingle();

  return NextResponse.json({
    auto_lateness: inst?.auto_lateness ?? true,
    tz: inst?.tz ?? "Africa/Abidjan",
  });
}
