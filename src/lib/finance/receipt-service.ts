import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { queueFounderFinancePaymentNotification } from "@/lib/push/founder";

type CreateReceiptInput = {
  institutionId: string;
  studentId: string;
  classId?: string | null;
  studentChargeId: string;
  amount: number;
  payerName?: string | null;
  referenceNo?: string | null;
  paymentDateIso?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  notifyFounder?: boolean;
  req?: Request;
};

type PostOnlinePaymentInput = {
  intentId: string;
  providerTransactionId?: string | null;
  providerReference?: string | null;
  rawProviderPayload?: Record<string, any> | null;
  req?: Request;
};

function makeReceiptNo() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `REC-${stamp}-${rand}`;
}

function clean(value: unknown, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function money(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function onlineReference(intentId: string) {
  return `ONLINE-${intentId}`;
}

async function getAcademicYearId(institutionId: string, academicYear: string | null | undefined) {
  if (!academicYear) return null;
  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("code", academicYear)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as any)?.id || null;
}

async function getStudentName(studentId: string, institutionId: string) {
  const admin = getSupabaseServiceClient();
  const { data } = await admin
    .from("students")
    .select("first_name,last_name,matricule")
    .eq("id", studentId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  const firstName = clean((data as any)?.first_name);
  const lastName = clean((data as any)?.last_name);
  const matricule = clean((data as any)?.matricule);
  return [lastName, firstName].filter(Boolean).join(" ") || matricule || "Élève non précisé";
}

async function getClassInfo(classId: string | null | undefined, institutionId: string) {
  if (!classId) {
    return { label: "Classe non précisée", academicYear: null as string | null };
  }

  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .from("classes")
    .select("label,academic_year")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    label: clean((data as any)?.label, "Classe non précisée"),
    academicYear: clean((data as any)?.academic_year) || null,
  };
}

async function getClassLabel(classId: string | null | undefined, institutionId: string) {
  const info = await getClassInfo(classId, institutionId);
  return info.label;
}

async function findReceiptByReference(institutionId: string, referenceNo: string) {
  if (!institutionId || !referenceNo) return null;
  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .schema("finance")
    .from("receipts")
    .select("id,receipt_no")
    .eq("school_id", institutionId)
    .eq("reference_no", referenceNo)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: String((data as any).id),
    receiptNo: String((data as any).receipt_no),
  };
}

