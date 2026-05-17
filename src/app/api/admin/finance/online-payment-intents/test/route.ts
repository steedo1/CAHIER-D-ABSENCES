// src/app/api/admin/finance/online-payment-intents/test/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { confirmOnlinePaymentAndCreateReceipt } from "@/lib/finance/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = {
  srv: SupabaseClient;
  institutionId: string;
  userId: string;
};

type GuardErr = {
  response: NextResponse;
};

type ActionKind = "success" | "failed";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "finance_manager"]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

  if (profileErr) return { response: jsonError(profileErr.message, 400) };

  let institutionId = clean((profile as any)?.institution_id);

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) return { response: jsonError(roleErr.message, 400) };

  const roles = new Set<string>();
  for (const row of roleRows || []) {
    const role = clean((row as any).role);
    const rowInstitutionId = clean((row as any).institution_id);
    if (role) roles.add(role);
    if (!institutionId && rowInstitutionId) institutionId = rowInstitutionId;
  }

  if (!institutionId) {
    return { response: jsonError("Aucun établissement associé à ce compte.", 403) };
  }

  if (!Array.from(roles).some((role) => ALLOWED_ROLES.has(role))) {
    return { response: jsonError("Accès réservé à l’administration financière.", 403) };
  }

  return { srv, institutionId, userId: user.id };
}

async function markIntentAsFailed(srv: SupabaseClient, intent: any, userId: string) {
  const nowIso = new Date().toISOString();
  const rawProviderPayload = {
    ...(((intent as any).raw_provider_payload || {}) as Record<string, any>),
    internal_test: {
      status: "failed",
      simulated_by: userId,
      simulated_at: nowIso,
      reason: "Simulation technique interne Mon Cahier en environnement test.",
    },
  };

  const { error } = await srv
    .schema("finance")
    .from("online_payment_intents")
    .update({
      status: "failed",
      provider_reference: `INTERNAL-TEST-FAILED-${String(intent.id).slice(0, 8)}`,
      provider_transaction_id: `TX-INTERNAL-FAILED-${String(intent.id).slice(0, 8)}`,
      raw_provider_payload: rawProviderPayload,
      failed_at: nowIso,
      updated_at: nowIso,
      error_message: "Simulation technique : paiement refusé par le tunnel interne de test.",
    } as any)
    .eq("id", intent.id)
    .eq("school_id", intent.school_id)
    .eq("provider", "orange_money")
    .is("receipt_id", null)
    .in("status", ["initiated", "pending"]);

  if (error) throw new Error(error.message);
}

export async function POST(req: NextRequest) {
  try {
    const g = await guard();
    if ("response" in g) return g.response;

    const body = await req.json().catch(() => ({}));
    const intentId = clean((body as any).intent_id || (body as any).intentId || (body as any).id);
    const action = clean((body as any).action) as ActionKind;

    if (!intentId) return jsonError("Intention de paiement manquante.");
    if (!["success", "failed"].includes(action)) {
      return jsonError("Action de test invalide.");
    }

    const { data: intent, error: intentErr } = await g.srv
      .schema("finance")
      .from("online_payment_intents")
      .select(
        "id,school_id,account_id,provider,status,receipt_id,amount,client_reference,provider_reference,provider_transaction_id,raw_provider_payload",
      )
      .eq("id", intentId)
      .eq("school_id", g.institutionId)
      .eq("provider", "orange_money")
      .maybeSingle();

    if (intentErr) return jsonError(intentErr.message, 400);
    if (!intent) return jsonError("Intention de paiement introuvable pour cet établissement.", 404);

    const { data: account, error: accountErr } = await g.srv
      .schema("finance")
      .from("institution_payment_accounts")
      .select("id,provider,environment,is_active,secret_config")
      .eq("id", clean((intent as any).account_id))
      .eq("school_id", g.institutionId)
      .eq("provider", "orange_money")
      .maybeSingle();

    if (accountErr) return jsonError(accountErr.message, 400);
    if (!account) return jsonError("Compte Orange Money introuvable pour cette intention.", 404);
    if ((account as any).environment !== "test") {
      return jsonError("Tunnel interne refusé : le compte Orange Money n’est pas en Test / Sandbox.", 403);
    }
    if (!(account as any).is_active) {
      return jsonError("Tunnel interne refusé : le compte Orange Money n’est pas actif.", 403);
    }

    const webhookSecret = clean(((account as any).secret_config || {}).webhook_secret);
    if (!webhookSecret) {
      return jsonError("Tunnel interne refusé : aucun Webhook secret n’est configuré.", 403);
    }

    const status = clean((intent as any).status);
    if (action === "failed") {
      if (!["initiated", "pending"].includes(status)) {
        return jsonError(`Cette intention ne peut plus être marquée échouée. Statut actuel : ${status || "inconnu"}.`, 409);
      }

      await markIntentAsFailed(g.srv, intent, g.userId);
      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (!["initiated", "pending", "succeeded"].includes(status)) {
      return jsonError(`Cette intention ne peut plus être confirmée. Statut actuel : ${status || "inconnu"}.`, 409);
    }

    const nowIso = new Date().toISOString();
    const result = await confirmOnlinePaymentAndCreateReceipt({
      intentId: clean((intent as any).id),
      providerReference: clean((intent as any).provider_reference) || `INTERNAL-TEST-SUCCESS-${String((intent as any).id).slice(0, 8)}`,
      providerTransactionId:
        clean((intent as any).provider_transaction_id) || `TX-INTERNAL-SUCCESS-${String((intent as any).id).slice(0, 8)}`,
      rawProviderPayload: {
        ...(((intent as any).raw_provider_payload || {}) as Record<string, any>),
        internal_test: {
          status: "success",
          simulated_by: g.userId,
          simulated_at: nowIso,
          reason: "Simulation technique interne Mon Cahier en environnement test.",
        },
      },
      req,
    });

    return NextResponse.json({ ok: true, status: "succeeded", ...result });
  } catch (e: any) {
    console.error("[admin.finance.online-payment-intents.test]", e);
    return jsonError(String(e?.message || e), 500);
  }
}
