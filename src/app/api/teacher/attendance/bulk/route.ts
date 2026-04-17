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
};

type ResolvedPeriod = {
  id: string;
  startMin: number;
  endMin: number;
  durationMin: number;
  label?: string | null;
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

function minToHm(min: number) {
  const safe = Math.max(0, Math.floor(min));
  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function envInt(name: string, fallback: number, min = 0) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.floor(raw));
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

function resolveCandidateClientCall(body: any) {
  return (
    parseIsoDate(body?.actual_call_at) ||
    parseIsoDate(body?.client_call_at) ||
    parseIsoDate(body?.click_at) ||
    parseIsoDate(body?.clicked_at) ||
    parseIsoDate(body?.call_at) ||
    null
  );
}

function normalizeReason(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/* Fenêtres métier */
const CLIENT_CALL_MAX_FUTURE_MIN = envInt("ATTENDANCE_CLIENT_CALL_MAX_FUTURE_MIN", 5, 0);
const CLIENT_CALL_DRIFT_HOURS = envInt("ATTENDANCE_CLIENT_CALL_DRIFT_HOURS", 12, 1);
const ATTENDANCE_EARLY_ALLOWANCE_MIN = envInt("ATTENDANCE_EARLY_ALLOWANCE_MIN", 10, 0);
const ATTENDANCE_AFTER_END_ALLOWANCE_MIN = envInt(
  "ATTENDANCE_AFTER_END_ALLOWANCE_MIN",
  5,
  0
);

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
  const session_id = String(body?.session_id || "");

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
    .select("id, class_id, teacher_id, expected_minutes, actual_call_at, started_at")
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
  };

  // 2) Autorisation (prof de la séance ou téléphone de classe)
  let allowed = session.teacher_id === user.id;

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
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 3) Charger classe -> établissement -> paramètres
  const { data: clsRow, error: cErr } = await srv
    .from("classes")
    .select("institution_id")
    .eq("id", session.class_id)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 400 });
  }
  if (!clsRow?.institution_id) {
    return NextResponse.json({ error: "class_institution_missing" }, { status: 400 });
  }

  const institution_id = String(clsRow.institution_id);

  const { data: inst, error: iErr } = await srv
    .from("institutions")
    .select("tz, auto_lateness, default_session_minutes")
    .eq("id", institution_id)
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
   * 4) Déterminer l'heure effective de l'appel :
   * - priorité à session.actual_call_at si déjà fixé
   * - sinon tentative via l'heure client fournie
   * - sinon fallback serveur "maintenant"
   *
   * Protection :
   * - on refuse une heure client trop dans le futur
   * - on n'accepte qu'une dérive raisonnable autour du créneau prévu
   */
  const serverNow = new Date();
  const existingCall = parseIsoDate(session.actual_call_at);
  const plannedAt = parseIsoDate(session.started_at) || existingCall || serverNow;
  const candidateClientCall = resolveCandidateClientCall(body);

  let effectiveCallAt: Date = existingCall || serverNow;

  if (candidateClientCall) {
    const maxFutureMs = CLIENT_CALL_MAX_FUTURE_MIN * 60_000;
    const maxDriftMs = CLIENT_CALL_DRIFT_HOURS * 60 * 60_000;

    const notTooFuture =
      candidateClientCall.getTime() <= serverNow.getTime() + maxFutureMs;

    const nearPlannedSlot =
      Math.abs(candidateClientCall.getTime() - plannedAt.getTime()) <= maxDriftMs;

    if (notTooFuture && nearPlannedSlot) {
      if (!existingCall) {
        effectiveCallAt = candidateClientCall;
      } else if (candidateClientCall.getTime() < existingCall.getTime() - 60_000) {
        // on corrige seulement si l'heure client paraît réellement antérieure et plus précise
        effectiveCallAt = candidateClientCall;
      }
    }
  }

  const callAtISO = effectiveCallAt.toISOString();
  const { hm: callHM, weekday: callWeekday } = localHMAndWeekday(callAtISO, tz);
  const callMin = hmToMin(callHM);

  const plannedAtISO = plannedAt.toISOString();
  const { hm: plannedHM, weekday: plannedWeekday } = localHMAndWeekday(plannedAtISO, tz);
  const plannedMin = hmToMin(plannedHM);

  // 5) Charger les périodes du JOUR PRÉVU par la séance (pas du jour de clic)
  const { data: periods, error: pErr } = await srv
    .from("institution_periods")
    .select("id, weekday, period_no, label, start_time, end_time, duration_min")
    .eq("institution_id", institution_id)
    .eq("weekday", plannedWeekday)
    .order("period_no", { ascending: true });

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }

  const expandedPeriods: ResolvedPeriod[] = (Array.isArray(periods) ? periods : []).map((p: any) => {
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    const durationMin =
      typeof p.duration_min === "number" && p.duration_min > 0
        ? Math.floor(p.duration_min)
        : Math.max(1, endMin - startMin);

    return {
      id: String(p.id),
      label: (p.label as string | null) ?? null,
      startMin,
      endMin,
      durationMin,
    };
  });

  // Période attendue = celle dans laquelle tombe started_at
  const targetPeriod =
    expandedPeriods.find((p) => plannedMin >= p.startMin && plannedMin < p.endMin) || null;

  /**
   * 6) Verrou métier :
   * - s'il existe des périodes configurées ce jour-là, la séance DOIT correspondre à un vrai créneau
   * - et l'appel réel doit rester dans la fenêtre autorisée autour de ce créneau
   *
   * Si aucune période n'est configurée pour ce jour, on garde un fallback souple
   * pour ne pas casser les établissements pas encore paramétrés.
   */
  if (expandedPeriods.length > 0 && !targetPeriod) {
    return NextResponse.json(
      {
        error: "session_slot_not_resolved",
        message:
          "Cette séance ne correspond à aucun créneau configuré. L’appel ne peut pas être pris en compte.",
      },
      { status: 409 }
    );
  }

  if (targetPeriod) {
    const allowedStartMin = targetPeriod.startMin - ATTENDANCE_EARLY_ALLOWANCE_MIN;
    const allowedEndMin = targetPeriod.endMin + ATTENDANCE_AFTER_END_ALLOWANCE_MIN;

    const sameWeekday = callWeekday === plannedWeekday;
    const withinWindow = sameWeekday && callMin >= allowedStartMin && callMin <= allowedEndMin;

    if (!withinWindow) {
      const periodLabel =
        targetPeriod.label ||
        `${minToHm(targetPeriod.startMin)}-${minToHm(targetPeriod.endMin)}`;

      return NextResponse.json(
        {
          error: "attendance_outside_allowed_window",
          message: `Appel hors fenêtre autorisée pour le créneau ${periodLabel}. Fenêtre admise : ${minToHm(
            allowedStartMin
          )} à ${minToHm(allowedEndMin)}.`,
          details: {
            planned_weekday: plannedWeekday,
            actual_weekday: callWeekday,
            planned_slot_start: minToHm(targetPeriod.startMin),
            planned_slot_end: minToHm(targetPeriod.endMin),
            allowed_start: minToHm(allowedStartMin),
            allowed_end: minToHm(allowedEndMin),
            actual_call_hm: callHM,
          },
        },
        { status: 409 }
      );
    }
  }

  const expectedMin = Math.max(
    1,
    Math.floor(
      Number(
        session.expected_minutes ??
          targetPeriod?.durationMin ??
          defSessionMin ??
          60
      )
    )
  );

  // minutes de retard calculées côté serveur
  function computeLateMinutes(): number {
    if (targetPeriod) {
      // retard borné entre 0 et la durée réelle du créneau
      const diff = callMin - targetPeriod.startMin;
      return clamp(Math.floor(diff), 0, targetPeriod.durationMin);
    }

    // fallback établissements sans créneaux configurés
    if (session.started_at) {
      const { hm: startedHM } = localHMAndWeekday(String(session.started_at), tz);
      const diff = callMin - hmToMin(startedHM);
      return clamp(Math.floor(diff), 0, expectedMin);
    }

    return 0;
  }

  const toUpsert: Array<{
    session_id: string;
    student_id: string;
    status: "absent" | "late";
    minutes_late: number;
    hours_absent: number;
    reason: string | null;
  }> = [];

  const toDelete: string[] = [];
  const absentHours = Math.round((expectedMin / 60) * 100) / 100;

  for (const m of marks) {
    if (!m?.student_id) continue;
    const reason = normalizeReason(m?.reason);

    if (m.status === "present") {
      toDelete.push(String(m.student_id));
      continue;
    }

    if (m.status === "absent") {
      toUpsert.push({
        session_id,
        student_id: String(m.student_id),
        status: "absent",
        minutes_late: 0,
        hours_absent: absentHours,
        reason,
      });
      continue;
    }

    if (m.status === "late") {
      const minLate = autoLateness
        ? computeLateMinutes()
        : clamp(Math.round(Number(m?.minutes_late || 0)), 0, expectedMin);

      toUpsert.push({
        session_id,
        student_id: String(m.student_id),
        status: "late",
        minutes_late: minLate,
        hours_absent: 0,
        reason,
      });
      continue;
    }
  }

  let upserted = 0;
  let deleted = 0;

  if (toUpsert.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .upsert(toUpsert, {
        onConflict: "session_id,student_id",
        count: "exact",
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    upserted = count || toUpsert.length;
  }

  if (toDelete.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .delete({ count: "exact" })
      .eq("session_id", session_id)
      .in("student_id", toDelete);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    deleted = count || toDelete.length;
  }

  /**
   * 7) Fixer/corriger actual_call_at au moment du 1er marquage :
   * - si NULL -> on met l'heure effective
   * - si non-NULL mais plus tard que l'heure effective cohérente -> on corrige vers la plus petite
   */
  if (upserted > 0 || deleted > 0) {
    const patch: { actual_call_at?: string } = {};

    if (!existingCall) {
      patch.actual_call_at = callAtISO;
    } else if (effectiveCallAt.getTime() < existingCall.getTime() - 60_000) {
      patch.actual_call_at = callAtISO;
    }

    if (Object.keys(patch).length) {
      await srv.from("teacher_sessions").update(patch).eq("id", session_id);
    }
  }

  // ✨ temps réel — déclenche push + sms si des changements ont eu lieu (non bloquant)
  if (upserted > 0 || deleted > 0) {
    await Promise.allSettled([
      triggerPushDispatch({ req, reason: "teacher_attendance_bulk" }),
      triggerSmsDispatch({ req, reason: "teacher_attendance_bulk" }),
    ]);
  }

  return NextResponse.json({
    ok: true,
    upserted,
    deleted,
    meta: {
      planned_hm: plannedHM,
      actual_call_hm: callHM,
      expected_minutes: expectedMin,
      strict_window_applied: !!targetPeriod,
      target_period_id: targetPeriod?.id ?? null,
    },
  });
}