export async function createPostedReceiptForCharge(input: CreateReceiptInput) {
  const admin = getSupabaseServiceClient();
  const amount = Number(input.amount || 0);

  if (!input.institutionId) throw new Error("Établissement manquant.");
  if (!input.studentId) throw new Error("Élève manquant.");
  if (!input.studentChargeId) throw new Error("Frais à solder manquant.");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant doit être supérieur à 0.");
  }

  const referenceNo = clean(input.referenceNo) || null;
  if (referenceNo) {
    const existing = await findReceiptByReference(input.institutionId, referenceNo);
    if (existing) {
      return {
        id: existing.id,
        receiptNo: existing.receiptNo,
        remainingDue: null,
        alreadyExists: true,
      };
    }
  }

  const { data: charge, error: chargeErr } = await admin
    .schema("finance")
    .from("v_charge_balances")
    .select(
      "id,school_id,academic_year_id,student_id,class_id,fee_category_id,label,balance_due,computed_status",
    )
    .eq("id", input.studentChargeId)
    .eq("school_id", input.institutionId)
    .eq("student_id", input.studentId)
    .maybeSingle();

  if (chargeErr) throw new Error(chargeErr.message);
  if (!charge) throw new Error("Frais introuvable ou non autorisé.");

  const balanceDue = Number((charge as any).balance_due || 0);
  if (balanceDue <= 0) {
    if (referenceNo) {
      const existing = await findReceiptByReference(input.institutionId, referenceNo);
      if (existing) {
        return {
          id: existing.id,
          receiptNo: existing.receiptNo,
          remainingDue: 0,
          alreadyExists: true,
        };
      }
    }
    throw new Error("Ce frais est déjà soldé.");
  }
  if (amount > balanceDue) {
    throw new Error(`Le montant dépasse le reste dû (${money(balanceDue)}).`);
  }

  const classId = input.classId || (charge as any).class_id || null;
  const classInfo = await getClassInfo(classId, input.institutionId);
  // La vue finance.v_charge_balances ne contient pas toujours la colonne academic_year.
  // On reprend donc l'année scolaire depuis la classe, comme dans l'encaissement physique existant.
  const academicYear = classInfo.academicYear || null;
  const academicYearId =
    (charge as any).academic_year_id || (await getAcademicYearId(input.institutionId, academicYear));
  const paymentDateIso = input.paymentDateIso || new Date().toISOString();
  const receiptNo = makeReceiptNo();
  const nowIso = new Date().toISOString();

  const { data: receipt, error: receiptErr } = await admin
    .schema("finance")
    .from("receipts")
    .insert({
      school_id: input.institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      student_id: input.studentId,
      receipt_no: receiptNo,
      receipt_status: "posted",
      payment_date: paymentDateIso,
      payment_method_id: null,
      cash_account_id: null,
      payer_name: clean(input.payerName) || null,
      reference_no: referenceNo,
      total_amount: amount,
      notes: input.notes || null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      created_by: input.createdBy || null,
      created_at: nowIso,
      updated_at: nowIso,
    } as any)
    .select("id,receipt_no")
    .single();

  if (receiptErr) {
    if (referenceNo && /duplicate|unique/i.test(receiptErr.message || "")) {
      const existing = await findReceiptByReference(input.institutionId, referenceNo);
      if (existing) {
        return {
          id: existing.id,
          receiptNo: existing.receiptNo,
          remainingDue: null,
          alreadyExists: true,
        };
      }
    }
    throw new Error(receiptErr.message);
  }

  const { error: allocationErr } = await admin
    .schema("finance")
    .from("receipt_allocations")
    .insert({
      receipt_id: (receipt as any).id,
      student_charge_id: input.studentChargeId,
      amount,
      created_at: nowIso,
    } as any);

  if (allocationErr) {
    await admin.schema("finance").from("receipts").delete().eq("id", (receipt as any).id);
    throw new Error(allocationErr.message);
  }

  const remainingDueAfterPayment = Math.max(balanceDue - amount, 0);

  if (input.notifyFounder !== false) {
    try {
      await queueFounderFinancePaymentNotification({
        institutionId: input.institutionId,
        amount,
        receiptNo: (receipt as any).receipt_no,
        payerName: input.payerName || null,
        studentName: await getStudentName(input.studentId, input.institutionId),
        className: await getClassLabel(classId, input.institutionId),
        categoryName: clean((charge as any).label, "Frais scolaire"),
        remainingDue: remainingDueAfterPayment,
        paidAt: paymentDateIso,
        req: input.req,
      });
    } catch (e: any) {
      console.warn("[finance/receipt-service] notification founder ignorée", e?.message || e);
    }
  }

  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance/receipts");
  revalidatePath(`/admin/finance/receipts/${(receipt as any).id}`);
  revalidatePath("/admin/finance/charges");
  revalidatePath("/admin/finance/arrears");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/online-payments");
  revalidatePath("/parents/payments");
  revalidatePath("/founder/finance");

  return {
    id: String((receipt as any).id),
    receiptNo: String((receipt as any).receipt_no),
    remainingDue: remainingDueAfterPayment,
    alreadyExists: false,
  };
}

