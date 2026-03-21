// src/app/api/sms/delivery-receipt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrangeDeliveryInfoNotification = {
  deliveryInfoNotification?: {
    callbackData?: string | null;
    deliveryInfo?: {
      address?: string | null;
      deliveryStatus?: string | null;
    } | null;
  } | null;
};

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function shortId(x: string | null | undefined, n = 8) {
  const str = s(x);
  if (str.length <= n) return str;
  return `${str.slice(0, 4)}…${str.slice(-4)}`;
}

function safeParse<T = any>(value: any): T | null {
  if (!value) return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function buildMergedMeta(existingMeta: any, patch: Record<string, any>) {
  const base = safeParse<Record<string, any>>(existingMeta);
  return {
    ...(base && typeof base === "object" ? base : {}),
    ...patch,
  };
}

function isDeliveredToTerminal(status: string) {
  return status === "DeliveredToTerminal";
}

function isDeliveryImpossible(status: string) {
  return status === "DeliveryImpossible";
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "sms_delivery_receipt" });
}

export async function POST(req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const body = (await req.json().catch(() => null)) as OrangeDeliveryInfoNotification | null;
    const notif = body?.deliveryInfoNotification || null;

    const resourceId = s(notif?.callbackData);
    const address = s(notif?.deliveryInfo?.address);
    const deliveryStatus = s(notif?.deliveryInfo?.deliveryStatus);
    const nowIso = new Date().toISOString();

    if (!resourceId || !deliveryStatus) {
      console.warn("[sms/dr] invalid_payload", {
        trace,
        hasBody: !!body,
        resourceIdPresent: !!resourceId,
        deliveryStatusPresent: !!deliveryStatus,
      });

      return NextResponse.json({ ok: true, ignored: "invalid_payload" }, { status: 200 });
    }

    const { data: outbox, error: outboxErr } = await srv
      .from("orange_sms_outbox")
      .select("*")
      .eq("orange_resource_id", resourceId)
      .maybeSingle();

    if (outboxErr) {
      console.error("[sms/dr] outbox_lookup_fail", {
        trace,
        resourceId,
        error: outboxErr.message,
      });
      return NextResponse.json({ ok: true, ignored: "lookup_error" }, { status: 200 });
    }

    if (!outbox) {
      console.warn("[sms/dr] unknown_resource_id", {
        trace,
        resourceId,
        address: shortId(address, 18),
        deliveryStatus,
      });
      return NextResponse.json({ ok: true, ignored: "unknown_resource_id" }, { status: 200 });
    }

    const outboxPatch: any = {
      delivery_status: deliveryStatus,
      delivery_status_at: nowIso,
      raw_last_dr: body,
      updated_at: nowIso,
    };

    if (isDeliveredToTerminal(deliveryStatus)) {
      outboxPatch.delivered_at = nowIso;
    }

    if (isDeliveryImpossible(deliveryStatus)) {
      outboxPatch.failed_at = nowIso;
    }

    const { error: outboxUpdErr } = await srv
      .from("orange_sms_outbox")
      .update(outboxPatch)
      .eq("id", outbox.id);

    if (outboxUpdErr) {
      console.error("[sms/dr] outbox_update_fail", {
        trace,
        resourceId,
        error: outboxUpdErr.message,
      });
      return NextResponse.json({ ok: true, ignored: "outbox_update_fail" }, { status: 200 });
    }

    const { data: queue, error: queueErr } = await srv
      .from("notifications_queue")
      .select("id,meta")
      .eq("id", outbox.queue_id)
      .maybeSingle();

    if (queueErr) {
      console.error("[sms/dr] queue_lookup_fail", {
        trace,
        resourceId,
        queueId: outbox.queue_id,
        error: queueErr.message,
      });
      return NextResponse.json({ ok: true, ignored: "queue_lookup_fail" }, { status: 200 });
    }

    if (queue) {
      const nextMeta = buildMergedMeta(queue.meta, {
        sms_delivery: {
          provider: "orange_ci",
          accepted_by_provider: true,
          accepted_at: outbox.accepted_at,
          to: outbox.phone_e164,
          sender_address: outbox.sender_address,
          orange_resource_id: resourceId,
          orange_resource_url: outbox.orange_resource_url,
          delivery_status: deliveryStatus,
          delivery_status_at: nowIso,
          terminal_delivered: isDeliveredToTerminal(deliveryStatus),
          failed_delivery: isDeliveryImpossible(deliveryStatus),
        },
      });

      const { error: queueUpdErr } = await srv
        .from("notifications_queue")
        .update({
          meta: nextMeta,
        } as any)
        .eq("id", outbox.queue_id);

      if (queueUpdErr) {
        console.error("[sms/dr] queue_update_fail", {
          trace,
          resourceId,
          queueId: outbox.queue_id,
          error: queueUpdErr.message,
        });
      } else {
        console.info("[sms/dr] queue_update_ok", {
          trace,
          resourceId,
          queueId: shortId(outbox.queue_id),
          deliveryStatus,
        });
      }
    }

    console.info("[sms/dr] ok", {
      trace,
      resourceId,
      address: shortId(address, 18),
      deliveryStatus,
      queueId: shortId(outbox.queue_id),
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[sms/dr] fatal", {
      trace,
      error: String(e?.message || e),
    });

    return NextResponse.json({ ok: true, ignored: "fatal" }, { status: 200 });
  }
}