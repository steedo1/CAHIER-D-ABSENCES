// src/app/api/admin/conduite/averages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

const RUBRIC_MAX = { assiduite: 6, tenue: 3, moralite: 4, discipline: 7 } as const;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

/** Même grille que côté parents (couverture continue). */
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

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const institution_id = (me?.institution_id as string) ?? null;
  if (!institution_id) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const class_id = String(searchParams.get("class_id") || "");
  const from = searchParams.get("from") || "";
  const to   = searchParams.get("to")   || "";
  if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  // Classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,label,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== institution_id)
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });

  // Roster
  const { data: enroll, error: eErr } = await srv
    .from("class_enrollments")
    .select(`student_id, students:student_id ( id, first_name, last_name )`)
    .eq("class_id", class_id)
    .eq("institution_id", institution_id)
    .is("end_date", null);
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

  const roster = (enroll ?? []).map((r: any) => {
    const s = r.students || {};
    return {
      student_id: s.id as string,
      full_name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "—",
    };
  });

  // Minutes d'absences + retards (centralisé via /api/admin/absences/by-class)
  // On accepte minutes_total (nouveau), sinon on retombe sur minutes (ancien).
  const minutesMap = new Map<string, number>();
  try {
    const url = new URL("/api/admin/absences/by-class", req.url);
    url.searchParams.set("class_id", class_id);
    if (from) url.searchParams.set("from", from);
    if (to)   url.searchParams.set("to", to);
    url.searchParams.set("unjustified", "1"); // si ignoré par la route, aucun impact

    const cookie = req.headers.get("cookie");
    const r = await fetch(url.toString(), {
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.items)) {
      for (const it of j.items) {
        const abs = Number(it.absence_minutes ?? 0);
        const tar = Number(it.tardy_minutes   ?? 0);
        const tot = Number(
          (it.minutes_total ??
            (Number.isFinite(abs + tar) ? abs + tar : it.minutes) ??
            0) || 0
        );
        minutesMap.set(String(it.student_id), tot);
      }
    }
  } catch {
    /* silencieux */
  }

  // Évènements (bornage journée complète pour coller au parent)
  type Ev = {
    student_id: string;
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
  try {
    let q = srv
      .from("conduct_events")
      .select("student_id,rubric,event_type,occurred_at")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id);
    if (from) q = q.gte("occurred_at", startISO(from));
    if (to)   q = q.lte("occurred_at", endISO(to));
    const { data: ev } = await q;
    events = (ev ?? []) as Ev[];
  } catch {
    events = [];
  }

  const byStudent = new Map<string, Ev[]>();
  for (const ev of events) {
    const arr = byStudent.get(ev.student_id) ?? [];
    arr.push(ev);
    byStudent.set(ev.student_id, arr);
  }
  for (const [, arr] of byStudent) arr.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  // Pénalités libres (hors assiduité), même bornage journée
  type Pen = { student_id: string; rubric: "tenue" | "moralite" | "discipline"; points: number; occurred_at: string; };
  let penalties: Pen[] = [];
  try {
    let qpen = srv
      .from("conduct_penalties")
      .select("student_id,rubric,points,occurred_at")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id);
    if (from) qpen = qpen.gte("occurred_at", startISO(from));
    if (to)   qpen = qpen.lte("occurred_at", endISO(to));
    const { data: pen } = await qpen;
    const raw = (pen || []) as Array<{ student_id: string; rubric: string; points: number; occurred_at: string }>;
    penalties = raw
      .filter((p) => p.rubric === "tenue" || p.rubric === "moralite" || p.rubric === "discipline")
      .map((p) => ({ student_id: p.student_id, rubric: p.rubric as Pen["rubric"], points: Number(p.points || 0), occurred_at: p.occurred_at }));
  } catch {
    penalties = [];
  }

  const penByStudent = new Map<string, { tenue: number; moralite: number; discipline: number }>();
  for (const p of penalties) {
    const cur = penByStudent.get(p.student_id) || { tenue: 0, moralite: 0, discipline: 0 };
    (cur as any)[p.rubric] = Number((cur as any)[p.rubric] || 0) + Number(p.points || 0);
    penByStudent.set(p.student_id, cur);
  }

  // Calcul par élève
  const items = roster
    .map(({ student_id, full_name }) => {
      const evs = byStudent.get(student_id) ?? [];

      // Minutes totales (absences + retards)
      const minutes = Number(minutesMap.get(student_id) || 0);
      const hours   = minutes / 60;

      // Assiduité : -0,5 / h, >10h => 0
      let assiduite =
        hours > 10 ? 0 : clamp(RUBRIC_MAX.assiduite - 0.5 * hours, 0, RUBRIC_MAX.assiduite);

      // Tenue
      const tenueWarn = evs.filter((e) => e.event_type === "uniform_warning").length;
      let tenue = clamp(RUBRIC_MAX.tenue - 0.5 * tenueWarn, 0, RUBRIC_MAX.tenue);

      // Moralité
      const moralN = evs.filter((e) => e.event_type === "cheating" || e.event_type === "alcohol_or_drug").length;
      let moralite = clamp(RUBRIC_MAX.moralite - 1 * moralN, 0, RUBRIC_MAX.moralite);

      // Discipline
      const firstWarn = evs.find((e) => e.event_type === "discipline_warning");
      let discN = 0;
      if (firstWarn) {
        discN = evs.filter(
          (e) => e.event_type === "discipline_offense" && e.occurred_at >= firstWarn.occurred_at,
        ).length;
      }
      let discipline = clamp(RUBRIC_MAX.discipline - 1 * discN, 0, RUBRIC_MAX.discipline);

      // Pénalités libres
      const p = penByStudent.get(student_id) || { tenue: 0, moralite: 0, discipline: 0 };
      tenue      = clamp(tenue      - p.tenue,      0, RUBRIC_MAX.tenue);
      moralite   = clamp(moralite   - p.moralite,   0, RUBRIC_MAX.moralite);
      discipline = clamp(discipline - p.discipline, 0, RUBRIC_MAX.discipline);

      // Total (+ plafond conseil)
      let total = assiduite + tenue + moralite + discipline;
      const hasCouncil = evs.some((e) => e.event_type === "discipline_council");
      if (hasCouncil) total = Math.min(total, 5);

      const appreciation = appreciationFromTotal(total);

      return {
        student_id,
        full_name,
        breakdown: {
          assiduite: Number(assiduite.toFixed(2)),
          tenue: Number(tenue.toFixed(2)),
          moralite: Number(moralite.toFixed(2)),
          discipline: Number(discipline.toFixed(2)),
        },
        total: Number(total.toFixed(2)),
        appreciation,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { numeric: true }));

  return NextResponse.json({ class_label: (cls as any).label ?? "", items });
}
