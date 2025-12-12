// src/app/admin/notes/bulletins/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

import { Printer, RefreshCw } from "lucide-react";

/* ───────── Types ───────── */

type ClassRow = {
  id: string;
  name: string;
  level?: string | null;
  academic_year?: string | null;
};

type InstitutionSettings = {
  institution_name: string;
  institution_logo_url: string;
  institution_phone: string;
  institution_email: string;
  institution_region: string;
  institution_postal_address: string;
  institution_status: string;
  institution_head_name: string;
  institution_head_title: string;

  // 🆕 pour l’en-tête officiel façon MEN
  country_name?: string;
  country_motto?: string;
  ministry_name?: string;
  institution_code?: string;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin: number;
  include_in_average?: boolean;
};

type BulletinSubjectComponent = {
  id: string;
  subject_id: string; // parent subject (subjects.id)
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number;
};

type BulletinGroupItem = {
  id: string;
  group_id: string;
  subject_id: string;
  subject_name: string;
  order_index: number;
  subject_coeff_override: number | null;
};

type BulletinGroup = {
  id: string;
  code: string;
  label: string;
  short_label: string | null;
  order_index: number;
  is_active: boolean;
  annual_coeff: number;
  items: BulletinGroupItem[];
};

type PerSubjectAvg = {
  subject_id: string;
  avg20: number | null;
  // 🆕 rang de l’élève dans la classe pour cette matière (optionnel, renvoyé par l’API)
  subject_rank?: number | null;
  // 🆕 nom du professeur de la matière (optionnel, renvoyé par l’API)
  teacher_name?: string | null;
};

type PerGroupAvg = {
  group_id: string;
  group_avg: number | null;
  // 🆕 rang de l’élève dans le groupe de matières (calculé côté front)
  group_rank?: number | null;
};

type PerSubjectComponentAvg = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
  // 🆕 rang dans la sous-matière (calculé côté front)
  component_rank?: number | null;
};

type BulletinItemBase = {
  student_id: string;
  full_name: string;
  matricule: string | null;

  // Infos élève pour coller au bulletin officiel
  sex?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  regime?: string | null;
  is_boarder?: boolean | null;
  is_scholarship?: boolean | null;
  is_repeater?: boolean | null;
  is_assigned?: boolean | null;
  is_affecte?: boolean | null;

  per_subject: PerSubjectAvg[];
  per_group: PerGroupAvg[];
  general_avg: number | null;
  // ➕ moyennes par sous-matière
  per_subject_components?: PerSubjectComponentAvg[];
};

type BulletinItemWithRank = BulletinItemBase & {
  rank: number | null;
};

type BulletinResponse = {
  ok: boolean;
  class: {
    id: string;
    label: string;
    code?: string | null;
    academic_year?: string | null;
    head_teacher?: {
      id: string;
      display_name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
  };
  period: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  };
  subjects: BulletinSubject[];
  subject_groups: BulletinGroup[];
  // ➕ sous-matières renvoyées par l’API (toujours présent côté back, optionnel côté TS)
  subject_components?: BulletinSubjectComponent[];
  items: BulletinItemBase[];
};

type ClassStats = {
  highest: number | null;
  lowest: number | null;
  classAvg: number | null;
};

type EnrichedBulletin = {
  response: BulletinResponse;
  items: BulletinItemWithRank[];
  stats: ClassStats;
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

type ConductRubricMax = {
  assiduite: number;
  tenue: number;
  moralite: number;
  discipline: number;
};

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
  absence_count?: number;
  tardy_count?: number;
  absence_minutes?: number;
  tardy_minutes?: number;
};

type ConductSummaryResponse = {
  class_label: string;
  rubric_max: ConductRubricMax;
  total_max: number;
  items: ConductItem[];
};

/* ───────── Mentions conseil de classe ───────── */

type CouncilMentions = {
  distinction: "excellence" | "honour" | "encouragement" | null;
  sanction:
    | "warningWork"
    | "warningConduct"
    | "blameWork"
    | "blameConduct"
    | null;
};

/**
 * Règles simples (faciles à ajuster) :
 * - ≥ 16 : Tableau d'excellence
 * - [14 ; 16[ : Tableau d'honneur / Félicitations
 * - [12 ; 14[ : Tableau d'encouragement
 * - [10 ; 20[ : pas de sanction
 * - [8 ; 10[ : Avertissement travail
 * - < 8 : Blâme travail
 * + si conduite très faible → avertissement / blâme conduite
 */
function computeCouncilMentions(
  generalAvg: number | null | undefined,
  conductTotal: number | null | undefined,
  conductTotalMax: number | null | undefined
): CouncilMentions {
  let distinction: CouncilMentions["distinction"] = null;
  let sanction: CouncilMentions["sanction"] = null;

  if (
    generalAvg !== null &&
    generalAvg !== undefined &&
    Number.isFinite(generalAvg)
  ) {
    const g = generalAvg;
    if (g >= 16) {
      distinction = "excellence";
    } else if (g >= 14) {
      distinction = "honour";
    } else if (g >= 12) {
      distinction = "encouragement";
    } else if (g < 8) {
      sanction = "blameWork";
    } else if (g < 10) {
      sanction = "warningWork";
    }
  }

  if (
    conductTotal !== null &&
    conductTotal !== undefined &&
    conductTotalMax !== null &&
    conductTotalMax !== undefined &&
    conductTotalMax > 0
  ) {
    const ratio = conductTotal / conductTotalMax;
    if (ratio <= 0.4) {
      // conduite très faible → blâme conduite
      sanction = "blameConduct";
    } else if (ratio <= 0.6 && !sanction) {
      // conduite moyenne → avertissement conduite (sauf si déjà sanction sur le travail)
      sanction = "warningConduct";
    }
  }

  return { distinction, sanction };
}

