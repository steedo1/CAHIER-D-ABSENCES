import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export type StudentManagementCapability =
  | "search"
  | "transfer"
  | "remove"
  | "create";

const ADMIN_ROLES = new Set(["admin", "super_admin", "founder"]);
const TRANSFER_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  // Compatibilité avec les anciens comptes financiers.
  "finance",
]);

function clean(value: unknown) {
  return String(value || "").trim();
}

function roleAppliesToInstitution(
  role: string,
  roleInstitutionId: unknown,
  institutionId: string,
) {
  if (role === "super_admin") return true;
  const roleInst = clean(roleInstitutionId);
  // Les anciennes lignes de rôle financier peuvent ne pas porter
  // institution_id. Dans ce cas, le profil ou l'autre rôle financier
  // détermine l'établissement, puis l'accès reste strictement limité à celui-ci.
  if (!roleInst) return Boolean(institutionId);
  return roleInst === institutionId;
}

export async function requireStudentManagementAccess(
  capability: StudentManagementCapability,
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

  const [{ data: profile, error: profileErr }, { data: roleRows, error: roleErr }] =
    await Promise.all([
      srv
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle(),
      srv
        .from("user_roles")
        .select("role,institution_id")
        .eq("profile_id", user.id),
    ]);

  if (profileErr) {
    return {
      error: NextResponse.json({ error: profileErr.message }, { status: 400 }),
    } as const;
  }
  if (roleErr) {
    return {
      error: NextResponse.json({ error: roleErr.message }, { status: 400 }),
    } as const;
  }

  const allowedRoles = capability === "create" ? ADMIN_ROLES : TRANSFER_ROLES;
  const allowedRows = (roleRows || []).filter((row: any) =>
    allowedRoles.has(clean(row.role)),
  );

  let institutionId = clean((profile as any)?.institution_id);
  if (!institutionId) {
    institutionId = clean(
      allowedRows.find((row: any) => clean(row.institution_id))?.institution_id,
    );
  }

  if (!institutionId) {
    return {
      error: NextResponse.json({ error: "no_institution" }, { status: 400 }),
    } as const;
  }

  const hasAccess = allowedRows.some((row: any) =>
    roleAppliesToInstitution(
      clean(row.role),
      row.institution_id,
      institutionId,
    ),
  );

  if (!hasAccess) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    } as const;
  }

  return {
    supa,
    srv,
    user,
    institutionId,
    roles: new Set((roleRows || []).map((row: any) => clean(row.role))),
  } as const;
}
