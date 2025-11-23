// src/app/admin/notes/evaluations/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Filter,
  NotebookPen,
  RefreshCw,
  School,
  BookOpen,
  User2,
  CheckCircle2,
  CircleDashed,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
} from "lucide-react";

/* ───────── UI helpers ───────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
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
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow",
        p.disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-emerald-700 transition",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function GhostButton(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium",
        "hover:bg-slate-50 transition",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Card(props: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, subtitle, actions, children } = props;
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-emerald-600" />
            <span>{title}</span>
          </div>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* ───────── Types ───────── */
type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type ClassItem = { id: string; name: string; label?: string | null; level: string | null };
type SubjectItem = { id: string; name: string };

type EvalItem = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  class_id: string;
  class_label: string;
  level: string | null;
  subject_id: string | null;
  subject_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  stats: {
    scores_count: number;
    avg_score_raw: number | null;
    avg_score_20: number | null;
    min_raw: number | null;
    max_raw: number | null;
    nb_above_10: number;
  };
};

type ApiOk = {
  ok: true;
  meta: {
    page: number;
    limit: number;
    total: number;
    from: string | null;
    to: string | null;
  };
  items: EvalItem[];
};

type ApiErr = { ok: false; error: string };

/* ───────── Types pour la matrice par élève ───────── */
type MatrixEval = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  title: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
};

type MatrixStudent = {
  student_id: string;
  full_name: string;
  matricule: string | null;
};

type MatrixMarks = Record<
  string,
  Record<string, { raw: number | null; mark_20: number | null }>
>;

type MatrixOk = {
  ok: true;
  meta: {
    class_id: string;
    subject_id: string;
    evaluations_count: number;
    students_count: number;
    from: string | null;
    to: string | null;
  };
  evaluations: MatrixEval[];
  students: MatrixStudent[];
  marks: MatrixMarks;
};

/* ───────── Types pour les périodes de bulletin ───────── */
type GradePeriod = {
  id: string;
  code: string;
  label: string;
  short_label: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  order_index: number;
};

const df = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const nf = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/* ───────── Helpers de date ───────── */
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function setRange(kind: "week" | "month" | "ytd") {
  const now = new Date();
  if (kind === "week") {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // lundi = 0
    d.setDate(d.getDate() - day);
    const start = d;
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: toYMD(start), to: toYMD(end) };
  }
  if (kind === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: toYMD(start), to: toYMD(end) };
  }
  const start = new Date(now.getFullYear(), 0, 1);
  return { from: toYMD(start), to: toYMD(now) };
}

function evalKindLabel(k: EvalKind) {
  if (k === "devoir") return "Devoir";
  if (k === "interro_orale") return "Interrogation orale";
  return "Interrogation écrite";
}

