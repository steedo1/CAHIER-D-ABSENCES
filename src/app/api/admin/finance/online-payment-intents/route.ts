// src/app/api/admin/finance/online-payment-intents/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = {
  srv: SupabaseClient;
  institutionId: string;
};

type GuardErr = {
  response: NextResponse;
};

const ALLOWED_ROLES = new Set(["admin", "super_admin", "finance_manager"]);

const PROVIDER_LABELS: Record<string, string> = {
  orange_money: "Orange Money",
  wave: "Wave",
  mtn_momo: "MTN Mobile Money",
  mock: "Test interne",
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fullName(row: any) {
  const first = clean(row?.first_name);
  const last = clean(row?.last_name);
  return [last, first].filter(Boolean).join(" ") || clean(row?.matricule) || "Élève";
}


async function expirePendingIntents(srv: SupabaseClient, institutionId: string) {
  const nowIso = new Date().toISOString();

  const { error } = await srv
    .schema("finance")
    .from("online_payment_intents")
    .update({
      status: "expired",
      error_message: "Paiement expiré automatiquement : confirmation opérateur non reçue dans le délai.",
      failed_at: nowIso,
      updated_at: nowIso,
    } as any)
    .eq("school_id", institutionId)
    .in("status", ["initiated", "pending"])
    .lt("expires_at", nowIso);

  if (error) {
    console.warn("[admin.online-payment-intents.expire]", error.message);
  }
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

  return { srv, institutionId };
}

export async function GET(req: NextRequest) {
  const g = await guard();
  if ("response" in g) return g.response;

  await expirePendingIntents(g.srv, g.institutionId);

  const limitParam = Number(req.nextUrl.searchParams.get("limit") || 30);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 30;

  const { data: intents, error } = await g.srv
    .schema("finance")
    .from("online_payment_intents")
    .select(
      "id,school_id,student_id,class_id,student_charge_id,account_id,amount,currency,provider,status,payer_name,payer_phone,client_reference,provider_reference,provider_transaction_id,receipt_id,error_message,created_at,updated_at,expires_at,confirmed_at,failed_at",
    )
    .eq("school_id", g.institutionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonError(error.message, 400);

  const rows = intents || [];
  const studentIds = Array.from(new Set(rows.map((row: any) => clean(row.student_id)).filter(Boolean)));
  const classIds = Array.from(new Set(rows.map((row: any) => clean(row.class_id)).filter(Boolean)));
  const chargeIds = Array.from(new Set(rows.map((row: any) => clean(row.student_charge_id)).filter(Boolean)));
  const receiptIds = Array.from(new Set(rows.map((row: any) => clean(row.receipt_id)).filter(Boolean)));
  const accountIds = Array.from(new Set(rows.map((row: any) => clean(row.account_id)).filter(Boolean)));

  const { data: students } = studentIds.length
    ? await g.srv.from("students").select("id,first_name,last_name,matricule").in("id", studentIds)
    : { data: [] as any[] };

  const { data: classes } = classIds.length
    ? await g.srv.from("classes").select("id,label").in("id", classIds)
    : { data: [] as any[] };

  const { data: charges } = chargeIds.length
    ? await g.srv
        .schema("finance")
        .from("v_charge_balances")
        .select("id,label,balance_due,paid_amount,net_amount")
        .in("id", chargeIds)
    : { data: [] as any[] };

  const { data: receipts } = receiptIds.length
    ? await g.srv.schema("finance").from("receipts").select("id,receipt_no").in("id", receiptIds)
    : { data: [] as any[] };

  const { data: paymentAccounts } = accountIds.length
    ? await g.srv
        .schema("finance")
        .from("institution_payment_accounts")
        .select("id,provider,environment,is_active")
        .in("id", accountIds)
    : { data: [] as any[] };

  const studentById = new Map<string, any>();
  for (const student of students || []) studentById.set(clean((student as any).id), student);

  const classById = new Map<string, any>();
  for (const cls of classes || []) classById.set(clean((cls as any).id), cls);

  const chargeById = new Map<string, any>();
  for (const charge of charges || []) chargeById.set(clean((charge as any).id), charge);

  const receiptById = new Map<string, any>();
  for (const receipt of receipts || []) receiptById.set(clean((receipt as any).id), receipt);

  const accountById = new Map<string, any>();
  for (const account of paymentAccounts || []) accountById.set(clean((account as any).id), account);

  const items = rows.map((row: any) => {
    const student = studentById.get(clean(row.student_id));
    const cls = classById.get(clean(row.class_id));
    const charge = chargeById.get(clean(row.student_charge_id));
    const receipt = receiptById.get(clean(row.receipt_id));
    const account = accountById.get(clean(row.account_id));
    const status = clean(row.status) || "pending";

    return {
      id: clean(row.id),
      status,
      account_id: clean(row.account_id) || null,
      provider: clean(row.provider),
      provider_label: PROVIDER_LABELS[clean(row.provider)] || clean(row.provider) || "Mobile Money",
      amount: Number(row.amount || 0),
      currency: clean(row.currency) || "XOF",
      payer_name: clean(row.payer_name),
      payer_phone: clean(row.payer_phone),
      student_name: fullName(student),
      class_label: clean(cls?.label) || "Classe non précisée",
      charge_label: clean(charge?.label) || "Frais scolaire",
      client_reference: clean(row.client_reference),
      provider_reference: clean(row.provider_reference),
      provider_transaction_id: clean(row.provider_transaction_id),
      receipt_id: clean(row.receipt_id) || null,
      receipt_no: clean(receipt?.receipt_no) || null,
      can_internal_test:
        clean(row.provider) === "orange_money" &&
        ["initiated", "pending"].includes(status) &&
        clean(account?.environment) === "test" &&
        Boolean(account?.is_active),
      receipt_missing: status === "succeeded" && !clean(row.receipt_id),
      can_receipt_repair:
        clean(row.provider) === "orange_money" &&
        status === "succeeded" &&
        !clean(row.receipt_id) &&
        clean(account?.environment) === "test" &&
        Boolean(account?.is_active),
      error_message: clean(row.error_message) || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      expires_at: row.expires_at || null,
      confirmed_at: row.confirmed_at || null,
      failed_at: row.failed_at || null,
    };
  });

  const summary = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc.amount += Number(item.amount || 0);
      acc[item.status as keyof typeof acc] = Number(acc[item.status as keyof typeof acc] || 0) + 1;
      return acc;
    },
    {
      total: 0,
      amount: 0,
      initiated: 0,
      pending: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      expired: 0,
    } as Record<string, number>,
  );

  return NextResponse.json({ ok: true, items, summary });
}
