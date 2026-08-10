"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  Plus,
  Save,
  Eye,
  EyeOff,
  RefreshCw,
  FileSpreadsheet,
  Trash2,
  FileText,
  Lock,
  Unlock,
} from "lucide-react";
import OfflineReadinessCard from "@/components/OfflineReadinessCard";
import OfflineSyncBar from "@/components/OfflineSyncBar";
import VoiceGradeEntry from "@/components/VoiceGradeEntry";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  gradesClassesKey,
  gradesComponentsKey,
  gradesEvaluationsKey,
  gradesGetJson,
  gradesLockKey,
  gradesPeriodsKey,
  gradesRosterKey,
  gradesScoresKey,
  gradesSettingsKey,
  saveGradesScores,
} from "@/lib/offline-grades";

type PrimaryButtonTone = "emerald" | "amber" | "slate" | "red";

type PrimaryButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
  /** Simple variante de couleur (utile pour Verrouiller/Déverrouiller) */
  tone?: PrimaryButtonTone;
};

function PrimaryButton({
  className = "",
  children,
  tone = "emerald",
  ...props
}: PrimaryButtonProps) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : tone === "amber"
        ? "bg-amber-500 text-slate-900 hover:bg-amber-600"
        : tone === "red"
          ? "bg-red-600 text-white hover:bg-red-700"
          : "bg-slate-700 text-white hover:bg-slate-800";

  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center rounded-md",
        "px-3 py-2 text-sm font-semibold",
        toneClass,
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* =========================
   Helpers divers
========================= */
const MOBILE_BREAKPOINT = 768; // < md

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobile;
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* =========================
   Types
========================= */
type TeachClass = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null; // subjects.id canonique
  subject_name: string | null;
  education_type?: string | null;
  education_label?: string | null;
  formation_code?: string | null;
  formation_label?: string | null;
  formation_level_code?: string | null;
};

type RosterItem = { id: string; full_name: string; matricule: string | null };

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type PublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published"
  | string;

type Evaluation = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id?: string | null; // ✅ sous-rubrique éventuelle
  grading_period_id?: string | null;
  eval_date: string; // yyyy-mm-dd
  eval_kind: EvalKind;
  scale: 5 | 10 | 20 | 40 | 60; // on n’en crée que 5/10/20, mais on affiche tout ce qui existe
  coeff: number; // 0.25, 0.5, 1, 2, 3...
  is_published: boolean;
  published_at?: string | null;

  // ✅ Nouveau workflow publication
  publication_status?: PublicationStatus | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_comment?: string | null;
  publication_version?: number | null;
};

type EvalLock = {
  evaluation_id: string;
  is_locked: boolean;
  locked_at?: string | null;
  locked_by?: string | null;
  teacher_id?: string | null;
};

type GradesByEval = Record<string, Record<string, number | null>>; // grades[eval_id][student_id] = note

type SubjectComponent = {
  id: string;
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number | null;
};

type AverageApiRow = {
  student_id: string;
  count_evals: number;
  total_evals: number;

  // 0 = vraie moyenne ; null = aucune moyenne calculable.
  average_raw: number | null;
  bonus: number | null;
  average: number | null;
  average_rounded: number | null;

  // Nouvelle règle : rang autorisé dès qu'une moyenne existe.
  // Si l'API ne renvoie pas encore le rang, le front le reconstruit en sécurité.
  rank: number | null;

  has_average?: boolean | null;
  is_complete?: boolean | null;
  status?: "complete" | "partial" | string | null;
};

type GradePeriod = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string;
  end_date: string;
  coeff?: number | null;
  is_active?: boolean | null;
};

/* =========================
   Helpers
========================= */
function isCollegeLevel(level?: string | null): boolean {
  if (!level) return false;
  let s = level.toLowerCase();
  try {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // pas grave, on continue sans normalisation
  }
  // On vise 6e, 5e, 4e, 3e (avec variantes du style "3e A")
  return (
    s.startsWith("6") ||
    s.startsWith("5") ||
    s.startsWith("4") ||
    s.startsWith("3")
  );
}

function getPublicationStatus(ev: Evaluation): PublicationStatus {
  const raw = String(ev.publication_status || "").trim();

  if (
    raw === "draft" ||
    raw === "submitted" ||
    raw === "changes_requested" ||
    raw === "published"
  ) {
    return raw;
  }

  if (ev.is_published === true) return "published";

  return "draft";
}

function isEvaluationSubmitted(ev: Evaluation) {
  return getPublicationStatus(ev) === "submitted";
}

function isEvaluationPublished(ev: Evaluation) {
  return ev.is_published === true || getPublicationStatus(ev) === "published";
}

function isEvaluationChangesRequested(ev: Evaluation) {
  return getPublicationStatus(ev) === "changes_requested";
}

function isEvaluationEditableForTeacher(ev: Evaluation) {
  const status = getPublicationStatus(ev);

  return (
    ev.is_published !== true &&
    (status === "draft" || status === "changes_requested")
  );
}

function isEvaluationDeletableForTeacher(ev: Evaluation) {
  return isEvaluationEditableForTeacher(ev);
}

function publicationStatusLabel(ev: Evaluation) {
  const status = getPublicationStatus(ev);

  if (ev.is_published === true || status === "published") return "Publié";
  if (status === "submitted") return "En attente de validation";
  if (status === "changes_requested") return "Correction demandée";

  return "Brouillon";
}

function publicationStatusClass(ev: Evaluation) {
  const status = getPublicationStatus(ev);

  if (ev.is_published === true || status === "published") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "submitted") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "changes_requested") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function publicationActionLabel(ev: Evaluation) {
  if (isEvaluationPublished(ev)) return "Repasser brouillon";
  if (isEvaluationSubmitted(ev)) return "Soumis";
  if (isEvaluationChangesRequested(ev)) return "Soumettre à nouveau";

  return "Soumettre / publier";
}

function publicationLockReason(ev: Evaluation) {
  if (isEvaluationSubmitted(ev)) {
    return "Évaluation soumise : l’administration doit valider ou demander une correction.";
  }

  if (isEvaluationPublished(ev)) {
    return "Évaluation publiée officiellement : les notes sont verrouillées.";
  }

  return null;
}


