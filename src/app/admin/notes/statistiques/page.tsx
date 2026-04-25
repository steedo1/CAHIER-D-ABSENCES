// src/app/admin/notes/stats/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  School,
  Search,
} from "lucide-react";

type ClassRow = {
  id: string;
  name?: string;
  label?: string | null;
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
  order_index?: number | null;
  coeff?: number | null;
  is_active?: boolean | null;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin?: number | null;
  include_in_average?: boolean | null;
};

type PerSubjectAvg = {
  subject_id: string;
  avg20: number | null;
  subject_rank?: number | null;
  teacher_name?: string | null;
  teacher_signature_png?: string | null;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  per_subject?: PerSubjectAvg[];
  general_avg?: number | null;
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
    coeff?: number | null;
  };
  subjects?: BulletinSubject[];
  items?: BulletinItem[];
};

type SubjectOption = {
  id: string;
  name: string;
  notes_count: number;
};

type MatrixCell = {
  avg: number | null;
  rank: number | null;
};

type MatrixRow = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  periods: Record<string, MatrixCell>;
  annual_avg: number | null;
  annual_rank: number | null;
};

type PeriodLoadState = {
  period_id: string;
  label: string;
  status: "pending" | "ok" | "empty" | "error";
  message?: string;
};

function clsLabel(c: ClassRow | null | undefined) {
  if (!c) return "";
  return c.label || c.name || "Classe";
}

function periodLabel(p: GradePeriod) {
  return p.short_label || p.label || p.code || "Période";
}

