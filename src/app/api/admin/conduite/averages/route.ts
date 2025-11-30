import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/* ───────── Réglages par défaut + loader depuis conduct_settings ───────── */

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

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
      penalty_per_hour: 0.5, // -0,5 par heure d'absence/retard
      max_hours_before_zero: 10, // seuil d'heures
      note_after_threshold: 0, // au-delà du seuil → note fixée à 0 par défaut
      lateness_mode: "as_hours",
      lateness_minutes_per_absent_hour: 60,
      lateness_points_per_late: 0.25,
    },
    tenue: {
      warning_penalty: 0.5, // -0,5 par avertissement de tenue
    },
    moralite: {
      event_penalty: 1, // -1 par évènement (triche, alcool/drogue)
    },
    discipline: {
      offense_penalty: 1, // -1 par offence après avertissement
      council_cap: 5, // plafond si conseil de discipline
    },
  },
};

const num = (v: any, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * 🔗 On lit tous les réglages utiles dans conduct_settings :
 * - max par rubrique
 * - points par heure d’absence
 * - seuil d’heures + note au-delà du seuil
 * - stratégie retards (mode + paramètres)
 */
async function loadConductSettings(
  srv: any,
  institution_id: string,
): Promise<ConductSettings> {
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

    if (error || !data) {
      // Aucun réglage spécifique → valeurs par défaut
      return DEFAULT_CONDUCT_SETTINGS;
    }

    const raw = data as any;

    const modeRaw = String(
      raw.lateness_mode ?? DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode,
    )
      .normalize("NFKC")
      .trim()
      .toLowerCase();

    const allowedModes: LatenessMode[] = ["ignore", "as_hours", "direct_points"];
    const lateness_mode: LatenessMode = allowedModes.includes(modeRaw as LatenessMode)
      ? (modeRaw as LatenessMode)
      : DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode;

    const settings: ConductSettings = {
      rubric_max: {
        assiduite: num(
          raw.assiduite_max,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.assiduite,
        ),
        tenue: num(
          raw.tenue_max,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.tenue,
        ),
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
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_points_per_late,
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
  } catch {
    // En cas de problème inattendu → fallback
    return DEFAULT_CONDUCT_SETTINGS;
  }
}

/**
 * 🔗 Durée de séance paramétrée dans l’établissement.
 * On s’en sert comme fallback pour les retards (mode as_hours),
 * si lateness_minutes_per_absent_hour n’est pas renseigné.
 */
async function loadDefaultSessionMinutes(
  srv: any,
  institution_id: string,
): Promise<number> {
  try {
    const { data, error } = await srv
      .from("institutions") // ✅ même table que dans /api/admin/institution/settings
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

/**
 * ⚠️ On garde les minutes pour info, mais on ajoute surtout absenceCount :
 *  - absenceMinutes : minutes d’absence injustifiée
 *  - absenceCount   : nombre de marques d’absence injustifiée (séances)
 *  - tardyMinutes   : minutes de retard injustifié
 *  - tardyCount     : nombre de retards
 */
type MinutesRec = {
  absenceMinutes: number;
  absenceCount: number;
  tardyMinutes: number;
  tardyCount: number;
};

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
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
  const to = searchParams.get("to") || "";
  const hasDateFilter = !!from || !!to;

  if (!class_id)
    return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  // Classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,label,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== institution_id)
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });

  // Chargement des réglages de conduite (ou défauts)
  const conductSettings = await loadConductSettings(srv, institution_id);
  const RUBRIC_MAX = conductSettings.rubric_max;

  // Durée de séance (fallback pour les retards en mode as_hours)
  const defaultSessionMinutes = await loadDefaultSessionMinutes(srv, institution_id);

  // ───────────────── Roster (inscriptions à la classe) ─────────────────
  //
  // ✅ Comportement inchangé si AUCUNE date n'est fournie :
  //    → on ne prend que les élèves avec end_date IS NULL (inscrits actuellement).
  //
  // ✅ Si une période est fournie (from / to, donc année scolaire + trimestre) :
  //    → on inclut aussi les élèves qui avaient encore la classe à cette date,
  //       c'est-à-dire ceux dont end_date est NULL ou postérieure au début de la période.
  //
  let enrollQuery = srv
    .from("class_enrollments")
    .select(
      `student_id, start_date, end_date, students:student_id ( id, first_name, last_name )`,
    )
    .eq("class_id", class_id)
    .eq("institution_id", institution_id);

  if (!hasDateFilter) {
    // 🔁 Comportement historique : seulement les élèves encore inscrits
    enrollQuery = enrollQuery.is("end_date", null);
  } else if (from) {
    // 🕒 Photo "historique" : tout élève dont la fin d'inscription
    //     est postérieure au début de la période OU encore inscrit.
    enrollQuery = enrollQuery.or(
      `end_date.gte.${from},end_date.is.null`,
    );
  }
  // Si seulement "to" est rempli, on ne change pas le filtrage par end_date
  // (cas très rare, et on continue à inclure les élèves actifs).

  const { data: enroll, error: eErr } = await enrollQuery;
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

  const roster = (enroll ?? []).map((r: any) => {
    const s = r.students || {};
    return {
      student_id: s.id as string,
      full_name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "—",
    };
  });

  // Minutes d'absences + retards via route centralisée (qui exclut déjà les justifiées)
  const minutesMap = new Map<string, MinutesRec>();
  try {
    const url = new URL("/api/admin/absences/by-class", req.url);
    url.searchParams.set("class_id", class_id);
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    url.searchParams.set("unjustified", "1");

    const cookie = req.headers.get("cookie");
    const r = await fetch(url.toString(), {
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.items)) {
      for (const it of j.items) {
        const abs = Number((it as any).absence_minutes ?? 0);
        const absCount = Number((it as any).absence_count ?? 0);
        const tar = Number((it as any).tardy_minutes ?? 0);
        const tardyCount = Number((it as any).tardy_count ?? 0);
        const sid = String((it as any).student_id);

        if (!sid) continue;
        minutesMap.set(sid, {
          absenceMinutes: Number.isFinite(abs) ? abs : 0,
          absenceCount: Number.isFinite(absCount) ? absCount : 0,
          tardyMinutes: Number.isFinite(tar) ? tar : 0,
          tardyCount: Number.isFinite(tardyCount) ? tardyCount : 0,
        });
      }
    }
  } catch {
    /* silencieux */
  }

  // Évènements
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
    if (to) q = q.lte("occurred_at", endISO(to));
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
  for (const [, arr] of byStudent)
    arr.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  // Pénalités libres
  type Pen = {
    student_id: string;
    rubric: "tenue" | "moralite" | "discipline";
    points: number;
    occurred_at: string;
  };
  let penalties: Pen[] = [];
  try {
    let qpen = srv
      .from("conduct_penalties")
      .select("student_id,rubric,points,occurred_at")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id);
    if (from) qpen = qpen.gte("occurred_at", startISO(from));
    if (to) qpen = qpen.lte("occurred_at", endISO(to));
    const { data: pen } = await qpen;
    const raw = (pen || []) as Array<{
      student_id: string;
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
        student_id: p.student_id,
        rubric: p.rubric as Pen["rubric"],
        points: Number(p.points || 0),
        occurred_at: p.occurred_at,
      }));
  } catch {
    penalties = [];
  }

  const penByStudent = new Map<
    string,
    { tenue: number; moralite: number; discipline: number }
  >();
  for (const p of penalties) {
    const cur =
      penByStudent.get(p.student_id) || {
        tenue: 0,
        moralite: 0,
        discipline: 0,
      };
    (cur as any)[p.rubric] =
      Number((cur as any)[p.rubric] || 0) + Number(p.points || 0);
    penByStudent.set(p.student_id, cur);
  }

  // Calcul par élève
  const items = roster
    .map(({ student_id, full_name }) => {
      const evs = byStudent.get(student_id) ?? [];

      const minutesRec = minutesMap.get(student_id) || {
        absenceMinutes: 0,
        absenceCount: 0,
        tardyMinutes: 0,
        tardyCount: 0,
      };
      const absenceMinutes = Number(minutesRec.absenceMinutes || 0);
      const absenceCount = Number(minutesRec.absenceCount || 0);
      const tardyMinutes = Number(minutesRec.tardyMinutes || 0);
      const tardyCount = Number(minutesRec.tardyCount || 0);

      const { rubric_max, rules } = conductSettings;
      const assRules = rules.assiduite;

      // ───────────────── Heures effectives pour l’assiduité ─────────────────
      //
      // ✅ Absences : 1 absence injustifiée = 1 “heure” assiduité
      // ✅ Retards (mode as_hours) : les minutes s’accumulent mais ne comptent
      //    que par tranches complètes.
      //    Exemple avec seuil 60 :
      //      - 50 minutes  → 0 “heure”
      //      - 75 minutes  → 1 “heure”
      //      - 130 minutes → 2 “heures”
      const absenceUnits = Math.max(0, absenceCount);

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
        // ⚠️ Ici on prend uniquement les TRANCHES COMPLÈTES
        const tardyUnits = Math.floor(tardyMinutes / latenessDivisor);
        effectiveHours = absenceUnits + tardyUnits;
      } else {
        // "direct_points"
        effectiveHours = absenceUnits;
      }

      // Assiduité : barème dynamique
      let assiduite: number;
      if (effectiveHours >= assRules.max_hours_before_zero) {
        // ⚠️ À partir du seuil (>=), on applique directement la note définie
        const cap = clamp(
          assRules.note_after_threshold,
          0,
          rubric_max.assiduite,
        );
        assiduite = cap;
      } else {
        // Sous le seuil → décrément linéaire à partir du max
        assiduite = clamp(
          rubric_max.assiduite -
            assRules.penalty_per_hour * effectiveHours,
          0,
          rubric_max.assiduite,
        );

        // Si mode "direct_points", on retire en plus des points par retard
        if (
          assRules.lateness_mode === "direct_points" &&
          tardyCount > 0 &&
          assRules.lateness_points_per_late > 0
        ) {
          assiduite = clamp(
            assiduite -
              assRules.lateness_points_per_late * tardyCount,
            0,
            rubric_max.assiduite,
          );
        }
      }

      // Tenue
      const tenueWarn = evs.filter(
        (e) => e.event_type === "uniform_warning",
      ).length;
      let tenue = clamp(
        rubric_max.tenue -
          rules.tenue.warning_penalty * tenueWarn,
        0,
        rubric_max.tenue,
      );

      // Moralité
      const moralN = evs.filter(
        (e) =>
          e.event_type === "cheating" ||
          e.event_type === "alcohol_or_drug",
      ).length;
      let moralite = clamp(
        rubric_max.moralite -
          rules.moralite.event_penalty * moralN,
        0,
        rubric_max.moralite,
      );

      // Discipline
      const firstWarn = evs.find(
        (e) => e.event_type === "discipline_warning",
      );
      let discN = 0;
      if (firstWarn) {
        discN = evs.filter(
          (e) =>
            e.event_type === "discipline_offense" &&
            e.occurred_at >= firstWarn.occurred_at,
        ).length;
      }
      let discipline = clamp(
        rubric_max.discipline -
          rules.discipline.offense_penalty * discN,
        0,
        rubric_max.discipline,
      );

      // Pénalités libres
      const p =
        penByStudent.get(student_id) || {
          tenue: 0,
          moralite: 0,
          discipline: 0,
        };
      tenue = clamp(tenue - p.tenue, 0, rubric_max.tenue);
      moralite = clamp(
        moralite - p.moralite,
        0,
        rubric_max.moralite,
      );
      discipline = clamp(
        discipline - p.discipline,
        0,
        rubric_max.discipline,
      );

      // Total (+ plafond conseil)
      let total = assiduite + tenue + moralite + discipline;
      const hasCouncil = evs.some(
        (e) => e.event_type === "discipline_council",
      );
      if (hasCouncil)
        total = Math.min(
          total,
          conductSettings.rules.discipline.council_cap,
        );

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
        // debug possible si besoin plus tard :
        // raw: { absenceMinutes, absenceCount, tardyMinutes, tardyCount, effectiveHours }
      };
    })
    .sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, {
        numeric: true,
      }),
    );

  const class_label = (cls as any).label ?? "";

  // ───────────────── CSV branch (opt-in) ─────────────────
  const wantsCSV =
    (searchParams.get("format") || "").toLowerCase() === "csv" ||
    (req.headers.get("accept") || "")
      .toLowerCase()
      .includes("text/csv");

  const totalMax =
    RUBRIC_MAX.assiduite +
    RUBRIC_MAX.tenue +
    RUBRIC_MAX.moralite +
    RUBRIC_MAX.discipline;

  if (wantsCSV) {
    // séparateur ; , décimales avec ,
    const sep = ";";
    const CRLF = "\r\n";
    const fmt = (n: number) => n.toFixed(2).replace(".", ",");
    const q = (s: string) => {
      const str = String(s ?? "");
      // échapper les guillemets
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      "Classe",
      "Élève",
      `Assiduité (/${RUBRIC_MAX.assiduite})`,
      `Tenue (/${RUBRIC_MAX.tenue})`,
      `Moralité (/${RUBRIC_MAX.moralite})`,
      `Discipline (/${RUBRIC_MAX.discipline})`,
      `Moyenne (/${totalMax})`,
      "Appréciation",
    ];

    const rows = [headers.join(sep)];
    for (const it of items) {
      rows.push(
        [
          q(class_label),
          q(it.full_name),
          fmt(it.breakdown.assiduite),
          fmt(it.breakdown.tenue),
          fmt(it.breakdown.moralite),
          fmt(it.breakdown.discipline),
          fmt(it.total),
          q(it.appreciation),
        ].join(sep),
      );
    }

    const bom = "\uFEFF"; // Excel-friendly
    const body = bom + rows.join(CRLF) + CRLF;

    const labelSafe =
      (class_label || "classe")
        .replace(/[^\p{L}\p{N}_-]+/gu, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || "classe";

    const rangePart =
      from && to
        ? `${from}_au_${to}`
        : from
        ? `depuis_${from}`
        : to
        ? `jusqua_${to}`
        : "toutes_dates";

    const filename = `conduite_${labelSafe}_${rangePart}.csv`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // JSON (comportement existant, intact)
  return NextResponse.json({
    class_label: class_label ?? "",
    rubric_max: RUBRIC_MAX,
    total_max: totalMax,
    items,
  });
}
