// src/app/admin/notes/non-classes/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Page : Élèves non classés
   Rôle :
   - Centraliser la décision admin "NC au général"
   - Alimenter public.bulletin_nc_overrides via l’API :
     /api/admin/grades/bulletin/nc-overrides
   - Les bulletins, conseils, matrices et exports héritent ensuite
     naturellement de l’API bulletin.
────────────────────────────────────────────────────────────── */

type ClassRow = {
  id: string;
  name?: string | null;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
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
  order_index?: number | null;
};

type BulletinMissingSubject = {
  subject_id: string;
  subject_name: string;
};

type BulletinCoverage = {
  expected_subjects?: number;
  covered_subjects?: number;
  missing_subjects?: BulletinMissingSubject[];
  is_complete?: boolean;
  has_academic_grade?: boolean;
  status?: "complete" | "partial" | "empty" | "admin_nc" | string;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  general_avg: number | null;
  rank?: number | null;
  coverage?: BulletinCoverage | null;
  general_avg_is_complete?: boolean | null;
  general_avg_status?: "complete" | "partial" | "empty" | "admin_nc" | string | null;

  admin_forced_nc?: boolean | null;
  general_avg_before_admin_nc?: number | null;
  rank_before_admin_nc?: number | null;
  admin_nc_reason?: string | null;
  admin_nc_missing_subjects_snapshot?: BulletinMissingSubject[] | null;
};

type BulletinResponse = {
  ok: boolean;
  class?: {
    id: string;
    label?: string | null;
    academic_year?: string | null;
  };
  period?: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
  };
  items?: BulletinItem[];
};

type NcOverrideApiItem = {
  id: string;
  class_id: string;
  student_id: string;
  academic_year: string;
  period_from: string;
  period_to: string;
  scope: "period" | "annual";
  is_nc: boolean;
  reason: string | null;
  missing_subjects_snapshot: BulletinMissingSubject[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StudentNcRow = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  general_avg: number | null;
  rank: number | null;

  isIncomplete: boolean;
  isEmpty: boolean;
  isAlreadyForcedNc: boolean;

  missingSubjects: BulletinMissingSubject[];
  savedReason: string | null;

  checked: boolean;
  reason: string;
};

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber" | "red";
  }
) {
  const { tone = "emerald", className = "", ...rest } = props;

  const tones: Record<NonNullable<typeof tone>, string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500/30",
    amber:
      "bg-amber-500 text-slate-950 hover:bg-amber-600 focus:ring-amber-500/30",
    red: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30",
  };

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      ].join(" ")}
    />
  );
}

function GhostButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "slate" | "emerald" | "amber" | "red";
  }
) {
  const { tone = "slate", className = "", ...rest } = props;

  const tones: Record<NonNullable<typeof tone>, string> = {
    slate:
      "border-slate-200 text-slate-700 hover:bg-slate-50 focus:ring-slate-400/20",
    emerald:
      "border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-500/20",
    amber:
      "border-amber-200 text-amber-800 hover:bg-amber-50 focus:ring-amber-500/20",
    red: "border-red-200 text-red-700 hover:bg-red-50 focus:ring-red-500/20",
  };

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold shadow-sm transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 disabled:bg-slate-50 disabled:text-slate-400",
        className,
      ].join(" ")}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:bg-slate-50 disabled:text-slate-400",
        className,
      ].join(" ")}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      {...rest}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:bg-slate-50 disabled:text-slate-400",
        className,
      ].join(" ")}
    />
  );
}

function classLabel(c: ClassRow | null | undefined) {
  if (!c) return "";
  return String(c.label || c.name || c.code || "Classe").trim();
}

function periodLabel(p: GradePeriod | null | undefined) {
  if (!p) return "Période";
  return String(p.label || p.short_label || p.code || "Période").trim();
}

function formatDateFR(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function formatAverage(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "NC";
  }
  return Number(value).toFixed(2);
}

function formatRank(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "NC";
  }
  const n = Number(value);
  if (n <= 0) return "NC";
  return String(Math.round(n));
}

