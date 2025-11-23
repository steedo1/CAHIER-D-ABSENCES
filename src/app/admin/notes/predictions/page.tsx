// src/app/admin/notes/predictions/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ClassRow = {
  id: string;
  name: string;
  level?: string | null;
  academic_year?: string | null;
};

type CoreSubject = {
  subject_id: string;
  subject_name?: string;
  name?: string;
  coeff: number;
};

type CoreSubjectInput = CoreSubject & { coverage: number };

type StudentResult = {
  student_id: string;
  full_name: string;
  matricule: string;
  general_avg_20: number | null;

  academic_score: number;
  attendance_score: number;
  conduct_score: number;
  bonus_total: number;
  bonus_score: number;
  draft_ratio: number;
  draft_score: number;

  predicted_success: number;
  risk_label: string;
};

type KeySubjectScore = {
  subject_id: string;
  subject_name: string;
  coeff: number;
  coverage_percent: number;
  coverage_norm: number;
  expected_coverage_norm: number;
  eval_devoir_ratio_norm: number;
  eval_interro_ratio_norm: number;
  eval_volume_norm: number;
  status: string;
};

type PredictionMetrics = {
  class_size: number;
  predicted_success_rate: number;
  average_attendance_score: number;
  bonus_ratio: number;
  average_draft_ratio: number;
  env_size_score: number;
  coverage_score: number;
  env_score: number;
  class_general_avg_20: number | null;
};

type PredictionResponse = {
  ok: boolean;
  class: {
    id: string;
    label?: string | null;
    level?: string | null;
    academic_year?: string | null;
  };
  input: {
    academic_year: string;
    exam_date: string;
    key_subjects_coverage: number;
  };
  metrics: PredictionMetrics & {
    expected_coverage_percent?: number;
    coverage_gap_percent?: number;
    evals_devoir_done?: number;
    evals_interro_done?: number;
    evals_total_done?: number;
    evals_devoir_expected?: number;
    evals_interro_expected?: number;
    evals_devoir_ratio?: number;
    evals_interro_ratio?: number;
    days_to_exam?: number;
  };
  recommendations: string[];
  students: StudentResult[];
  key_subjects?: KeySubjectScore[];
};

