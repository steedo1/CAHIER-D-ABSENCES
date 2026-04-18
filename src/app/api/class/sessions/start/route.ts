// src/app/api/class/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  class_id: string;
  subject_id?: string | null; // institution_subjects.id
  started_at?: string;
  expected_minutes?: number | null;
  actual_call_at?: string | null;
};

type WeekdayMode = "iso" | "js" | "mon0";

type ResolvedPeriod = {
  id?: string | null;
  label?: string | null;
  weekday: number;
  period_no?: number | null;
  startMin: number;
  endMin: number;
  durationMin: number;
};

function envInt(name: string, fallback: number, min = 0) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.floor(raw));
}

const CLIENT_CALL_MAX_FUTURE_MIN = envInt("ATTENDANCE_CLIENT_CALL_MAX_FUTURE_MIN", 5, 0);
const CLIENT_CALL_MAX_AGE_DAYS = envInt("ATTENDANCE_CLIENT_CALL_MAX_AGE_DAYS", 7, 1);

/* ───────── utils ───────── */
function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

type PhoneVariants = { variants: string[]; likePatterns: string[] };

function buildPhoneVariants(raw: string): PhoneVariants {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";

  const variants = uniq<string>([
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
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
  ]);

  return { variants, likePatterns };
}

/* ───────── helpers horaires ───────── */
function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function minToHM(min: number) {
  const safe = Math.max(0, Math.floor(min));
  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** "HH:MM" local + weekday 0..6 pour un ISO donné dans un fuseau */
function localHMAndJsWeekday(iso: string, tz: string) {
  const d = new Date(iso);

  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  const wdStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
    .toLowerCase();

  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return { hm, jsdow: map[wdStr] ?? 0 };
}

function tzOffsetMinutes(atUTC: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(atUTC);

  const y = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  const mo = parseInt(parts.find((p) => p.type === "month")?.value || "1", 10);
  const d = parseInt(parts.find((p) => p.type === "day")?.value || "1", 10);
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  const wallAsUTC = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);
  return Math.round((wallAsUTC - atUTC.getTime()) / 60000);
}

function dateInTZFromYMDHM(ymd: string, hm: string, tz: string) {
  const [Y, M, D] = ymd.split("-").map((x) => parseInt(x, 10));
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));

  let guessUTC = new Date(Date.UTC(Y, M - 1, D, h, m, 0, 0));
  const off = tzOffsetMinutes(guessUTC, tz);
  let realUTC = new Date(guessUTC.getTime() - off * 60_000);

  const off2 = tzOffsetMinutes(realUTC, tz);
  if (off2 !== off) realUTC = new Date(guessUTC.getTime() - off2 * 60_000);

  return realUTC;
}