export async function confirmOnlinePaymentAndCreateReceipt(input: PostOnlinePaymentInput) {
  const admin = getSupabaseServiceClient();

  if (!input.intentId) throw new Error("Intention de paiement manquante.");

  const { data: currentIntent, error: currentErr } = await admin
    .schema("finance")
    .from("online_payment_intents")
    .select(
      "id,school_id,student_id,class_id,student_charge_id,amount,provider,status,payer_name,payer_phone,provider_reference,provider_transaction_id,receipt_id,raw_provider_payload",
    )
    .eq("id", input.intentId)
    .maybeSingle();

  if (currentErr) throw new Error(currentErr.message);
  if (!currentIntent) throw new Error("Intention de paiement introuvable.");

  const intent = currentIntent as any;
  const currentStatus = clean(intent.status);
  const referenceNo = onlineReference(input.intentId);
  const nowIso = new Date().toISOString();

  const existingReceipt = await findReceiptByReference(String(intent.school_id), referenceNo);
  if (existingReceipt) {
    await admin
      .schema("finance")
      .from("online_payment_intents")
      .update({
        status: "succeeded",
        receipt_id: existingReceipt.id,
        provider_reference: input.providerReference || intent.provider_reference || null,
        provider_transaction_id: input.providerTransactionId || intent.provider_transaction_id || null,
        raw_provider_payload: {
          ...((intent.raw_provider_payload || {}) as Record<string, any>),
          ...(input.rawProviderPayload || {}),
        },
        confirmed_at: intent.confirmed_at || nowIso,
        updated_at: nowIso,
        error_message: null,
      } as any)
      .eq("id", input.intentId);

    return {
      alreadyConfirmed: true,
      receiptId: existingReceipt.id,
      receiptNo: existingReceipt.receiptNo,
    };
  }

  if (currentStatus === "succeeded" && intent.receipt_id) {
    return {
      alreadyConfirmed: true,
      receiptId: String(intent.receipt_id),
    };
  }

  if (!["initiated", "pending", "succeeded"].includes(currentStatus)) {
    throw new Error(`Cette intention ne peut plus être confirmée. Statut actuel : ${currentStatus || "inconnu"}.`);
  }

  const providerReference = input.providerReference || intent.provider_reference || null;
  const providerTransactionId = input.providerTransactionId || intent.provider_transaction_id || null;
  const mergedRawPayload = {
    ...((intent.raw_provider_payload || {}) as Record<string, any>),
    ...(input.rawProviderPayload || {}),
  };

  let receipt: Awaited<ReturnType<typeof createPostedReceiptForCharge>>;
  try {
    receipt = await createPostedReceiptForCharge({
      institutionId: String(intent.school_id),
      studentId: String(intent.student_id),
      classId: intent.class_id || null,
      studentChargeId: String(intent.student_charge_id),
      amount: Number(intent.amount || 0),
      payerName: intent.payer_name || null,
      referenceNo,
      notes: [
        "Paiement en ligne confirmé automatiquement.",
        providerReference ? `Référence opérateur : ${providerReference}.` : "",
        providerTransactionId ? `Transaction opérateur : ${providerTransactionId}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      notifyFounder: true,
      req: input.req,
    });
  } catch (e: any) {
    await admin
      .schema("finance")
      .from("online_payment_intents")
      .update({
        provider_reference: providerReference,
        provider_transaction_id: providerTransactionId,
        raw_provider_payload: mergedRawPayload,
        updated_at: nowIso,
        error_message: `Confirmation reçue, mais reçu non généré : ${String(e?.message || e)}`,
      } as any)
      .eq("id", input.intentId)
      .is("receipt_id", null);

    throw e;
  }

  const { error: updateErr } = await admin
    .schema("finance")
    .from("online_payment_intents")
    .update({
      status: "succeeded",
      receipt_id: receipt.id,
      provider_reference: providerReference,
      provider_transaction_id: providerTransactionId,
      raw_provider_payload: mergedRawPayload,
      confirmed_at: nowIso,
      updated_at: new Date().toISOString(),
      error_message: null,
    } as any)
    .eq("id", input.intentId);

  if (updateErr) throw new Error(updateErr.message);

  return {
    alreadyConfirmed: Boolean((receipt as any).alreadyExists),
    receiptId: receipt.id,
    receiptNo: receipt.receiptNo,
  };
}