/* ───────── UI helpers ───────── */

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

function Button({ variant = "primary", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-4";
  const variants: Record<string, string> = {
    primary:
      "bg-emerald-500 text-white hover:bg-emerald-600 focus:ring-emerald-500/30 disabled:bg-emerald-300",
    ghost:
      "bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-100 focus:ring-slate-400/30 disabled:opacity-60",
  };
  return (
    <button
      {...props}
      className={[base, variants[variant], props.className ?? ""].join(" ")}
    />
  );
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return n.toFixed(digits);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDateFR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
}

function formatYesNo(value: boolean | null | undefined): string {
  if (value === true) return "Oui";
  if (value === false) return "Non";
  return "—";
}

/**
 * Appréciation automatique par matière en fonction de la moyenne /20
 *
 * | Moyenne | Appréciation |
 * | ------- | ------------ |
 * | ≥ 18    | Excellent    |
 * | 16 – 18 | TRES bien    |
 * | 14 – 16 | bien         |
 * | 12 – 14 | ASSEZ Bien   |
 * | 10 – 12 | PASSABLE     |
 * | 8 – 10  | Insuffisant  |
 * | 6 – 8   | FAIBLE       |
 * | < 6     | BLAME        |
 */
function computeSubjectAppreciation(
  avg: number | null | undefined
): string {
  if (avg === null || avg === undefined) return "";
  if (!Number.isFinite(avg)) return "";

  const a = Number(avg);
  if (a >= 18) return "Excellent";
  if (a >= 16) return "TRES bien";
  if (a >= 14) return "bien";
  if (a >= 12) return "ASSEZ Bien";
  if (a >= 10) return "PASSABLE";
  if (a >= 8) return "Insuffisant";
  if (a >= 6) return "FAIBLE";
  return "BLAME";
}

/* ───────── Rangs sous-matières (côté front) ───────── */

function applyComponentRanksFront(
  items: (BulletinItemBase | BulletinItemWithRank)[]
) {
  type Entry = {
    itemIndex: number;
    compIndex: number;
    avg: number;
    key: string;
  };

  const byKey = new Map<string, Entry[]>();

  items.forEach((it, itemIndex) => {
    const comps = it.per_subject_components ?? [];
    comps.forEach((psc, compIndex) => {
      const raw = psc.avg20;
      if (raw === null || raw === undefined) return;
      const avg = Number(raw);
      if (!Number.isFinite(avg)) return;
      const key = `${psc.subject_id}__${psc.component_id}`;
      const arr = byKey.get(key) ?? [];
      arr.push({ itemIndex, compIndex, avg, key });
      byKey.set(key, arr);
    });
  });

  byKey.forEach((entries) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    entries.forEach(({ itemIndex, compIndex, avg }) => {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }
      const comps = items[itemIndex].per_subject_components;
      if (!comps || !comps[compIndex]) return;
      (comps[compIndex] as any).component_rank = currentRank;
    });
  });
}

/* ───────── Rangs groupes de matières (BILAN LETTRES / SCIENCES) ───────── */

function applyGroupRanksFront(
  items: (BulletinItemBase | BulletinItemWithRank)[]
) {
  type Entry = {
    itemIndex: number;
    groupIndex: number;
    avg: number;
    groupId: string;
  };

  const byGroup = new Map<string, Entry[]>();

  items.forEach((it, itemIndex) => {
    const groups = it.per_group ?? [];
    groups.forEach((g, groupIndex) => {
      const raw = g.group_avg;
      if (raw === null || raw === undefined) return;
      const avg = Number(raw);
      if (!Number.isFinite(avg)) return;
      const groupId = g.group_id;
      const arr = byGroup.get(groupId) ?? [];
      arr.push({ itemIndex, groupIndex, avg, groupId });
      byGroup.set(groupId, arr);
    });
  });

  byGroup.forEach((entries) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    entries.forEach(({ itemIndex, groupIndex, avg }) => {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }
      const groups = items[itemIndex].per_group;
      if (!groups || !groups[groupIndex]) return;
      (groups[groupIndex] as any).group_rank = currentRank;
    });
  });
}

/* ───────── Ranks + stats helper ───────── */

function computeRanksAndStats(
  res: BulletinResponse | null
): EnrichedBulletin | null {
  if (!res) return null;
  const items = res.items ?? [];

  const withAvg = items.filter(
    (it) => typeof it.general_avg === "number" && it.general_avg !== null
  );

  const stats: ClassStats = {
    highest: null,
    lowest: null,
    classAvg: null,
  };

  if (!withAvg.length) {
    const itemsWithRank: BulletinItemWithRank[] = items.map((it) => ({
      ...it,
      rank: null,
    }));
    // même si pas de moyenne générale, on peut classer les sous-matières et les groupes
    applyComponentRanksFront(itemsWithRank);
    applyGroupRanksFront(itemsWithRank);
    return { response: res, items: itemsWithRank, stats };
  }

  const sorted = [...withAvg].sort(
    (a, b) => (b.general_avg ?? 0) - (a.general_avg ?? 0)
  );

  let lastScore: number | null = null;
  let lastRank = 0;
  const rankByStudent = new Map<string, number>();

  sorted.forEach((it, idx) => {
    const g = it.general_avg ?? 0;
    if (lastScore === null || g !== lastScore) {
      lastRank = idx + 1;
      lastScore = g;
    }
    rankByStudent.set(it.student_id, lastRank);
  });

  const sum = withAvg.reduce((acc, it) => acc + (it.general_avg ?? 0), 0);
  const highest = sorted[0].general_avg ?? null;
  const lowest = sorted[sorted.length - 1].general_avg ?? null;
  const classAvg = sum / withAvg.length;

  stats.highest = highest !== null ? round2(highest) : null;
  stats.lowest = lowest !== null ? round2(lowest) : null;
  stats.classAvg = round2(classAvg);

  const itemsWithRank: BulletinItemWithRank[] = items.map((it) => ({
    ...it,
    rank: rankByStudent.get(it.student_id) ?? null,
  }));

  // 🆕 on calcule aussi les rangs pour chaque sous-matière et chaque BILAN (groupe)
  applyComponentRanksFront(itemsWithRank);
  applyGroupRanksFront(itemsWithRank);

  return { response: res, items: itemsWithRank, stats };
}

