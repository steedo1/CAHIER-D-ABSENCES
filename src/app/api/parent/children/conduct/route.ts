// src/app/api/parent/children/conduct/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Réglages par défaut + loader depuis institution_settings ───────── */

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const rid = () => Math.random().toString(36).slice(2, 8);

type ConductSettings = {
  rubric_max: {
    assiduite: number;
    tenue: number;
    moralite: number;
    discipline: number;
  };
  rules: {
    assiduite: {
      penalty_per_hour: number;
      max_hours_before_zero: number;
    };
    tenue: {
      warning_penalty: number;
    };
    moralite: {
      event_penalty: number;
    };
    discipline: {
      offense_penalty: number;
      council_cap: number;
    };
  };
};

const DEFAULT_CONDUCT_SETTINGS: ConductSettings = {
  rubric_max: { assiduite: 6, tenue: 3, moralite: 4, discipline: 7 },
  rules: {
    assiduite: {
      penalty_per_hour: 0.5,
      max_hours_before_zero: 10,
    },
    tenue: {
      warning_penalty: 0.5,
    },
    moralite: {
      event_penalty: 1,
    },
    discipline: {
      offense_penalty: 1,
      council_cap: 5,
    },
  },
};

const num = (v: any, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

async function loadConductSettings(srv: any, institution_id: string): Promise<ConductSettings> {
  try {
    const { data, error } = await srv
      .from("institution_settings")
      .select("conduct_config")
      .eq("institution_id", institution_id)
      .maybeSingle();

    if (error || !data || !data.conduct_config) {
      return DEFAULT_CONDUCT_SETTINGS;
    }

    const raw = data.conduct_config as any;

    const settings: ConductSettings = {
      rubric_max: {
        assiduite: num(
          raw?.rubric_max?.assiduite,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.assiduite,
        ),
        tenue: num(raw?.rubric_max?.tenue, DEFAULT_CONDUCT_SETTINGS.rubric_max.tenue),
        moralite: num(
          raw?.rubric_max?.moralite,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.moralite,
        ),
        discipline: num(
          raw?.rubric_max?.discipline,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.discipline,
        ),
      },
      rules: {
        assiduite: {
          penalty_per_hour: num(
            raw?.rules?.assiduite?.penalty_per_hour,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.penalty_per_hour,
          ),
          max_hours_before_zero: num(
            raw?.rules?.assiduite?.max_hours_before_zero,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.max_hours_before_zero,
          ),
        },
        tenue: {
          warning_penalty: num(
            raw?.rules?.tenue?.warning_penalty,
            DEFAULT_CONDUCT_SETTINGS.rules.tenue.warning_penalty,
          ),
        },
        moralite: {
          event_penalty: num(
            raw?.rules?.moralite?.event_penalty,
            DEFAULT_CONDUCT_SETTINGS.rules.moralite.event_penalty,
          ),
        },
        discipline: {
          offense_penalty: num(
            raw?.rules?.discipline?.offense_penalty,
            DEFAULT_CONDUCT_SETTINGS.rules.discipline.offense_penalty,
          ),
          council_cap: num(
            raw?.rules?.discipline?.council_cap,
            DEFAULT_CONDUCT_SETTINGS.rules.discipline.council_cap,
          ),
        },
      },
    };

    return settings;
  } catch {
    return DEFAULT_CONDUCT_SETTINGS;
  }
}

/* ───────── Helpers temporels + appréciation ───────── */

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
  const trace = rid();
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  try {
    const { searchParams } = new URL(req.url);
    const qStudent = String(searchParams.get("student_id") || "");
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    if (!qStudent)
      return NextResponse.json(
        { error: "student_id_required" },
        { status: 400 },
      );

    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";

    let student_id = qStudent;
    let institution_id: string | undefined;

    // ── Cookie d’abord
    if (deviceId) {
      const { data: link } = await srv
        .from("parent_device_children")
        .select("student_id")
        .eq("device_id", deviceId)
        .eq("student_id", student_id)
        .limit(1);
      if (!link || !link.length)
        return NextResponse.json({ error: "forbidden" }, { status: 403 });

      let { data: enr } = await srv
        .from("class_enrollments")
        .select("institution_id")
        .eq("student_id", student_id)
        .is("end_date", null)
        .limit(1);
      institution_id = enr?.[0]?.institution_id;

      if (!institution_id) {
        const { data: anyEnr } = await srv
          .from("class_enrollments")
          .select("institution_id, start_date")
          .eq("student_id", student_id)
          .order("start_date", { ascending: false })
          .limit(1);
        institution_id = anyEnr?.[0]?.institution_id;
      }
      if (!institution_id)
        return NextResponse.json(
          { error: "institution_not_found" },
          { status: 404 },
        );
    }

    // ── Fallback guardian (si pas de cookie)
    if (!deviceId) {
      const {
        data: { user },
      } = await supa.auth.getUser().catch(
        () => ({ data: { user: null } } as any),
      );
      if (!user)
        return NextResponse.json(
          { error: "unauthorized" },
          { status: 401 },
        );

      const { data: link, error: gErr } = await srv
        .from("student_guardians")
        .select("institution_id")
        .eq("guardian_profile_id", user.id)
        .eq("student_id", student_id)
        .maybeSingle();
      if (gErr)
        return NextResponse.json({ error: gErr.message }, { status: 400 });

      institution_id = (link as any)?.institution_id;
      if (!institution_id)
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (!institution_id)
      return NextResponse.json(
        { error: "institution_not_found" },
        { status: 404 },
      );

    // ── Chargement des réglages de conduite (ou défauts)
    const conductSettings = await loadConductSettings(srv, institution_id);
    const RUBRIC_MAX = conductSettings.rubric_max;

    // ── Minutes d’absence/retard
    const { data: absRows } = await srv
      .from("v_mark_minutes")
      .select("minutes, started_at")
      .eq("institution_id", institution_id)
      .eq("student_id", student_id)
      .gte("started_at", startISO(from))
      .lte("started_at", endISO(to));

    let tardyRows: Array<{ minutes: number; started_at: string }> = [];
    const { data: tRows } = await srv
      .from("v_tardy_minutes")
      .select("minutes, started_at")
      .eq("institution_id", institution_id)
      .eq("student_id", student_id)
      .gte("started_at", startISO(from))
      .lte("started_at", endISO(to));
    if (Array.isArray(tRows)) tardyRows = tRows as any[];

    const absence_minutes = (absRows || []).reduce(
      (a, r: any) => a + Number(r?.minutes || 0),
      0,
    );
    const tardy_minutes = (tardyRows || []).reduce(
      (a, r: any) => a + Number(r?.minutes || 0),
      0,
    );
    const minutes_total = absence_minutes + tardy_minutes;
    const hours = minutes_total / 60;

    // ── Évènements & pénalités
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
      let q = srv
        .from("conduct_events")
        .select("rubric,event_type,occurred_at")
        .eq("institution_id", institution_id)
        .eq("student_id", student_id);
      if (from) q = q.gte("occurred_at", startISO(from));
      if (to) q = q.lte("occurred_at", endISO(to));
      const { data: ev } = await q;
      events = (ev || []) as Ev[];
      events.sort((a, b) =>
        a.occurred_at.localeCompare(b.occurred_at),
      );
    }

    type Pen = {
      rubric: "tenue" | "moralite" | "discipline";
      points: number;
      occurred_at: string;
    };
    let penalties: Pen[] = [];
    {
      let q = srv
        .from("conduct_penalties")
        .select("rubric,points,occurred_at")
        .eq("institution_id", institution_id)
        .eq("student_id", student_id);
      if (from) q = q.gte("occurred_at", startISO(from));
      if (to) q = q.lte("occurred_at", endISO(to));
      const { data: pen } = await q;
      const raw = (pen || []) as Array<{
        rubric: string;
        points: number;
        occurred_at: string;
      }>;
      penalties = raw
        .filter(
          (p) =>
            p.rubric === "tenue" ||
            p.rubric === "moralite" ||
            p.rubric === "discipline",
        )
        .map((p) => ({
          rubric: p.rubric as Pen["rubric"],
          points: Number(p.points || 0),
          occurred_at: p.occurred_at,
        }));
    }

    // ── Calcul barème (avec réglages dynamiques)
    const { rules } = conductSettings;

    let assiduite =
      hours > rules.assiduite.max_hours_before_zero
        ? 0
        : clamp(
            RUBRIC_MAX.assiduite -
              rules.assiduite.penalty_per_hour * hours,
            0,
            RUBRIC_MAX.assiduite,
          );

    const tenueWarn = events.filter(
      (e) => e.event_type === "uniform_warning",
    ).length;
    let tenue = clamp(
      RUBRIC_MAX.tenue - rules.tenue.warning_penalty * tenueWarn,
      0,
      RUBRIC_MAX.tenue,
    );

    const moralN = events.filter(
      (e) =>
        e.event_type === "cheating" ||
        e.event_type === "alcohol_or_drug",
    ).length;
    let moralite = clamp(
      RUBRIC_MAX.moralite -
        rules.moralite.event_penalty * moralN,
      0,
      RUBRIC_MAX.moralite,
    );

    const firstWarn = events.find(
      (e) => e.event_type === "discipline_warning",
    );
    let discN = 0;
    if (firstWarn) {
      discN = events.filter(
        (e) =>
          e.event_type === "discipline_offense" &&
          e.occurred_at >= firstWarn.occurred_at,
      ).length;
    }
    let discipline = clamp(
      RUBRIC_MAX.discipline -
        rules.discipline.offense_penalty * discN,
      0,
      RUBRIC_MAX.discipline,
    );

    const p = penalties.reduce(
      (acc, x) => ({
        ...acc,
        [x.rubric]: (acc as any)[x.rubric] + x.points,
      }),
      { tenue: 0, moralite: 0, discipline: 0 } as any,
    );
    tenue = clamp(
      tenue - (p.tenue || 0),
      0,
      RUBRIC_MAX.tenue,
    );
    moralite = clamp(
      moralite - (p.moralite || 0),
      0,
      RUBRIC_MAX.moralite,
    );
    discipline = clamp(
      discipline - (p.discipline || 0),
      0,
      RUBRIC_MAX.discipline,
    );

    let total = assiduite + tenue + moralite + discipline;
    const hasCouncil = events.some(
      (e) => e.event_type === "discipline_council",
    );
    if (hasCouncil)
      total = Math.min(
        total,
        conductSettings.rules.discipline.council_cap,
      );

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
  } catch (e: any) {
    console.error(`[conduct:${trace}] fatal`, e);
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
