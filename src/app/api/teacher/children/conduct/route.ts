// src/app/api/teacher/children/conduct/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUBRIC_MAX = { assiduite: 6, tenue: 3, moralite: 4, discipline: 7 } as const;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

function appreciationFromTotal(total: number): string {
  if (total <= 5) return "Blâme";
  if (total < 8) return "Mauvaise conduite";
  if (total < 10) return "Conduite médiocre";
  if (total < 12) return "Conduite passable";
  if (total < 16) return "Bonne conduite";
  if (total < 18) return "Très bonne conduite";
  return "Excellente conduite";
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const student_id = String(searchParams.get("student_id") || "");
  const from = searchParams.get("from") || "";
  const to   = searchParams.get("to")   || "";
  if (!student_id) return NextResponse.json({ error: "student_id_required" }, { status: 400 });

  // 🔐 Le compte connecté doit être tuteur de l’élève
  const { data: link, error: guardErr } = await srv
    .from("student_guardians")
    .select("institution_id")
    .eq("student_id", student_id)
    .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();

  if (guardErr) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const institution_id = (link as any)?.institution_id as string | undefined;
  if (!institution_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Absences en minutes (vue v_mark_minutes)
  const { data: absRows } = await srv
    .from("v_mark_minutes")
    .select("minutes, started_at")
    .eq("institution_id", institution_id)
    .eq("student_id", student_id)
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  // Retards en minutes (vue v_tardy_minutes — facultative)
  let tardyRows: Array<{ minutes: number; started_at: string }> = [];
  try {
    const { data: tRows } = await srv
      .from("v_tardy_minutes")
      .select("minutes, started_at")
      .eq("institution_id", institution_id)
      .eq("student_id", student_id)
      .gte("started_at", startISO(from))
      .lte("started_at", endISO(to));
    if (Array.isArray(tRows)) tardyRows = tRows as any[];
  } catch {
    // si la vue n'existe pas encore, on ignore
  }

  const absence_minutes = (absRows || []).reduce((a, r: any) => a + Number(r?.minutes || 0), 0);
  const tardy_minutes   = (tardyRows || []).reduce((a, r: any) => a + Number(r?.minutes || 0), 0);
  const minutes_total   = absence_minutes + tardy_minutes;
  const hours           = minutes_total / 60;

  // Évènements de conduite (barème identique à la route parent)
  type Ev = {
    rubric: "assiduite" | "tenue" | "moralite" | "discipline";
    event_type:
      | "uniform_warning"
      | "cheating"
      | "alcohol_or_drug"
      | "discipline_warning"
      | "discipline_offense"
      | "discipline_council";
    occurred_at: string;
  };
  let events: Ev[] = [];
  {
    let q = srv.from("conduct_events")
      .select("rubric,event_type,occurred_at")
      .eq("institution_id", institution_id)
      .eq("student_id", student_id);
    if (from) q = q.gte("occurred_at", from);
    if (to)   q = q.lte("occurred_at", to);
    const { data: ev } = await q;
    events = (ev || []) as Ev[];
    events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

  // Pénalités libres (soustraction)
  type Pen = { rubric: "tenue" | "moralite" | "discipline"; points: number; occurred_at: string };
  let penalties: Pen[] = [];
  {
    let q = srv.from("conduct_penalties")
      .select("rubric,points,occurred_at")
      .eq("institution_id", institution_id)
      .eq("student_id", student_id);
    if (from) q = q.gte("occurred_at", from);
    if (to)   q = q.lte("occurred_at", to);
    const { data: pen } = await q;
    const raw = (pen || []) as Array<{ rubric: string; points: number; occurred_at: string }>;
    penalties = raw
      .filter((p) => p.rubric === "tenue" || p.rubric === "moralite" || p.rubric === "discipline")
      .map((p) => ({ rubric: p.rubric as Pen["rubric"], points: Number(p.points || 0), occurred_at: p.occurred_at }));
  }

  // Calcul barème (identique à /api/parent/children/conduct)
  let assiduite = hours > 10 ? 0 : clamp(RUBRIC_MAX.assiduite - 0.5 * hours, 0, RUBRIC_MAX.assiduite);

  const tenueWarn = events.filter((e) => e.event_type === "uniform_warning").length;
  let tenue = clamp(RUBRIC_MAX.tenue - 0.5 * tenueWarn, 0, RUBRIC_MAX.tenue);

  const moralN = events.filter((e) => e.event_type === "cheating" || e.event_type === "alcohol_or_drug").length;
  let moralite = clamp(RUBRIC_MAX.moralite - 1 * moralN, 0, RUBRIC_MAX.moralite);

  const firstWarn = events.find((e) => e.event_type === "discipline_warning");
  let discN = 0;
  if (firstWarn) {
    discN = events.filter(
      (e) => e.event_type === "discipline_offense" && e.occurred_at >= firstWarn.occurred_at,
    ).length;
  }
  let discipline = clamp(RUBRIC_MAX.discipline - 1 * discN, 0, RUBRIC_MAX.discipline);

  const p = penalties.reduce(
    (acc, x) => ({ ...acc, [x.rubric]: (acc as any)[x.rubric] + x.points }),
    { tenue: 0, moralite: 0, discipline: 0 } as any,
  );
  tenue      = clamp(tenue      - (p.tenue || 0),      0, RUBRIC_MAX.tenue);
  moralite   = clamp(moralite   - (p.moralite || 0),   0, RUBRIC_MAX.moralite);
  discipline = clamp(discipline - (p.discipline || 0), 0, RUBRIC_MAX.discipline);

  let total = assiduite + tenue + moralite + discipline;
  const hasCouncil = events.some((e) => e.event_type === "discipline_council");
  if (hasCouncil) total = Math.min(total, 5);

  const appreciation = appreciationFromTotal(total);

  return NextResponse.json({
    breakdown: {
      assiduite: Number(assiduite.toFixed(2)),
      tenue: Number(tenue.toFixed(2)),
      moralite: Number(moralite.toFixed(2)),
      discipline: Number(discipline.toFixed(2)),
    },
    total: Number(total.toFixed(2)),
    appreciation,
    minutes: { absence_minutes, tardy_minutes, minutes_total },
  });
}

