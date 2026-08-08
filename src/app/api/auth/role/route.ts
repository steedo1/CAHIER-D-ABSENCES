import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { AppRole } from "@/lib/auth/role";
import { ROLE_PRIORITY } from "@/lib/auth/role";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ role: null }, { status: 401 });
  }

  const { data: rows, error: rolesErr } = await supabase
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  const safeRows = rolesErr ? [] : (rows ?? []);
  const roles = safeRows.map((r: any) => r.role as AppRole);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? roles[0] ?? null;
  const primaryRow =
    safeRows.find((row: any) => row.role === primary && row.institution_id) ||
    safeRows.find((row: any) => row.institution_id) ||
    null;

  // Les comptes-classe sont également reconnus par leur numéro associé à la
  // classe, comme dans /redirect. Cela évite de les enregistrer par erreur
  // comme enseignants pour la connexion hors ligne.
  let classDeviceInstitutionId: string | null = null;
  const phone = String(user.phone || "").trim();
  if (phone && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = getSupabaseServiceClient();
      const { data: classRow } = await admin
        .from("classes")
        .select("institution_id")
        .eq("class_phone_e164", phone)
        .maybeSingle();
      classDeviceInstitutionId = String(classRow?.institution_id || "").trim() || null;
    } catch {
      classDeviceInstitutionId = null;
    }
  }

  return NextResponse.json({
    user_id: user.id,
    role: classDeviceInstitutionId ? "class_device" : primary,
    institution_id:
      classDeviceInstitutionId ||
      (primaryRow?.institution_id ? String(primaryRow.institution_id) : null),
  });
}
