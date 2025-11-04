// src/app/api/teacher/attendance/bulk/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
// ✨ temps réel
import { triggerPushDispatch } from "@/lib/push-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers ───────────────── */
type Mark = {
  student_id: string;
  status: "present" | "absent" | "late";
  minutes_late?: number;
  reason?: string | null;
};

function uniq<T>(arr: T[]) { return Array.from(new Set((arr || []).filter(Boolean))) as T[]; }
function buildPhoneVariants(raw: string) {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";
  return {
    variants: uniq<string>([
      t, t.replace(/\s+/g, ""),
      digits, `+${digits}`,
      `+${cc}${local10}`, `+${cc}${localNo0}`,
      `00${cc}${local10}`, `00${cc}${localNo0}`,
      `${cc}${local10}`, `${cc}${localNo0}`,
      local10, localNo0 ? `0${localNo0}` : "",
    ]),
  };
}

/* ───────────────── handler ───────────────── */
export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const session_id = String(body?.session_id || "");
  const marks: Mark[] = Array.isArray(body?.marks) ? body.marks : [];
  if (!session_id) return NextResponse.json({ error: "missing_session" }, { status: 400 });

  // 1) Charger la séance
  const { data: sess, error: sErr } = await srv
    .from("teacher_sessions")
    .select("id, class_id, teacher_id, expected_minutes, actual_call_at")
    .eq("id", session_id)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
  if (!sess) return NextResponse.json({ error: "session_not_found" }, { status: 404 });

  // 2) Autorisation
  let allowed = sess.teacher_id === user.id;
  if (!allowed) {
    let phone = String((user as any).phone || "").trim();
    if (!phone) {
      const { data: au } = await srv.schema("auth").from("users").select("phone").eq("id", user.id).maybeSingle();
      phone = String(au?.phone || "").trim();
    }
    if (phone) {
      const { variants } = buildPhoneVariants(phone);
      const { data: cls } = await srv
        .from("classes")
        .select("id")
        .eq("id", sess.class_id)
        .in("class_phone_e164", variants.length ? variants : ["__no_match__"])
        .maybeSingle();
      allowed = !!cls;
    }
  }
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 3) Préparer upserts/deletes
  const toUpsert: any[] = [];
  const toDelete: string[] = [];
  const expectedMin = Math.max(1, Math.floor(Number(sess.expected_minutes || 60)));
  const absentHours = Math.round((expectedMin / 60) * 100) / 100;

  for (const m of marks) {
    if (!m?.student_id) continue;
    const reason = (m?.reason ?? null) ? String(m.reason).trim() : null;

    if (m.status === "present") {
      toDelete.push(m.student_id);
      continue;
    }

    if (m.status === "absent") {
      toUpsert.push({
        session_id,
        student_id: m.student_id,
        status: "absent",
        minutes_late: 0,
        hours_absent: absentHours,
        reason,
      });
      continue;
    }

    if (m.status === "late") {
      const minLate = Math.max(0, Math.round(Number(m?.minutes_late || 0)));
      toUpsert.push({
        session_id,
        student_id: m.student_id,
        status: "late",
        minutes_late: minLate,
        hours_absent: 0,
        reason,
      });
      continue;
    }
  }

  let upserted = 0, deleted = 0;

  if (toUpsert.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .upsert(toUpsert, { onConflict: "session_id,student_id", count: "exact" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    upserted = count || toUpsert.length;
  }

  if (toDelete.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .delete({ count: "exact" })
      .eq("session_id", session_id)
      .in("student_id", toDelete);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    deleted = count || toDelete.length;
  }

  // 4) Marquer l’heure réelle d’appel au premier marquage
  if ((upserted > 0 || deleted > 0) && !sess.actual_call_at) {
    await srv.from("teacher_sessions")
      .update({ actual_call_at: new Date().toISOString() })
      .eq("id", session_id)
      .is("actual_call_at", null);
  }

  // ✨ temps réel — déclenche le dispatch si des changements ont eu lieu (non bloquant)
  if (upserted > 0 || deleted > 0) {
    void triggerPushDispatch({ req, reason: "teacher_attendance_bulk" });
  }

  return NextResponse.json({ ok: true, upserted, deleted });
}
