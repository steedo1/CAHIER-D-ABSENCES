// src/app/admin/conduite/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/* UI helpers */
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={
        "w-full rounded-lg border bg-white px-3 py-2 text-sm " +
        (p.className ?? "")
      }
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
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")}
    />
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────
   Helpers noms/prénoms
────────────────────────────────────────── */
function splitNomPrenoms(full: string) {
  const s = (full ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { nom: "", prenoms: "" };
  if (s.includes(",")) {
    const [prenoms, nom] = s.split(",").map((x) => x.trim());
    return { nom: nom ?? "", prenoms: prenoms ?? "" };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { nom: s, prenoms: "" };
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  const isUpper = /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ\-']+$/.test(last);
  if (parts.length === 2 || isUpper) return { nom: last, prenoms: rest };
  return { nom: last, prenoms: rest };
}
function nomPrenom(full: string) {
  const { nom, prenoms } = splitNomPrenoms(full);
  return `${nom} ${prenoms}`.trim();
}
function nomKey(full: string) {
  const { nom } = splitNomPrenoms(full);
  return (nom || "").trim();
}

/* Types */
type ClassItem = { id: string; name: string; level: string };
type ConductItem = {
  student_id: string;
  full_name: string;
  breakdown: {
    assiduite: number;
    tenue: number;
    moralite: number;
    discipline: number;
  };
  total: number;
  appreciation: string;
};

type ConductSettings = {
  assiduite_max: number;
  tenue_max: number;
  moralite_max: number;
  discipline_max: number;
};

/* Périodes de bulletin (année scolaire + trimestre / période) */
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

export default function ConduitePage() {
  // classes et filtres
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [level, setLevel] = useState("");
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Année scolaire sélectionnée + année "courante" renvoyée par l'API
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>("");
  const [currentAcademicYear, setCurrentAcademicYear] = useState<string>("");

  // périodes bulletin (année scolaire + trimestre, etc.)
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [selectedPeriodCode, setSelectedPeriodCode] = useState("");

  // données
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ConductItem[]>([]);
  const [classLabel, setClassLabel] = useState<string>("");

  // réglages de conduite (max par rubrique)
  const [conductSettings, setConductSettings] =
    useState<ConductSettings | null>(null);

  /* ───────── Chargement classes ───────── */
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAllClasses(j.items || []))
      .catch(() => setAllClasses([]));
  }, []);

  /* ───────── Chargement réglages conduite ───────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/conduct/settings", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = await res.json();
        setConductSettings({
          assiduite_max: Number(j.assiduite_max ?? 0),
          tenue_max: Number(j.tenue_max ?? 0),
          moralite_max: Number(j.moralite_max ?? 0),
          discipline_max: Number(j.discipline_max ?? 0),
        });
      } catch {
        // on garde les valeurs par défaut si ça échoue
      }
    })();
  }, []);

  /* ───────── Chargement périodes pour une année scolaire ───────── */
  async function loadPeriods(academicYearOverride?: string) {
    setLoadingPeriods(true);
    setPeriodError(null);
    try {
      const params = new URLSearchParams();
      const year = academicYearOverride || selectedAcademicYear;
      if (year) {
        params.set("academic_year", year);
      }
      const url =
        "/api/admin/institution/grading-periods" +
        (params.size ? `?${params.toString()}` : "");

      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(
          j?.error || "Échec du chargement des périodes d'évaluation.",
        );
      }

      const apiYear = (j.academic_year || "").trim();
      if (apiYear) {
        // on mémorise l'année courante renvoyée par l'API
        setCurrentAcademicYear((prev) => prev || apiYear);
        setSelectedAcademicYear(apiYear);
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

      mapped.sort((a, b) => a.order_index - b.order_index);
      setPeriods(mapped);
    } catch (e: any) {
      setPeriodError(
        e?.message ||
          "Impossible de charger les périodes d'évaluation. Vérifiez les paramètres.",
      );
      setPeriods([]);
    } finally {
      setLoadingPeriods(false);
    }
  }

  // premier chargement : année scolaire "courante"
  useEffect(() => {
    loadPeriods().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── Liste des niveaux ───────── */
  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add(c.level);
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [allClasses]);

  const classesOfLevel = useMemo(
    () =>
      allClasses
        .filter((c) => !level || c.level === level)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        ),
    [allClasses, level],
  );

  useEffect(() => {
    setClassId("");
  }, [level]);

  /* ───────── Options d'années scolaires (fenêtre autour de l'année courante) ───────── */
  const academicYearOptions = useMemo(() => {
    const base = selectedAcademicYear || currentAcademicYear;
    if (!base) return [];
    const m = /^(\d{4})-(\d{4})$/.exec(base);
    if (!m) return [base];

    const start = parseInt(m[1], 10);
    if (!Number.isFinite(start)) return [base];

    // ex : si base = 2025-2026 → on propose 2022-2023, 2023-2024, 2024-2025, 2025-2026, 2026-2027
    const years: string[] = [];
    for (let y = start - 3; y <= start + 1; y++) {
      years.push(`${y}-${y + 1}`);
    }

    // on met l'année la plus récente en premier
    return Array.from(new Set(years)).sort().reverse();
  }, [selectedAcademicYear, currentAcademicYear]);

  /* ───────── Changement d'année scolaire ───────── */
  async function handleAcademicYearChange(
    e: React.ChangeEvent<HTMLSelectElement>,
  ) {
    const year = e.target.value;
    setSelectedAcademicYear(year);
    setSelectedPeriodCode("");
    setFrom("");
    setTo("");
    if (year) {
      await loadPeriods(year);
    } else {
      // si vide (théoriquement on ne devrait pas le faire), on recharge l'année courante
      await loadPeriods();
    }
  }

  /* ───────── Changement de période bulletin → applique automatiquement Du / Au ───────── */
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

  // bouton "Appliquer une période" (prend la période active si rien choisi)
  function applyCurrentPeriodToDates() {
    if (!periods.length) {
      setPeriodError(
        "Aucune période d'évaluation n'est définie pour l'établissement.",
      );
      return;
    }
    const per =
      periods.find((p) => p.code === selectedPeriodCode) ||
      periods.find((p) => p.is_active) ||
      periods[0];
    if (!per) return;
    setSelectedPeriodCode(per.code);
    if (per.start_date) setFrom(per.start_date);
    if (per.end_date) setTo(per.end_date);
  }

  /* ───────── Chargement des moyennes de conduite ───────── */
  async function validate() {
    if (!classId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ class_id: classId });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(
        `/api/admin/conduite/averages?${qs.toString()}`,
        { cache: "no-store" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setItems(j.items || []);
      setClassLabel(j.class_label || "");
    } catch {
      setItems([]);
      setClassLabel("");
    } finally {
      setLoading(false);
    }
  }

  /* Tri alphabétique (A → Z) sur le NOM */
  const sortedItems = useMemo(() => {
    const coll = new Intl.Collator("fr", {
      sensitivity: "base",
      ignorePunctuation: true,
    });
    const list = [...items];
    list.sort((a, b) => {
      const ak = nomKey(a.full_name);
      const bk = nomKey(b.full_name);
      const byNom = coll.compare(ak, bk);
      if (byNom !== 0) return byNom;
      return coll.compare(nomPrenom(a.full_name), nomPrenom(b.full_name));
    });
    return list;
  }, [items]);

  // Max par rubrique + total (pour les libellés)
  const maxes = useMemo(() => {
    const ass =
      conductSettings?.assiduite_max ?? 6; // fallback sur les anciens défauts
    const ten = conductSettings?.tenue_max ?? 3;
    const mor = conductSettings?.moralite_max ?? 4;
    const dis = conductSettings?.discipline_max ?? 7;
    const total = ass + ten + mor + dis;
    return { ass, ten, mor, dis, total };
  }, [conductSettings]);

  // Export CSV
  async function exportCSV() {
    if (!classId || sortedItems.length === 0) return;
    const qs = new URLSearchParams({ class_id: classId, format: "csv" });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);

    const res = await fetch(`/api/admin/conduite/averages?${qs.toString()}`, {
      cache: "no-store",
      headers: { Accept: "text/csv" },
    });
    const blob = await res.blob();
    let filename = "conduite.csv";
    const dispo = res.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(dispo);
    if (m) {
      filename = decodeURIComponent(m[1] || m[2] || filename);
    } else {
      const safeLabel = (classLabel || "classe").replace(
        /[^\p{L}\p{N}_-]+/gu,
        "_",
      );
      const range =
        from && to
          ? `${from}_au_${to}`
          : from
            ? `depuis_${from}`
            : to
              ? `jusqua_${to}`
              : "toutes_dates";
      filename = `conduite_${safeLabel}_${range}.csv`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conduite — Moyennes par élève</h1>
        <p className="text-slate-600">
          Sélectionne un <b>niveau</b>, une <b>classe</b>, une{" "}
          <b>année scolaire</b> et une <b>période d&apos;évaluation</b> (trimestre,
          séquence, etc.), puis <i>Valider</i>. Les retraits automatiques sont
          appliqués.
        </p>
      </div>

      <Card title="Filtres">
        {/* Ligne 1 : dates + niveau + classe */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
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
          <div>
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
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">— Sélectionner un niveau —</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={!level}
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

        {/* Ligne 2 : année scolaire + période bulletin */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Année scolaire</div>
            <Select
              value={selectedAcademicYear}
              onChange={handleAcademicYearChange}
              disabled={loadingPeriods || academicYearOptions.length === 0}
            >
              {academicYearOptions.length === 0 ? (
                <option value="">— Année scolaire non disponible —</option>
              ) : (
                academicYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))
              )}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              Choisis l&apos;année scolaire pour laquelle tu veux voir les
              périodes (trimestres, séquences…).
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">
              Période d&apos;évaluation (trimestre / séquence)
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
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.short_label || p.label}
                  </option>
                ))}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              En choisissant une période (par ex.{" "}
              <i>2024-2025 — Trimestre 1</i>), les dates <b>Du</b> et <b>Au</b>{" "}
              sont réglées automatiquement.
            </div>
          </div>

          <div className="md:col-span-2 flex items-end">
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={applyCurrentPeriodToDates}
                disabled={loadingPeriods || periods.length === 0}
              >
                Appliquer la période
              </Button>
              <Button
                type="button"
                onClick={() =>
                  loadPeriods(
                    selectedAcademicYear || currentAcademicYear || undefined,
                  )
                }
                disabled={loadingPeriods}
              >
                {loadingPeriods ? "…" : "Rafraîchir"}
              </Button>
            </div>
          </div>
        </div>

        {periodError && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {periodError}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button onClick={validate} disabled={!classId || loading}>
            {loading ? "…" : "Valider"}
          </Button>
          <Button
            onClick={exportCSV}
            disabled={!classId || loading || sortedItems.length === 0}
          >
            Exporter CSV
          </Button>
        </div>
      </Card>

      <Card title={classLabel ? `Classe — ${classLabel}` : "Résultats"}>
        {!classId ? (
          <div className="text-sm text-slate-600">—</div>
        ) : sortedItems.length === 0 ? (
          <div className="text-sm text-slate-600">
            {loading ? "Chargement…" : "Aucune donnée."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Élève (tri par NOM)</th>
                  <th className="px-3 py-2 text-left">
                    Assiduité (/{maxes.ass})
                  </th>
                  <th className="px-3 py-2 text-left">
                    Tenue (/{maxes.ten})
                  </th>
                  <th className="px-3 py-2 text-left">
                    Moralité (/{maxes.mor})
                  </th>
                  <th className="px-3 py-2 text-left">
                    Discipline (/{maxes.dis})
                  </th>
                  <th className="px-3 py-2 text-left">
                    Moyenne (/{maxes.total})
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((it) => (
                  <tr key={it.student_id} className="border-t">
                    <td className="px-3 py-2">{nomPrenom(it.full_name)}</td>
                    <td className="px-3 py-2">
                      {it.breakdown.assiduite.toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-3 py-2">
                      {it.breakdown.tenue.toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-3 py-2">
                      {it.breakdown.moralite.toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-3 py-2">
                      {it.breakdown.discipline.toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-3 py-2 font-semibold">
                      {it.total.toFixed(2).replace(".", ",")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