function normalizeMissingSubjects(value: unknown): BulletinMissingSubject[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const subjectId = String(row.subject_id ?? "").trim();
      const subjectName = String(row.subject_name ?? "").trim();

      if (!subjectId && !subjectName) return null;

      return {
        subject_id: subjectId || "",
        subject_name: subjectName || "Matière",
      };
    })
    .filter(Boolean) as BulletinMissingSubject[];
}

function missingSubjectsFromItem(item: BulletinItem) {
  const fromCoverage = normalizeMissingSubjects(item.coverage?.missing_subjects);
  if (fromCoverage.length) return fromCoverage;

  const fromOverride = normalizeMissingSubjects(
    item.admin_nc_missing_subjects_snapshot
  );
  if (fromOverride.length) return fromOverride;

  return [];
}

function isItemForcedNc(item: BulletinItem) {
  return item.admin_forced_nc === true || item.general_avg_status === "admin_nc";
}

function isItemEmpty(item: BulletinItem) {
  const status = String(item.general_avg_status || item.coverage?.status || "");
  const hasAverage =
    item.general_avg !== null &&
    item.general_avg !== undefined &&
    Number.isFinite(Number(item.general_avg));

  if (isItemForcedNc(item)) return false;
  return !hasAverage || status === "empty";
}

function shouldAppearInNcWorkspace(item: BulletinItem) {
  const forced = isItemForcedNc(item);
  const missing = missingSubjectsFromItem(item);
  const status = String(item.general_avg_status || item.coverage?.status || "");

  // On affiche surtout les bulletins partiels, ceux déjà NC admin,
  // et ceux qui ont explicitement des matières manquantes.
  return forced || missing.length > 0 || status === "partial";
}

function parseApiArray<T>(json: any): T[] {
  if (Array.isArray(json)) return json as T[];
  if (Array.isArray(json?.items)) return json.items as T[];
  if (Array.isArray(json?.data)) return json.data as T[];
  return [];
}