function ymdInTZ(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseIsoDate(v: any): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
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
  return (jsDay0to6 + 6) % 7;
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

async function fetchClassSessionFull(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  id: string
) {
  const { data, error } = await srv
    .from("teacher_sessions")
    .select(
      `
      id,
      class_id,
      subject_id,
      started_at,
      actual_call_at,
      expected_minutes,
      day_ci,
      slot_ci,
      classes!inner ( label ),
      institution_subjects!teacher_sessions_subject_id_fkey (
        id,
        custom_name,
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
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const b = (await req.json().catch(() => ({}))) as Body;
    const class_id = String(b?.class_id ?? "").trim();
    const subject_id =
      b?.subject_id && String(b.subject_id).trim() ? String(b.subject_id).trim() : null;

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }
    if (!subject_id) {
      return NextResponse.json({ error: "subject_id_required" }, { status: 400 });
    }

    const startedAtRaw = b?.started_at ? new Date(b.started_at) : new Date();
    const startedAt = isNaN(startedAtRaw.getTime()) ? new Date() : startedAtRaw;
    const started_at_in = startedAt.toISOString();

    const nowISO = new Date().toISOString();
    const effectiveCallAtISO = pickEffectiveCallAt(b, started_at_in, nowISO);
    const effectiveCallAt = new Date(effectiveCallAtISO);

    // Téléphone (auth)
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

    if (!phone) {
      return NextResponse.json({ error: "no_phone" }, { status: 400 });
    }

    const { variants, likePatterns } = buildPhoneVariants(phone);

    // Classe + contrôle téléphone
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,institution_id,class_phone_e164")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }
    if (!cls) {
      return NextResponse.json({ error: "class_not_found" }, { status: 404 });
    }

    let match = false;
    if (cls.class_phone_e164 && variants.includes(String(cls.class_phone_e164))) {
      match = true;
    }

    if (!match && likePatterns.length) {
      const stored = String(cls.class_phone_e164 || "");
      match = likePatterns.some((p) => {
        const pat = String(p).replace(/%/g, ".*");
        try {
          return new RegExp(pat).test(stored);
        } catch {
          return false;
        }
      });
    }

    if (!match) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    // Résoudre le teacher_id via class_teachers
    const { data: aff, error: affErr } = await srv
      .from("class_teachers")
      .select("teacher_id")
      .eq("class_id", class_id)
      .eq("subject_id", subject_id);

    if (affErr) {
      return NextResponse.json({ error: affErr.message }, { status: 400 });
    }

    const uniqTeachers = uniq<string>(
      (aff || []).map((a) => String(a.teacher_id)).filter(Boolean)
    );

    if (uniqTeachers.length === 0) {
      return NextResponse.json({ error: "no_teacher_for_subject" }, { status: 400 });
    }
    if (uniqTeachers.length > 1) {
      return NextResponse.json({ error: "ambiguous_teacher_for_subject" }, { status: 400 });
    }

    const teacher_id = uniqTeachers[0]!;

    // Paramètres établissement
    const { data: inst, error: iErr } = await srv
      .from("institutions")
      .select("tz, default_session_minutes")
      .eq("id", cls.institution_id)
      .maybeSingle();

    if (iErr) {
      return NextResponse.json({ error: iErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");
    const defSessionMin =
      Number.isFinite(Number(inst?.default_session_minutes)) &&
      Number(inst?.default_session_minutes) > 0
        ? Math.floor(Number(inst!.default_session_minutes as number))
        : 60;

    // Fenêtre réelle du clic -> sert à déterminer le créneau métier
    const localCall = localHMAndJsWeekday(effectiveCallAtISO, tz);
    const callMin = hmToMin(localCall.hm);

    const { data: allPeriods, error: pErr } = await srv
      .from("institution_periods")
      .select("id, weekday, period_no, label, start_time, end_time, duration_min")
      .eq("institution_id", cls.institution_id)
      .order("weekday", { ascending: true })
      .order("period_no", { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }

    const weekdayMode = detectWeekdayMode(allPeriods || []);
    const dbWeekday = jsDayToDbWeekday(localCall.jsdow, weekdayMode);

    const dayPeriods = buildResolvedPeriods(
      (allPeriods || []).filter((p: any) => Number(p.weekday) === dbWeekday)
    );

    // RÈGLE MÉTIER STRICTE :
    // le clic doit être DANS le créneau : start <= actual_call_at < end
    const targetPeriod =
      dayPeriods.find((p) => callMin >= p.startMin && callMin < p.endMin) || null;

    if (dayPeriods.length > 0 && !targetPeriod) {
      const allSlotsLabel = dayPeriods
        .map((p) => `${minToHM(p.startMin)}–${minToHM(p.endMin)}`)
        .join(", ");

      return NextResponse.json(
        {
          error: "attendance_outside_slot",
          message:
            "Démarrage refusé : l’appel doit être effectué strictement dans un créneau configuré.",
          details: {
            actual_call_hm: localCall.hm,
            weekday: dbWeekday,
            configured_slots: allSlotsLabel,
          },
        },
        { status: 409 }
      );
    }

    let expected_minutes: number;
    let slotStartedAt: Date;
    let slotEndedAt: Date;
    let day_ci: string;
    let slot_ci: string;

    if (targetPeriod) {
      const ymd = ymdInTZ(effectiveCallAt, tz);

      slotStartedAt = dateInTZFromYMDHM(
        ymd,
        `${pad2(Math.floor(targetPeriod.startMin / 60))}:${pad2(targetPeriod.startMin % 60)}`,
        tz
      );

      slotEndedAt = dateInTZFromYMDHM(
        ymd,
        `${pad2(Math.floor(targetPeriod.endMin / 60))}:${pad2(targetPeriod.endMin % 60)}`,
        tz
      );

      expected_minutes = targetPeriod.durationMin;
      day_ci = ymd;
      slot_ci = `${ymd} ${pad2(Math.floor(targetPeriod.startMin / 60))}:${pad2(
        targetPeriod.startMin % 60
      )}:00`;
    } else {
      // Fallback si aucun créneau n'est configuré ce jour-là
      expected_minutes =
        Number.isFinite(Number(b?.expected_minutes)) && Number(b?.expected_minutes) > 0
          ? Math.max(1, Math.floor(Number(b!.expected_minutes)))
          : defSessionMin;

      slotStartedAt = new Date(startedAt);
      slotStartedAt.setUTCSeconds(0, 0);
      slotEndedAt = new Date(slotStartedAt.getTime() + expected_minutes * 60_000);

      day_ci = ymdInTZ(slotStartedAt, tz);
      slot_ci = `${day_ci} ${minToHM(
        hmToMin(localHMAndJsWeekday(slotStartedAt.toISOString(), tz).hm)
      )}:00`;
    }

    const slotStartedISO = slotStartedAt.toISOString();
    const slotEndedISO = slotEndedAt.toISOString();

    // Libellé matière
    let subject_name: string | null = null;
    {
      const { data: subj } = await srv
        .from("institution_subjects")
        .select("custom_name,subjects:subject_id(name)")
        .eq("id", subject_id)
        .maybeSingle();

      subject_name = (subj as any)?.custom_name ?? (subj as any)?.subjects?.name ?? null;
    }

    // Idempotence : réutiliser la séance du même prof sur le même créneau canonique
    const { data: sameSlot, error: sameSlotErr } = await srv
      .from("teacher_sessions")
      .select(
        "id, started_at, actual_call_at, created_at, ended_at, status, expected_minutes, day_ci, slot_ci"
      )
      .eq("institution_id", cls.institution_id)
      .eq("teacher_id", teacher_id)
      .eq("day_ci", day_ci)
      .eq("slot_ci", slot_ci);

    if (sameSlotErr) {
      return NextResponse.json({ error: sameSlotErr.message }, { status: 400 });
    }

    if (sameSlot && sameSlot.length) {
      const best = pickBestSession(sameSlot as any[]);
      const reuseSessionId = String(best.id);

      const patch: any = {
        class_id,
        subject_id,
        started_at: slotStartedISO,
        expected_minutes,
        day_ci,
        slot_ci,
        origin: "class_device",
      };

      const existingCall = parseIsoDate(best.actual_call_at);
      const candidate = effectiveCallAt;

      const candidateOk =
        candidate.getTime() >= slotStartedAt.getTime() &&
        candidate.getTime() < slotEndedAt.getTime();

      if (!existingCall) {
        patch.actual_call_at = effectiveCallAtISO;
      } else if (candidateOk && candidate.getTime() < existingCall.getTime() - 60_000) {
        patch.actual_call_at = effectiveCallAtISO;
      }

      const { error: upErr } = await srv
        .from("teacher_sessions")
        .update(patch)
        .eq("id", reuseSessionId);

      if (upErr) {
        console.error("[class/sessions/start] reuse update error", upErr);
      }

      const session = await fetchClassSessionFull(srv, reuseSessionId);
      if (!session) {
        return NextResponse.json(
          { error: "Échec de la récupération de la séance existante." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        item: {
          id: session.id as string,
          class_id: session.class_id as string,
          class_label: (session.classes && (session.classes as any).label) || cls.label || "",
          subject_id,
          subject_name:
            (session.institution_subjects && (session.institution_subjects as any).custom_name) ||
            (session.institution_subjects && (session.institution_subjects as any).subject?.name) ||
            subject_name,
          started_at: session.started_at as string,
          actual_call_at: (session as any).actual_call_at as string | null,
          expected_minutes: session.expected_minutes as number | null,
        },
      });
    }

    // Création
    const insertPayload: any = {
      institution_id: cls.institution_id,
      teacher_id,
      class_id,
      subject_id,
      started_at: slotStartedISO,
      actual_call_at: effectiveCallAtISO,
      expected_minutes,
      status: "open",
      created_by: user.id,
      origin: "class_device",
      day_ci,
      slot_ci,
    };

    const { data: inserted, error: insertErr } = await srv
      .from("teacher_sessions")
      .insert(insertPayload)
      .select(
        `
        id,
        class_id,
        subject_id,
        started_at,
        actual_call_at,
        expected_minutes,
        day_ci,
        slot_ci,
        classes!inner ( label ),
        institution_subjects!teacher_sessions_subject_id_fkey (
          id,
          custom_name,
          subject:subjects ( id, name )
        )
      `
      )
      .maybeSingle();

    if (insertErr || !inserted) {
      const pgCode = (insertErr as any)?.code;

      if (pgCode === "23505") {
        const { data: retry, error: rErr } = await srv
          .from("teacher_sessions")
          .select("id, started_at, actual_call_at, created_at, ended_at, status, day_ci, slot_ci")
          .eq("institution_id", cls.institution_id)
          .eq("teacher_id", teacher_id)
          .eq("day_ci", day_ci)
          .eq("slot_ci", slot_ci);

        if (!rErr && retry && retry.length) {
          const best = pickBestSession(retry as any[]);
          const s2 = await fetchClassSessionFull(srv, String(best.id));
          if (s2) {
            return NextResponse.json({
              item: {
                id: s2.id as string,
                class_id: s2.class_id as string,
                class_label: (s2.classes && (s2.classes as any).label) || cls.label || "",
                subject_id,
                subject_name:
                  (s2.institution_subjects && (s2.institution_subjects as any).custom_name) ||
                  (s2.institution_subjects && (s2.institution_subjects as any).subject?.name) ||
                  subject_name,
                started_at: s2.started_at as string,
                actual_call_at: (s2 as any).actual_call_at as string | null,
                expected_minutes: s2.expected_minutes as number | null,
              },
            });
          }
        }
      }

      return NextResponse.json(
        { error: (insertErr as any)?.message || "start_failed" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      item: {
        id: inserted.id as string,
        class_id: inserted.class_id as string,
        class_label: (inserted.classes && (inserted.classes as any).label) || cls.label || "",
        subject_id,
        subject_name:
          (inserted.institution_subjects &&
            (inserted.institution_subjects as any).custom_name) ||
          (inserted.institution_subjects &&
            (inserted.institution_subjects as any).subject?.name) ||
          subject_name,
        started_at: inserted.started_at as string,
        actual_call_at: (inserted as any).actual_call_at as string | null,
        expected_minutes: inserted.expected_minutes as number | null,
      },
    });
  } catch (e: any) {
    console.error("[class/sessions/start] fatal error", e);
    return NextResponse.json(
      { error: e?.message || "start_failed" },
      { status: 400 }
    );
  }
}