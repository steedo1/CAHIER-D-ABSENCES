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
        "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow " +
        (p.disabled ? "opacity-60 " : "hover:bg-emerald-700 transition ") +
        (p.className ?? "")
      }
    />
  );
}

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={
        "w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")
      }
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

function fmtNote(n: number | null | undefined) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0,00";
  return v.toFixed(2).replace(".", ",");
}

function parseFrenchNumber(v: string) {
  const n = Number(String(v || "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: any) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function formatDateFrSafe(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR");
}

function generatedAtLabel() {
  try {
    return new Date().toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date().toLocaleString("fr-FR");
  }
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
  calculated_total?: number | null;
  override_total?: number | null;
  is_overridden?: boolean;
  override_updated_at?: string | null;
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


function normalizePeriodText(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function printablePeriodLabel(period: GradePeriod | null | undefined) {
  if (!period) return "";

  const raw =
    String(period.short_label || "").trim() ||
    String(period.label || "").trim() ||
    String(period.code || "").trim();

  if (!raw) return "";

  const normalized = normalizePeriodText(raw);
  const combined = normalizePeriodText(
    `${period.code || ""} ${period.label || ""} ${period.short_label || ""}`,
  );

  const numberMatch =
    combined.match(/\b(?:trim(?:estre)?|trimestre|t)\s*0?([123])\b/i) ||
    combined.match(/\b0?([123])(?:er|e|eme|ème|nd)?\s*(?:trim(?:estre)?|trimestre)\b/i) ||
    combined.match(/\bt0?([123])\b/i);

  if (numberMatch?.[1]) {
    const n = Number(numberMatch[1]);
    if (n === 1) return "1ER TRIMESTRE";
    if (n === 2) return "2E TRIMESTRE";
    if (n === 3) return "3E TRIMESTRE";
  }

  if (
    normalized.includes("premier trimestre") ||
    normalized.includes("1er trimestre") ||
    normalized.includes("1e trimestre")
  ) {
    return "1ER TRIMESTRE";
  }

  if (
    normalized.includes("deuxieme trimestre") ||
    normalized.includes("second trimestre") ||
    normalized.includes("2e trimestre")
  ) {
    return "2E TRIMESTRE";
  }

  if (
    normalized.includes("troisieme trimestre") ||
    normalized.includes("3e trimestre")
  ) {
    return "3E TRIMESTRE";
  }

  return raw.toUpperCase();
}

function sameYMD(a: string | null | undefined, b: string | null | undefined) {
  const aa = String(a || "").slice(0, 10);
  const bb = String(b || "").slice(0, 10);
  return !!aa && !!bb && aa === bb;
}

function findMatchingPeriodByDates(
  periods: GradePeriod[],
  from: string,
  to: string,
) {
  if (!from || !to) return null;

  return (
    periods.find(
      (p) => sameYMD(p.start_date, from) && sameYMD(p.end_date, to),
    ) || null
  );
}

type InstitutionSettings = {
  institution_name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_code?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  settings_json?: any;
};

const BRAND_COMPANY = "Nexa Digital SARL";
const BRAND_SITE = "www.mon-cahier.com";

function normalizeInstitutionSettings(json: any): InstitutionSettings {
  const raw = json?.institution || json?.settings || json?.item || json || {};
  const settingsJson = raw?.settings_json || {};

  return {
    ...settingsJson,
    ...raw,
    institution_name:
      raw?.institution_name ||
      raw?.name ||
      settingsJson?.institution_name ||
      settingsJson?.name ||
      null,
    institution_logo_url:
      raw?.institution_logo_url ||
      raw?.logo_url ||
      settingsJson?.institution_logo_url ||
      settingsJson?.logo_url ||
      null,
    institution_phone:
      raw?.institution_phone ||
      raw?.phone ||
      settingsJson?.institution_phone ||
      settingsJson?.phone ||
      null,
    institution_email:
      raw?.institution_email ||
      raw?.email ||
      settingsJson?.institution_email ||
      settingsJson?.email ||
      null,
    institution_region:
      raw?.institution_region ||
      raw?.region ||
      settingsJson?.institution_region ||
      settingsJson?.region ||
      null,
    institution_postal_address:
      raw?.institution_postal_address ||
      raw?.postal_address ||
      raw?.address ||
      settingsJson?.institution_postal_address ||
      settingsJson?.postal_address ||
      settingsJson?.address ||
      null,
    institution_status:
      raw?.institution_status ||
      raw?.status ||
      settingsJson?.institution_status ||
      settingsJson?.status ||
      null,
    institution_code:
      raw?.institution_code ||
      raw?.code ||
      settingsJson?.institution_code ||
      settingsJson?.code ||
      null,
  };
}

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

  // Identité établissement pour l'export PDF
  const [institution, setInstitution] = useState<InstitutionSettings | null>(
    null,
  );

  // Modification officielle de la moyenne finale
  const [editingItem, setEditingItem] = useState<ConductItem | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  /* ───────── Récupération identité établissement pour PDF ───────── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    (async () => {
      try {
        const body: any = document.body;
        const fromData =
          body?.dataset?.institutionName || body?.dataset?.institution || null;

        const fromGlobal = (window as any).__MC_INSTITUTION_NAME__
          ? String((window as any).__MC_INSTITUTION_NAME__)
          : null;

        const finalName = fromData || fromGlobal;

        if (finalName && !cancelled) {
          setInstitution((prev) => ({
            ...(prev || {}),
            institution_name: finalName,
          }));
        }

        try {
          const r = await fetch("/api/admin/institution/settings", {
            cache: "no-store",
          });
          const j = await r.json().catch(() => ({}));

          if (!cancelled && r.ok) {
            const normalized = normalizeInstitutionSettings(j);
            setInstitution((prev) => ({
              ...(prev || {}),
              ...normalized,
              institution_name:
                normalized.institution_name ||
                prev?.institution_name ||
                finalName ||
                null,
            }));
          }
        } catch {
          // silencieux, pas bloquant
        }
      } catch {
        // silencieux
      }
    })();

    return () => {
      cancelled = true;
    };
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
    setItems([]);
    setClassLabel("");
  }, [level]);

  /* ───────── Options d'années scolaires ───────── */
  const academicYearOptions = useMemo(() => {
    const base = selectedAcademicYear || currentAcademicYear;
    if (!base) return [];
    const m = /^(\d{4})-(\d{4})$/.exec(base);
    if (!m) return [base];

    const start = parseInt(m[1], 10);
    if (!Number.isFinite(start)) return [base];

    const years: string[] = [];
    for (let y = start - 3; y <= start + 1; y++) {
      years.push(`${y}-${y + 1}`);
    }

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
    setItems([]);
    setClassLabel("");
    setNotice(null);
    if (year) {
      await loadPeriods(year);
    } else {
      await loadPeriods();
    }
  }

  /* ───────── Changement de période bulletin → applique automatiquement Du / Au ───────── */
  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value;
    setSelectedPeriodCode(code);
    setItems([]);
    setClassLabel("");
    setNotice(null);
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
    setItems([]);
    setClassLabel("");
    setNotice(null);
  }

  // Max par rubrique + total (pour les libellés)
  const maxes = useMemo(() => {
    const ass = conductSettings?.assiduite_max ?? 6;
    const ten = conductSettings?.tenue_max ?? 3;
    const mor = conductSettings?.moralite_max ?? 4;
    const dis = conductSettings?.discipline_max ?? 7;
    const total = ass + ten + mor + dis;
    return { ass, ten, mor, dis, total };
  }, [conductSettings]);

  const canEditOfficialAverage = useMemo(
    () => !!classId && !!selectedAcademicYear && !!selectedPeriodCode,
    [classId, selectedAcademicYear, selectedPeriodCode],
  );

  function buildAveragesQuery(extra?: Record<string, string>) {
    const qs = new URLSearchParams({ class_id: classId });

    if (from) qs.set("from", from);
    if (to) qs.set("to", to);

    // Indispensable pour rattacher les corrections à T1 / T2 / T3.
    if (selectedAcademicYear) qs.set("academic_year", selectedAcademicYear);
    if (selectedPeriodCode) qs.set("period_code", selectedPeriodCode);

    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined && v !== null && v !== "") qs.set(k, v);
      }
    }

    return qs;
  }

  /* ───────── Chargement des moyennes de conduite ───────── */
  async function validate() {
    if (!classId) return;
    setLoading(true);
    setNotice(null);
    try {
      const qs = buildAveragesQuery();
      const r = await fetch(`/api/admin/conduite/averages?${qs.toString()}`, {
        cache: "no-store",
      });
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

  function openEditModal(item: ConductItem) {
    if (!canEditOfficialAverage) {
      setNotice(
        "Sélectionne d'abord une année scolaire et une période précise avant de modifier une moyenne officielle.",
      );
      return;
    }

    setEditingItem(item);
    setEditValue(fmtNote(item.total));
    setOverrideError(null);
    setNotice(null);
  }

  function closeEditModal() {
    if (savingOverride) return;
    setEditingItem(null);
    setEditValue("");
    setOverrideError(null);
  }

  async function saveOverride() {
    if (!editingItem || !classId) return;

    if (!selectedAcademicYear || !selectedPeriodCode) {
      setOverrideError(
        "Sélectionne une année scolaire et une période avant d'enregistrer.",
      );
      return;
    }

    const n = parseFrenchNumber(editValue);

    if (!Number.isFinite(n)) {
      setOverrideError("Saisis une moyenne valide.");
      return;
    }

    if (n < 0 || n > maxes.total) {
      setOverrideError(`La moyenne doit être comprise entre 0 et ${maxes.total}.`);
      return;
    }

    setSavingOverride(true);
    setOverrideError(null);
    setNotice(null);

    try {
      const calculatedTotal =
        editingItem.calculated_total !== null &&
        editingItem.calculated_total !== undefined
          ? Number(editingItem.calculated_total)
          : Number(editingItem.total);

      const res = await fetch("/api/admin/conduite/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          class_id: classId,
          student_id: editingItem.student_id,
          academic_year: selectedAcademicYear,
          period_code: selectedPeriodCode,
          from_date: from || null,
          to_date: to || null,
          calculated_total: calculatedTotal,
          override_total: n,
        }),
      });

      const j = await res.json().catch(() => ({}));

      if (!res.ok || !j?.ok) {
        throw new Error(
          j?.message ||
            j?.error ||
            "Impossible d'enregistrer la moyenne finale.",
        );
      }

      closeEditModal();
      setNotice("Moyenne finale enregistrée.");
      await validate();
    } catch (e: any) {
      setOverrideError(
        e?.message || "Impossible d'enregistrer la moyenne finale.",
      );
    } finally {
      setSavingOverride(false);
    }
  }

  async function resetOverride(item: ConductItem) {
    if (!classId || !selectedAcademicYear || !selectedPeriodCode) {
      setNotice(
        "Sélectionne d'abord une année scolaire et une période précise avant de réinitialiser.",
      );
      return;
    }

    const ok = window.confirm(
      `Réinitialiser la moyenne de conduite de ${nomPrenom(
        item.full_name,
      )} au calcul automatique ?`,
    );

    if (!ok) return;

    setSavingOverride(true);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/conduite/overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          class_id: classId,
          student_id: item.student_id,
          academic_year: selectedAcademicYear,
          period_code: selectedPeriodCode,
        }),
      });

      const j = await res.json().catch(() => ({}));

      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Impossible de réinitialiser la moyenne.");
      }

      setNotice("Moyenne réinitialisée au calcul automatique.");
      await validate();
    } catch (e: any) {
      setNotice(e?.message || "Impossible de réinitialiser la moyenne.");
    } finally {
      setSavingOverride(false);
    }
  }

  // Export CSV
  async function exportCSV() {
    if (!classId || sortedItems.length === 0) return;

    const qs = buildAveragesQuery({ format: "csv" });

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

  // Export PDF — Moyenne de conduite
  function exportPDF() {
    if (typeof window === "undefined") return;
    if (!classId || sortedItems.length === 0) return;

    const instName = institution?.institution_name || "";
    const logoUrl = institution?.institution_logo_url || "";
    const className =
      classLabel ||
      classesOfLevel.find((c) => c.id === classId)?.name ||
      "";

    const academicYear = selectedAcademicYear || currentAcademicYear || "";

    const selectedPeriod = selectedPeriodCode
      ? periods.find((per) => per.code === selectedPeriodCode) || null
      : null;

    const matchedPeriod =
      selectedPeriod || findMatchingPeriodByDates(periods, from, to);

    let periodLabel = matchedPeriod ? printablePeriodLabel(matchedPeriod) : "";
    let periodRange = "";

    // Si les dates correspondent à une période configurée, on affiche le nom
    // officiel de la période (ex. 1ER TRIMESTRE) au lieu du bloc "Du ... au ...".
    if (!matchedPeriod && (from || to)) {
      const start = from ? formatDateFrSafe(from) : "";
      const end = to ? formatDateFrSafe(to) : "";
      periodLabel = "Plage de dates sélectionnée";
      if (start || end) {
        periodRange =
          start && end
            ? `${start} au ${end}`
            : start
              ? `Depuis le ${start}`
              : `Jusqu'au ${end}`;
      }
    }

    const title = "Moyenne de conduite";

    const institutionMetaParts = [
      institution?.institution_postal_address,
      institution?.institution_phone ? `Tél : ${institution.institution_phone}` : "",
      institution?.institution_email,
      institution?.institution_status,
      institution?.institution_code ? `Code : ${institution.institution_code}` : "",
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const institutionMeta = institutionMetaParts
      .map((x) => escapeHtml(x))
      .join(" • ");

    const subtitleParts: string[] = [];
    if (className) subtitleParts.push(`Classe : ${className}`);
    if (academicYear) subtitleParts.push(`Année scolaire : ${academicYear}`);
    if (periodLabel) subtitleParts.push(`Période : ${periodLabel}`);
    if (!matchedPeriod && periodRange) subtitleParts.push(periodRange);
    const subtitle = subtitleParts.join(" • ");

    const today = new Date().toLocaleDateString("fr-FR");
    const generatedAt = generatedAtLabel();

    const calculatedAverage =
      sortedItems.length > 0
        ? sortedItems.reduce((acc, it) => acc + Number(it.total || 0), 0) /
          sortedItems.length
        : 0;

    const modifiedCount = sortedItems.filter((it) => it.is_overridden).length;

    const rowsHtml = sortedItems
      .map((it, index) => {
        const full = nomPrenom(it.full_name);
        const ass = fmtNote(it.breakdown.assiduite);
        const ten = fmtNote(it.breakdown.tenue);
        const mor = fmtNote(it.breakdown.moralite);
        const dis = fmtNote(it.breakdown.discipline);
        const tot = fmtNote(it.total);
        const status = it.is_overridden
          ? `<span class="badge badge-modified">Modifiée</span>`
          : `<span class="badge badge-auto">Automatique</span>`;

        return `<tr>
<td class="rank">${index + 1}</td>
<td class="student">${escapeHtml(full)}</td>
<td class="num">${escapeHtml(ass)}</td>
<td class="num">${escapeHtml(ten)}</td>
<td class="num">${escapeHtml(mor)}</td>
<td class="num">${escapeHtml(dis)}</td>
<td class="num total"><strong>${escapeHtml(tot)}</strong></td>
<td class="status">${status}</td>
</tr>`;
      })
      .join("");

    const logoHtml = logoUrl
      ? `<img src="${escapeAttr(logoUrl)}" alt="Logo établissement" />`
      : `<span>Logo</span>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert(
        "Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des fenêtres pop-up."
      );
      return;
    }

    const doc = w.document;
    doc.title = title;

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charSet="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 11mm;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    color: #0f172a;
    background: #f8fafc;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    padding: 16px;
  }

  .sheet {
    min-height: calc(100vh - 32px);
    background: #ffffff;
    border: 1px solid #dbe3ee;
    border-radius: 18px;
    padding: 16px;
    box-shadow: 0 18px 55px rgba(15, 23, 42, 0.08);
  }

  .print-header {
    display: grid;
    grid-template-columns: 86px 1fr 170px;
    gap: 14px;
    align-items: stretch;
    position: relative;
    overflow: hidden;
    padding: 12px;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    background:
      linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.02)),
      #ffffff;
  }

  .print-header::before {
    content: "";
    position: absolute;
    inset: 0;
    border-top: 5px solid #059669;
    pointer-events: none;
  }

  .logo-box {
    width: 74px;
    height: 74px;
    border: 1px solid #cbd5e1;
    border-radius: 14px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: #94a3b8;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .logo-box img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 5px;
  }

  .header-main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }

  .institution-name {
    margin: 0;
    color: #0f172a;
    font-size: 18px;
    line-height: 1.12;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .institution-meta {
    margin-top: 4px;
    color: #475569;
    font-size: 9.5px;
    line-height: 1.35;
  }

  .doc-title {
    width: fit-content;
    margin-top: 8px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #064e3b;
    color: #ffffff;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .brand-line {
    margin-top: 6px;
    color: #334155;
    font-size: 9.5px;
  }

  .brand-line strong {
    color: #047857;
    font-weight: 950;
  }

  .header-side {
    border-left: 1px solid #cbd5e1;
    padding-left: 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    color: #334155;
    font-size: 9.5px;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px dashed #cbd5e1;
    padding-bottom: 4px;
  }

  .meta-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .meta-row span:first-child {
    color: #64748b;
    font-weight: 800;
  }

  .meta-row span:last-child {
    text-align: right;
    color: #0f172a;
    font-weight: 900;
  }

  .subtitle {
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
    color: #334155;
    font-size: 10.5px;
    font-weight: 650;
  }

  .summary-grid {
    margin-top: 10px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .summary-card {
    border: 1px solid #dbeafe;
    border-radius: 13px;
    padding: 8px 9px;
    background: linear-gradient(180deg, #ffffff, #f8fafc);
  }

  .summary-label {
    color: #64748b;
    font-size: 7.8px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 950;
  }

  .summary-value {
    margin-top: 3px;
    color: #0f172a;
    font-size: 15px;
    font-weight: 950;
  }

  .summary-note {
    margin-top: 2px;
    color: #64748b;
    font-size: 8px;
  }

  .table-wrap {
    margin-top: 11px;
    border: 1px solid #cbd5e1;
    border-radius: 14px;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    background: #ffffff;
    font-size: 10px;
  }

  th,
  td {
    border: 1px solid #cbd5e1;
    padding: 5px 6px;
    vertical-align: middle;
  }

  thead th {
    background: #eafaf4;
    color: #064e3b;
    font-size: 8.5px;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  tbody tr:nth-child(even) td {
    background: #f8fafc;
  }

  .rank {
    width: 34px;
    text-align: center;
    font-weight: 800;
    color: #334155;
  }

  .student {
    width: 210px;
    font-weight: 800;
    color: #0f172a;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .total {
    background: #fefce8 !important;
    color: #0f172a;
    font-weight: 950;
  }

  .status {
    width: 82px;
    text-align: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 62px;
    border-radius: 999px;
    padding: 2px 6px;
    font-size: 8px;
    font-weight: 950;
    white-space: nowrap;
  }

  .badge-auto {
    background: #f1f5f9;
    color: #475569;
  }

  .badge-modified {
    background: #fef3c7;
    color: #92400e;
  }

  .signature-boxes {
    margin-top: 14px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }

  .signature-box {
    min-height: 58px;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    padding: 8px;
    color: #64748b;
    font-size: 9px;
  }

  .signature-title {
    font-weight: 900;
    color: #334155;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .signature-line {
    margin-top: 28px;
    border-top: 1px solid #94a3b8;
  }

  .footer {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    border-top: 1px solid #cbd5e1;
    padding-top: 8px;
    color: #475569;
    font-size: 9px;
  }

  .footer strong {
    color: #047857;
    font-weight: 950;
  }

  .footer-right {
    text-align: right;
    white-space: nowrap;
  }

  @media print {
    body {
      padding: 0;
      background: #ffffff;
    }

    .sheet {
      min-height: auto;
      border: none;
      border-radius: 0;
      box-shadow: none;
      padding: 0;
    }

    .print-header,
    .summary-card,
    .subtitle,
    .signature-box {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /*
      IMPORTANT :
      Ne jamais mettre break-inside: avoid sur .table-wrap.
      Sinon Chrome pousse tout le tableau à la page suivante quand il estime
      que la liste est trop haute, ce qui crée une énorme zone blanche
      après l'en-tête et les cartes de synthèse.
    */
    .table-wrap {
      break-inside: auto !important;
      page-break-inside: auto !important;
      overflow: visible !important;
    }

    table {
      break-inside: auto !important;
      page-break-inside: auto !important;
    }

    thead {
      display: table-header-group;
    }

    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
</style>
</head>
<body>
  <main class="sheet">
    <header class="print-header">
      <div class="logo-box">${logoHtml}</div>

      <div class="header-main">
        <h1 class="institution-name">${escapeHtml(instName || "ÉTABLISSEMENT")}</h1>
        ${
          institutionMeta
            ? `<div class="institution-meta">${institutionMeta}</div>`
            : ""
        }
        <div class="doc-title">${escapeHtml(title)}</div>
        <div class="brand-line">
          <strong>${escapeHtml(BRAND_COMPANY)}</strong> • ${escapeHtml(
            BRAND_SITE,
          )}
        </div>
      </div>

      <aside class="header-side">
        <div class="meta-row">
          <span>Document</span>
          <span>PDF</span>
        </div>
        <div class="meta-row">
          <span>Édité le</span>
          <span>${escapeHtml(today)}</span>
        </div>
        <div class="meta-row">
          <span>Solution</span>
          <span>Mon Cahier</span>
        </div>
      </aside>
    </header>

    <section class="subtitle">${escapeHtml(subtitle || "Moyennes de conduite")}</section>

    <section class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Année scolaire</div>
        <div class="summary-value">${escapeHtml(academicYear || "—")}</div>
        <div class="summary-note">Référence administrative</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Classe</div>
        <div class="summary-value">${escapeHtml(className || "—")}</div>
        <div class="summary-note">Classe concernée</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Effectif</div>
        <div class="summary-value">${escapeHtml(sortedItems.length)}</div>
        <div class="summary-note">Élèves affichés</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Moyenne classe</div>
        <div class="summary-value">${escapeHtml(fmtNote(calculatedAverage))}</div>
        <div class="summary-note">Sur ${escapeHtml(maxes.total)} points • ${escapeHtml(
          modifiedCount,
        )} modifiée(s)</div>
      </div>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="rank">N°</th>
            <th class="student">Élève</th>
            <th>Assiduité<br/>/${escapeHtml(maxes.ass)}</th>
            <th>Tenue<br/>/${escapeHtml(maxes.ten)}</th>
            <th>Moralité<br/>/${escapeHtml(maxes.mor)}</th>
            <th>Discipline<br/>/${escapeHtml(maxes.dis)}</th>
            <th>Moyenne finale<br/>/${escapeHtml(maxes.total)}</th>
            <th class="status">Statut</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>

    <section class="signature-boxes">
      <div class="signature-box">
        <div class="signature-title">Visa de l’administration</div>
        <div class="signature-line"></div>
      </div>
      <div class="signature-box">
        <div class="signature-title">Observation / contrôle</div>
        <div class="signature-line"></div>
      </div>
    </section>

    <footer class="footer">
      <div>
        Document généré automatiquement depuis <strong>Mon Cahier</strong> le ${escapeHtml(
          generatedAt,
        )}.
      </div>
      <div class="footer-right">
        ${escapeHtml(BRAND_COMPANY)} • <strong>${escapeHtml(BRAND_SITE)}</strong>
      </div>
    </footer>
  </main>

</body>
</html>`;

    doc.open();
    doc.write(html);
    doc.close();

    w.focus();

    setTimeout(() => {
      try {
        w.print();
      } catch {
        // silencieux
      }
    }, 400);
  }

  const selectedPeriodLabel = useMemo(() => {
    const p = periods.find((per) => per.code === selectedPeriodCode);
    return p ? printablePeriodLabel(p) : selectedPeriodCode || "";
  }, [periods, selectedPeriodCode]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conduite — Moyennes par élève</h1>
        <p className="text-slate-600">
          Sélectionne l&apos;année scolaire, la période, le niveau et la classe.
          La moyenne affichée est la moyenne finale officielle : calcul automatique
          ou correction administrative si elle existe.
        </p>
      </div>

      <Card title="Filtres">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
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
          </div>

          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">
              Période d&apos;évaluation
            </div>
            <Select
              value={selectedPeriodCode}
              onChange={handlePeriodChange}
              disabled={loadingPeriods || periods.length === 0}
            >
              <option value="">— Toutes les dates —</option>
              {periods
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.short_label || p.label}
                  </option>
                ))}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              La modification officielle exige une période précise.
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setItems([]);
                setClassLabel("");
                setNotice(null);
              }}
              disabled={!level}
            >
              <option value="">— Sélectionner —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setSelectedPeriodCode("");
                setFrom(e.target.value);
                setItems([]);
                setClassLabel("");
                setNotice(null);
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
                setItems([]);
                setClassLabel("");
                setNotice(null);
              }}
            />
          </div>

          <div className="flex items-end md:col-span-2">
            <div className="flex flex-wrap gap-2">
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

        {notice && (
          <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
            {notice}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={validate} disabled={!classId || loading}>
            {loading ? "…" : "Valider"}
          </Button>
          <Button
            onClick={exportCSV}
            disabled={!classId || loading || sortedItems.length === 0}
          >
            Exporter CSV
          </Button>
          <Button
            type="button"
            onClick={exportPDF}
            disabled={!classId || loading || sortedItems.length === 0}
          >
            Exporter PDF
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
          <div className="space-y-3">
            {!selectedPeriodCode && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Les moyennes peuvent être consultées, mais la modification
                officielle est désactivée tant qu&apos;aucune période précise
                n&apos;est sélectionnée.
              </div>
            )}

            {selectedPeriodCode && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Période : <b>{selectedPeriodLabel}</b> — Année scolaire :{" "}
                <b>{selectedAcademicYear || currentAcademicYear || "—"}</b>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Élève</th>
                    <th className="px-3 py-2 text-left">
                      Assiduité (/{maxes.ass})
                    </th>
                    <th className="px-3 py-2 text-left">Tenue (/{maxes.ten})</th>
                    <th className="px-3 py-2 text-left">
                      Moralité (/{maxes.mor})
                    </th>
                    <th className="px-3 py-2 text-left">
                      Discipline (/{maxes.dis})
                    </th>
                    <th className="px-3 py-2 text-left">Moyenne calculée</th>
                    <th className="px-3 py-2 text-left">Moyenne finale</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((it) => {
                    const calculated =
                      it.calculated_total !== null &&
                      it.calculated_total !== undefined
                        ? it.calculated_total
                        : it.total;

                    return (
                      <tr key={it.student_id} className="border-t">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {nomPrenom(it.full_name)}
                        </td>
                        <td className="px-3 py-2">
                          {fmtNote(it.breakdown.assiduite)}
                        </td>
                        <td className="px-3 py-2">
                          {fmtNote(it.breakdown.tenue)}
                        </td>
                        <td className="px-3 py-2">
                          {fmtNote(it.breakdown.moralite)}
                        </td>
                        <td className="px-3 py-2">
                          {fmtNote(it.breakdown.discipline)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {fmtNote(calculated)}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {fmtNote(it.total)}
                        </td>
                        <td className="px-3 py-2">
                          {it.is_overridden ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
                              Modifiée
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                              Automatique
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              onClick={() => openEditModal(it)}
                              disabled={!canEditOfficialAverage || savingOverride}
                              className="bg-slate-900 px-3 py-1.5 text-xs hover:bg-slate-800"
                            >
                              Modifier
                            </Button>

                            {it.is_overridden && (
                              <Button
                                type="button"
                                onClick={() => resetOverride(it)}
                                disabled={
                                  !canEditOfficialAverage || savingOverride
                                }
                                className="bg-white px-3 py-1.5 text-xs text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
                              >
                                Réinitialiser
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3">
              <div className="text-lg font-semibold text-slate-900">
                Modifier la moyenne finale
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {nomPrenom(editingItem.full_name)}
              </div>
            </div>

            <div className="rounded-xl border bg-slate-50 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Moyenne calculée</span>
                <b>
                  {fmtNote(
                    editingItem.calculated_total !== null &&
                      editingItem.calculated_total !== undefined
                      ? editingItem.calculated_total
                      : editingItem.total,
                  )}
                  /{maxes.total}
                </b>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-500">Moyenne finale actuelle</span>
                <b>
                  {fmtNote(editingItem.total)}/{maxes.total}
                </b>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-slate-600">
                Nouvelle moyenne finale
              </div>
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                inputMode="decimal"
                placeholder="Ex : 16 ou 16,50"
                autoFocus
              />
              <div className="mt-1 text-[11px] text-slate-500">
                Valeur comprise entre 0 et {maxes.total}. Aucun motif n&apos;est
                demandé.
              </div>
            </div>

            {overrideError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {overrideError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                onClick={closeEditModal}
                disabled={savingOverride}
                className="bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Annuler
              </Button>
              <Button
                type="button"
                onClick={saveOverride}
                disabled={savingOverride}
              >
                {savingOverride ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}