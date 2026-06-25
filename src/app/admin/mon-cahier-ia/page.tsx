"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  GraduationCap,
  Loader2,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

type AcademicYear = {
  id?: string;
  code: string;
  label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
};

type ClassItem = {
  id: string;
  label: string | null;
  level: string | null;
  academic_year?: string | null;
};

type BootstrapResponse = {
  ok: boolean;
  error?: string;
  current_academic_year?: AcademicYear | null;
  academic_years?: AcademicYear[];
  classes?: ClassItem[];
  presets?: string[];
  ethics_notice?: string;
};

type StudentSignal = {
  student_id: string;
  full_name: string;
  matricule?: string | null;
  class_label: string;
  class_level?: string | null;
  general_avg_20: number | null;
  core_avg_20?: number | null;
  presence_rate?: number | null;
  conduct_total_20?: number | null;
  p_success: number | null;
  risk_level: "low" | "medium" | "high";
  priority_score: number;
  reasons: string[];
};

type ClassSignal = {
  class_id: string;
  class_label: string;
  class_level?: string | null;
  students_count: number;
  avg_success_probability: number | null;
  avg_general_20: number | null;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  risk_index: number;
  main_reasons: string[];
};

type SubjectSignal = {
  class_id: string;
  class_label: string;
  class_level?: string | null;
  subject_id: string;
  subject_name: string;
  evaluations_count: number;
  notes_count: number;
  avg_score_20: number | null;
  weak_students_count: number;
  blocker_score: number;
};

type AiAnswer = {
  intent: string;
  title: string;
  summary: string;
  confidence: number;
  recommendations: string[];
  students_to_follow: StudentSignal[];
  classes_at_risk: ClassSignal[];
  blocking_subjects: SubjectSignal[];
  council_note?: string;
  remediation_plan?: string[];
  model: {
    key: string;
    version: string;
    source: "rules_baseline" | "ml_service" | "hybrid";
  };
  ethics_notice: string;
};

type AssistantResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  answer?: AiAnswer;
  context_meta?: {
    classes_count: number;
    students_count: number;
    subjects_count: number;
    warnings?: string[];
    model_source?: string;
    model_version?: string;
  };
};

const DEFAULT_PRESETS = [
  "Quels élèves doivent être suivis en priorité avant les examens ?",
  "Quelle classe a le plus fort risque de baisse ?",
  "Quelles matières bloquent les élèves ?",
  "Résume-moi la situation pédagogique de cette école.",
  "Prépare une note pour le conseil de classe.",
  "Propose un plan de remédiation.",
];

