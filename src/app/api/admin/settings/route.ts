import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error:"unauthorized" }, { status: 401 });
  const { data: me } = await supa.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  const { data } = await supa.from("institutions").select("settings_json").eq("id", me?.institution_id).maybeSingle();
  return NextResponse.json({ settings: data?.settings_json || {} });
}

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error:"unauthorized" }, { status: 401 });
  const { data: me } = await supa.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();

  const { settings_json } = await req.json();
  const { error } = await srv.from("institutions")
    .update({ settings_json: settings_json ?? {} })
    .eq("id", me?.institution_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}


