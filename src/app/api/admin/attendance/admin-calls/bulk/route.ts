import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";
import { queueAdminAttendanceNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AllowedRole = "admin" | "super_admin" | "educator";
type MarkStatus = "present" | "absent" | "late";

async function requireActor() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  const institution_id = String(me?.institution_id || "");
  if (!institution_id) {
    return {
      error: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = String(roleRow?.role || "") as AllowedRole | "";
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour cette vue." },
        { status: 403 }
      ),
    };
  }

  return { supa, srv, institution_id, user_id: user.id, role };
}

function normalizeStatus(v: any): MarkStatus {
  const s = String(v || "").trim().toLowerCase();
  if (s === "absent") return "absent";
  if (s === "late") return "late";
  return "present";
}

export async function POST(req: NextRequest) {
  const auth = await requireActor();
  if ("error" in auth) return auth.error;

  const { srv, institution_id } = auth;

  const body = await req.json().catch(() => ({}));
  const session_id = String(body?.session_id || "").trim();
  const marks = Array.isArray(body?.marks) ? body.marks : [];

  if (!session_id) {
    return NextResponse.json(
      { error: "invalid_payload", message: "session_id requis." },
      { status: 400 }
    );
  }

  const { data: session, error: sErr } = await srv
    .from("admin_student_calls")
    .select("id,class_id,institution_id,ended_at,actual_call_at")
    .eq("institution_id", institution_id)
    .eq("id", session_id)
    .maybeSingle();

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 400 });
  }
  if (!session) {
    return NextResponse.json(
      { error: "session_not_found", message: "Séance administrative introuvable." },
      { status: 404 }
    );
  }

  if (session.ended_at) {
    return NextResponse.json(
      { error: "session_closed", message: "Cette séance administrative est déjà terminée." },
      { status: 400 }
    );
  }

  if (!Array.isArray(marks) || marks.length === 0) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      changed: false,
      queued_notifications: 0,
      cleared_pending_notifications: 0,
      notificationsTriggered: false,
    });
  }

  const payload = marks
    .map((m: any) => {
      const student_id = String(m?.student_id || "").trim();
      const status = normalizeStatus(m?.status);
      const reason = String(m?.reason || "").trim() || null;
      if (!student_id) return null;

      return {
        call_id: session_id,
        student_id,
        status,
        reason,
      };
    })
    .filter(Boolean) as Array<{
    call_id: string;
    student_id: string;
    status: MarkStatus;
    reason: string | null;
  }>;

  if (payload.length === 0) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      changed: false,
      queued_notifications: 0,
      cleared_pending_notifications: 0,
      notificationsTriggered: false,
    });
  }

  const { data: upsertedRows, error: uErr } = await srv
    .from("admin_student_call_marks")
    .upsert(payload, { onConflict: "call_id,student_id" })
    .select("id");

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 400 });
  }

  const { data: classRow } = await srv
    .from("classes")
    .select("label")
    .eq("id", session.class_id)
    .maybeSingle();

  let queued_notifications = 0;
  let cleared_pending_notifications = 0;
  let notificationsTriggered = false;
  let notificationError: string | null = null;

  try {
    const queueRes = await queueAdminAttendanceNotifications({
      srv,
      institution_id,
      admin_call_id: session_id,
      class_label: String(classRow?.label || "").trim() || null,
      items: payload.map((p) => ({
        student_id: p.student_id,
        status: p.status,
        reason: p.reason,
      })),
      whenIso: String(session.actual_call_at || new Date().toISOString()),
    });

    queued_notifications = queueRes.queued || 0;
    cleared_pending_notifications = queueRes.cleared || 0;

    if (queued_notifications > 0) {
      await Promise.allSettled([
        triggerPushDispatch({ req, reason: "admin_student_call_bulk" }),
        triggerSmsDispatch({ req, reason: "admin_student_call_bulk" }),
      ]);
      notificationsTriggered = true;
    }
  } catch (e: any) {
    notificationError = String(e?.message || e || "notification_queue_failed");
    console.error("[admin-calls/bulk] notification_queue_failed", {
      session_id,
      error: notificationError,
    });
  }

  return NextResponse.json({
    ok: true,
    session_id,
    upserted: Array.isArray(upsertedRows) ? upsertedRows.length : payload.length,
    changed: payload.length > 0,
    queued_notifications,
    cleared_pending_notifications,
    notificationsTriggered,
    notificationError,
  });
}