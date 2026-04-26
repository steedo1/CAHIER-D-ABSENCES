//src/app/api/conduite/averages/route.ts
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

    return {
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
  } catch {
    return DEFAULT_CONDUCT_SETTINGS;
  }
}

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

type MinutesRec = {
  absenceMinutes: number;
  absenceCount: number;
  tardyMinutes: number;
  tardyCount: number;
};

type ConductOverride = {
  student_id: string;
  override_total: number;
  calculated_total: number | null;
  reason: string | null;
  updated_at: string | null;
  edited_by: string | null;
};


type InstitutionConductPolicy = {
  mode: "standard" | "conduct_plus_subjects";
  classic_conduct_weight: number;
  missing_subject_strategy: "ignore_missing" | "count_as_zero";
  is_active: boolean;
};

type ConductSubjectPolicy = {
  subject_id: string;
  subject_name: string;
  conduct_weight: number;
};

type ConductPolicyComponent = {
  kind: "classic_conduct" | "subject";
  label: string;
  subject_id: string | null;
  avg20: number | null;
  weight: number;
  included: boolean;
  missing: boolean;
};

type ConductPolicyResult = {
  total: number;
  avg20: number;
  policy_applied: boolean;
  mode: InstitutionConductPolicy["mode"];
  classic_total: number;
  classic_avg20: number;
  components: ConductPolicyComponent[];
};

