// src/app/admin/notes/predictions/page.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  Loader2,
  RefreshCcw,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

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
  status: "au_niveau" | "en_bonne_voie" | "en_retard";
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

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

function clampCoverage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

async function fetchJSON<T = any>(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error(j?.error || j?.message || "Erreur");
  return j as T;
}

/* ───────── UI helpers ───────── */

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800",
        "shadow-sm outline-none transition placeholder:text-slate-400",
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
        "w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
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
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold shadow-sm transition",
        "bg-emerald-600 text-white hover:bg-emerald-700",
        p.disabled ? "cursor-not-allowed opacity-60" : "",
        p.className || "",
      ].join(" ")}
    />
  );
}

function GhostButton(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50",
        p.disabled ? "cursor-not-allowed opacity-60" : "",
        p.className || "",
      ].join(" ")}
    />
  );
}

function SectionCard({
  children,
  title,
  subtitle,
  icon,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-1 text-sm leading-6 text-slate-600">{subtitle}</div>
          ) : null}
        </div>

        {icon ? (
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700">
            {icon}
          </div>
        ) : null}
      </div>

      {children}
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint: string;
  tone?: "slate" | "emerald" | "amber" | "violet" | "sky";
}) {
  const tones: Record<
    NonNullable<typeof tone>,
    {
      wrap: string;
      iconWrap: string;
      value: string;
    }
  > = {
    slate: {
      wrap: "border-slate-200 bg-white",
      iconWrap: "bg-slate-100 text-slate-700",
      value: "text-slate-900",
    },
    emerald: {
      wrap: "border-emerald-200 bg-emerald-50/60",
      iconWrap: "bg-emerald-100 text-emerald-700",
      value: "text-emerald-800",
    },
    amber: {
      wrap: "border-amber-200 bg-amber-50/70",
      iconWrap: "bg-amber-100 text-amber-700",
      value: "text-amber-800",
    },
    violet: {
      wrap: "border-violet-200 bg-violet-50/70",
      iconWrap: "bg-violet-100 text-violet-700",
      value: "text-violet-800",
    },
    sky: {
      wrap: "border-sky-200 bg-sky-50/70",
      iconWrap: "bg-sky-100 text-sky-700",
      value: "text-sky-800",
    },
  };

  const t = tones[tone];

  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${t.wrap}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className={`mt-2 text-3xl font-black ${t.value}`}>{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>

        <div className={`grid h-12 w-12 place-items-center rounded-2xl ${t.iconWrap}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function InlineLoading({
  text,
  tone = "slate",
}: {
  text: string;
  tone?: "slate" | "sky" | "emerald";
}) {
  const styles =
    tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium ${styles}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{text}</span>
    </div>
  );
}

function FullscreenLoading({
  open,
  text,
}: {
  open: boolean;
  text: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-[28px] border border-white/15 bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
        <div className="mt-4 text-lg font-black text-slate-900">Chargement en cours</div>
        <div className="mt-2 text-sm text-slate-600">{text}</div>
      </div>
    </div>
  );
}

function RiskPill({ label }: { label: string }) {
  const klass =
    label === "Faible risque"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
      : label === "Risque moyen"
        ? "border border-amber-200 bg-amber-50 text-amber-800"
        : "border border-rose-200 bg-rose-50 text-rose-800";

  return (
    <span
      className={[
        "inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold",
        klass,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function SubjectStatusPill({ status }: { status: KeySubjectScore["status"] }) {
  let klass = "border border-emerald-200 bg-emerald-50 text-emerald-800";
  let label = "Au niveau";

  if (status === "en_retard") {
    klass = "border border-rose-200 bg-rose-50 text-rose-800";
    label = "En retard";
  } else if (status === "en_bonne_voie") {
    klass = "border border-amber-200 bg-amber-50 text-amber-800";
    label = "En bonne voie";
  }

  return (
    <span
      className={[
        "inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold",
        klass,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export default function PredictionsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [authErr, setAuthErr] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);

  const [levelFilter, setLevelFilter] = useState<string>("");
  const [classId, setClassId] = useState<string>("");

  const [examDate, setExamDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [coreSubjects, setCoreSubjects] = useState<CoreSubjectInput[]>([]);
  const [loadingCore, setLoadingCore] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const j = await fetchJSON<{ items: any[] }>("/api/admin/classes?limit=999");
        const items = (j.items || []).map((x: any) => ({
          id: String(x.id),
          name: String(x.name ?? x.label ?? "Classe"),
          level: x.level ?? null,
          academic_year: x.academic_year ?? null,
        })) as ClassRow[];

        if (!cancelled) {
          setClasses(items);
        }
      } catch (e: any) {
        if (cancelled) return;
        if (e.message === "unauthorized") setAuthErr(true);
        else setError(e.message || "Erreur chargement classes");
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    let cancelled = false;

    if (!classId) {
      setCoreSubjects([]);
      return;
    }

    (async () => {
      setLoadingCore(true);
      setError(null);
      setResult(null);

      try {
        const url = `/api/admin/notes/core-subjects?class_id=${encodeURIComponent(classId)}`;
        const j = await fetchJSON<{ items: CoreSubject[] }>(url);
        const items = j.items || [];

        if (cancelled) return;

        if (!items.length) {
          setCoreSubjects([]);
          return;
        }

        const withCoverage: CoreSubjectInput[] = items.map((s) => ({
          ...s,
          coverage: 60,
        }));

        setCoreSubjects(withCoverage);
      } catch (e: any) {
        if (cancelled) return;
        if (e.message === "unauthorized") setAuthErr(true);
        else setError(e.message || "Erreur chargement des matières clés");
      } finally {
        if (!cancelled) setLoadingCore(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classId]);

  const coverageWeighted = useMemo(() => {
    if (!coreSubjects.length) return 0;

    const totalCoeff = coreSubjects.reduce((sum, s) => sum + (s.coeff || 0), 0);
    if (!totalCoeff) return 0;

    const value =
      coreSubjects.reduce(
        (sum, s) => sum + (s.coverage || 0) * ((s.coeff || 0) / totalCoeff),
        0
      ) || 0;

    return Math.round(value);
  }, [coreSubjects]);

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
        exam_date: examDate,
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
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>

          <div>
            <div className="text-base font-black text-slate-900">Session expirée</div>
            <div className="mt-1 text-sm text-slate-600">
              Votre session a expiré. Reconnectez-vous pour continuer.
            </div>
            <button
              className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              onClick={() => (window.location.href = "/login")}
            >
              Se reconnecter
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasResult = !!result;

  return (
    <>
      <FullscreenLoading
        open={running}
        text="La prédiction est en cours de calcul. Merci de patienter..."
      />

      <div className="space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
                <BrainCircuit className="h-3.5 w-3.5" />
                Prédiction pédagogique
              </div>

              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                Prédiction de la réussite de la classe
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
                Simulez le taux de réussite probable d&apos;une classe à une date donnée en
                tenant compte des notes, des absences, de la conduite et de l&apos;avancement
                du programme dans les matières clés.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                  Vue prédictive
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Matières clés pondérées
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Chargement visuel actif
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                  Classes chargées
                </div>
                <div className="mt-2 text-3xl font-black text-white">
                  {loadingInit ? "…" : classes.length}
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  Niveaux détectés : {loadingInit ? "…" : levels.length}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                  Couverture pondérée
                </div>
                <div className="mt-2 text-3xl font-black text-white">
                  {coverageWeighted}%
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  Matières clés : {coreSubjects.length}
                </div>
              </div>
            </div>
          </div>
        </section>

        {loadingInit ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <InlineLoading text="Chargement des classes..." tone="emerald" />
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
              </div>

              <div>
                <div className="text-sm font-black uppercase tracking-[0.16em] text-rose-800">
                  Erreur
                </div>
                <div className="mt-1 text-sm text-rose-800">{error}</div>
              </div>
            </div>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<GraduationCap className="h-6 w-6" />}
            label="Classe choisie"
            value={selectedClass ? selectedClass.name : "—"}
            hint={selectedClass?.level ? `Niveau : ${selectedClass.level}` : "Aucune classe"}
            tone="slate"
          />

          <StatCard
            icon={<CalendarClock className="h-6 w-6" />}
            label="Date d’examen"
            value={examDate || "—"}
            hint={selectedClass?.academic_year || "Année scolaire inconnue"}
            tone="sky"
          />

          <StatCard
            icon={<Target className="h-6 w-6" />}
            label="Couverture pondérée"
            value={`${coverageWeighted}%`}
            hint={`${coreSubjects.length} matière(s) clé(s)`}
            tone="amber"
          />

          <StatCard
            icon={<BarChart3 className="h-6 w-6" />}
            label="Taux prédit"
            value={
              hasResult
                ? `${result.metrics.predicted_success_rate.toFixed(1)}%`
                : "—"
            }
            hint={hasResult ? "Dernier calcul effectué" : "Aucun calcul encore"}
            tone="violet"
          />
        </section>

        <SectionCard
          title="Étape 1 • Choisir la classe et la date d’examen"
          subtitle="Sélectionnez le niveau, la classe concernée et la date prévue d’examen."
          icon={<Users className="h-5 w-5" />}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                Filtrer par niveau
              </div>
              <Select
                value={levelFilter}
                onChange={(e) => {
                  setLevelFilter(e.target.value);
                  setClassId("");
                  setCoreSubjects([]);
                  setResult(null);
                }}
                disabled={loadingInit}
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
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                Classe
              </div>
              <Select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                disabled={filteredClasses.length === 0 || loadingInit}
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
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                Date d&apos;examen
              </div>
              <Input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                disabled={loadingInit}
              />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
              Classe sélectionnée
            </div>

            <div className="mt-2 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              <div>
                <span className="font-semibold text-slate-900">Classe :</span>{" "}
                {selectedClass
                  ? `${selectedClass.name}${selectedClass.level ? ` (${selectedClass.level})` : ""}`
                  : "—"}
              </div>
              <div>
                <span className="font-semibold text-slate-900">Année scolaire :</span>{" "}
                {selectedClass?.academic_year || "—"}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Étape 2 • Saisir l’exécution du programme"
          subtitle="Indiquez l’avancement en pourcentage dans les matières clés. La couverture globale est calculée automatiquement."
          icon={<Activity className="h-5 w-5" />}
        >
          <div className="space-y-4">
            {!classId ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                Choisissez d&apos;abord une classe pour voir les matières clés.
              </div>
            ) : null}

            {loadingCore && classId ? (
              <InlineLoading
                text="Chargement des matières clés..."
                tone="sky"
              />
            ) : null}

            {classId && !loadingCore && coreSubjects.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                Aucune matière clé configurée pour ce niveau. Vérifie les coefficients dans le
                catalogue des disciplines.
              </div>
            ) : null}

            {coreSubjects.length > 0 ? (
              <>
                <div className="rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-4">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-sky-900">
                    Matières clés retenues
                  </div>
                  <div className="mt-1 text-sm text-sky-900/90">
                    {coreSubjects.length} matière(s) clé(s) détectée(s) pour cette classe.
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {coreSubjects.map((s, idx) => {
                    const label = s.subject_name || s.name || "Discipline";

                    return (
                      <div
                        key={s.subject_id}
                        className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-black text-slate-900">{label}</div>
                            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Coefficient : {s.coeff}
                            </div>
                          </div>

                          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                            <Sparkles className="h-5 w-5" />
                          </div>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
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
                                        coverage: clampCoverage(val),
                                      }
                                    : x
                                )
                              );
                              setResult(null);
                            }}
                          />
                          <span className="text-sm font-bold text-slate-700">%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 rounded-3xl border border-sky-200 bg-sky-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-sky-900">
                      Couverture globale pondérée
                    </div>
                    <div className="mt-1 text-sm text-sky-900/80">
                      Calcul automatique à partir des coefficients et des pourcentages saisis.
                    </div>
                  </div>

                  <div className="text-3xl font-black text-sky-900">
                    {coverageWeighted}
                    <span className="ml-1 text-lg font-bold">%</span>
                  </div>
                </div>

                <div className="text-sm text-slate-600">
                  Couverture envoyée au modèle :{" "}
                  <span className="font-black text-slate-900">{coverageWeighted}%</span>
                </div>
              </>
            ) : null}
          </div>
        </SectionCard>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={runPrediction}
            disabled={
              running ||
              !classId ||
              !examDate ||
              !selectedClass?.academic_year ||
              coreSubjects.length === 0 ||
              loadingCore ||
              loadingInit
            }
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Calcul en cours...
              </>
            ) : (
              <>
                <BrainCircuit className="h-4 w-4" />
                Lancer la prédiction
              </>
            )}
          </Button>

          <GhostButton type="button" onClick={resetForm} disabled={running}>
            <RefreshCcw className="h-4 w-4" />
            Réinitialiser
          </GhostButton>

          {result ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              Prédiction calculée pour le {result.input.exam_date} — couverture{" "}
              {result.input.key_subjects_coverage}%.
            </span>
          ) : null}
        </div>

        {result ? (
          <div className="space-y-6">
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard
                icon={<Target className="h-6 w-6" />}
                label="Taux de réussite prédit"
                value={`${result.metrics.predicted_success_rate.toFixed(1)}%`}
                hint="Projection de la classe"
                tone="emerald"
              />
              <StatCard
                icon={<Activity className="h-6 w-6" />}
                label="Assiduité moyenne"
                value={formatPercent(result.metrics.average_attendance_score)}
                hint="Score moyen d’assiduité"
                tone="sky"
              />
              <StatCard
                icon={<Sparkles className="h-6 w-6" />}
                label="Score environnement"
                value={`${result.metrics.env_score.toFixed(1)}/100`}
                hint="Taille + couverture"
                tone="violet"
              />
              <StatCard
                icon={<Users className="h-6 w-6" />}
                label="Effectif"
                value={result.metrics.class_size}
                hint="Taille de la classe"
                tone="amber"
              />
              <StatCard
                icon={<GraduationCap className="h-6 w-6" />}
                label="Moyenne générale"
                value={
                  result.metrics.class_general_avg_20 == null
                    ? "—"
                    : `${result.metrics.class_general_avg_20.toFixed(2)}/20`
                }
                hint="Moyenne de la classe"
                tone="slate"
              />
            </section>

            {result.key_subjects && result.key_subjects.length > 0 ? (
              <SectionCard
                title="Synthèse par matière clé"
                subtitle="Vue consolidée de la couverture, du volume d’évaluations et du statut d’avancement."
                icon={<BarChart3 className="h-5 w-5" />}
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="px-3 py-3 text-left font-black text-slate-700">
                          Matière
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Coeff
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Couverture
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Couverture attendue
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Volume d’évals
                        </th>
                        <th className="px-3 py-3 text-left font-black text-slate-700">
                          Statut
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.key_subjects.map((s, idx) => {
                        const label = s.subject_name || "Discipline";
                        const cov = s.coverage_percent ?? 0;
                        const expectedPct = Math.round(
                          Math.max(0, Math.min(1, s.expected_coverage_norm || 0)) * 100
                        );
                        const volumePct = Math.round(
                          Math.max(0, Math.min(1.5, s.eval_volume_norm || 0)) * 100
                        );

                        return (
                          <tr
                            key={s.subject_id}
                            className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                          >
                            <td className="px-3 py-3">
                              <div className="font-bold text-slate-900">{label}</div>
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">{s.coeff}</td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {cov.toFixed(0)}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {expectedPct}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {volumePct}%
                            </td>
                            <td className="px-3 py-3">
                              <SubjectStatusPill status={s.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            ) : null}

            {result.recommendations?.length > 0 ? (
              <SectionCard
                title="Recommandations pour l’établissement"
                subtitle="Actions proposées à partir des indicateurs calculés."
                icon={<Sparkles className="h-5 w-5" />}
              >
                <ul className="space-y-3">
                  {result.recommendations.map((r, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}

            {result.students?.length > 0 ? (
              <SectionCard
                title="Détail par élève"
                subtitle="Vue détaillée des scores académiques, d’assiduité, de conduite et de la probabilité de réussite."
                icon={<Users className="h-5 w-5" />}
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="px-3 py-3 text-left font-black text-slate-700">Élève</th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Moy. gén. /20
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Score académique
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Assiduité
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Conduite
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Bonus total
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Score bonus
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Ratio brouillon
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Score brouillon
                        </th>
                        <th className="px-3 py-3 text-right font-black text-slate-700">
                          Prob. réussite
                        </th>
                        <th className="px-3 py-3 text-left font-black text-slate-700">
                          Risque
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...result.students]
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
                        .map((s, idx) => (
                          <tr
                            key={s.student_id}
                            className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                          >
                            <td className="px-3 py-3">
                              <div className="font-bold text-slate-900">
                                {s.full_name || s.matricule || "—"}
                              </div>
                              {s.matricule ? (
                                <div className="text-xs text-slate-500">
                                  Matricule : {s.matricule}
                                </div>
                              ) : null}
                            </td>

                            <td className="px-3 py-3 text-right text-slate-800">
                              {s.general_avg_20 == null ? "—" : s.general_avg_20.toFixed(2)}
                            </td>

                            <td className="px-3 py-3 text-right text-slate-700">
                              {s.academic_score.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {s.attendance_score.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {s.conduct_score.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {s.bonus_total.toFixed(2)}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {s.bonus_score.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {(s.draft_ratio * 100).toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {s.draft_score.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-right font-black text-slate-900">
                              {s.predicted_success.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3">
                              <RiskPill label={s.risk_label} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}