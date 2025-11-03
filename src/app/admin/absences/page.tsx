// src/app/admin/absences/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Download,
  RefreshCw,
  Filter,
  Users,
  Clock,
  School,
  Layers,
  ChevronRight,
} from "lucide-react";

/* ───────────────── UI helpers ───────────────── */
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
        p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition",
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
          {subtitle ? (
            <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
      {children}
    </span>
  );
}
function Stat({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          {loading ? (
            <div className="mt-1 h-6 w-24 animate-pulse rounded bg-slate-100" />
          ) : (
            <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</div>
          )}
          {hint ? <div className="text-[11px] text-slate-500 mt-1">{hint}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────── Types ───────────────── */
type ClassItem = { id: string; name: string; level: string };
type LevelAgg = { level: string; absents: number; minutes: number };
type ClassAgg = { class_id: string; class_label: string; absents: number; minutes: number };
type SubjectAgg = { name: string; absents: number };

/** Étudiants — compat: accepte l'ancien schéma (minutes) et le nouveau (minutes_abs / minutes_tardy). */
type StudentAbs = {
  student_id: string;
  full_name: string;
  minutes?: number | null;         // legacy (total)
  minutes_abs?: number | null;     // nouveau: minutes d'absence
  minutes_tardy?: number | null;   // nouveau: minutes de retard
  tardy_minutes?: number | null;   // alias éventuel
};

/* ───────────────── Helpers ───────────────── */
const nf = new Intl.NumberFormat("fr-FR");
const fmtHM = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${Math.abs(minutes % 60)}min`;
function fmtUnitsFR(units: number) {
  const r = Math.round(units * 100) / 100;
  const s = r.toFixed(2).replace(".", ",");
  return s.replace(/,00$/, "").replace(/,(\d)0$/, ",$1");
}
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function SparkBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-32 rounded bg-slate-100 overflow-hidden" aria-hidden>
      <div
        className="h-2 bg-emerald-500"
        style={{ width: `${Math.min(100, pct)}%` }}
        title={`${pct}%`}
      />
    </div>
  );
}

/* ───────────────── Component ───────────────── */
export default function AbsencesDashboard() {
  // Filtres
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Sélections
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  // Données
  const [levelsAgg, setLevelsAgg] = useState<LevelAgg[]>([]);
  const [classesAgg, setClassesAgg] = useState<ClassAgg[]>([]);
  const [students, setStudents] = useState<StudentAbs[]>([]);
  const [subjects, setSubjects] = useState<SubjectAgg[]>([]);

  // UI state
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAllClasses(j.items || []))
      .catch(() => setAllClasses([]));
  }, []);

  const levelsFromClasses = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add((c.level || "").trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allClasses]);

  const classesOfLevel = useMemo(() => {
    if (!selectedLevel) return [];
    return allClasses
      .filter((c) => c.level === selectedLevel)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [allClasses, selectedLevel]);

  const kpi = useMemo(() => {
    const totalMinutes =
      selectedLevel
        ? classesAgg.reduce((acc, x) => acc + (Number(x.minutes) || 0), 0)
        : levelsAgg.reduce((acc, x) => acc + (Number(x.minutes) || 0), 0);
    const totalHours = (totalMinutes / 60) || 0;
    const classesCount = selectedLevel ? classesAgg.length : 0;
    const levelsCount = selectedLevel ? 1 : levelsAgg.length;
    const studentsCount = selectedClassId ? students.length : 0;
    return { totalHours, classesCount, levelsCount, studentsCount };
  }, [levelsAgg, classesAgg, students, selectedLevel, selectedClassId]);

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

  async function refreshAll() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);

    try {
      const lv = await fetch("/api/admin/absences/levels?" + qs.toString(), { cache: "no-store" }).then((r) => r.json());
      setLevelsAgg(lv.items || []);

      if (selectedLevel) {
        const qLevel = new URLSearchParams(qs);
        qLevel.set("level", selectedLevel);
        const cl = await fetch("/api/admin/absences/classes?" + qLevel.toString(), { cache: "no-store" }).then((r) =>
          r.json()
        );
        setClassesAgg(cl.items || []);

        const qSub = new URLSearchParams(qLevel);
        if (selectedClassId) qSub.set("class_id", selectedClassId);
        const sb = await fetch("/api/admin/absences/subjects?" + qSub.toString(), { cache: "no-store" }).then((r) =>
          r.json()
        );
        setSubjects(sb.items || []);
      } else {
        setClassesAgg([]);
        setSubjects([]);
      }

      if (selectedClassId) {
        const q3 = new URLSearchParams(qs);
        q3.set("class_id", selectedClassId);
        const st = await fetch("/api/admin/absences/by-class?" + q3.toString(), { cache: "no-store" }).then((r) =>
          r.json()
        );
        setStudents(st.items || []);
      } else {
        setStudents([]);
      }
    } catch {
      setLevelsAgg([]);
      setClassesAgg([]);
      setSubjects([]);
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setFrom("");
    setTo("");
    setSelectedLevel("");
    setSelectedClassId("");
    setLevelsAgg([]);
    setClassesAgg([]);
    setStudents([]);
    setSubjects([]);
  }

  useEffect(() => {
    setSelectedClassId("");
  }, [selectedLevel]);

  const buildLevelCsvUrl = () => {
    if (!selectedLevel) return "#";
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("format", "csv");
    return `/api/admin/absences/export/level/${encodeURIComponent(selectedLevel)}?` + qs.toString();
  };
  const buildClassCsvUrl = () => {
    if (!selectedClassId) return "#";
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("format", "csv");
    return `/api/admin/absences/export/class/${selectedClassId}?` + qs.toString();
  };

  const maxLevelMinutes = useMemo(
    () => Math.max(0, ...levelsAgg.map((x) => Number(x.minutes || 0))),
    [levelsAgg]
  );
  const maxClassMinutes = useMemo(
    () => Math.max(0, ...classesAgg.map((x) => Number(x.minutes || 0))),
    [classesAgg]
  );
  const maxSubjectAbs = useMemo(() => Math.max(0, ...subjects.map((x) => Number(x.absents || 0))), [subjects]);

  const hasLevel = !!selectedLevel;
  const hasClass = !!selectedClassId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">Absences — Tableau de bord</h1>
        <p className="text-slate-600">
          Analyse par période, niveau, classe et discipline. Exporte les vues en CSV pour partage.
        </p>
      </div>

      {/* Filtres */}
      <Card
        title="Filtres"
        subtitle="Choisis une période, puis un niveau (et une classe) pour détailler."
        actions={
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => setRange("week")}><Calendar className="h-4 w-4" /> Semaine</GhostButton>
            <GhostButton onClick={() => setRange("month")}><Calendar className="h-4 w-4" /> Mois</GhostButton>
            <GhostButton onClick={() => setRange("ytd")}><Calendar className="h-4 w-4" /> Année à date</GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}>
              <option value="">— Tous —</option>
              {levelsFromClasses.map((l) => (
                <option key={l} value={l}>{l}</option>
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
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={refreshAll} disabled={loading}>
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />} Actualiser
          </Button>
          <GhostButton onClick={resetAll}>Réinitialiser</GhostButton>
          {from || to ? <Badge><Calendar className="h-3.5 w-3.5 mr-1" /> {from || "…"} <ChevronRight className="mx-1 h-3 w-3" /> {to || "…"} </Badge> : null}
          {hasLevel ? <Badge><School className="h-3.5 w-3.5 mr-1" /> {selectedLevel}</Badge> : null}
          {hasClass ? <Badge><Layers className="h-3.5 w-3.5 mr-1" /> Classe sélectionnée</Badge> : null}
        </div>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<School className="h-5 w-5" />} label="Niveaux concernés" value={nf.format(kpi.levelsCount)} loading={loading && !hasLevel && levelsAgg.length === 0} />
        <Stat icon={<Layers className="h-5 w-5" />} label="Classes concernées" value={hasLevel ? nf.format(kpi.classesCount) : "—"} hint={!hasLevel ? "Sélectionne un niveau" : undefined} loading={loading && hasLevel && classesAgg.length === 0} />
        <Stat icon={<Users className="h-5 w-5" />} label="Élèves listés" value={hasClass ? nf.format(kpi.studentsCount) : "—"} hint={!hasClass ? "Sélectionne une classe" : undefined} loading={loading && hasClass && students.length === 0} />
        <Stat icon={<Clock className="h-5 w-5" />} label="Heures cumulées" value={fmtUnitsFR(kpi.totalHours)} loading={loading} />
      </div>

      {/* ───────── Carte NIVEAUX / CLASSES ───────── */}
      <Card
        title={hasLevel ? `Classes — niveau ${selectedLevel}` : "Résumé par niveau (période)"}
        actions={
          hasLevel ? (
            <a
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50"
              href={buildLevelCsvUrl()}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-4 w-4" /> Export niveau (CSV)
            </a>
          ) : null
        }
      >
        {!hasLevel ? (
          levelsAgg.length === 0 ? (
            <div className="text-sm text-slate-600">Aucune donnée pour la période.</div>
          ) : (
            <ul className="divide-y">
              {levelsAgg.map((l) => (
                <li
                  key={l.level}
                  className="flex items-center justify-between gap-3 py-2 text-slate-800 hover:text-emerald-700 cursor-pointer"
                  onClick={() => setSelectedLevel(l.level)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-28 font-medium">{l.level}</div>
                    <SparkBar value={Number(l.minutes || 0)} max={maxLevelMinutes} />
                  </div>
                  <div className="text-sm tabular-nums">
                    {l.absents} élève(s) • {fmtHM(Number(l.minutes || 0))}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : classesAgg.length === 0 ? (
          <div className="text-sm text-slate-600">Aucune absence pour {selectedLevel} sur la période.</div>
        ) : (
          <ul className="divide-y">
            {classesAgg.map((c) => (
              <li
                key={c.class_id}
                className={[
                  "flex items-center justify-between gap-3 py-2 cursor-pointer",
                  selectedClassId === c.class_id
                    ? "font-semibold text-emerald-700"
                    : "text-slate-800 hover:text-emerald-700",
                ].join(" ")}
                onClick={() => setSelectedClassId(c.class_id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-28">{c.class_label}</div>
                  <SparkBar value={Number(c.minutes || 0)} max={maxClassMinutes} />
                </div>
                <div className="text-sm tabular-nums">
                  {c.absents} élève(s) • {fmtHM(Number(c.minutes || 0))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* DISCIPLINES & ÉLÈVES */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Disciplines */}
        <Card
          title={hasClass ? "Disciplines — classe sélectionnée" : hasLevel ? "Disciplines — niveau sélectionné" : "Disciplines"}
          subtitle="Nombre d’élèves concernés par discipline"
        >
          {subjects.length === 0 ? (
            <div className="text-sm text-slate-600">—</div>
          ) : (
            <ul className="divide-y">
              {subjects.map((s) => (
                <li key={s.name} className="flex items-center justify-between py-2">
                  <span className="text-slate-800">{s.name}</span>
                  <span className="text-sm tabular-nums">{nf.format(s.absents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Élèves — 2 colonnes distinctes */}
        <Card
          title="Élèves"
          subtitle={hasClass ? "Absences vs Retards pour la classe sélectionnée" : "Sélectionne une classe pour voir les élèves"}
          actions={
            hasClass ? (
              <a
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50"
                href={buildClassCsvUrl()}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="h-4 w-4" /> Export classe (CSV)
              </a>
            ) : null
          }
        >
          {!hasClass ? (
            <div className="text-sm text-slate-600">—</div>
          ) : loading && students.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : students.length === 0 ? (
            <div className="text-sm text-slate-600">Aucune absence pour cette classe sur la période.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Élève</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Heures d’absence</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">Retards (min)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.map((s) => {
                    const minutesAbs = Number(s.minutes_abs ?? s.minutes ?? 0);
                    const minutesTardy = Number(s.minutes_tardy ?? s.tardy_minutes ?? 0);
                    return (
                      <tr key={s.student_id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">{s.full_name}</td>
                        <td className="px-3 py-2">{fmtHM(minutesAbs)}</td>
                        <td className="px-3 py-2 tabular-nums">{nf.format(minutesTardy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
