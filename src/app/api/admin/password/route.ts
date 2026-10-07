// src/app/api/admin/password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";




export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const new_password = String(body?.new_password || "").trim();
    if (!new_password || new_password.length < 6) {
      return NextResponse.json(
        { error: "Mot de passe trop court (6+)." },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient({ writable: true });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non authentifie." }, { status: 401 });
    }

    const { error } = await supabase.auth.updateUser({
      password: new_password,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erreur serveur." },
      { status: 500 }
    );
  }
}
