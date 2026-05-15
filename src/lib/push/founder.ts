// src/lib/push/founder.ts
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

type FounderNotificationKind =
  | "founder_finance_payment_received"
  | "founder_finance_expense_created"
  | "founder_finance_receipt_cancelled"
  | "founder_finance_expense_cancelled"
  | "founder_finance_daily_summary";

type QueueFounderNotificationInput = {
  institutionId: string;
  kind: FounderNotificationKind;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, any>;
  req?: Request;
  dispatch?: boolean;
};

function compactString(value: unknown, fallback = "") {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s || fallback;
}

function money(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

async function getInstitutionName(institutionId: string) {
  try {
    const srv = getSupabaseServiceClient();
    const { data } = await srv
      .from("institutions")
      .select("name")
      .eq("id", institutionId)
      .maybeSingle();
    return compactString((data as any)?.name, "Établissement");
  } catch {
    return "Établissement";
  }
}

export async function queueFounderNotification({
  institutionId,
  kind,
  title,
  body,
  url = "/founder/finance",
  data = {},
  req,
  dispatch = true,
}: QueueFounderNotificationInput) {
  const srv = getSupabaseServiceClient();
  const inst = compactString(institutionId);

  if (!inst) {
    console.warn("[push/founder] institutionId manquant", { kind });
    return { ok: false as const, queued: 0, reason: "missing_institution" };
  }

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", inst)
    .eq("role", "founder");

  if (roleErr) {
    console.error("[push/founder] role lookup error", roleErr);
    return { ok: false as const, queued: 0, reason: roleErr.message };
  }

  const founderIds = Array.from(
    new Set(
      (roleRows ?? [])
        .map((row: any) => String(row.profile_id || ""))
        .filter(Boolean),
    ),
  );

  if (!founderIds.length) {
    return { ok: true as const, queued: 0, reason: "no_founder" };
  }

  const payload = {
    kind,
    title: compactString(title, "Notification fondateur"),
    body: compactString(body),
    institution_id: inst,
    url,
    ...data,
  };

  const rows = founderIds.map((profileId) => ({
    institution_id: inst,
    profile_id: profileId,
    channels: ["push"],
    payload,
    title: payload.title,
    body: payload.body,
    status: WAIT_STATUS,
    attempts: 0,
    meta: {
      kind,
      institution_id: inst,
      queued_for: "founder",
      scope: "finance",
    },
  }));

  const { error: insertErr } = await srv.from("notifications_queue").insert(rows as any);

  if (insertErr) {
    console.error("[push/founder] queue insert error", insertErr);
    return { ok: false as const, queued: 0, reason: insertErr.message };
  }

  if (dispatch) {
    try {
      await triggerPushDispatch({
        req,
        reason: kind,
        timeoutMs: 2500,
        retries: 0,
      });
    } catch (e: any) {
      console.warn("[push/founder] dispatch non bloquant", e?.message || e);
    }
  }

  return { ok: true as const, queued: rows.length, reason: "queued" };
}

export async function queueFounderFinancePaymentNotification(input: {
  institutionId: string;
  amount: number;
  receiptNo?: string | null;
  payerName?: string | null;
  studentName?: string | null;
  req?: Request;
}) {
  const school = await getInstitutionName(input.institutionId);
  const receipt = compactString(input.receiptNo, "reçu enregistré");
  const payer = compactString(input.payerName || input.studentName, "paiement élève");

  return queueFounderNotification({
    institutionId: input.institutionId,
    kind: "founder_finance_payment_received",
    title: "Encaissement enregistré",
    body: `${school} • ${money(input.amount)} encaissés • ${payer}`,
    url: "/founder/finance",
    data: {
      amount: Number(input.amount || 0),
      receipt_no: receipt,
      payer_name: payer,
      institution_name: school,
    },
    req: input.req,
  });
}

export async function queueFounderFinanceExpenseNotification(input: {
  institutionId: string;
  amount: number;
  label?: string | null;
  beneficiary?: string | null;
  req?: Request;
}) {
  const school = await getInstitutionName(input.institutionId);
  const label = compactString(input.label, "Dépense enregistrée");
  const beneficiary = compactString(input.beneficiary, "");

  return queueFounderNotification({
    institutionId: input.institutionId,
    kind: "founder_finance_expense_created",
    title: "Dépense enregistrée",
    body: `${school} • ${money(input.amount)} dépensés • ${label}${beneficiary ? ` (${beneficiary})` : ""}`,
    url: "/founder/finance",
    data: {
      amount: Number(input.amount || 0),
      label,
      beneficiary: beneficiary || null,
      institution_name: school,
    },
    req: input.req,
  });
}

// Sécurité métier : le fondateur ne doit PAS être notifié pour les imports/affectations d'élèves.
// On garde cette fonction en no-op pour éviter tout spam si un ancien appel existe encore quelque part.
export async function queueFounderStudentEnrollmentNotification() {
  return {
    ok: true as const,
    queued: 0,
    reason: "disabled_for_founder_policy_finance_only",
  };
}