/* ───────── Student bulletin card ───────── */

type StudentBulletinCardProps = {
  index: number;
  total: number;
  item: BulletinItemWithRank;
  subjects: BulletinSubject[];
  subjectComponents: BulletinSubjectComponent[];
  subjectGroups: BulletinGroup[];
  classInfo: BulletinResponse["class"];
  period: BulletinResponse["period"];
  institution: InstitutionSettings | null;
  stats: ClassStats;
  conduct?: ConductItem | null;
  conductRubricMax?: ConductRubricMax;
  conductTotalMax?: number;
};

function StudentBulletinCard({
  index,
  total,
  item,
  subjects,
  subjectComponents,
  subjectGroups,
  classInfo,
  period,
  institution,
  stats,
  conduct,
  conductRubricMax,
  conductTotalMax,
}: StudentBulletinCardProps) {
  const coeffTotal = useMemo(
    () =>
      subjects.reduce(
        (acc, s) =>
          acc + (Number.isFinite(s.coeff_bulletin) ? s.coeff_bulletin : 0),
        0
      ),
    [subjects]
  );

  const academicYear =
    classInfo.academic_year || period.academic_year || "";

  // 🔁 compat : sex ou gender
  const rawSex = item.sex ?? item.gender ?? null;
  const sexLabel = rawSex ? String(rawSex).toUpperCase() : "—";

  // 🔁 compat : birthdate ou birth_date
  const rawBirth = item.birthdate ?? item.birth_date ?? null;
  const birthdateLabel = formatDateFR(rawBirth);

  const birthPlaceLabel = item.birth_place || "—";
  const nationalityLabel = item.nationality || "—";
  const regimeLabel =
    item.regime ||
    (item.is_scholarship === true
      ? "Boursier"
      : item.is_scholarship === false
      ? "Non boursier"
      : "—");
  const boarderLabel =
    item.is_boarder == null
      ? "—"
      : item.is_boarder
      ? "Interne"
      : "Externe";
  const repeaterLabel = formatYesNo(item.is_repeater);

  // 🔁 compat : is_assigned ou is_affecte
  const assignedLabel = formatYesNo(
    item.is_assigned ?? item.is_affecte ?? null
  );

  // Map subject_id -> liste ordonnée de sous-matières
  const subjectCompsBySubject = useMemo(() => {
    const map = new Map<string, BulletinSubjectComponent[]>();
    subjectComponents.forEach((c) => {
      const arr = map.get(c.subject_id) ?? [];
      arr.push(c);
      map.set(c.subject_id, arr);
    });
    // Tri par order_index
    map.forEach((arr) =>
      arr.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    );
    return map;
  }, [subjectComponents]);

  // Map (subject_id + component_id) -> { moyenne, rang }
  const perSubjectComponentMap = useMemo(() => {
    const m = new Map<
      string,
      { avg20: number | null; component_rank?: number | null }
    >();
    const per = item.per_subject_components ?? [];
    per.forEach((psc) => {
      const key = `${psc.subject_id}__${psc.component_id}`;
      m.set(key, {
        avg20: psc.avg20 ?? null,
        component_rank:
          psc.component_rank !== undefined ? psc.component_rank : null,
      });
    });
    return m;
  }, [item.per_subject_components]);

  // Map group_id -> { group_avg, group_rank }
  const perGroupMap = useMemo(() => {
    const m = new Map<string, { group_avg: number | null; group_rank?: number | null }>();
    const per = item.per_group ?? [];
    per.forEach((g) => {
      m.set(g.group_id, {
        group_avg: g.group_avg ?? null,
        group_rank:
          g.group_rank !== undefined ? g.group_rank : null,
      });
    });
    return m;
  }, [item.per_group]);

  // Map subject_id -> BulletinSubject (utile pour les groupes)
  const subjectsById = useMemo(() => {
    const m = new Map<string, BulletinSubject>();
    subjects.forEach((s) => m.set(s.subject_id, s));
    return m;
  }, [subjects]);

  // Durée d'absence en heures (à partir des minutes)
  const absenceHours =
    conduct && typeof conduct.absence_minutes === "number"
      ? conduct.absence_minutes / 60
      : null;

  // Mentions conseil de classe auto
  const mentions = computeCouncilMentions(
    item.general_avg,
    conduct?.total ?? null,
    conductTotalMax ?? null
  );

  const tick = (checked: boolean) => (checked ? "☑" : "□");

  // Helper d’affichage d’une matière + ses sous-matières
  const renderSubjectBlock = (s: BulletinSubject) => {
    const cell = item.per_subject.find(
      (ps) => ps.subject_id === s.subject_id
    );
    const avg = cell?.avg20 ?? null;
    const moyCoeff =
      avg !== null ? round2(avg * (s.coeff_bulletin || 0)) : null;

    const subjectRankLabel =
      cell && cell.subject_rank != null ? `${cell.subject_rank}e` : "—";

    const subjectTeacher = cell?.teacher_name || "";

    const appreciationLabel = computeSubjectAppreciation(avg);

    const subComps = subjectCompsBySubject.get(s.subject_id) ?? [];

    return (
      <React.Fragment key={s.subject_id}>
        {/* Ligne principale de la matière */}
        <tr>
          <td className="border border-slate-400 px-1 py-0.5">
            {s.subject_name}
          </td>
          <td className="border border-slate-400 px-1 py-0.5 text-center">
            {formatNumber(avg)}
          </td>
          <td className="border border-slate-400 px-1 py-0.5 text-center">
            {formatNumber(s.coeff_bulletin, 0)}
          </td>
          <td className="border border-slate-400 px-1 py-0.5 text-center">
            {formatNumber(moyCoeff)}
          </td>
          <td className="border border-slate-400 px-1 py-0.5 text-center">
            {subjectRankLabel}
          </td>
          <td className="border border-slate-400 px-1 py-0.5">
            {appreciationLabel}
          </td>
          <td className="border border-slate-400 px-1 py-0.5">
            {subjectTeacher}
          </td>
          {/* Signature : case VIDE, comme sur le modèle (pas de tiret) */}
          <td className="border border-slate-400 px-1 py-0.5" />
        </tr>

        {/* Lignes des sous-matières, si présentes */}
        {subComps.map((comp) => {
          const key = `${s.subject_id}__${comp.id}`;
          const compCell = perSubjectComponentMap.get(key);
          const cAvg = compCell?.avg20 ?? null;
          const cRank = compCell?.component_rank ?? null;
          const cMoyCoeff =
            cAvg !== null
              ? round2(cAvg * (comp.coeff_in_subject || 0))
              : null;

          return (
            <tr
              key={`${s.subject_id}-${comp.id}`}
              className="text-[0.65rem] text-slate-600"
            >
              <td className="border border-slate-400 px-1 py-0.5 pl-4">
                • {comp.short_label || comp.label}
              </td>
              <td className="border border-slate-400 px-1 py-0.5 text-center">
                {formatNumber(cAvg)}
              </td>
              <td className="border border-slate-400 px-1 py-0.5 text-center">
                {formatNumber(comp.coeff_in_subject, 0)}
              </td>
              <td className="border border-slate-400 px-1 py-0.5 text-center">
                {formatNumber(cMoyCoeff)}
              </td>
              <td className="border border-slate-400 px-1 py-0.5 text-center">
                {cRank != null ? `${cRank}e` : "—"}
              </td>
              <td className="border border-slate-400 px-1 py-0.5" />
              <td className="border border-slate-400 px-1 py-0.5" />
              <td className="border border-slate-400 px-1 py-0.5" />
            </tr>
          );
        })}
      </React.Fragment>
    );
  };

  // Sujet déjà utilisés dans un groupe (pour ne pas les doubler)
  const groupedSubjectIds = new Set<string>();

  const hasGroups = subjectGroups && subjectGroups.length > 0;

  return (
    <div
      className="mb-6 border border-slate-400 bg-white p-4 text-xs shadow-sm print:mb-0"
      style={{ pageBreakAfter: "always" }}
    >
      {/* En-tête établissement + MEN */}
      <div className="mb-2 flex items-start justify-between gap-4 border-b border-slate-400 pb-2">
        <div className="flex-1 text-[0.7rem]">
          {institution?.country_name && (
            <div className="font-semibold uppercase">
              {institution.country_name}
            </div>
          )}
          {institution?.country_motto && (
            <div className="text-[0.65rem] italic">
              {institution.country_motto}
            </div>
          )}
          {institution?.ministry_name && (
            <div className="mt-1 uppercase">
              {institution.ministry_name}
            </div>
          )}
          <div className="mt-1 font-semibold uppercase">
            {institution?.institution_name || "Établissement"}
          </div>
          {institution?.institution_postal_address && (
            <div>{institution.institution_postal_address}</div>
          )}
          {(institution?.institution_phone ||
            institution?.institution_email) && (
            <div className="text-[0.65rem] text-slate-600">
              {institution.institution_phone && (
                <span>Tél: {institution.institution_phone}</span>
              )}
              {institution.institution_phone &&
                institution.institution_email &&
                " • "}
              {institution.institution_email && (
                <span>Email: {institution.institution_email}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end text-right text-[0.7rem]">
          <div className="font-bold uppercase">
            Bulletin trimestriel de notes
          </div>
          <div>
            {period.label || period.short_label || "Période"}
            {period.from && period.to && (
              <>
                {" "}
                ({period.from} → {period.to})
              </>
            )}
          </div>
          {academicYear && <div>Année scolaire : {academicYear}</div>}
          {institution?.institution_code && (
            <div>Code établissement : {institution.institution_code}</div>
          )}
          <div className="text-[0.65rem] text-slate-500">
            Élève {index + 1} / {total}
          </div>
        </div>
      </div>

      {/* Bloc élève + classe + infos admin */}
      <div className="mb-3 grid grid-cols-1 gap-2 border border-slate-400 p-2 md:grid-cols-3">
        <div className="space-y-1 text-xs">
          <div>
            <span className="font-semibold">Nom & prénom(s) : </span>
            <span className="uppercase">{item.full_name}</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="font-semibold">Matricule : </span>
              <span>{item.matricule || "—"}</span>
            </div>
            <div>
              <span className="font-semibold">Sexe : </span>
              <span>{sexLabel}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="font-semibold">Classe : </span>
              <span>{classInfo.label}</span>
            </div>
            <div>
              <span className="font-semibold">Effectif : </span>
              <span>{total}</span>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-xs">
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="font-semibold">Né(e) le : </span>
              <span>{birthdateLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Lieu de naissance : </span>
              <span>{birthPlaceLabel}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="font-semibold">Nationalité : </span>
              <span>{nationalityLabel}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="font-semibold">Redoublant(e) : </span>
              <span>{repeaterLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Affecté(e) : </span>
              <span>{assignedLabel}</span>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-xs">
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="font-semibold">Régime : </span>
              <span>{regimeLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Internat : </span>
              <span>{boarderLabel}</span>
            </div>
          </div>
          {classInfo.head_teacher?.display_name && (
            <div>
              <span className="font-semibold">Prof. principal : </span>
              <span>{classInfo.head_teacher.display_name}</span>
            </div>
          )}
          {institution?.institution_head_name && (
            <div>
              <span className="font-semibold">Chef d&apos;établissement : </span>
              <span>{institution.institution_head_name}</span>
              {institution.institution_head_title && (
                <span className="text-[0.65rem] text-slate-600">
                  {" "}
                  ({institution.institution_head_title})
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tableau disciplines + sous-matières + BILAN LETTRES / SCIENCES */}
      <table className="mb-3 w-full border border-slate-400 text-[0.7rem]">
        <thead className="bg-slate-100">
          <tr>
            <th className="border border-slate-400 px-1 py-1 text-left">
              Disciplines
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Moy./20
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Coeff
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Total
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Rang
            </th>
            <th className="border border-slate-400 px-1 py-1 text-left">
              Appréciations
            </th>
            <th className="border border-slate-400 px-1 py-1 text-left">
              Professeurs
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Signature
            </th>
          </tr>
        </thead>
        <tbody>
          {hasGroups ? (
            <>
              {/* 1) Matières organisées par groupes + lignes BILAN */}
              {subjectGroups.map((g) => {
                if (!g.is_active) return null;

                const groupSubjects: BulletinSubject[] = [];
                g.items.forEach((it) => {
                  const subj = subjectsById.get(it.subject_id);
                  if (subj) {
                    groupSubjects.push(subj);
                    groupedSubjectIds.add(subj.subject_id);
                  }
                });

                if (!groupSubjects.length) return null;

                const groupInfo = perGroupMap.get(g.id);
                const groupAvg = groupInfo?.group_avg ?? null;
                const groupRankLabel =
                  groupInfo?.group_rank != null
                    ? `${groupInfo.group_rank}e`
                    : "—";
                const groupCoeff = g.annual_coeff ?? 0;
                const groupTotal =
                  groupAvg !== null && groupCoeff
                    ? round2(groupAvg * groupCoeff)
                    : null;

                const bilanLabel = g.label || g.code || "Bilan";

                return [
                  ...groupSubjects.map((s) => renderSubjectBlock(s)),
                  <tr
                    key={`group-${g.id}`}
                    className="bg-slate-50 font-semibold"
                  >
                    <td className="border border-slate-400 px-1 py-0.5">
                      {bilanLabel}
                    </td>
                    <td className="border border-slate-400 px-1 py-0.5 text-center">
                      {formatNumber(groupAvg)}
                    </td>
                    <td className="border border-slate-400 px-1 py-0.5 text-center">
                      {groupCoeff ? formatNumber(groupCoeff, 0) : ""}
                    </td>
                    <td className="border border-slate-400 px-1 py-0.5 text-center">
                      {groupCoeff ? formatNumber(groupTotal) : ""}
                    </td>
                    <td className="border border-slate-400 px-1 py-0.5 text-center">
                      {groupRankLabel}
                    </td>
                    <td className="border border-slate-400 px-1 py-0.5" />
                    <td className="border border-slate-400 px-1 py-0.5" />
                    {/* Signature vide */}
                    <td className="border border-slate-400 px-1 py-0.5" />
                  </tr>,
                ];
              })}

              {/* 2) Matières non groupées (hors BILAN) */}
              {subjects
                .filter((s) => !groupedSubjectIds.has(s.subject_id))
                .map((s) => renderSubjectBlock(s))}
            </>
          ) : (
            // Pas de groupes configurés : on affiche simplement toutes les matières
            subjects.map((s) => renderSubjectBlock(s))
          )}

          <tr className="bg-slate-50 font-semibold">
            <td className="border border-slate-400 px-1 py-0.5 text-right">
              Totaux
            </td>
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5 text-center">
              {formatNumber(coeffTotal, 0)}
            </td>
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5" />
          </tr>
        </tbody>
      </table>

      {/* Bloc assiduité + moyenne + résultats de la classe */}
      <div className="grid grid-cols-3 gap-2 text-[0.7rem]">
        <div className="border border-slate-400 p-2">
          <div className="mb-1 font-semibold">Assiduité / Discipline</div>
          {conduct ? (
            <div className="space-y-1 text-[0.65rem]">
              <div>
                Absences :{" "}
                <span className="font-semibold">
                  {conduct.absence_count ?? 0}
                </span>
                {absenceHours !== null && (
                  <span className="text-[0.6rem] text-slate-500">
                    {" "}
                    ({formatNumber(absenceHours, 1)} h)
                  </span>
                )}
              </div>
              <div>
                Retards :{" "}
                <span className="font-semibold">
                  {conduct.tardy_count ?? 0}
                </span>
                {typeof conduct.tardy_minutes === "number" &&
                  conduct.tardy_minutes > 0 && (
                    <span className="text-[0.6rem] text-slate-500">
                      {" "}
                      ({formatNumber(conduct.tardy_minutes / 60, 1)} h)
                    </span>
                  )}
              </div>
              <div className="mt-1">
                Note de conduite :{" "}
                <span className="font-semibold">
                  {formatNumber(conduct.total)} / {conductTotalMax ?? 20}
                </span>
                {conduct.appreciation && (
                  <span> — {conduct.appreciation}</span>
                )}
              </div>
              <div className="mt-1 text-[0.6rem] text-slate-500">
                Détail : Assiduité {formatNumber(conduct.breakdown.assiduite)} /{" "}
                {conductRubricMax?.assiduite ?? 6}
                {", "}Tenue {formatNumber(conduct.breakdown.tenue)} /{" "}
                {conductRubricMax?.tenue ?? 3}
                {", "}Moralité {formatNumber(conduct.breakdown.moralite)} /{" "}
                {conductRubricMax?.moralite ?? 4}
                {", "}Discipline {formatNumber(
                  conduct.breakdown.discipline
                )} / {conductRubricMax?.discipline ?? 7}
              </div>
            </div>
          ) : (
            <div className="text-[0.65rem] text-slate-500">
              Total d&apos;absences, retards, justifications… (à compléter).
            </div>
          )}
        </div>

        <div className="border border-slate-400 p-2">
          <div className="mb-1 font-semibold">Moyenne trimestrielle</div>
          <div>
            Moyenne :{" "}
            <span className="font-bold">
              {formatNumber(item.general_avg)} / 20
            </span>
          </div>
          <div>
            Rang :{" "}
            <span className="font-bold">
              {item.rank ? `${item.rank}e` : "—"} / {total}
            </span>
          </div>
        </div>

        <div className="border border-slate-400 p-2">
          <div className="mb-1 font-semibold">Résultats de la classe</div>
          <div>Moyenne générale : {formatNumber(stats.classAvg)}</div>
          <div>Moyenne la plus forte : {formatNumber(stats.highest)}</div>
          <div>Moyenne la plus faible : {formatNumber(stats.lowest)}</div>
        </div>
      </div>

      {/* Bloc mentions + appréciations */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem]">
        <div className="min-h-[80px] border border-slate-400 p-2">
          <div className="mb-1 font-semibold uppercase">
            Mentions du conseil de classe
          </div>
          <div className="mb-1 text-[0.65rem] font-semibold">
            Distinctions
          </div>
          <ul className="mb-2 space-y-1 text-[0.65rem]">
            <li>
              {tick(mentions.distinction === "honour")} Tableau d&apos;honneur /
              Félicitations
            </li>
            <li>
              {tick(mentions.distinction === "excellence")} Tableau d&apos;
              excellence
            </li>
            <li>
              {tick(mentions.distinction === "encouragement")} Tableau
              d&apos;encouragement
            </li>
          </ul>
          <div className="mb-1 text-[0.65rem] font-semibold">Sanctions</div>
          <ul className="space-y-1 text-[0.65rem]">
            <li>
              {tick(mentions.sanction === "warningWork")} Avertissement travail
            </li>
            <li>
              {tick(mentions.sanction === "warningConduct")}
              {" Avertissement conduite"}
            </li>
            <li>
              {tick(mentions.sanction === "blameWork")} Blâme travail
            </li>
            <li>
              {tick(mentions.sanction === "blameConduct")} Blâme conduite
            </li>
          </ul>
        </div>
        <div className="min-h-[80px] border border-slate-400 p-2">
          <div className="mb-1 font-semibold uppercase">
            Appréciations du conseil de classe
          </div>
          <div className="text-[0.65rem] text-slate-500">
            Appréciation générale du travail de l&apos;élève à renseigner
            manuellement (ex. : « Assez bien », « Peut mieux faire », …).
          </div>
        </div>
      </div>

      {/* Bloc signatures */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[0.7rem]">
        <div className="flex min-h-[80px] flex-col justify-between border border-slate-400 p-2">
          <div className="mb-1 font-semibold text-[0.65rem]">
            Visa du professeur principal
          </div>
          {classInfo.head_teacher?.display_name && (
            <div className="mt-4 text-center text-[0.65rem]">
              {classInfo.head_teacher.display_name}
            </div>
          )}
        </div>
        <div className="flex min-h-[80px] flex-col justify-between border border-slate-400 p-2">
          <div className="mb-1 font-semibold text-[0.65rem]">
            Visa du chef d&apos;établissement
          </div>
          {institution?.institution_head_name && (
            <div className="mt-4 text-center text-[0.65rem]">
              {institution.institution_head_name}
              {institution.institution_head_title && (
                <div className="text-[0.6rem] text-slate-500">
                  {institution.institution_head_title}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex min-h-[80px] flex-col justify-between border border-slate-400 p-2">
          <div className="mb-1 font-semibold text-[0.65rem]">
            Signature des parents / tuteur
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[0.65rem] text-slate-500">
        <div>
          Fait à ......................................, le
          ...........................................
        </div>
        <div className="text-[0.6rem] text-slate-400">
          Bulletin généré avec Mon Cahier – Nexa Digitale
        </div>
      </div>
    </div>
  );
}

/* ───────── Page principale ───────── */

export default function BulletinsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  const [institution, setInstitution] = useState<InstitutionSettings | null>(
    null
  );
  const [institutionLoading, setInstitutionLoading] = useState(false);

  const [selectedClassId, setSelectedClassId] = useState<string>("");

  // Filtres de période
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>("");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [bulletinRaw, setBulletinRaw] = useState<BulletinResponse | null>(null);
  const [bulletinLoading, setBulletinLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Résumé conduite / assiduité par élève (note + absences/retards)
  const [conductSummary, setConductSummary] =
    useState<ConductSummaryResponse | null>(null);

  /* Chargement des classes */
  useEffect(() => {
    const run = async () => {
      try {
        setClassesLoading(true);
        const res = await fetch("/api/admin/classes");
        if (!res.ok) {
          throw new Error(`Erreur classes: ${res.status}`);
        }
        const json = await res.json();
        const items: ClassRow[] = Array.isArray(json)
          ? json
          : Array.isArray(json.items)
          ? json.items
          : [];
        setClasses(items);
        if (items.length > 0 && !selectedClassId) {
          setSelectedClassId(items[0].id);
        }
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e.message || "Erreur lors du chargement des classes.");
      } finally {
        setClassesLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Quand on change de classe, si l'année scolaire est connue, on la sélectionne par défaut
     et on reset la période + les dates pour rester cohérent avec le filtre Année/Période. */
  useEffect(() => {
    const cls = classes.find((c) => c.id === selectedClassId);
    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
      setSelectedPeriodId("");
      setDateFrom("");
      setDateTo("");
    }
  }, [selectedClassId, classes]);

  /* Chargement des infos établissement (logo, nom...) */
  useEffect(() => {
    const run = async () => {
      try {
        setInstitutionLoading(true);
        const res = await fetch("/api/admin/institution/settings");
        if (!res.ok) return; // pas bloquant
        const json = await res.json();
        setInstitution(json as InstitutionSettings);
      } catch (e) {
        console.error(e);
      } finally {
        setInstitutionLoading(false);
      }
    };
    run();
  }, []);

  /* Chargement des périodes (trimestres / séquences) pour l'année sélectionnée. */
  useEffect(() => {
    const run = async () => {
      try {
        setPeriodsLoading(true);

        const params = new URLSearchParams();
        if (selectedAcademicYear) {
          params.set("academic_year", selectedAcademicYear);
        }

        const qs = params.toString();
        const url =
          "/api/admin/institution/grading-periods" + (qs ? `?${qs}` : "");

        const res = await fetch(url);
        if (!res.ok) {
          console.warn(
            "[Bulletins] grading-periods non disponible",
            res.status
          );
          setPeriods([]);
          return;
        }

        const json = await res.json();
        const items: GradePeriod[] = Array.isArray(json)
          ? json
          : Array.isArray(json.items)
          ? json.items
          : [];
        setPeriods(items);
      } catch (e) {
        console.error("[Bulletins] erreur chargement periods", e);
        setPeriods([]);
      } finally {
        setPeriodsLoading(false);
      }
    };

    run();
  }, [selectedAcademicYear]);

  /* Années scolaires disponibles */
  const academicYears = useMemo(() => {
    const set = new Set<string>();

    // 1) Années trouvées sur les classes
    classes.forEach((c) => {
      if (c.academic_year) {
        set.add(c.academic_year);
      }
    });

    // 2) Années trouvées sur les périodes déjà chargées
    periods.forEach((p: GradePeriod) => {
      if (p.academic_year) {
        set.add(p.academic_year);
      }
    });

    return Array.from(set).sort();
  }, [classes, periods]);

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
    setDateFrom(p.start_date || "");
    setDateTo(p.end_date || "");
  }, [selectedPeriodId, periods]);

  const handleLoadBulletin = async () => {
    setErrorMsg(null);
    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }
    if (!dateFrom || !dateTo) {
      setErrorMsg("Veuillez choisir une période (dates du bulletin).");
      return;
    }

    try {
      setBulletinLoading(true);
      setConductSummary(null);

      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("from", dateFrom);
      params.set("to", dateTo);

      const [resBulletin, resConduct] = await Promise.all([
        fetch(`/api/admin/grades/bulletin?${params.toString()}`),
        fetch(`/api/admin/conduite/averages?${params.toString()}`),
      ]);

      if (!resBulletin.ok) {
        const txt = await resBulletin.text();
        throw new Error(
          `Erreur bulletin (${resBulletin.status}) : ${
            txt || "Impossible de générer le bulletin."
          }`
        );
      }

      const json = (await resBulletin.json()) as BulletinResponse;
      if (!json.ok) {
        throw new Error("Réponse bulletin invalide (ok = false).");
      }
      setBulletinRaw(json);

      if (resConduct.ok) {
        try {
          const conductJson =
            (await resConduct.json()) as ConductSummaryResponse;
          if (conductJson && Array.isArray(conductJson.items)) {
            setConductSummary(conductJson);
          }
        } catch (err) {
          console.warn(
            "[Bulletins] Impossible de lire le résumé de conduite",
            err
          );
        }
      } else {
        console.warn(
          "[Bulletins] /api/admin/conduite/averages a renvoyé",
          resConduct.status
        );
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(
        e?.message || "Une erreur est survenue lors du chargement du bulletin."
      );
    } finally {
      setBulletinLoading(false);
    }
  };

  const enriched = useMemo(
    () => computeRanksAndStats(bulletinRaw),
    [bulletinRaw]
  );

  // Index conduite par élève pour rattacher les infos au bulletin
  const conductByStudentId = useMemo(() => {
    const map = new Map<string, ConductItem>();
    if (!conductSummary || !Array.isArray(conductSummary.items)) return map;
    conductSummary.items.forEach((it) => {
      map.set(it.student_id, it);
    });
    return map;
  }, [conductSummary]);

  const conductRubricMax = conductSummary?.rubric_max;
  const conductTotalMax = conductSummary?.total_max;

  const items = enriched?.items ?? [];
  const stats = enriched?.stats ?? {
    highest: null,
    lowest: null,
    classAvg: null,
  };
  const classInfo = enriched?.response.class;
  const period = enriched?.response.period ?? {
    from: null,
    to: null,
  };
  const subjects = enriched?.response.subjects ?? [];
  const subjectComponents = enriched?.response.subject_components ?? [];
  const subjectGroups = enriched?.response.subject_groups ?? [];

  const handlePrint = () => {
    if (!items.length) return;
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      {/* Header + actions (non imprimé) */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Bulletins de notes
          </h1>
          <p className="text-sm text-slate-500">
            Générer un bulletin simplifié par élève, basé sur les notes
            publiées.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleLoadBulletin}
            disabled={bulletinLoading || !selectedClassId}
          >
            <RefreshCw className="h-4 w-4" />
            Recharger
          </Button>
          <Button
            type="button"
            onClick={handlePrint}
            disabled={!items.length}
            title={
              items.length
                ? "Imprimer les bulletins"
                : "Aucun bulletin à imprimer"
            }
          >
            <Printer className="h-4 w-4" />
            Imprimer
          </Button>
        </div>
      </div>

      {/* Filtres */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden md:grid-cols-6">
        {/* Année scolaire */}
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Année scolaire
          </label>
          <Select
            value={selectedAcademicYear}
            onChange={(e) => {
              const year = e.target.value;
              setSelectedAcademicYear(year);
              setSelectedPeriodId("");
              setDateFrom("");
              setDateTo("");
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
          <p className="mt-1 text-[0.7rem] text-slate-500">
            Filtre les périodes ci-dessous. Si vous choisissez une période, les
            dates sont remplies automatiquement.
          </p>
        </div>

        {/* Période */}
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Période (trimestre / séquence)
          </label>
          <Select
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            disabled={periodsLoading || filteredPeriods.length === 0}
          >
            <option value="">
              {filteredPeriods.length === 0
                ? "Aucune période"
                : "Sélectionner une période…"}
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
          <p className="mt-1 text-[0.7rem] text-slate-500">
            La sélection d&apos;une période positionne automatiquement les dates
            de début et de fin du bulletin.
          </p>
        </div>

        {/* Classe */}
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Classe
          </label>
          <Select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            disabled={classesLoading}
          >
            <option value="">Sélectionner une classe…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.level ? ` (${c.level})` : ""}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[0.7rem] text-slate-500">
            Changer de classe met à jour l&apos;année scolaire par défaut et vous
            laisse choisir la période.
          </p>
        </div>

        {/* Dates */}
        <div className="md:col-span-3">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Date de début
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="md:col-span-3">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Date de fin
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
          {errorMsg}
        </div>
      )}

      {bulletinLoading && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 print:hidden">
          Chargement du bulletin…
        </div>
      )}

      {/* Résumé (non imprimé) */}
      {enriched && classInfo && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">
                Classe : {classInfo.label}
                {classInfo.academic_year && ` • ${classInfo.academic_year}`}
              </div>
              {period.from && period.to && (
                <div>
                  Période : {period.label || period.short_label || ""} (
                  {period.from} → {period.to})
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <div>
                Moyenne classe :{" "}
                <span className="font-semibold">
                  {formatNumber(stats.classAvg)}
                </span>
              </div>
              <div>
                Max :{" "}
                <span className="font-semibold">
                  {formatNumber(stats.highest)}
                </span>
              </div>
              <div>
                Min :{" "}
                <span className="font-semibold">
                  {formatNumber(stats.lowest)}
                </span>
              </div>
              <div>
                Effectif :{" "}
                <span className="font-semibold">{items.length}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulletins par élève (imprimables) */}
      {items.length === 0 && !bulletinLoading && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">
          Aucun bulletin à afficher. Choisissez une classe, une année scolaire,
          une période puis cliquez sur{" "}
          <span className="font-semibold">Recharger</span>.
        </div>
      )}

      {items.length > 0 &&
        enriched &&
        classInfo &&
        items.map((it, idx) => (
          <StudentBulletinCard
            key={it.student_id}
            index={idx}
            total={items.length}
            item={it}
            subjects={subjects}
            subjectComponents={subjectComponents}
            subjectGroups={subjectGroups}
            classInfo={classInfo}
            period={period}
            institution={institution}
            stats={stats}
            conduct={conductByStudentId.get(it.student_id) || null}
            conductRubricMax={conductRubricMax}
            conductTotalMax={conductTotalMax}
          />
        ))}

      {/* Note bas de page (non imprimée) */}
      <div className="mt-4 text-center text-[0.65rem] text-slate-400 print:hidden">
        Bulletin généré automatiquement à partir des notes publiées et du
        résumé de conduite. Les appréciations détaillées restent à compléter
        par les équipe pédagogique.
      </div>
    </div>
  );
}
