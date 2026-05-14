// src/lib/finance-access.ts
import { getSupabaseServerClient } from "@/lib/supabase-server";

export type FinanceAccessResult = {
  ok: boolean;
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

const FINANCE_ALLOWED_ROLES = new Set([
  "super_admin",
  "founder",
  "admin",
  "finance_manager",
]);

export async function getFinanceAccessForCurrentUser(): Promise<FinanceAccessResult> {
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

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    throw new Error(profileErr.message);
  }

  const institutionId = profile?.institution_id ?? null;

  if (!institutionId) {
    return {
      ok: false,
      reason: "no_institution",
      institutionId: null,
    };
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) {
    throw new Error(roleErr.message);
  }

  const hasFinanceRole = (roleRows ?? []).some((row) => {
    const role = String(row.role);
    const roleInstitutionId = row.institution_id ? String(row.institution_id) : null;

    if (role === "super_admin") return true;
    if (!FINANCE_ALLOWED_ROLES.has(role)) return false;

    return roleInstitutionId === institutionId;
  });

  if (!hasFinanceRole) {
    return {
      ok: false,
      reason: "role_not_allowed",
      institutionId,
    };
  }

  const { data: institution, error: institutionErr } = await supabase
    .from("institutions")
    .select("subscription_expires_at")
    .eq("id", institutionId)
    .maybeSingle();

  if (institutionErr) {
    throw new Error(institutionErr.message);
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
  const expiresAt = institution?.subscription_expires_at ?? null;

  const subscriptionValid =
    !!expiresAt &&
    new Date(`${expiresAt}T23:59:59`).getTime() >= Date.now();

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
    reason: "ok",
    institutionId,
    premiumEnabled,
    subscriptionValid,
    expiresAt,
  };
}
