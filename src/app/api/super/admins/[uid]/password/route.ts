import { NextResponse } from "next/server";
import { getSupabaseActionClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { uid: string } }) {
  const s = await getSupabaseActionClient();

  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: roles } = await s.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const mode = body?.mode as "temp" | "link" | undefined;
  const pwd  = body?.password as string | undefined;

  const supabase = getSupabaseServiceClient();

  if (mode === "temp") {
    if (!pwd || pwd.length < 8) {
      return NextResponse.json({ error: "Mot de passe invalide (8+ caractÃ¨res)" }, { status: 400 });
    }
    const upd = await supabase.auth.admin.updateUserById(params.uid, { password: pwd });
    if (upd.error) return NextResponse.json({ error: upd.error?.message ?? "update failed" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (mode === "link") {
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", params.uid)
      .maybeSingle();

    const email = prof?.email ?? null;
    if (pErr || !email) {
      return NextResponse.json({ error: pErr?.message || "Email introuvable" }, { status: 400 });
    }

    const gen = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: process.env.NEXT_PUBLIC_SITE_URL || undefined },
    });
    if (gen.error) return NextResponse.json({ error: gen.error?.message ?? "generate link failed" }, { status: 400 });

    const actionLink = (gen.data as any)?.properties?.action_link ?? null;
    return NextResponse.json({ action_link: actionLink });
  }

  return NextResponse.json({ error: "mode invalide" }, { status: 400 });
}
