import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, sanitize } from "@/lib/phone";

/** The initial 0 belongs to Côte d'Ivoire's national number, including after +225. */
export function phoneLoginCandidates(raw: string, country?: string): string[] {
  const normalized = normalizePhone(raw, {
    defaultCountryAlpha2: country?.trim().toUpperCase(),
  });
  if (!normalized) return [];
  const local = sanitize(raw);
  const preferred = /^0\d{9}$/.test(local) && normalized.startsWith("+225")
    ? `+225${local}`
    : normalized;
  return /^\+2250\d{9}$/.test(preferred)
    ? [preferred, `+225${preferred.slice(5)}`]
    : [preferred];
}

export function canonicalIvorianPhoneFromLegacy(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  return /^225[1-9]\d{8}$/.test(digits) ? `+2250${digits.slice(3)}` : null;
}

/** Check Auth too: a contact number alone must never select another identity. */
export async function findCanonicalPhoneAccount(
  service: SupabaseClient,
  phone: string,
  institutionId?: string,
): Promise<string | null> {
  let query = service.from("profiles").select("id")
    .in("phone", [phone, phone.replace(/^\+/, "")]);
  if (institutionId) query = query.eq("institution_id", institutionId);
  const { data: profiles, error } = await query.limit(2);
  if (error || (profiles || []).length > 1) throw new Error("phone_login_lookup_failed");
  for (const profile of profiles || []) {
    const { data, error: authError } = await service.auth.admin.getUserById(profile.id);
    if (authError?.status === 404) continue;
    if (authError) throw new Error("phone_login_lookup_failed");
    if (String(data.user?.phone || "").replace(/\D/g, "") === phone.slice(1)) {
      return profile.id;
    }
  }
  return null;
}

export async function resolvePhoneLoginCandidates(service: SupabaseClient, raw: string, country?: string) {
  const candidates = phoneLoginCandidates(raw, country);
  // A bad password for an existing canonical account must not silently log in
  // to a duplicate legacy account. Legacy-only accounts retain their fallback.
  if (candidates.length === 2 && await findCanonicalPhoneAccount(service, candidates[0])) {
    return [candidates[0]];
  }
  return candidates;
}
