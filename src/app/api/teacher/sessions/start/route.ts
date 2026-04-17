// src/app/api/teacher/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  class_id?: string;
  subject_id?: string | null; // côté front = subjects.id (canonique) ou institution_subjects.id
  started_at?: string;

  // Heure réelle du clic "Démarrer l'appel"
  actual_call_at?: string | null;

  expected_minutes?: number | null;

  // optionnels (debug / compat)
  client_session_id?: string | null;
};

type ResolvedPeriod = {
  id?: string | null;
  label?: string | null;
  weekday: number;
  period_no?: number | null;
  startMin: number;
  endMin: number;
  durationMin: number;
};

type WeekdayMode = "iso" | "js" | "mon0";

async function getAuthUser() {
  const supa = await getSupabaseServerClient();
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user) {
    return { user: null, error: "Non authentifié" as string | null };
  }
  return { user: data.user, error: null as string | null };
}

/* ───────── réglages fenêtres métier ───────── */
function envInt(name: string, fallback: number, min = 0) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.floor(raw));
}

const CLIENT_CALL_MAX_FUTURE_MIN = envInt("ATTENDANCE_CLIENT_CALL_MAX_FUTURE_MIN", 5, 0);
const CLIENT_CALL_MAX_AGE_DAYS = envInt("ATTENDANCE_CLIENT_CALL_MAX_AGE_DAYS", 7, 1);
const ATTENDANCE_EARLY_ALLOWANCE_MIN = envInt("ATTENDANCE_EARLY_ALLOWANCE_MIN", 10, 0);
const ATTENDANCE_AFTER_END_ALLOWANCE_MIN = envInt("ATTENDANCE_AFTER_END_ALLOWANCE_MIN", 5, 0);

/* ───────── helpers horaires ───────── */
function pad2(n: number) {
  return String(n).padStart(2, "0");
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

/** minutes -> HH:MM */
function minToHM(min: number) {
  const safe = Math.max(0, Math.floor(min));
  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** ISO parsing safe */
function parseIsoDate(v: any): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** parts date/heure dans un timezone (utilisé pour convertir proprement local -> UTC) */
function partsInTZ(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    second: parseInt(get("second"), 10),
  };
}

/**
 * Convertit une date/heure locale (dans tz) vers un Date UTC
 */
function zonedToUTC(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
  tz: string
) {
  let guess = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));

  for (let i = 0; i < 2; i++) {
    const got = partsInTZ(guess, tz);
    const gotUTC = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const wantUTC = Date.UTC(y, mo - 1, d, hh, mm, ss);
    const diffMs = gotUTC - wantUTC;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() - diffMs);
  }

  return guess;
}

/** Donne Y-M-D local + HH:MM local + JS weekday (0=dimanche..6=samedi) dans tz */
function localYMDHMAndJsDow(iso: string, tz: string) {
  const d = new Date(iso);

  const fmtYMD = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
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

  const ymdParts = fmtYMD.formatToParts(d);
  const y = parseInt(ymdParts.find((p) => p.type === "year")?.value || "1970", 10);
  const mo = parseInt(ymdParts.find((p) => p.type === "month")?.value || "1", 10);
  const da = parseInt(ymdParts.find((p) => p.type === "day")?.value || "1", 10);

  const hm = fmtHM.format(d); // HH:MM

  const wdStr = fmtWD.format(d).toLowerCase();
  const mapJs: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return { y, mo, da, hm, jsdow: mapJs[wdStr] ?? 0 };
}

function parseWeekday(raw: any): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function detectWeekdayMode(periods: any[]): WeekdayMode {
  const vals = Array.from(
    new Set(
      (periods || [])
        .map((p) => parseWeekday(p?.weekday))
        .filter((v): v is number => v !== null && v !== undefined)
    )
  );

  if (vals.includes(7)) return "iso";

  const max = vals.length ? Math.max(...vals) : 6;
  if (max === 5) return "mon0";
  if (vals.includes(0) && max === 6) return "js";

  return "iso";
}