function formatNumber(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatRank(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return String(n);
}

function formatDateFR(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(value: unknown) {
  const v = value === null || value === undefined ? "" : String(value);
  return `"${v.replace(/"/g, '""')}"`;
}

function cleanAvg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function normalizeLabelForMatch(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function subjectAliasesForMatch(value: string | null | undefined): Set<string> {
  const normalized = normalizeLabelForMatch(value);
  const aliases = new Set<string>();

  if (!normalized) return aliases;

  const compact = normalized.replace(/\s+/g, "");
  aliases.add(normalized);
  aliases.add(compact);

  const stopWords = new Set([
    "a",
    "au",
    "aux",
    "d",
    "de",
    "des",
    "du",
    "et",
    "la",
    "le",
    "les",
    "l",
    "education",
    "enseignement",
    "science",
    "sciences",
  ]);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const usefulTokens = tokens.filter((token) => !stopWords.has(token));

  usefulTokens.forEach((token) => {
    if (token.length >= 3) aliases.add(token);
  });

  const acronym = usefulTokens.map((token) => token[0]).join("");
  if (acronym.length >= 2) aliases.add(acronym);

  if (normalized.includes("mathem")) {
    aliases.add("math");
    aliases.add("maths");
    aliases.add("mathematique");
    aliases.add("mathematiques");
  }

  if (normalized.includes("francais")) aliases.add("francais");
  if (normalized.includes("anglais")) aliases.add("anglais");
  if (normalized.includes("espagnol")) aliases.add("espagnol");
  if (normalized.includes("allemand")) aliases.add("allemand");

  if (
    normalized.includes("histoire") &&
    (normalized.includes("geo") || normalized.includes("geographie"))
  ) {
    aliases.add("hg");
    aliases.add("histoire geographie");
  }

  if (normalized.includes("physique") && normalized.includes("chimie")) {
    aliases.add("pc");
    aliases.add("pct");
    aliases.add("physique chimie");
  }

  if (
    normalized === "svt" ||
    (normalized.includes("science") &&
      normalized.includes("vie") &&
      normalized.includes("terre"))
  ) {
    aliases.add("svt");
    aliases.add("science vie terre");
    aliases.add("sciences vie terre");
  }

  if (
    normalized === "eps" ||
    (normalized.includes("education") && normalized.includes("physique"))
  ) {
    aliases.add("eps");
  }

  if (
    normalized === "edhc" ||
    normalized.includes("droits humains") ||
    normalized.includes("citoyennete")
  ) {
    aliases.add("edhc");
  }

  if (normalized.includes("art") && normalized.includes("plastique")) {
    aliases.add("arts plastiques");
    aliases.add("art plastique");
  }

  if (normalized.includes("musique")) aliases.add("musique");
  if (normalized.includes("conduite")) aliases.add("conduite");

  return aliases;
}

function subjectLabelsMatch(a: string | null | undefined, b: string | null | undefined) {
  const aliasesA = subjectAliasesForMatch(a);
  const aliasesB = subjectAliasesForMatch(b);

  if (aliasesA.size === 0 || aliasesB.size === 0) return false;

  for (const alias of aliasesA) {
    if (aliasesB.has(alias)) return true;
  }

  const normalizedA = normalizeLabelForMatch(a);
  const normalizedB = normalizeLabelForMatch(b);

  if (!normalizedA || !normalizedB) return false;

  const compactA = normalizedA.replace(/\s+/g, "");
  const compactB = normalizedB.replace(/\s+/g, "");

  if (compactA.length >= 4 && compactB.length >= 4) {
    if (compactA.includes(compactB) || compactB.includes(compactA)) return true;
  }

  return false;
}

function findSubjectCell(
  item: BulletinItem,
  subject: BulletinSubject | { subject_id: string; subject_name?: string | null }
) {
  const cells = item.per_subject ?? [];
  const subjectId = String(subject.subject_id || "").trim();

  return cells.find((cell) => String(cell.subject_id || "").trim() === subjectId) || null;
}

function findBulletinSubject(
  subjects: BulletinSubject[],
  selectedSubjectId: string,
  selectedSubjectName: string
): BulletinSubject | null {
  const exact =
    subjects.find(
      (subject) =>
        String(subject.subject_id || "").trim() === String(selectedSubjectId || "").trim()
    ) || null;

  if (exact) return exact;

  return (
    subjects.find((subject) =>
      subjectLabelsMatch(subject.subject_name, selectedSubjectName)
    ) || null
  );
}

function buildRankMap(rows: Array<{ student_id: string; avg: number | null }>) {
  const valid = rows
    .filter((r) => typeof r.avg === "number" && Number.isFinite(r.avg))
    .map((r) => ({ student_id: r.student_id, avg: Number(r.avg) }))
    .sort((a, b) => b.avg - a.avg);

  const map = new Map<string, number>();

  let lastAvg: number | null = null;
  let currentRank = 0;
  let position = 0;

  for (const row of valid) {
    position += 1;

    if (lastAvg === null || row.avg !== lastAvg) {
      currentRank = position;
      lastAvg = row.avg;
    }

    map.set(row.student_id, currentRank);
  }

  return map;
}

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber";
  }
) {
  const { tone = "emerald", className = "", ...rest } = props;

  const tones = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500/30",
    amber: "bg-amber-500 text-slate-950 hover:bg-amber-600 focus:ring-amber-500/30",
  } as const;

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

function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition",
        "hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-400/20 disabled:cursor-not-allowed disabled:opacity-50",
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

export default function AdminNotesStatsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectsMsg, setSubjectsMsg] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");

  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [loadedPeriods, setLoadedPeriods] = useState<GradePeriod[]>([]);
  const [periodStates, setPeriodStates] = useState<PeriodLoadState[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const selectedSubject = useMemo(
    () => subjectOptions.find((s) => s.id === selectedSubjectId) || null,
    [subjectOptions, selectedSubjectId]
  );

  const selectedSubjectName = selectedSubject?.name || "Matière";

  const academicYears = useMemo(() => {
    const set = new Set<string>();

    classes.forEach((c) => c.academic_year && set.add(c.academic_year));
    periods.forEach((p) => p.academic_year && set.add(p.academic_year));

    return Array.from(set).sort().reverse();
  }, [classes, periods]);

  const matrixPeriods = useMemo(() => {
    return periods
      .filter((p) => p.is_active !== false)
      .filter((p) => !selectedAcademicYear || p.academic_year === selectedAcademicYear)
      .filter((p) => !!p.start_date && !!p.end_date)
      .slice()
      .sort((a, b) => {
        const ai = Number(a.order_index ?? 999);
        const bi = Number(b.order_index ?? 999);

        if (ai !== bi) return ai - bi;

        return String(a.start_date).localeCompare(String(b.start_date));
      });
  }, [periods, selectedAcademicYear]);

  const matrixPeriodsKey = useMemo(
    () =>
      matrixPeriods
        .map((p) => `${p.id}:${p.start_date}:${p.end_date}:${p.coeff ?? ""}`)
        .join("|"),
    [matrixPeriods]
  );

  const stats = useMemo(() => {
    const valid = matrixRows
      .map((r) => r.annual_avg)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    if (!valid.length) {
      return {
        count: matrixRows.length,
        classAvg: null,
        highest: null,
        lowest: null,
      };
    }

    const sum = valid.reduce((acc, n) => acc + n, 0);

    return {
      count: matrixRows.length,
      classAvg: Math.round((sum / valid.length) * 100) / 100,
      highest: Math.round(Math.max(...valid) * 100) / 100,
      lowest: Math.round(Math.min(...valid) * 100) / 100,
    };
  }, [matrixRows]);

  useEffect(() => {
    let cancelled = false;

    async function loadClasses() {
      setClassesLoading(true);
      setErrorMsg(null);

      try {
        const res = await fetch("/api/admin/classes", { cache: "no-store" });

        if (!res.ok) throw new Error(`Erreur classes : ${res.status}`);

        const json = await res.json().catch(() => null);

        const items: ClassRow[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.items)
          ? json.items
          : [];

        if (cancelled) return;

        setClasses(items);

        if (!selectedClassId && items.length) {
          setSelectedClassId(items[0].id);
          if (items[0].academic_year) {
            setSelectedAcademicYear(items[0].academic_year);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
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
    const cls = classes.find((c) => c.id === selectedClassId);

    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
    }
  }, [selectedClassId, classes]);

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

        const items: GradePeriod[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.items)
          ? json.items
          : [];

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
    setMatrixRows([]);
    setLoadedPeriods([]);
    setPeriodStates([]);
    setErrorMsg(null);
  }, [selectedClassId, selectedAcademicYear, selectedSubjectId]);

  useEffect(() => {
    if (!selectedClassId || !matrixPeriods.length) {
      setSubjectOptions([]);
      setSelectedSubjectId("");
      setSubjectsMsg(null);
      return;
    }

    loadSubjectOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, matrixPeriodsKey]);

  async function fetchBulletinForPeriod(classId: string, period: GradePeriod) {
    const params = new URLSearchParams();

    params.set("class_id", classId);
    params.set("from", period.start_date);
    params.set("to", period.end_date);

    // RÈGLE OFFICIELLE :
    // La matrice matière ne travaille que sur les notes publiées.
    // Aucun filtre brouillon / publication n'est exposé dans l'interface.
    params.set("published", "true");

    const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Erreur bulletin ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as BulletinResponse | null;

    if (!json?.ok) throw new Error("Réponse bulletin invalide.");

    return json;
  }

  async function loadSubjectOptions() {
    setSubjectsLoading(true);
    setSubjectsMsg(null);
    setSubjectOptions([]);

    if (!selectedClassId) {
      setSelectedSubjectId("");
      setSubjectsLoading(false);
      return;
    }

    if (!matrixPeriods.length) {
      setSelectedSubjectId("");
      setSubjectsMsg("Aucune période active avec dates n’est configurée.");
      setSubjectsLoading(false);
      return;
    }

    try {
      const map = new Map<string, SubjectOption>();

      for (const period of matrixPeriods) {
        try {
          const bulletin = await fetchBulletinForPeriod(selectedClassId, period);
          const subjects = Array.isArray(bulletin.subjects) ? bulletin.subjects : [];
          const items = Array.isArray(bulletin.items) ? bulletin.items : [];

          for (const subject of subjects) {
            const subjectId = String(subject.subject_id || "").trim();

            if (!subjectId) continue;

            const values = items
              .map((item) => cleanAvg(findSubjectCell(item, subject)?.avg20))
              .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

            if (!values.length) continue;

            const current = map.get(subjectId);

            map.set(subjectId, {
              id: subjectId,
              name: subject.subject_name || current?.name || "Matière",
              notes_count: (current?.notes_count || 0) + values.length,
            });
          }
        } catch (err) {
          console.warn("[admin.notes.stats] période ignorée pour matières", period.id, err);
        }
      }

      const options = Array.from(map.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );

      setSubjectOptions(options);

      setSelectedSubjectId((prev) => {
        if (prev && options.some((o) => o.id === prev)) return prev;
        return options[0]?.id || "";
      });

      if (!options.length) {
        setSubjectsMsg(
          "Aucune matière avec moyenne publiée n’a été trouvée pour cette classe et cette année."
        );
      }
    } catch (e: any) {
      setSubjectOptions([]);
      setSelectedSubjectId("");
      setSubjectsMsg(e?.message || "Impossible de charger les matières.");
    } finally {
      setSubjectsLoading(false);
    }
  }

  async function loadMatrix() {
    setErrorMsg(null);
    setMatrixRows([]);
    setLoadedPeriods([]);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }

    if (!selectedSubjectId) {
      setErrorMsg("Veuillez sélectionner une matière.");
      return;
    }

    if (!matrixPeriods.length) {
      setErrorMsg("Aucune période active avec dates n’est configurée pour cette année scolaire.");
      return;
    }

    setLoadingMatrix(true);
    setLoadedPeriods(matrixPeriods);

    setPeriodStates(
      matrixPeriods.map((p) => ({
        period_id: p.id,
        label: periodLabel(p),
        status: "pending",
      }))
    );

    try {
      const students = new Map<string, MatrixRow>();

      const periodResults: Array<{
        period: GradePeriod;
        items: BulletinItem[];
        subject: BulletinSubject;
        ranks: Map<string, number>;
      }> = [];

      for (const period of matrixPeriods) {
        try {
          const bulletin = await fetchBulletinForPeriod(selectedClassId, period);
          const subjects = Array.isArray(bulletin.subjects) ? bulletin.subjects : [];
          const items = Array.isArray(bulletin.items) ? bulletin.items : [];

          const subject = findBulletinSubject(
            subjects,
            selectedSubjectId,
            selectedSubjectName
          );

          if (!subject) {
            setPeriodStates((prev) =>
              prev.map((s) =>
                s.period_id === period.id
                  ? {
                      ...s,
                      status: "empty",
                      message: "Matière absente",
                    }
                  : s
              )
            );
            continue;
          }

          const subjectRows = items.map((item) => ({
            student_id: item.student_id,
            avg: cleanAvg(findSubjectCell(item, subject)?.avg20),
          }));

          const ranks = buildRankMap(subjectRows);

          const notedCount = subjectRows.filter(
            (r) => typeof r.avg === "number" && Number.isFinite(r.avg)
          ).length;

          periodResults.push({
            period,
            items,
            subject,
            ranks,
          });

          for (const item of items) {
            if (!students.has(item.student_id)) {
              students.set(item.student_id, {
                student_id: item.student_id,
                full_name: item.full_name || "Élève",
                matricule: item.matricule ?? null,
                periods: {},
                annual_avg: null,
                annual_rank: null,
              });
            }

            const row = students.get(item.student_id)!;
            const avg = cleanAvg(findSubjectCell(item, subject)?.avg20);

            row.full_name = item.full_name || row.full_name;
            row.matricule = item.matricule ?? row.matricule;

            row.periods[period.id] = {
              avg,
              rank: ranks.get(item.student_id) ?? null,
            };
          }

          setPeriodStates((prev) =>
            prev.map((s) =>
              s.period_id === period.id
                ? {
                    ...s,
                    status: notedCount ? "ok" : "empty",
                    message: notedCount
                      ? `${notedCount} moyenne(s) publiée(s)`
                      : "Aucune moyenne publiée",
                  }
                : s
            )
          );
        } catch (e: any) {
          setPeriodStates((prev) =>
            prev.map((s) =>
              s.period_id === period.id
                ? {
                    ...s,
                    status: "error",
                    message: e?.message || "Erreur",
                  }
                : s
            )
          );
        }
      }

      const rows = Array.from(students.values());

      for (const row of rows) {
        let num = 0;
        let den = 0;

        for (const { period } of periodResults) {
          const avg = row.periods[period.id]?.avg;

          if (avg === null || avg === undefined || !Number.isFinite(avg)) continue;

          const coeffRaw = Number(period.coeff ?? 1);
          const coeff = Number.isFinite(coeffRaw) && coeffRaw > 0 ? coeffRaw : 1;

          num += avg * coeff;
          den += coeff;
        }

        row.annual_avg = den > 0 ? Math.round((num / den) * 100) / 100 : null;
      }

      const annualRanks = buildRankMap(
        rows.map((r) => ({
          student_id: r.student_id,
          avg: r.annual_avg,
        }))
      );

      rows.forEach((row) => {
        row.annual_rank = annualRanks.get(row.student_id) ?? null;
      });

      rows.sort((a, b) => {
        const ar = a.annual_rank ?? 99999;
        const br = b.annual_rank ?? 99999;

        if (ar !== br) return ar - br;

        return a.full_name.localeCompare(b.full_name, "fr", {
          sensitivity: "base",
          numeric: true,
        });
      });

      setMatrixRows(rows);

      if (!rows.length) {
        setErrorMsg("Aucun élève ou aucune moyenne publiée n’a été trouvé pour cette matière.");
      }
    } finally {
      setLoadingMatrix(false);
    }
  }

  function exportCsv() {
    if (!matrixRows.length) {
      setErrorMsg("Chargez d’abord la matrice avant d’exporter.");
      return;
    }

    const headers = ["N°", "Matricule", "Nom et prénoms"];

    for (const p of loadedPeriods) {
      const label = periodLabel(p);
      headers.push(`${label} moyenne`, `${label} rang`);
    }

    headers.push("Moyenne annuelle matière", "Rang annuel matière");

    const lines = [headers.map(csvCell).join(";")];

    matrixRows.forEach((row, idx) => {
      const cells: Array<string | number | null> = [
        idx + 1,
        row.matricule || "",
        row.full_name,
      ];

      for (const p of loadedPeriods) {
        const cell = row.periods[p.id] || { avg: null, rank: null };

        cells.push(cell.avg !== null ? cell.avg.toFixed(2) : "", cell.rank ?? "");
      }

      cells.push(
        row.annual_avg !== null ? row.annual_avg.toFixed(2) : "",
        row.annual_rank ?? ""
      );

      lines.push(cells.map(csvCell).join(";"));
    });

    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const safeClass = clsLabel(selectedClass).replace(/[^a-z0-9_-]+/gi, "_");
    const safeSubject = selectedSubjectName.replace(/[^a-z0-9_-]+/gi, "_");
    const safeYear = (selectedAcademicYear || "annee").replace(/[^a-z0-9_-]+/gi, "_");

    const a = document.createElement("a");
    a.href = url;
    a.download = `matrice_matiere_${safeSubject}_${safeClass}_${safeYear}.csv`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!matrixRows.length) {
      setErrorMsg("Chargez d’abord la matrice avant d’exporter.");
      return;
    }

    const className = clsLabel(selectedClass);
    const title = `Matrice matière — ${selectedSubjectName}`;
    const subtitle = `${className || "Classe"} — Année scolaire ${
      selectedAcademicYear || "—"
    }`;

    const periodHeader = loadedPeriods
      .map(
        (p) => `
          <th colspan="2">
            ${escapeHtml(periodLabel(p))}
            <br/>
            <span>${escapeHtml(formatDateFR(p.start_date))} — ${escapeHtml(
          formatDateFR(p.end_date)
        )}</span>
          </th>`
      )
      .join("");

    const secondHeader = loadedPeriods
      .map(() => `<th>Moy.</th><th>Rang</th>`)
      .join("");

    const body = matrixRows
      .map((row, idx) => {
        const periodCells = loadedPeriods
          .map((p) => {
            const cell = row.periods[p.id] || { avg: null, rank: null };

            return `<td class="num">${formatNumber(cell.avg)}</td><td class="num">${formatRank(
              cell.rank
            )}</td>`;
          })
          .join("");

        return `<tr>
          <td class="num">${idx + 1}</td>
          <td>${escapeHtml(row.matricule || "")}</td>
          <td>${escapeHtml(row.full_name)}</td>
          ${periodCells}
          <td class="num strong">${formatNumber(row.annual_avg)}</td>
          <td class="num strong">${formatRank(row.annual_rank)}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0f172a;
    margin: 0;
  }
  h1 {
    font-size: 18px;
    margin: 0;
    text-transform: uppercase;
  }
  .subtitle {
    margin-top: 4px;
    color: #475569;
    font-size: 12px;
  }
  .meta {
    display: flex;
    gap: 12px;
    margin: 12px 0;
    font-size: 11px;
    color: #334155;
    flex-wrap: wrap;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th,
  td {
    border: 1px solid #cbd5e1;
    padding: 5px 6px;
    vertical-align: middle;
  }
  th {
    background: #e2e8f0;
    font-weight: 800;
    text-align: center;
  }
  th span {
    font-size: 8px;
    color: #475569;
    font-weight: 600;
  }
  td.num {
    text-align: right;
    white-space: nowrap;
  }
  td.strong {
    font-weight: 800;
    background: #ecfdf5;
    color: #065f46;
  }
  tr:nth-child(even) td {
    background: #f8fafc;
  }
  tr:nth-child(even) td.strong {
    background: #d1fae5;
  }
  .footer {
    margin-top: 10px;
    font-size: 9px;
    color: #64748b;
    text-align: right;
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(subtitle)}</div>

  <div class="meta">
    <div><strong>Classe :</strong> ${escapeHtml(className || "—")}</div>
    <div><strong>Matière :</strong> ${escapeHtml(selectedSubjectName)}</div>
    <div><strong>Élèves :</strong> ${matrixRows.length}</div>
    <div><strong>Moyenne matière :</strong> ${formatNumber(stats.classAvg)}</div>
    <div><strong>Plus forte :</strong> ${formatNumber(stats.highest)}</div>
    <div><strong>Plus faible :</strong> ${formatNumber(stats.lowest)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th rowspan="2">N°</th>
        <th rowspan="2">Matricule</th>
        <th rowspan="2">Nom et prénoms</th>
        ${periodHeader}
        <th colspan="2">Annuel matière</th>
      </tr>
      <tr>${secondHeader}<th>Moy.</th><th>Rang</th></tr>
    </thead>
    <tbody>${body}</tbody>
  </table>

  <div class="footer">Document généré depuis Mon Cahier — Nexa Digital SARL</div>
</body>
</html>`;

    const win = window.open("", "_blank");

    if (!win) {
      setErrorMsg(
        "Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups."
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
    }, 400);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/80">
              Cahier de notes • Matrice matière
            </p>

            <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
              Matrice des moyennes par matière
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Sélectionnez une classe, une année scolaire et une matière pour afficher les
              moyennes publiées et les rangs par période, puis la moyenne annuelle de la matière.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center text-xs text-slate-200 sm:min-w-[520px] md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Élèves
              </div>
              <div className="mt-1 text-xl font-bold text-white">{stats.count}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Moy. matière
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {formatNumber(stats.classAvg)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Plus forte
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {formatNumber(stats.highest)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Périodes
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {loadedPeriods.length || matrixPeriods.length}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-4">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <School className="h-4 w-4" /> Classe
            </label>

            <Select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={classesLoading}
            >
              <option value="">— Sélectionner une classe —</option>

              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {clsLabel(c)}
                  {c.level ? ` • ${c.level}` : ""}
                  {c.academic_year ? ` • ${c.academic_year}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-4 w-4" /> Année scolaire
            </label>

            <Select
              value={selectedAcademicYear}
              onChange={(e) => setSelectedAcademicYear(e.target.value)}
              disabled={periodsLoading}
            >
              <option value="">Année courante</option>

              {academicYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <BookOpen className="h-4 w-4" /> Matière
            </label>

            <Select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={!selectedClassId || subjectsLoading || !subjectOptions.length}
            >
              <option value="">
                {subjectsLoading ? "Chargement des matières…" : "— Sélectionner une matière —"}
              </option>

              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-2 lg:justify-end">
            <Button
              onClick={loadMatrix}
              disabled={!selectedClassId || !selectedSubjectId || loadingMatrix}
            >
              {loadingMatrix ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loadingMatrix ? "Chargement…" : "Charger"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <GhostButton
            type="button"
            onClick={loadSubjectOptions}
            disabled={!selectedClassId || subjectsLoading || !matrixPeriods.length}
          >
            {subjectsLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <BookOpen className="h-4 w-4" />
            )}
            Actualiser matières
          </GhostButton>

          <GhostButton onClick={exportCsv} disabled={!matrixRows.length}>
            <Download className="h-4 w-4" /> CSV
          </GhostButton>

          <GhostButton onClick={exportPdf} disabled={!matrixRows.length}>
            <Printer className="h-4 w-4" /> PDF
          </GhostButton>

          <span className="text-xs text-slate-500">
            {selectedClass ? clsLabel(selectedClass) : "Aucune classe sélectionnée"} •{" "}
            {selectedAcademicYear || "année courante"} • {selectedSubjectName}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {matrixPeriods.length ? (
            matrixPeriods.map((p) => (
              <span
                key={p.id}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
              >
                {periodLabel(p)} : {formatDateFR(p.start_date)} →{" "}
                {formatDateFR(p.end_date)}
              </span>
            ))
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
              Aucune période active avec dates pour cette sélection.
            </span>
          )}
        </div>

        {periodStates.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {periodStates.map((s) => (
              <div
                key={s.period_id}
                className={[
                  "rounded-2xl border px-3 py-2 text-xs",
                  s.status === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : s.status === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : s.status === "empty"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-600",
                ].join(" ")}
              >
                <div className="font-semibold">{s.label}</div>
                <div>{s.status === "pending" ? "En attente…" : s.message || s.status}</div>
              </div>
            ))}
          </div>
        )}

        {subjectsMsg && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {subjectsMsg}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Tableau matière</h2>
            <p className="text-sm text-slate-500">
              {selectedSubjectName} •{" "}
              {selectedClass ? clsLabel(selectedClass) : "Aucune classe sélectionnée"} •{" "}
              {selectedAcademicYear || "année courante"}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FileSpreadsheet className="h-4 w-4" /> {matrixRows.length} ligne(s)
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                >
                  N°
                </th>

                <th
                  rowSpan={2}
                  className="sticky left-12 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                >
                  Matricule
                </th>

                <th
                  rowSpan={2}
                  className="sticky left-44 z-20 min-w-[260px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                >
                  Nom et prénoms
                </th>

                {loadedPeriods.map((p) => (
                  <th
                    key={p.id}
                    colSpan={2}
                    className="border-b border-r border-slate-200 bg-indigo-50 px-3 py-3 text-center text-indigo-800"
                  >
                    <div className="font-bold">{periodLabel(p)}</div>
                    <div className="text-[10px] font-medium normal-case text-indigo-500">
                      {formatDateFR(p.start_date)} → {formatDateFR(p.end_date)}
                    </div>
                  </th>
                ))}

                <th
                  colSpan={2}
                  className="border-b border-slate-200 bg-emerald-50 px-3 py-3 text-center text-emerald-800"
                >
                  Annuel matière
                </th>
              </tr>

              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                {loadedPeriods.map((p) => (
                  <React.Fragment key={`${p.id}-sub`}>
                    <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                      Moy.
                    </th>
                    <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                      Rang
                    </th>
                  </React.Fragment>
                ))}

                <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                  Moy.
                </th>
                <th className="border-b border-slate-200 px-3 py-2 text-right">
                  Rang
                </th>
              </tr>
            </thead>

            <tbody>
              {matrixRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + loadedPeriods.length * 2 + 2}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    Sélectionnez une classe, une matière, puis chargez la matrice.
                  </td>
                </tr>
              ) : (
                matrixRows.map((row, idx) => (
                  <tr
                    key={row.student_id}
                    className="group odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/50"
                  >
                    <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 font-medium text-slate-600">
                      {idx + 1}
                    </td>

                    <td className="sticky left-12 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 text-slate-600">
                      {row.matricule || "—"}
                    </td>

                    <td className="sticky left-44 z-10 min-w-[260px] border-b border-r border-slate-100 bg-inherit px-3 py-2 font-semibold text-slate-900">
                      {row.full_name}
                    </td>

                    {loadedPeriods.map((p) => {
                      const cell = row.periods[p.id] || { avg: null, rank: null };

                      return (
                        <React.Fragment key={`${row.student_id}-${p.id}`}>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">
                            {formatNumber(cell.avg)}
                          </td>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">
                            {formatRank(cell.rank)}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    <td className="border-b border-r border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">
                      {formatNumber(row.annual_avg)}
                    </td>

                    <td className="border-b border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">
                      {formatRank(row.annual_rank)}
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