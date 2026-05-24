import { NextResponse } from "next/server";
import { requireCommunicationAdmin } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireCommunicationAdmin();
    if ("error" in ctx) return ctx.error;

    const { data: campaigns, error } = await ctx.srv
      .from("communication_campaigns")
      .select(
        "id,audience_type,target_type,target_value,target_label,channel,title,body,status,recipient_count,push_queued_count,sms_queued_count,created_at,sent_at,meta"
      )
      .eq("institution_id", ctx.institutionId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message, items: [] }, { status: 200 });
    }

    const ids = (campaigns || []).map((row: any) => String(row.id));
    let recipientStats = new Map<string, any>();

    if (ids.length) {
      const { data: recipients } = await ctx.srv
        .from("communication_recipients")
        .select("campaign_id,push_status,sms_status")
        .in("campaign_id", ids)
        .limit(5000);

      for (const row of recipients || []) {
        const campaignId = String((row as any).campaign_id);
        const cur = recipientStats.get(campaignId) || {
          total: 0,
          push_queued: 0,
          push_missing: 0,
          sms_queued: 0,
          sms_missing: 0,
        };
        cur.total += 1;
        if ((row as any).push_status === "queued") cur.push_queued += 1;
        if ((row as any).push_status === "no_push_device") cur.push_missing += 1;
        if ((row as any).sms_status === "queued") cur.sms_queued += 1;
        if ((row as any).sms_status === "no_sms_phone") cur.sms_missing += 1;
        recipientStats.set(campaignId, cur);
      }
    }

    return NextResponse.json({
      ok: true,
      items: (campaigns || []).map((row: any) => ({
        ...row,
        stats: recipientStats.get(String(row.id)) || null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Erreur historique communication.", items: [] },
      { status: 500 }
    );
  }
}
