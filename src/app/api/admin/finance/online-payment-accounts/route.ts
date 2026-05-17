// src/app/api/admin/finance/online-payment-accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderCode = "orange_money" | "wave" | "mtn_momo";
type EnvironmentCode = "test" | "production";

type GuardOk = {
  srv: SupabaseClient;
  userId: string;
  institutionId: string;
  role: string;
};

type GuardErr = {
  response: NextResponse;
};

type ProviderDefinition = {
  provider: ProviderCode;
  label: string;
  shortLabel: string;
  help: string;
};

type PaymentAccountRow = {
  id: string;
  school_id: string;
  provider: ProviderCode;
  display_name: string | null;
  merchant_id: string | null;
  merchant_phone: string | null;
  environment: EnvironmentCode;
  is_active: boolean;
  public_config: Record<string, any> | null;
  secret_config: Record<string, any> | null;
  created_at: string | null;
  updated_at: string | null;
};

const ALLOWED_ROLES = new Set(["admin", "super_admin", "finance_manager"]);

const PROVIDERS: ProviderDefinition[] = [
  {
    provider: "orange_money",
    label: "Orange Money",
    shortLabel: "Orange",
    help: "Compte marchand Orange Money de l’établissement.",
  },
  {
    provider: "wave",
    label: "Wave Business",
    shortLabel: "Wave",
    help: "Compte Wave Business de l’établissement.",
  },
  {
    provider: "mtn_momo",
    label: "MTN Mobile Money",
    shortLabel: "MTN",
    help: "Compte marchand MTN MoMo de l’établissement.",
  },
];

const PUBLIC_PROVIDER_LABELS: Record<ProviderCode, string> = {
  orange_money: "Orange Money",
  wave: "Wave",
  mtn_momo: "MTN Mobile Money",
};


function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  return clean(value).replace(/\s+/g, "");
}

function isProvider(value: string): value is ProviderCode {
  return PROVIDERS.some((item) => item.provider === value);
}

function providerLabel(provider: ProviderCode) {
  return PROVIDERS.find((item) => item.provider === provider)?.label || provider;
}

function publicProviderLabel(provider: ProviderCode) {
  return PUBLIC_PROVIDER_LABELS[provider] || providerLabel(provider);
}

function normalizeEnvironment(value: unknown): EnvironmentCode {
  return clean(value) === "production" ? "production" : "test";
}

function hasSecrets(value: unknown) {
  return !!(
    value &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).some((entry) => clean(entry).length > 0)
  );
}

function sanitizeAccount(row: PaymentAccountRow | null | undefined) {
  if (!row) return null;

  return {
    id: row.id,
    school_id: row.school_id,
    provider: row.provider,
    label: providerLabel(row.provider),
    display_name: publicProviderLabel(row.provider),
    merchant_id: row.merchant_id || "",
    merchant_phone: row.merchant_phone || "",
    environment: row.environment || "test",
    is_active: Boolean(row.is_active),
    has_secret_config: hasSecrets(row.secret_config),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function pickBestAccount(rows: PaymentAccountRow[], provider: ProviderCode) {
  const providerRows = rows.filter((row) => row.provider === provider);
  if (!providerRows.length) return null;

  return (
    providerRows.find((row) => row.is_active && row.environment === "production") ||
    providerRows.find((row) => row.is_active) ||
    providerRows.find((row) => row.environment === "production") ||
    providerRows[0] ||
    null
  );
}

async function guard(): Promise<GuardOk | GuardErr> {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { response: jsonError("Session expirée. Reconnectez-vous.", 401) };
  }

  const { data: profile, error: profileErr } = await srv
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    return { response: jsonError(profileErr.message, 400) };
  }

  let institutionId = clean((profile as any)?.institution_id);
  let role = "";

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) {
    return { response: jsonError(roleErr.message, 400) };
  }

  const allRoles = new Set<string>();

  for (const row of roleRows || []) {
    const rowRole = clean((row as any).role);
    const rowInstitutionId = clean((row as any).institution_id);
    if (rowRole) allRoles.add(rowRole);
    if (!institutionId && rowInstitutionId) institutionId = rowInstitutionId;
    if (!role && rowRole) role = rowRole;
  }

  const allowed = Array.from(allRoles).some((item) => ALLOWED_ROLES.has(item));

  if (!institutionId) {
    return { response: jsonError("Aucun établissement associé à ce compte.", 403) };
  }

  if (!allowed) {
    return { response: jsonError("Accès réservé à l’administration financière.", 403) };
  }

  return { srv, userId: user.id, institutionId, role: role || "admin" };
}

