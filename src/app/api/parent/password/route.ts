import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { new_password } = await req.json().catch(()=>({}));
  if (!new_password || String(new_password).length < 6) {
    return NextResponse.json({ error: "invalid_password" }, { status: 400 });
  }

  const { error } = await supa.auth.updateUser({ password: String(new_password) });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
