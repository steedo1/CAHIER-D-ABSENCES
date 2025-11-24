// src/app/grades/class-device/page.tsx
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
} from "lucide-react";

/* =========================
   Debug helpers (logs)
========================= */
const LOG_PREFIX = "[ClassDeviceNotes]";

function logInfo(...args: any[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: any[]) {
  console.error(LOG_PREFIX, ...args);
}

/* =========================
   Responsive helper
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

/* =========================
   Types
========================= */
type TeachClass = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};

type RosterItem = { id: string; full_name: string; matricule: string | null };

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type Evaluation = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id?: string | null;
  eval_date: string; // yyyy-mm-dd
  eval_kind: EvalKind;
  scale: 5 | 10 | 20 | 40 | 60;
  coeff: number;
  is_published: boolean;
  published_at?: string | null;
};

type GradesByEval = Record<string, Record<string, number | null>>;

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

/* =========================
   Helpers
========================= */
function isCollegeLevel(level?: string | null): boolean {
  if (!level) return false;
  let s = level.toLowerCase();
  try {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // pas grave
  }
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
        "placeholder:text-slate-400",
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
  }
) {
  const tone = p.tone ?? "slate";
  const map: Record<"red" | "slate" | "emerald", string> = {
    red: "border-red-300 text-red-700 hover:bg-red-50 focus:ring-red-500/20",
    slate:
      "border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500/20",
    emerald:
      "border-emerald-300 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-500/20",
  };
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
        "transition focus:outline-none focus:ring-4",
        map[tone],
        p.className ?? "",
      ].join(" ")}
    />
  );
}