function jsDayToDbWeekday(jsDay0to6: number, mode: WeekdayMode): number {
  if (mode === "js") return jsDay0to6;
  if (mode === "iso") return jsDay0to6 === 0 ? 7 : jsDay0to6;
  return (jsDay0to6 + 6) % 7; // mon0
}

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

function pickBestSession(rows: any[]) {
  const toMs = (v: any) => {
    const t = v ? new Date(String(v)).getTime() : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };

  return [...rows].sort((a, b) => {
    const aHas = !!a.actual_call_at;
    const bHas = !!b.actual_call_at;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const ac = toMs(a.actual_call_at);
    const bc = toMs(b.actual_call_at);
    if (ac !== bc) return ac - bc;
    const aCreated = toMs(a.created_at);
    const bCreated = toMs(b.created_at);
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

function resolveCandidateClientCall(body: Body) {
  return (
    parseIsoDate(body.actual_call_at) ||
    parseIsoDate((body as any)?.client_call_at) ||
    parseIsoDate((body as any)?.click_at) ||
    parseIsoDate((body as any)?.clicked_at) ||
    parseIsoDate((body as any)?.call_at) ||
    null
  );
}

function pickEffectiveCallAt(body: Body, started_at_in: string, nowISO: string) {
  const now = new Date(nowISO).getTime();
  const maxFutureMs = CLIENT_CALL_MAX_FUTURE_MIN * 60 * 1000;
  const maxAgeMs = CLIENT_CALL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  const candidates = [
    body.actual_call_at ?? null,
    (body as any)?.client_call_at ?? null,
    (body as any)?.click_at ?? null,
    (body as any)?.clicked_at ?? null,
    started_at_in ?? null,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const t = new Date(c).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > now + maxFutureMs) continue;
    if (t < now - maxAgeMs) continue;
    return new Date(t).toISOString();
  }

  return nowISO;
}

function buildResolvedPeriods(periods: any[]): ResolvedPeriod[] {
  return (periods || []).map((p: any) => {
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    const durationMin =
      typeof p.duration_min === "number" && p.duration_min > 0
        ? Math.floor(p.duration_min)
        : Math.max(1, endMin - startMin);

    return {
      id: p.id ? String(p.id) : null,
      label: (p.label as string | null) ?? null,
      weekday: Number(p.weekday),
      period_no: typeof p.period_no === "number" ? p.period_no : null,
      startMin,
      endMin,
      durationMin,
    };
  });
}

async function fetchTeacherSessionFull(svc: ReturnType<typeof getSupabaseServiceClient>, id: string) {
  const { data, error } = await svc
    .from("teacher_sessions")
    .select(
      `
      id,
      class_id,
      subject_id,
      started_at,
      actual_call_at,
      expected_minutes,
      classes!inner ( label ),
      institution_subjects!teacher_sessions_subject_id_fkey (
        id,
        subject:subjects ( id, name )
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getAuthUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const class_id = body.class_id ?? null;
    const raw_subject_id = body.subject_id ?? null;
    const raw_started_at = body.started_at ?? null;
    const expected_minutes_body = body.expected_minutes ?? null;

    if (!class_id || !raw_subject_id || !raw_started_at) {
      return NextResponse.json(
        { error: "Paramètres manquants (classe / matière / horaire)." },
        { status: 400 }
      );
    }

    let startedDate = new Date(raw_started_at);
    if (isNaN(startedDate.getTime())) startedDate = new Date();
    const started_at_in = startedDate.toISOString();

    const svc = getSupabaseServiceClient();

    /* 1) classe */
    const { data: cls, error: clsErr } = await svc
      .from("classes")
      .select("id, label, institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr || !cls) {
      return NextResponse.json(
        { error: "Classe introuvable pour démarrer la séance." },
        { status: 400 }
      );
    }

    /* 2) matière -> institution_subjects.id */
    let instSubjectId: string | null = null;

    const { data: asInst, error: asInstErr } = await svc
      .from("institution_subjects")
      .select("id")
      .eq("id", raw_subject_id)
      .maybeSingle();

    if (asInst && !asInstErr) {
      instSubjectId = asInst.id;
    } else {
      const { data: viaCanonical, error: viaCanonicalErr } = await svc
        .from("institution_subjects")
        .select("id")
        .eq("institution_id", cls.institution_id)
        .eq("subject_id", raw_subject_id)
        .eq("is_active", true)
        .maybeSingle();

      if (viaCanonical && !viaCanonicalErr) {
        instSubjectId = viaCanonical.id;
      }
    }

    if (!instSubjectId) {
      return NextResponse.json(
        {
          error:
            "La matière sélectionnée n’est pas correctement affectée à cet établissement. Vérifiez les disciplines dans les paramètres de l’établissement.",
        },
        { status: 400 }
      );
    }

    /* 3) établissement */
    const { data: inst, error: instErr } = await svc
      .from("institutions")
      .select("tz, default_session_minutes")
      .eq("id", cls.institution_id)
      .maybeSingle();

    if (instErr) {
      return NextResponse.json({ error: instErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");
    const defSessionMin =
      Number.isFinite(Number(inst?.default_session_minutes)) &&
      Number(inst?.default_session_minutes) > 0
        ? Math.floor(Number(inst?.default_session_minutes))
        : 60;

    /* 4) heure réelle du clic */
    const nowISO = new Date().toISOString();
    const effectiveCallAtISO = pickEffectiveCallAt(body, started_at_in, nowISO);
    const effectiveCallAt = new Date(effectiveCallAtISO);

    /* 5) périodes du jour */
    const localStarted = localYMDHMAndJsDow(started_at_in, tz);
    const localCall = localYMDHMAndJsDow(effectiveCallAtISO, tz);
    const startedMin = hmToMin(localStarted.hm);
    const callMin = hmToMin(localCall.hm);

    const { data: allPeriods, error: pErr } = await svc
      .from("institution_periods")
      .select("id, weekday, period_no, label, start_time, end_time, duration_min")
      .eq("institution_id", cls.institution_id)
      .order("weekday", { ascending: true })
      .order("period_no", { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }

    const weekdayMode = detectWeekdayMode(allPeriods || []);
    const dbWeekday = jsDayToDbWeekday(localStarted.jsdow, weekdayMode);
    const dayPeriods = buildResolvedPeriods(
      (allPeriods || []).filter((p: any) => Number(p.weekday) === dbWeekday)
    );

    const targetPeriod =
      dayPeriods.find((p) => startedMin >= p.startMin && startedMin < p.endMin) || null;

    if (dayPeriods.length > 0 && !targetPeriod) {
      return NextResponse.json(
        {
          error: "session_slot_not_resolved",
          message:
            "Cette séance ne correspond à aucun créneau configuré. L’appel ne peut pas être démarré hors créneau.",
        },
        { status: 409 }
      );
    }

    const resolvedExpectedMinutes = Math.max(
      1,
      Math.floor(
        Number(
          expected_minutes_body ??
            targetPeriod?.durationMin ??
            defSessionMin ??
            60
        )
      )
    );

    let slotStartUTC: Date;
    let slotEndUTC: Date;

    if (targetPeriod) {
      slotStartUTC = zonedToUTC(
        localStarted.y,
        localStarted.mo,
        localStarted.da,
        Math.floor(targetPeriod.startMin / 60),
        targetPeriod.startMin % 60,
        0,
        tz
      );
      slotEndUTC = zonedToUTC(
        localStarted.y,
        localStarted.mo,
        localStarted.da,
        Math.floor(targetPeriod.endMin / 60),
        targetPeriod.endMin % 60,
        0,
        tz
      );
    } else {
      // fallback établissements sans créneaux configurés ce jour
      slotStartUTC = new Date(started_at_in);
      slotStartUTC.setUTCSeconds(0, 0);
      slotEndUTC = new Date(slotStartUTC.getTime() + resolvedExpectedMinutes * 60_000);
    }

    const started_at = slotStartUTC.toISOString();

    /* 6) verrou fenêtre réelle d’appel */
    if (targetPeriod) {
      const allowedStartMin = targetPeriod.startMin - ATTENDANCE_EARLY_ALLOWANCE_MIN;
      const allowedEndMin = targetPeriod.endMin + ATTENDANCE_AFTER_END_ALLOWANCE_MIN;
      const callDbWeekday = jsDayToDbWeekday(localCall.jsdow, weekdayMode);
      const sameDay = callDbWeekday === dbWeekday;
      const withinWindow = sameDay && callMin >= allowedStartMin && callMin <= allowedEndMin;

      if (!withinWindow) {
        const periodLabel =
          targetPeriod.label || `${minToHM(targetPeriod.startMin)}-${minToHM(targetPeriod.endMin)}`;

        return NextResponse.json(
          {
            error: "attendance_outside_allowed_window",
            message: `Démarrage refusé : appel hors fenêtre autorisée pour le créneau ${periodLabel}. Fenêtre admise : ${minToHM(
              allowedStartMin
            )} à ${minToHM(allowedEndMin)}.`,
            details: {
              slot_start: minToHM(targetPeriod.startMin),
              slot_end: minToHM(targetPeriod.endMin),
              allowed_start: minToHM(allowedStartMin),
              allowed_end: minToHM(allowedEndMin),
              actual_call_hm: localCall.hm,
            },
          },
          { status: 409 }
        );
      }
    }

    /* 7) autorisation : prof de la séance */
    // La route teacher/start est réservée au prof connecté, donc teacher_id = user.id.
    // On garde tout de même la cohérence avec la classe.
    const teacher_id = user.id;

    /* 8) réutiliser une séance existante sur ce créneau */
    const { data: sameSlot, error: slotErr } = await svc
      .from("teacher_sessions")
      .select("id, started_at, actual_call_at, created_at, ended_at, status, expected_minutes")
      .eq("institution_id", cls.institution_id)
      .eq("teacher_id", teacher_id)
      .gte("started_at", slotStartUTC.toISOString())
      .lt("started_at", slotEndUTC.toISOString());

    if (slotErr) {
      return NextResponse.json({ error: slotErr.message }, { status: 400 });
    }

    if (sameSlot && sameSlot.length) {
      const best = pickBestSession(sameSlot as any[]);
      const reuseSessionId = String(best.id);

      const patch: any = {
        class_id,
        subject_id: instSubjectId,
        started_at,
        expected_minutes: resolvedExpectedMinutes,
      };

      const existingCall = parseIsoDate(best.actual_call_at);
      const candidate = effectiveCallAt;
      const candidateOk =
        candidate.getTime() >= slotStartUTC.getTime() - 12 * 60 * 60_000 &&
        candidate.getTime() <= slotEndUTC.getTime() + 12 * 60 * 60_000;

      if (!existingCall) {
        patch.actual_call_at = effectiveCallAtISO;
      } else if (candidateOk && candidate.getTime() < existingCall.getTime() - 60_000) {
        patch.actual_call_at = effectiveCallAtISO;
      }

      const { error: upErr } = await svc
        .from("teacher_sessions")
        .update(patch)
        .eq("id", reuseSessionId);

      if (upErr) {
        console.error("[teacher/sessions/start] reuse update error", upErr);
      }

      const session = await fetchTeacherSessionFull(svc, reuseSessionId);
      if (!session) {
        return NextResponse.json(
          { error: "Échec de la récupération de la séance existante." },
          { status: 500 }
        );
      }

      const item = {
        id: session.id as string,
        class_id: session.class_id as string,
        class_label: (session.classes && (session.classes as any).label) || cls.label || "",
        subject_id:
          (session.institution_subjects && (session.institution_subjects as any).subject?.id) ||
          raw_subject_id,
        subject_name:
          (session.institution_subjects && (session.institution_subjects as any).subject?.name) ||
          null,
        started_at: session.started_at as string,
        actual_call_at: (session as any).actual_call_at as string | null,
        expected_minutes: session.expected_minutes as number | null,
      };

      return NextResponse.json({ item }, { status: 200 });
    }

    /* 9) créer la séance */
    const { data: session, error: insErr } = await svc
      .from("teacher_sessions")
      .insert({
        institution_id: cls.institution_id,
        class_id,
        subject_id: instSubjectId,
        teacher_id,
        created_by: user.id,
        started_at,
        expected_minutes: resolvedExpectedMinutes,
        actual_call_at: effectiveCallAtISO,
      })
      .select(
        `
        id,
        class_id,
        subject_id,
        started_at,
        actual_call_at,
        expected_minutes,
        classes!inner ( label ),
        institution_subjects!teacher_sessions_subject_id_fkey (
          id,
          subject:subjects ( id, name )
        )
      `
      )
      .maybeSingle();

    if (insErr || !session) {
      const pgCode = (insErr as any)?.code;
      const msg = (insErr as any)?.message || "";

      if (pgCode === "23503" && msg.includes("teacher_sessions_subject_id_fkey")) {
        return NextResponse.json(
          {
            error:
              "Impossible de démarrer la séance : la matière n’est pas liée aux disciplines de l’établissement.",
          },
          { status: 400 }
        );
      }

      if (pgCode === "23505") {
        const { data: retry, error: rErr } = await svc
          .from("teacher_sessions")
          .select("id, started_at, actual_call_at, created_at, ended_at, status")
          .eq("institution_id", cls.institution_id)
          .eq("teacher_id", teacher_id)
          .gte("started_at", slotStartUTC.toISOString())
          .lt("started_at", slotEndUTC.toISOString());

        if (!rErr && retry && retry.length) {
          const best = pickBestSession(retry as any[]);
          const s2 = await fetchTeacherSessionFull(svc, String(best.id));
          if (s2) {
            const item = {
              id: s2.id as string,
              class_id: s2.class_id as string,
              class_label: (s2.classes && (s2.classes as any).label) || cls.label || "",
              subject_id:
                (s2.institution_subjects && (s2.institution_subjects as any).subject?.id) ||
                raw_subject_id,
              subject_name:
                (s2.institution_subjects && (s2.institution_subjects as any).subject?.name) ||
                null,
              started_at: s2.started_at as string,
              actual_call_at: (s2 as any).actual_call_at as string | null,
              expected_minutes: s2.expected_minutes as number | null,
            };
            return NextResponse.json({ item }, { status: 200 });
          }
        }
      }

      console.error("[teacher/sessions/start] insert error", insErr);
      return NextResponse.json({ error: "Échec du démarrage de la séance." }, { status: 500 });
    }

    const item = {
      id: session.id as string,
      class_id: session.class_id as string,
      class_label: (session.classes && (session.classes as any).label) || cls.label || "",
      subject_id:
        (session.institution_subjects && (session.institution_subjects as any).subject?.id) ||
        raw_subject_id,
      subject_name:
        (session.institution_subjects && (session.institution_subjects as any).subject?.name) ||
        null,
      started_at: session.started_at as string,
      actual_call_at: (session as any).actual_call_at as string | null,
      expected_minutes: session.expected_minutes as number | null,
    };

    return NextResponse.json({ item }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/sessions/start] fatal error", e);
    return NextResponse.json(
      { error: "Erreur inattendue lors du démarrage de la séance." },
      { status: 500 }
    );
  }
}