import { NextRequest, NextResponse } from "next/server";
import { triggerPushDispatch } from "@/lib/push-dispatch";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";
import {
  enrichRecipientCapabilities,
  getCommunicationChannelState,
  getCommunicationInstitution,
  requireCommunicationAdmin,
  resolveCommunicationRecipients,
  summarizeRecipients,
  type CommunicationAudienceType,
  type CommunicationChannel,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

function s(value: unknown) {
  return String(value ?? "").trim();
}

function safeText(value: unknown, max: number) {
  return s(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function buildSignedCommunicationBody(message: string, senderName: string) {
  const cleanMessage = s(message);
  const cleanSender = s(senderName) || "Mon Cahier";
  const signature = `— ${cleanSender}`;

  if (!cleanMessage) return signature;

  const lowerMessage = cleanMessage.toLowerCase();
  const lowerSender = cleanSender.toLowerCase();
  const lowerSignature = signature.toLowerCase();

  if (lowerMessage.endsWith(lowerSender) || lowerMessage.endsWith(lowerSignature)) {
    return cleanMessage;
  }

  return `${cleanMessage}\n\n${signature}`;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCommunicationAdmin();
    if ("error" in ctx) return ctx.error;

    const body = await req.json().catch(() => ({}));
    const audienceType = s(body?.audience_type) as CommunicationAudienceType;
    const targetType = s(body?.target_type);
    const targetValue = s(body?.target_value) || null;
    const channel = s(body?.channel) as CommunicationChannel;
    const title = safeText(body?.title, 120);
    const messageBody = safeText(body?.body, 900);

    if (!["parents", "staff"].includes(audienceType)) {
      return NextResponse.json({ ok: false, error: "audience_type_invalid" }, { status: 400 });
    }
    if (!["push", "sms", "push_sms"].includes(channel)) {
      return NextResponse.json({ ok: false, error: "channel_invalid" }, { status: 400 });
    }
    if (!targetType) {
      return NextResponse.json({ ok: false, error: "target_type_required" }, { status: 400 });
    }
    if (!title || !messageBody) {
      return NextResponse.json({ ok: false, error: "title_and_body_required" }, { status: 400 });
    }

    const [channels, institution] = await Promise.all([
      getCommunicationChannelState(ctx.srv, ctx.institutionId),
      getCommunicationInstitution(ctx.srv, ctx.institutionId),
    ]);
    const senderName = institution.display_name || "Mon Cahier";
    const signedMessageBody = buildSignedCommunicationBody(messageBody, senderName);
    // Le titre visible de la notification doit être le titre saisi dans le module Communication.
    // Le nom de l’établissement reste dans la signature du message et dans sender_name.
    const pushTitle = title;

    const wantsPush = channel === "push" || channel === "push_sms";
    const wantsSms = channel === "sms" || channel === "push_sms";

    if (wantsPush && !channels.push_enabled) {
      return NextResponse.json({ ok: false, error: "push_disabled" }, { status: 400 });
    }
    if (wantsSms && !channels.sms_enabled) {
      return NextResponse.json({ ok: false, error: "sms_not_configured" }, { status: 400 });
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
    const summary = summarizeRecipients(recipients);

    if (!recipients.length) {
      return NextResponse.json({ ok: false, error: "no_recipient", summary }, { status: 400 });
    }

    const pushRecipients = wantsPush ? recipients.filter((r) => r.has_push) : [];
    const smsRecipients = wantsSms ? recipients.filter((r) => r.has_sms_phone) : [];

    if (wantsPush && !pushRecipients.length && !wantsSms) {
      return NextResponse.json({ ok: false, error: "no_push_recipient", summary }, { status: 400 });
    }
    if (wantsSms && !smsRecipients.length && !wantsPush) {
      return NextResponse.json({ ok: false, error: "no_sms_recipient", summary }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    const campaignPayload = {
      institution_id: ctx.institutionId,
      academic_year: ctx.academicYear,
      created_by: ctx.userId,
      audience_type: audienceType,
      target_type: targetType,
      target_value: targetValue,
      target_label: resolved.target_label,
      channel,
      title,
      body: signedMessageBody,
      status: "queued",
      recipient_count: summary.recipient_count,
      push_queued_count: pushRecipients.length,
      sms_queued_count: smsRecipients.length,
      meta: {
        v: 1,
        target_label: resolved.target_label,
        student_count: resolved.student_count,
        class_count: resolved.class_count,
        preview: summary,
        channels,
        sender_name: senderName,
        signature: `— ${senderName}`,
        original_title: title,
        original_body: messageBody,
      },
      sent_at: nowIso,
    } as any;

    const { data: campaign, error: campaignErr } = await ctx.srv
      .from("communication_campaigns")
      .insert(campaignPayload)
      .select("id")
      .single();

    if (campaignErr) {
      return NextResponse.json(
        {
          ok: false,
          error: campaignErr.message,
          hint: "migration_required_communication_campaigns",
        },
        { status: 400 }
      );
    }

    const campaignId = String((campaign as any).id);

    const recipientRows = recipients.map((r) => ({
      campaign_id: campaignId,
      institution_id: ctx.institutionId,
      recipient_profile_id: r.profile_id,
      recipient_type: r.recipient_type,
      display_name: r.display_name,
      phone_e164: r.phone_e164,
      related_student_ids: r.related_student_ids,
      roles: r.roles,
      push_status: wantsPush ? (r.has_push ? "queued" : "no_push_device") : "not_requested",
      sms_status: wantsSms ? (r.has_sms_phone ? "queued" : "no_sms_phone") : "not_requested",
      meta: {
        has_push: r.has_push === true,
        has_sms_phone: r.has_sms_phone === true,
      },
    }));

    const { data: insertedRecipients, error: recipientsErr } = await ctx.srv
      .from("communication_recipients")
      .insert(recipientRows)
      .select("id,recipient_profile_id,push_status,sms_status,related_student_ids,recipient_type,display_name,phone_e164,roles");

    if (recipientsErr) {
      await ctx.srv.from("communication_campaigns").update({ status: "failed", meta: { error: recipientsErr.message } } as any).eq("id", campaignId);
      return NextResponse.json({ ok: false, error: recipientsErr.message }, { status: 400 });
    }

    const recipientIdByProfile = new Map<string, string>();
    for (const row of insertedRecipients || []) {
      recipientIdByProfile.set(String((row as any).recipient_profile_id), String((row as any).id));
    }

    const commonPayload = {
      kind: "communication",
      event: "communication",
      title: pushTitle,
      body: signedMessageBody,
      campaign_title: title,
      campaign_id: campaignId,
      audience_type: audienceType,
      target_type: targetType,
      target_value: targetValue,
      target_label: resolved.target_label,
      institution: { id: ctx.institutionId, name: senderName },
      sender_name: senderName,
      created_at: nowIso,
      url: "/",
    };

    const queueRows: any[] = [];

    if (wantsPush) {
      for (const r of pushRecipients) {
        const communicationRecipientId = recipientIdByProfile.get(r.profile_id) || null;
        queueRows.push({
          institution_id: ctx.institutionId,
          parent_id: r.recipient_type === "parent" ? r.profile_id : null,
          profile_id: r.recipient_type === "parent" ? null : r.profile_id,
          student_id: r.related_student_ids[0] || null,
          channels: ["push"],
          payload: {
            ...commonPayload,
            channel: "push",
            related_student_ids: r.related_student_ids,
          },
          title: pushTitle,
          body: signedMessageBody,
          status: WAIT_STATUS,
          send_after: nowIso,
          meta: {
            src: "admin_communication",
            v: 1,
            channel: "push",
            campaign_id: campaignId,
            communication_recipient_id: communicationRecipientId,
            recipient_profile_id: r.profile_id,
            recipient_type: r.recipient_type,
          },
        });
      }
    }

    if (wantsSms) {
      for (const r of smsRecipients) {
        const communicationRecipientId = recipientIdByProfile.get(r.profile_id) || null;
        queueRows.push({
          institution_id: ctx.institutionId,
          parent_id: r.recipient_type === "parent" ? r.profile_id : null,
          profile_id: r.recipient_type === "parent" ? null : r.profile_id,
          student_id: r.related_student_ids[0] || null,
          channels: ["sms"],
          payload: {
            ...commonPayload,
            channel: "sms",
            related_student_ids: r.related_student_ids,
          },
          title: pushTitle,
          body: signedMessageBody,
          status: WAIT_STATUS,
          send_after: nowIso,
          meta: {
            src: "admin_communication",
            v: 1,
            channel: "sms",
            campaign_id: campaignId,
            communication_recipient_id: communicationRecipientId,
            recipient_profile_id: r.profile_id,
            recipient_type: r.recipient_type,
          },
        });
      }
    }

    let queuedNotifications = 0;
    if (queueRows.length) {
      const { error: queueErr, count } = await ctx.srv
        .from("notifications_queue")
        .insert(queueRows, { count: "exact" });

      if (queueErr) {
        await ctx.srv
          .from("communication_campaigns")
          .update({ status: "failed", meta: { ...campaignPayload.meta, error: queueErr.message } } as any)
          .eq("id", campaignId);

        return NextResponse.json({ ok: false, error: queueErr.message }, { status: 400 });
      }

      queuedNotifications = count || queueRows.length;
    }

    const [pushDispatchTriggered, smsDispatchTriggered] = await Promise.all([
      pushRecipients.length ? triggerPushDispatch({ req, reason: "admin_communication", timeoutMs: 1200, retries: 1 }) : Promise.resolve(false),
      smsRecipients.length ? triggerSmsDispatch({ req, reason: "admin_communication", timeoutMs: 3500, retries: 1 }) : Promise.resolve(false),
    ]);

    await ctx.srv
      .from("communication_campaigns")
      .update({
        status: "queued",
        meta: {
          ...jsonClone(campaignPayload.meta),
          queued_notifications: queuedNotifications,
          push_dispatch_triggered: pushDispatchTriggered,
          sms_dispatch_triggered: smsDispatchTriggered,
        },
      } as any)
      .eq("id", campaignId);

    return NextResponse.json({
      ok: true,
      campaign_id: campaignId,
      target_label: resolved.target_label,
      summary,
      queued: {
        notifications: queuedNotifications,
        push: pushRecipients.length,
        sms: smsRecipients.length,
        push_dispatch_triggered: pushDispatchTriggered,
        sms_dispatch_triggered: smsDispatchTriggered,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Erreur envoi communication." },
      { status: 500 }
    );
  }
}
