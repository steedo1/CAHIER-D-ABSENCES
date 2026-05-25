// src/lib/finance-access.ts
import { getSupabaseServerClient } from "@/lib/supabase-server";

export type FinanceAccessScope = "full" | "payroll" | "any";

export type FinanceAccessResult = {
  ok: boolean;
  scope?: "full" | "payroll";
  reason:
    | "ok"
    | "not_authenticated"
    | "no_institution"
    | "role_not_allowed"
    | "finance_not_enabled"
    | "subscription_expired";
  institutionId: string | null;
  premiumEnabled?: boolean;
  subscriptionValid?: boolean;
  expiresAt?: string | null;
};

const FINANCE_FULL_ACCESS_ROLES = new Set([
  "super_admin",
  "founder",
  "finance_manager",
]);

const FINANCE_PAYROLL_ACCESS_ROLES = new Set(["admin"]);

function isFinanceRelatedRole(role: string) {
  return (
    FINANCE_FULL_ACCESS_ROLES.has(role) ||
    FINANCE_PAYROLL_ACCESS_ROLES.has(role)
  );
}

function cleanId(value: unknown) {
  return String(value || "").trim();
}

function roleMatchesInstitution(
  role: string,
  roleInstitutionId: unknown,
  institutionId: string,
) {
  if (role === "super_admin") return true;

  const roleInst = cleanId(roleInstitutionId);
  if (!roleInst) return Boolean(institutionId);

  return roleInst === institutionId;
}

export async function getFinanceInstitutionIdForCurrentUser(): Promise<string> {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok || !access.institutionId) {
    if (access.reason === "not_authenticated") {
      throw new Error("Utilisateur non authentifié.");
    }
    if (access.reason === "no_institution") {
      throw new Error("Aucun établissement associé à cet utilisateur.");
    }
    if (access.reason === "role_not_allowed") {
      throw new Error("Accès financier non autorisé pour cet utilisateur.");
    }
    if (access.reason === "finance_not_enabled") {
      throw new Error(
        "Le module Finance n’est pas activé pour cet établissement.",
      );
    }
    if (access.reason === "subscription_expired") {
      throw new Error("L’abonnement Finance de cet établissement est expiré.");
    }
    throw new Error("Accès financier indisponible.");
  }

  return access.institutionId;
}

export async function getFinanceAccessForCurrentUser(
  requiredScope: FinanceAccessScope = "full",
): Promise<FinanceAccessResult> {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: "not_authenticated",
      institutionId: null,
    };
  }

  const [
    { data: profile, error: profileErr },
    { data: roleRows, error: roleErr },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id),
  ]);

  if (profileErr) {
    throw new Error(profileErr.message);
  }
  if (roleErr) {
    throw new Error(roleErr.message);
  }

  const financeRoles = (roleRows ?? []).filter((row: any) =>
    isFinanceRelatedRole(String(row.role || "")),
  );

  let institutionId = cleanId((profile as any)?.institution_id);
  if (!institutionId) {
    const roleInstitution = financeRoles.find((row: any) =>
      cleanId(row.institution_id),
    );
    institutionId = cleanId((roleInstitution as any)?.institution_id);
  }

  if (!institutionId) {
    return {
      ok: false,
      reason: "no_institution",
      institutionId: null,
    };
  }

  const hasFullFinanceRole = financeRoles.some((row: any) => {
    const role = String(row.role || "");
    return (
      FINANCE_FULL_ACCESS_ROLES.has(role) &&
      roleMatchesInstitution(role, row.institution_id, institutionId)
    );
  });

  const hasPayrollFinanceRole = financeRoles.some((row: any) => {
    const role = String(row.role || "");
    return (
      (FINANCE_FULL_ACCESS_ROLES.has(role) ||
        FINANCE_PAYROLL_ACCESS_ROLES.has(role)) &&
      roleMatchesInstitution(role, row.institution_id, institutionId)
    );
  });

  const hasFinanceRole =
    requiredScope === "payroll"
      ? hasPayrollFinanceRole
      : requiredScope === "any"
        ? hasFullFinanceRole || hasPayrollFinanceRole
        : hasFullFinanceRole;

  if (!hasFinanceRole) {
    return {
      ok: false,
      reason: "role_not_allowed",
      institutionId,
    };
  }

  const hasFounderBypass = financeRoles.some((row: any) => {
    const role = String(row.role || "");
    return (
      (role === "founder" || role === "super_admin") &&
      roleMatchesInstitution(role, row.institution_id, institutionId)
    );
  });

  const resolvedScope = hasFullFinanceRole ? "full" : "payroll";

  const { data: institution, error: institutionErr } = await supabase
    .from("institutions")
    .select("subscription_expires_at")
    .eq("id", institutionId)
    .maybeSingle();

  if (institutionErr) {
    throw new Error(institutionErr.message);
  }

  const expiresAt = institution?.subscription_expires_at ?? null;

  // Le rôle admin établissement ne reçoit pas la gestion financière complète.
  // Il garde seulement la paie des enseignants, sans être redirigé vers tout le module Finance.
  if (requiredScope === "payroll" && !hasFullFinanceRole) {
    return {
      ok: true,
      scope: "payroll",
      reason: "ok",
      institutionId,
      premiumEnabled: true,
      subscriptionValid: true,
      expiresAt,
    };
  }

  // Le fondateur est le propriétaire opérationnel : il doit pouvoir contrôler
  // la finance complète, même si le module est verrouillé côté école.
  if (hasFounderBypass) {
    return {
      ok: true,
      scope: "full",
      reason: "ok",
      institutionId,
      premiumEnabled: true,
      subscriptionValid: true,
      expiresAt,
    };
  }

  const { data: financeSettings, error: financeErr } = await supabase
    .from("institution_finance_module_settings")
    .select("finance_premium_enabled")
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (financeErr) {
    throw new Error(financeErr.message);
  }

  const premiumEnabled = financeSettings?.finance_premium_enabled === true;

  const subscriptionValid =
    !!expiresAt && new Date(`${expiresAt}T23:59:59`).getTime() >= Date.now();

  if (!premiumEnabled) {
    return {
      ok: false,
      reason: "finance_not_enabled",
      institutionId,
      premiumEnabled,
      subscriptionValid,
      expiresAt,
    };
  }

  if (!subscriptionValid) {
    return {
      ok: false,
      reason: "subscription_expired",
      institutionId,
      premiumEnabled,
      subscriptionValid,
      expiresAt,
    };
  }

  return {
    ok: true,
    scope: resolvedScope,
    reason: "ok",
    institutionId,
    premiumEnabled,
    subscriptionValid,
    expiresAt,
  };
}
