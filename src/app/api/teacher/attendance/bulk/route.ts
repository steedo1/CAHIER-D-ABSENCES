// src/app/api/teacher/attendance/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
// ✨ temps réel
import { triggerPushDispatch } from "@/lib/push-dispatch";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers ───────────────── */
type Mark = {
  student_id: string;
  status: "present" | "absent" | "late";
  minutes_late?: number; // ignoré si auto_lateness actif
  reason?: string | null;
  observed_at?: string | null;
  late_observed_at?: string | null;
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function buildPhoneVariants(raw: string) {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";
  return {
    variants: uniq<string>([
      t,
      t.replace(/\s+/g, ""),
      digits,
      `+${digits}`,
      `+${cc}${local10}`,
      `+${cc}${localNo0}`,
      `00${cc}${local10}`,
      `00${cc}${localNo0}`,
      `${cc}${local10}`,
      `${cc}${localNo0}`,
      local10,
      localNo0 ? `0${localNo0}` : "",
    ]),
  };
}

/** ISO parsing safe */
function parseIsoDate(v: any): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** HH:MM:SS -> minutes depuis minuit */
function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/** "HH:MM" -> minutes depuis minuit */
function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/** Donne l’heure locale HH:MM et weekday (0=dimanche..6=samedi) dans un tz donné */
function localHMAndWeekday(iso: string, tz: string) {
  const d = new Date(iso);
  const fmtHM = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const fmtWD = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });
  const hm = fmtHM.format(d); // "HH:MM"
  const wd = fmtWD.format(d).toLowerCase(); // "sun"|"mon"|...
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return { hm, weekday: map[wd] ?? 0 };
}

