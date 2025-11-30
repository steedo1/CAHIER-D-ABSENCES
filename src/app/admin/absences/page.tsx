// src/app/admin/absences/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Filter, RefreshCw, Download } from "lucide-react";

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
function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-800">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* ───────── Types ───────── */
type ClassItem = {
  id: string;
  name: string;
  level: string;
  academic_year?: string | null;
};

type MatrixSubject = { id: string; name: string };
type MatrixStudent = { id: string; full_name: string; rank?: number };
type MatrixValue = { student_id: string; subject_id: string; minutes: number };
type MatrixPayload = {
  subjects: MatrixSubject[];
  students: MatrixStudent[];
  values: MatrixValue[];
  subjectDistinct: Record<string, number>;
};

/** Périodes de notes (trimestres / séquences) */
type GradePeriod = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  coeff: number | null;
};

/* ───────── Helpers ───────── */
const nf = new Intl.NumberFormat("fr-FR");
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const hoursLabel = (minutes: number) => {
  const h = (minutes || 0) / 60;
  const s = h.toFixed(1).replace(".", ",");
  return s.replace(/,0$/, "") + " h";
};

/* CSV – échappage + export UTF-16LE (Excel-friendly) */
function csvEscape(x: any) {
  const s = String(x ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}
function downloadCsvUtf16LE(filename: string, content: string) {
  const bom = new Uint8Array([0xff, 0xfe]); // BOM UTF-16LE
  const buf = new Uint8Array(bom.length + content.length * 2);
  buf.set(bom, 0);
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    buf[bom.length + i * 2] = code & 0xff;
    buf[bom.length + i * 2 + 1] = code >> 8;
  }
  const blob = new Blob([buf], { type: "text/csv;charset=utf-16le" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ───────── Page ───────── */
const HOT_RATIO = 0.95; // ≥95% du max → surligné

export default function AbsencesMatrixOnly() {
  // Filtres dates
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rubrique, setRubrique] = useState<"absent" | "tardy">("absent");

  // Sélections niveau / classe
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  // Périodes / années scolaires
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>("");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  // Données matrice
  const [matrix, setMatrix] = useState<MatrixPayload | null>(null);

  // UI
  const [loading, setLoading] = useState(false);

  /* Charger classes */
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAllClasses(j.items || []))
      .catch(() => setAllClasses([]));
  }, []);

  /* Charger périodes */
  useEffect(() => {
    const run = async () => {
      try {
        setPeriodsLoading(true);
        const res = await fetch("/api/admin/grades/periods");
        if (!res.ok) return;
        const json = await res.json();
        const items: GradePeriod[] = Array.isArray(json)
          ? json
          : Array.isArray(json.items)
          ? json.items
          : [];
        setPeriods(items);
      } catch (e) {
        console.error(e);
      } finally {
        setPeriodsLoading(false);
      }
    };
    run();
  }, []);

  /* Niveaux à partir des classes */
  const levelsFromClasses = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add((c.level || "").trim());
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [allClasses]);

  const classesOfLevel = useMemo(() => {
    if (!selectedLevel) return [];
    return allClasses
      .filter((c) => c.level === selectedLevel)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
  }, [allClasses, selectedLevel]);

  /* Années scolaires disponibles à partir des périodes */
  const academicYears = useMemo(() => {
    const s = new Set<string>();
    periods.forEach((p) => {
      if (p.academic_year) s.add(p.academic_year);
    });
    return Array.from(s).sort();
  }, [periods]);

  /* Périodes filtrées par année scolaire */
  const filteredPeriods = useMemo(() => {
    if (!selectedAcademicYear) return periods;
    return periods.filter((p) => p.academic_year === selectedAcademicYear);
  }, [periods, selectedAcademicYear]);

  /* Quand on sélectionne une période, on remplit automatiquement les dates */
  useEffect(() => {
    if (!selectedPeriodId) return;
    const p = periods.find((pp) => pp.id === selectedPeriodId);
    if (!p) return;
    setFrom(p.start_date || "");
    setTo(p.end_date || "");
  }, [selectedPeriodId, periods]);

  /* Quand on change de niveau, on vide la classe */
  useEffect(() => {
    setSelectedClassId("");
  }, [selectedLevel]);

  /* Index minutes par élève × matière
     👉 Jamais null : on renvoie {} quand matrix est null,
     pour éviter les erreurs TypeScript. */
  const matrixIndex = useMemo(() => {
    const dict: Record<string, Record<string, number>> = {};
    if (!matrix) return dict;
    for (const v of matrix.values) {
      if (!dict[v.student_id]) dict[v.student_id] = {};
      dict[v.student_id][v.subject_id] =
        (dict[v.student_id][v.subject_id] || 0) + Number(v.minutes || 0);
    }
    return dict;
  }, [matrix]);

  function setRange(kind: "week" | "month" | "ytd") {
    const now = new Date();
    if (kind === "week") {
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      const start = d;
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      setFrom(toYMD(start));
      setTo(toYMD(end));
    } else if (kind === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFrom(toYMD(start));
      setTo(toYMD(end));
    } else {
      const start = new Date(now.getFullYear(), 0, 1);
      setFrom(toYMD(start));
      setTo(toYMD(now));
    }
  }

  /* Rafraîchir matrice + fusionner avec les matières officielles de la classe + tri/numérotation */
  async function refreshMatrix() {
    if (!selectedClassId) {
      setMatrix(null);
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("class_id", selectedClassId);
      qs.set("type", rubrique);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);

      const [mat, subs] = await Promise.all([
        fetch("/api/admin/absences/matrix?" + qs.toString(), {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => null),
        fetch(`/api/class/subjects?class_id=${selectedClassId}`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => ({ items: [] })),
      ]);

      const payload: MatrixPayload =
        mat && mat.subjects && mat.students
          ? mat
          : { subjects: [], students: [], values: [], subjectDistinct: {} };

      // matières officielles de la classe
      const classSubjects: MatrixSubject[] = (subs.items || []).map((s: any) => ({
        id: s.id,
        name: (s.label || s.name || "").trim() || s.id,
      }));

      // fusion (garantit l’affichage des colonnes)
      const map = new Map<string, MatrixSubject>();
      for (const s of payload.subjects) map.set(s.id, s);
      for (const s of classSubjects) if (!map.has(s.id)) map.set(s.id, s);
      const mergedSubjects = Array.from(map.values()).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      // complete subjectDistinct (tooltips)
      const subjectDistinct: Record<string, number> = {
        ...(payload.subjectDistinct || {}),
      };
      for (const s of mergedSubjects)
        if (!(s.id in subjectDistinct)) subjectDistinct[s.id] = 0;

      // tri alphabétique + numérotation
      const sortedStudents = [...(payload.students || [])].sort((a, b) =>
        (a.full_name || "").localeCompare(b.full_name || "", undefined, {
          sensitivity: "base",
        })
      );
      const numberedStudents: MatrixStudent[] = sortedStudents.map((s, i) => ({
        ...s,
        rank: (s as any).rank ?? i + 1,
      }));

      setMatrix({
        subjects: mergedSubjects,
        students: numberedStudents,
        values: payload.values || [],
        subjectDistinct,
      });
    } catch {
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setFrom("");
    setTo("");
    setRubrique("absent");
    setSelectedLevel("");
    setSelectedClassId("");
    setSelectedAcademicYear("");
    setSelectedPeriodId("");
    setMatrix(null);
  }

  /* Totaux & éléments « chauds » (mise en évidence) */
  const subjectTotals = useMemo(() => {
    const m = new Map<string, number>();
    if (!matrix) return m;
    for (const v of matrix.values) {
      m.set(v.subject_id, (m.get(v.subject_id) || 0) + (v.minutes || 0));
    }
    return m;
  }, [matrix]);

  const studentTotals = useMemo(() => {
    const m = new Map<string, number>();
    if (!matrix) return m;
    for (const v of matrix.values) {
      m.set(v.student_id, (m.get(v.student_id) || 0) + (v.minutes || 0));
    }
    return m;
  }, [matrix]);

  function computeHotSet(m: Map<string, number>) {
    const vals = Array.from(m.values());
    if (!vals.length) return new Set<string>();
    const max = Math.max(...vals);
    if (max <= 0) return new Set<string>();
    const thr = Math.ceil(max * HOT_RATIO);
    const out = new Set<string>();
    for (const [id, total] of m) if (total >= thr) out.add(id);
    return out;
  }

  const hotSubjects = useMemo(() => computeHotSet(subjectTotals), [subjectTotals]);
  const hotStudents = useMemo(() => computeHotSet(studentTotals), [studentTotals]);

  /* Export CSV (UTF-16LE propre pour Excel) */
  function exportMatrixCsv() {
    if (!matrix) return;
    const sep = ";";
    const EOL = "\r\n";
    const lines: string[] = [];

    lines.push("sep=;");

    const head = ["N°", "Élève", ...matrix.subjects.map((s) => s.name), "Total"];
    lines.push(head.map(csvEscape).join(sep));

    for (const stu of matrix.students) {
      const row: string[] = [
        csvEscape(String(stu.rank ?? "")),
        csvEscape(stu.full_name),
      ];
      let tot = 0;
      for (const sub of matrix.subjects) {
        const min = matrixIndex[stu.id]?.[sub.id] || 0;
        tot += min;
        const cell =
          rubrique === "absent"
            ? min
              ? String((min / 60).toFixed(1)).replace(".", ",")
              : ""
            : min
            ? String(min)
            : "";
        row.push(csvEscape(cell));
      }
      const totalCell =
        rubrique === "absent"
          ? tot
            ? String((tot / 60).toFixed(1)).replace(".", ",")
            : ""
          : tot
          ? String(tot)
          : "";
      row.push(csvEscape(totalCell));
      lines.push(row.join(sep));
    }

    const csv = lines.join(EOL);
    downloadCsvUtf16LE(
      `matrice_${rubrique}_${from || "debut"}_${to || "fin"}.csv`,
      csv
    );
  }

  const hasClass = Boolean(selectedClassId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Matrice des absences
        </h1>
        <p className="text-sm text-slate-600">
          Filtre la période, l&apos;année scolaire, le niveau, la classe et la
          rubrique (absence/retard). Le tableau affiche les élèves en lignes et
          les disciplines en colonnes.
        </p>
      </div>

      {/* Filtres */}
      <Card
        title="Filtres"
        subtitle="Choisis d’abord l’année scolaire, puis éventuellement une période, puis le niveau et la classe. Les dates restent modifiables."
        actions={
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => setRange("week")}>
              <Calendar className="h-4 w-4" /> Semaine
            </GhostButton>
            <GhostButton onClick={() => setRange("month")}>
              <Calendar className="h-4 w-4" /> Mois
            </GhostButton>
            <GhostButton onClick={() => setRange("ytd")}>
              <Calendar className="h-4 w-4" /> Année à date
            </GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          {/* Année scolaire */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Année scolaire
            </div>
            <Select
              value={selectedAcademicYear}
              onChange={(e) => {
                const year = e.target.value;
                setSelectedAcademicYear(year);
                setSelectedPeriodId("");
              }}
              disabled={periodsLoading || academicYears.length === 0}
            >
              <option value="">
                {academicYears.length === 0
                  ? "Non configuré"
                  : "Toutes années…"}
              </option>
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>

          {/* Période */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Période (trimestre / séquence)
            </div>
            <Select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              disabled={periodsLoading || filteredPeriods.length === 0}
            >
              <option value="">
                {filteredPeriods.length === 0
                  ? "Aucune période"
                  : "Sélectionner…"}
              </option>
              {filteredPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label ||
                    p.short_label ||
                    p.code ||
                    `${p.start_date} → ${p.end_date}`}
                </option>
              ))}
            </Select>
          </div>

          {/* Niveau */}
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
            >
              <option value="">— Tous —</option>
              {levelsFromClasses.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>

          {/* Classe */}
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={!selectedLevel}
            >
              <option value="">— Choisir —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Rubrique */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Rubrique</div>
            <Select
              value={rubrique}
              onChange={(e) => setRubrique(e.target.value as any)}
            >
              <option value="absent">Absences (heures)</option>
              <option value="tardy">Retards (minutes)</option>
            </Select>
          </div>

          {/* Du */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          {/* Au */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={refreshMatrix} disabled={Boolean(loading || !selectedClassId)}>
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Filter className="h-4 w-4" />
            )}
            Actualiser
          </Button>
          <GhostButton onClick={resetAll}>Réinitialiser</GhostButton>
          <GhostButton
            onClick={exportMatrixCsv}
            disabled={!matrix}
          >
            <Download className="h-4 w-4" /> Export CSV
          </GhostButton>
        </div>
      </Card>

      {/* Matrice */}
      <Card
        title="Matrice — Élèves × Disciplines"
        subtitle={
          hasClass
            ? rubrique === "absent"
              ? "Valeurs en heures"
              : "Valeurs en minutes"
            : "Sélectionne une classe puis Actualiser"
        }
      >
        {!hasClass ? (
          <div className="text-sm text-slate-600">—</div>
        ) : loading && !matrix ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full animate-pulse rounded bg-slate-100"
              />
            ))}
          </div>
        ) : !matrix ? (
          <div className="text-sm text-slate-600">
            Aucune donnée pour la période/classe sélectionnée.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full rounded-xl border border-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <th className="w-12 px-2 py-2 text-left align-bottom">N°</th>
                  <th className="sticky left-0 z-20 px-3 py-2 text-left align-bottom bg-slate-100">
                    Élève
                  </th>
                  {matrix.subjects.map((subj) => {
                    const isHot = hotSubjects.has(subj.id);
                    return (
                      <th
                        key={subj.id}
                        className={[
                          "px-2 py-2 text-center align-bottom",
                          isHot
                            ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
                            : "",
                        ].join(" ")}
                        title={
                          isHot
                            ? "Discipline la plus concernée sur la période"
                            : undefined
                        }
                      >
                        <div className="mx-auto h-24 w-8 rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">
                          {subj.name}
                          {isHot ? " 🔥" : ""}
                        </div>
                      </th>
                    );
                  })}
                  {/* Colonne Total */}
                  <th className="px-2 py-2 text-center align-bottom">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.students.map((stu, rIdx) => {
                  const isHotRow = hotStudents.has(stu.id);
                  const totalMinutes = studentTotals.get(stu.id) || 0;
                  return (
                    <tr
                      key={stu.id}
                      className={[
                        "border-t hover:bg-slate-100",
                        isHotRow
                          ? "bg-amber-50"
                          : rIdx % 2
                          ? "bg-slate-50"
                          : "bg-white",
                      ].join(" ")}
                      title={
                        isHotRow
                          ? "Élève parmi les plus concernés sur la période"
                          : undefined
                      }
                    >
                      <td className="px-2 py-2 text-left tabular-nums">
                        {stu.rank ?? rIdx + 1}
                      </td>
                      <td
                        className={[
                          "sticky left-0 z-10 px-3 py-2",
                          isHotRow ? "bg-amber-50 font-medium" : "bg-inherit",
                        ].join(" ")}
                      >
                        {stu.full_name}
                      </td>
                      {matrix.subjects.map((subj, cIdx) => {
                        const minutes = matrixIndex[stu.id]?.[subj.id] || 0;
                        const tipCount = matrix.subjectDistinct[subj.id] ?? 0;
                        const zebraCol = cIdx % 2 ? "bg-slate-50/60" : "";
                        const isHotCol = hotSubjects.has(subj.id);
                        return (
                          <td
                            key={subj.id}
                            className={[
                              "px-2 py-2 text-center tabular-nums",
                              zebraCol,
                              isHotCol ? "bg-rose-50/70" : "",
                            ].join(" ")}
                            title={`${tipCount} élève(s) distinct(s) ${
                              rubrique === "absent"
                                ? "absent(s)"
                                : "en retard"
                            } en « ${subj.name} » sur la période`}
                          >
                            {rubrique === "absent"
                              ? hoursLabel(minutes)
                              : nf.format(minutes)}
                          </td>
                        );
                      })}
                      {/* Total par élève */}
                      <td
                        className="px-2 py-2 text-center tabular-nums font-semibold text-slate-900"
                        title="Somme sur toutes les disciplines de la période"
                      >
                        {rubrique === "absent"
                          ? hoursLabel(totalMinutes)
                          : nf.format(totalMinutes)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 text-[11px] text-slate-500">
              Survole une case pour voir le nombre d’élèves distincts concernés
              par la discipline. Les colonnes en rose et les lignes en jaune
              mettent en évidence les plus gros totaux de la période.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
