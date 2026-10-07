// src/app/api/admin/users/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!; // �a� secret c�t� serveur
const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "";

/* ---------- helpers ---------- */

function randomPass(len = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

/* ---------- POST /api/admin/users/reset-password ---------- */
/**
 * Body attendu:
 *   { user_id: string, new_password?: string }
 * Si new_password est absent �  mot de passe temporaire g�n�r� (ou DEFAULT_TEMP_PASSWORD si configur�).
 * R�gles:
 *   - super_admin : peut r�initialiser tout le monde
 *   - admin       : uniquement les profils appartenant � son/ses institution(s) (via table public.user_roles)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const user_id = String(body?.user_id || "").trim();
    let   new_password = (body?.new_password ? String(body.new_password) : "").trim();

    if (!user_id) {
      return NextResponse.json({ error: "Param�tre user_id manquant." }, { status: 400 });
    }
    if (new_password && new_password.length < 6) {
      return NextResponse.json({ error: "Mot de passe trop court (6+)." }, { status: 400 });
    }

    // 1) Auth appelant via cookies (SDK navigateur)
    const supabase = await getSupabaseServerClient({ writable: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non authentifi�." }, { status: 401 });

    // 2) V�rif r�le & p�rim�tre via user_roles (service role �  pas de RLS)
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // r�les de l'appelant
    const { data: myRoles, error: rolesErr } = await svc
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);
    if (rolesErr) return NextResponse.json({ error: rolesErr.message }, { status: 400 });

    const roleList = (myRoles || []).map((r) => String(r.role));
    const isSuper  = roleList.includes("super_admin");
    const isAdmin  = isSuper || roleList.includes("admin");
    if (!isAdmin) return NextResponse.json({ error: "Acc�s refus� (admin requis)." }, { status: 403 });

    const adminScopes = (myRoles || [])
      .filter((r) => r.institution_id && (r.role === "admin" || r.role === "super_admin"))
      .map((r) => r.institution_id as string);

    // p�rim�tre du profil cible
    const { data: targetRoles, error: tErr } = await svc
      .from("user_roles")
      .select("institution_id")
      .eq("profile_id", user_id);
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });

    if (!isSuper) {
      // admin simple : doit partager au moins une institution avec la cible
      const targetInst = new Set((targetRoles || []).map((r) => String(r.institution_id)));
      const allowed    = adminScopes.some((i) => targetInst.has(i));
      if (!allowed) {
        return NextResponse.json({ error: "Utilisateur hors p�rim�tre de votre �tablissement." }, { status: 403 });
      }
    }

    // 3) Mot de passe � appliquer
    if (!new_password) {
      new_password = DEFAULT_TEMP_PASSWORD || randomPass(10);
    }

    // 4) Mise � jour via API Admin (service role)
    const { error: updErr } = await svc.auth.admin.updateUserById(user_id, { password: new_password });
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, temporary: !Boolean(body?.new_password) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur serveur." }, { status: 500 });
  }
}