function clean2(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function normalizeScoreTo20(score: number, totalMax: number): number {
  const max = Number(totalMax);
  if (!Number.isFinite(max) || max <= 0 || max === 20) {
    return clamp(score, 0, 20);
  }
  return clamp((score * 20) / max, 0, 20);
}

function normalizeScoreFrom20(avg20: number, totalMax: number): number {
  const max = Number(totalMax);
  if (!Number.isFinite(max) || max <= 0 || max === 20) {
    return clamp(avg20, 0, 20);
  }
  return clamp((avg20 * max) / 20, 0, max);
}

async function loadInstitutionConductPolicy(
  srv: any,
  institution_id: string,
): Promise<InstitutionConductPolicy> {
  const fallback: InstitutionConductPolicy = {
    mode: "standard",
    classic_conduct_weight: 1,
    missing_subject_strategy: "ignore_missing",
    is_active: false,
  };

  try {
    const { data, error } = await srv
      .from("institution_conduct_policies")
      .select(
        "mode, classic_conduct_weight, missing_subject_strategy, is_active",
      )
      .eq("institution_id", institution_id)
      .maybeSingle();

    if (error || !data || (data as any).is_active === false) return fallback;

    const modeRaw = String((data as any).mode || "standard");
    const mode: InstitutionConductPolicy["mode"] =
      modeRaw === "conduct_plus_subjects" ? "conduct_plus_subjects" : "standard";

    const strategyRaw = String(
      (data as any).missing_subject_strategy || "ignore_missing",
    );
    const missing_subject_strategy: InstitutionConductPolicy["missing_subject_strategy"] =
      strategyRaw === "count_as_zero" ? "count_as_zero" : "ignore_missing";

    const weight = Number((data as any).classic_conduct_weight ?? 1);

    return {
      mode,
      classic_conduct_weight:
        Number.isFinite(weight) && weight >= 0 ? weight : 1,
      missing_subject_strategy,
      is_active: true,
    };
  } catch {
    return fallback;
  }
}

async function loadConductSubjectPolicies(
  srv: any,
  institution_id: string,
): Promise<ConductSubjectPolicy[]> {
  try {
    const { data, error } = await srv
      .from("institution_subject_grade_policies")
      .select("subject_id, conduct_weight, include_in_conduct_average, is_active")
      .eq("institution_id", institution_id)
      .eq("include_in_conduct_average", true)
      .eq("is_active", true);

    if (error || !Array.isArray(data) || data.length === 0) return [];

    const rows = (data as any[])
      .map((row) => ({
        subject_id: String(row.subject_id || ""),
        conduct_weight: Number(row.conduct_weight ?? 1),
      }))
      .filter((row) => !!row.subject_id);

    const subjectIds = Array.from(new Set(rows.map((row) => row.subject_id)));
    const nameBySubject = new Map<string, string>();

    if (subjectIds.length > 0) {
      const { data: subjectRows } = await srv
        .from("subjects")
        .select("id, name, code")
        .in("id", subjectIds);

      for (const s of (subjectRows || []) as any[]) {
        const id = String(s.id || "");
        const label = String(s.name || s.code || "Matière").trim();
        if (id) nameBySubject.set(id, label || "Matière");
      }
    }

    return rows.map((row) => ({
      subject_id: row.subject_id,
      subject_name: nameBySubject.get(row.subject_id) || "Matière",
      conduct_weight:
        Number.isFinite(row.conduct_weight) && row.conduct_weight >= 0
          ? row.conduct_weight
          : 1,
    }));
  } catch {
    return [];
  }
}

async function loadSubjectAveragesForConductPolicy(
  srv: any,
  opts: {
    class_id: string;
    subject_ids: string[];
    student_ids: string[];
    from: string;
    to: string;
  },
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();

  const subjectIds = Array.from(new Set(opts.subject_ids.filter(Boolean)));
  const studentIds = Array.from(new Set(opts.student_ids.filter(Boolean)));

  if (!opts.class_id || subjectIds.length === 0 || studentIds.length === 0) {
    return out;
  }

  try {
    let evalQuery = srv
      .from("grade_evaluations")
      .select("id, subject_id, scale, coeff, eval_date, is_published")
      .eq("class_id", opts.class_id)
      .eq("is_published", true)
      .in("subject_id", subjectIds);

    if (opts.from) evalQuery = evalQuery.gte("eval_date", opts.from);
    if (opts.to) evalQuery = evalQuery.lte("eval_date", opts.to);

    const { data: evalRows, error: evalErr } = await evalQuery;
    if (evalErr || !Array.isArray(evalRows) || evalRows.length === 0) return out;

    const evalById = new Map<
      string,
      { subject_id: string; scale: number; coeff: number }
    >();

    for (const ev of evalRows as any[]) {
      const id = String(ev.id || "");
      const subject_id = String(ev.subject_id || "");
      if (!id || !subject_id) continue;

      const scaleRaw = Number(ev.scale ?? 20);
      const coeffRaw = Number(ev.coeff ?? 1);

      evalById.set(id, {
        subject_id,
        scale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 20,
        coeff: Number.isFinite(coeffRaw) && coeffRaw > 0 ? coeffRaw : 1,
      });
    }

    const evalIds = Array.from(evalById.keys());
    if (evalIds.length === 0) return out;

    const { data: gradeRows, error: gradeErr } = await srv
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds)
      .in("student_id", studentIds);

    if (gradeErr || !Array.isArray(gradeRows) || gradeRows.length === 0) {
      return out;
    }

    const acc = new Map<string, { sum: number; coeff: number }>();

    for (const grade of gradeRows as any[]) {
      const evaluationId = String(grade.evaluation_id || "");
      const studentId = String(grade.student_id || "");
      const ev = evalById.get(evaluationId);
      if (!ev || !studentId) continue;

      const score = Number(grade.score);
      if (!Number.isFinite(score)) continue;

      const mark20 = clamp((score * 20) / ev.scale, 0, 20);
      const key = `${ev.subject_id}|${studentId}`;
      const cur = acc.get(key) || { sum: 0, coeff: 0 };
      cur.sum += mark20 * ev.coeff;
      cur.coeff += ev.coeff;
      acc.set(key, cur);
    }

    for (const [key, value] of acc.entries()) {
      if (!value.coeff) continue;
      const [subjectId, studentId] = key.split("|");
      if (!subjectId || !studentId) continue;

      const avg = clean2(value.sum / value.coeff);
      if (avg === null) continue;

      const byStudent = out.get(subjectId) || new Map<string, number>();
      byStudent.set(studentId, avg);
      out.set(subjectId, byStudent);
    }

    return out;
  } catch {
    return out;
  }
}

