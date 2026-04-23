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
};

type RosterItem = { id: string; full_name: string; matricule: string | null };

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

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
  average_raw: number;
  bonus: number;
  average: number;
  average_rounded: number;
  rank: number;
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
          const r = await fetch(url, { cache: "no-store" });
          if (!r.ok) return null;
          return await r.json();
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
        value: tc,
      })),
    [teachClasses]
  );
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

  /* -------- Données -------- */
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [grades, setGrades] = useState<GradesByEval>({});
  const [changed, setChanged] = useState<GradesByEval>({});

  /* -------- Sous-matières (rubriques) -------- */
  const [components, setComponents] = useState<SubjectComponent[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string>("");

  const isCollege = selected ? isCollegeLevel(selected.level) : false;
  const hasComponents = isCollege && components.length > 0;

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

  /* ==========================================
     Chargements
  ========================================== */
  // Liste des classes/discipline du prof
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/teacher/classes", { cache: "no-store" });
        const j = await r.json().catch(() => ({ items: [] }));
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

  // Périodes de notes configurées (trimestres, semestres, etc.)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingPeriods(true);
        const params = new URLSearchParams();
        if (academicYearLabel) {
          params.set("academic_year", academicYearLabel);
        }
        const url = `/api/admin/institution/grading-periods${
          params.toString() ? `?${params.toString()}` : ""
        }`;
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
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
  }, [academicYearLabel]);

  // Rubriques / sous-matières pour les niveaux 6e-3e
  useEffect(() => {
    setComponents([]);
    setSelectedComponentId("");
    if (!selected || !selected.subject_id) return;
    if (!isCollegeLevel(selected.level)) return;

    (async () => {
      try {
        setComponentsLoading(true);
        // ✅ construction sûre des query params (pas de null)
        const params = new URLSearchParams();
        params.set("class_id", selected.class_id);
        if (selected.subject_id) {
          params.set("subject_id", selected.subject_id);
        }
        const r = await fetch(
          `/api/teacher/grades/components?${params.toString()}`,
          { cache: "no-store" }
        );
        const j = await r.json().catch(() => ({ items: [] }));
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
        const rRoster = await fetch(
          `/api/teacher/roster?class_id=${selected.class_id}`,
          {
            cache: "no-store",
          }
        );
        const jRoster = await rRoster.json().catch(() => ({ items: [] }));
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

        const rEvals = await fetch(
          `/api/teacher/grades/evaluations?${evalParams.toString()}`,
          { cache: "no-store" }
        );
        const jEvals = await rEvals.json().catch(() => ({ items: [] }));
        const evals = (jEvals.items || []) as Evaluation[];
        // tri par date croissante (stable)
        evals.sort((a, b) => a.eval_date.localeCompare(b.eval_date));
        setEvaluations(evals);

        // 3) Notes par évaluation
        const g: GradesByEval = {};
        await Promise.all(
          evals.map(async (ev) => {
            const r = await fetch(
              `/api/teacher/grades/scores?evaluation_id=${ev.id}`,
              {
                cache: "no-store",
              }
            );
            const j = await r.json().catch(() => ({ items: [] }));
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
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
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
    // Regrouper par évaluation
    const perEvalAll = Object.entries(changed).filter(([, per]) => Object.keys(per).length > 0);
    const perEval = perEvalAll.filter(([evaluation_id]) => !isEvalLocked(evaluation_id));
    const lockedWithChanges = perEvalAll.filter(([evaluation_id]) => isEvalLocked(evaluation_id));
    if (lockedWithChanges.length > 0 && perEval.length === 0) {
      setMsg("Toutes les colonnes modifiées sont verrouillées. Déverrouillez l’évaluation pour enregistrer.");
      return;
    }

    if (perEval.length === 0) {
      setMsg("Aucun changement à enregistrer.");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      for (const [evaluation_id, per] of perEval) {
        const items = Object.entries(per).map(([student_id, score]) => ({
          student_id,
          score: score == null ? null : Number(score),
        }));
        const r = await fetch("/api/teacher/grades/scores/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evaluation_id,
            items,
            delete_if_null: true,
            strict: false,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok)
          throw new Error(j?.error || "Échec d’enregistrement.");
      }

      // Merge local
      setGrades((prev) => {
        const next = { ...prev };
        for (const [evId, per] of Object.entries(changed)) {
          next[evId] = { ...(next[evId] || {}) };
          for (const [sid, val] of Object.entries(per)) next[evId][sid] = val;
        }
        return next;
      });
      setChanged({});
      setMsg(
        lockedWithChanges.length > 0
          ? "Notes enregistrées ✅ (certaines colonnes verrouillées ont été ignorées)"
          : "Notes enregistrées ✅"
      );
    } catch (e: any) {
      setMsg(e?.message || "Échec d’enregistrement des notes.");
    } finally {
      setLoading(false);
    }
  }

  async function addEvaluation() {
    if (!selected) return;

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
    setMsg(null);
    const next = !ev.is_published;
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
      if (!r.ok || !j?.ok)
        throw new Error(j?.error || "Échec de mise à jour.");

      const updated = j.item as Evaluation;
      setEvaluations((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e))
      );
      setMsg(
        next ? "Évaluation publiée ✅." : "Évaluation repassée en brouillon."
      );
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
      if (!r.ok || !j?.ok)
        throw new Error(j?.error || "Échec de suppression.");

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
    avg20: number; // moyenne brute avant bonus (API)
    bonus: number;
    final: number; // après bonus (et éventuel arrondi côté API)
    rank: number;
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

  function applyAveragesFromApi(items: AverageApiRow[]) {
    const map = new Map(items.map((row) => [row.student_id, row]));
    const rows: RowAvg[] = roster.map((st) => {
      const src = map.get(st.id);
      const avg20 = src ? src.average_raw ?? src.average ?? 0 : 0;
      const bonus = src ? src.bonus ?? 0 : 0;
      const final = src
        ? src.average_rounded ?? src.average ?? avg20 + bonus
        : avg20 + bonus;
      const rank = src ? src.rank ?? 0 : 0;
      return { student: st, avg20, bonus, final, rank };
    });
    setAvgRows(rows);
    const bm: Record<string, number> = {};
    rows.forEach((r) => {
      bm[r.student.id] = r.bonus;
    });
    if (!rows.length) {
      setMsg("Aucune moyenne à calculer pour le moment (aucune note saisie).");
    }
    setBonusMap(bm);
  }

  async function openAverages() {
    if (!selected) return;
    setMode("moyennes");
    setLoadingAvg(true);
    setMsg(null);
    try {
      const params = new URLSearchParams({
        class_id: selected.class_id,
      });
      if (selected.subject_id) {
        params.set("subject_id", selected.subject_id);
      }
      appendSelectedPeriod(params);
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
      const params = new URLSearchParams({
        class_id: selected.class_id,
      });
      if (selected.subject_id) {
        params.set("subject_id", selected.subject_id);
      }
      appendSelectedPeriod(params);
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
     👉 Avec établissement + année, comme compte classe
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

    // On prend en compte les changements non enregistrés aussi
    const evalGrades = { ...(grades[ev.id] || {}) };
    const pending = changed[ev.id] || {};
    for (const [sid, val] of Object.entries(pending)) {
      evalGrades[sid] = val;
    }

    const rows = roster.map((st, idx) => {
      const score =
        evalGrades[st.id] == null ? null : Number(evalGrades[st.id]);
      return { idx: idx + 1, student: st, score };
    });

    const withScores = rows.filter((r) => r.score != null);
    if (!withScores.length) {
      setMsg("Aucune note saisie pour cette évaluation.");
      return;
    }

    const scores = withScores.map((r) => r.score as number);
    const count = scores.length;
    const sum = scores.reduce((acc, v) => acc + v, 0);
    const minRaw = Math.min(...scores);
    const maxRaw = Math.max(...scores);
    const avgRaw = sum / count;
    const scale = ev.scale || 20;

    const to20 = (v: number) => (v / scale) * 20;
    const avg20 = to20(avgRaw);
    const min20 = to20(minRaw);
    const max20 = to20(maxRaw);

    const nbEleves = roster.length;
    const nbSansNote = nbEleves - count;

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

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pdfTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 24px;
      color: #020617;
      font-size: 12px;
    }
    h1 {
      font-size: 18px;
      text-align: center;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    h2 {
      font-size: 14px;
      margin-top: 16px;
      margin-bottom: 4px;
    }
    .subtitle {
      text-align: center;
      font-size: 11px;
      color: #475569;
      margin-bottom: 16px;
    }
    .meta {
      margin-bottom: 12px;
      font-size: 11px;
    }
    .meta strong {
      text-transform: uppercase;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 4px 6px;
      text-align: left;
    }
    th {
      background: #e2e8f0;
      font-weight: 600;
    }
    .text-right { text-align: right; }
    .small {
      font-size: 10px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(pdfTitle)}</h1>
  <div class="subtitle">
    ${escapeHtml(inst)}${
      year ? " • Année scolaire " + escapeHtml(year) : ""
    }<br/>
    Classe : ${escapeHtml(classe)} • Discipline : ${escapeHtml(subject)}
  </div>

  <div class="meta">
    <div><strong>Type :</strong> ${escapeHtml(typeLabel)}</div>
    <div><strong>Date :</strong> ${escapeHtml(dateFr)}</div>
    <div><strong>Échelle :</strong> /${scale} (équivalent /20 indiqué)</div>
    <div><strong>Coefficient :</strong> ${ev.coeff}</div>
  </div>

  <h2>Résumé statistique</h2>
  <table>
    <tbody>
      <tr>
        <th>Nombre d'élèves</th>
        <td>${nbEleves}</td>
      </tr>
      <tr>
        <th>Nombre de notes saisies</th>
        <td>${count}</td>
      </tr>
      <tr>
        <th>Nombre d'élèves sans note</th>
        <td>${nbSansNote}</td>
      </tr>
      <tr>
        <th>Moyenne</th>
        <td>${avgRaw.toFixed(2)} / ${scale} (soit ${avg20.toFixed(
      2
    )} / 20)</td>
      </tr>
      <tr>
        <th>Note minimale</th>
        <td>${minRaw.toFixed(2)} / ${scale} (soit ${min20.toFixed(
      2
    )} / 20)</td>
      </tr>
      <tr>
        <th>Note maximale</th>
        <td>${maxRaw.toFixed(2)} / ${scale} (soit ${max20.toFixed(
      2
    )} / 20)</td>
      </tr>
    </tbody>
  </table>

  <h2>Détails par élève</h2>
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
          if (r.score == null) {
            return `<tr>
              <td>${r.idx}</td>
              <td>${escapeHtml(r.student.matricule || "")}</td>
              <td>${escapeHtml(r.student.full_name)}</td>
              <td class="text-right small">—</td>
              <td class="text-right small">—</td>
            </tr>`;
          }
          const n = r.score;
          const n20 = to20(n);
          return `<tr>
            <td>${r.idx}</td>
            <td>${escapeHtml(r.student.matricule || "")}</td>
            <td>${escapeHtml(r.student.full_name)}</td>
            <td class="text-right">${n.toFixed(2)}</td>
            <td class="text-right">${n20.toFixed(2)}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>

  <p class="small" style="margin-top:16px;">
    Fiche générée depuis Mon Cahier — Espace enseignant.
  </p>
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
    // L'utilisateur pourra choisir "Enregistrer en PDF" dans la fenêtre d'impression.
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
     👉 Colonnes de notes détaillées,
        moyenne finale alignée sur l’API /averages si possible.
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
      // On tente de récupérer les moyennes consolidées
      let avgByStudent = new Map<string, AverageApiRow>();
      try {
        const params = new URLSearchParams({
          class_id: selected.class_id,
        });
        if (selected.subject_id) {
          params.set("subject_id", selected.subject_id);
        }
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

      // En-têtes
      const headers: string[] = ["Numero", "Matricule", "Nom complet"];
      evaluations.forEach((ev) => {
        const label = labelByEvalId[ev.id] ?? "NOTE";
        headers.push(`${label} (/${ev.scale})`);
      });
      headers.push("Moyenne finale (/20)");

      const rowsCsv: string[][] = [];

      roster.forEach((st, idx) => {
        const row: (string | number)[] = [
          idx + 1, // Numero
          st.matricule ?? "",
          st.full_name,
        ];

        let num = 0;
        let den = 0;

        evaluations.forEach((ev) => {
          const raw =
            changed[ev.id]?.[st.id] ?? grades[ev.id]?.[st.id] ?? null;

          // Note brute telle que saisie (3/5, 8/10, 15/20…)
          row.push(raw == null ? "" : Number(raw));

          if (raw != null) {
            const normalized = (Number(raw) / ev.scale) * 20;
            const w = Number(ev.coeff || 1);
            num += normalized * w;
            den += w;
          }
        });

        const avg20Local = den > 0 ? num / den : 0;
        const bonusLocal = bonusMap[st.id] ?? 0;
        const finalLocal = Math.min(
          20,
          Math.max(0, Math.round((avg20Local + bonusLocal) * 100) / 100)
        );

        const apiRow = avgByStudent.get(st.id);
        const finalFromApi = apiRow
          ? apiRow.average_rounded ?? apiRow.average ?? finalLocal
          : finalLocal;

        row.push(finalFromApi.toFixed(2));

        // Conversion en string + échappement CSV
        const rowStr = row.map((cell) => {
          const v = cell == null ? "" : String(cell);
          return `"${v.replace(/"/g, '""')}"`;
        });
        rowsCsv.push(rowStr);
      });

      const headerStr = headers
        .map((h) => `"${h.replace(/"/g, '""')}"`)
        .join(";");
      const csvLines = [headerStr, ...rowsCsv.map((r) => r.join(";"))];
      const csvContent = csvLines.join("\r\n");

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

      setMsg("Export CSV généré ✅ (ouvrable dans Excel).");
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
              même sur mobile.
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
              {classOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              Seules vos classes affectées apparaissent.
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
                />
              </div>
              <div>
                <Select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as EvalKind)}
                  aria-label="Type d’évaluation"
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
              <Button onClick={addEvaluation} disabled={!selected || creating}>
                <Plus className="h-4 w-4" />
                {creating ? "Ajout…" : "Ajouter une note"}
              </Button>
            </div>
          </div>
        </div>

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
                disabled={!evaluations.length}
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
                disabled={loading || totalChanges === 0}
              >
                <Save className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </div>

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
                    title={locked ? "Déverrouiller cette évaluation (PIN)" : "Verrouiller cette évaluation (PIN)"}
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
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                openLockModal(
                                  ev,
                                  isEvalLocked(ev.id) ? "unlock" : "lock"
                                )
                              }
                              disabled={!!lockBusy[ev.id]}
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
                              disabled={!!publishBusy[ev.id]}
                              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-100 text-red-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-60"
                              title="Supprimer cette colonne de notes"
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
                                disabled={isEvalLocked(ev.id)}
                                title={isEvalLocked(ev.id) ? "Évaluation verrouillée" : undefined}
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
                                disabled={isEvalLocked(ev.id)}
                                title={isEvalLocked(ev.id) ? "Évaluation verrouillée" : undefined}
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
              <Button onClick={saveBonuses} disabled={loadingAvg}>
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
                      const final = Math.min(20, row.avg20 + bonus);
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
                            {row.avg20.toFixed(2)}
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
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {final.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.rank || ""}
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
                  const final = Math.min(20, row.avg20 + bonus);
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
                            {row.rank || "—"}
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
                            {row.avg20.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Finale /20
                          </div>
                          <div className="text-sm font-semibold">
                            {final.toFixed(2)}
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
              Cochez les évaluations à publier pour les parents, ou supprimez
              une colonne si besoin.
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
                        Publié pour les parents
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
                            <label className="inline-flex items-center gap-2 text-xs md:text-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                                checked={!!ev.is_published}
                                onChange={() => togglePublish(ev)}
                                disabled={!!publishBusy[ev.id]}
                              />
                              <span className="text-slate-700">
                                {ev.is_published ? "Publié" : "Brouillon"}
                              </span>
                            </label>
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
                                disabled={!!publishBusy[ev.id]}
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