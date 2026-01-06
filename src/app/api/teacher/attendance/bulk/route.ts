// src/app/api/teacher/attendance/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
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
  minutes_late?: number; // ignoré si auto_lateness actif
  reason?: string | null;
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
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const session_id = String(body?.session_id || "");

  // 🔹 payload marks brut
  const rawMarks: Mark[] = Array.isArray(body?.marks) ? body.marks : [];
  if (!session_id)
    return NextResponse.json({ error: "missing_session" }, { status: 400 });

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
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
  if (!sess) return NextResponse.json({ error: "session_not_found" }, { status: 404 });

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
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 3) Charger classe -> établissement -> paramètres + créneaux du jour
  const { data: clsRow, error: cErr } = await srv
    .from("classes")
    .select("institution_id")
    .eq("id", session.class_id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  if (!clsRow?.institution_id)
    return NextResponse.json({ error: "class_institution_missing" }, { status: 400 });

  const { data: inst, error: iErr } = await srv
    .from("institutions")
    .select("tz, auto_lateness, default_session_minutes")
    .eq("id", clsRow.institution_id)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });

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

  const candidateClientCall =
    parseIsoDate(body?.actual_call_at) ||
    parseIsoDate(body?.client_call_at) ||
    parseIsoDate(body?.click_at) ||
    parseIsoDate(body?.clicked_at) ||
    parseIsoDate(body?.call_at) ||
    null;

  const refSlot = parseIsoDate(session.started_at) || existingCall || serverNow;
  const windowMin = refSlot.getTime() - 8 * 60_000 * 60; // -8h
  const windowMax = refSlot.getTime() + 12 * 60_000 * 60; // +12h

  let effectiveCallAt: Date = existingCall || serverNow;

  if (candidateClientCall) {
    const maxFutureMs = 5 * 60_000; // +5 min
    const notTooFuture =
      candidateClientCall.getTime() <= serverNow.getTime() + maxFutureMs;
    const inWindow =
      candidateClientCall.getTime() >= windowMin &&
      candidateClientCall.getTime() <= windowMax;

    if (notTooFuture && inWindow) {
      if (!existingCall) {
        effectiveCallAt = candidateClientCall;
      } else {
        const diffMs = existingCall.getTime() - candidateClientCall.getTime();
        if (diffMs > 60_000) {
          // existingCall semble être une heure de sync plus tard → on calcule avec l'heure réelle
          effectiveCallAt = candidateClientCall;
        }
      }
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
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

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

  // minutes de retard calculées côté serveur (si auto_lateness)
  function computeLateMinutes(): number {
    if (!currentPeriod) {
      // fallback : si pas de période trouvée, essayer vs started_at ; sinon 0
      if (session.started_at) {
        const { hm: startedHM } = localHMAndWeekday(String(session.started_at), tz);
        const diff = callMin - hmToMin(startedHM);
        return Math.max(0, Math.floor(diff));
      }
      return 0;
    }
    const diff = callMin - currentPeriod.startMin;
    return Math.max(0, Math.floor(diff));
  }

  const toUpsert: any[] = [];
  const toDelete: string[] = [];
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
      const minLate = autoLateness
        ? computeLateMinutes()
        : Math.max(0, Math.round(Number(m?.minutes_late || 0)));

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

  let upserted = 0,
    deleted = 0;

  if (toUpsert.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .upsert(toUpsert, {
        onConflict: "session_id,student_id",
        count: "exact",
      });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    upserted = count || toUpsert.length;
  }

  if (toDelete.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .delete({ count: "exact" })
      .eq("session_id", session_id)
      .in("student_id", toDelete);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    deleted = count || toDelete.length;
  }

  /**
   * ✅ Fixer/corriger actual_call_at au moment du 1er marquage :
   * - si NULL -> on met l'heure effective (client si fournie, sinon serveur)
   * - si non-NULL mais plus tard que l'heure effective cohérente -> on corrige vers la plus petite
   */
  if (upserted > 0 || deleted > 0) {
    const patch: any = {};
    if (!existingCall) {
      patch.actual_call_at = callAtISO;
    } else if (effectiveCallAt.getTime() < existingCall.getTime() - 60_000) {
      // on ne corrige que si c'est vraiment plus tôt (>1 min)
      patch.actual_call_at = callAtISO;
    }

    if (Object.keys(patch).length) {
      await srv.from("teacher_sessions").update(patch).eq("id", session_id);
    }
  }

  // ✨ temps réel — déclenche le dispatch si des changements ont eu lieu (non bloquant)
  if (upserted > 0 || deleted > 0) {
    await triggerPushDispatch({ req, reason: "teacher_attendance_bulk" });
  }

  return NextResponse.json({ ok: true, upserted, deleted });
}