/* =========================
   UI helpers
========================= */
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
        p.className ?? "",
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
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber" | "red";
  }
) {
  const tone = p.tone ?? "emerald";
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition focus:outline-none focus:ring-4 disabled:opacity-60 disabled:cursor-not-allowed";
  const tones: Record<NonNullable<typeof p.tone>, string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-600/30",
    amber:
      "bg-amber-500 text-slate-900 hover:bg-amber-600 focus:ring-amber-400/40",
    red: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30",
  };
  const cls = [base, tones[tone], p.className ?? ""].join(" ");
  const { tone: _tone, ...rest } = p;
  return <button {...rest} className={cls} />;
}
function GhostButton(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "red" | "slate" | "emerald";
    children?: React.ReactNode;
  }
) {
  const { tone: toneProp, className, children, ...rest } = p;
  const tone = toneProp ?? "slate";
  const map: Record<"red" | "slate" | "emerald", string> = {
    red: "border-red-300 text-red-700 hover:bg-red-50 focus:ring-red-500/20",
    slate:
      "border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500/20",
    emerald:
      "border-emerald-300 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-500/20",
  };
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
        "transition focus:outline-none focus:ring-4",
        map[tone],
        className ?? "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* =========================
   Page
========================= */
export default function TeacherNotesPage() {
  const isMobile = useIsMobile();
  const { isOnline } = useOnlineStatus();

  // Nom établissement + année scolaire
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [academicYearLabel, setAcademicYearLabel] = useState<string | null>(
    null
  );

  /* 1️⃣ Essai via API (comme compte classe) */
  useEffect(() => {
    async function loadInstitutionFromApi() {
      async function getJson(url: string) {
        try {
          return await gradesGetJson(url, gradesSettingsKey("teacher", url));
        } catch {
          return null;
        }
      }

      const c: any =
        (await getJson("/api/teacher/institution/settings")) ||
        (await getJson("/api/institution/settings")) ||
        (await getJson("/api/admin/institution/settings")) ||
        null;

      if (!c) return;

      setInstitutionName((prev) => {
        if (prev) return prev;
        return (
          c.institution_name ||
          c.institution_label ||
          c.short_name ||
          c.name ||
          c.header_title ||
          c.school_name ||
          null
        );
      });

      setAcademicYearLabel((prev) => {
        if (prev) return prev;
        return (
          c.academic_year_label ||
          c.current_academic_year_label ||
          c.academic_year ||
          c.year_label ||
          c.header_academic_year ||
          null
        );
      });
    }
    loadInstitutionFromApi();
  }, []);

  /* 2️⃣ Fallback doux : dataset / globals (comme ailleurs) */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const body: any = document.body;

      const fromDataName =
        body?.dataset?.institutionName || body?.dataset?.institution || null;
      const fromGlobalName = (window as any).__MC_INSTITUTION_NAME__
        ? String((window as any).__MC_INSTITUTION_NAME__)
        : null;
      const finalName = fromDataName || fromGlobalName;
      if (finalName) {
        setInstitutionName((prev) => prev || finalName);
      }

      const fromDataYear =
        body?.dataset?.academicYear ||
        body?.dataset?.schoolYear ||
        body?.dataset?.anneeScolaire ||
        null;
      const fromGlobalYear = (window as any).__MC_ACADEMIC_YEAR__
        ? String((window as any).__MC_ACADEMIC_YEAR__)
        : null;
      const finalYear = fromDataYear || fromGlobalYear;
      if (finalYear) {
        setAcademicYearLabel((prev) => prev || finalYear);
      }
    } catch {
      // on ne casse rien si ça échoue
    }
  }, []);

  /* -------- Sélection classe/discipline -------- */
  const [teachClasses, setTeachClasses] = useState<TeachClass[]>([]);
  const classOptions = useMemo(
    () =>
      teachClasses.map((tc) => ({
        key: `${tc.class_id}|${tc.subject_id ?? ""}`,
        label: `${tc.class_label}${
          tc.subject_name ? ` — ${tc.subject_name}` : ""
        }`,
        group:
          tc.education_type === "general_secondary" || !tc.education_type
            ? "Secondaire général"
            : `${tc.education_label || "Autre enseignement"}${
                tc.formation_label ? ` — ${tc.formation_label}` : ""
              }`,
        value: tc,
      })),
    [teachClasses]
  );
  const classOptionGroups = useMemo(() => {
    const groups = new Map<string, typeof classOptions>();
    for (const option of classOptions) {
      const current = groups.get(option.group) || [];
      current.push(option);
      groups.set(option.group, current);
    }
    return Array.from(groups.entries());
  }, [classOptions]);
  const [selKey, setSelKey] = useState<string>("");
  const selected = useMemo(
    () => classOptions.find((o) => o.key === selKey)?.value || null,
    [classOptions, selKey]
  );

  const [gradePeriods, setGradePeriods] = useState<GradePeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const selectedPeriod = useMemo(
    () => gradePeriods.find((p) => p.id === selectedPeriodId) || null,
    [gradePeriods, selectedPeriodId]
  );

  function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function isPeriodClosed(period: GradePeriod | null) {
    if (!period?.end_date) return false;
    return todayIsoDate() > period.end_date;
  }

  const selectedPeriodClosed = useMemo(
    () => isPeriodClosed(selectedPeriod),
    [selectedPeriod]
  );

  /* -------- Données -------- */
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [grades, setGrades] = useState<GradesByEval>({});
  const [changed, setChanged] = useState<GradesByEval>({});

  /* -------- Sous-matières (rubriques) -------- */
  const [components, setComponents] = useState<SubjectComponent[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string>("");

  const supportsComponents = selected
    ? selected.education_type && selected.education_type !== "general_secondary"
      ? true
      : isCollegeLevel(selected.level)
    : false;
  const hasComponents = supportsComponents && components.length > 0;

  const componentById = useMemo(() => {
    const map: Record<string, SubjectComponent> = {};
    for (const c of components) {
      map[c.id] = c;
    }
    return map;
  }, [components]);

  function appendSelectedPeriod(params: URLSearchParams) {
    if (selectedPeriodId) {
      params.set("grading_period_id", selectedPeriodId);
    }
    return params;
  }

  function buildAverageParams() {
    const params = new URLSearchParams({
      class_id: selected?.class_id || "",
      missing: "ignore",
      round_to: "none",
      rank_by: "average",
    });

    if (selected?.subject_id) {
      params.set("subject_id", selected.subject_id);
    }

    if (selectedPeriod?.academic_year) {
      params.set("academic_year", selectedPeriod.academic_year);
    } else if (academicYearLabel) {
      params.set("academic_year", academicYearLabel);
    }

    appendSelectedPeriod(params);

    // Dès qu'une évaluation est publiée, l'affichage des moyennes doit être
    // aligné sur le bulletin et le compte-classe : on lit donc la source officielle.
    // Tant qu'aucune évaluation n'est publiée, on garde une moyenne de travail.
    const hasPublishedEvaluation = evaluations.some((ev) => isEvaluationPublished(ev));
    params.set("published_only", hasPublishedEvaluation ? "1" : "0");

    return params;
  }

  /* -------- État & message -------- */
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"saisie" | "moyennes">("saisie");

  /* -------- Publication + suppression panel -------- */
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [publishBusy, setPublishBusy] = useState<Record<string, boolean>>({});

  /* -------- Verrouillage des évaluations (PIN) -------- */
  const [evalLocks, setEvalLocks] = useState<Record<string, EvalLock>>({});
  const [lockBusy, setLockBusy] = useState<Record<string, boolean>>({});

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockTargetEv, setLockTargetEv] = useState<Evaluation | null>(null);
  const [lockModalMode, setLockModalMode] = useState<"lock" | "unlock">("lock");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");

  const isEvalLocked = (evaluation_id: string) =>
    !!evalLocks[evaluation_id]?.is_locked;

  /* -------- Champs "nouvelle note" -------- */
  const [newDate, setNewDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [newType, setNewType] = useState<EvalKind>("devoir");
  const [newScale, setNewScale] = useState<5 | 10 | 20>(20);
  const [newCoeff, setNewCoeff] = useState<number>(1);
  const [creating, setCreating] = useState(false);

  /* -------- Colonne active sur mobile -------- */
  const [activeEvalId, setActiveEvalId] = useState<string | null>(null);
  const [voiceEvalId, setVoiceEvalId] = useState<string | null>(null);

  /* ==========================================
     Chargements
  ========================================== */
  // Liste des classes/discipline du prof
  useEffect(() => {
    (async () => {
      try {
        const j: any = await gradesGetJson(
          "/api/grades/classes",
          gradesClassesKey("teacher")
        );
        const arr = (j.items || []) as TeachClass[];
        setTeachClasses(arr);
        if (!selKey && arr.length) {
          const first = arr[0];
          setSelKey(`${first.class_id}|${first.subject_id ?? ""}`);
        }
      } catch {
        setTeachClasses([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Périodes de notes configurées pour la classe sélectionnée.
  // Le secondaire général conserve le découpage commun historique.
  useEffect(() => {
    let cancelled = false;

    if (!selected?.class_id) {
      setGradePeriods([]);
      setSelectedPeriodId("");
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        setLoadingPeriods(true);
        const params = new URLSearchParams();
        if (academicYearLabel) {
          params.set("academic_year", academicYearLabel);
        }
        params.set("class_id", selected.class_id);
        const url = `/api/admin/institution/grading-periods?${params.toString()}`;
        const j: any = await gradesGetJson(
          url,
          gradesPeriodsKey("teacher", selected.class_id),
        );
        const arr = (j.items || []) as GradePeriod[];
        if (cancelled) return;
        setGradePeriods(arr);
        setSelectedPeriodId((prev) => {
          if (prev && arr.some((p) => p.id === prev)) return prev;
          const firstActive = arr.find((p) => p.is_active !== false);
          return firstActive?.id || arr[0]?.id || "";
        });
      } catch {
        if (cancelled) return;
        setGradePeriods([]);
        setSelectedPeriodId("");
      } finally {
        if (!cancelled) setLoadingPeriods(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYearLabel, selected?.class_id]);

  // Rubriques / sous-matières pour les niveaux 6e-3e
  useEffect(() => {
    setComponents([]);
    setSelectedComponentId("");
    if (!selected || !selected.subject_id) return;
    if (
      (!selected.education_type || selected.education_type === "general_secondary") &&
      !isCollegeLevel(selected.level)
    ) return;

    (async () => {
      try {
        setComponentsLoading(true);
        // ✅ construction sûre des query params (pas de null)
        const params = new URLSearchParams();
        params.set("class_id", selected.class_id);
        if (selected.subject_id) {
          params.set("subject_id", selected.subject_id);
        }
        const url = `/api/teacher/grades/components?${params.toString()}`;
        const j: any = await gradesGetJson(
          url,
          gradesComponentsKey(
            "teacher",
            selected.class_id,
            selected.subject_id
          )
        );
        const arr = (j.items || []) as SubjectComponent[];
        setComponents(arr);
        if (arr.length > 0) {
          setSelectedComponentId(arr[0].id);
        }
      } catch {
        setComponents([]);
      } finally {
        setComponentsLoading(false);
      }
    })();
  }, [selected?.class_id, selected?.subject_id, selected?.level]);

  // Roster + évaluations + notes pour la sélection courante
  useEffect(() => {
    if (!selected) {
      setRoster([]);
      setEvaluations([]);
      setGrades({});
      setChanged({});
      setActiveEvalId(null);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setMsg(null);

        // 1) Roster
        const rosterUrl = `/api/teacher/roster?class_id=${encodeURIComponent(
          selected.class_id
        )}`;
        const jRoster: any = await gradesGetJson(
          rosterUrl,
          gradesRosterKey("teacher", selected.class_id)
        );
        const ros = (jRoster.items || []) as RosterItem[];
        setRoster(ros);

        // 2) Liste des évaluations
        const evalParams = new URLSearchParams({
          class_id: selected.class_id,
        });
        if (selected.subject_id) {
          evalParams.set("subject_id", selected.subject_id);
        }
        appendSelectedPeriod(evalParams);

        const evalsUrl = `/api/teacher/grades/evaluations?${evalParams.toString()}`;
        const jEvals: any = await gradesGetJson(
          evalsUrl,
          gradesEvaluationsKey(
            "teacher",
            selected.class_id,
            selected.subject_id,
            selectedPeriodId || null
          )
        );
        const evals = (jEvals.items || []) as Evaluation[];
        // tri par date croissante (stable)
        evals.sort((a, b) => a.eval_date.localeCompare(b.eval_date));
        setEvaluations(evals);

        // 3) Notes par évaluation
        const g: GradesByEval = {};
        await Promise.all(
          evals.map(async (ev) => {
            const scoresUrl = `/api/teacher/grades/scores?evaluation_id=${encodeURIComponent(
              ev.id
            )}`;
            const j: any = await gradesGetJson(
              scoresUrl,
              gradesScoresKey("teacher", ev.id)
            );
            const items = (j.items || []) as Array<{
              student_id: string;
              score: number | null;
            }>;
            g[ev.id] = {};
            for (const it of items) g[ev.id][it.student_id] = it.score;
          })
        );
        setGrades(g);
        setChanged({});
      } catch (e: any) {
        setMsg(e?.message || "Échec de chargement.");
        setRoster([]);
        setEvaluations([]);
        setGrades({});
        setChanged({});
        setActiveEvalId(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [selected?.class_id, selected?.subject_id, selectedPeriodId]);

  /* ==========================================
     Verrouillage (lecture statut)
  ========================================== */
  function normalizeLockResponse(evId: string, j: any): EvalLock | null {
    // On accepte plusieurs formes possibles (pour éviter de casser si l’API diffère)
    const src = j?.lock ?? j?.item ?? j?.data ?? j;

    if (!src || typeof src !== "object") return null;

    // ✅ supporte "locked" (nos APIs) ET "is_locked" (autres variantes)
    const lockedValue =
      typeof (src as any).is_locked === "boolean"
        ? (src as any).is_locked
        : typeof (src as any).locked === "boolean"
        ? (src as any).locked
        : null;

    if (lockedValue === null) return null;

    return {
      evaluation_id: (src as any).evaluation_id ?? evId,
      is_locked: lockedValue,
      locked_at: (src as any).locked_at ?? null,
      locked_by: (src as any).locked_by ?? null,
      teacher_id: (src as any).teacher_id ?? null,
    };
  }

  async function getEvalLockFromAnyEndpoint(evId: string): Promise<EvalLock | null> {
    const urls = [
      `/api/teacher/grades/locks?evaluation_id=${encodeURIComponent(evId)}`,
      `/api/grades/locks?evaluation_id=${encodeURIComponent(evId)}`,
      `/api/admin/grades/locks?evaluation_id=${encodeURIComponent(evId)}`,
    ];

    for (const url of urls) {
      try {
        const j: any = await gradesGetJson(
          url,
          gradesLockKey("teacher", evId)
        );
        if (!j) continue;
        if (j?.ok === false) continue;
        const lock = normalizeLockResponse(evId, j);
        if (lock) return lock;
      } catch {
        // on essaie l’endpoint suivant
      }
    }
    return null;
  }

  async function refreshLocks(evIds: string[]) {
    if (!evIds.length) {
      setEvalLocks({});
      return;
    }
    const unique = Array.from(new Set(evIds));
    const results = await Promise.all(unique.map((id) => getEvalLockFromAnyEndpoint(id)));
    const map: Record<string, EvalLock> = {};
    for (const lock of results) {
      if (lock) map[lock.evaluation_id] = lock;
    }
    setEvalLocks(map);
  }

  // Dès qu’on charge / change la liste des évaluations, on récupère les verrous (si l’API existe)
  useEffect(() => {
    const ids = evaluations.map((e) => e.id);
    refreshLocks(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluations]);

  /* ==========================================
     Verrouillage (actions lock/unlock)
  ========================================== */
  function openLockModal(ev: Evaluation, mode: "lock" | "unlock") {
    setLockTargetEv(ev);
    setLockModalMode(mode);
    setPin("");
    setPin2("");
    setLockModalOpen(true);
  }

  async function applyLockChange(evId: string, mode: "lock" | "unlock", p: string) {
    const urls = ["/api/teacher/grades/locks", "/api/grades/locks", "/api/admin/grades/locks"];
    const body: any = {
      evaluation_id: evId,
      action: mode, // "lock" | "unlock"
      pin: p,
    };

    for (const url of urls) {
      // On tente POST puis PATCH (certaines implémentations utilisent PATCH)
      for (const method of ["POST", "PATCH"] as const) {
        try {
          const r = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            // si 404/405, on teste autre endpoint/méthode
            continue;
          }
          const j = await r.json().catch(() => ({}));
          if (j?.ok === false) continue;

          // Mise à jour locale
          const lock = normalizeLockResponse(evId, j);
          if (lock) {
            setEvalLocks((prev) => ({ ...prev, [evId]: lock }));
          } else {
            // sinon, on relit le statut
            const fresh = await getEvalLockFromAnyEndpoint(evId);
            if (fresh) setEvalLocks((prev) => ({ ...prev, [evId]: fresh }));
          }
          return;
        } catch {
          // on teste autre endpoint/méthode
        }
      }
    }
    throw new Error(
      mode === "lock"
        ? "Impossible de verrouiller (API indisponible ou refus)."
        : "Impossible de déverrouiller (API indisponible ou refus)."
    );
  }

  async function submitLockModal() {
    if (!lockTargetEv) return;
    if (!isOnline) {
      setMsg("Le verrouillage par PIN nécessite une connexion Internet.");
      return;
    }
    const evId = lockTargetEv.id;

    const wanted = lockModalMode;
    const p = pin.trim();
    if (!p) {
      setMsg("Entrez le code PIN.");
      return;
    }
    if (wanted === "lock") {
      // optionnel : double saisie pour éviter les erreurs
      if (pin2.trim() && pin2.trim() !== p) {
        setMsg("Les deux codes PIN ne correspondent pas.");
        return;
      }
    }

    setMsg(null);
    setLockBusy((prev) => ({ ...prev, [evId]: true }));
    try {
      await applyLockChange(evId, wanted, p);

      // Si on verrouille une évaluation, on purge les changements en attente sur cette colonne
      if (wanted === "lock") {
        setChanged((prev) => {
          if (!prev[evId]) return prev;
          const next = { ...prev };
          delete next[evId];
          return next;
        });
      }

      setLockModalOpen(false);
      setLockTargetEv(null);
      setPin("");
      setPin2("");
      setMsg(wanted === "lock" ? "Évaluation verrouillée ✅" : "Évaluation déverrouillée ✅");
    } catch (e: any) {
      setMsg(e?.message || "Échec du verrouillage.");
    } finally {
      setLockBusy((prev) => {
        const next = { ...prev };
        delete next[evId];
        return next;
      });
    }
  }


  /* ==========================================
     Actions
  ========================================== */
  function setGrade(
    evId: string,
    studentId: string,
    value: number | null,
    scale: number
  ) {
    if (selectedPeriodClosed) return;

    const ev = evaluations.find((e) => e.id === evId);
    if (ev && !isEvaluationEditableForTeacher(ev)) return;

    if (isEvalLocked(evId)) return;

    const v =
      value == null || Number.isNaN(value)
        ? null
        : Math.max(0, Math.min(scale, value));

    setChanged((prev) => ({
      ...prev,
      [evId]: { ...(prev[evId] || {}), [studentId]: v },
    }));
  }

  async function saveAllChanges() {
    if (!selected) return;

    if (selectedPeriodClosed) {
      setMsg("Cette période est clôturée. La saisie des notes est fermée.");
      return;
    }

    // Regrouper par évaluation
    const perEvalAll = Object.entries(changed).filter(
      ([, per]) => Object.keys(per).length > 0
    );

    const evaluationById = new Map(evaluations.map((ev) => [ev.id, ev]));
    const lockedWithChanges = perEvalAll.filter(([evaluation_id]) =>
      isEvalLocked(evaluation_id)
    );
    const blockedByPublication = perEvalAll.filter(([evaluation_id]) => {
      const ev = evaluationById.get(evaluation_id);
      return ev ? !isEvaluationEditableForTeacher(ev) : false;
    });

    const perEval = perEvalAll.filter(([evaluation_id]) => {
      const ev = evaluationById.get(evaluation_id);
      const editable = ev ? isEvaluationEditableForTeacher(ev) : true;
      return editable && !isEvalLocked(evaluation_id);
    });

    if (blockedByPublication.length > 0 && perEval.length === 0) {
      setMsg(
        "Toutes les colonnes modifiées sont déjà soumises ou publiées. Aucune modification directe n’est autorisée."
      );
      return;
    }

    if (lockedWithChanges.length > 0 && perEval.length === 0) {
      setMsg(
        "Toutes les colonnes modifiées sont verrouillées. Déverrouillez l’évaluation pour enregistrer."
      );
      return;
    }

    if (perEval.length === 0) {
      setMsg("Aucun changement à enregistrer.");
      return;
    }

    setLoading(true);
    setMsg(null);

    try {
      let queuedCount = 0;
      for (const [evaluation_id, per] of perEval) {
        const items = Object.entries(per).map(([student_id, score]) => ({
          student_id,
          score: score == null ? null : Number(score),
        }));

        const result = await saveGradesScores("teacher", {
            evaluation_id,
            items,
            delete_if_null: true,
            strict: false,
          });

        if (!result.ok && !result.queued) {
          const payload: any = result.data;
          throw new Error(
            payload?.message || payload?.error || result.error || "Échec d’enregistrement."
          );
        }
        if (result.ok && (result.data as any)?.ok === false) {
          const payload: any = result.data;
          throw new Error(payload?.message || payload?.error || "Échec d’enregistrement.");
        }
        if (!result.ok && result.queued) queuedCount += 1;
      }

      const savedEvalIds = new Set(perEval.map(([evaluation_id]) => evaluation_id));

      // Merge local uniquement pour les évaluations réellement enregistrées.
      setGrades((prev) => {
        const next = { ...prev };

        for (const [evId, per] of perEval) {
          next[evId] = { ...(next[evId] || {}) };
          for (const [sid, val] of Object.entries(per)) {
            next[evId][sid] = val;
          }
        }

        return next;
      });

      // On retire seulement ce qui vient d’être sauvegardé.
      setChanged((prev) => {
        const next = { ...prev };

        for (const evId of savedEvalIds) {
          delete next[evId];
        }

        return next;
      });

      const notes: string[] = [];

      if (lockedWithChanges.length > 0) {
        notes.push("certaines colonnes verrouillées ont été ignorées");
      }

      if (blockedByPublication.length > 0) {
        notes.push("certaines colonnes soumises/publiées ont été ignorées");
      }

      if (queuedCount > 0) {
        const suffix = notes.length > 0 ? ` (${notes.join(" ; ")})` : "";
        setMsg(
          `Notes enregistrées sur cet appareil ✅ — ${queuedCount} envoi(s) en attente de synchronisation${suffix}.`
        );
      } else {
        setMsg(
          notes.length > 0
            ? `Notes enregistrées ✅ (${notes.join(" ; ")})`
            : "Notes enregistrées ✅"
        );
      }
    } catch (e: any) {
      setMsg(e?.message || "Échec d’enregistrement des notes.");
    } finally {
      setLoading(false);
    }
  }

  async function addEvaluation() {
    if (!selected) return;
    if (!isOnline) {
      setMsg(
        "Hors connexion : vous pouvez saisir les évaluations déjà préparées. La création d’une nouvelle évaluation nécessite Internet."
      );
      return;
    }
    if (selectedPeriodClosed) {
      setMsg("Cette période est clôturée. Impossible d’ajouter une nouvelle note.");
      return;
    }

    // Si sous-matières configurées en collège, on impose la sélection
    if (hasComponents && !selectedComponentId) {
      setMsg("Choisissez une sous-rubrique avant d’ajouter une note.");
      return;
    }

    setCreating(true);
    setMsg(null);
    try {
      const payload = {
        class_id: selected.class_id,
        subject_id: selected?.subject_id ?? null, // ← important si "" arrive
        subject_component_id: hasComponents ? selectedComponentId : null, // ✅ sous-matière
        grading_period_id: selectedPeriodId || null,
        eval_date: newDate,
        eval_kind: newType,
        scale: newScale,
        coeff: newCoeff,
      };
      const r = await fetch("/api/teacher/grades/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok)
        throw new Error(j?.error || "Échec de création de l’évaluation.");

      const created = j?.item as Evaluation;
      setEvaluations((prev) => {
        const next = [...prev, created];
        next.sort((a, b) => a.eval_date.localeCompare(b.eval_date));
        return next;
      });
      setGrades((prev) => ({ ...prev, [created.id]: {} }));

      // Sur mobile, on se place tout de suite sur cette nouvelle note
      setActiveEvalId(created.id);
      setMsg("NOTE ajoutée ✅ (colonne active sur mobile)");
    } catch (e: any) {
      setMsg(e?.message || "Échec d’ajout de la note.");
    } finally {
      setCreating(false);
    }
  }

  /* -------- Publication (panneau séparé) -------- */
  async function togglePublish(ev: Evaluation) {
    if (!isOnline) {
      setMsg("La publication d’une évaluation nécessite une connexion Internet.");
      return;
    }
    if (selectedPeriodClosed) {
      setMsg("Cette période est clôturée. Impossible de modifier la publication.");
      return;
    }

    if (isEvaluationSubmitted(ev)) {
      setMsg(
        "Cette évaluation est déjà soumise. Attendez la validation de l’administration ou une demande de correction."
      );
      return;
    }

    setMsg(null);

    const next = !isEvaluationPublished(ev);

    setPublishBusy((prev) => ({ ...prev, [ev.id]: true }));

    try {
      const r = await fetch("/api/teacher/grades/evaluations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_id: ev.id,
          is_published: next,
        }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Échec de mise à jour.");
      }

      const updated = j.item as Evaluation;

      setEvaluations((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e))
      );

      const resultAction = String(j?.publication?.action || "");
      const updatedStatus = getPublicationStatus(updated);

      if (resultAction === "submitted" || updatedStatus === "submitted") {
        setMsg("Demande de publication envoyée ✅. En attente de validation administrative.");
      } else if (updatedStatus === "published" || updated.is_published === true) {
        setMsg("Évaluation publiée officiellement ✅.");
      } else if (updatedStatus === "draft") {
        setMsg("Évaluation repassée en brouillon.");
      } else {
        setMsg("Publication mise à jour ✅.");
      }
    } catch (e: any) {
      setMsg(e?.message || "Échec de mise à jour de la publication.");
    } finally {
      setPublishBusy((prev) => {
        const copy = { ...prev };
        delete copy[ev.id];
        return copy;
      });
    }
  }

  /* -------- Suppression d’une évaluation (colonne) -------- */
  async function deleteEvaluation(ev: Evaluation) {
    if (!isOnline) {
      setMsg("La suppression d’une évaluation nécessite une connexion Internet.");
      return;
    }
    if (selectedPeriodClosed) {
      setMsg("Cette période est clôturée. Impossible de supprimer une colonne.");
      return;
    }

    if (!isEvaluationDeletableForTeacher(ev)) {
      setMsg(
        "Cette évaluation est soumise ou publiée. Elle ne peut plus être supprimée directement."
      );
      return;
    }

    if (
      !window.confirm(
        "Supprimer définitivement cette colonne de notes ?\nToutes les notes associées seront perdues."
      )
    ) {
      return;
    }

    setMsg(null);
    setPublishBusy((prev) => ({ ...prev, [ev.id]: true }));

    try {
      const r = await fetch("/api/teacher/grades/evaluations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluation_id: ev.id }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Échec de suppression.");
      }

      setEvaluations((prev) => prev.filter((e) => e.id !== ev.id));

      setGrades((prev) => {
        const next = { ...prev };
        delete next[ev.id];
        return next;
      });

      setChanged((prev) => {
        const next = { ...prev };
        delete next[ev.id];
        return next;
      });

      setMsg("Colonne de note supprimée ✅");
    } catch (e: any) {
      setMsg(e?.message || "Échec de suppression de la colonne de note.");
    } finally {
      setPublishBusy((prev) => {
        const copy = { ...prev };
        delete copy[ev.id];
        return copy;
      });
    }
  }

  /* ==========================================
     Moyennes (vue dédiée)
     🚨 Basées sur /api/teacher/grades/averages
     + calcul local des moyennes par sous-rubrique
  ========================================== */
  type RowAvg = {
    student: RosterItem;
    // 0 = vraie moyenne publiée/saisie ; null = aucune moyenne calculable, donc NC.
    avg20: number | null;
    bonus: number;
    final: number | null;
    rank: number | null;

    // Nouvelle règle prof :
    // - moyenne calculable = rang affiché ;
    // - aucune note / aucune moyenne = NC.
    hasAverage: boolean;
    isComplete: boolean;
    status: "complete" | "partial" | "empty" | string;

    componentsAvg?: Record<string, number>; // ✅ moyenne /20 par sous-rubrique (subject_component_id -> moyenne)
  };
  const [avgRows, setAvgRows] = useState<RowAvg[]>([]);
  const [bonusMap, setBonusMap] = useState<Record<string, number>>({});
  const [loadingAvg, setLoadingAvg] = useState(false);

  // Quand on est en mode "moyennes", on recalcule les moyennes par sous-rubrique
  // à partir des évaluations + notes (comme sur le compte classe).
  useEffect(() => {
    if (mode !== "moyennes") return;
    if (!hasComponents) return;
    if (!components.length) return;
    if (!evaluations.length) return;
    if (!roster.length) return;

    // Groupement des évaluations par sous-rubrique
    const evalsByComponent: Record<string, Evaluation[]> = {};
    for (const ev of evaluations) {
      const compId = ev.subject_component_id;
      if (!compId) continue;
      if (!evalsByComponent[compId]) evalsByComponent[compId] = [];
      evalsByComponent[compId].push(ev);
    }

    const componentAvgsByStudent: Record<string, Record<string, number>> = {};

    for (const st of roster) {
      const perComp: Record<string, number> = {};

      for (const comp of components) {
        const list = evalsByComponent[comp.id];
        if (!list || !list.length) continue;

        let num = 0;
        let den = 0;

        for (const ev of list) {
          const raw = grades[ev.id]?.[st.id]; // on se base sur les notes en base
          if (raw == null) continue;
          const score = Number(raw);
          if (!Number.isFinite(score)) continue;

          const normalized20 = (score / ev.scale) * 20;
          const coeffEval = Number(ev.coeff || 1);
          num += normalized20 * coeffEval;
          den += coeffEval;
        }

        if (den > 0) {
          const avg = num / den;
          // Arrondi à 2 décimales comme sur le compte classe
          perComp[comp.id] = Math.round(avg * 100) / 100;
        }
      }

      if (Object.keys(perComp).length > 0) {
        componentAvgsByStudent[st.id] = perComp;
      }
    }

    if (!Object.keys(componentAvgsByStudent).length) return;

    setAvgRows((prev) =>
      prev.map((row) => ({
        ...row,
        componentsAvg:
          componentAvgsByStudent[row.student.id] || row.componentsAvg || {},
      }))
    );
  }, [mode, hasComponents, components, evaluations, grades, roster]);

  function cleanAvgValue(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
  }

  function formatAvgOrNC(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "NC";
    }
    return Number(value).toFixed(2);
  }

  function formatRankOrNC(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "NC";
    }
    const n = Number(value);
    if (n <= 0) return "NC";
    return String(Math.round(n));
  }

  function buildDenseRanksFromRows(rows: Array<{ studentId: string; final: number | null }>) {
    const sorted = rows
      .filter((row) => row.final !== null && Number.isFinite(Number(row.final)))
      .map((row) => ({ studentId: row.studentId, final: Number(row.final) }))
      .sort((a, b) => b.final - a.final);

    const rankMap = new Map<string, number>();
    let lastScore: number | null = null;
    let currentRank = 0;
    let position = 0;

    for (const row of sorted) {
      position += 1;
      if (lastScore === null || row.final !== lastScore) {
        currentRank = position;
        lastScore = row.final;
      }
      rankMap.set(row.studentId, currentRank);
    }

    return rankMap;
  }

  function applyAveragesFromApi(items: AverageApiRow[]) {
    const map = new Map(items.map((row) => [row.student_id, row]));

    const rowsBase: RowAvg[] = roster.map((st) => {
      const src = map.get(st.id);

      const avg20 = src ? cleanAvgValue(src.average_raw ?? src.average) : null;
      const bonus = src ? cleanAvgValue(src.bonus) ?? 0 : 0;
      const finalFromApi = src
        ? cleanAvgValue(src.average_rounded ?? src.average)
        : null;

      const final =
        finalFromApi !== null
          ? finalFromApi
          : avg20 !== null
          ? Math.min(20, Math.max(0, Math.round((avg20 + bonus) * 100) / 100))
          : null;

      const hasAverage =
        src?.has_average === true ||
        avg20 !== null ||
        final !== null;

      return {
        student: st,
        avg20,
        bonus,
        final,
        rank: src ? cleanAvgValue(src.rank) : null,
        hasAverage,
        isComplete: src?.is_complete === true,
        status: hasAverage ? String(src?.status || "partial") : "empty",
      };
    });

    // Sécurité front : côté prof, un élève ayant une moyenne calculable doit avoir un rang.
    // Cela garde la page compatible même si une ancienne API ne renvoie pas encore rank.
    const fallbackRanks = buildDenseRanksFromRows(
      rowsBase.map((row) => ({
        studentId: row.student.id,
        final: row.hasAverage ? row.final : null,
      }))
    );

    const rows = rowsBase.map((row) => ({
      ...row,
      rank: row.hasAverage ? row.rank ?? fallbackRanks.get(row.student.id) ?? null : null,
    }));

    setAvgRows(rows);

    const bm: Record<string, number> = {};
    rows.forEach((r) => {
      bm[r.student.id] = r.bonus;
    });

    if (!items.length) {
      setMsg("Aucune moyenne à calculer pour le moment (aucune note saisie).");
    }

    setBonusMap(bm);
  }

  async function openAverages() {
    if (!selected) return;
    if (!isOnline) {
      setMsg(
        "Le calcul officiel des moyennes nécessite Internet dans cette version. Vos notes hors ligne restent enregistrées sur l’appareil."
      );
      return;
    }
    setMode("moyennes");
    setLoadingAvg(true);
    setMsg(null);
    try {
      const params = buildAverageParams();
      const r = await fetch(
        `/api/teacher/grades/averages?${params.toString()}`,
        { cache: "no-store" }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec du calcul des moyennes.");
      }
      const arr = (j.items || []) as AverageApiRow[];
      applyAveragesFromApi(arr);
    } catch (e: any) {
      setAvgRows([]);
      setMsg(e?.message || "Échec du calcul des moyennes.");
    } finally {
      setLoadingAvg(false);
    }
  }

  async function saveBonuses() {
    if (!selected) return;
    if (!isOnline) {
      setMsg("L’enregistrement des bonus nécessite une connexion Internet.");
      return;
    }
    if (selectedPeriodClosed) {
      setMsg("Cette période est clôturée. Impossible de modifier les bonus.");
      return;
    }
    setLoadingAvg(true);
    setMsg(null);
    try {
      const items = Object.entries(bonusMap).map(([student_id, bonus]) => ({
        student_id,
        bonus: Number.isFinite(bonus) ? Number(bonus) : 0,
      }));
      const r = await fetch("/api/teacher/grades/adjustments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: selected.class_id,
          subject_id: selected.subject_id,
          grading_period_id: selectedPeriodId || null,
          items,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok)
        throw new Error(j?.error || "Échec d’enregistrement des bonus.");

      // On relit les moyennes pour refléter les bonus stockés en base
      const params = buildAverageParams();
      const r2 = await fetch(
        `/api/teacher/grades/averages?${params.toString()}`,
        { cache: "no-store" }
      );
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok || !j2?.ok)
        throw new Error(j2?.error || "Échec du recalcul des moyennes.");
      const arr2 = (j2.items || []) as AverageApiRow[];
      applyAveragesFromApi(arr2);

      setMsg("Bonus enregistrés ✅");
    } catch (e: any) {
      setMsg(e?.message || "Échec d’enregistrement des bonus.");
    } finally {
      setLoadingAvg(false);
    }
  }

  /* ==========================================
     Helpers d'affichage
  ========================================== */
  function formatDateFr(value: string | null | undefined) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString("fr-FR");
    } catch {
      return value;
    }
  }

  /* ==========================================
     Export PDF (fiche statistique par évaluation)
     ✅ Rendu enrichi : indicateurs clés + graphique compact + lecture pédagogique.
  ========================================== */
  function exportEvalToPdf(ev: Evaluation) {
    if (!selected) {
      setMsg("Sélectionnez une classe/discipline avant d’exporter.");
      return;
    }
    if (!roster.length) {
      setMsg("Aucun élève dans cette classe pour générer la fiche.");
      return;
    }

    // On prend en compte les changements non enregistrés aussi.
    const evalGrades = { ...(grades[ev.id] || {}) };
    const pending = changed[ev.id] || {};
    for (const [sid, val] of Object.entries(pending)) {
      evalGrades[sid] = val;
    }

    const scale = ev.scale || 20;
    const to20 = (v: number) => (v / scale) * 20;
    const fmt = (v: number | null | undefined, digits = 2) =>
      v == null || Number.isNaN(v) ? "—" : v.toFixed(digits);
    const fmtPct = (v: number | null | undefined, digits = 1) =>
      v == null || Number.isNaN(v) ? "—" : `${v.toFixed(digits)} %`;

    const rows = roster.map((st, idx) => {
      const score =
        evalGrades[st.id] == null ? null : Number(evalGrades[st.id]);
      const score20 = score == null || Number.isNaN(score) ? null : to20(score);
      return { idx: idx + 1, student: st, score, score20 };
    });

    const withScores = rows.filter(
      (r) => typeof r.score === "number" && !Number.isNaN(r.score)
    );
    if (!withScores.length) {
      setMsg("Aucune note saisie pour cette évaluation.");
      return;
    }

    const scores = withScores.map((r) => r.score as number).sort((a, b) => a - b);
    const scores20 = withScores.map((r) => r.score20 as number).sort((a, b) => a - b);
    const count = scores.length;
    const nbEleves = roster.length;
    const nbSansNote = nbEleves - count;
    const completionRate = nbEleves > 0 ? (count * 100) / nbEleves : 0;

    const sum = scores.reduce((acc, v) => acc + v, 0);
    const avgRaw = sum / count;
    const minRaw = scores[0];
    const maxRaw = scores[scores.length - 1];
    const avg20 = to20(avgRaw);
    const min20 = to20(minRaw);
    const max20 = to20(maxRaw);

    const medianRaw =
      count % 2 === 1
        ? scores[(count - 1) / 2]
        : (scores[count / 2 - 1] + scores[count / 2]) / 2;
    const median20 = to20(medianRaw);
    const variance20 =
      scores20.reduce((acc, v) => acc + Math.pow(v - avg20, 2), 0) / count;
    const stdDev20 = Math.sqrt(variance20);

    const successCount = scores20.filter((v) => v >= 10).length;
    const excellenceCount = scores20.filter((v) => v >= 15).length;
    const fragileCount = scores20.filter((v) => v < 8).length;
    const successRate = count > 0 ? (successCount * 100) / count : 0;
    const excellenceRate = count > 0 ? (excellenceCount * 100) / count : 0;
    const fragileRate = count > 0 ? (fragileCount * 100) / count : 0;

    const distDefs = [
      { label: "0 à 4,99", from: 0, to: 5 },
      { label: "5 à 9,99", from: 5, to: 10 },
      { label: "10 à 14,99", from: 10, to: 15 },
      { label: "15 à 20", from: 15, to: 20.00001 },
    ];
    const distRows = distDefs.map((d) => {
      const effectif = scores20.filter((v) => v >= d.from && v < d.to).length;
      const pct = count > 0 ? (effectif * 100) / count : 0;
      return { ...d, effectif, pct };
    });

    const rankedRows = [...withScores].sort(
      (a, b) => (b.score20 || 0) - (a.score20 || 0)
    );
    const best = rankedRows[0] || null;
    const weakest = rankedRows[rankedRows.length - 1] || null;

    const interpretation =
      avg20 >= 14
        ? "Très bon rendement global. Maintenir l’exigence et proposer des défis aux meilleurs élèves."
        : avg20 >= 10
          ? "Rendement global acceptable. Les élèves fragiles doivent être ciblés pour une consolidation rapide."
          : "Rendement global fragile. Une remédiation ciblée est recommandée avant la prochaine évaluation.";

    const typeLabel =
      ev.eval_kind === "devoir"
        ? "Devoir"
        : ev.eval_kind === "interro_ecrite"
          ? "Interrogation écrite"
          : "Interrogation orale";

    const dateFr = formatDateFr(ev.eval_date);
    const pdfTitle = `FICHE STATISTIQUE DE ${typeLabel.toUpperCase()} DU ${dateFr}`;

    const inst = institutionName || "";
    const year = academicYearLabel || "";
    const classe = selected.class_label || "";
    const subject = selected.subject_name || "Discipline";
    const periodLabel = selectedPeriod
      ? selectedPeriod.label || selectedPeriod.short_label || selectedPeriod.code || "Période"
      : "Toutes périodes";

    const chartRowsHtml = distRows
      .map((d) => {
        const maxBarWidth = 167;
        const width = d.effectif > 0 ? Math.max(8, Math.round((d.pct / 100) * maxBarWidth)) : 0;
        const color =
          d.from < 5
            ? "#dc2626"
            : d.from < 10
              ? "#f59e0b"
              : d.from < 15
                ? "#2563eb"
                : "#16a34a";
        return `<div class="bar-row">
          <div class="bar-label">${escapeHtml(d.label)}</div>
          <svg class="bar-svg" viewBox="0 0 170 14" preserveAspectRatio="none" aria-hidden="true">
            <rect x="0.75" y="0.75" width="168.5" height="12.5" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"></rect>
            ${width > 0 ? `<rect x="1.5" y="1.5" width="${width}" height="11" rx="5.5" fill="${color}"></rect>` : ""}
          </svg>
          <div class="bar-value">${d.effectif} (${fmtPct(d.pct)})</div>
        </div>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pdfTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body, .page, .header, .card, .box, .note-box, th, .bar-svg, svg, rect {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    @page { size: A4; margin: 12mm; }
    body {
      margin: 0;
      color: #0f172a;
      background: #f8fafc;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
    }
    .page {
      background: #fff;
      min-height: 100vh;
      padding: 18px;
    }
    .header {
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      padding: 14px 16px;
      background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
      color: #fff;
      margin-bottom: 12px;
    }
    .eyebrow {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #bfdbfe;
      margin-bottom: 5px;
    }
    h1 {
      font-size: 17px;
      line-height: 1.25;
      margin: 0 0 5px;
      text-transform: uppercase;
    }
    .subtitle { color: #dbeafe; font-size: 11px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 10px 0 12px;
    }
    .card {
      border: 1px solid #dbe4ef;
      border-radius: 12px;
      padding: 9px 10px;
      background: #f8fafc;
      min-height: 54px;
    }
    .card-label {
      color: #64748b;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: .06em;
      margin-bottom: 3px;
    }
    .card-value { font-size: 16px; font-weight: 800; color: #0f172a; }
    .card-note { color: #64748b; font-size: 9px; margin-top: 2px; }
    .two-cols {
      display: grid;
      grid-template-columns: 1.05fr .95fr;
      gap: 10px;
      align-items: start;
    }
    .box {
      border: 1px solid #dbe4ef;
      border-radius: 14px;
      padding: 10px;
      background: #fff;
      margin-bottom: 10px;
    }
    .section-title {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      border: 1px solid #dbe4ef;
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #eef2ff; font-weight: 700; color: #1e293b; }
    .text-right { text-align: right; }
    .small { font-size: 9px; color: #64748b; }
    .bar-row {
      display: grid;
      grid-template-columns: 62px 1fr 80px;
      gap: 8px;
      align-items: center;
      margin: 7px 0;
    }
    .bar-label { font-size: 10px; color: #334155; }
    .bar-svg { width: 100%; height: 14px; display: block; }
    .bar-value { font-size: 10px; color: #334155; text-align: right; }
    .note-box {
      border-left: 4px solid #2563eb;
      background: #eff6ff;
      padding: 8px 10px;
      border-radius: 10px;
      color: #1e3a8a;
      line-height: 1.45;
    }
    .footer {
      margin-top: 12px;
      font-size: 9px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      body { background: #fff; }
      .page { padding: 0; }
      .box, .card, .header { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <div class="eyebrow">Mon Cahier — Compte rendu pédagogique</div>
      <h1>${escapeHtml(pdfTitle)}</h1>
      <div class="subtitle">
        ${escapeHtml(inst || "Établissement non renseigné")}${
          year ? " • Année scolaire " + escapeHtml(year) : ""
        }<br/>
        Classe : ${escapeHtml(classe)} • Discipline : ${escapeHtml(subject)} • Période : ${escapeHtml(periodLabel)}
      </div>
    </section>

    <section class="grid">
      <div class="card"><div class="card-label">Effectif</div><div class="card-value">${nbEleves}</div><div class="card-note">élèves inscrits</div></div>
      <div class="card"><div class="card-label">Notes saisies</div><div class="card-value">${count}/${nbEleves}</div><div class="card-note">${fmtPct(completionRate)} de couverture</div></div>
      <div class="card"><div class="card-label">Moyenne classe</div><div class="card-value">${fmt(avg20)} / 20</div><div class="card-note">${fmt(avgRaw)} / ${scale}</div></div>
      <div class="card"><div class="card-label">Taux de réussite</div><div class="card-value">${fmtPct(successRate)}</div><div class="card-note">${successCount} élève(s) ≥ 10/20</div></div>
      <div class="card"><div class="card-label">Très bonnes notes</div><div class="card-value">${fmtPct(excellenceRate)}</div><div class="card-note">${excellenceCount} élève(s) ≥ 15/20</div></div>
      <div class="card"><div class="card-label">Points de vigilance</div><div class="card-value">${fmtPct(fragileRate)}</div><div class="card-note">${fragileCount} élève(s) &lt; 8/20</div></div>
    </section>

    <section class="two-cols">
      <div class="box">
        <div class="section-title">Répartition graphique des notes /20</div>
        ${chartRowsHtml}
      </div>
      <div class="box">
        <div class="section-title">Lecture rapide</div>
        <table>
          <tbody>
            <tr><th>Type</th><td>${escapeHtml(typeLabel)}</td></tr>
            <tr><th>Date</th><td>${escapeHtml(dateFr || "—")}</td></tr>
            <tr><th>Échelle</th><td>/${scale}</td></tr>
            <tr><th>Coefficient</th><td>${ev.coeff}</td></tr>
            <tr><th>Min / Max</th><td>${fmt(min20)} /20 — ${fmt(max20)} /20</td></tr>
            <tr><th>Médiane</th><td>${fmt(median20)} /20</td></tr>
            <tr><th>Écart-type</th><td>${fmt(stdDev20)} /20</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="box">
      <div class="section-title">Appréciation statistique</div>
      <div class="note-box">${escapeHtml(interpretation)}</div>
    </section>

    <section class="box">
      <div class="section-title">Repères élèves</div>
      <table>
        <tbody>
          <tr><th>Meilleur résultat</th><td>${best ? `${escapeHtml(best.student.full_name)} — ${fmt(best.score)} / ${scale} (${fmt(best.score20)} /20)` : "—"}</td></tr>
          <tr><th>Résultat le plus faible</th><td>${weakest ? `${escapeHtml(weakest.student.full_name)} — ${fmt(weakest.score)} / ${scale} (${fmt(weakest.score20)} /20)` : "—"}</td></tr>
          <tr><th>Élèves sans note</th><td>${nbSansNote}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="box">
      <div class="section-title">Détails par élève</div>
      <table>
        <thead>
          <tr>
            <th>N°</th>
            <th>Matricule</th>
            <th>Nom et prénoms</th>
            <th class="text-right">Note /${scale}</th>
            <th class="text-right">Équiv. /20</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              if (typeof r.score !== "number" || Number.isNaN(r.score)) {
                return `<tr>
                  <td>${r.idx}</td>
                  <td>${escapeHtml(r.student.matricule || "")}</td>
                  <td>${escapeHtml(r.student.full_name)}</td>
                  <td class="text-right small">NC</td>
                  <td class="text-right small">NC</td>
                </tr>`;
              }
              return `<tr>
                <td>${r.idx}</td>
                <td>${escapeHtml(r.student.matricule || "")}</td>
                <td>${escapeHtml(r.student.full_name)}</td>
                <td class="text-right">${fmt(r.score)}</td>
                <td class="text-right">${fmt(r.score20)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </section>

    <div class="footer">
      <span>Fiche générée depuis Mon Cahier — Espace enseignant.</span>
      <span>${new Date().toLocaleDateString("fr-FR")}</span>
    </div>
  </main>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      setMsg(
        "Impossible d’ouvrir la fenêtre d’impression (popup peut-être bloquée)."
      );
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch {
        // silencieux
      }
    }, 300);
  }

  /* ==========================================
     Export CSV / Excel
     ✅ Rendu enrichi : BOM UTF-8, séparateur Excel, contexte, indicateurs utiles.
  ========================================== */
  async function exportToCsv() {
    if (!selected) {
      setMsg("Sélectionnez une classe/discipline avant d’exporter.");
      return;
    }
    if (!roster.length) {
      setMsg("Aucun élève à exporter pour cette classe.");
      return;
    }

    try {
      const csvCell = (cell: string | number | null | undefined) => {
        const v = cell == null ? "" : String(cell);
        return `"${v.replace(/"/g, '""')}"`;
      };
      const csvLine = (cells: (string | number | null | undefined)[]) =>
        cells.map(csvCell).join(";");
      const formatCsvNumber = (v: number | null | undefined) =>
        v == null || Number.isNaN(v) ? "" : v.toFixed(2).replace(".", ",");
      const formatCsvPct = (v: number | null | undefined) =>
        v == null || Number.isNaN(v) ? "" : `${v.toFixed(1).replace(".", ",")}%`;

      // On tente de récupérer les moyennes consolidées.
      let avgByStudent = new Map<string, AverageApiRow>();
      try {
        const params = buildAverageParams();
        const r = await fetch(
          `/api/teacher/grades/averages?${params.toString()}`,
          { cache: "no-store" }
        );
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok && Array.isArray(j.items)) {
          const arr = j.items as AverageApiRow[];
          avgByStudent = new Map(
            arr.map((row) => [row.student_id, row] as const)
          );
        }
      } catch {
        avgByStudent = new Map();
      }

      const headers: string[] = ["N°", "Matricule", "Nom complet"];
      evaluations.forEach((ev) => {
        const label = labelByEvalId[ev.id] ?? "NOTE";
        headers.push(`${label} (/${ev.scale})`);
      });
      headers.push(
        "Moyenne finale (/20)",
        "Bonus",
        "Rang",
        "Évaluations saisies",
        "Évaluations prévues",
        "Taux de saisie",
        "Statut"
      );

      let globalWithAverage = 0;
      let globalSuccess = 0;
      let globalSum = 0;
      const rowsCsv: string[][] = [];

      roster.forEach((st, idx) => {
        const row: (string | number | null | undefined)[] = [
          idx + 1,
          st.matricule ?? "",
          st.full_name,
        ];

        let num = 0;
        let den = 0;
        let localCount = 0;

        evaluations.forEach((ev) => {
          const raw =
            changed[ev.id]?.[st.id] ?? grades[ev.id]?.[st.id] ?? null;

          row.push(raw == null ? "" : formatCsvNumber(Number(raw)));

          if (raw != null) {
            const normalized = (Number(raw) / ev.scale) * 20;
            const w = Number(ev.coeff || 1);
            num += normalized * w;
            den += w;
            localCount += 1;
          }
        });

        const avg20Local = den > 0 ? num / den : null;
        const bonusLocal = bonusMap[st.id] ?? 0;
        const finalLocal =
          avg20Local !== null
            ? Math.min(
                20,
                Math.max(0, Math.round((avg20Local + bonusLocal) * 100) / 100)
              )
            : null;

        const apiRow = avgByStudent.get(st.id);
        const finalFromApi = apiRow
          ? cleanAvgValue(apiRow.average_rounded ?? apiRow.average) ?? finalLocal
          : finalLocal;
        const bonusFromApi = apiRow ? cleanAvgValue(apiRow.bonus) ?? bonusLocal : bonusLocal;
        const rankFromApi = apiRow ? cleanAvgValue(apiRow.rank) : null;
        const expectedCount = apiRow?.total_evals ?? evaluations.length;
        const enteredCount = apiRow?.count_evals ?? localCount;
        const completionRate = expectedCount > 0 ? (enteredCount * 100) / expectedCount : null;
        const status =
          finalFromApi === null
            ? "NC"
            : enteredCount < expectedCount
              ? "Partiel"
              : "Complet";

        if (finalFromApi !== null) {
          globalWithAverage += 1;
          globalSum += finalFromApi;
          if (finalFromApi >= 10) globalSuccess += 1;
        }

        row.push(
          finalFromApi === null ? "NC" : formatCsvNumber(finalFromApi),
          formatCsvNumber(bonusFromApi),
          rankFromApi == null ? "" : rankFromApi,
          enteredCount,
          expectedCount,
          formatCsvPct(completionRate),
          status
        );

        rowsCsv.push(row.map((cell) => csvCell(cell)));
      });

      const periodLabel = selectedPeriod
        ? selectedPeriod.label || selectedPeriod.short_label || selectedPeriod.code || "Période"
        : "Toutes périodes";
      const exportDate = new Date().toLocaleDateString("fr-FR");
      const globalAverage = globalWithAverage > 0 ? globalSum / globalWithAverage : null;
      const globalSuccessRate =
        globalWithAverage > 0 ? (globalSuccess * 100) / globalWithAverage : null;

      const metaLines = [
        csvLine(["Rapport", "Export des notes - Mon Cahier"]),
        csvLine(["Établissement", institutionName || ""]),
        csvLine(["Année scolaire", academicYearLabel || ""]),
        csvLine(["Classe", selected.class_label || ""]),
        csvLine(["Discipline", selected.subject_name || "Discipline"]),
        csvLine(["Période", periodLabel]),
        csvLine(["Date export", exportDate]),
        csvLine(["Moyenne globale", globalAverage == null ? "" : formatCsvNumber(globalAverage)]),
        csvLine(["Taux de réussite", formatCsvPct(globalSuccessRate)]),
        "",
      ];

      const headerStr = headers.map(csvCell).join(";");
      const csvLines = [
        "sep=;",
        ...metaLines,
        headerStr,
        ...rowsCsv.map((r) => r.join(";")),
      ];
      const csvContent = `\ufeff${csvLines.join("\r\n")}`;

      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });

      const safeClass = selected.class_label.replace(/\s+/g, "_");
      const safeSubj = (selected.subject_name || "Discipline").replace(
        /\s+/g,
        "_"
      );
      const today = new Date().toISOString().slice(0, 10);
      const filename = `notes_${safeClass}_${safeSubj}_${today}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setMsg("Export CSV généré ✅ (Excel : encodage et séparateur optimisés).");
    } catch (e: any) {
      setMsg(e?.message || "Échec de génération du CSV.");
    }
  }

  /* ==========================================
     Dérivés UI
  ========================================== */
  const totalChanges = useMemo(
    () =>
      Object.values(changed).reduce(
        (acc, per) => acc + Object.keys(per).length,
        0
      ),
    [changed]
  );

  // Libellés par type : DEVOIR1, DEVOIR2, IE1, IE2, IO1, IO2…
  const labelByEvalId: Record<string, string> = useMemo(() => {
    const counters: Record<EvalKind, number> = {
      devoir: 0,
      interro_ecrite: 0,
      interro_orale: 0,
    };
    const map: Record<string, string> = {};
    for (const ev of evaluations) {
      counters[ev.eval_kind] += 1;
      const idx = counters[ev.eval_kind];
      let prefix: string;
      if (ev.eval_kind === "devoir") prefix = "DEVOIR";
      else if (ev.eval_kind === "interro_ecrite") prefix = "IE";
      else prefix = "IO";
      map[ev.id] = `${prefix}${idx}`;
    }
    return map;
  }, [evaluations]);

  /* ==========================================
     Colonne active sur mobile
  ========================================== */
  const currentActiveEvalId = useMemo(() => {
    if (!evaluations.length) return null;
    if (activeEvalId && evaluations.some((ev) => ev.id === activeEvalId)) {
      return activeEvalId;
    }
    return evaluations[evaluations.length - 1]?.id ?? null;
  }, [evaluations, activeEvalId]);

  const displayedEvaluations = useMemo(() => {
    if (!isMobile) return evaluations;
    if (!evaluations.length) return evaluations;
    if (!currentActiveEvalId) return evaluations;
    return evaluations.filter((ev) => ev.id === currentActiveEvalId);
  }, [isMobile, evaluations, currentActiveEvalId]);

  const currentVoiceEvalId = useMemo(() => {
    if (!evaluations.length) return null;
    if (isMobile) return currentActiveEvalId;
    if (voiceEvalId && evaluations.some((ev) => ev.id === voiceEvalId)) {
      return voiceEvalId;
    }
    return evaluations[evaluations.length - 1]?.id ?? null;
  }, [evaluations, isMobile, currentActiveEvalId, voiceEvalId]);

  /* ==========================================
     Rendu
  ========================================== */
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      {/* Header bleu nuit avec établissement + année scolaire */}
      <header className="rounded-2xl border border-indigo-800/60 bg-linear-to-r from-slate-950 via-indigo-900 to-slate-900 px-4 py-4 md:px-6 md:py-5 text-white shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200/80">
              {institutionName || "Nom de l’établissement"}
              {academicYearLabel
                ? ` • Année scolaire ${academicYearLabel}`
                : ""}
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Cahier de notes — Espace enseignant
            </h1>
            <p className="text-xs md:text-sm text-indigo-100/85">
              Créez vos évaluations et saisissez les notes en quelques gestes,
              même sur mobile. Les évaluations déjà préparées restent saisissables sans Internet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="amber"
              onClick={() => window.location.reload()}
              className="shadow-md"
            >
              <RefreshCw className="h-4 w-4" /> Actualiser
            </Button>
            {mode === "saisie" ? (
              <Button
                tone="amber"
                onClick={openAverages}
                className="shadow-md"
              >
                <Eye className="h-4 w-4" /> Voir les moyennes
              </Button>
            ) : (
              <Button
                tone="amber"
                onClick={() => setMode("saisie")}
                className="shadow-md"
              >
                <EyeOff className="h-4 w-4" /> Retour à la saisie
              </Button>
            )}
          </div>
        </div>
      </header>

      <OfflineSyncBar onMessage={setMsg} />
      <OfflineReadinessCard role="teacher" />

      {/* Sélection + création NOTE */}
      <section className="rounded-2xl border border-emerald-200 bg-linear-to-b from-emerald-50/60 to-white p-5 space-y-4 ring-1 ring-emerald-100">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Classe — Discipline
            </div>
            <Select
              value={selKey}
              onChange={(e) => setSelKey(e.target.value)}
              aria-label="Classe — Discipline"
            >
              <option value="">— Sélectionner —</option>
              {classOptionGroups.map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              Seules vos classes affectées apparaissent, regroupées par enseignement et formation.
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <FileText className="h-3.5 w-3.5" />
              Période configurée
            </div>
            <Select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              aria-label="Période configurée"
              disabled={loadingPeriods || gradePeriods.length === 0}
            >
              {gradePeriods.length === 0 ? (
                <option value="">— Aucune période configurée —</option>
              ) : (
                gradePeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label || p.short_label || p.code || "Période"}
                  </option>
                ))
              )}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              {loadingPeriods
                ? "Chargement des périodes…"
                : selectedPeriod
                ? `Du ${formatDateFr(selectedPeriod.start_date)} au ${formatDateFr(
                    selectedPeriod.end_date
                  )}`
                : "Choisissez le trimestre ou la période à afficher."}
            </div>
          </div>

          {/* Création NOTE */}
          <div className="md:col-span-2">
            <div
              className={`grid grid-cols-2 gap-2 ${
                hasComponents ? "md:grid-cols-6" : "md:grid-cols-5"
              }`}
            >
              <div>
                <Input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  aria-label="Date"
                  disabled={selectedPeriodClosed}
                />
              </div>
              <div>
                <Select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as EvalKind)}
                  aria-label="Type d’évaluation"
                  disabled={selectedPeriodClosed}
                >
                  <option value="devoir">Devoir</option>
                  <option value="interro_ecrite">Interrogation écrite</option>
                  <option value="interro_orale">Interrogation orale</option>
                </Select>
              </div>

              {hasComponents && (
                <div className="col-span-2 md:col-span-2">
                  <Select
                    value={selectedComponentId}
                    onChange={(e) => setSelectedComponentId(e.target.value)}
                    aria-label="Sous-rubrique"
                    disabled={selectedPeriodClosed}
                  >
                    <option value="">
                      — Sous-rubrique (Français, etc.) —
                    </option>
                    {components.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.short_label || c.label} (coeff {c.coeff_in_subject})
                      </option>
                    ))}
                  </Select>
                  {componentsLoading && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      Chargement des sous-rubriques…
                    </div>
                  )}
                </div>
              )}

              <div>
                <Select
                  value={String(newScale)}
                  onChange={(e) =>
                    setNewScale(Number(e.target.value) as 5 | 10 | 20)
                  }
                  aria-label="Échelle"
                  disabled={selectedPeriodClosed}
                >
                  {[5, 10, 20].map((s) => (
                    <option key={s} value={s}>
                      /{s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2 md:col-span-2">
                <Select
                  value={String(newCoeff)}
                  onChange={(e) => setNewCoeff(Number(e.target.value))}
                  aria-label="Coefficient"
                  disabled={selectedPeriodClosed}
                >
                  {[0.25, 0.5, 1, 2, 3].map((c) => (
                    <option key={c} value={c}>
                      Coeff {c}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="mt-2">
              <Button
                onClick={addEvaluation}
                disabled={!selected || creating || selectedPeriodClosed}
              >
                <Plus className="h-4 w-4" />
                {creating ? "Ajout…" : "Ajouter une note"}
              </Button>
            </div>
          </div>
        </div>

        {selectedPeriodClosed && selectedPeriod && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            aria-live="polite"
          >
            Cette période est clôturée depuis le <strong>{formatDateFr(selectedPeriod.end_date)}</strong>. La saisie des notes et des bonus est désactivée côté enseignant.
          </div>
        )}

        {msg && (
          <div
            className="rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "#cbd5e1",
              background: "#f8fafc",
              color: "#334155",
            }}
            aria-live="polite"
          >
            {msg}
          </div>
        )}
      </section>

      {/* Vue SAISIE */}
      {mode === "saisie" && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-700">
              {evaluations.length}{" "}
              {evaluations.length <= 1
                ? "colonne de note"
                : "colonnes de notes"}{" "}
              • {roster.length} élèves
              {isMobile &&
                currentActiveEvalId &&
                evaluations.length > 0 && (
                  <span className="ml-1 text-xs text-slate-500">
                    — colonne affichée :{" "}
                    {
                      labelByEvalId[
                        currentActiveEvalId as keyof typeof labelByEvalId
                      ]
                    }
                  </span>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <GhostButton
                tone="slate"
                onClick={() => setShowPublishPanel(true)}
                disabled={!evaluations.length || selectedPeriodClosed}
              >
                Gérer la publication
              </GhostButton>
              <GhostButton
                tone="emerald"
                onClick={exportToCsv}
                disabled={!roster.length || !evaluations.length}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Exporter (Excel/CSV)
              </GhostButton>
              <Button
                onClick={saveAllChanges}
                disabled={loading || totalChanges === 0 || selectedPeriodClosed}
              >
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </div>

          <VoiceGradeEntry
            roster={roster}
            evaluations={evaluations.map((ev) => ({
              id: ev.id,
              label: labelByEvalId[ev.id] ?? "NOTE",
              scale: ev.scale,
              disabled:
                selectedPeriodClosed ||
                isEvalLocked(ev.id) ||
                !isEvaluationEditableForTeacher(ev),
              disabledReason: selectedPeriodClosed
                ? "Cette période est clôturée."
                : isEvalLocked(ev.id)
                  ? "Cette évaluation est verrouillée."
                  : publicationLockReason(ev),
            }))}
            targetEvaluationId={currentVoiceEvalId}
            onTargetEvaluationChange={(evaluationId) => {
              setVoiceEvalId(evaluationId);
              if (isMobile) setActiveEvalId(evaluationId);
            }}
            onGrade={(evaluationId, studentId, value) => {
              const ev = evaluations.find((item) => item.id === evaluationId);
              if (!ev) return;
              setGrade(evaluationId, studentId, value, ev.scale);
            }}
            isOnline={isOnline}
          />

          {/* Bandeau de boutons DEVOIR1, DEVOIR2, IE1… sur mobile */}
          {isMobile && evaluations.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {evaluations.map((ev) => {
                const label = labelByEvalId[ev.id] ?? "NOTE";
                const isActive = currentActiveEvalId === ev.id;
                const comp = ev.subject_component_id
                  ? componentById[ev.subject_component_id]
                  : undefined;
                const rubLabel = comp?.short_label || comp?.label || "";
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setActiveEvalId(ev.id)}
                    className={[
                      "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition",
                      "focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                      isActive
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                    ].join(" ")}
                    title={
                      rubLabel
                        ? `${label} — ${rubLabel} (/ ${
                            evaluations.find((e) => e.id === ev.id)?.scale
                          })`
                        : label
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {isEvalLocked(ev.id) && (
                        <Lock className="h-3 w-3 text-amber-600" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}


          {/* ==== ACTIONS VERROU (mobile) ==== */}
          {isMobile && currentActiveEvalId && (
            <div className="mb-3 flex items-center justify-end">
              {(() => {
                const ev = evaluations.find((e) => e.id === currentActiveEvalId);
                if (!ev) return null;
                const locked = isEvalLocked(ev.id);
                return (
                  <GhostButton
                    type="button"
                    tone={locked ? "emerald" : "slate"}
                    onClick={() => openLockModal(ev, locked ? "unlock" : "lock")}
                    className="gap-2"
                    disabled={
                      selectedPeriodClosed ||
                      !isEvaluationEditableForTeacher(ev) ||
                      !!lockBusy[ev.id]
                    }
                    title={
                      !isEvaluationEditableForTeacher(ev)
                        ? publicationLockReason(ev) || "Évaluation non modifiable"
                        : locked
                        ? "Déverrouiller cette évaluation (PIN)"
                        : "Verrouiller cette évaluation (PIN)"
                    }
                  >
                    {locked ? (
                      <>
                        <Unlock className="h-4 w-4" />
                        Déverrouiller
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                        Verrouiller
                      </>
                    )}
                  </GhostButton>
                );
              })()}
            </div>
          )}

          {/* ==== LAYOUT PC : tableau classique ==== */}
          {!isMobile && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-left text-slate-600">
                    {/* sticky colonnes élèves */}
                    <th className="px-3 py-2 w-12 sticky left-0 z-20 bg-slate-50">
                      N°
                    </th>
                    <th className="px-3 py-2 w-40 sticky left-12 z-20 bg-slate-50">
                      Matricule
                    </th>
                    <th className="px-3 py-2 w-64 sticky left-52 z-20 bg-slate-50">
                      Nom et prénoms
                    </th>

                    {displayedEvaluations.map((ev) => {
                      const label = labelByEvalId[ev.id] ?? "NOTE";
                      const comp = ev.subject_component_id
                        ? componentById[ev.subject_component_id]
                        : undefined;
                      const rubLabel = comp?.short_label || comp?.label || "";
                      return (
                        <th
                          key={ev.id}
                          className="px-3 py-2 whitespace-nowrap"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div>
                              <div className="font-semibold">{label}</div>
                              <div className="text-[11px] text-slate-500">
                                /{ev.scale} • coeff {ev.coeff}
                                {rubLabel && (
                                  <>
                                    <br />
                                    <span className="text-[10px] text-emerald-700">
                                      {rubLabel} (rubrique)
                                    </span>
                                  </>
                                )}
                              </div>
                              <div className="mt-1">
                                <span
                                  className={[
                                    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                    publicationStatusClass(ev),
                                  ].join(" ")}
                                >
                                  {publicationStatusLabel(ev)}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                openLockModal(
                                  ev,
                                  isEvalLocked(ev.id) ? "unlock" : "lock"
                                )
                              }
                              disabled={
                                selectedPeriodClosed ||
                                !isEvaluationEditableForTeacher(ev) ||
                                !!lockBusy[ev.id]
                              }
                              className={[
                                "ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border",
                                isEvalLocked(ev.id)
                                  ? "border-amber-200 text-amber-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500/30",
                                "disabled:opacity-60",
                              ].join(" ")}
                              title={
                                isEvalLocked(ev.id)
                                  ? "Déverrouiller (PIN)"
                                  : "Verrouiller (PIN)"
                              }
                            >
                              {isEvalLocked(ev.id) ? (
                                <Unlock className="h-3.5 w-3.5" />
                              ) : (
                                <Lock className="h-3.5 w-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteEvaluation(ev)}
                              disabled={
                                selectedPeriodClosed ||
                                !isEvaluationDeletableForTeacher(ev) ||
                                !!publishBusy[ev.id]
                              }
                              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-100 text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-60"
                              title={
                                !isEvaluationDeletableForTeacher(ev)
                                  ? "Évaluation soumise ou publiée"
                                  : "Supprimer cette colonne de notes"
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={999}>
                        Chargement…
                      </td>
                    </tr>
                  ) : !selected ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={999}>
                        Sélectionnez une classe/discipline pour saisir les
                        notes.
                      </td>
                    </tr>
                  ) : roster.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={999}>
                        Aucun élève dans cette classe.
                      </td>
                    </tr>
                  ) : (
                    roster.map((st, idx) => (
                      <tr key={st.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 w-12 sticky left-0 z-10 bg-white">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2 w-40 sticky left-12 z-10 bg-white">
                          {st.matricule ?? ""}
                        </td>
                        <td className="px-3 py-2 w-64 sticky left-52 z-10 bg-white">
                          {st.full_name}
                        </td>

                        {displayedEvaluations.map((ev) => {
                          const scale = ev.scale;
                          const current =
                            changed[ev.id]?.[st.id] ??
                            grades[ev.id]?.[st.id] ??
                            null;
                          return (
                            <td key={ev.id} className="px-3 py-2 w-28">
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.25"
                                min={0}
                                max={scale}
                                disabled={
                                  selectedPeriodClosed ||
                                  isEvalLocked(ev.id) ||
                                  !isEvaluationEditableForTeacher(ev)
                                }
                                title={
                                  selectedPeriodClosed
                                    ? "Période clôturée"
                                    : isEvalLocked(ev.id)
                                    ? "Évaluation verrouillée"
                                    : !isEvaluationEditableForTeacher(ev)
                                    ? publicationLockReason(ev) || "Évaluation non modifiable"
                                    : undefined
                                }
                                value={current == null ? "" : String(current)}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const v =
                                    raw === ""
                                      ? null
                                      : Number(raw.replace(",", "."));
                                  setGrade(ev.id, st.id, v, scale);
                                }}
                                aria-label={`Note ${st.full_name}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ==== LAYOUT MOBILE : cartes élèves + champ de saisie ==== */}
          {isMobile && (
            <div className="space-y-2">
              {loading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Chargement…
                </div>
              ) : !selected ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Sélectionnez une classe/discipline pour saisir les notes.
                </div>
              ) : roster.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Aucun élève dans cette classe.
                </div>
              ) : displayedEvaluations.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Aucune colonne de note pour le moment. Ajoutez une note puis
                  choisissez-la dans les boutons (DEVOIR1, IE1…).
                </div>
              ) : (
                roster.map((st, idx) => {
                  const ev = displayedEvaluations[0];
                  const label = labelByEvalId[ev.id] ?? "NOTE";
                  const comp = ev.subject_component_id
                    ? componentById[ev.subject_component_id]
                    : undefined;
                  const rubLabel = comp?.short_label || comp?.label || "";
                  const scale = ev.scale;
                  const current =
                    changed[ev.id]?.[st.id] ?? grades[ev.id]?.[st.id] ?? null;

                  return (
                    <div
                      key={st.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold text-slate-500">
                          #{idx + 1} • {st.matricule || "—"}
                        </div>
                        <div className="text-[11px] text-slate-500 text-right">
                          {label} /{scale} • coeff {ev.coeff}
                          {rubLabel && (
                            <>
                              <br />
                              <span className="text-[10px] text-emerald-700">
                                {rubLabel}
                              </span>
                            </>
                          )}
                          <br />
                          <span
                            className={[
                              "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              publicationStatusClass(ev),
                            ].join(" ")}
                          >
                            {publicationStatusLabel(ev)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {st.full_name}
                      </div>
                      <div className="mt-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.25"
                          min={0}
                          max={scale}
                                disabled={
                                  selectedPeriodClosed ||
                                  isEvalLocked(ev.id) ||
                                  !isEvaluationEditableForTeacher(ev)
                                }
                                title={
                                  selectedPeriodClosed
                                    ? "Période clôturée"
                                    : isEvalLocked(ev.id)
                                    ? "Évaluation verrouillée"
                                    : !isEvaluationEditableForTeacher(ev)
                                    ? publicationLockReason(ev) || "Évaluation non modifiable"
                                    : undefined
                                }
                                value={current == null ? "" : String(current)}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const v =
                              raw === ""
                                ? null
                                : Number(raw.replace(",", "."));
                            setGrade(ev.id, st.id, v, scale);
                          }}
                          aria-label={`Note ${st.full_name}`}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      )}

      {/* Vue MOYENNES */}
      {mode === "moyennes" && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-700">
              Moyennes de la classe (pondérées par coeff et sous-matières) •{" "}
              {roster.length} élèves
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={saveBonuses} disabled={loadingAvg || selectedPeriodClosed}>
                <Save className="h-4 w-4" /> Enregistrer bonus
              </Button>
            </div>
          </div>

          {/* PC : tableau comme pour la saisie */}
          {!isMobile && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2 w-12 sticky left-0 z-20 bg-slate-50">
                      N°
                    </th>
                    <th className="px-3 py-2 w-40 sticky left-12 z-20 bg-slate-50">
                      Matricule
                    </th>
                    <th className="px-3 py-2 w-64 sticky left-52 z-20 bg-slate-50">
                      Nom et prénoms
                    </th>

                    {/* ✅ colonnes de moyennes par sous-rubrique, comme sur le compte classe */}
                    {hasComponents &&
                      components.map((comp) => (
                        <th
                          key={comp.id}
                          className="px-3 py-2 text-right whitespace-nowrap"
                        >
                          <div className="font-semibold text-xs md:text-sm">
                            {comp.short_label || comp.label}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            coeff {comp.coeff_in_subject}
                          </div>
                        </th>
                      ))}

                    <th className="px-3 py-2 text-right">Moyenne (/20)</th>
                    <th className="px-3 py-2 text-right">Bonus</th>
                    <th className="px-3 py-2 text-right">Finale (/20)</th>
                    <th className="px-3 py-2 text-right">Rang</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingAvg ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={999}>
                        Chargement…
                      </td>
                    </tr>
                  ) : roster.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-500" colSpan={999}>
                        Aucun élève dans cette classe.
                      </td>
                    </tr>
                  ) : (
                    avgRows.map((row, idx) => {
                      const bonus = bonusMap[row.student.id] ?? row.bonus ?? 0;
                      const final =
                        row.avg20 !== null
                          ? Math.min(
                              20,
                              Math.max(0, Math.round((row.avg20 + bonus) * 100) / 100)
                            )
                          : null;
                      return (
                        <tr
                          key={row.student.id}
                          className="hover:bg-slate-50/60"
                        >
                          <td className="px-3 py-2 w-12 sticky left-0 z-10 bg-white">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 w-40 sticky left-12 z-10 bg-white">
                            {row.student.matricule ?? ""}
                          </td>
                          <td className="px-3 py-2 w-64 sticky left-52 z-10 bg-white">
                            {row.student.full_name}
                          </td>

                          {/* valeurs /20 pour chaque sous-rubrique */}
                          {hasComponents &&
                            components.map((comp) => {
                              const v =
                                row.componentsAvg?.[comp.id] ?? undefined;
                              return (
                                <td
                                  key={comp.id}
                                  className="px-3 py-2 text-right tabular-nums"
                                >
                                  {v != null ? v.toFixed(2) : "—"}
                                </td>
                              );
                            })}

                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatAvgOrNC(row.avg20)}
                          </td>
                          <td className="px-3 py-2 w-24">
                            <Input
                              type="number"
                              step="0.25"
                              min={0}
                              max={10}
                              value={bonusMap[row.student.id] ?? row.bonus ?? 0}
                              onChange={(e) => {
                                const v = Number(e.target.value || 0);
                                setBonusMap((m) => ({
                                  ...m,
                                  [row.student.id]: Math.max(
                                    0,
                                    Math.min(10, v)
                                  ),
                                }));
                              }}
                              aria-label={`Bonus ${row.student.full_name}`}
                              disabled={selectedPeriodClosed}
                              title={selectedPeriodClosed ? "Période clôturée" : undefined}
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatAvgOrNC(final)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.hasAverage ? formatRankOrNC(row.rank) : "NC"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* MOBILE : cartes par élève */}
          {isMobile && (
            <div className="space-y-2 mt-2">
              {loadingAvg ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Chargement…
                </div>
              ) : roster.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Aucun élève dans cette classe.
                </div>
              ) : (
                avgRows.map((row, idx) => {
                  const bonus = bonusMap[row.student.id] ?? row.bonus ?? 0;
                  const final =
                    row.avg20 !== null
                      ? Math.min(
                          20,
                          Math.max(0, Math.round((row.avg20 + bonus) * 100) / 100)
                        )
                      : null;
                  return (
                    <div
                      key={row.student.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold text-slate-500">
                          #{idx + 1} • {row.student.matricule || "—"}
                        </div>
                        <div className="text-[11px] text-slate-500 text-right">
                          Rang :{" "}
                          <span className="font-semibold">
                            {row.hasAverage ? formatRankOrNC(row.rank) : "NC"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {row.student.full_name}
                      </div>

                      {/* bloc moyennes globale + finale */}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Moyenne /20
                          </div>
                          <div className="text-sm font-semibold">
                            {formatAvgOrNC(row.avg20)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Finale /20
                          </div>
                          <div className="text-sm font-semibold">
                            {formatAvgOrNC(final)}
                          </div>
                        </div>
                      </div>

                      {/* ✅ détail par sous-rubrique sur mobile aussi */}
                      {hasComponents && (
                        <div className="mt-2 text-xs text-slate-700">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Sous-rubriques (/20)
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {components.map((comp) => {
                              const v =
                                row.componentsAvg?.[comp.id] ?? undefined;
                              return (
                                <span
                                  key={comp.id}
                                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px]"
                                >
                                  <span className="font-medium mr-1">
                                    {comp.short_label || comp.label}:
                                  </span>
                                  <span className="tabular-nums">
                                    {v != null ? v.toFixed(2) : "—"}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="mt-2">
                        <div className="text-[11px] mb-1 text-slate-500">
                          Bonus (0 à 10)
                        </div>
                        <Input
                          type="number"
                          step="0.25"
                          min={0}
                          max={10}
                          value={bonus}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            setBonusMap((m) => ({
                              ...m,
                              [row.student.id]: Math.max(0, Math.min(10, v)),
                            }));
                          }}
                          aria-label={`Bonus ${row.student.full_name}`}
                          disabled={selectedPeriodClosed}
                          title={selectedPeriodClosed ? "Période clôturée" : undefined}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      )}

      {/* Panneau gestion publication + suppression */}
      {showPublishPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-slate-200 p-4 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base md:text-lg font-semibold">
                Gérer la publication des évaluations
              </h2>
              <GhostButton
                onClick={() => {
                  setShowPublishPanel(false);
                }}
              >
                Fermer
              </GhostButton>
            </div>
            <p className="text-xs md:text-sm text-slate-600 mb-3">
              Publiez ou soumettez les évaluations selon le mode choisi par l’établissement. Les notes soumises ou publiées ne sont plus modifiables directement.
            </p>

            {evaluations.length === 0 ? (
              <div className="text-sm text-slate-500">
                Aucune évaluation pour le moment.
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto rounded-xl border">
                <table className="min-w-full text-xs md:text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-slate-600">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Détails</th>
                      <th className="px-3 py-2 text-right">
                        Statut / publication
                      </th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {evaluations.map((ev) => {
                      const typeLabel =
                        ev.eval_kind === "devoir"
                          ? "Devoir"
                          : ev.eval_kind === "interro_ecrite"
                          ? "Interrogation écrite"
                          : "Interrogation orale";
                      const shortLabel = labelByEvalId[ev.id] ?? "";
                      const comp = ev.subject_component_id
                        ? componentById[ev.subject_component_id]
                        : undefined;
                      const rubLabel =
                        comp?.short_label || comp?.label || "";
                      return (
                        <tr key={ev.id} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2">
                            {formatDateFr(ev.eval_date)}
                          </td>
                          <td className="px-3 py-2">
                            {typeLabel}
                            {shortLabel && (
                              <span className="ml-1 text-[11px] text-slate-400">
                                ({shortLabel})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-xs md:text-sm">
                            /{ev.scale} • coeff {ev.coeff}
                            {rubLabel && (
                              <span className="ml-2 text-[11px] text-emerald-700">
                                • {rubLabel}
                              </span>
                            )}
                            {ev.published_at && (
                              <span className="ml-2 text-[11px] text-slate-400">
                                {`(publié le ${formatDateFr(
                                  ev.published_at
                                )})`}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={[
                                  "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                  publicationStatusClass(ev),
                                ].join(" ")}
                              >
                                {publicationStatusLabel(ev)}
                              </span>

                              {ev.review_comment && (
                                <span className="max-w-[220px] text-right text-[11px] text-rose-600">
                                  {ev.review_comment}
                                </span>
                              )}

                              <Button
                                type="button"
                                tone={
                                  isEvaluationPublished(ev)
                                    ? "slate"
                                    : isEvaluationChangesRequested(ev)
                                    ? "amber"
                                    : "emerald"
                                }
                                className="px-2 py-1 text-xs shadow-none"
                                onClick={() => togglePublish(ev)}
                                disabled={
                                  selectedPeriodClosed ||
                                  isEvaluationSubmitted(ev) ||
                                  !!publishBusy[ev.id]
                                }
                                title={
                                  isEvaluationSubmitted(ev)
                                    ? "Déjà soumis : attente validation administrative"
                                    : undefined
                                }
                              >
                                {publishBusy[ev.id]
                                  ? "Traitement…"
                                  : publicationActionLabel(ev)}
                              </Button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <GhostButton
                                tone="emerald"
                                type="button"
                                onClick={() => exportEvalToPdf(ev)}
                                disabled={
                                  !roster.length ||
                                  (Object.keys(grades[ev.id] || {}).length ===
                                    0 &&
                                    Object.keys(changed[ev.id] || {}).length ===
                                      0)
                                }
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Fiche PDF
                              </GhostButton>
                              <GhostButton
                                tone="red"
                                type="button"
                                onClick={() => deleteEvaluation(ev)}
                                disabled={
                                  selectedPeriodClosed ||
                                  !isEvaluationDeletableForTeacher(ev) ||
                                  !!publishBusy[ev.id]
                                }
                                title={
                                  !isEvaluationDeletableForTeacher(ev)
                                    ? "Évaluation soumise ou publiée"
                                    : undefined
                                }
                              >
                                Supprimer la note
                              </GhostButton>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    
      {/* ==== MODAL VERROUILLAGE (PIN) ==== */}
      {lockModalOpen && lockTargetEv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                {lockModalMode === "lock" ? (
                  <Lock className="h-5 w-5 text-amber-600" />
                ) : (
                  <Unlock className="h-5 w-5 text-emerald-700" />
                )}
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {lockModalMode === "lock" ? "Verrouiller" : "Déverrouiller"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {labelByEvalId[lockTargetEv.id] ?? "NOTE"} —{" "}
                    {lockTargetEv.eval_date}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                onClick={() => {
                  setLockModalOpen(false);
                  setLockTargetEv(null);
                  setPin("");
                  setPin2("");
                }}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              <p className="text-sm text-slate-600">
                {lockModalMode === "lock"
                  ? "Le verrou empêche toute modification des notes de cette évaluation (même après rafraîchissement)."
                  : "Entrez le code PIN pour déverrouiller et permettre la saisie / modification."}
              </p>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Code PIN
                </label>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                />
              </div>

              {lockModalMode === "lock" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700">
                    Confirmer (optionnel)
                  </label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={pin2}
                    onChange={(e) => setPin2(e.target.value)}
                    placeholder="••••"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <GhostButton
                type="button"
                onClick={() => {
                  setLockModalOpen(false);
                  setLockTargetEv(null);
                  setPin("");
                  setPin2("");
                }}
              >
                Annuler
              </GhostButton>

              <PrimaryButton
                type="button"
                tone={lockModalMode === "lock" ? "amber" : "emerald"}
                onClick={submitLockModal}
                disabled={!!lockBusy[lockTargetEv.id]}
              >
                {lockModalMode === "lock" ? "Verrouiller" : "Déverrouiller"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

</main>
  );
  }
