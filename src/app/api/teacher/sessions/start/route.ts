// src/app/api/teacher/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Body = {
  class_id: string;
  subject_id?: string | null;        // optionnel (peut être null)
  started_at?: string;               // ISO optionnel (proposé par l'UI)
  expected_minutes?: number | null;  // optionnel : null => Auto (établissement)
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── helpers horaires (sans lib externe) ───────── */
function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
/** Retourne "HH:MM" local + weekday 0..6 pour un ISO donné dans un fuseau */
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
  }).format(d).toLowerCase(); // "sun".."sat"
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return { hm, weekday: map[wdStr] ?? 0 };
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();   // client (RLS)
    const srv  = getSupabaseServiceClient();        // service (no RLS)

    // 1) Auth
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // 2) Payload
    const b = (await req.json().catch(() => ({}))) as Body;

    const class_id = String(b?.class_id ?? "").trim();
    const subject_id =
      b?.subject_id && String(b.subject_id).trim() ? String(b.subject_id).trim() : null;

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }

    // Heure proposée par l’UI (créneau) sinon maintenant
    const startedAtRaw = b?.started_at ? new Date(b.started_at) : new Date();
    const startedAt = isNaN(startedAtRaw.getTime()) ? new Date() : startedAtRaw;

    // Heure réelle du clic (référence d'appel)
    const clickNow = new Date();

    // 3) Établissement du prof
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

    const institution_id = (me?.institution_id as string) || null;
    if (!institution_id) {
      return NextResponse.json({ error: "no_institution" }, { status: 400 });
    }

    // 4) Vérifier que la classe appartient à cet établissement
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id,label")
      .eq("id", class_id)
      .maybeSingle();
    if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
    if (!cls || cls.institution_id !== institution_id) {
      return NextResponse.json({ error: "invalid_class" }, { status: 400 });
    }

    // 5) Paramètres & créneaux de l’établissement
    const { data: inst, error: iErr } = await srv
      .from("institutions")
      .select("tz, default_session_minutes")
      .eq("id", institution_id)
      .maybeSingle();
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });

    const tz = String(inst?.tz || "Africa/Abidjan");
    const defSessionMin =
      Number.isFinite(Number(inst?.default_session_minutes)) &&
      Number(inst?.default_session_minutes) > 0
        ? Math.floor(Number(inst?.default_session_minutes))
        : 60;

    const { hm: startedHM, weekday } = localHMAndWeekday(startedAt.toISOString(), tz);
    const callMin = hmToMin(startedHM);

    const { data: periods, error: pErr } = await srv
      .from("institution_periods")
      .select("id, weekday, period_no, label, start_time, end_time, duration_min")
      .eq("institution_id", institution_id)
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
        expanded.find((p: any) => callMin >= p.startMin && callMin < p.endMin) ??
        [...expanded].reverse().find((p: any) => callMin >= p.startMin) ??
        null;
      periodDuration = cur?.durationMin ?? null;
    }

    // 6) expected_minutes : priorité à la valeur fournie ; null => Auto ; sinon calcul établissement
    let expected_minutes: number | null;
    if (b?.expected_minutes === null) {
      expected_minutes = null; // Auto (établissement)
    } else if (Number.isFinite(Number(b?.expected_minutes))) {
      expected_minutes = Math.max(1, Math.floor(Number(b!.expected_minutes)));
    } else {
      expected_minutes = periodDuration ?? defSessionMin; // calcul par créneau ou fallback
    }

    // 7) Insertion séance
    const insertRow = {
      institution_id,
      teacher_id: user.id,
      class_id,
      subject_id, // nullable
      started_at: startedAt.toISOString(),     // utilisé pour tri/affichage ; le calcul de retard se base sur les créneaux
      actual_call_at: clickNow.toISOString(),  // heure réelle du clic
      expected_minutes,                        // peut être null (auto)
      status: "open" as const,
      created_by: user.id,
    };

    const { data: inserted, error: insErr } = await srv
      .from("teacher_sessions")
      .insert(insertRow)
      .select("id,class_id,subject_id,started_at,expected_minutes")
      .maybeSingle();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    // 8) Enrichissement (pour l’UI)
    const class_label = cls.label ?? null;
    let subject_name: string | null = null;
    if (inserted?.subject_id) {
      const { data: subj } = await srv
        .from("institution_subjects")
        .select("custom_name, subjects:subject_id(name)")
        .eq("id", inserted.subject_id)
        .maybeSingle();
      subject_name = (subj as any)?.custom_name ?? (subj as any)?.subjects?.name ?? null;
    }

    return NextResponse.json({
      item: {
        id: inserted!.id as string,
        class_id: inserted!.class_id as string,
        class_label,
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