export async function GET() {
  const g = await guard();
  if ("response" in g) return g.response;

  const { data: institution, error: institutionErr } = await g.srv
    .from("institutions")
    .select("id,name")
    .eq("id", g.institutionId)
    .maybeSingle();

  if (institutionErr) return jsonError(institutionErr.message, 400);

  const { data: rows, error } = await g.srv
    .schema("finance")
    .from("institution_payment_accounts")
    .select(
      "id,school_id,provider,display_name,merchant_id,merchant_phone,environment,is_active,public_config,secret_config,created_at,updated_at",
    )
    .eq("school_id", g.institutionId)
    .in(
      "provider",
      PROVIDERS.map((item) => item.provider),
    )
    .order("provider", { ascending: true })
    .order("environment", { ascending: true });

  if (error) return jsonError(error.message, 400);

  const accountRows = ((rows || []) as PaymentAccountRow[]).filter((row) =>
    isProvider(String(row.provider)),
  );

  const accounts = PROVIDERS.map((definition) => {
    const row = pickBestAccount(accountRows, definition.provider);
    return {
      provider: definition.provider,
      label: definition.label,
      short_label: definition.shortLabel,
      help: definition.help,
      configured: Boolean(row),
      account: row
        ? sanitizeAccount(row)
        : {
            id: null,
            school_id: g.institutionId,
            provider: definition.provider,
            label: definition.label,
            display_name: publicProviderLabel(definition.provider),
            merchant_id: "",
            merchant_phone: "",
            environment: "test" as EnvironmentCode,
            is_active: false,
            has_secret_config: false,
            created_at: null,
            updated_at: null,
          },
    };
  });

  return NextResponse.json({
    ok: true,
    institution: {
      id: g.institutionId,
      name: clean((institution as any)?.name) || "Établissement",
    },
    model: "school_direct_collection",
    message:
      "Chaque établissement encaisse directement sur son propre compte Mobile Money. Nexa Digital ne reçoit pas les fonds.",
    accounts,
  });
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if ("response" in g) return g.response;

  const body = await req.json().catch(() => ({}));
  const provider = clean(body?.provider);

  if (!isProvider(provider)) {
    return jsonError("Moyen de paiement invalide.", 400);
  }

  const environment = normalizeEnvironment(body?.environment);
  const isActive = Boolean(body?.is_active);
  const displayName = publicProviderLabel(provider);
  const merchantId = clean(body?.merchant_id);
  const merchantPhone = normalizePhone(body?.merchant_phone);

  if (isActive && !merchantId && !merchantPhone) {
    return jsonError(
      "Pour activer ce moyen de paiement, renseignez au moins l’identifiant marchand ou le numéro marchand.",
      400,
    );
  }

  const { data: existingRow, error: existingErr } = await g.srv
    .schema("finance")
    .from("institution_payment_accounts")
    .select("id,secret_config")
    .eq("school_id", g.institutionId)
    .eq("provider", provider)
    .eq("environment", environment)
    .maybeSingle();

  if (existingErr) return jsonError(existingErr.message, 400);

  const previousSecretConfig =
    existingRow && typeof (existingRow as any).secret_config === "object"
      ? ((existingRow as any).secret_config as Record<string, unknown>)
      : {};

  const secretUpdates: Record<string, string> = {};
  const secretFields = [
    "api_key",
    "api_user",
    "api_password",
    "client_id",
    "client_secret",
    "merchant_key",
    "webhook_secret",
  ];

  for (const field of secretFields) {
    const value = clean(body?.[field]);
    if (value) secretUpdates[field] = value;
  }

  const secretConfig = body?.clear_secrets
    ? {}
    : {
        ...previousSecretConfig,
        ...secretUpdates,
      };

  const publicConfig = {
    model: "school_direct_collection",
    managed_from: "admin_finance_online_payments",
    configured_by: g.userId,
    configured_role: g.role,
    public_label: displayName,
  };

  const nowIso = new Date().toISOString();

  if (isActive) {
    await g.srv
      .schema("finance")
      .from("institution_payment_accounts")
      .update({ is_active: false, updated_at: nowIso } as any)
      .eq("school_id", g.institutionId)
      .eq("provider", provider)
      .neq("environment", environment);
  }

  const { data, error } = await g.srv
    .schema("finance")
    .from("institution_payment_accounts")
    .upsert(
      {
        school_id: g.institutionId,
        provider,
        display_name: displayName,
        merchant_id: merchantId || null,
        merchant_phone: merchantPhone || null,
        environment,
        is_active: isActive,
        public_config: publicConfig,
        secret_config: secretConfig,
        updated_at: nowIso,
      } as any,
      { onConflict: "school_id,provider,environment" },
    )
    .select(
      "id,school_id,provider,display_name,merchant_id,merchant_phone,environment,is_active,public_config,secret_config,created_at,updated_at",
    )
    .single();

  if (error) return jsonError(error.message, 400);

  return NextResponse.json({
    ok: true,
    message: isActive
      ? `${providerLabel(provider)} est activé pour cet établissement.`
      : `${providerLabel(provider)} est enregistré mais désactivé.`,
    account: sanitizeAccount(data as PaymentAccountRow),
  });
}
