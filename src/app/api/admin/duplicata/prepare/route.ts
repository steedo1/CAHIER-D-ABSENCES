import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
import {
  bulletinOfficialNumber,
  canonicalOfficialSnapshot,
  cleanOfficialText,
  computeOfficialBulletinSourceId,
  getOfficialDocumentAccess,
  hashOfficialSnapshot,
} from "@/lib/official-documents";
import { verifyBulletinQR } from "@/lib/bulletin-qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulletinDocumentInput = {
  source_id?: string;
  official_number?: string;
  beneficiary_id?: string;
  beneficiary_name?: string;
  academic_year?: string | null;
  class_id?: string | null;
  class_label?: string | null;
  period_key?: string | null;
  period_label?: string | null;
  qr_code?: string | null;
  qr_token?: string | null;
  snapshot?: any;
};

function errorMessage(error: any) {
  return cleanOfficialText(error?.message || error || "Erreur inconnue");
}

async function registerPrint(
  admin: ReturnType<typeof getSupabaseServiceClient>,
  issueId: string,
  userId: string | null,
  reason: string,
  metadata: Record<string, any>,
) {
  const { data, error } = await admin.rpc("register_official_document_print", {
    p_issue_id: issueId,
    p_generated_by: userId || null,
    p_reason: reason || null,
    p_metadata: metadata,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    event_id: cleanOfficialText((row as any)?.event_id),
    print_kind: cleanOfficialText((row as any)?.print_kind) as
      | "original"
      | "duplicate",
    duplicate_number:
      (row as any)?.duplicate_number === null ||
      (row as any)?.duplicate_number === undefined
        ? null
        : Number((row as any).duplicate_number),
    generated_at: cleanOfficialText((row as any)?.generated_at),
  };
}

async function prepareReceipt(req: NextRequest, body: any) {
  const access = await getFinanceAccessForCurrentUser("full");
  if (!access.ok || !access.institutionId) {
    return NextResponse.json({ ok: false, error: access.reason }, { status: 403 });
  }

  const generalAccess = await getOfficialDocumentAccess();
  if (
    !generalAccess.userId ||
    !generalAccess.canReadReceipts ||
    generalAccess.institutionId !== access.institutionId
  ) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const receiptId = cleanOfficialText(body?.source_id || body?.receipt_id);
  const reason = cleanOfficialText(body?.reason);
  if (!receiptId) {
    return NextResponse.json(
      { ok: false, error: "receipt_id_required" },
      { status: 400 },
    );
  }

  const admin = getSupabaseServiceClient();
  const { data: receipt, error: receiptError } = await admin
    .schema("finance")
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .eq("school_id", access.institutionId)
    .maybeSingle();

  if (receiptError) {
    return NextResponse.json(
      { ok: false, error: receiptError.message },
      { status: 400 },
    );
  }
  if (!receipt) {
    return NextResponse.json({ ok: false, error: "receipt_not_found" }, { status: 404 });
  }
  if (cleanOfficialText((receipt as any).receipt_status) !== "posted") {
    return NextResponse.json(
      { ok: false, error: "cancelled_receipt_cannot_be_duplicated" },
      { status: 409 },
    );
  }

  const [allocationResult, studentResult] = await Promise.all([
    admin
      .schema("finance")
      .from("receipt_allocations")
      .select("*")
      .eq("receipt_id", receiptId)
      .order("created_at", { ascending: true }),
    admin
      .from("students")
      .select("id,first_name,last_name,full_name,matricule,class_id")
      .eq("id", (receipt as any).student_id)
      .eq("institution_id", access.institutionId)
      .maybeSingle(),
  ]);

  if (allocationResult.error) {
    return NextResponse.json(
      { ok: false, error: allocationResult.error.message },
      { status: 400 },
    );
  }
  if (studentResult.error) {
    return NextResponse.json(
      { ok: false, error: studentResult.error.message },
      { status: 400 },
    );
  }

  const allocations = allocationResult.data ?? [];
  const student = studentResult.data ?? null;

  const studentName =
    cleanOfficialText((student as any)?.full_name) ||
    [
      cleanOfficialText((student as any)?.last_name),
      cleanOfficialText((student as any)?.first_name),
    ]
      .filter(Boolean)
      .join(" ") ||
    cleanOfficialText((student as any)?.matricule) ||
    "Élève";

  const transactionSnapshot = canonicalOfficialSnapshot({
    receipt: {
      id: (receipt as any).id,
      school_id: (receipt as any).school_id,
      academic_year_id: (receipt as any).academic_year_id ?? null,
      academic_year: (receipt as any).academic_year ?? null,
      student_id: (receipt as any).student_id,
      receipt_no: (receipt as any).receipt_no,
      receipt_status: (receipt as any).receipt_status,
      payment_date: (receipt as any).payment_date,
      payer_name: (receipt as any).payer_name ?? null,
      reference_no: (receipt as any).reference_no ?? null,
      total_amount: (receipt as any).total_amount,
      notes: (receipt as any).notes ?? null,
      created_by: (receipt as any).created_by ?? null,
      created_at: (receipt as any).created_at,
    },
    allocations: allocations.map((row: any) => ({
      id: row.id,
      receipt_id: row.receipt_id,
      student_charge_id: row.student_charge_id,
      amount: row.amount,
      created_at: row.created_at,
    })),
  });

  const snapshot = canonicalOfficialSnapshot({
    transaction: transactionSnapshot,
    student_at_issue: student,
  });
  const snapshotHash = hashOfficialSnapshot(transactionSnapshot);

  let { data: issue, error: issueError } = await admin
    .from("official_document_issues")
    .select("id,snapshot_hash,status,issued_at,official_number")
    .eq("institution_id", access.institutionId)
    .eq("document_type", "receipt")
    .eq("source_id", receiptId)
    .eq("source_version", 1)
    .maybeSingle();

  if (issueError) {
    return NextResponse.json({ ok: false, error: issueError.message }, { status: 400 });
  }

  if (issue && cleanOfficialText((issue as any).snapshot_hash) !== snapshotHash) {
    return NextResponse.json(
      { ok: false, error: "receipt_snapshot_changed" },
      { status: 409 },
    );
  }

  if (issue && cleanOfficialText((issue as any).status) !== "valid") {
    return NextResponse.json(
      { ok: false, error: "receipt_issue_not_valid" },
      { status: 409 },
    );
  }

  if (issue) {
    const { data: original } = await admin
      .from("official_document_print_events")
      .select("id")
      .eq("issue_id", (issue as any).id)
      .eq("print_kind", "original")
      .maybeSingle();

    if (original && !reason) {
      return NextResponse.json(
        {
          ok: false,
          error: "duplicate_reason_required",
          requires_reason: true,
          document_type: "receipt",
        },
        { status: 409 },
      );
    }
  } else {
    const { data: inserted, error: insertError } = await admin
      .from("official_document_issues")
      .insert({
        institution_id: access.institutionId,
        document_type: "receipt",
        source_id: receiptId,
        source_version: 1,
        official_number: cleanOfficialText((receipt as any).receipt_no),
        beneficiary_id: (receipt as any).student_id || null,
        beneficiary_name: studentName,
        academic_year: cleanOfficialText((receipt as any).academic_year) || null,
        class_id: (student as any)?.class_id || null,
        issued_by: generalAccess.userId,
        snapshot,
        snapshot_hash: snapshotHash,
        status: "valid",
      })
      .select("id,snapshot_hash,status,issued_at,official_number")
      .single();

    if (insertError) {
      // Deux utilisateurs peuvent ouvrir le même reçu au même instant. La
      // contrainte unique choisit un seul original ; l'autre requête reprend
      // alors la ligne créée et sera traitée comme un duplicata.
      if ((insertError as any).code !== "23505") {
        return NextResponse.json(
          { ok: false, error: insertError.message },
          { status: 400 },
        );
      }

      const { data: concurrentIssue, error: concurrentError } = await admin
        .from("official_document_issues")
        .select("id,snapshot_hash,status,issued_at,official_number")
        .eq("institution_id", access.institutionId)
        .eq("document_type", "receipt")
        .eq("source_id", receiptId)
        .eq("source_version", 1)
        .single();

      if (concurrentError) {
        return NextResponse.json(
          { ok: false, error: concurrentError.message },
          { status: 400 },
        );
      }
      if (
        cleanOfficialText((concurrentIssue as any).snapshot_hash) !== snapshotHash ||
        cleanOfficialText((concurrentIssue as any).status) !== "valid"
      ) {
        return NextResponse.json(
          { ok: false, error: "receipt_issue_conflict" },
          { status: 409 },
        );
      }
      issue = concurrentIssue;
    } else {
      issue = inserted;
    }
  }

  try {
    const event = await registerPrint(
      admin,
      String((issue as any).id),
      generalAccess.userId,
      reason,
      {
        document_type: "receipt",
        source_id: receiptId,
        user_agent: req.headers.get("user-agent") || null,
      },
    );

    return NextResponse.json({
      ok: true,
      document_type: "receipt",
      issue_id: (issue as any).id,
      official_number: (issue as any).official_number,
      issued_at: (issue as any).issued_at,
      ...event,
    });
  } catch (error: any) {
    const message = errorMessage(error);
    if (message.includes("duplicate_reason_required")) {
      return NextResponse.json(
        { ok: false, error: "duplicate_reason_required", requires_reason: true },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function prepareBulletins(req: NextRequest, body: any) {
  const access = await getOfficialDocumentAccess();
  if (!access.ok || !access.institutionId || !access.canReadBulletins) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const institutionId = access.institutionId;

  const documents = Array.isArray(body?.documents)
    ? (body.documents as BulletinDocumentInput[])
    : [];
  const reason = cleanOfficialText(body?.reason);

  if (documents.length === 0 || documents.length > 300) {
    return NextResponse.json(
      { ok: false, error: "invalid_bulletin_documents" },
      { status: 400 },
    );
  }

  const prepared = documents.map((document) => {
    const sourceId = cleanOfficialText(document.source_id);
    const officialNumber = cleanOfficialText(document.official_number);
    if (!sourceId || !officialNumber || !document.snapshot) {
      throw new Error("invalid_bulletin_document");
    }

    const snapshot = canonicalOfficialSnapshot(document.snapshot);
    const response = snapshot?.response;
    const snapshotItems = Array.isArray(response?.items) ? response.items : [];
    const snapshotItem = snapshotItems.length === 1 ? snapshotItems[0] : null;
    const snapshotClass = response?.class || null;
    const snapshotPeriod = response?.period || null;

    const studentId = cleanOfficialText(snapshotItem?.student_id);
    const classId = cleanOfficialText(snapshotClass?.id);
    const academicYearSource =
      snapshotPeriod?.academic_year ?? snapshotClass?.academic_year ?? null;
    const periodFromSource = snapshotPeriod?.from ?? null;
    const periodToSource = snapshotPeriod?.to ?? null;
    const periodLabelSource =
      snapshotPeriod?.short_label ?? snapshotPeriod?.label ?? snapshotPeriod?.code ?? null;
    const academicYear = cleanOfficialText(academicYearSource) || null;
    const periodFrom = cleanOfficialText(periodFromSource) || null;
    const periodTo = cleanOfficialText(periodToSource) || null;
    const periodLabel = cleanOfficialText(periodLabelSource) || null;

    if (!studentId || !classId || !snapshotItem || !snapshotClass || !snapshotPeriod) {
      throw new Error("invalid_bulletin_snapshot");
    }

    const expectedSourceId = computeOfficialBulletinSourceId({
      institutionId: institutionId,
      classId,
      studentId,
      academicYear: academicYearSource == null ? null : String(academicYearSource),
      periodFrom: periodFromSource == null ? null : String(periodFromSource),
      periodTo: periodToSource == null ? null : String(periodToSource),
      periodLabel: periodLabelSource == null ? null : String(periodLabelSource),
    });

    if (sourceId !== expectedSourceId) {
      throw new Error("invalid_bulletin_source");
    }
    if (cleanOfficialText(document.beneficiary_id) !== studentId) {
      throw new Error("invalid_bulletin_beneficiary");
    }
    if (cleanOfficialText(document.class_id) !== classId) {
      throw new Error("invalid_bulletin_class");
    }
    if (cleanOfficialText(document.academic_year) !== cleanOfficialText(academicYear)) {
      throw new Error("invalid_bulletin_academic_year");
    }

    const qrCode = cleanOfficialText(document.qr_code) || null;
    const qrToken = cleanOfficialText(document.qr_token) || null;
    if (officialNumber !== bulletinOfficialNumber(qrCode, sourceId)) {
      throw new Error("invalid_bulletin_number");
    }

    if (qrToken) {
      const proof: any = verifyBulletinQR(qrToken);
      if (
        !proof ||
        cleanOfficialText(proof.instId) !== institutionId ||
        cleanOfficialText(proof.classId) !== classId ||
        cleanOfficialText(proof.studentId) !== studentId ||
        cleanOfficialText(proof.academicYear) !== cleanOfficialText(academicYear) ||
        cleanOfficialText(proof.periodFrom) !== cleanOfficialText(periodFrom) ||
        cleanOfficialText(proof.periodTo) !== cleanOfficialText(periodTo) ||
        cleanOfficialText(proof.periodLabel) !== cleanOfficialText(periodLabel)
      ) {
        throw new Error("invalid_bulletin_qr_token");
      }
    }

    return {
      ...document,
      snapshot,
      sourceId,
      officialNumber,
      qrCode,
      qrToken,
      snapshotHash: hashOfficialSnapshot(snapshot),
    };
  });

  const admin = getSupabaseServiceClient();

  const shortCodes = Array.from(
    new Set(prepared.map((row) => row.qrCode).filter((code): code is string => Boolean(code))),
  );
  if (shortCodes.length) {
    const { data: qrRows, error: qrError } = await admin
      .from("bulletin_qr_codes")
      .select("code,bulletin_key,revoked,payload")
      .in("code", shortCodes);

    if (qrError) throw qrError;
    const qrByCode = new Map(
      (qrRows ?? []).map((row: any) => [cleanOfficialText(row.code).toUpperCase(), row]),
    );

    for (const row of prepared) {
      if (!row.qrCode) continue;
      const qr = qrByCode.get(row.qrCode.toUpperCase()) as any;
      const payload = qr?.payload || null;
      const response = row.snapshot?.response;
      const snapshotItem = Array.isArray(response?.items) ? response.items[0] : null;
      const snapshotClass = response?.class || null;
      const snapshotPeriod = response?.period || null;
      const academicYear =
        cleanOfficialText(snapshotPeriod?.academic_year || snapshotClass?.academic_year) || null;
      const periodLabel =
        cleanOfficialText(
          snapshotPeriod?.short_label || snapshotPeriod?.label || snapshotPeriod?.code,
        ) || null;

      if (
        !qr ||
        qr.revoked === true ||
        cleanOfficialText(qr.bulletin_key) !== row.sourceId ||
        cleanOfficialText(payload?.instId) !== institutionId ||
        cleanOfficialText(payload?.classId) !== cleanOfficialText(snapshotClass?.id) ||
        cleanOfficialText(payload?.studentId) !== cleanOfficialText(snapshotItem?.student_id) ||
        cleanOfficialText(payload?.academicYear) !== cleanOfficialText(academicYear) ||
        cleanOfficialText(payload?.periodFrom) !== cleanOfficialText(snapshotPeriod?.from) ||
        cleanOfficialText(payload?.periodTo) !== cleanOfficialText(snapshotPeriod?.to) ||
        cleanOfficialText(payload?.periodLabel) !== cleanOfficialText(periodLabel)
      ) {
        throw new Error("invalid_bulletin_qr_code");
      }
    }
  }
  const rpcDocuments = prepared.map((row) => ({
    source_id: row.sourceId,
    official_number: row.officialNumber,
    beneficiary_id: cleanOfficialText(row.beneficiary_id) || null,
    beneficiary_name: cleanOfficialText(row.beneficiary_name) || null,
    academic_year: cleanOfficialText(row.academic_year) || null,
    class_id: cleanOfficialText(row.class_id) || null,
    class_label: cleanOfficialText(row.class_label) || null,
    period_key: cleanOfficialText(row.period_key) || null,
    period_label: cleanOfficialText(row.period_label) || null,
    qr_code: row.qrCode,
    snapshot: row.snapshot,
    snapshot_hash: row.snapshotHash,
  }));

  const { data, error } = await admin.rpc("register_official_bulletin_batch", {
    p_institution_id: institutionId,
    p_documents: rpcDocuments,
    p_generated_by: access.userId || null,
    p_reason: reason || null,
    p_metadata: {
      document_type: "bulletin",
      user_agent: req.headers.get("user-agent") || null,
    },
  });

  if (error) {
    const message = errorMessage(error);
    if (message.includes("duplicate_reason_required")) {
      return NextResponse.json(
        {
          ok: false,
          error: "duplicate_reason_required",
          requires_reason: true,
          document_type: "bulletin",
        },
        { status: 409 },
      );
    }

    if (message.includes("official_bulletin_changed")) {
      const changedSourceId = message.split("official_bulletin_changed:")[1]?.split(/[\s,]/)[0];
      const changedRow = prepared.find((row) => row.sourceId === changedSourceId);
      return NextResponse.json(
        {
          ok: false,
          error: "official_bulletin_changed",
          changed: changedSourceId
            ? [
                {
                  source_id: changedSourceId,
                  beneficiary_name: changedRow?.beneficiary_name || null,
                },
              ]
            : [],
        },
        { status: 409 },
      );
    }

    if (message.includes("official_bulletin_not_valid")) {
      return NextResponse.json(
        { ok: false, error: "official_bulletin_not_valid" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const results = (data ?? []).map((row: any) => ({
    source_id: cleanOfficialText(row.source_id),
    issue_id: cleanOfficialText(row.issue_id),
    official_number: cleanOfficialText(row.official_number),
    issued_at: cleanOfficialText(row.issued_at),
    event_id: cleanOfficialText(row.event_id),
    print_kind: cleanOfficialText(row.print_kind),
    duplicate_number:
      row.duplicate_number === null || row.duplicate_number === undefined
        ? null
        : Number(row.duplicate_number),
    generated_at: cleanOfficialText(row.generated_at),
  }));

  return NextResponse.json({
    ok: true,
    document_type: "bulletin",
    items: results,
  });

}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const documentType = cleanOfficialText(body?.document_type).toLowerCase();
  try {
    if (documentType === "receipt") return await prepareReceipt(req, body);
    if (documentType === "bulletin") return await prepareBulletins(req, body);
    return NextResponse.json(
      { ok: false, error: "unsupported_document_type" },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 400 },
    );
  }
}
