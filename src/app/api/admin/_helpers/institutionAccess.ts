import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type RequireInstitutionAccessOptions = {
  allowedRoles: readonly string[];
};

function cleanId(value: unknown) {
  return String(value || "").trim();
}

/**
 * Résout l'établissement du compte connecté sans dépendre d'une colonne
 * profiles.role : dans le schéma de production, les rôles sont portés par
 * public.user_roles.
 *
 * Source principale de l'établissement : profiles.institution_id.
 * Compatibilité : user_roles.institution_id pour les comptes historiques dont
 * le profil n'a pas encore été synchronisé.
 */
export async function requireInstitutionAccess(
  options: RequireInstitutionAccessOptions,
) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    } as const;
  }

  const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] =
    await Promise.all([
      supa
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle(),
      srv
        .from("user_roles")
        .select("role,institution_id")
        .eq("profile_id", user.id),
    ]);

  if (profileError) {
    return {
      error: NextResponse.json({ error: profileError.message }, { status: 400 }),
    } as const;
  }

  if (roleError) {
    return {
      error: NextResponse.json({ error: roleError.message }, { status: 400 }),
    } as const;
  }

  const allowedRoles = new Set(options.allowedRoles.map(String));
  const allowedRows = (roleRows || []).filter((row: any) =>
    allowedRoles.has(String(row.role || "")),
  );

  const profileInstitutionId = cleanId((profile as any)?.institution_id);
  let institutionId = profileInstitutionId;

  if (!institutionId) {
    const rowWithInstitution = allowedRows.find((row: any) =>
      cleanId(row.institution_id),
    );
    institutionId = cleanId(rowWithInstitution?.institution_id);
  }

  if (!institutionId) {
    return {
      error: NextResponse.json({ error: "no_institution" }, { status: 400 }),
    } as const;
  }

  const applicableRows = allowedRows.filter((row: any) => {
    const role = String(row.role || "");
    if (role === "super_admin") return true;

    const roleInstitutionId = cleanId(row.institution_id);
    if (roleInstitutionId) return roleInstitutionId === institutionId;

    // Une ligne historique sans institution n'est valable que lorsque le
    // profil porte explicitement l'établissement courant.
    return Boolean(
      profileInstitutionId && profileInstitutionId === institutionId,
    );
  });

  const applicableRoles = new Set(
    applicableRows.map((row: any) => String(row.role || "")),
  );

  if (!applicableRoles.size) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    } as const;
  }

  return {
    user: { id: user.id },
    supa,
    srv,
    institutionId,
    roles: applicableRoles,
  } as const;
}
