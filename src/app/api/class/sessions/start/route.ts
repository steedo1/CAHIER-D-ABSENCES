// src/app/api/class/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  class_id: string;
  subject_id?: string | null; // requis pour attribuer le prof
  started_at?: string; // ISO optionnel (utilisé pour déterminer le créneau)
  expected_minutes?: number | null; // optionnel: null => Auto (établissement)
};

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

/** "HH:MM" local + weekday 0..6 pour un ISO donné dans un fuseau */
function localHMAndWeekday(iso: string, tz: string) {
  const d = new Date(iso);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d); // "HH:MM"
  const wdStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
    .toLowerCase(); // "sun".."sat"
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return { hm, weekday: map[wdStr] ?? 0 };
}

/**
 * ⚠️ Construire une Date UTC correspondant à une "heure murale" (YYYY-MM-DD HH:MM) dans un tz.
 * (sans librairie externe)
 */
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

  // 1) guess : on traite l'heure locale comme UTC
  let guessUTC = new Date(Date.UTC(Y, M - 1, D, h, m, 0, 0));
  // 2) offset réel au moment "guess"
  let off = tzOffsetMinutes(guessUTC, tz);
  let realUTC = new Date(guessUTC.getTime() - off * 60_000);

  // 3) petite correction si DST / changement offset
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
  }).format(d); // "YYYY-MM-DD"
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    // Auth
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Payload
    const b = (await req.json().catch(() => ({}))) as Body;
    const class_id = String(b?.class_id ?? "").trim();
    const subject_id =
      b?.subject_id && String(b.subject_id).trim() ? String(b.subject_id).trim() : null;

    if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    if (!subject_id)
      return NextResponse.json({ error: "subject_id_required" }, { status: 400 });

    // Timestamp fourni (sert à déterminer le créneau) — fallback: maintenant
    const startedAtRaw = b?.started_at ? new Date(b.started_at) : new Date();
    const startedAt = isNaN(startedAtRaw.getTime()) ? new Date() : startedAtRaw;

    // Heure réelle du clic (serveur)
    const clickNow = new Date();

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
    if (!phone) return NextResponse.json({ error: "no_phone" }, { status: 400 });

    const { variants, likePatterns } = buildPhoneVariants(phone);

    // Classe + contrôle téléphone (compte-classe)
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,institution_id,class_phone_e164")
      .eq("id", class_id)
      .maybeSingle();
    if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
    if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

    let match = false;
    if (cls.class_phone_e164 && variants.includes(String(cls.class_phone_e164))) match = true;
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
    if (!match)
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });

    // Résoudre le VRAI teacher_id via class_teachers
    const { data: aff, error: affErr } = await srv
      .from("class_teachers")
      .select("teacher_id")
      .eq("class_id", class_id)
      .eq("subject_id", subject_id);
    if (affErr) return NextResponse.json({ error: affErr.message }, { status: 400 });

    const uniqTeachers = uniq<string>((aff || []).map((a) => String(a.teacher_id)).filter(Boolean));
    if (uniqTeachers.length === 0)
      return NextResponse.json({ error: "no_teacher_for_subject" }, { status: 400 });
    if (uniqTeachers.length > 1)
      return NextResponse.json({ error: "ambiguous_teacher_for_subject" }, { status: 400 });
    const teacher_id = uniqTeachers[0]!;

    // Paramètres établissement
    const { data: inst, error: iErr } = await srv
      .from("institutions")
      .select("tz, default_session_minutes")
      .eq("id", cls.institution_id)
      .maybeSingle();
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });

    const tz = String(inst?.tz || "Africa/Abidjan");
    const defSessionMin =
      Number.isFinite(Number(inst?.default_session_minutes)) &&
      Number(inst?.default_session_minutes) > 0
        ? Math.floor(Number(inst!.default_session_minutes as number))
        : 60;

    // Déterminer le créneau institutionnel (weekday + heure locale)
    const { hm: startedHM, weekday } = localHMAndWeekday(startedAt.toISOString(), tz);
    const callMin = hmToMin(startedHM);

    const { data: periods, error: pErr } = await srv
      .from("institution_periods")
      .select("id, weekday, period_no, label, start_time, end_time, duration_min")
      .eq("institution_id", cls.institution_id)
      .eq("weekday", weekday)
      .order("period_no", { ascending: true });
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

    let periodDuration: number | null = null;
    let currentPeriod: { startMin: number; endMin: number } | null = null;

    if (Array.isArray(periods) && periods.length) {
      const expanded = periods.map((p: any) => {
        const s = hmsToMin(p.start_time);
        const e = hmsToMin(p.end_time);
        const duration =
          typeof p.duration_min === "number" && p.duration_min > 0
            ? Math.floor(p.duration_min)
            : Math.max(1, e - s);
        return { startMin: s, endMin: e, durationMin: duration };
      });

      const cur =
        expanded.find((p) => callMin >= p.startMin && callMin < p.endMin) ??
        [...expanded].reverse().find((p) => callMin >= p.startMin) ??
        null;

      if (cur) {
        currentPeriod = { startMin: cur.startMin, endMin: cur.endMin };
        periodDuration = cur.durationMin ?? null;
      }
    }

    // expected_minutes : priorité à la valeur fournie ; null => Auto ; sinon calcul établissement
    let expected_minutes: number | null;
    if (b?.expected_minutes === null) {
      expected_minutes = null; // Auto (établissement)
    } else if (Number.isFinite(Number(b?.expected_minutes))) {
      expected_minutes = Math.max(1, Math.floor(Number(b!.expected_minutes)));
    } else {
      expected_minutes = periodDuration ?? defSessionMin;
    }

    // ✅ ANCRAGE DU CRÉNEAU : started_at = début du créneau (sinon doublons possibles)
    let slotStartedAt: Date;
    if (currentPeriod) {
      const ymd = ymdInTZ(startedAt, tz);
      const hh = Math.floor(currentPeriod.startMin / 60);
      const mm = currentPeriod.startMin % 60;
      slotStartedAt = dateInTZFromYMDHM(ymd, `${pad2(hh)}:${pad2(mm)}`, tz);
    } else {
      // fallback : minute exacte
      slotStartedAt = new Date(startedAt);
      slotStartedAt.setUTCSeconds(0, 0);
    }
    const slotStartedISO = slotStartedAt.toISOString();
    const clickISO = clickNow.toISOString();

    // Libellé matière (optionnel pour l’UI)
    let subject_name: string | null = null;
    {
      const { data: subj } = await srv
        .from("institution_subjects")
        .select("custom_name,subjects:subject_id(name)")
        .eq("id", subject_id)
        .maybeSingle();
      subject_name = (subj as any)?.custom_name ?? (subj as any)?.subjects?.name ?? null;
    }

    /**
     * ✅ UPSERT anti-doublon : 1 séance max par (institution_id, teacher_id, started_at)
     * Nécessite l’index unique : teacher_sessions_one_per_slot(institution_id, teacher_id, started_at)
     */
    let session:
      | {
          id: string;
          started_at: string;
          expected_minutes: number | null;
          actual_call_at: string | null;
          class_id: string | null;
          subject_id: string | null;
        }
      | null = null;

    const upPayload = {
      institution_id: cls.institution_id,
      teacher_id,
      // on garde class/subject pour l’UI (mais la contrainte de vérité = créneau prof)
      class_id,
      subject_id,
      started_at: slotStartedISO,
      actual_call_at: clickISO,
      expected_minutes,
      status: "open",
      created_by: user.id, // compte-classe
    };

    // 1) Tenter un UPSERT "insert or ignore"
    const { data: up, error: upErr } = await srv
      .from("teacher_sessions")
      .upsert(upPayload as any, {
        onConflict: "institution_id,teacher_id,started_at",
        ignoreDuplicates: true, // 🔥 on ne remplace pas la 1ère séance du créneau
      })
      .select("id,started_at,expected_minutes,actual_call_at,class_id,subject_id")
      .maybeSingle();

    if (upErr && !String(upErr.message || "").toLowerCase().includes("duplicate")) {
      // si c’est autre chose qu’un conflit, on remonte
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }
    if (up) session = up as any;

    // 2) Si conflit (ou ignoreDuplicates), on récupère la séance existante (et on choisit la meilleure si doublons historiques)
    if (!session) {
      const { data: rows, error: selErr } = await srv
        .from("teacher_sessions")
        .select("id,started_at,expected_minutes,actual_call_at,class_id,subject_id,created_at")
        .eq("institution_id", cls.institution_id)
        .eq("teacher_id", teacher_id)
        .eq("started_at", slotStartedISO)
        .order("actual_call_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(1);

      if (selErr) return NextResponse.json({ error: selErr.message }, { status: 400 });
      session = (rows as any[])?.[0] ?? null;
    }

    // 3) Sécurité : si la séance existante n’avait pas actual_call_at / expected_minutes, on complète (sans casser le “1 seul créneau”)
    if (session && (!session.actual_call_at || session.expected_minutes == null)) {
      const patch: any = {};
      if (!session.actual_call_at) patch.actual_call_at = clickISO;
      if (session.expected_minutes == null && expected_minutes != null)
        patch.expected_minutes = expected_minutes;
      if (!session.subject_id && subject_id) patch.subject_id = subject_id;
      if (!session.class_id && class_id) patch.class_id = class_id;

      if (Object.keys(patch).length) {
        const { data: upd, error: updErr } = await srv
          .from("teacher_sessions")
          .update(patch)
          .eq("id", session.id)
          .select("id,started_at,expected_minutes,actual_call_at,class_id,subject_id")
          .maybeSingle();
        if (!updErr && upd) session = upd as any;
      }
    }

    if (!session) {
      return NextResponse.json({ error: "start_failed_no_session" }, { status: 400 });
    }

    return NextResponse.json({
      item: {
        id: session.id,
        class_id, // on renvoie la classe appelante (UI compte-classe)
        class_label: cls.label as string,
        subject_id,
        subject_name,
        started_at: session.started_at, // début de créneau (canonique)
        expected_minutes: session.expected_minutes ?? expected_minutes ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "start_failed" }, { status: 400 });
  }
}