/* ───────── Page ───────── */
export default function AdminNotesEvaluationsPage() {
  // Filtres
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");

  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");

  // Périodes de bulletin (grade_periods)
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [selectedPeriodCode, setSelectedPeriodCode] = useState<string>("");

  // Données (liste des évaluations)
  const [items, setItems] = useState<EvalItem[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number }>({
    page: 1,
    limit: 30,
    total: 0,
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Données pour la matrice par élève
  const [matrixEvals, setMatrixEvals] = useState<MatrixEval[]>([]);
  const [matrixStudents, setMatrixStudents] = useState<MatrixStudent[]>([]);
  const [matrixMarks, setMatrixMarks] = useState<MatrixMarks>({});
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  /* Charger classes (comme sur la matrice d'absences) */
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const arr = (j.items || []) as ClassItem[];
        setAllClasses(
          arr.map((c) => ({
            ...c,
            name: (c.label || (c as any).name || "Classe").trim(),
            level: (c.level || "").trim() || null,
          }))
        );
      })
      .catch(() => setAllClasses([]));
  }, []);

  /* Charger les périodes de bulletin définies dans les paramètres */
  async function loadPeriods() {
    setLoadingPeriods(true);
    setPeriodError(null);
    try {
      const res = await fetch("/api/admin/institution/grading-periods", {
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Échec du chargement des périodes de bulletin.");
      }
      const rows = Array.isArray(j.items) ? j.items : [];
      const mapped: GradePeriod[] = rows
        .map((row: any, idx: number) => ({
          id: String(row.id ?? row.code ?? `row_${idx}`),
          code: String(row.code || "").trim(),
          label: String(row.label || "").trim() || "Période",
          short_label: String(row.short_label || row.label || "").trim(),
          start_date: row.start_date ? String(row.start_date).slice(0, 10) : null,
          end_date: row.end_date ? String(row.end_date).slice(0, 10) : null,
          is_active: row.is_active !== false,
          order_index: Number(row.order_index ?? idx + 1),
        }))
       .filter((p: GradePeriod) => !!p.code);

      // On affiche d'abord les périodes actives, dans l'ordre défini
      mapped.sort((a, b) => a.order_index - b.order_index);
      setPeriods(mapped);
    } catch (e: any) {
      const m =
        e?.message ||
        "Impossible de charger les périodes de bulletin. Vérifiez les paramètres.";
      setPeriodError(m);
      setPeriods([]);
    } finally {
      setLoadingPeriods(false);
    }
  }

  useEffect(() => {
    loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add(c.level);
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [allClasses]);

  const classesOfLevel = useMemo(() => {
    if (!selectedLevel) return [];
    return allClasses
      .filter((c) => c.level === selectedLevel)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );
  }, [allClasses, selectedLevel]);

  /* Charger matières d'une classe */
useEffect(() => {
  setSelectedSubjectId("");
  setSubjects([]);
  if (!selectedClassId) return;

  fetch(
    `/api/class/subjects?class_id=${encodeURIComponent(
      selectedClassId
    )}&mode=class_assigned`,
    { cache: "no-store" }
  )
    .then((r) => r.json())
    .then((j) => {
      const arr = (j.items || []) as any[];
      const subs: SubjectItem[] = arr.map((s) => ({
        id: s.id,
        name: (s.label || s.name || "").trim() || s.id,
      }));
      setSubjects(subs);
    })
    .catch(() => setSubjects([]));
}, [selectedClassId]);


  /* Rafraîchir liste des évaluations */
  async function refresh(page: number = 1) {
    setLoading(true);
    setErrorMsg(null);

    try {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("limit", "30");
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (selectedClassId) qs.set("class_id", selectedClassId);
      if (selectedSubjectId) qs.set("subject_id", selectedSubjectId);
      if (status === "published") qs.set("published", "true");
      if (status === "draft") qs.set("published", "false");

      const res = await fetch("/api/admin/notes/evaluations?" + qs.toString(), {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as ApiOk | ApiErr | any;
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.error) || `HTTP_${res.status}`);
      }
      const data = json as ApiOk;
      setItems(data.items);
      setMeta({
        page: data.meta.page,
        limit: data.meta.limit,
        total: data.meta.total,
      });
    } catch (e: any) {
      setItems([]);
      setMeta({ page: 1, limit: 30, total: 0 });
      setErrorMsg(e?.message || "Erreur de chargement des évaluations.");
    } finally {
      setLoading(false);
    }
  }

  // Chargement de la matrice par élève (classe + matière)
  async function loadMatrix() {
    if (!selectedClassId || !selectedSubjectId) {
      setMatrixError("Veuillez choisir une classe et une matière.");
      setMatrixEvals([]);
      setMatrixStudents([]);
      setMatrixMarks({});
      return;
    }

    setMatrixLoading(true);
    setMatrixError(null);

    try {
      const qs = new URLSearchParams();
      qs.set("class_id", selectedClassId);
      qs.set("subject_id", selectedSubjectId);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (status === "published") qs.set("published", "true");
      if (status === "draft") qs.set("published", "false");

      const res = await fetch("/api/admin/notes/matrix?" + qs.toString(), {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as MatrixOk | ApiErr | any;
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.error) || `HTTP_${res.status}`);
      }
      const data = json as MatrixOk;
      setMatrixEvals(data.evaluations || []);
      setMatrixStudents(data.students || []);
      setMatrixMarks(data.marks || {});
    } catch (e: any) {
      setMatrixEvals([]);
      setMatrixStudents([]);
      setMatrixMarks({});
      setMatrixError(e?.message || "Erreur de chargement des notes par élève.");
    } finally {
      setMatrixLoading(false);
    }
  }

  // Export CSV de la matrice — inclut TOUS les élèves
  function exportMatrixCsv() {
    if (!matrixStudents.length || !matrixEvals.length) {
      setMatrixError(
        "Aucune donnée à exporter. Chargez d'abord la matrice pour une classe et une matière."
      );
      return;
    }

    const sep = ";";

    const header = [
      "Eleve",
      "Matricule",
      ...matrixEvals.map(
        (ev, idx) => `Eval ${idx + 1} (${ev.eval_date} /${ev.scale})`
      ),
      "Moyenne_20",
    ];

    const rows: string[] = [];
    rows.push(header.join(sep));

    const safe = (s: string | null | undefined) =>
      (s ?? "").replace(/"/g, '""');

    for (const st of matrixStudents) {
      const mForStudent = matrixMarks[st.student_id] || {};
      const cells: string[] = [];

      // Nom & matricule
      cells.push(`"${safe(st.full_name)}"`);
      cells.push(`"${safe(st.matricule)}"`);

      let sum20 = 0;
      let cnt20 = 0;

      // Colonnes de notes pour chaque évaluation
      for (const ev of matrixEvals) {
        const cell = mForStudent[ev.id];
        let valStr = "";

        if (cell && cell.raw != null) {
          const raw = Number(cell.raw);
          valStr = raw.toString().replace(".", ",");
          const v20 =
            cell.mark_20 != null
              ? Number(cell.mark_20)
              : (raw / ev.scale) * 20;
          sum20 += v20;
          cnt20++;
        }

        cells.push(valStr);
      }

      // Moyenne /20
      const avg20 = cnt20 ? sum20 / cnt20 : null;
      cells.push(
        avg20 == null ? "" : avg20.toFixed(2).replace(".", ",")
      );

      rows.push(cells.join(sep));
    }

    const csvContent = rows.join("\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    a.download = `notes_${y}${m}${d}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // changement de niveau → reset classe & matières
  useEffect(() => {
    setSelectedClassId("");
    setSelectedSubjectId("");
    setSubjects([]);
  }, [selectedLevel]);

  const totalPages = useMemo(() => {
    if (!meta.total || !meta.limit) return 1;
    return Math.max(1, Math.ceil(meta.total / meta.limit));
  }, [meta.total, meta.limit]);

  const totalNotes = useMemo(
    () => items.reduce((acc, it) => acc + (it.stats?.scores_count ?? 0), 0),
    [items]
  );

  const avgGlobal = useMemo(() => {
    let num = 0;
    let den = 0;
    for (const it of items) {
      if (it.stats?.avg_score_20 != null && it.stats.scores_count > 0) {
        num += it.stats.avg_score_20 * it.stats.scores_count;
        den += it.stats.scores_count;
      }
    }
    if (!den) return null;
    return num / den;
  }, [items]);

  const currentRangeLabel = useMemo(() => {
    const start = (meta.page - 1) * meta.limit + 1;
    const end = Math.min(meta.page * meta.limit, meta.total || 0);
    if (!meta.total) return "0 sur 0";
    return `${start}–${end} sur ${meta.total}`;
  }, [meta.page, meta.limit, meta.total]);

  // Changement de période bulletin → applique les dates Du / Au
  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value;
    setSelectedPeriodCode(code);
    if (!code) return;
    const p = periods.find((per) => per.code === code);
    if (p) {
      if (p.start_date) setFrom(p.start_date);
      if (p.end_date) setTo(p.end_date);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Cahier de notes — Évaluations
        </h1>
        <p className="text-sm text-slate-600">
          Liste consolidée des contrôles de l&apos;établissement, avec moyennes et état de
          publication.
        </p>
      </div>

      {/* Filtres */}
      <Card
        title="Filtres"
        subtitle="Filtre par période, niveau, classe, matière et état de publication."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton
              type="button"
              onClick={() => {
                const { from: f, to: t } = setRange("week");
                setSelectedPeriodCode("");
                setFrom(f);
                setTo(t);
              }}
            >
              <Calendar className="h-4 w-4" /> Semaine
            </GhostButton>
            <GhostButton
              type="button"
              onClick={() => {
                const { from: f, to: t } = setRange("month");
                setSelectedPeriodCode("");
                setFrom(f);
                setTo(t);
              }}
            >
              <Calendar className="h-4 w-4" /> Mois
            </GhostButton>
            <GhostButton
              type="button"
              onClick={() => {
                const { from: f, to: t } = setRange("ytd");
                setSelectedPeriodCode("");
                setFrom(f);
                setTo(t);
              }}
            >
              <Calendar className="h-4 w-4" /> Année à date
            </GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setSelectedPeriodCode("");
                setFrom(e.target.value);
              }}
            />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setSelectedPeriodCode("");
                setTo(e.target.value);
              }}
            />
          </div>
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
            >
              <option value="">— Tous —</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={!selectedLevel}
            >
              <option value="">— Toutes —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Matière</div>
            <Select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={!selectedClassId}
            >
              <option value="">— Toutes —</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Sélecteur de période bulletin */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">
              Période d&apos;évaluation (bulletin)
            </div>
            <Select
              value={selectedPeriodCode}
              onChange={handlePeriodChange}
              disabled={loadingPeriods || periods.length === 0}
            >
              <option value="">
                — Toutes les dates (pas de période) —
              </option>
              {periods
                .filter((p: GradePeriod) => p.is_active)
                .map((p: GradePeriod) => (
                <option key={p.id} value={p.code}>
               {p.short_label || p.label}
               </option>
               ))}

            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              En choisissant une période, les dates <b>Du</b> et <b>Au</b> sont
              automatiquement réglées sur le début et la fin de cette période.
            </div>
          </div>
          <div className="flex items-end">
            <GhostButton
              type="button"
              onClick={() => loadPeriods()}
              disabled={loadingPeriods}
            >
              <RefreshCw
                className={
                  loadingPeriods ? "h-4 w-4 animate-spin" : "h-4 w-4"
                }
              />
              Rafraîchir les périodes
            </GhostButton>
          </div>
        </div>

        {periodError && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {periodError}
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">État de publication</div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="all">Toutes les évaluations</option>
              <option value="published">Publié pour les parents</option>
              <option value="draft">Brouillon uniquement</option>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => refresh(1)} disabled={loading}>
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Filter className="h-4 w-4" />
            )}
            Actualiser
          </Button>
          <GhostButton
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setSelectedPeriodCode("");
              setSelectedLevel("");
              setSelectedClassId("");
              setSelectedSubjectId("");
              setSubjects([]);
              setStatus("all");
              setItems([]);
              setMeta({ page: 1, limit: 30, total: 0 });
              setErrorMsg(null);

              // reset aussi la matrice
              setMatrixEvals([]);
              setMatrixStudents([]);
              setMatrixMarks({});
              setMatrixError(null);
            }}
          >
            Réinitialiser
          </GhostButton>
        </div>

        {errorMsg && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {errorMsg}
          </div>
        )}
      </Card>

      {/* Tableau des évaluations */}
      <Card
        title="Liste des évaluations"
        subtitle={
          meta.total
            ? `Résultats : ${currentRangeLabel} — ${totalNotes.toLocaleString(
                "fr-FR"
              )} notes sur cette page.`
            : "Aucune évaluation trouvée pour les filtres sélectionnés."
        }
      >
        {/* Résumé rapide en haut */}
        {items.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <School className="h-3.5 w-3.5 text-slate-400" />
                {new Set(items.map((i) => i.class_label)).size} classes
              </span>
              <span className="inline-flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5 text-slate-400" />
                {new Set(items.map((i) => i.subject_name || "—")).size} matières
              </span>
              <span className="inline-flex items-center gap-1">
                <NotebookPen className="h-3.5 w-3.5 text-slate-400" />
                {items.length} évals
              </span>
              {avgGlobal != null && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  Moyenne pondérée ≈ {nf.format(avgGlobal)} /20
                </span>
              )}
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-left">Niveau</th>
                <th className="px-2 py-2 text-left">Classe</th>
                <th className="px-2 py-2 text-left">Matière</th>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-right">Échelle</th>
                <th className="px-2 py-2 text-right">Coeff</th>
                <th className="px-2 py-2 text-right">Notes</th>
                <th className="px-2 py-2 text-right">Min</th>
                <th className="px-2 py-2 text-right">Max</th>
                <th className="px-2 py-2 text-right">Moy. /20</th>
                <th className="px-2 py-2 text-right">Nb &gt; moy.</th>
                <th className="px-2 py-2 text-left">Enseignant</th>
                <th className="px-2 py-2 text-center">État</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && items.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={999}>
                    Chargement…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={999}>
                    Aucune évaluation pour l&apos;instant avec ces filtres.
                  </td>
                </tr>
              ) : (
                items.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50/60">
                    <td className="px-2 py-2">
                      {(() => {
                        try {
                          return df.format(new Date(ev.eval_date));
                        } catch {
                          return ev.eval_date;
                        }
                      })()}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{ev.level || "—"}</td>
                    <td className="px-2 py-2 font-medium text-slate-800">
                      {ev.class_label}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {ev.subject_name || "—"}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {evalKindLabel(ev.eval_kind)}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-700">
                      /{ev.scale}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-700">
                      {ev.coeff.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {ev.stats.scores_count.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {ev.stats.min_raw == null ? "—" : nf.format(ev.stats.min_raw)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {ev.stats.max_raw == null ? "—" : nf.format(ev.stats.max_raw)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {ev.stats.avg_score_20 == null
                        ? "—"
                        : nf.format(ev.stats.avg_score_20)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {ev.stats.nb_above_10.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <User2 className="h-3.5 w-3.5 text-slate-400" />
                        {ev.teacher_name || "—"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {ev.is_published ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Publié
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                          <CircleDashed className="h-3.5 w-3.5" />
                          Brouillon
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.total > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div>{currentRangeLabel}</div>
            <div className="inline-flex items-center gap-2">
              <GhostButton
                type="button"
                onClick={() => refresh(meta.page - 1)}
                disabled={loading || meta.page <= 1}
              >
                <ChevronLeft className="h-4 w-4" /> Précédent
              </GhostButton>
              <span>
                Page {meta.page} / {totalPages}
              </span>
              <GhostButton
                type="button"
                onClick={() => refresh(meta.page + 1)}
                disabled={loading || meta.page >= totalPages}
              >
                Suivant <ChevronRight className="h-4 w-4" />
              </GhostButton>
            </div>
          </div>
        )}
      </Card>

      {/* Matrice des notes par élève */}
      <Card
        title="Notes détaillées par élève"
        subtitle="Affiche, pour la classe et la matière sélectionnées, toutes les notes enregistrées par les enseignants."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton
              type="button"
              onClick={() => loadMatrix()}
              disabled={matrixLoading || !selectedClassId || !selectedSubjectId}
            >
              {matrixLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <NotebookPen className="h-4 w-4" />
              )}
              Charger les notes par élève
            </GhostButton>
            <GhostButton
              type="button"
              onClick={exportMatrixCsv}
              disabled={
                matrixLoading ||
                !selectedClassId ||
                !selectedSubjectId ||
                !matrixStudents.length ||
                !matrixEvals.length
              }
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exporter CSV
            </GhostButton>
          </div>
        }
      >
        {!selectedClassId || !selectedSubjectId ? (
          <p className="text-xs text-slate-500">
            Choisissez d&apos;abord un <strong>niveau</strong>, une{" "}
            <strong>classe</strong> et une <strong>matière</strong> dans les filtres
            ci-dessus, puis cliquez sur &laquo; Charger les notes par élève &raquo;.
          </p>
        ) : matrixError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {matrixError}
          </div>
        ) : matrixLoading && matrixStudents.length === 0 ? (
          <p className="text-xs text-slate-500">Chargement de la matrice…</p>
        ) : matrixEvals.length === 0 || matrixStudents.length === 0 ? (
          <p className="text-xs text-slate-500">
            Aucune note trouvée pour cette classe / matière sur la période sélectionnée.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-2 text-left">Élève</th>
                  <th className="px-2 py-2 text-left">Matricule</th>
                  {matrixEvals.map((ev, idx) => (
                    <th key={ev.id} className="px-2 py-2 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold">Éval {idx + 1}</span>
                        <span className="text-[11px] text-slate-500">
                          {evalKindLabel(ev.eval_kind)} ·{" "}
                          {(() => {
                            try {
                              return df.format(new Date(ev.eval_date));
                            } catch {
                              return ev.eval_date;
                            }
                          })()}{" "}
                          · /{ev.scale}
                        </span>
                        {ev.teacher_name && (
                          <span className="text-[11px] text-slate-400">
                            {ev.teacher_name}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">Moyenne /20</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {matrixStudents.map((st) => {
                  const mForStudent = matrixMarks[st.student_id] || {};
                  let sum20 = 0;
                  let cnt20 = 0;

                  for (const ev of matrixEvals) {
                    const cell = mForStudent[ev.id];
                    if (cell) {
                      if (cell.mark_20 != null) {
                        sum20 += Number(cell.mark_20);
                        cnt20++;
                      } else if (cell.raw != null) {
                        const raw = Number(cell.raw);
                        sum20 += (raw / ev.scale) * 20;
                        cnt20++;
                      }
                    }
                  }

                  const avg20 = cnt20 ? sum20 / cnt20 : null;

                  return (
                    <tr key={st.student_id} className="hover:bg-slate-50/60">
                      <td className="px-2 py-2 text-slate-800">{st.full_name}</td>
                      <td className="px-2 py-2 text-slate-500">
                        {st.matricule || "—"}
                      </td>
                      {matrixEvals.map((ev) => {
                        const cell = mForStudent[ev.id];
                        const raw = cell?.raw ?? null;
                        return (
                          <td
                            key={ev.id}
                            className="px-2 py-2 text-right tabular-nums"
                          >
                            {raw == null ? "—" : `${nf.format(raw)} /${ev.scale}`}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">
                        {avg20 == null ? "—" : `${nf.format(avg20)} /20`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