function normalizeForQuestion(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function levelExamLabel(level: string | null | undefined) {
  const normalized = normalizeForQuestion(level);
  if (normalized.includes("3e") || normalized.includes("troisieme")) return "avant le BEPC";
  if (normalized.includes("tle") || normalized.includes("terminal") || normalized.includes("terminale")) return "avant le BAC";
  return "avant les examens";
}

function buildScopePresets(args: { classLabel?: string | null; level?: string | null }) {
  const scope = String(args.classLabel || args.level || "").trim();
  const exam = levelExamLabel(args.level || args.classLabel);
  const studentScope = scope ? `de ${scope}` : "";
  const classScope = scope ? `dans ${scope}` : "dans l’établissement";

  return [
    `Quels élèves ${studentScope} doivent être suivis en priorité ${exam} ?`.replace(/\s+/g, " ").trim(),
    scope ? `Quels signaux fragilisent ${scope} ?` : "Quelle classe a le plus fort risque de baisse ?",
    scope ? `Quelles matières bloquent les élèves de ${scope} ?` : "Quelles matières bloquent les élèves ?",
    `Résume-moi la situation pédagogique ${classScope}.`,
    scope ? `Prépare une note pour le conseil de classe de ${scope}.` : "Prépare une note pour le conseil de classe.",
    scope ? `Propose un plan de remédiation pour ${scope}.` : "Propose un plan de remédiation.",
  ];
}

function todayPlusMonths(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function fmtAvg(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(2).replace(".", ",")}/20`;
}

function fmtPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function sourceLabel(source?: string) {
  if (source === "ml_service") return "Modèle ML entraîné";
  if (source === "hybrid") return "Hybride règles + ML";
  return "Socle explicable";
}

function riskStyle(level: string) {
  if (level === "high") return "border-red-200 bg-red-50 text-red-800";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export default function MonCahierIaPage() {
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [presets, setPresets] = useState<string[]>(DEFAULT_PRESETS);
  const [academicYear, setAcademicYear] = useState("");
  const [classId, setClassId] = useState("");
  const [level, setLevel] = useState("");
  const [examDate, setExamDate] = useState(todayPlusMonths(3));
  const [completion, setCompletion] = useState(60);
  const [question, setQuestion] = useState(DEFAULT_PRESETS[0]);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [meta, setMeta] = useState<AssistantResponse["context_meta"] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/mon-cahier-ia/bootstrap", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as BootstrapResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Impossible de charger Mon Cahier IA.");
        }

        if (cancelled) return;
        const nextYears = json.academic_years || [];
        const current = json.current_academic_year || nextYears.find((y) => y.is_current) || nextYears[0] || null;
        setYears(nextYears);
        setClasses(json.classes || []);
        setPresets(json.presets?.length ? json.presets : DEFAULT_PRESETS);
        setAcademicYear(current?.code || "");
        if (current?.end_date) setExamDate(String(current.end_date).slice(0, 10));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Chargement impossible.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredClasses = useMemo(() => {
    return classes.filter((c) => !academicYear || c.academic_year === academicYear);
  }, [classes, academicYear]);

  const levels = useMemo(() => {
    const set = new Set<string>();
    for (const c of filteredClasses) {
      const value = String(c.level || "").trim();
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  }, [filteredClasses]);

  const selectedClass = useMemo(() => {
    return filteredClasses.find((c) => c.id === classId) || null;
  }, [filteredClasses, classId]);

  const effectiveLevel = selectedClass?.level || level || "";

  const scopePresets = useMemo(() => {
    return buildScopePresets({
      classLabel: selectedClass?.label || null,
      level: selectedClass?.level || level || null,
    });
  }, [selectedClass?.label, selectedClass?.level, level]);

  useEffect(() => {
    if (selectedClass?.level && selectedClass.level !== level) {
      setLevel(selectedClass.level);
    }
  }, [selectedClass?.level, level]);

  useEffect(() => {
    const allKnownPresets = new Set([...presets, ...DEFAULT_PRESETS]);
    if (!question || allKnownPresets.has(question)) {
      setQuestion(scopePresets[0] || DEFAULT_PRESETS[0]);
    }
  }, [scopePresets, presets, question]);

  async function ask(nextQuestion?: string) {
    const q = String(nextQuestion || question || "").trim();
    if (!q) return;

    setQuestion(q);
    setAsking(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/mon-cahier-ia/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          academic_year: academicYear,
          exam_date: examDate,
          class_id: classId || null,
          level: effectiveLevel || null,
          core_completion_percent: completion,
        }),
      });
      const json = (await res.json().catch(() => null)) as AssistantResponse | null;
      if (!res.ok || !json?.ok || !json.answer) {
        throw new Error(json?.message || json?.error || "Analyse impossible.");
      }
      setAnswer(json.answer);
      setMeta(json.context_meta || null);
    } catch (e: any) {
      setError(e?.message || "Analyse impossible.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="relative bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950 px-5 py-7 text-white sm:px-7">
          <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-32 w-32 rounded-full bg-emerald-400/10 blur-3xl" />

          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
                <BrainCircuit className="h-4 w-4" />
                Mon Cahier IA v2
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                Assistant pédagogique intelligent
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
                Analyse les notes, les matières clés, l’assiduité, la conduite et les signaux faibles pour aider l’établissement à agir avant les examens.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-3xl border border-white/10 bg-white/10 p-2 text-center backdrop-blur">
              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-2xl font-black">{meta?.classes_count ?? "—"}</div>
                <div className="text-[11px] font-semibold text-slate-300">classes</div>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-2xl font-black">{meta?.students_count ?? "—"}</div>
                <div className="text-[11px] font-semibold text-slate-300">élèves</div>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-3">
                <div className="text-2xl font-black">{answer?.confidence ?? "—"}</div>
                <div className="text-[11px] font-semibold text-slate-300">confiance</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-200 bg-slate-50 px-5 py-5 sm:px-7 lg:grid-cols-5">
          <label className="space-y-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Année</span>
            <select
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-cyan-400"
            >
              {years.map((y) => (
                <option key={y.code} value={y.code}>
                  {y.label || y.code}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Classe</span>
            <select
              value={classId}
              onChange={(e) => {
                const nextClassId = e.target.value;
                setClassId(nextClassId);
                if (!nextClassId) setLevel("");
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-cyan-400"
            >
              <option value="">Toutes les classes</option>
              {filteredClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || "Classe"} {c.level ? `· ${c.level}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Niveau</span>
            <select
              value={effectiveLevel}
              onChange={(e) => {
                setLevel(e.target.value);
                setClassId("");
              }}
              disabled={Boolean(classId)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-cyan-400 disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="">Tous</option>
              {levels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Date cible</span>
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-cyan-400"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">Programme</span>
            <input
              type="number"
              min={0}
              max={100}
              value={completion}
              onChange={(e) => setCompletion(Math.max(0, Math.min(100, Number(e.target.value))))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-cyan-400"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Question libre</h2>
              <p className="text-sm text-slate-500">Tu peux cliquer sur une question ou écrire ta propre demande.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {scopePresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => void ask(preset)}
                disabled={asking || loading}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800 disabled:opacity-50"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold leading-5 text-blue-900">
            Périmètre actif : {selectedClass?.label || effectiveLevel || "toutes les classes"}. Les questions proposées s’adaptent à ce périmètre pour éviter de mélanger BEPC, BAC, niveaux et classes différentes.
          </div>

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              placeholder={scopePresets[0] || "Ex : Quels élèves doivent être suivis en priorité ?"}
              className="min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-cyan-400"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-slate-500">
                Réponses basées sur les données réelles disponibles dans Mon Cahier.
              </p>
              <button
                type="button"
                onClick={() => void ask()}
                disabled={asking || loading || !academicYear || !examDate}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Analyser
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Ce qui est vraiment IA</h2>
              <p className="text-sm text-slate-500">Architecture progressive, propre et défendable.</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-900">
                <CheckCircle2 className="h-4 w-4" />
                Assistant libre
              </div>
              <p className="mt-1 text-sm leading-6 text-emerald-800">
                L’utilisateur peut poser une question. Le système détecte l’intention, sélectionne les données utiles et produit une réponse structurée.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-cyan-900">
                <BarChart3 className="h-4 w-4" />
                Moteur pédagogique explicable
              </div>
              <p className="mt-1 text-sm leading-6 text-cyan-800">
                Chaque alerte peut être expliquée : moyenne, matière clé, assiduité, conduite, niveau de risque, matière bloquante.
              </p>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-violet-900">
                <BrainCircuit className="h-4 w-4" />
                Modèle ML entraînable
              </div>
              <p className="mt-1 text-sm leading-6 text-violet-800">
                Le service Python peut charger un modèle entraîné. Sans modèle, il reste en fallback explicable, sans bloquer l’école.
              </p>
            </div>
          </div>
        </div>
      </section>

      {answer ? (
        <section className="space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-black text-slate-950">{answer.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-slate-600">
                      {sourceLabel(answer.model.source)} · v{answer.model.version}
                    </span>
                  </div>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">{answer.summary}</p>
                </div>
              </div>

              <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                <div className="text-2xl font-black text-slate-950">{answer.confidence}%</div>
                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">fiabilité données</div>
              </div>
            </div>

            {meta?.warnings?.length ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="mb-1 flex items-center gap-2 font-black">
                  <AlertTriangle className="h-4 w-4" />
                  Points à vérifier
                </div>
                <ul className="list-inside list-disc space-y-1">
                  {meta.warnings.slice(0, 4).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium leading-6 text-blue-900">
              {answer.ethics_notice}
            </div>
          </div>

          {answer.recommendations?.length ? (
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950">
                <Sparkles className="h-5 w-5 text-cyan-700" />
                Recommandations intelligentes
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {answer.recommendations.map((rec, index) => (
                  <div key={`${rec}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-700">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                      {index + 1}
                    </span>
                    {rec}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {answer.council_note ? (
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950">
                <GraduationCap className="h-5 w-5 text-violet-700" />
                Note de conseil de classe
              </div>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-950 p-4 text-sm leading-7 text-slate-100">
                {answer.council_note}
              </pre>
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
              <div className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950">
                <UsersRound className="h-5 w-5 text-red-700" />
                Élèves à suivre
              </div>
              <div className="space-y-3">
                {answer.students_to_follow?.length ? (
                  answer.students_to_follow.slice(0, 10).map((student) => (
                    <div key={student.student_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{student.full_name}</div>
                          <div className="text-xs font-semibold text-slate-500">{student.class_label}</div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${riskStyle(student.risk_level)}`}>
                          {student.priority_score}/100
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        Moy. bulletin {fmtAvg(student.general_avg_20)} · Indice {fmtPct(student.p_success)}
                      </div>
                      {student.reasons?.length ? (
                        <ul className="mt-2 list-inside list-disc text-xs leading-5 text-slate-600">
                          {student.reasons.slice(0, 3).map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Aucun élève prioritaire détecté.</p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
              <div className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950">
                <BarChart3 className="h-5 w-5 text-amber-700" />
                Classes sensibles
              </div>
              <div className="space-y-3">
                {answer.classes_at_risk?.length ? (
                  answer.classes_at_risk.slice(0, 8).map((cls) => (
                    <div key={cls.class_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{cls.class_label}</div>
                          <div className="text-xs font-semibold text-slate-500">{cls.students_count} élèves · Moy. bulletin {fmtAvg(cls.avg_general_20)}</div>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-800">
                          risque {cls.risk_index}/100
                        </span>
                      </div>
                      {cls.main_reasons?.length ? (
                        <p className="mt-2 text-xs leading-5 text-slate-600">{cls.main_reasons.join(" · ")}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Aucune classe sensible détectée.</p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
              <div className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950">
                <GraduationCap className="h-5 w-5 text-cyan-700" />
                Matières bloquantes
              </div>
              <div className="space-y-3">
                {answer.blocking_subjects?.length ? (
                  answer.blocking_subjects.slice(0, 8).map((subject) => (
                    <div key={`${subject.class_id}-${subject.subject_id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{subject.subject_name}</div>
                          <div className="text-xs font-semibold text-slate-500">{subject.class_label} · {subject.evaluations_count} éval.</div>
                        </div>
                        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-black text-cyan-800">
                          {subject.blocker_score}/100
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        Moyenne {fmtAvg(subject.avg_score_20)} · {subject.weak_students_count} élève(s) sous 10
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Aucune matière bloquante détectée.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-600">
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Bot className="h-6 w-6" />}
          </div>
          <h2 className="mt-4 text-xl font-black text-slate-950">Pose une question à Mon Cahier IA</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            L’assistant va lire les données disponibles et produire une analyse pédagogique exploitable, sans décision automatique contre un élève.
          </p>
        </section>
      )}
    </div>
  );
}
