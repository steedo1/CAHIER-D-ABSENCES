// src/lib/sms/policy.ts

import type { SupabaseClient } from "@supabase/supabase-js";

export type SmsEventKind =
  | "absent"
  | "late"
  | "notes_digest";

export type InstitutionSmsPolicy = {
  institutionId: string;
  pushEnabled: boolean;

  smsPremiumEnabled: boolean;
  smsProvider: string | null;
  smsSenderName: string | null;

  smsAbsenceEnabled: boolean;
  smsLateEnabled: boolean;
  smsNotesDigestEnabled: boolean;

  whatsappPremiumEnabled: boolean;

  raw?: unknown;
};

type Maybe<T> = T | null | undefined;

const DEFAULT_SMS_PROVIDER = "orange_ci";

function s(v: Maybe<unknown>): string {
  return String(v ?? "").trim();
}

function toBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const x = v.trim().toLowerCase();
    if (["true", "1", "yes", "oui", "on"].includes(x)) return true;
    if (["false", "0", "no", "non", "off"].includes(x)) return false;
  }
  return fallback;
}

function normalizeProvider(value: unknown): string | null {
  const x = s(value).toLowerCase();
  if (!x) return null;

  if (["orange", "orange_ci", "orange-ci"].includes(x)) return "orange_ci";
  if (x === "twilio") return "twilio";
  if (x === "custom") return "custom";

  return x;
}

export function normalizeSmsEventKind(value: unknown): SmsEventKind | null {
  const x = s(value).toLowerCase();

  if (!x) return null;

  if (["absent", "absence"].includes(x)) return "absent";
  if (["late", "retard"].includes(x)) return "late";
  if (
    [
      "notes_digest",
      "grade_digest",
      "grades_digest",
      "weekly_notes",
      "weekly_grades",
    ].includes(x)
  ) {
    return "notes_digest";
  }

  return null;
}

export function makeDefaultInstitutionSmsPolicy(
  institutionId: string
): InstitutionSmsPolicy {
  return {
    institutionId,
    pushEnabled: true,

    smsPremiumEnabled: false,
    smsProvider: DEFAULT_SMS_PROVIDER,
    smsSenderName: null,

    smsAbsenceEnabled: false,
    smsLateEnabled: false,
    smsNotesDigestEnabled: false,

    whatsappPremiumEnabled: false,

    raw: null,
  };
}

function mapRowToInstitutionSmsPolicy(
  institutionId: string,
  row: any
): InstitutionSmsPolicy {
  const fallback = makeDefaultInstitutionSmsPolicy(institutionId);

  return {
    institutionId,

    pushEnabled: toBool(row?.push_enabled, fallback.pushEnabled),

    smsPremiumEnabled: toBool(
      row?.sms_premium_enabled,
      fallback.smsPremiumEnabled
    ),
    smsProvider: normalizeProvider(row?.sms_provider) || fallback.smsProvider,
    smsSenderName: s(row?.sms_sender_name) || null,

    smsAbsenceEnabled: toBool(
      row?.sms_absence_enabled,
      fallback.smsAbsenceEnabled
    ),
    smsLateEnabled: toBool(
      row?.sms_late_enabled,
      fallback.smsLateEnabled
    ),
    smsNotesDigestEnabled: toBool(
      row?.sms_notes_digest_enabled,
      fallback.smsNotesDigestEnabled
    ),

    whatsappPremiumEnabled: toBool(
      row?.whatsapp_premium_enabled,
      fallback.whatsappPremiumEnabled
    ),

    raw: row ?? null,
  };
}

/**
 * Charge la politique SMS premium dâ€™un Ã©tablissement.
 * Si aucune ligne nâ€™existe, on renvoie une politique par dÃ©faut non bloquante pour le push.
 */
export async function getInstitutionSmsPolicy(
  srv: SupabaseClient,
  institutionId: string
): Promise<InstitutionSmsPolicy> {
  const cleanInstitutionId = s(institutionId);
  if (!cleanInstitutionId) {
    throw new Error("institutionId manquant dans getInstitutionSmsPolicy().");
  }

  const { data, error } = await srv
    .from("institution_notification_channel_settings")
    .select(
      `
      institution_id,
      push_enabled,
      sms_premium_enabled,
      sms_provider,
      sms_sender_name,
      sms_absence_enabled,
      sms_late_enabled,
      sms_notes_digest_enabled,
      whatsapp_premium_enabled
      `
    )
    .eq("institution_id", cleanInstitutionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Impossible de charger la politique SMS Ã©tablissement: ${error.message}`
    );
  }

  if (!data) {
    return makeDefaultInstitutionSmsPolicy(cleanInstitutionId);
  }

  return mapRowToInstitutionSmsPolicy(cleanInstitutionId, data);
}

export function isSmsPremiumEnabled(
  policy: InstitutionSmsPolicy | null | undefined
): boolean {
  return !!policy?.smsPremiumEnabled;
}

export function isPushEnabled(
  policy: InstitutionSmsPolicy | null | undefined
): boolean {
  return policy?.pushEnabled !== false;
}

export function isSmsEventEnabled(
  policy: InstitutionSmsPolicy | null | undefined,
  event: SmsEventKind
): boolean {
  if (!policy?.smsPremiumEnabled) return false;

  if (event === "absent") return !!policy.smsAbsenceEnabled;
  if (event === "late") return !!policy.smsLateEnabled;
  if (event === "notes_digest") return !!policy.smsNotesDigestEnabled;

  return false;
}

export function shouldSendSmsForEvent(
  policy: InstitutionSmsPolicy | null | undefined,
  event: SmsEventKind
): boolean {
  return isSmsEventEnabled(policy, event);
}

export async function shouldSendSmsForInstitutionEvent(opts: {
  srv: SupabaseClient;
  institutionId: string;
  event: SmsEventKind;
}): Promise<{
  allowed: boolean;
  policy: InstitutionSmsPolicy;
}> {
  const policy = await getInstitutionSmsPolicy(opts.srv, opts.institutionId);
  const allowed = shouldSendSmsForEvent(policy, opts.event);

  return { allowed, policy };
}

/**
 * Retourne le provider Ã  utiliser pour lâ€™Ã©tablissement.
 * On garde orange_ci comme dÃ©faut logique pour ton projet.
 */
export function resolveSmsProvider(
  policy: InstitutionSmsPolicy | null | undefined
): string {
  return normalizeProvider(policy?.smsProvider) || DEFAULT_SMS_PROVIDER;
}

/**
 * Retourne le sender name business si prÃ©sent.
 * Ne remplace pas ORANGE_SMS_SENDER technique cÃ´tÃ© API,
 * mais utile pour une future logique mÃ©tier / affichage admin.
 */
export function resolveSmsSenderName(
  policy: InstitutionSmsPolicy | null | undefined
): string | null {
  return s(policy?.smsSenderName) || null;
}