import { NextRequest, NextResponse } from "next/server";
import {
  enrichRecipientCapabilities,
  getCommunicationChannelState,
  requireCommunicationAdmin,
  resolveCommunicationRecipients,
  summarizeRecipients,
  type CommunicationAudienceType,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCommunicationAdmin();
    if ("error" in ctx) return ctx.error;

    const body = await req.json().catch(() => ({}));
    const audienceType = s(body?.audience_type) as CommunicationAudienceType;
    const targetType = s(body?.target_type);
    const targetValue = s(body?.target_value) || null;

    if (!["parents", "staff"].includes(audienceType)) {
      return NextResponse.json({ ok: false, error: "audience_type_invalid" }, { status: 400 });
    }
    if (!targetType) {
      return NextResponse.json({ ok: false, error: "target_type_required" }, { status: 400 });
    }

    const resolved = await resolveCommunicationRecipients(
      ctx.srv,
      ctx.institutionId,
      ctx.academicYear,
      {
        audience_type: audienceType,
        target_type: targetType,
        target_value: targetValue,
      }
    );

    const recipients = await enrichRecipientCapabilities(ctx.srv, ctx.institutionId, resolved.recipients);
    const channels = await getCommunicationChannelState(ctx.srv, ctx.institutionId);
    const summary = summarizeRecipients(recipients);

    return NextResponse.json({
      ok: true,
      target_label: resolved.target_label,
      academic_year: ctx.academicYear,
      student_count: resolved.student_count,
      class_count: resolved.class_count,
      channels,
      summary,
      sample: recipients.slice(0, 10).map((r) => ({
        profile_id: r.profile_id,
        display_name: r.display_name,
        recipient_type: r.recipient_type,
        has_push: r.has_push,
        has_sms_phone: r.has_sms_phone,
        related_student_count: r.related_student_ids.length,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Erreur aperçu communication." },
      { status: 500 }
    );
  }
}
