import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getOfficialDocumentAccess } from "@/lib/official-documents";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  const access = await getOfficialDocumentAccess();
  if (!access.ok || !access.institutionId) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { issueId } = await context.params;
  const admin = getSupabaseServiceClient();
  const { data: issue, error } = await admin
    .from("official_document_issues")
    .select("*")
    .eq("id", issueId)
    .eq("institution_id", access.institutionId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (!issue) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const type = String((issue as any).document_type || "");
  if (type === "receipt") {
    const financeAccess = await getFinanceAccessForCurrentUser("full").catch(() => null);
    if (
      !access.canReadReceipts ||
      !financeAccess?.ok ||
      financeAccess.institutionId !== access.institutionId
    ) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  } else if (type === "bulletin") {
    if (!access.canReadBulletins) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ ok: false, error: "unsupported_document_type" }, { status: 400 });
  }

  const { data: events, error: eventsError } = await admin
    .from("official_document_print_events")
    .select("id,print_kind,duplicate_number,reason,generated_at,generated_by")
    .eq("issue_id", issueId)
    .order("generated_at", { ascending: false });

  if (eventsError) {
    return NextResponse.json(
      { ok: false, error: eventsError.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, issue, events: events ?? [] });
}
