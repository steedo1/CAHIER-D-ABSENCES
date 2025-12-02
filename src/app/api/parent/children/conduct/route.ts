import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Réglages par défaut + loader depuis conduct_settings / institution_settings ───────── */

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const rid = () => Math.random().toString(36).slice(2, 8);

type LatenessMode = "ignore" | "as_hours" | "direct_points";

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
      note_after_threshold: number;
      lateness_mode: LatenessMode;
      lateness_minutes_per_absent_hour: number;
      lateness_points_per_late: number;
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
      note_after_threshold: 0,
      lateness_mode: "as_hours",
      lateness_minutes_per_absent_hour: 60,
      lateness_points_per_late: 0.25,
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

/**
 * 🔗 On lit d'abord conduct_settings (nouvelle table dédiée),
 * puis on retombe sur institution_settings.conduct_config si besoin.
 */
async function loadConductSettings(
  srv: any,
  institution_id: string,
): Promise<ConductSettings> {
  // 1) Nouvelle table conduct_settings (alignée sur /api/admin/conduite/averages)
  try {
    const { data, error } = await srv
      .from("conduct_settings")
      .select(
        `
        assiduite_max,
        tenue_max,
        moralite_max,
        discipline_max,
        points_per_absent_hour,
        absent_hours_zero_threshold,
        absent_hours_note_after_threshold,
        lateness_mode,
        lateness_minutes_per_absent_hour,
        lateness_points_per_late
      `,
      )
      .eq("institution_id", institution_id)
      .maybeSingle();

    if (!error && data) {
      const raw = data as any;

      const modeRaw = String(
        raw.lateness_mode ??
          DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode,
      )
        .normalize("NFKC")
        .trim()
        .toLowerCase();

      const allowedModes: LatenessMode[] = ["ignore", "as_hours", "direct_points"];
      const lateness_mode: LatenessMode = allowedModes.includes(
        modeRaw as LatenessMode,
      )
        ? (modeRaw as LatenessMode)
        : DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode;

      const settings: ConductSettings = {
        rubric_max: {
          assiduite: num(
            raw.assiduite_max,
            DEFAULT_CONDUCT_SETTINGS.rubric_max.assiduite,
          ),
          tenue: num(raw.tenue_max, DEFAULT_CONDUCT_SETTINGS.rubric_max.tenue),
          moralite: num(
            raw.moralite_max,
            DEFAULT_CONDUCT_SETTINGS.rubric_max.moralite,
          ),
          discipline: num(
            raw.discipline_max,
            DEFAULT_CONDUCT_SETTINGS.rubric_max.discipline,
          ),
        },
        rules: {
          assiduite: {
            penalty_per_hour: num(
              raw.points_per_absent_hour,
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite.penalty_per_hour,
            ),
            max_hours_before_zero: num(
              raw.absent_hours_zero_threshold,
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite.max_hours_before_zero,
            ),
            note_after_threshold: num(
              raw.absent_hours_note_after_threshold,
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite.note_after_threshold,
            ),
            lateness_mode,
            lateness_minutes_per_absent_hour: num(
              raw.lateness_minutes_per_absent_hour,
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite
                .lateness_minutes_per_absent_hour,
            ),
            lateness_points_per_late: num(
              raw.lateness_points_per_late,
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite
                .lateness_points_per_late,
            ),
          },
          // Pour l’instant : autres rubriques = défauts (pas encore d’UI dédiée)
          tenue: {
            warning_penalty:
              DEFAULT_CONDUCT_SETTINGS.rules.tenue.warning_penalty,
          },
          moralite: {
            event_penalty:
              DEFAULT_CONDUCT_SETTINGS.rules.moralite.event_penalty,
          },
          discipline: {
            offense_penalty:
              DEFAULT_CONDUCT_SETTINGS.rules.discipline.offense_penalty,
            council_cap:
              DEFAULT_CONDUCT_SETTINGS.rules.discipline.council_cap,
          },
        },
      };

      return settings;
    }
  } catch {
    // on tombera sur le fallback plus bas
  }

  // 2) Ancien stockage JSON dans institution_settings.conduct_config
  try {
    const { data, error } = await srv
      .from("institution_settings")
      .select("conduct_config")
      .eq("institution_id", institution_id)
      .maybeSingle();

    if (!error && data && (data as any).conduct_config) {
      const raw = (data as any).conduct_config as any;

      const settings: ConductSettings = {
        rubric_max: {
          assiduite: num(
            raw?.rubric_max?.assiduite,
            DEFAULT_CONDUCT_SETTINGS.rubric_max.assiduite,
          ),
          tenue: num(
            raw?.rubric_max?.tenue,
            DEFAULT_CONDUCT_SETTINGS.rubric_max.tenue,
          ),
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
            // Champs additionnels pas présents dans l'ancien JSON → défauts
            note_after_threshold:
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite.note_after_threshold,
            lateness_mode:
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode,
            lateness_minutes_per_absent_hour:
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite
                .lateness_minutes_per_absent_hour,
            lateness_points_per_late:
              DEFAULT_CONDUCT_SETTINGS.rules.assiduite
                .lateness_points_per_late,
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
    }
  } catch {
    // ignore, on retombera sur les valeurs par défaut
  }

  // 3) Fallback : réglages par défaut
  return DEFAULT_CONDUCT_SETTINGS;
}

/**
 * 🔗 Durée de séance paramétrée dans l’établissement.
 * Sert de fallback pour les retards (mode as_hours) si
 * lateness_minutes_per_absent_hour n’est pas renseigné.
 */
async function loadDefaultSessionMinutes(
  srv: any,
  institution_id: string,
): Promise<number> {
  try {
    const { data, error } = await srv
      .from("institutions")
      .select("default_session_minutes")
      .eq("id", institution_id)
      .maybeSingle();

    if (error || !data) return 60;

    const n = Number((data as any).default_session_minutes);
    if (!Number.isFinite(n) || n <= 0) return 60;
    return n;
  } catch {
    return 60;
  }
}

/* ───────── Helpers temporels + appréciation ───────── */

function startISO(d?: string) {
  return d
    ? new Date(`${d}T00:00:00.000Z`).toISOString()
    : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d
    ? new Date(`${d}T23:59:59.999Z`).toISOString()
    : "9999-12-31T23:59:59.999Z";
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

    // Durée de séance (fallback pour les retards en mode as_hours)
    const defaultSessionMinutes = await loadDefaultSessionMinutes(
      srv,
      institution_id,
    );

    // ── Minutes d’absence/retard (et comptages)
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

    const absence_count = (absRows || []).length;
    const tardy_count = tardyRows.length;

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
      events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
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

    // ── Calcul barème (avec réglages dynamiques alignés sur l’admin) ──
    const { rules } = conductSettings;
    const assRules = rules.assiduite;

    // Absences : 1 absence injustifiée = 1 “unité” assiduité
    const absenceUnits = Math.max(0, absence_count);

    // Retards : conversion minutes → unités (mode as_hours)
    const latenessDivisor = Math.max(
      1,
      assRules.lateness_minutes_per_absent_hour ||
        defaultSessionMinutes ||
        60,
    );

    let effectiveHours = 0;
    if (assRules.lateness_mode === "ignore") {
      effectiveHours = absenceUnits;
    } else if (assRules.lateness_mode === "as_hours") {
      const tardyUnits = Math.floor(tardy_minutes / latenessDivisor);
      effectiveHours = absenceUnits + tardyUnits;
    } else {
      // "direct_points" : les retards sont gérés plus bas en points directs
      effectiveHours = absenceUnits;
    }

    let assiduite: number;
    if (effectiveHours >= assRules.max_hours_before_zero) {
      // À partir du seuil, on force la note à note_after_threshold
      const cap = clamp(
        assRules.note_after_threshold,
        0,
        RUBRIC_MAX.assiduite,
      );
      assiduite = cap;
    } else {
      assiduite = clamp(
        RUBRIC_MAX.assiduite -
          assRules.penalty_per_hour * effectiveHours,
        0,
        RUBRIC_MAX.assiduite,
      );

      // Mode "direct_points" : on retire en plus des points par retard
      if (
        assRules.lateness_mode === "direct_points" &&
        tardy_count > 0 &&
        assRules.lateness_points_per_late > 0
      ) {
        assiduite = clamp(
          assiduite -
            assRules.lateness_points_per_late * tardy_count,
          0,
          RUBRIC_MAX.assiduite,
        );
      }
    }

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
      RUBRIC_MAX.moralite - rules.moralite.event_penalty * moralN,
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
    tenue = clamp(tenue - (p.tenue || 0), 0, RUBRIC_MAX.tenue);
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
      // 🔎 Barème réel renvoyé au front parent (cohérent avec réglages admin)
      rubric_max: conductSettings.rubric_max,
      minutes: {
        absence_minutes,
        tardy_minutes,
        minutes_total,
        absence_count,
        tardy_count,
      },
    });
  } catch (e: any) {
    console.error(`[conduct:${trace}] fatal`, e);
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