function applyInstitutionConductPolicyToStudent(opts: {
  student_id: string;
  classic_total: number;
  total_max: number;
  conduct_policy: InstitutionConductPolicy;
  subject_policies: ConductSubjectPolicy[];
  subject_averages: Map<string, Map<string, number>>;
}): ConductPolicyResult {
  const classicTotal = clean2(opts.classic_total) ?? 0;
  const classicAvg20 = clean2(normalizeScoreTo20(classicTotal, opts.total_max)) ?? 0;

  const classicWeight = Math.max(
    0,
    Number(opts.conduct_policy.classic_conduct_weight ?? 1),
  );

  const components: ConductPolicyComponent[] = [
    {
      kind: "classic_conduct",
      label: "Conduite",
      subject_id: null,
      avg20: classicAvg20,
      weight: classicWeight,
      included: classicWeight > 0,
      missing: false,
    },
  ];

  if (
    opts.conduct_policy.mode !== "conduct_plus_subjects" ||
    opts.subject_policies.length === 0
  ) {
    return {
      total: classicTotal,
      avg20: classicAvg20,
      policy_applied: false,
      mode: opts.conduct_policy.mode,
      classic_total: classicTotal,
      classic_avg20: classicAvg20,
      components,
    };
  }

  let weightedSum = classicWeight > 0 ? classicAvg20 * classicWeight : 0;
  let totalWeight = classicWeight > 0 ? classicWeight : 0;

  for (const subjectPolicy of opts.subject_policies) {
    const weight = Math.max(0, Number(subjectPolicy.conduct_weight ?? 1));
    const rawAvg = opts.subject_averages
      .get(subjectPolicy.subject_id)
      ?.get(opts.student_id);

    const hasAvg = typeof rawAvg === "number" && Number.isFinite(rawAvg);
    const shouldCountMissing =
      opts.conduct_policy.missing_subject_strategy === "count_as_zero";

    const included = weight > 0 && (hasAvg || shouldCountMissing);
    const avg20 = hasAvg ? clamp(rawAvg, 0, 20) : shouldCountMissing ? 0 : null;

    components.push({
      kind: "subject",
      label: subjectPolicy.subject_name,
      subject_id: subjectPolicy.subject_id,
      avg20: avg20 === null ? null : clean2(avg20),
      weight,
      included,
      missing: !hasAvg,
    });

    if (included && avg20 !== null) {
      weightedSum += avg20 * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) {
    return {
      total: classicTotal,
      avg20: classicAvg20,
      policy_applied: false,
      mode: opts.conduct_policy.mode,
      classic_total: classicTotal,
      classic_avg20: classicAvg20,
      components,
    };
  }

  const finalAvg20 = clean2(weightedSum / totalWeight) ?? classicAvg20;
  const finalTotal =
    clean2(normalizeScoreFrom20(finalAvg20, opts.total_max)) ?? classicTotal;

  return {
    total: finalTotal,
    avg20: finalAvg20,
    policy_applied: true,
    mode: opts.conduct_policy.mode,
    classic_total: classicTotal,
    classic_avg20: classicAvg20,
    components,
  };
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  const institution_id = (me?.institution_id as string) ?? null;
  if (!institution_id) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);

  const class_id = String(searchParams.get("class_id") || "");
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  // ✅ Nouveaux paramètres, sans casser l’ancien fonctionnement.
  // Si la page ne les envoie pas encore, on garde le calcul automatique classique.
  const academic_year = String(searchParams.get("academic_year") || "").trim();
  const period_code = String(
    searchParams.get("period_code") || searchParams.get("period") || "",
  ).trim();

  const hasDateFilter = !!from || !!to;

  if (!class_id) {
    return NextResponse.json({ error: "class_id_required" }, { status: 400 });
  }

  // Classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,label,institution_id")
    .eq("id", class_id)
    .maybeSingle();

  if (clsErr) {
    return NextResponse.json({ error: clsErr.message }, { status: 400 });
  }

  if (!cls || (cls as any).institution_id !== institution_id) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  // Chargement des réglages de conduite
  const conductSettings = await loadConductSettings(srv, institution_id);
  const RUBRIC_MAX = conductSettings.rubric_max;

  const totalMax =
    RUBRIC_MAX.assiduite +
    RUBRIC_MAX.tenue +
    RUBRIC_MAX.moralite +
    RUBRIC_MAX.discipline;

  // Durée de séance
  const defaultSessionMinutes = await loadDefaultSessionMinutes(
    srv,
    institution_id,
  );

  // ───────────────── Roster ─────────────────
  let enrollQuery = srv
    .from("class_enrollments")
    .select(
      `student_id, start_date, end_date, students:student_id ( id, first_name, last_name )`,
    )
    .eq("class_id", class_id)
    .eq("institution_id", institution_id);

  if (!hasDateFilter) {
    enrollQuery = enrollQuery.is("end_date", null);
  } else if (from) {
    enrollQuery = enrollQuery.or(`end_date.gte.${from},end_date.is.null`);
  }

  const { data: enroll, error: eErr } = await enrollQuery;

  if (eErr) {
    return NextResponse.json({ error: eErr.message }, { status: 400 });
  }

  const roster = (enroll ?? []).map((r: any) => {
    const s = r.students || {};
    return {
      student_id: s.id as string,
      full_name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "—",
    };
  });

  const studentIds = roster
    .map((r) => r.student_id)
    .filter((id): id is string => !!id);


  // ───────────────── Politique spéciale de conduite par établissement ─────────────────
  // Exemple : COURS SECONDAIRE CATHOLIQUE ABOISSO
  // Conduite finale = moyenne pondérée de Conduite classique + LATIN + RELIGION.
  // Si aucune politique n'est configurée, tout reste strictement comme avant.
  const conductPolicy = await loadInstitutionConductPolicy(srv, institution_id);
  const conductSubjectPolicies =
    conductPolicy.mode === "conduct_plus_subjects"
      ? await loadConductSubjectPolicies(srv, institution_id)
      : [];

  const conductSubjectAverageBySubject =
    conductPolicy.mode === "conduct_plus_subjects" && conductSubjectPolicies.length > 0
      ? await loadSubjectAveragesForConductPolicy(srv, {
          class_id,
          subject_ids: conductSubjectPolicies.map((p) => p.subject_id),
          student_ids: studentIds,
          from,
          to,
        })
      : new Map<string, Map<string, number>>();

  // ───────────────── Corrections officielles admin ─────────────────
  //
  // ✅ Une correction n’est appliquée que si elle est clairement rattachée à :
  // institution + classe + élève + année scolaire + période.
  //
  // ✅ Si academic_year / period_code ne sont pas encore envoyés,
  // aucun override n’est appliqué : l’ancien comportement reste intact.
  const overridesByStudent = new Map<string, ConductOverride>();

  if (academic_year && period_code && studentIds.length > 0) {
    try {
      const { data: overrideRows, error: overrideErr } = await srv
        .from("conduct_average_overrides")
        .select(
          `
          student_id,
          override_total,
          calculated_total,
          reason,
          updated_at,
          edited_by
        `,
        )
        .eq("institution_id", institution_id)
        .eq("class_id", class_id)
        .eq("academic_year", academic_year)
        .eq("period_code", period_code)
        .in("student_id", studentIds);

      if (!overrideErr && Array.isArray(overrideRows)) {
        for (const row of overrideRows as any[]) {
          const sid = String(row.student_id || "");
          const overrideTotal = Number(row.override_total);

          if (!sid || !Number.isFinite(overrideTotal)) continue;

          overridesByStudent.set(sid, {
            student_id: sid,
            override_total: Number(overrideTotal.toFixed(2)),
            calculated_total:
              row.calculated_total === null || row.calculated_total === undefined
                ? null
                : Number(row.calculated_total),
            reason: row.reason ?? null,
            updated_at: row.updated_at ?? null,
            edited_by: row.edited_by ?? null,
          });
        }
      }
    } catch {
      // Sécurité : si la table n'existe pas encore ou si une erreur survient,
      // on n'empêche jamais le calcul automatique historique.
    }
  }

  // Minutes d'absences + retards via route centralisée
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

  for (const [, arr] of byStudent) {
    arr.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }

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
        const tardyUnits = Math.floor(tardyMinutes / latenessDivisor);
        effectiveHours = absenceUnits + tardyUnits;
      } else {
        effectiveHours = absenceUnits;
      }

      // Assiduité
      let assiduite: number;

      if (effectiveHours >= assRules.max_hours_before_zero) {
        const cap = clamp(
          assRules.note_after_threshold,
          0,
          rubric_max.assiduite,
        );
        assiduite = cap;
      } else {
        assiduite = clamp(
          rubric_max.assiduite -
            assRules.penalty_per_hour * effectiveHours,
          0,
          rubric_max.assiduite,
        );

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

      // Total automatique
      let automaticTotal = assiduite + tenue + moralite + discipline;

      const hasCouncil = evs.some(
        (e) => e.event_type === "discipline_council",
      );

      if (hasCouncil) {
        automaticTotal = Math.min(
          automaticTotal,
          conductSettings.rules.discipline.council_cap,
        );
      }

      const calculatedTotal = Number(automaticTotal.toFixed(2));

      // ✅ Application de la moyenne finale officielle si l'admin a modifié.
      const override = overridesByStudent.get(student_id);
      const rawOverrideTotal = Number(override?.override_total);
      const isOverridden =
        !!override && Number.isFinite(rawOverrideTotal);

      const classicFinalTotal = isOverridden
        ? Number(clamp(rawOverrideTotal, 0, totalMax).toFixed(2))
        : calculatedTotal;

      const officialConduct = applyInstitutionConductPolicyToStudent({
        student_id,
        classic_total: classicFinalTotal,
        total_max: totalMax,
        conduct_policy: conductPolicy,
        subject_policies: conductSubjectPolicies,
        subject_averages: conductSubjectAverageBySubject,
      });

      const finalTotal = officialConduct.total;
      const appreciation = appreciationFromTotal(officialConduct.avg20);

      return {
        student_id,
        full_name,

        breakdown: {
          assiduite: Number(assiduite.toFixed(2)),
          tenue: Number(tenue.toFixed(2)),
          moralite: Number(moralite.toFixed(2)),
          discipline: Number(discipline.toFixed(2)),
        },

        // ✅ total reste le champ principal utilisé par les bulletins/exportations.
        // Désormais : total = moyenne finale officielle.
        total: finalTotal,

        // ✅ Champs supplémentaires utiles pour la page admin.
        calculated_total: calculatedTotal,
        override_total: isOverridden ? classicFinalTotal : null,
        is_overridden: isOverridden,
        override_reason: override?.reason ?? null,
        override_updated_at: override?.updated_at ?? null,
        override_edited_by: override?.edited_by ?? null,

        // ✅ Politique spéciale éventuelle : total reste le champ officiel final.
        // Les champs ci-dessous permettent de contrôler le détail sans casser l'ancien front.
        classic_total: officialConduct.classic_total,
        classic_total_avg20: officialConduct.classic_avg20,
        conduct_policy_mode: officialConduct.mode,
        conduct_policy_applied: officialConduct.policy_applied,
        conduct_final_avg20: officialConduct.avg20,
        conduct_policy_components: officialConduct.components,

        appreciation,

        // Infos absences/retards existantes
        absence_count: absenceCount,
        tardy_count: tardyCount,
        absence_minutes: Number(absenceMinutes.toFixed(0)),
        tardy_minutes: Number(tardyMinutes.toFixed(0)),
      };
    })
    .sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, {
        numeric: true,
      }),
    );

  const class_label = (cls as any).label ?? "";

  // ───────────────── CSV branch ─────────────────
  const wantsCSV =
    (searchParams.get("format") || "").toLowerCase() === "csv" ||
    (req.headers.get("accept") || "")
      .toLowerCase()
      .includes("text/csv");

  if (wantsCSV) {
    const sep = ";";
    const CRLF = "\r\n";
    const fmt = (n: number) => n.toFixed(2).replace(".", ",");

    const q = (s: string) => {
      const str = String(s ?? "");
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

    const bom = "\uFEFF";
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

  return NextResponse.json({
    class_label: class_label ?? "",
    rubric_max: RUBRIC_MAX,
    total_max: totalMax,

    // Infos utiles pour vérifier que la page envoie bien la période.
    academic_year: academic_year || null,
    period_code: period_code || null,
    overrides_enabled: !!academic_year && !!period_code,
    conduct_policy: {
      mode: conductPolicy.mode,
      is_active: conductPolicy.is_active,
      classic_conduct_weight: conductPolicy.classic_conduct_weight,
      missing_subject_strategy: conductPolicy.missing_subject_strategy,
      subjects: conductSubjectPolicies.map((p) => ({
        subject_id: p.subject_id,
        subject_name: p.subject_name,
        conduct_weight: p.conduct_weight,
      })),
    },

    items,
  });
}