export default function NonClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState("");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [rows, setRows] = useState<StudentNcRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [showOnlyChecked, setShowOnlyChecked] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedClass = useMemo(
    () => classes.find((c) => String(c.id) === String(selectedClassId)) || null,
    [classes, selectedClassId]
  );

  const academicYears = useMemo(() => {
    const set = new Set<string>();
    classes.forEach((c) => c.academic_year && set.add(c.academic_year));
    periods.forEach((p) => p.academic_year && set.add(p.academic_year));
    return Array.from(set).sort().reverse();
  }, [classes, periods]);

  const filteredPeriods = useMemo(() => {
    return periods
      .filter((p) => p.is_active !== false)
      .filter((p) => !selectedAcademicYear || p.academic_year === selectedAcademicYear)
      .filter((p) => !!p.start_date && !!p.end_date)
      .slice()
      .sort((a, b) => {
        const ai = Number(a.order_index ?? 999);
        const bi = Number(b.order_index ?? 999);
        if (ai !== bi) return ai - bi;
        return String(a.start_date || "").localeCompare(String(b.start_date || ""));
      });
  }, [periods, selectedAcademicYear]);

  const selectedPeriod = useMemo(
    () => filteredPeriods.find((p) => String(p.id) === String(selectedPeriodId)) || null,
    [filteredPeriods, selectedPeriodId]
  );

  const summary = useMemo(() => {
    const total = rows.length;
    const checked = rows.filter((r) => r.checked).length;
    const incomplete = rows.filter((r) => r.isIncomplete).length;
    const empty = rows.filter((r) => r.isEmpty).length;
    return { total, checked, incomplete, empty };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (showOnlyChecked && !row.checked) return false;
        if (!q) return true;

        const haystack = [
          row.full_name,
          row.matricule || "",
          row.missingSubjects.map((s) => s.subject_name).join(" "),
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (a.checked !== b.checked) return a.checked ? -1 : 1;
        if (a.isIncomplete !== b.isIncomplete) return a.isIncomplete ? -1 : 1;
        return a.full_name.localeCompare(b.full_name, "fr", {
          sensitivity: "base",
          numeric: true,
        });
      });
  }, [rows, search, showOnlyChecked]);

  useEffect(() => {
    let cancelled = false;

    async function loadClasses() {
      setClassesLoading(true);
      setErrorMsg(null);

      try {
        const res = await fetch("/api/admin/classes", { cache: "no-store" });
        if (!res.ok) throw new Error(`Erreur classes : ${res.status}`);

        const json = await res.json().catch(() => null);
        const items = parseApiArray<ClassRow>(json);

        if (cancelled) return;

        setClasses(items);

        if (!selectedClassId && items.length) {
          const first = items[0];
          setSelectedClassId(first.id);
          if (first.academic_year) setSelectedAcademicYear(first.academic_year);
        }
      } catch (e: any) {
        if (!cancelled) {
          setClasses([]);
          setErrorMsg(e?.message || "Impossible de charger les classes.");
        }
      } finally {
        if (!cancelled) setClassesLoading(false);
      }
    }

    loadClasses();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cls = classes.find((c) => String(c.id) === String(selectedClassId));
    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPeriods() {
      setPeriodsLoading(true);
      setErrorMsg(null);

      try {
        const params = new URLSearchParams();
        if (selectedAcademicYear) params.set("academic_year", selectedAcademicYear);

        const url = `/api/admin/institution/grading-periods${
          params.toString() ? `?${params.toString()}` : ""
        }`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Erreur périodes : ${res.status}`);

        const json = await res.json().catch(() => null);
        const items = parseApiArray<GradePeriod>(json);

        if (cancelled) return;

        setPeriods(items);

        if (!selectedAcademicYear && typeof json?.academic_year === "string") {
          setSelectedAcademicYear(json.academic_year);
        }
      } catch (e: any) {
        if (!cancelled) {
          setPeriods([]);
          setErrorMsg(e?.message || "Impossible de charger les périodes.");
        }
      } finally {
        if (!cancelled) setPeriodsLoading(false);
      }
    }

    loadPeriods();

    return () => {
      cancelled = true;
    };
  }, [selectedAcademicYear]);

  useEffect(() => {
    if (!selectedPeriod) return;
    setDateFrom(selectedPeriod.start_date || "");
    setDateTo(selectedPeriod.end_date || "");
  }, [selectedPeriod]);

  async function fetchBulletin() {
    if (!selectedClassId) throw new Error("Veuillez sélectionner une classe.");
    if (!dateFrom || !dateTo) throw new Error("Veuillez choisir une période.");

    const params = new URLSearchParams();
    params.set("class_id", selectedClassId);
    params.set("from", dateFrom);
    params.set("to", dateTo);
    params.set("published", "true");

    const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`, {
      cache: "no-store",
    });

    const text = await res.text();
    let json: BulletinResponse | null = null;

    try {
      json = text ? (JSON.parse(text) as BulletinResponse) : null;
    } catch {
      json = null;
    }

    if (!res.ok || !json?.ok) {
      throw new Error(
        (json as any)?.error ||
          text ||
          `Erreur bulletin : ${res.status}`
      );
    }

    return json;
  }

  async function fetchSavedOverrides() {
    if (!selectedClassId || !dateFrom || !dateTo) return [];

    const params = new URLSearchParams();
    params.set("class_id", selectedClassId);
    params.set("from", dateFrom);
    params.set("to", dateTo);
    params.set("scope", "period");

    if (selectedAcademicYear) {
      params.set("academic_year", selectedAcademicYear);
    }

    const res = await fetch(
      `/api/admin/grades/bulletin/nc-overrides?${params.toString()}`,
      { cache: "no-store" }
    );

    const text = await res.text();
    let json: any = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || text || `Erreur NC : ${res.status}`);
    }

    return parseApiArray<NcOverrideApiItem>(json);
  }

  async function loadRows() {
    setMsg(null);
    setErrorMsg(null);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }

    if (!dateFrom || !dateTo) {
      setErrorMsg("Veuillez sélectionner une période.");
      return;
    }

    setLoadingRows(true);

    try {
      const [bulletin, saved] = await Promise.all([
        fetchBulletin(),
        fetchSavedOverrides(),
      ]);

      const savedByStudent = new Map(
        saved.map((item) => [String(item.student_id), item])
      );

      const builtRows: StudentNcRow[] = [];

      for (const item of bulletin.items || []) {
        const savedOverride = savedByStudent.get(String(item.student_id)) || null;
        const forcedFromApi = isItemForcedNc(item);
        const checked = forcedFromApi || savedOverride?.is_nc === true;

        const missingSubjects = checked
          ? normalizeMissingSubjects(
              item.admin_nc_missing_subjects_snapshot ||
                savedOverride?.missing_subjects_snapshot ||
                item.coverage?.missing_subjects
            )
          : missingSubjectsFromItem(item);

        const isIncomplete =
          missingSubjects.length > 0 ||
          String(item.coverage?.status || item.general_avg_status || "") === "partial";

        const isEmpty = isItemEmpty(item);

        if (!checked && !shouldAppearInNcWorkspace(item)) {
          continue;
        }

        builtRows.push({
          student_id: item.student_id,
          full_name: item.full_name || "Élève",
          matricule: item.matricule ?? null,
          general_avg:
            item.general_avg !== null &&
            item.general_avg !== undefined &&
            Number.isFinite(Number(item.general_avg))
              ? Number(item.general_avg)
              : item.general_avg_before_admin_nc !== null &&
                item.general_avg_before_admin_nc !== undefined &&
                Number.isFinite(Number(item.general_avg_before_admin_nc))
              ? Number(item.general_avg_before_admin_nc)
              : null,
          rank:
            item.rank !== null &&
            item.rank !== undefined &&
            Number.isFinite(Number(item.rank))
              ? Number(item.rank)
              : item.rank_before_admin_nc !== null &&
                item.rank_before_admin_nc !== undefined &&
                Number.isFinite(Number(item.rank_before_admin_nc))
              ? Number(item.rank_before_admin_nc)
              : null,
          isIncomplete,
          isEmpty,
          isAlreadyForcedNc: checked,
          missingSubjects,
          savedReason: savedOverride?.reason || item.admin_nc_reason || null,
          checked,
          reason:
            savedOverride?.reason ||
            item.admin_nc_reason ||
            (isIncomplete ? "Bulletin incomplet" : ""),
        });
      }

      builtRows.sort((a, b) =>
        a.full_name.localeCompare(b.full_name, "fr", {
          sensitivity: "base",
          numeric: true,
        })
      );

      setRows(builtRows);

      if (!builtRows.length) {
        setMsg(
          "Aucun élève incomplet ou déjà marqué NC n’a été trouvé pour cette classe/période."
        );
      } else {
        setMsg(
          `${builtRows.length} élève(s) à contrôler pour ${classLabel(
            selectedClass
          )} — ${periodLabel(selectedPeriod)}.`
        );
      }
    } catch (e: any) {
      setRows([]);
      setErrorMsg(e?.message || "Impossible de charger les élèves non classés.");
    } finally {
      setLoadingRows(false);
    }
  }

  async function saveRows() {
    setMsg(null);
    setErrorMsg(null);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }

    if (!dateFrom || !dateTo) {
      setErrorMsg("Veuillez sélectionner une période.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        class_id: selectedClassId,
        academic_year: selectedAcademicYear || selectedClass?.academic_year || "",
        from: dateFrom,
        to: dateTo,
        scope: "period",
        items: rows.map((row) => ({
          student_id: row.student_id,
          is_nc: row.checked,
          reason: row.reason?.trim() || null,
          missing_subjects_snapshot: row.missingSubjects,
        })),
      };

      const res = await fetch("/api/admin/grades/bulletin/nc-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || text || `Erreur sauvegarde : ${res.status}`);
      }

      setMsg(
        `Décisions NC enregistrées ✅ (${json?.meta?.upserted ?? 0} ajouté(s), ${
          json?.meta?.deleted ?? 0
        } retiré(s)).`
      );

      await loadRows();
    } catch (e: any) {
      setErrorMsg(e?.message || "Impossible d’enregistrer les décisions NC.");
    } finally {
      setSaving(false);
    }
  }

  function updateRow(studentId: string, patch: Partial<StudentNcRow>) {
    setRows((prev) =>
      prev.map((row) =>
        row.student_id === studentId ? { ...row, ...patch } : row
      )
    );
  }

  function setAllChecked(value: boolean) {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        checked: value,
        reason:
          value && !row.reason.trim()
            ? row.isIncomplete
              ? "Bulletin incomplet"
              : "Décision administrative"
            : row.reason,
      }))
    );
  }

  function setIncompleteChecked() {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        checked: row.isIncomplete || row.checked,
        reason:
          (row.isIncomplete || row.checked) && !row.reason.trim()
            ? "Bulletin incomplet"
            : row.reason,
      }))
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-emerald-950 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Décisions administratives
            </div>

            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Élèves non classés
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Centralisez ici les élèves à mettre <strong>NC au général</strong>.
              Les bulletins, conseils de classe, matrices et exports héritent ensuite
              de cette décision sans modifier les moyennes par matière.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-200 sm:min-w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/8 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                À contrôler
              </div>
              <div className="mt-1 text-xl font-bold text-white">{summary.total}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/8 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Cochés NC
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {summary.checked}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/8 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Incomplets
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {summary.incomplete}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-4">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Users className="h-4 w-4" />
              Classe
            </label>

            <Select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setRows([]);
                setMsg(null);
                setErrorMsg(null);
              }}
              disabled={classesLoading}
            >
              <option value="">— Sélectionner une classe —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c)}
                  {c.level ? ` • ${c.level}` : ""}
                  {c.academic_year ? ` • ${c.academic_year}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <FileText className="h-4 w-4" />
              Année scolaire
            </label>

            <Select
              value={selectedAcademicYear}
              onChange={(e) => {
                setSelectedAcademicYear(e.target.value);
                setSelectedPeriodId("");
                setRows([]);
              }}
              disabled={periodsLoading}
            >
              <option value="">Année courante</option>
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <FileText className="h-4 w-4" />
              Période
            </label>

            <Select
              value={selectedPeriodId}
              onChange={(e) => {
                setSelectedPeriodId(e.target.value);
                setRows([]);
              }}
              disabled={periodsLoading || filteredPeriods.length === 0}
            >
              <option value="">
                {filteredPeriods.length ? "— Sélectionner —" : "Aucune période"}
              </option>
              {filteredPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)} • {formatDateFR(p.start_date)} →{" "}
                  {formatDateFR(p.end_date)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-2 lg:justify-end">
            <Button
              type="button"
              onClick={loadRows}
              disabled={loadingRows || !selectedClassId || !dateFrom || !dateTo}
              className="w-full lg:w-auto"
            >
              {loadingRows ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Charger
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Du
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setRows([]);
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Au
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setRows([]);
              }}
            />
          </div>

          <div className="flex items-end">
            <div className="w-full rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <strong>Règle :</strong> cocher NC mettra la moyenne générale et le
              rang à NC. Les moyennes par matière restent affichées.
            </div>
          </div>
        </div>

        {msg ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {msg}
          </div>
        ) : null}

        {errorMsg ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Liste des élèves à contrôler
            </h2>
            <p className="text-sm text-slate-500">
              {selectedClass ? classLabel(selectedClass) : "Aucune classe"} •{" "}
              {selectedPeriod ? periodLabel(selectedPeriod) : "Aucune période"} •{" "}
              {visibleRows.length} ligne(s)
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher élève ou matière…"
                className="pl-9"
              />
            </div>

            <GhostButton
              type="button"
              tone={showOnlyChecked ? "emerald" : "slate"}
              onClick={() => setShowOnlyChecked((v) => !v)}
              disabled={!rows.length}
            >
              {showOnlyChecked ? <CheckCircle2 className="h-4 w-4" /> : null}
              Cochés seulement
            </GhostButton>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            <GhostButton
              type="button"
              tone="amber"
              onClick={setIncompleteChecked}
              disabled={!rows.length}
            >
              <AlertTriangle className="h-4 w-4" />
              Cocher les incomplets
            </GhostButton>

            <GhostButton
              type="button"
              tone="emerald"
              onClick={() => setAllChecked(true)}
              disabled={!rows.length}
            >
              <CheckCircle2 className="h-4 w-4" />
              Tout cocher
            </GhostButton>

            <GhostButton
              type="button"
              tone="red"
              onClick={() => setAllChecked(false)}
              disabled={!rows.length}
            >
              <XCircle className="h-4 w-4" />
              Tout décocher
            </GhostButton>
          </div>

          <Button
            type="button"
            onClick={saveRows}
            disabled={!rows.length || saving || loadingRows}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer les décisions NC
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="border-b border-r border-slate-200 px-3 py-3 text-left">
                  NC
                </th>
                <th className="border-b border-r border-slate-200 px-3 py-3 text-left">
                  Élève
                </th>
                <th className="border-b border-r border-slate-200 px-3 py-3 text-left">
                  Matricule
                </th>
                <th className="border-b border-r border-slate-200 px-3 py-3 text-right">
                  Moy. actuelle
                </th>
                <th className="border-b border-r border-slate-200 px-3 py-3 text-right">
                  Rang actuel
                </th>
                <th className="border-b border-r border-slate-200 px-3 py-3 text-left">
                  Matières manquantes
                </th>
                <th className="border-b border-slate-200 px-3 py-3 text-left">
                  Motif
                </th>
              </tr>
            </thead>

            <tbody>
              {loadingRows ? (
                <tr>
                  <td colSpan={7} className="px-6 py-14 text-center text-sm text-slate-500">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Chargement des bulletins incomplets…
                    </div>
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-14 text-center text-sm text-slate-500">
                    Chargez une classe/période pour afficher les élèves à contrôler.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={row.student_id}
                    className={[
                      "odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/40",
                      row.checked ? "bg-amber-50/70" : "",
                    ].join(" ")}
                  >
                    <td className="border-b border-r border-slate-100 px-3 py-3 align-top">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          checked={row.checked}
                          onChange={(e) =>
                            updateRow(row.student_id, {
                              checked: e.target.checked,
                              reason:
                                e.target.checked && !row.reason.trim()
                                  ? row.isIncomplete
                                    ? "Bulletin incomplet"
                                    : "Décision administrative"
                                  : row.reason,
                            })
                          }
                        />
                        <span
                          className={[
                            "rounded-full px-2 py-0.5 text-[11px] font-bold",
                            row.checked
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-500",
                          ].join(" ")}
                        >
                          {row.checked ? "NC" : "Classé"}
                        </span>
                      </label>
                    </td>

                    <td className="border-b border-r border-slate-100 px-3 py-3 align-top">
                      <div className="font-semibold text-slate-900">{row.full_name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.isIncomplete ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            Bulletin incomplet
                          </span>
                        ) : null}

                        {row.isAlreadyForcedNc ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            NC enregistré
                          </span>
                        ) : null}

                        {row.isEmpty ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            Aucune moyenne
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td className="border-b border-r border-slate-100 px-3 py-3 align-top text-slate-600">
                      {row.matricule || "—"}
                    </td>

                    <td className="border-b border-r border-slate-100 px-3 py-3 text-right align-top font-semibold tabular-nums text-slate-900">
                      {formatAverage(row.general_avg)}
                    </td>

                    <td className="border-b border-r border-slate-100 px-3 py-3 text-right align-top font-semibold tabular-nums text-slate-900">
                      {formatRank(row.rank)}
                    </td>

                    <td className="border-b border-r border-slate-100 px-3 py-3 align-top">
                      {row.missingSubjects.length ? (
                        <div className="flex max-w-[360px] flex-wrap gap-1">
                          {row.missingSubjects.map((subject, index) => (
                            <span
                              key={`${row.student_id}-${subject.subject_id || subject.subject_name}-${index}`}
                              className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                            >
                              {subject.subject_name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Aucune matière manquante signalée
                        </span>
                      )}
                    </td>

                    <td className="border-b border-slate-100 px-3 py-3 align-top">
                      <Textarea
                        rows={2}
                        value={row.reason}
                        onChange={(e) =>
                          updateRow(row.student_id, { reason: e.target.value })
                        }
                        placeholder="Motif administratif…"
                        disabled={!row.checked}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