/* ───────────────── handler ───────────────── */
export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const session_id = String(body?.session_id || "").trim();
  const operationId = String(
    req.headers.get("x-mon-cahier-operation-id") ||
      body?.operation_id ||
      "",
  ).trim();
  if (!operationId) {
    return NextResponse.json({ error: "operation_id_required" }, { status: 400 });
  }
  if (
    !/^[a-zA-Z0-9:_-]{8,160}$/.test(operationId) ||
    operationId.startsWith("client:")
  ) {
    return NextResponse.json({ error: "invalid_operation_id" }, { status: 400 });
  }

  // 🔹 payload marks brut
  const rawMarks: Mark[] = Array.isArray(body?.marks) ? body.marks : [];
  if (!session_id) {
    return NextResponse.json({ error: "missing_session" }, { status: 400 });
  }

  // 🔹 de-duplication : un seul Mark par student_id (on garde le DERNIER dans le tableau)
  const marksByStudent = new Map<string, Mark>();
  for (const m of rawMarks) {
    if (!m || !m.student_id) continue;
    marksByStudent.set(String(m.student_id), m);
  }
  const marks = Array.from(marksByStudent.values());

  // 1) Charger la séance (+ started_at pour cohérence)
  const { data: sess, error: sErr } = await srv
    .from("teacher_sessions")
    .select("id, class_id, teacher_id, expected_minutes, actual_call_at, started_at, ended_at, presence_verified, presence_method")
    .eq("id", session_id)
    .maybeSingle();

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 400 });
  }
  if (!sess) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const session = sess as {
    id: string;
    class_id: string;
    teacher_id: string;
    expected_minutes: number | null;
    actual_call_at: string | null;
    started_at: string | null;
    ended_at: string | null;
    presence_verified: boolean | null;
    presence_method: string | null;
  };

  // 2) Autorisation (prof de la séance ou téléphone de classe)
  let allowed = session.teacher_id === user.id;
  let classDeviceAuthorized = false;

  if (!allowed) {
    let phone = String((user as any).phone || "").trim();

    if (!phone) {
      const { data: au } = await srv
        .schema("auth")
        .from("users")
        .select("phone")
        .eq("id", user.id)
        .maybeSingle();

      phone = String(au?.phone || "").trim();
    }

    if (phone) {
      const { variants } = buildPhoneVariants(phone);
      const { data: cls } = await srv
        .from("classes")
        .select("id")
        .eq("id", session.class_id)
        .in("class_phone_e164", variants.length ? variants : ["__no_match__"])
        .maybeSingle();

      allowed = !!cls;
      classDeviceAuthorized = !!cls;
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 3) Charger classe -> établissement -> paramètres + créneaux du jour
  const { data: clsRow, error: cErr } = await srv
    .from("classes")
    .select("institution_id")
    .eq("id", session.class_id)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 400 });
  }
  if (!clsRow?.institution_id) {
    return NextResponse.json(
      { error: "class_institution_missing" },
      { status: 400 }
    );
  }

  if (marks.length > 0) {
    const requestedStudentIds = Array.from(
      new Set(
        marks
          .map((mark) => String(mark?.student_id || "").trim())
          .filter(Boolean),
      ),
    );

    const { data: enrollments, error: enrollmentsError } = await srv
      .from("class_enrollments")
      .select("student_id")
      .eq("class_id", session.class_id)
      .is("end_date", null)
      .in(
        "student_id",
        requestedStudentIds.length
          ? requestedStudentIds
          : ["00000000-0000-0000-0000-000000000000"],
      );

    if (enrollmentsError) {
      return NextResponse.json(
        { error: enrollmentsError.message },
        { status: 400 },
      );
    }

    const enrolledIds = new Set(
      (enrollments || []).map((row: any) => String(row.student_id || "")),
    );
    const invalidStudentIds = requestedStudentIds.filter(
      (studentId) => !enrolledIds.has(studentId),
    );

    if (invalidStudentIds.length > 0) {
      return NextResponse.json(
        {
          error: "student_not_enrolled_in_session_class",
          message:
            "Un ou plusieurs élèves ne sont pas inscrits dans la classe de cette séance.",
          student_ids: invalidStudentIds,
        },
        { status: 409 },
      );
    }
  }

  const { data: presencePolicy, error: presencePolicyError } = await srv
    .from("institution_attendance_policies")
    .select("enabled,teacher_accounts_only")
    .eq("institution_id", clsRow.institution_id)
    .maybeSingle();
  const presenceMigrationMissing = (presencePolicyError as any)?.code === "42P01";
  if (presencePolicyError && !presenceMigrationMissing) {
    return NextResponse.json({ error: presencePolicyError.message }, { status: 500 });
  }
  if (
    presencePolicy?.enabled === true &&
    presencePolicy.teacher_accounts_only !== false &&
    !classDeviceAuthorized &&
    session.presence_verified !== true
  ) {
    return NextResponse.json(
      {
        error: "attendance_presence_not_verified",
        message: "Enregistrement refusé : la présence dans l'établissement n'a pas été vérifiée pour cette séance.",
      },
      { status: 403 },
    );
  }

  const { data: inst, error: iErr } = await srv
    .from("institutions")
    .select("tz, auto_lateness, default_session_minutes")
    .eq("id", clsRow.institution_id)
    .maybeSingle();

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 400 });
  }

  const tz = String(inst?.tz || "Africa/Abidjan");
  const autoLateness = inst?.auto_lateness ?? true;
  const defSessionMin =
    Number.isFinite(Number(inst?.default_session_minutes)) &&
    Number(inst?.default_session_minutes) > 0
      ? Math.floor(Number(inst?.default_session_minutes))
      : 60;

  /**
   * ✅ Heure effective à utiliser pour calculer weekday/retard :
   * - priorité à session.actual_call_at si elle existe
   * - sinon, si le client fournit actual_call_at (offline sync), on l'utilise
   * - sinon fallback serveur "maintenant"
   *
   * Protection : on refuse une heure client trop dans le futur (> +5 min).
   * Et on accepte la correction "plus tôt" seulement si c'est cohérent autour du créneau.
   */
  const serverNow = new Date();
  const existingCall = parseIsoDate(session.actual_call_at);

  const rawCapturedAtDevice = String(
    body?.captured_at_device ??
      body?.actual_call_at ??
      body?.client_call_at ??
      body?.click_at ??
      body?.clicked_at ??
      body?.call_at ??
      "",
  ).trim();
  const candidateClientCall = rawCapturedAtDevice
    ? parseIsoDate(rawCapturedAtDevice)
    : null;
  if (rawCapturedAtDevice && !candidateClientCall) {
    return NextResponse.json(
      { error: "captured_at_device_invalid" },
      { status: 422 },
    );
  }

  const refSlot = parseIsoDate(session.started_at) || existingCall || serverNow;
  const windowMin = refSlot.getTime() - 8 * 60_000 * 60; // -8h
  const windowMax = refSlot.getTime() + 12 * 60_000 * 60; // +12h

  if (candidateClientCall) {
    const maxFutureMs = 5 * 60_000; // +5 min
    const notTooFuture =
      candidateClientCall.getTime() <= serverNow.getTime() + maxFutureMs;
    const inWindow =
      candidateClientCall.getTime() >= windowMin &&
      candidateClientCall.getTime() <= windowMax;
    if (!notTooFuture || !inWindow) {
      return NextResponse.json(
        { error: "captured_at_device_out_of_window" },
        { status: 422 },
      );
    }
  }

  // Horloge causale : le clic de validation, jamais l'heure de réception réseau.
  const capturedAtDevice = (candidateClientCall || serverNow).toISOString();
  let effectiveCallAt: Date = existingCall || candidateClientCall || serverNow;

  if (candidateClientCall && existingCall) {
    const diffMs = existingCall.getTime() - candidateClientCall.getTime();
    if (diffMs > 60_000) {
      // existingCall semble être une heure de sync plus tard → calculer avec l'heure réelle.
      effectiveCallAt = candidateClientCall;
    }
  }

  const callAtISO = effectiveCallAt.toISOString();
  const { hm: callHM, weekday } = localHMAndWeekday(callAtISO, tz);
  const callMin = hmToMin(callHM);

  // Périodes du jour (selon le weekday calculé sur l'heure effective)
  const { data: periods, error: pErr } = await srv
    .from("institution_periods")
    .select("id, weekday, period_no, label, start_time, end_time, duration_min")
    .eq("institution_id", clsRow.institution_id)
    .eq("weekday", weekday)
    .order("period_no", { ascending: true });

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }

  let currentPeriod:
    | {
        id: string;
        startMin: number;
        endMin: number;
        durationMin: number;
      }
    | null = null;

  if (Array.isArray(periods) && periods.length) {
    const expanded = periods.map((p: any) => ({
      id: p.id,
      startMin: hmsToMin(p.start_time),
      endMin: hmsToMin(p.end_time),
      durationMin:
        typeof p.duration_min === "number" && p.duration_min > 0
          ? Math.floor(p.duration_min)
          : Math.max(1, hmsToMin(p.end_time) - hmsToMin(p.start_time)),
    }));

    currentPeriod =
      expanded.find((p: any) => callMin >= p.startMin && callMin < p.endMin) ??
      [...expanded].reverse().find((p: any) => callMin >= p.startMin) ??
      null;
  }

  const expectedMin = Math.max(
    1,
    Math.floor(
      Number(
        session.expected_minutes ??
          currentPeriod?.durationMin ??
          defSessionMin ??
          60
      )
    )
  );

  // L'heure de la coche Retard est distincte de l'heure du bouton SAVE.
  // Elle est contrôlée côté serveur avant d'être utilisée.
  function validatedObservedAt(mark: Mark): Date {
    const candidate =
      parseIsoDate(mark?.observed_at) ||
      parseIsoDate(mark?.late_observed_at) ||
      null;
    if (!candidate) return effectiveCallAt;

    const notTooFuture = candidate.getTime() <= serverNow.getTime() + 5 * 60_000;
    const inSessionWindow =
      candidate.getTime() >= windowMin &&
      candidate.getTime() <= windowMax;
    if (!notTooFuture || !inSessionWindow) return effectiveCallAt;

    const observedLocal = localHMAndWeekday(candidate.toISOString(), tz);
    const observedMinutes = hmToMin(observedLocal.hm);
    if (
      currentPeriod &&
      (observedLocal.weekday !== weekday ||
        observedMinutes < currentPeriod.startMin ||
        observedMinutes >= currentPeriod.endMin)
    ) {
      return effectiveCallAt;
    }
    return candidate;
  }

  function computeLateMinutes(mark: Mark): number {
    const observedAt = validatedObservedAt(mark);
    const { hm: observedHM } = localHMAndWeekday(observedAt.toISOString(), tz);
    const observedMin = hmToMin(observedHM);
    if (!currentPeriod) {
      if (session.started_at) {
        const { hm: startedHM } = localHMAndWeekday(String(session.started_at), tz);
        return Math.max(0, Math.floor(observedMin - hmToMin(startedHM)));
      }
      return 0;
    }
    return Math.max(0, Math.floor(observedMin - currentPeriod.startMin));
  }

  const atomicMarks: Array<{
    student_id: string;
    status: "present" | "absent" | "late";
    late_minutes: number;
    comment: string | null;
  }> = [];

  for (const m of marks) {
    const studentId = String(m?.student_id || "").trim();
    if (!studentId) continue;
    if (m.status !== "present" && m.status !== "absent" && m.status !== "late") {
      return NextResponse.json(
        { error: "attendance_status_invalid" },
        { status: 422 },
      );
    }
    const reason = (m?.reason ?? null) ? String(m.reason).trim() : null;
    atomicMarks.push({
      student_id: studentId,
      status: m.status,
      late_minutes:
        m.status === "late"
          ? autoLateness
            ? computeLateMinutes(m)
            : Math.max(0, Math.round(Number(m?.minutes_late || 0)))
          : 0,
      comment: reason,
    });
  }
  atomicMarks.sort((left, right) => left.student_id.localeCompare(right.student_id));

  const { data: atomicData, error: atomicError } = await srv.rpc(
    "apply_relay_attendance_call_v2",
    {
      p_institution_id: clsRow.institution_id,
      p_session_id: session_id,
      p_operation_id: operationId,
      p_captured_at_device: capturedAtDevice,
      p_marks: atomicMarks,
    },
  );

  if (atomicError) {
    const details = [
      (atomicError as any)?.code,
      (atomicError as any)?.message,
      (atomicError as any)?.details,
      (atomicError as any)?.hint,
    ]
      .filter(Boolean)
      .join(" ");
    if (details.includes("attendance_operation_payload_conflict")) {
      return NextResponse.json(
        { error: "attendance_operation_payload_conflict" },
        { status: 409 },
      );
    }
    if (details.includes("attendance_operation_stale")) {
      return NextResponse.json(
        { error: "attendance_operation_stale" },
        { status: 409 },
      );
    }
    if (details.includes("attendance_operation_ambiguous")) {
      return NextResponse.json(
        { error: "attendance_operation_ambiguous" },
        { status: 409 },
      );
    }
    if (details.includes("attendance_operation_capture_invalid")) {
      return NextResponse.json(
        { error: "captured_at_device_invalid" },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error: "attendance_integrity_migration_required",
        message:
          "La mutation atomique des appels est indisponible. Appliquez la migration d'intégrité avant de réessayer.",
      },
      { status: 503 },
    );
  }

  const atomicResult = Array.isArray(atomicData) ? atomicData[0] : atomicData;
  const atomicStatus = String((atomicResult as any)?.status || "");
  if (atomicStatus === "session_not_found") {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if (atomicStatus === "session_closed") {
    return NextResponse.json(
      {
        error: "session_closed",
        message: "Cette séance est déjà terminée et ne peut plus être modifiée.",
      },
      { status: 409 },
    );
  }
  if (
    atomicStatus === "attendance_operation_stale" ||
    atomicStatus === "attendance_operation_ambiguous" ||
    atomicStatus === "attendance_operation_payload_conflict"
  ) {
    return NextResponse.json({ error: atomicStatus }, { status: 409 });
  }
  if (atomicStatus === "attendance_payload_invalid") {
    return NextResponse.json({ error: atomicStatus }, { status: 422 });
  }
  if (atomicStatus !== "applied" && atomicStatus !== "already_applied") {
    return NextResponse.json(
      { error: "attendance_atomic_response_invalid" },
      { status: 503 },
    );
  }

  const changed = (atomicResult as any)?.changed === true;
  const upserted = Number((atomicResult as any)?.upserted || 0);
  const deleted = Number((atomicResult as any)?.deleted || 0);

  // Temps réel uniquement lorsque l'opération a réellement changé l'appel.
  if (changed) {
    await Promise.allSettled([
      triggerPushDispatch({ req, reason: "teacher_attendance_bulk" }),
      triggerSmsDispatch({ req, reason: "teacher_attendance_bulk" }),
    ]);
  }

  return NextResponse.json({
    ok: true,
    operation_id: operationId,
    session_id,
    captured_at_device: capturedAtDevice,
    idempotent: atomicStatus === "already_applied",
    upserted,
    deleted,
  });
}
