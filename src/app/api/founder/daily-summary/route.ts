// src/app/api/founder/daily-summary/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { queueFounderNotification } from "@/lib/push/founder";
import { triggerPushDispatch } from "@/lib/push-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function okCronAuth(req: Request) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");
  return fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
}

export const GET = run;
export const POST = run;

async function run(req: Request) {
  if (!okCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const srv = getSupabaseServiceClient();
  const today = todayYmd();

  const { data: founderRoles, error: roleErr } = await srv
    .from("user_roles")
    .select("profile_id,institution_id")
    .eq("role", "founder");

  if (roleErr) {
    return NextResponse.json({ ok: false, error: roleErr.message }, { status: 400 });
  }

  const institutionIds = Array.from(
    new Set((founderRoles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );

  if (!institutionIds.length) {
    return NextResponse.json({ ok: true, queued: 0, reason: "no_founder" });
  }

  const [{ data: institutions }, { data: receipts }, { data: expenses }] = await Promise.all([
    srv.from("institutions").select("id,name").in("id", institutionIds),
    srv
      .schema("finance")
      .from("receipts")
      .select("id,school_id,total_amount,receipt_status,payment_date")
      .in("school_id", institutionIds)
      .eq("receipt_status", "posted")
      .gte("payment_date", `${today}T00:00:00`)
      .lte("payment_date", `${today}T23:59:59.999`),
    srv
      .schema("finance")
      .from("expenses")
      .select("id,school_id,amount,expense_status,expense_date")
      .in("school_id", institutionIds)
      .eq("expense_status", "posted")
      .eq("expense_date", today),
  ]);

  const byInstitution = new Map<string, any>();
  for (const inst of institutions ?? []) {
    byInstitution.set(String((inst as any).id), inst);
  }

  let queued = 0;

  for (const institutionId of institutionIds) {
    const schoolName = byInstitution.get(institutionId)?.name || "Établissement";
    const schoolReceipts = (receipts ?? []).filter((row: any) => row.school_id === institutionId);
    const schoolExpenses = (expenses ?? []).filter((row: any) => row.school_id === institutionId);
    const totalReceipts = schoolReceipts.reduce(
      (sum: number, row: any) => sum + Number(row.total_amount || 0),
      0,
    );
    const totalExpenses = schoolExpenses.reduce(
      (sum: number, row: any) => sum + Number(row.amount || 0),
      0,
    );
    const net = totalReceipts - totalExpenses;

    if (totalReceipts <= 0 && totalExpenses <= 0) continue;

    const result = await queueFounderNotification({
      institutionId,
      kind: "founder_finance_daily_summary",
      title: `Bilan financier — ${schoolName}`,
      body: `Encaissements : ${formatMoney(totalReceipts)} • Dépenses : ${formatMoney(totalExpenses)} • Net : ${formatMoney(net)}`,
      url: "/founder/finance",
      data: {
        date: today,
        institution_name: schoolName,
        receipts_count: schoolReceipts.length,
        expenses_count: schoolExpenses.length,
        total_receipts: totalReceipts,
        total_expenses: totalExpenses,
        net,
      },
      req,
      dispatch: false,
    });

    queued += result.queued || 0;
  }

  if (queued > 0) {
    try {
      await triggerPushDispatch({ req, reason: "founder_finance_daily_summary", timeoutMs: 2500, retries: 0 });
    } catch (e: any) {
      console.warn("[founder/daily-summary] dispatch non bloquant", e?.message || e);
    }
  }

  return NextResponse.json({ ok: true, queued, date: today, scope: "finance" });
}
