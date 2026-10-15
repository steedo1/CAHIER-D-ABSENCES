import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { canEditStaffAccount, isValidUuid, type StaffRoleLink, STAFF_ROLES } from "@/lib/staff-edit";

export type StaffService = ReturnType<typeof getSupabaseServiceClient>;
export type StaffScope = {
  service: StaffService;
  actorId: string;
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  isSuperAdmin: boolean;
};
export type StaffAccess = { ok: true; scope: StaffScope } | { ok: false; response: NextResponse };

function fail(error: string, status: number): StaffAccess {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** All staff mutations must resolve the actor's institution on the server. */
export async function getStaffScope(
  req: NextRequest,
  requestedInstitutionId?: string | null,
): Promise<StaffAccess> {
  const auth = await getSupabaseServerClient({ writable: true });
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return fail("Connexion requise.", 401);

  const service = getSupabaseServiceClient();
  const { data: roles, error: rolesError } = await service
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);
  if (rolesError) return fail("Vérification des droits impossible.", 500);

  const links = (roles || []) as StaffRoleLink[];
  const isSuperAdmin = links.some((role) => role.role === "super_admin");
  const ownInstitutions = Array.from(new Set(
    links.filter((role) => role.role === "admin" && role.institution_id)
      .map((role) => String(role.institution_id)),
  ));
  if (!isSuperAdmin && ownInstitutions.length === 0) return fail("Accès administrateur requis.", 403);

  let institutionId = String(
    requestedInstitutionId || req.nextUrl.searchParams.get("institution_id") || "",
  ).trim();
  const code = String(req.nextUrl.searchParams.get("institution_code") || "").trim();
  if (!institutionId && code && isSuperAdmin) {
    const { data: byCode } = await service
      .from("institutions")
      .select("id")
      .eq("code_unique", code)
      .maybeSingle();
    institutionId = String(byCode?.id || "");
  }
  if (!institutionId && ownInstitutions.length === 1) institutionId = ownInstitutions[0];
  if (!isValidUuid(institutionId)) return fail("Sélectionnez un établissement valide.", 400);
  if (!isSuperAdmin && !ownInstitutions.includes(institutionId)) {
    return fail("Établissement hors de votre périmètre.", 403);
  }

  const { data: institution, error: institutionError } = await service
    .from("institutions")
    .select("id,name,code_unique")
    .eq("id", institutionId)
    .maybeSingle();
  if (institutionError || !institution) return fail("Établissement introuvable.", 404);
  return {
    ok: true,
    scope: {
      service,
      actorId: user.id,
      institutionId,
      institutionName: String(institution.name || ""),
      institutionCode: String(institution.code_unique || ""),
      isSuperAdmin,
    },
  };
}

export type StaffTarget = {
  id: string;
  institution_id: string | null;
  display_name: string | null;
  phone: string | null;
  email: string | null;
};
export type StaffTargetAccess =
  | { ok: true; profile: StaffTarget; role: string; links: StaffRoleLink[] }
  | { ok: false; response: NextResponse };

export async function getEditableStaffTarget(
  scope: StaffScope,
  profileId: string,
): Promise<StaffTargetAccess> {
  if (!isValidUuid(profileId)) {
    return { ok: false, response: NextResponse.json({ error: "Compte invalide." }, { status: 400 }) };
  }
  const { data: profile, error: profileError } = await scope.service
    .from("profiles")
    .select("id,institution_id,display_name,phone,email")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError || !profile) {
    return { ok: false, response: NextResponse.json({ error: "Personnel introuvable." }, { status: 404 }) };
  }
  const { data: rows, error: rolesError } = await scope.service
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", profileId);
  if (rolesError) {
    return { ok: false, response: NextResponse.json({ error: "Vérification des rôles impossible." }, { status: 500 }) };
  }
  const links = (rows || []) as StaffRoleLink[];
  if (!canEditStaffAccount(
    links,
    scope.institutionId,
    String(profile.institution_id || ""),
    scope.isSuperAdmin,
  )) {
    return { ok: false, response: NextResponse.json({
      error: "Modification interdite : compte privilégié, partagé ou hors établissement.",
    }, { status: 403 }) };
  }
  const localRoles = links.filter((r) => r.institution_id === scope.institutionId);
  const role = STAFF_ROLES.find((r) => localRoles.some((link) => link.role === r)) || "teacher";
  return { ok: true, profile: profile as StaffTarget, role, links };
}

export async function getCurrentStaffAcademicYear(
  service: StaffService,
  institutionId: string,
): Promise<string | null> {
  const { data: current } = await service
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  if (current?.code) return String(current.code);
  const { data: recent } = await service
    .from("classes")
    .select("academic_year")
    .eq("institution_id", institutionId)
    .order("academic_year", { ascending: false })
    .limit(1)
    .maybeSingle();
  return recent?.academic_year ? String(recent.academic_year) : null;
}