/* =========================
   Page Compte-classe
========================= */
export default function ClassDeviceNotesPage() {
  const isMobile = useIsMobile();

  // Nom établissement + année scolaire (best effort sans rien casser)
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [academicYearLabel, setAcademicYearLabel] = useState<string | null>(
    null
  );

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
      if (finalName) setInstitutionName(finalName);

      const fromDataYear =
        body?.dataset?.academicYear ||
        body?.dataset?.schoolYear ||
        body?.dataset?.anneeScolaire ||
        null;
      const fromGlobalYear = (window as any).__MC_ACADEMIC_YEAR__
        ? String((window as any).__MC_ACADEMIC_YEAR__)
        : null;
      const finalYear = fromDataYear || fromGlobalYear;
      if (finalYear) setAcademicYearLabel(finalYear);
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

  /* -------- État & message -------- */
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"saisie" | "moyennes">("saisie");

  /* -------- Publication + suppression panel -------- */
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [publishBusy, setPublishBusy] = useState<Record<string, boolean>>({});

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
     Chargement des classes (compte-classe)
  ========================================== */
  useEffect(() => {
    (async () => {
      logInfo(
        "useEffect[classes] -> début chargement des classes pour compte-classe"
      );
      try {
        const r = await fetch("/api/grades/classes", { cache: "no-store" });
        logInfo("useEffect[classes] -> /api/grades/classes status", r.status);
        const j = await r.json().catch((err) => {
          logError("useEffect[classes] -> erreur parse JSON", err);
          return { items: [] };
        });
        const arr = (j.items || []) as TeachClass[];
        logInfo("useEffect[classes] -> classes reçues", arr);
        setTeachClasses(arr);
        if (!selKey && arr.length) {
          const first = arr[0];
          const defaultKey = `${first.class_id}|${first.subject_id ?? ""}`;
          logInfo("useEffect[classes] -> sélection par défaut", defaultKey);
          setSelKey(defaultKey);
        }
      } catch (err: any) {
        logError("useEffect[classes] -> échec de chargement", err);
        setTeachClasses([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ==========================================
     Chargement des sous-matières (collège)
  ========================================== */
  useEffect(() => {
    logInfo(
      "useEffect[components] -> déclenché avec",
      "selected?.class_id=",
      selected?.class_id,
      "selected?.subject_id=",
      selected?.subject_id,
      "selected?.level=",
      selected?.level
    );

    setComponents([]);
    setSelectedComponentId("");
    if (!selected || !selected.subject_id) {
      logInfo(
        "useEffect[components] -> pas de selected ou pas de subject_id, on annule."
      );
      return;
    }
    if (!isCollegeLevel(selected.level)) {
      logInfo(
        "useEffect[components] -> niveau non collège, pas de sous-rubriques à charger."
      );
      return;
    }

    (async () => {
      try {
        setComponentsLoading(true);
        const params = new URLSearchParams({
          class_id: selected.class_id,
          subject_id: selected.subject_id ?? "",
        });
        const url = `/api/teacher/grades/components?${params.toString()}`;
        logInfo("useEffect[components] -> fetch", url);
        const r = await fetch(url, { cache: "no-store" });
        logInfo("useEffect[components] -> status", r.status);
        const j = await r.json().catch((err) => {
          logError("useEffect[components] -> JSON parse error", err);
          return { items: [] };
        });
        const arr = (j.items || []) as SubjectComponent[];
        logInfo("useEffect[components] -> sous-rubriques reçues", arr);
        setComponents(arr);
        if (arr.length > 0) {
          logInfo(
            "useEffect[components] -> sélection auto première sous-rubrique",
            arr[0].id
          );
          setSelectedComponentId(arr[0].id);
        }
      } catch (err: any) {
        logError("useEffect[components] -> échec de chargement", err);
        setComponents([]);
      } finally {
        setComponentsLoading(false);
      }
    })();
  }, [selected?.class_id, selected?.subject_id, selected?.level]);

  /* ==========================================
     Chargement roster + évaluations + notes
  ========================================== */
  useEffect(() => {
    logInfo(
      "useEffect[data] -> déclenché avec selected",
      selected ? { class_id: selected.class_id, subject_id: selected.subject_id } : null
    );

    if (!selected) {
      logInfo("useEffect[data] -> aucun selected, reset des états.");
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
        const rosterUrl = `/api/grades/roster?class_id=${encodeURIComponent(
          selected.class_id
        )}`;
        logInfo("useEffect[data] -> fetch roster", rosterUrl);
        const rRoster = await fetch(rosterUrl, { cache: "no-store" });
        logInfo("useEffect[data] -> roster status", rRoster.status);
        const jRoster = await rRoster.json().catch((err) => {
          logError("useEffect[data] -> roster JSON parse error", err);
          return { items: [] };
        });
        const ros = (jRoster.items || []) as RosterItem[];
        logInfo("useEffect[data] -> roster reçu", ros);
        setRoster(ros);

        // 2) Évaluations
        const evalsUrl = `/api/grades/evaluations?class_id=${encodeURIComponent(
          selected.class_id
        )}&subject_id=${encodeURIComponent(selected.subject_id ?? "")}`;
        logInfo("useEffect[data] -> fetch evaluations", evalsUrl);
        const rEvals = await fetch(evalsUrl, { cache: "no-store" });
        logInfo("useEffect[data] -> evaluations status", rEvals.status);
        const jEvals = await rEvals.json().catch((err) => {
          logError("useEffect[data] -> evals JSON parse error", err);
          return { items: [] };
        });
        const evals = (jEvals.items || []) as Evaluation[];
        evals.sort((a, b) => a.eval_date.localeCompare(b.eval_date));
        logInfo("useEffect[data] -> évaluations reçues", evals);
        setEvaluations(evals);

        // 3) Notes
        const g: GradesByEval = {};
        await Promise.all(
          evals.map(async (ev) => {
            const scoresUrl = `/api/grades/scores?evaluation_id=${encodeURIComponent(
              ev.id
            )}`;
            logInfo("useEffect[data] -> fetch scores", {
              eval_id: ev.id,
              url: scoresUrl,
            });
            const r = await fetch(scoresUrl, { cache: "no-store" });
            logInfo("useEffect[data] -> scores status", ev.id, r.status);
            const j = await r.json().catch((err) => {
              logError(
                "useEffect[data] -> scores JSON parse error",
                { eval_id: ev.id },
                err
              );
              return { items: [] };
            });
            const items = (j.items || []) as Array<{
              student_id: string;
              score: number | null;
            }>;
            g[ev.id] = {};
            for (const it of items) g[ev.id][it.student_id] = it.score;
          })
        );
        logInfo("useEffect[data] -> notes par évaluation chargées", g);
        setGrades(g);
        setChanged({});
      } catch (e: any) {
        logError("useEffect[data] -> exception générale", e);
        setMsg(e?.message || "Échec de chargement.");
        setRoster([]);
        setEvaluations([]);
        setGrades({});
        setChanged({});
      } finally {
        setLoading(false);
      }
    })();
  }, [selected?.class_id, selected?.subject_id]);

  /* ==========================================
     Actions
  ========================================== */
  function setGrade(
    evId: string,
    studentId: string,
    value: number | null,
    scale: number
  ) {
    const v =
      value == null || Number.isNaN(value)
        ? null
        : Math.max(0, Math.min(scale, value));
    logInfo("setGrade ->", { evId, studentId, value, clamped: v, scale });
    setChanged((prev) => ({
      ...prev,
      [evId]: { ...(prev[evId] || {}), [studentId]: v },
    }));
  }

  async function saveAllChanges() {
    if (!selected) {
      logInfo("saveAllChanges -> aucun selected, on annule.");
      return;
    }
    const perEval = Object.entries(changed).filter(
      ([, per]) => Object.keys(per).length > 0
    );
    logInfo("saveAllChanges -> perEval à enregistrer", perEval);
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
        logInfo("saveAllChanges -> POST /api/grades/scores/bulk", {
          evaluation_id,
          items,
        });
        const r = await fetch("/api/grades/scores/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evaluation_id,
            items,
            delete_if_null: true,
          }),
        });
        const text = await r.text();
        logInfo("saveAllChanges -> response status", r.status, "body", text);
        let j: any = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch (err) {
          logError("saveAllChanges -> JSON parse error", err);
        }
        if (!r.ok || !j?.ok)
          throw new Error(j?.error || "Échec d’enregistrement.");
      }

      setGrades((prev) => {
        const next = { ...prev };
        for (const [evId, per] of Object.entries(changed)) {
          next[evId] = { ...(next[evId] || {}) };
          for (const [sid, val] of Object.entries(per)) next[evId][sid] = val;
        }
        return next;
      });
      setChanged({});
      setMsg("Notes enregistrées ✅");
      logInfo("saveAllChanges -> succès, notes mises à jour en mémoire.");
    } catch (e: any) {
      logError("saveAllChanges -> exception", e);
      setMsg(e?.message || "Échec d’enregistrement des notes.");
    } finally {
      setLoading(false);
    }
  }

  async function addEvaluation() {
    if (!selected) {
      logInfo("addEvaluation -> aucun selected, on annule.");
      return;
    }

    if (hasComponents && !selectedComponentId) {
      logInfo(
        "addEvaluation -> sous-rubriques présentes mais aucune sélectionnée."
      );
      setMsg("Choisissez une sous-rubrique avant d’ajouter une note.");
      return;
    }

    setCreating(true);
    setMsg(null);
    try {
      const payload = {
        class_id: selected.class_id,
        subject_id: selected?.subject_id ?? null,
        subject_component_id: hasComponents ? selectedComponentId : null,
        eval_date: newDate,
        eval_kind: newType,
        scale: newScale,
        coeff: newCoeff,
      };
      logInfo("addEvaluation -> POST /api/grades/evaluations", payload);
      const r = await fetch("/api/grades/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      logInfo("addEvaluation -> response status", r.status, "body", text);
      let j: any = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch (err) {
        logError("addEvaluation -> JSON parse error", err);
      }
      if (!r.ok || !j?.ok)
        throw new Error(j?.error || "Échec de création de l’évaluation.");

      const created = j?.item as Evaluation;
      logInfo("addEvaluation -> évaluation créée", created);
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
      logError("addEvaluation -> exception", e);
      setMsg(e?.message || "Échec d’ajout de la note.");
    } finally {
      setCreating(false);
    }
  }

  async function togglePublish(ev: Evaluation) {
    setMsg(null);
    const next = !ev.is_published;
    logInfo("togglePublish -> PATCH /api/grades/evaluations", {
      eval_id: ev.id,
      next,
    });
    setPublishBusy((prev) => ({ ...prev, [ev.id]: true }));
    try {
      const r = await fetch("/api/grades/evaluations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_id: ev.id,
          is_published: next,
        }),
      });
      const text = await r.text();
      logInfo("togglePublish -> response status", r.status, "body", text);
      let j: any = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch (err) {
        logError("togglePublish -> JSON parse error", err);
      }
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
      logError("togglePublish -> exception", e);
      setMsg(e?.message || "Échec de mise à jour de la publication.");
    } finally {
      setPublishBusy((prev) => {
        const copy = { ...prev };
        delete copy[ev.id];
        return copy;
      });
    }
  }

  async function deleteEvaluation(ev: Evaluation) {
    logInfo("deleteEvaluation -> demande de suppression", ev);
    if (
      !window.confirm(
        "Supprimer définitivement cette colonne de notes ?\nToutes les notes associées seront perdues."
      )
    ) {
      logInfo("deleteEvaluation -> action annulée par l’utilisateur.");
      return;
    }

    setMsg(null);
    setPublishBusy((prev) => ({ ...prev, [ev.id]: true }));
    try {
      logInfo("deleteEvaluation -> DELETE /api/grades/evaluations", {
        evaluation_id: ev.id,
      });
      const r = await fetch("/api/grades/evaluations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluation_id: ev.id }),
      });
      const text = await r.text();
      logInfo("deleteEvaluation -> response status", r.status, "body", text);
      let j: any = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch (err) {
        logError("deleteEvaluation -> JSON parse error", err);
      }
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
      logError("deleteEvaluation -> exception", e);
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
     Moyennes + bonus
  ========================================== */
  type RowAvg = {
    student: RosterItem;
    avg20: number;
    bonus: number;
    final: number;
    rank: number;
  };
  const [avgRows, setAvgRows] = useState<RowAvg[]>([]);
  const [bonusMap, setBonusMap] = useState<Record<string, number>>({});
  const [loadingAvg, setLoadingAvg] = useState(false);

  function applyAveragesFromApi(items: AverageApiRow[]) {
    logInfo("applyAveragesFromApi -> items bruts", items);
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
    logInfo("applyAveragesFromApi -> rows calculés", rows);
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
    if (!selected) {
      logInfo("openAverages -> aucun selected, on annule.");
      return;
    }
    setMode("moyennes");
    setLoadingAvg(true);
    setMsg(null);
    try {
      const params = new URLSearchParams({
        class_id: selected.class_id,
        published_only: "1",
      });
      if (selected.subject_id) {
        params.set("subject_id", selected.subject_id);
      }
      const url = `/api/grades/averages?${params.toString()}`;
      logInfo("openAverages -> fetch", url);
      const r = await fetch(url, { cache: "no-store" });
      const text = await r.text();
      logInfo("openAverages -> response status", r.status, "body", text);
      let j: any = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch (err) {
        logError("openAverages -> JSON parse error", err);
      }
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec du calcul des moyennes.");
      }
      const arr = (j.items || []) as AverageApiRow[];
      applyAveragesFromApi(arr);
    } catch (e: any) {
      logError("openAverages -> exception", e);
      setAvgRows([]);
      setMsg(e?.message || "Échec du calcul des moyennes.");
    } finally {
      setLoadingAvg(false);
    }
  }

  async function saveBonuses() {
    if (!selected) {
      logInfo("saveBonuses -> aucun selected, on annule.");
      return;
    }
    setLoadingAvg(true);
    setMsg(null);
    try {
      const items = Object.entries(bonusMap).map(([student_id, bonus]) => ({
        student_id,
        bonus: Number.isFinite(bonus) ? Number(bonus) : 0,
      }));
      logInfo("saveBonuses -> POST /api/grades/adjustments/bulk", {
        class_id: selected.class_id,
        subject_id: selected.subject_id,
        items,
      });
      const r = await fetch("/api/grades/adjustments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: selected.class_id,
          subject_id: selected.subject_id,
          items,
        }),
      });
      const text = await r.text();
      logInfo("saveBonuses -> response status", r.status, "body", text);
      let j: any = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch (err) {
        logError("saveBonuses -> JSON parse error", err);
      }
      if (!r.ok || !j?.ok)
        throw new Error(j?.error || "Échec d’enregistrement des bonus.");

      const params = new URLSearchParams({
        class_id: selected.class_id,
        published_only: "1",
      });
      if (selected.subject_id) {
        params.set("subject_id", selected.subject_id);
      }
      const url2 = `/api/grades/averages?${params.toString()}`;
      logInfo("saveBonuses -> refetch", url2);
      const r2 = await fetch(url2, { cache: "no-store" });
      const text2 = await r2.text();
      logInfo("saveBonuses -> refetch status", r2.status, "body", text2);
      let j2: any = {};
      try {
        j2 = text2 ? JSON.parse(text2) : {};
      } catch (err) {
        logError("saveBonuses -> refetch JSON parse error", err);
      }
      if (!r2.ok || !j2?.ok)
        throw new Error(j2?.error || "Échec du recalcul des moyennes.");
      const arr2 = (j2.items || []) as AverageApiRow[];
      applyAveragesFromApi(arr2);

      setMsg("Bonus enregistrés ✅");
    } catch (e: any) {
      logError("saveBonuses -> exception", e);
      setMsg(e?.message || "Échec d’enregistrement des bonus.");
    } finally {
      setLoadingAvg(false);
    }
  }

  /* ==========================================
     Export CSV
  ========================================== */
  const totalChanges = useMemo(
    () =>
      Object.values(changed).reduce(
        (acc, per) => acc + Object.keys(per).length,
        0
      ),
    [changed]
  );

  const labelByEvalId: Record<string, string> = useMemo(() => {
    const counters: Record<EvalKind, number> = {
      devoir: 0,
      interro_ecrite: 0,
      interro_orale: 0,
    };
    const map: Record<string, string> = {};
    for (const ev of evaluations) {
      const kind = ev.eval_kind as EvalKind;
      counters[kind] = (counters[kind] ?? 0) + 1;
      const idx = counters[kind];
      let prefix: string;
      if (kind === "devoir") prefix = "DEVOIR";
      else if (kind === "interro_ecrite") prefix = "IE";
      else prefix = "IO";
      map[ev.id] = `${prefix}${idx}`;
    }
    logInfo("labelByEvalId -> map labels", map);
    return map;
  }, [evaluations]);

  async function exportToCsv() {
    if (!selected) {
      setMsg("Sélectionnez une classe/discipline avant d’exporter.");
      logInfo("exportToCsv -> aucun selected");
      return;
    }
    if (!roster.length) {
      setMsg("Aucun élève à exporter pour cette classe.");
      logInfo("exportToCsv -> roster vide");
      return;
    }

    try {
      let avgByStudent = new Map<string, AverageApiRow>();
      try {
        const params = new URLSearchParams({
          class_id: selected.class_id,
          published_only: "1",
        });
        if (selected.subject_id) {
          params.set("subject_id", selected.subject_id);
        }
        const url = `/api/grades/averages?${params.toString()}`;
        logInfo("exportToCsv -> fetch moyennes", url);
        const r = await fetch(url, { cache: "no-store" });
        const text = await r.text();
        logInfo("exportToCsv -> moyennes status", r.status, "body", text);
        let j: any = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch (err) {
          logError("exportToCsv -> moyennes JSON parse error", err);
        }
        if (r.ok && j?.ok && Array.isArray(j.items)) {
          const arr = j.items as AverageApiRow[];
          avgByStudent = new Map(
            arr.map((row) => [row.student_id, row] as const)
          );
          logInfo("exportToCsv -> moyennes consolidées présentes", arr);
        } else {
          logInfo(
            "exportToCsv -> pas de moyennes consolidées utilisables, on restera sur le calcul local."
          );
          avgByStudent = new Map();
        }
      } catch (err) {
        logError("exportToCsv -> erreur lors du fetch moyennes", err);
        avgByStudent = new Map();
      }

      const headers: string[] = ["Numero", "Matricule", "Nom complet"];
      evaluations.forEach((ev) => {
        const label = labelByEvalId[ev.id] ?? "NOTE";
        headers.push(`${label} (/${ev.scale})`);
      });
      headers.push("Moyenne finale (/20)");
      logInfo("exportToCsv -> headers", headers);

      const rows: string[][] = [];

      roster.forEach((st, idx) => {
        const row: (string | number)[] = [
          idx + 1,
          st.matricule ?? "",
          st.full_name,
        ];

        let num = 0;
        let den = 0;

        evaluations.forEach((ev) => {
          const raw =
            changed[ev.id]?.[st.id] ?? grades[ev.id]?.[st.id] ?? null;

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

        const rowStr = row.map((cell) => {
          const v = cell == null ? "" : String(cell);
          return `"${v.replace(/"/g, '""')}"`;
        });
        rows.push(rowStr);
      });

      logInfo("exportToCsv -> nombre de lignes", rows.length);

      const headerStr = headers
        .map((h) => `"${h.replace(/"/g, '""')}"`)
        .join(";");
      const csvLines = [headerStr, ...rows.map((r) => r.join(";"))];
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

      logInfo("exportToCsv -> téléchargement du fichier", filename);
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
      logError("exportToCsv -> exception", e);
      setMsg(e?.message || "Échec de génération du CSV.");
    }
  }

  function formatDateFr(value: string | null | undefined) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString("fr-FR");
    } catch {
      return value;
    }
  }

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
      <header className="rounded-2xl border border-indigo-800/60 bg-gradient-to-r from-slate-950 via-indigo-900 to-slate-900 px-4 py-4 md:px-6 md:py-5 text-white shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200/80">
              {institutionName || "COURS SECONDAIRE CATHOLIQUE ABOISSO"}
              {academicYearLabel
                ? ` • Année scolaire ${academicYearLabel}`
                : ""}
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Notes — Compte classe
            </h1>
            <p className="text-xs md:text-sm text-indigo-100/85">
              Saisissez les notes rapidement depuis le téléphone de la classe,
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
      <section className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-5 space-y-4 ring-1 ring-emerald-100">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Classe — Discipline
            </div>
            <Select
              value={selKey}
              onChange={(e) => {
                logInfo(
                  "UI -> changement de classe/discipline",
                  e.target.value
                );
                setSelKey(e.target.value);
              }}
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
              Classes détectées à partir du téléphone de la classe.
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
                  onChange={(e) => {
                    logInfo(
                      "UI -> changement date nouvelle note",
                      e.target.value
                    );
                    setNewDate(e.target.value);
                  }}
                  aria-label="Date"
                />
              </div>
              <div>
                <Select
                  value={newType}
                  onChange={(e) => {
                    logInfo(
                      "UI -> changement type nouvelle note",
                      e.target.value
                    );
                    setNewType(e.target.value as EvalKind);
                  }}
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
                    onChange={(e) => {
                      logInfo(
                        "UI -> changement sous-rubrique sélectionnée",
                        e.target.value
                      );
                      setSelectedComponentId(e.target.value);
                    }}
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
                  onChange={(e) => {
                    logInfo(
                      "UI -> changement échelle nouvelle note",
                      e.target.value
                    );
                    setNewScale(Number(e.target.value) as 5 | 10 | 20);
                  }}
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
                  onChange={(e) => {
                    logInfo(
                      "UI -> changement coeff nouvelle note",
                      e.target.value
                    );
                    setNewCoeff(Number(e.target.value));
                  }}
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
              {isMobile && currentActiveEvalId && evaluations.length > 0 && (
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
                onClick={() => {
                  logInfo("UI -> ouverture panneau publication");
                  setShowPublishPanel(true);
                }}
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
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* ==== LAYOUT PC : tableau classique ==== */}
          {!isMobile && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2 w-12 sticky left-0 z-20 bg-slate-50">
                      N°
                    </th>
                    <th className="px-3 py-2 w-40 sticky left-[3rem] z-20 bg-slate-50">
                      Matricule
                    </th>
                    <th className="px-3 py-2 w-64 sticky left-[13rem] z-20 bg-slate-50">
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
                        <td className="px-3 py-2 w-40 sticky left-[3rem] z-10 bg-white">
                          {st.matricule ?? ""}
                        </td>
                        <td className="px-3 py-2 w-64 sticky left-[13rem] z-10 bg-white">
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
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm text-slate-700">
              Moyennes de la classe (pondérées par coeff et sous-matières)
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={saveBonuses} disabled={loadingAvg}>
                <Save className="h-4 w-4" /> Enregistrer bonus
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2 w-12 sticky left-0 z-20 bg-slate-50">
                    N°
                  </th>
                  <th className="px-3 py-2 w-40 sticky left-[3rem] z-20 bg-slate-50">
                    Matricule
                  </th>
                  <th className="px-3 py-2 w-64 sticky left-[13rem] z-20 bg-slate-50">
                    Nom et prénoms
                  </th>
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
                  avgRows.map((row, idx) => (
                    <tr
                      key={row.student.id}
                      className="hover:bg-slate-50/60"
                    >
                      <td className="px-3 py-2 w-12 sticky left-0 z-10 bg-white">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 w-40 sticky left-[3rem] z-10 bg-white">
                        {row.student.matricule ?? ""}
                      </td>
                      <td className="px-3 py-2 w-64 sticky left-[13rem] z-10 bg-white">
                        {row.student.full_name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.avg20.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 w-24">
                        <Input
                          type="number"
                          step="0.25"
                          min={0}
                          max={10}
                          value={bonusMap[row.student.id] ?? 0}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            logInfo("UI -> changement bonus", {
                              student_id: row.student.id,
                              value: v,
                            });
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
                        {Math.min(
                          20,
                          row.avg20 + (bonusMap[row.student.id] ?? 0)
                        ).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.rank || ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Panneau publication */}
      {showPublishPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-slate-200 p-4 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base md:text-lg font-semibold">
                Gérer la publication des évaluations
              </h2>
              <GhostButton
                onClick={() => {
                  logInfo("UI -> fermeture panneau publication");
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
                        <tr
                          key={ev.id}
                          className="hover:bg-slate-50/60"
                        >
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
                                {ev.is_published
                                  ? "Publié"
                                  : "Brouillon"}
                              </span>
                            </label>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <GhostButton
                              tone="red"
                              type="button"
                              onClick={() => deleteEvaluation(ev)}
                              disabled={!!publishBusy[ev.id]}
                            >
                              Supprimer la note
                            </GhostButton>
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
    </main>
  );
}
