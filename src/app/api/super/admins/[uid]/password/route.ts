import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseActionClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "temp" | "link";

/**
 * POST /api/super/users/:uid/reset
 * Body: { mode: "temp" | "link", password?: string }
 * - mode=temp : force un mot de passe temporaire
 * - mode=link : envoie un lien de réinitialisation (type "recovery")
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ uid: string }> } // Next 15: params est une Promise
) {
  const { uid } = await context.params;

  const s = await getSupabaseActionClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Vérifie rôle super_admin
  const { data: roles } = await s
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (!(roles ?? []).some((r) => r.role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Lecture body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const mode = body?.mode as Mode | undefined;
  const pwd = body?.password as string | undefined;

  const supabase = getSupabaseServiceClient();

  // --- Mode "temp": mot de passe temporaire forcé ---
  if (mode === "temp") {
    if (!pwd || pwd.length < 8) {
      return NextResponse.json(
        { error: "Mot de passe invalide (8+ caractères)" },
        { status: 400 }
      );
    }
    const upd = await supabase.auth.admin.updateUserById(uid, { password: pwd });
    if (upd.error) {
      return NextResponse.json(
        { error: upd.error?.message ?? "update failed" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // --- Mode "link": lien de réinitialisation (recovery) ---
  if (mode === "link") {
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", uid)
      .maybeSingle();

    const email = prof?.email ?? null;
    if (pErr || !email) {
      return NextResponse.json(
        { error: pErr?.message || "Email introuvable" },
        { status: 400 }
      );
    }

    const gen = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: process.env.NEXT_PUBLIC_SITE_URL || undefined },
    });

    if (gen.error) {
      return NextResponse.json(
        { error: gen.error?.message ?? "generate link failed" },
        { status: 400 }
      );
    }

    const actionLink = (gen.data as any)?.properties?.action_link ?? null;
    return NextResponse.json({ action_link: actionLink });
  }

  // Mode invalide
  return NextResponse.json({ error: "mode invalide" }, { status: 400 });
}
