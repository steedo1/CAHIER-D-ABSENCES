// src/app/admin/absences/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* UI helpers */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")}
    />
  );
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={"w-full rounded-lg border bg-white px-3 py-2 text-sm " + (p.className ?? "")}
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        "rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " +
        (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")
      }
    />
  );
}
function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* Types */
type ClassItem = { id: string; name: string; level: string };
type LevelAgg = { level: string; absents: number; minutes: number };
type ClassAgg = { class_id: string; class_label: string; absents: number; minutes: number };
type StudentAbs = { student_id: string; full_name: string; minutes: number };

export default function AbsencesDashboard() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const [levelsAgg, setLevelsAgg] = useState<LevelAgg[]>([]);
  const [classesAgg, setClassesAgg] = useState<ClassAgg[]>([]);
  const [students, setStudents] = useState<StudentAbs[]>([]);
  const [subjects, setSubjects] = useState<{ name: string; absents: number }[]>([]);

  // charge la liste des classes (pour les listes déroulantes)
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAllClasses(j.items || []))
      .catch(() => setAllClasses([]));
  }, []);

  const levelsFromClasses = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) s.add((c.level || "").trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allClasses]);

  const classesOfLevel = useMemo(() => {
    if (!selectedLevel) return [];
    return allClasses
      .filter((c) => c.level === selectedLevel)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [allClasses, selectedLevel]);

  async function refreshAll() {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);

    // résumé par niveau
    const lv = await fetch("/api/admin/absences/levels?" + qs.toString(), { cache: "no-store" }).then((r) =>
      r.json()
    );
    setLevelsAgg(lv.items || []);

    if (selectedLevel) {
      // classes du niveau
      const qLevel = new URLSearchParams(qs);
      qLevel.set("level", selectedLevel);
      const cl = await fetch("/api/admin/absences/classes?" + qLevel.toString(), { cache: "no-store" }).then((r) =>
        r.json()
      );
      setClassesAgg(cl.items || []);

      // disciplines : si une classe est déjÃ  choisie, on filtre aussi par class_id
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

  // ré-initialiser la classe si on change de niveau
  useEffect(() => {
    setSelectedClassId("");
  }, [selectedLevel]);

  /* Helpers Export (CSV UNIQUEMENT) */
  const buildLevelCsvUrl = () => {
    if (!selectedLevel) return "#";
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("format", "csv");
    return `/api/admin/absences/export/level/${encodeURIComponent(selectedLevel)}?` + qs.toString();
    // plus de PDF ici
  };
  const buildClassCsvUrl = () => {
    if (!selectedClassId) return "#";
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("format", "csv");
    return `/api/admin/absences/export/class/${selectedClassId}?` + qs.toString();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Absences — Dashboard</h1>
        <p className="text-slate-600">
          Sélectionne une période, puis un niveau â†’ une classe. Vue élèves et disciplines. Export CSV.
        </p>
      </div>

      {/* Filtres */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}>
              <option value="">— Sélectionner un niveau —</option>
              {levelsFromClasses.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={!selectedLevel}
            >
              <option value="">— Sélectionner une classe —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={refreshAll}>Actualiser</Button>
          <button onClick={resetAll} className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50">
            Réinitialiser
          </button>
        </div>
      </div>

      {/* Carte NIVEAU / CLASSES */}
      <Card
        title={selectedLevel ? `CLASSES — niveau ${selectedLevel}` : "RÃ‰SUMÃ‰ PAR NIVEAU (période)"}
        actions={
          selectedLevel ? (
            <a
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50"
              href={buildLevelCsvUrl()}
              target="_blank"
              rel="noreferrer"
            >
              Exporter niveau (CSV)
            </a>
          ) : null
        }
      >
        {!selectedLevel ? (
          levelsAgg.length === 0 ? (
            <div className="text-sm text-slate-600">Aucune donnée pour la période.</div>
          ) : (
            <ul className="divide-y">
              {levelsAgg.map((l) => (
                <li
                  key={l.level}
                  className="flex cursor-pointer items-center justify-between py-2 text-slate-700 hover:text-emerald-700"
                  onClick={() => setSelectedLevel(l.level)}
                >
                  <span>{l.level}</span>
                  <span className="text-sm">
                    {l.absents} élève(s) — {Math.floor(l.minutes / 60)}h {l.minutes % 60}min
                  </span>
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
                className={
                  "flex cursor-pointer items-center justify-between py-2 " +
                  (selectedClassId === c.class_id
                    ? "font-semibold text-emerald-700"
                    : "text-slate-700 hover:text-emerald-700")
                }
                onClick={() => setSelectedClassId(c.class_id)}
              >
                <span>{c.class_label}</span>
                <span className="text-sm">
                  {c.absents} élève(s) — {Math.floor(c.minutes / 60)}h {c.minutes % 60}min
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title={
            selectedClassId
              ? "DISCIPLINES (CLASSE SÃ‰LECTIONNÃ‰E)"
              : selectedLevel
              ? "DISCIPLINES (NIVEAU SÃ‰LECTIONNÃ‰)"
              : "DISCIPLINES"
          }
        >
          {subjects.length === 0 ? (
            <div className="text-sm text-slate-600">—</div>
          ) : (
            <ul className="divide-y">
              {subjects.map((s) => (
                <li key={s.name} className="flex items-center justify-between py-2">
                  <span>{s.name}</span>
                  <span className="text-sm">{s.absents}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Ã‰LÃˆVES (SÃ‰LECTIONNE UNE CLASSE)"
          actions={
            selectedClassId ? (
              <a
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50"
                href={buildClassCsvUrl()}
                target="_blank"
                rel="noreferrer"
              >
                Exporter classe (CSV)
              </a>
            ) : null
          }
        >
          {!selectedClassId ? (
            <div className="text-sm text-slate-600">—</div>
          ) : students.length === 0 ? (
            <div className="text-sm text-slate-600">Aucune absence dans cette classe pour la période.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Ã‰lève</th>
                    <th className="px-3 py-2 text-left">Heures d’absence</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s: any) => (
                    <tr key={s.student_id} className="border-t">
                      <td className="px-3 py-2">{s.full_name}</td>
                      <td className="px-3 py-2">
                        {Math.floor(s.minutes / 60)} h {s.minutes % 60} min
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}