/* ───────── UI helpers ───────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className || "",
      ].join(" ")}
    />
  );
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        p.className || "",
      ].join(" ")}
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium shadow",
        "bg-emerald-600 text-white hover:bg-emerald-700",
        p.disabled ? "opacity-60 cursor-not-allowed" : "",
        p.className || "",
      ].join(" ")}
    />
  );
}

async function fetchJSON<T = any>(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error(j?.error || j?.message || "Erreur");
  return j as T;
}

export default function PredictionsPage() {
  // ─────────────────────────────
  // 1) Chargement des classes
  // ─────────────────────────────
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [authErr, setAuthErr] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);

  const [levelFilter, setLevelFilter] = useState<string>("");
  const [classId, setClassId] = useState<string>("");

  // Date d’examen (par défaut aujourd’hui au format YYYY-MM-DD)
  const [examDate, setExamDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  // ─────────────────────────────
  // 2) Matières clés (top coeffs)
  // ─────────────────────────────
  const [coreSubjects, setCoreSubjects] = useState<CoreSubjectInput[]>([]);
  const [loadingCore, setLoadingCore] = useState(false);

  // ─────────────────────────────
  // 3) Résultat du modèle
  // ─────────────────────────────
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResponse | null>(null);

  // Charger les classes une seule fois
  useEffect(() => {
    (async () => {
      try {
        const j = await fetchJSON<{ items: any[] }>("/api/admin/classes?limit=999");
        const items = (j.items || []).map((x: any) => ({
          id: String(x.id),
          name: String(x.name ?? x.label ?? "Classe"),
          level: x.level ?? null,
          academic_year: x.academic_year ?? null,
        })) as ClassRow[];
        setClasses(items);
      } catch (e: any) {
        if (e.message === "unauthorized") setAuthErr(true);
        else alert(e.message || "Erreur chargement classes");
      } finally {
        setLoadingInit(false);
      }
    })();
  }, []);

  const levels = useMemo(
    () =>
      Array.from(
        new Set(classes.map((c) => c.level).filter((x): x is string => !!x))
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [classes]
  );

  const filteredClasses = useMemo(
    () => classes.filter((c) => !levelFilter || c.level === levelFilter),
    [classes, levelFilter]
  );

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === classId) || null,
    [classes, classId]
  );

  // Charger les matières clés dès qu’une classe est choisie
  useEffect(() => {
    if (!classId) {
      setCoreSubjects([]);
      return;
    }
    (async () => {
      setLoadingCore(true);
      setError(null);
      setResult(null);
      try {
        const url = `/api/admin/notes/core-subjects?class_id=${encodeURIComponent(
          classId
        )}`;
        const j = await fetchJSON<{ items: CoreSubject[] }>(url);
        const items = j.items || [];
        if (items.length === 0) {
          setCoreSubjects([]);
          return;
        }
        // Par défaut, on met 60 % partout (l’admin ajuste)
        const withCoverage: CoreSubjectInput[] = items.map((s) => ({
          ...s,
          coverage: 60,
        }));
        setCoreSubjects(withCoverage);
      } catch (e: any) {
        if (e.message === "unauthorized") setAuthErr(true);
        else setError(e.message || "Erreur chargement des matières clés");
      } finally {
        setLoadingCore(false);
      }
    })();
  }, [classId]);

  // Couverture pondérée globale (utilisée pour le modèle)
  const coverageWeighted = useMemo(() => {
    if (!coreSubjects.length) return 0;
    const totalCoeff = coreSubjects.reduce((sum, s) => sum + (s.coeff || 0), 0);
    if (!totalCoeff) return 0;
    const value =
      coreSubjects.reduce(
        (sum, s) => sum + (s.coverage || 0) * (s.coeff / totalCoeff),
        0
      ) || 0;
    return Math.round(value);
  }, [coreSubjects]);

  // ─────────────────────────────
  // 4) Lancer la prédiction
  // ─────────────────────────────
  async function runPrediction() {
    setError(null);
    setResult(null);

    if (!classId) {
      setError("Veuillez d’abord choisir une classe.");
      return;
    }
    if (!examDate) {
      setError("Veuillez saisir une date d’examen.");
      return;
    }
    if (!selectedClass?.academic_year) {
      setError(
        "Année scolaire inconnue pour cette classe. Vérifiez la configuration des classes."
      );
      return;
    }

    setRunning(true);
    try {
      const payload = {
        class_id: classId,
        academic_year: selectedClass.academic_year,
        exam_date: examDate, // déjà au format YYYY-MM-DD
        key_subjects_coverage: coverageWeighted,
        key_subjects: coreSubjects.map((s) => ({
          subject_id: s.subject_id,
          name: s.subject_name || s.name || "Discipline",
          coeff: s.coeff,
          coverage: s.coverage,
        })),
      };

      const r = await fetch("/api/admin/notes/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = (await r.json().catch(() => ({}))) as any;

      if (r.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!r.ok || !j.ok) {
        setError(j?.message || j?.error || "Erreur lors du calcul de la prédiction.");
        return;
      }

      setResult(j as PredictionResponse);
    } catch (e: any) {
      setError(e.message || "Erreur lors du calcul de la prédiction.");
    } finally {
      setRunning(false);
    }
  }

  function resetForm() {
    setLevelFilter("");
    setClassId("");
    setCoreSubjects([]);
    setResult(null);
    setError(null);
  }

  if (authErr) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <div className="text-sm text-slate-700">
          Votre session a expiré.{" "}
          <button
            className="text-emerald-700 underline"
            onClick={() => (window.location.href = "/login")}
          >
            Se reconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Prédiction de la réussite de la classe</h1>
        <p className="text-sm text-slate-600">
          Simulez le taux de réussite probable d&apos;une classe à une date donnée en tenant
          compte des notes, des absences, de la conduite et de l&apos;avancement du programme
          dans les matières clés.
        </p>
      </div>

      {/* ÉTAPE 1 – Choisir la classe et la date */}
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5 space-y-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          ÉTAPE 1 • CHOISIR LA CLASSE ET LA DATE D&apos;EXAMEN
        </div>

        {loadingInit ? (
          <div className="text-sm text-slate-600">Chargement des classes…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <div className="mb-1 text-xs text-slate-600">Filtrer par niveau</div>
                <Select
                  value={levelFilter}
                  onChange={(e) => {
                    setLevelFilter(e.target.value);
                    setClassId("");
                    setCoreSubjects([]);
                    setResult(null);
                  }}
                >
                  <option value="">— Tous les niveaux —</option>
                  {levels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <div className="mb-1 text-xs text-slate-600">Classe</div>
                <Select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  disabled={filteredClasses.length === 0}
                >
                  <option value="">
                    {filteredClasses.length ? "— Choisir —" : "Aucune classe"}
                  </option>
                  {filteredClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.level ? `(${c.level})` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <div className="mb-1 text-xs text-slate-600">
                  Date d&apos;examen (prévision)
                </div>
                <Input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
              <div className="font-medium text-emerald-800 mb-0.5">Classe sélectionnée</div>
              <div>
                Classe :{" "}
                {selectedClass
                  ? `${selectedClass.name}${
                      selectedClass.level ? ` (${selectedClass.level})` : ""
                    }`
                  : "—"}
              </div>
              <div>
                Année scolaire :{" "}
                {selectedClass?.academic_year ? selectedClass.academic_year : "—"}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ÉTAPE 2 – Saisir l’exécution du programme */}
      <div className="rounded-2xl border border-sky-100 bg-sky-50 p-5 space-y-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">
          ÉTAPE 2 • SAISIR L&apos;EXÉCUTION DU PROGRAMME
        </div>
        <p className="text-[12px] text-sky-900/80">
          Indiquez l&apos;avancement (en %) dans les matières clés. La plateforme calcule
          automatiquement une couverture globale pondérée selon les coefficients.
        </p>

        <div className="text-xs font-medium text-slate-700 mb-1">
          Matières clés (3 plus gros coefficients pour ce niveau)
        </div>

        {loadingCore && classId && (
          <div className="text-sm text-slate-600">Chargement des matières clés…</div>
        )}

        {!classId && (
          <div className="text-sm text-slate-600">
            Choisissez d&apos;abord une classe pour voir les matières clés.
          </div>
        )}

        {classId && !loadingCore && coreSubjects.length === 0 && (
          <div className="text-sm text-slate-600">
            Aucune matière clé configurée (coeffs) pour ce niveau. Configure les coefficients
            dans le catalogue des disciplines.
          </div>
        )}

        {coreSubjects.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {coreSubjects.map((s, idx) => {
                const label = s.subject_name || s.name || "Discipline";
                return (
                  <div
                    key={s.subject_id}
                    className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="text-sm font-semibold text-slate-800">
                      {label}
                    </div>
                    <div className="text-[11px] text-slate-500 mb-2">
                      Coefficient : {s.coeff}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={s.coverage}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setCoreSubjects((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    coverage:
                                      !Number.isFinite(val) || val < 0
                                        ? 0
                                        : val > 100
                                        ? 100
                                        : val,
                                  }
                                : x
                            )
                          );
                          setResult(null);
                        }}
                      />
                      <span className="text-sm text-slate-700">%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-900">
                  Couverture globale des matières clés (pondérée)
                </div>
                <div className="text-[12px] text-sky-900/80">
                  La valeur est calculée automatiquement à partir des coefficients et des
                  pourcentages ci-dessus.
                </div>
              </div>
              <div className="text-2xl font-bold text-sky-900">
                {coverageWeighted}
                <span className="ml-1 text-base font-semibold">%</span>
              </div>
            </div>

            <div className="text-[12px] text-slate-600">
              Couverture envoyée au modèle : <b>{coverageWeighted}%</b>
            </div>
          </>
        )}
      </div>

      {/* Barre d’actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={runPrediction}
          disabled={
            running ||
            !classId ||
            !examDate ||
            !selectedClass?.academic_year ||
            coreSubjects.length === 0
          }
        >
          {running ? "Calcul en cours…" : "Lancer la prédiction"}
        </Button>
        <button
          type="button"
          onClick={resetForm}
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Réinitialiser
        </button>
        {result && (
          <span className="text-[12px] text-slate-600">
            Prédiction calculée pour le {result.input.exam_date} — couverture{" "}
            {result.input.key_subjects_coverage}%.
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Résultats du modèle */}
      {result && (
        <div className="space-y-5">
          {/* KPIs de synthèse */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Taux de réussite prédit
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-700">
                {result.metrics.predicted_success_rate.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Assiduité moyenne
              </div>
              <div className="mt-2 text-2xl font-bold text-sky-700">
                {result.metrics.average_attendance_score.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Score environnement (taille &amp; couverture)
              </div>
              <div className="mt-2 text-2xl font-bold text-indigo-700">
                {result.metrics.env_score.toFixed(1)}/100
              </div>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Effectif de la classe
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-800">
                {result.metrics.class_size}
              </div>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Moyenne générale de la classe
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-800">
                {result.metrics.class_general_avg_20 == null
                  ? "—"
                  : `${result.metrics.class_general_avg_20.toFixed(2)}/20`}
              </div>
            </div>
          </div>

          {/* Synthèse par matière clé */}
          {result.key_subjects && result.key_subjects.length > 0 && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-900">
                Synthèse par matière clé
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-indigo-100/60">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Matière
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Coeff
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Couverture
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Couverture attendue
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Volume d&apos;évals (4+4)
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Statut
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.key_subjects.map((s) => {
                      const label = s.subject_name || "Discipline";
                      const cov = s.coverage_percent ?? 0;
                      const covDisplay = `${cov.toFixed(0)}%`;
                      const expectedPct = Math.round(
                        Math.max(0, Math.min(1, s.expected_coverage_norm || 0)) * 100
                      );
                      const volumePct = Math.round(
                        Math.max(0, Math.min(1.5, s.eval_volume_norm || 0)) * 100
                      );

                      let statusClass =
                        "bg-emerald-50 text-emerald-800 border border-emerald-200";
                      let statusLabel = "Au niveau";
                      if (s.status === "en_retard") {
                        statusClass =
                          "bg-rose-50 text-rose-800 border border-rose-200";
                        statusLabel = "En retard";
                      } else if (s.status === "en_bonne_voie") {
                        statusClass =
                          "bg-amber-50 text-amber-800 border border-amber-200";
                        statusLabel = "En bonne voie";
                      }

                      return (
                        <tr key={s.subject_id} className="bg-white odd:bg-indigo-50/40">
                          <td className="px-3 py-1.5">
                            <div className="font-medium text-slate-800">{label}</div>
                          </td>
                          <td className="px-3 py-1.5 text-right">{s.coeff}</td>
                          <td className="px-3 py-1.5 text-right">{covDisplay}</td>
                          <td className="px-3 py-1.5 text-right">
                            {expectedPct}
                            <span className="ml-1 text-[10px] text-slate-500">%</span>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {volumePct}
                            <span className="ml-1 text-[10px] text-slate-500">%</span>
                          </td>
                          <td className="px-3 py-1.5 text-left">
                            <span
                              className={[
                                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                                statusClass,
                              ].join(" ")}
                            >
                              {statusLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.recommendations?.length > 0 && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900 mb-1">
                Recommandations pour l&apos;établissement
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                {result.recommendations.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Tableau élèves */}
          {result.students?.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b px-4 py-2 text-sm font-semibold text-slate-800">
                Détail par élève
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Élève
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Moy. gén. /20
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Score académique
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Assiduité
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Conduite
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Bonus total
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Score bonus
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Ratio brouillon
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Score brouillon
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Prob. réussite
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Risque
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.students]
                      // ⇩⇩⇩ TRI ALPHABÉTIQUE PAR NOM + PRÉNOM ⇩⇩⇩
                      .sort((a, b) => {
                        const nameA = (a.full_name || "").toLocaleUpperCase();
                        const nameB = (b.full_name || "").toLocaleUpperCase();
                        if (!nameA && !nameB) return 0;
                        if (!nameA) return 1;
                        if (!nameB) return -1;
                        return nameA.localeCompare(nameB, "fr", {
                          sensitivity: "base",
                        });
                      })
                      // ⇧⇧⇧ au lieu de trier sur predicted_success ⇧⇧⇧
                      .map((s, idx) => (
                        <tr
                          key={s.student_id}
                          className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                        >
                          <td className="px-3 py-1.5">
                            <div className="font-medium text-slate-800">
                              {s.full_name || s.matricule || "—"}
                            </div>
                            {s.matricule && (
                              <div className="text-[11px] text-slate-500">
                                Matricule : {s.matricule}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-800">
                            {s.general_avg_20 == null
                              ? "—"
                              : s.general_avg_20.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {s.academic_score.toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {s.attendance_score.toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {s.conduct_score.toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {s.bonus_total.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {s.bonus_score.toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {(s.draft_ratio * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {s.draft_score.toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">
                            {s.predicted_success.toFixed(1)}%
                          </td>
                          <td className="px-3 py-1.5 text-left">
                            <span
                              className={[
                                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                                s.risk_label === "Faible risque"
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : s.risk_label === "Risque moyen"
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : "bg-rose-50 text-rose-800 border border-rose-200",
                              ].join(" ")}
                            >
                              {s.risk_label}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
