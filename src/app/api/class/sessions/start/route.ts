// src/app/api/class/sessions/start/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  class_id: string;
  subject_id?: string | null;        // requis pour attribuer le prof
  started_at?: string;               // ISO optionnel (utilisé pour le créneau)
  expected_minutes?: number | null;  // optionnel: null => Auto (établissement)
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

export async function POST(req: Request) {
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

    // Horodatage de début (créneau) — on conserve la valeur UI si fournie
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

    // Paramètres & créneaux de l’établissement
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
    if (Array.isArray(periods) && periods.length) {
      const expanded = periods.map((p: any) => ({
        startMin: hmsToMin(p.start_time),
        endMin: hmsToMin(p.end_time),
        durationMin:
          typeof p.duration_min === "number" && p.duration_min > 0
            ? Math.floor(p.duration_min)
            : Math.max(1, hmsToMin(p.end_time) - hmsToMin(p.start_time)),
      }));
      const cur =
        expanded.find((p) => callMin >= p.startMin && callMin < p.endMin) ??
        [...expanded].reverse().find((p) => callMin >= p.startMin) ??
        null;
      periodDuration = cur?.durationMin ?? null;
    }

    // expected_minutes : priorité à la valeur fournie ; null => Auto ; sinon calcul établissement
    let expected_minutes: number | null;
    if (b?.expected_minutes === null) {
      expected_minutes = null; // Auto (établissement)
    } else if (Number.isFinite(Number(b?.expected_minutes))) {
      expected_minutes = Math.max(1, Math.floor(Number(b!.expected_minutes)));
    } else {
      expected_minutes = periodDuration ?? defSessionMin; // par créneau ou fallback
    }

    // Insertion séance
    const { data: inserted, error: insErr } = await srv
      .from("teacher_sessions")
      .insert({
        institution_id: cls.institution_id,
        teacher_id, // vrai prof
        class_id,
        subject_id,
        started_at: startedAt.toISOString(), // sert au créneau
        actual_call_at: clickNow.toISOString(), // heure réelle du clic
        expected_minutes, // peut être null (auto)
        status: "open",
        created_by: user.id, // qui a déclenché (compte-classe)
      })
      .select("id,class_id,subject_id,started_at,expected_minutes")
      .maybeSingle();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    // Libellé matière (optionnel pour l’UI)
    let subject_name: string | null = null;
    if (subject_id) {
      const { data: subj } = await srv
        .from("institution_subjects")
        .select("custom_name,subjects:subject_id(name)")
        .eq("id", subject_id)
        .maybeSingle();
      subject_name = (subj as any)?.custom_name ?? (subj as any)?.subjects?.name ?? null;
    }

    return NextResponse.json({
      item: {
        id: inserted!.id as string,
        class_id: inserted!.class_id as string,
        class_label: cls.label as string,
        subject_id: (inserted!.subject_id as string) ?? null,
        subject_name,
        started_at: inserted!.started_at as string,
        expected_minutes: (inserted!.expected_minutes as number | null) ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "start_failed" }, { status: 400 });
  }
}
