// src/app/admin/notes/bulletins/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw, X } from "lucide-react";

/* ───────── Types ───────── */

type ClassRow = {
  id: string;
  name?: string;
  label?: string | null;
  level?: string | null;
  academic_year?: string | null;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;

  // 🆕 pour l’en-tête officiel façon MEN
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;
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
  subject_rank?: number | null;
  teacher_name?: string | null;
};

type PerGroupAvg = {
  group_id: string;
  group_avg: number | null;
  group_rank?: number | null;
};

type PerSubjectComponentAvg = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
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

  // 🆕 PHOTO (optionnel : si tu ajoutes une url plus tard côté API)
  photo_url?: string | null;

  // ✅ QR renvoyé par l’API (non cassant)
  qr_url?: string | null;
  qr_token?: string | null;

  // ✅ QR PNG généré côté serveur (prioritaire pour print/PDF)
  qr_png?: string | null;

  per_subject: PerSubjectAvg[];
  per_group: PerGroupAvg[];
  general_avg: number | null;
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
    if (g >= 16) distinction = "excellence";
    else if (g >= 14) distinction = "honour";
    else if (g >= 12) distinction = "encouragement";
    else if (g < 8) sanction = "blameWork";
    else if (g < 10) sanction = "warningWork";
  }

  if (
    conductTotal !== null &&
    conductTotal !== undefined &&
    conductTotalMax !== null &&
    conductTotalMax !== undefined &&
    conductTotalMax > 0
  ) {
    const ratio = conductTotal / conductTotalMax;
    if (ratio <= 0.4) sanction = "blameConduct";
    else if (ratio <= 0.6 && !sanction) sanction = "warningConduct";
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
      "bg-white/80 backdrop-blur border border-slate-300 text-slate-700 hover:bg-slate-100 focus:ring-slate-400/30 disabled:opacity-60",
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

function computeSubjectAppreciation(avg: number | null | undefined): string {
  if (avg === null || avg === undefined) return "";
  if (!Number.isFinite(avg)) return "";
  const a = Number(avg);
  if (a >= 18) return "Excellent";
  if (a >= 16) return "TRES bien";
  if (a >= 14) return "Bien";
  if (a >= 12) return "Assez bien";
  if (a >= 10) return "Passable";
  if (a >= 8) return "Insuffisant";
  if (a >= 6) return "Faible";
  return "Blâme";
}

/* ───────── QR Code (fallback client) ───────── */

const QR_SIZE = 58;
const __QR_CACHE = new Map<string, string>();

let __qrLibPromise: Promise<any> | null = null;

async function getQrLib() {
  if (!__qrLibPromise) {
    // @ts-ignore
    __qrLibPromise = import("qrcode");
  }
  return __qrLibPromise;
}

async function generateQrDataUrl(
  text: string,
  size: number = QR_SIZE
): Promise<string | null> {
  const cacheKey = `${size}|${text}`;
  const cached = __QR_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const mod: any = await getQrLib();

    const toDataURL =
      (mod && typeof mod.toDataURL === "function" && mod.toDataURL) ||
      (mod?.default &&
        typeof mod.default.toDataURL === "function" &&
        mod.default.toDataURL);

    if (typeof toDataURL !== "function") return null;

    // ✅ IMPORTANT: margin > 0 (= quiet zone) + ECL plus robuste pour le print
    const url: string = await toDataURL(text, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "Q",
    });

    if (url) __QR_CACHE.set(cacheKey, url);
    return url || null;
  } catch (e) {
    console.warn("[Bulletins] QR indisponible (import qrcode a échoué)", e);
    return null;
  }
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

/* ───────── Rangs groupes de matières ───────── */

function applyGroupRanksFront(items: (BulletinItemBase | BulletinItemWithRank)[]) {
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

function computeRanksAndStats(res: BulletinResponse | null): EnrichedBulletin | null {
  if (!res) return null;
  const items = res.items ?? [];

  const withAvg = items.filter(
    (it) => typeof it.general_avg === "number" && it.general_avg !== null
  );

  const stats: ClassStats = { highest: null, lowest: null, classAvg: null };

  if (!withAvg.length) {
    const itemsWithRank: BulletinItemWithRank[] = items.map((it) => ({
      ...it,
      rank: null,
    }));
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

  applyComponentRanksFront(itemsWithRank);
  applyGroupRanksFront(itemsWithRank);

  return { response: res, items: itemsWithRank, stats };
}

/* ───────── Helpers "bulletin officiel" ───────── */

function periodTitle(period: BulletinResponse["period"]) {
  const t = (period.label || period.short_label || period.code || "").trim();
  if (t) return t;
  return "Trimestre";
}

function safeUpper(s: string) {
  try {
    return s.toUpperCase();
  } catch {
    return s;
  }
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

  const academicYear = classInfo.academic_year || period.academic_year || "";

  const rawSex = item.sex ?? item.gender ?? null;
  const sexLabel = rawSex ? String(rawSex).toUpperCase() : "—";

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
    item.is_boarder == null ? "—" : item.is_boarder ? "Interne" : "Externe";
  const repeaterLabel = formatYesNo(item.is_repeater);
  const assignedLabel = formatYesNo(item.is_assigned ?? item.is_affecte ?? null);

  // Photo (optionnel)
  const photoUrl = item.photo_url || (item as any).student_photo_url || null;

  const subjectCompsBySubject = useMemo(() => {
    const map = new Map<string, BulletinSubjectComponent[]>();
    subjectComponents.forEach((c) => {
      const arr = map.get(c.subject_id) ?? [];
      arr.push(c);
      map.set(c.subject_id, arr);
    });
    map.forEach((arr) =>
      arr.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    );
    return map;
  }, [subjectComponents]);

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

  const perGroupMap = useMemo(() => {
    const m = new Map<
      string,
      { group_avg: number | null; group_rank?: number | null }
    >();
    const per = item.per_group ?? [];
    per.forEach((g) => {
      m.set(g.group_id, {
        group_avg: g.group_avg ?? null,
        group_rank: g.group_rank !== undefined ? g.group_rank : null,
      });
    });
    return m;
  }, [item.per_group]);

  const subjectsById = useMemo(() => {
    const m = new Map<string, BulletinSubject>();
    subjects.forEach((s) => m.set(s.subject_id, s));
    return m;
  }, [subjects]);

  const absenceHours =
    conduct && typeof conduct.absence_minutes === "number"
      ? conduct.absence_minutes / 60
      : null;

  const mentions = computeCouncilMentions(
    item.general_avg,
    conduct?.total ?? null,
    conductTotalMax ?? null
  );

  const tick = (checked: boolean) => (checked ? "☑" : "□");

  // ✅ QR payload : PRIORITÉ au lien vérifiable de l’API (qr_url)
  const qrText = useMemo(() => {
    const apiUrl = (item.qr_url || "").trim();
    if (apiUrl) return apiUrl;

    const payload = {
      v: 1,
      inst: (institution?.institution_code || "").trim() || undefined,
      year: academicYear || undefined,
      class_id: classInfo.id,
      from: period.from,
      to: period.to,
      student_id: item.student_id,
      matricule: item.matricule || undefined,
    };
    return JSON.stringify(payload);
  }, [
    item.qr_url,
    institution?.institution_code,
    academicYear,
    classInfo.id,
    period.from,
    period.to,
    item.student_id,
    item.matricule,
  ]);

  // ✅ priorité print: qr_png (serveur). fallback: génération client
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Si l’API fournit déjà un PNG (idéal pour print/PDF), on ne génère rien côté client
    if (item.qr_png) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const url = await generateQrDataUrl(qrText, QR_SIZE);
      if (!cancelled) setQrDataUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [qrText, item.qr_png]);

  const qrImgSrc = item.qr_png || qrDataUrl;

  const renderSignatureLine = () => (
    <div className="flex h-[14px] items-end">
      <div className="w-full border-t border-black" />
    </div>
  );

  const perSubject = item.per_subject ?? [];

  const renderSubjectBlock = (s: BulletinSubject) => {
    const cell = perSubject.find((ps) => ps.subject_id === s.subject_id);
    const avg = cell?.avg20 ?? null;
    const moyCoeff = avg !== null ? round2(avg * (s.coeff_bulletin || 0)) : null;

    const subjectRankLabel =
      cell && cell.subject_rank != null ? `${cell.subject_rank}e` : "—";
    const subjectTeacher = cell?.teacher_name || "";
    const appreciationLabel = computeSubjectAppreciation(avg);

    const subComps = subjectCompsBySubject.get(s.subject_id) ?? [];

    return (
      <React.Fragment key={s.subject_id}>
        <tr>
          <td className="bdr px-1 py-[1px]">{s.subject_name}</td>
          <td className="bdr px-1 py-[1px] text-center">{formatNumber(avg)}</td>
          <td className="bdr px-1 py-[1px] text-center">
            {formatNumber(s.coeff_bulletin, 0)}
          </td>
          <td className="bdr px-1 py-[1px] text-center">
            {formatNumber(moyCoeff)}
          </td>
          <td className="bdr px-1 py-[1px] text-center">{subjectRankLabel}</td>
          <td className="bdr px-1 py-[1px]">{appreciationLabel}</td>
          <td className="bdr px-1 py-[1px]">{subjectTeacher}</td>
          <td className="bdr px-1 py-[1px]">{renderSignatureLine()}</td>
        </tr>

        {subComps.map((comp) => {
          const key = `${s.subject_id}__${comp.id}`;
          const compCell = perSubjectComponentMap.get(key);
          const cAvg = compCell?.avg20 ?? null;
          const cRank = compCell?.component_rank ?? null;
          const cMoyCoeff =
            cAvg !== null ? round2(cAvg * (comp.coeff_in_subject || 0)) : null;

          return (
            <tr
              key={`${s.subject_id}-${comp.id}`}
              className="text-[9px] text-slate-700"
            >
              <td className="bdr px-1 py-[1px] pl-4">
                {comp.short_label || comp.label}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(cAvg)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(comp.coeff_in_subject, 0)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(cMoyCoeff)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {cRank != null ? `${cRank}e` : "—"}
              </td>
              <td className="bdr px-1 py-[1px]" />
              <td className="bdr px-1 py-[1px]" />
              <td className="bdr px-1 py-[1px]" />
            </tr>
          );
        })}
      </React.Fragment>
    );
  };

  const groupedSubjectIds = new Set<string>();
  const hasGroups = subjectGroups && subjectGroups.length > 0;

  const countryName = safeUpper(
    String((institution?.country_name || "RÉPUBLIQUE DE CÔTE D'IVOIRE").trim())
  );
  const countryMotto = String(
    (institution?.country_motto || "Union - Discipline - Travail").trim()
  );
  const ministryName = safeUpper(
    String(
      (institution?.ministry_name || "MINISTÈRE DE L'ÉDUCATION NATIONALE").trim()
    )
  );

  return (
    <div className="print-page print-break mx-auto bg-white text-black">
      {/* ───────── ENTÊTE OFFICIEL (centre Bulletin) ───────── */}
      <div className="bdr mb-1 p-1">
        <div className="grid grid-cols-3 items-start gap-2">
          {/* Gauche : République / devise / ministère */}
          <div className="text-center text-[9px] leading-tight">
            <div className="font-semibold uppercase">{countryName}</div>
            <div className="text-[8px]">{countryMotto}</div>
            <div className="mt-1 text-[8px] font-semibold uppercase">
              {ministryName}
            </div>
            <div className="mt-1 text-[8px] uppercase">
              {String((institution?.institution_region || "").trim())}
            </div>
          </div>

          {/* Centre : Titre */}
          <div className="text-center">
            <div className="text-[12px] font-bold uppercase leading-tight">
              BULLETIN TRIMESTRIEL DE NOTES
            </div>
            <div className="text-[10px] font-semibold">
              {periodTitle(period)}
            </div>
          </div>

          {/* Droite : Année scolaire + QR */}
          <div className="flex justify-end gap-2">
            <div className="text-right text-[9px] leading-tight">
              <div>Année scolaire</div>
              <div className="font-semibold">{academicYear || "—"}</div>
              {institution?.institution_code && (
                <div className="mt-1 text-[8px]">
                  Code :{" "}
                  <span className="font-semibold">
                    {String(institution.institution_code)}
                  </span>
                </div>
              )}
              {(period.from || period.to) && (
                <div className="mt-1 text-[8px]">
                  {period.from ? formatDateFR(period.from) : "—"} →{" "}
                  {period.to ? formatDateFR(period.to) : "—"}
                </div>
              )}
            </div>

            {/* ✅ QR: priorité au PNG serveur (qr_png), fallback client (qrDataUrl) */}
            <div className="bdr flex h-[58px] w-[58px] items-center justify-center overflow-hidden bg-white">
              {qrImgSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrImgSrc} alt="QR" className="h-[54px] w-[54px]" />
              ) : (
                <div className="text-[8px] text-slate-500">QR</div>
              )}
            </div>
          </div>
        </div>

        {/* Ligne établissement (logo + nom) */}
        <div className="mt-1 grid grid-cols-[72px_1fr] items-center gap-2">
          <div className="bdr flex h-[52px] w-[72px] items-center justify-center overflow-hidden bg-white">
            {institution?.institution_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(institution.institution_logo_url)}
                alt="Logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="text-[8px] text-slate-500">Logo</div>
            )}
          </div>

          <div className="text-center">
            <div className="text-[11px] font-bold uppercase">
              {safeUpper(
                String((institution?.institution_name || "ÉTABLISSEMENT").trim())
              )}
            </div>
            <div className="text-[9px]">
              {String(institution?.institution_postal_address || "")}
              {institution?.institution_phone
                ? ` • Tél : ${institution.institution_phone}`
                : ""}
              {institution?.institution_status
                ? ` • ${institution.institution_status}`
                : ""}
            </div>
          </div>
        </div>
      </div>

      {/* ───────── BLOC IDENTITÉ ÉLÈVE + PHOTO ───────── */}
      <div className="bdr mb-1 p-1">
        <div className="grid grid-cols-[1fr_1fr_1fr_86px] gap-2 text-[9px] leading-tight">
          <div className="space-y-[2px]">
            <div>
              <span className="font-semibold">Nom & prénom(s) : </span>
              <span className="font-bold uppercase">{item.full_name}</span>
            </div>
            <div>
              <span className="font-semibold">Matricule : </span>
              <span>{item.matricule || "—"}</span>
            </div>
            <div>
              <span className="font-semibold">Classe : </span>
              <span>{classInfo.label}</span>
            </div>
            <div>
              <span className="font-semibold">Effectif : </span>
              <span>{total}</span>
            </div>
          </div>

          <div className="space-y-[2px]">
            <div>
              <span className="font-semibold">Sexe : </span>
              <span>{sexLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Né(e) le : </span>
              <span>{birthdateLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Lieu de naissance : </span>
              <span>{birthPlaceLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Nationalité : </span>
              <span>{nationalityLabel}</span>
            </div>
          </div>

          <div className="space-y-[2px]">
            <div>
              <span className="font-semibold">Régime : </span>
              <span>{regimeLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Internat : </span>
              <span>{boarderLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Redoublant(e) : </span>
              <span>{repeaterLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Affecté(e) : </span>
              <span>{assignedLabel}</span>
            </div>

            {classInfo.head_teacher?.display_name && (
              <div className="pt-[2px]">
                <span className="font-semibold">Prof. principal : </span>
                <span>{classInfo.head_teacher.display_name}</span>
              </div>
            )}

            {institution?.institution_head_name && (
              <div className="pt-[2px]">
                <span className="font-semibold">Chef d&apos;établissement : </span>
                <span>{institution.institution_head_name}</span>
              </div>
            )}
          </div>

          {/* PHOTO */}
          <div className="bdr flex h-[96px] w-[86px] items-center justify-center overflow-hidden">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Photo élève"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="text-center text-[8px] text-slate-500">Photo</div>
            )}
          </div>
        </div>
      </div>

      {/* ───────── TABLEAU DISCIPLINES ───────── */}
      <table className="bdr w-full text-[9px] leading-tight">
        <thead>
          <tr className="bg-slate-100">
            <th className="bdr px-1 py-[2px] text-left">DISCIPLINES</th>
            <th className="bdr px-1 py-[2px] text-center">Moy.</th>
            <th className="bdr px-1 py-[2px] text-center">Coef.</th>
            <th className="bdr px-1 py-[2px] text-center">Total</th>
            <th className="bdr px-1 py-[2px] text-center">Rang</th>
            <th className="bdr px-1 py-[2px] text-left">Appréciations</th>
            <th className="bdr px-1 py-[2px] text-left">Professeurs</th>
            <th className="bdr px-1 py-[2px] text-center">Signature</th>
          </tr>
        </thead>
        <tbody>
          {hasGroups ? (
            <>
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
                  groupAvg !== null && groupCoeff ? round2(groupAvg * groupCoeff) : null;

                const bilanLabel = (g.label || g.code || "BILAN").toUpperCase();

                return [
                  ...groupSubjects.map((s) => renderSubjectBlock(s)),
                  <tr key={`group-${g.id}`} className="bg-slate-50 font-bold">
                    <td className="bdr px-1 py-[1px]">{bilanLabel}</td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {formatNumber(groupAvg)}
                    </td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {groupCoeff ? formatNumber(groupCoeff, 0) : ""}
                    </td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {groupCoeff ? formatNumber(groupTotal) : ""}
                    </td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {groupRankLabel}
                    </td>
                    <td className="bdr px-1 py-[1px]" />
                    <td className="bdr px-1 py-[1px]" />
                    <td className="bdr px-1 py-[1px]">{renderSignatureLine()}</td>
                  </tr>,
                ];
              })}

              {subjects
                .filter((s) => !groupedSubjectIds.has(s.subject_id))
                .map((s) => renderSubjectBlock(s))}
            </>
          ) : (
            subjects.map((s) => renderSubjectBlock(s))
          )}

          <tr className="bg-slate-50 font-bold">
            <td className="bdr px-1 py-[1px] text-right">TOTAUX :</td>
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px] text-center">
              {formatNumber(coeffTotal, 0)}
            </td>
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
          </tr>
        </tbody>
      </table>

      {/* ───────── BLOCS BAS (comme modèle) ───────── */}
      <div className="mt-1 grid grid-cols-3 gap-2 text-[9px] leading-tight">
        <div className="bdr p-1">
          <div className="font-semibold">Assiduité</div>
          {conduct ? (
            <div className="mt-[2px] space-y-[2px]">
              <div>
                Absences :{" "}
                <span className="font-semibold">{conduct.absence_count ?? 0}</span>
                {absenceHours !== null && (
                  <span className="text-[8px] text-slate-600">
                    {" "}
                    ({formatNumber(absenceHours, 1)} h)
                  </span>
                )}
              </div>
              <div>
                Retards :{" "}
                <span className="font-semibold">{conduct.tardy_count ?? 0}</span>
              </div>
              <div className="pt-[2px]">
                Note de conduite :{" "}
                <span className="font-semibold">
                  {formatNumber(conduct.total)} / {conductTotalMax ?? 20}
                </span>
              </div>

              {conductRubricMax && conduct?.breakdown && (
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-[2px] text-[8px] text-slate-700">
                  <div>
                    Assiduité : {conduct.breakdown.assiduite} / {conductRubricMax.assiduite}
                  </div>
                  <div>
                    Tenue : {conduct.breakdown.tenue} / {conductRubricMax.tenue}
                  </div>
                  <div>
                    Moralité : {conduct.breakdown.moralite} / {conductRubricMax.moralite}
                  </div>
                  <div>
                    Discipline : {conduct.breakdown.discipline} / {conductRubricMax.discipline}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-[2px] text-[8px] text-slate-600">
              Données de conduite indisponibles.
            </div>
          )}
        </div>

        <div className="bdr p-1 text-center">
          <div className="font-semibold">Moyenne trimestrielle</div>
          <div className="mt-[3px] text-[10px] font-bold">
            {formatNumber(item.general_avg)} / 20
          </div>
          <div className="mt-[2px]">
            Rang :{" "}
            <span className="font-semibold">{item.rank ? `${item.rank}e` : "—"}</span>{" "}
            / {total}
          </div>
        </div>

        <div className="bdr p-1">
          <div className="font-semibold">Résultats de la classe</div>
          <div className="mt-[2px] space-y-[2px]">
            <div>Moyenne générale : {formatNumber(stats.classAvg)}</div>
            <div>Moyenne maxi : {formatNumber(stats.highest)}</div>
            <div>Moyenne mini : {formatNumber(stats.lowest)}</div>
          </div>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-2 text-[9px] leading-tight">
        <div className="bdr p-1">
          <div className="font-semibold uppercase">Mentions du conseil de classe</div>
          <div className="mt-[2px] text-[8px] font-semibold">DISTINCTIONS</div>
          <div className="mt-[2px] space-y-[2px] text-[8px]">
            <div>
              {tick(mentions.distinction === "honour")} Tableau d&apos;honneur / Félicitations
            </div>
            <div>{tick(mentions.distinction === "excellence")} Tableau d&apos;excellence</div>
            <div>
              {tick(mentions.distinction === "encouragement")} Tableau d&apos;encouragement
            </div>
          </div>
          <div className="mt-2 text-[8px] font-semibold">SANCTIONS</div>
          <div className="mt-[2px] space-y-[2px] text-[8px]">
            <div>{tick(mentions.sanction === "warningWork")} Avertissement travail</div>
            <div>{tick(mentions.sanction === "warningConduct")} Avertissement conduite</div>
            <div>{tick(mentions.sanction === "blameWork")} Blâme travail</div>
            <div>{tick(mentions.sanction === "blameConduct")} Blâme conduite</div>
          </div>
        </div>

        <div className="bdr p-1">
          <div className="font-semibold uppercase">Appréciations du conseil de classe</div>
          <div className="mt-2 h-[62px] bdr bg-white" />
        </div>
      </div>

      {/* ✅ VISAS : on garde Prof Principal + Chef, et on retire VISA PARENT */}
      <div className="mt-1 grid grid-cols-2 gap-2 text-[9px] leading-tight">
        <div className="bdr flex flex-col justify-between p-1">
          <div className="font-semibold text-[8px]">Visa du professeur principal</div>
          <div className="h-[44px]" />
          {classInfo.head_teacher?.display_name && (
            <div className="text-center text-[8px]">{classInfo.head_teacher.display_name}</div>
          )}
        </div>

        <div className="bdr flex flex-col justify-between p-1">
          <div className="font-semibold text-[8px]">Visa du chef d&apos;établissement</div>
          <div className="h-[44px]" />
          {institution?.institution_head_name && (
            <div className="text-center text-[8px]">
              {institution.institution_head_name}
              {institution?.institution_head_title ? (
                <div className="text-[7px] text-slate-600">{institution.institution_head_title}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 text-[8px] text-black">
        Fait à ......................................, le ...........................................
      </div>
    </div>
  );
}

/* ───────── Page principale ───────── */

export default function BulletinsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [institutionLoading, setInstitutionLoading] = useState(false);

  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>("");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [bulletinRaw, setBulletinRaw] = useState<BulletinResponse | null>(null);
  const [bulletinLoading, setBulletinLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [conductSummary, setConductSummary] = useState<ConductSummaryResponse | null>(null);

  // ✅ Aperçu “clean” : plein écran A4 (uniquement le bulletin)
  const [previewOpen, setPreviewOpen] = useState(false);

  // ✅ FIX responsive preview (mobile) : on “scale” la feuille A4 à l’écran
  const [previewZoom, setPreviewZoom] = useState<number>(1);

  const computePreviewZoom = () => {
    if (typeof window === "undefined") return 1;

    // largeur A4 (210mm) ≈ 793.7px en CSS (96dpi)
    const A4_PX = (210 / 25.4) * 96;

    const vw = window.innerWidth || 0;
    const padding = vw < 768 ? 16 : 64; // marge “overlay”
    const avail = Math.max(240, vw - padding);

    const z = Math.min(1, avail / A4_PX);
    return Math.max(0.25, Number.isFinite(z) ? z : 1);
  };

  useEffect(() => {
    if (!previewOpen) return;
    const update = () => setPreviewZoom(computePreviewZoom());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [previewOpen]);

  /* Chargement des classes */
  useEffect(() => {
    const run = async () => {
      try {
        setClassesLoading(true);
        const res = await fetch("/api/admin/classes");
        if (!res.ok) throw new Error(`Erreur classes: ${res.status}`);
        const json = await res.json();
        const items: ClassRow[] = Array.isArray(json)
          ? json
          : Array.isArray(json.items)
          ? json.items
          : [];
        setClasses(items);
        if (items.length > 0 && !selectedClassId) setSelectedClassId(items[0].id);
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

  useEffect(() => {
    const cls = classes.find((c) => c.id === selectedClassId);
    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
      setSelectedPeriodId("");
      setDateFrom("");
      setDateTo("");
    }
  }, [selectedClassId, classes]);

  /* Chargement infos établissement */
  useEffect(() => {
    const run = async () => {
      try {
        setInstitutionLoading(true);
        const res = await fetch("/api/admin/institution/settings");
        if (!res.ok) return;
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

  /* Chargement périodes */
  useEffect(() => {
    const run = async () => {
      try {
        setPeriodsLoading(true);

        const params = new URLSearchParams();
        if (selectedAcademicYear) params.set("academic_year", selectedAcademicYear);

        const qs = params.toString();
        const url =
          "/api/admin/institution/grading-periods" + (qs ? `?${qs}` : "");

        const res = await fetch(url);
        if (!res.ok) {
          console.warn("[Bulletins] grading-periods non disponible", res.status);
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

  const academicYears = useMemo(() => {
    const set = new Set<string>();
    classes.forEach((c) => c.academic_year && set.add(c.academic_year));
    periods.forEach((p) => p.academic_year && set.add(p.academic_year));
    return Array.from(set).sort();
  }, [classes, periods]);

  const filteredPeriods = useMemo(() => {
    if (!selectedAcademicYear) return periods;
    return periods.filter((p) => p.academic_year === selectedAcademicYear);
  }, [periods, selectedAcademicYear]);

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
          `Erreur bulletin (${resBulletin.status}) : ${txt || "Impossible de générer le bulletin."}`
        );
      }

      const json = (await resBulletin.json()) as BulletinResponse;
      if (!json.ok) throw new Error("Réponse bulletin invalide (ok = false).");

      // ✅ AJOUT DEBUG demandé
      const data = json as any;
      console.log("[BULLETIN] sample qr_url:", data?.items?.[0]?.qr_url);
      console.log("[BULLETIN] sample qr_token:", data?.items?.[0]?.qr_token);
      console.log("[BULLETIN] sample qr_png:", data?.items?.[0]?.qr_png);

      setBulletinRaw(json);

      if (resConduct.ok) {
        try {
          const conductJson = (await resConduct.json()) as ConductSummaryResponse;
          if (conductJson && Array.isArray(conductJson.items))
            setConductSummary(conductJson);
        } catch (err) {
          console.warn("[Bulletins] Impossible de lire le résumé de conduite", err);
        }
      } else {
        console.warn(
          "[Bulletins] /api/admin/conduite/averages a renvoyé",
          resConduct.status
        );
      }

      // ✅ ouvre automatiquement l’aperçu “clean” (uniquement bulletin)
      setPreviewOpen(true);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(
        e?.message || "Une erreur est survenue lors du chargement du bulletin."
      );
    } finally {
      setBulletinLoading(false);
    }
  };

  const enriched = useMemo(() => computeRanksAndStats(bulletinRaw), [bulletinRaw]);

  const conductByStudentId = useMemo(() => {
    const map = new Map<string, ConductItem>();
    if (!conductSummary || !Array.isArray(conductSummary.items)) return map;
    conductSummary.items.forEach((it) => map.set(it.student_id, it));
    return map;
  }, [conductSummary]);

  const conductRubricMax = conductSummary?.rubric_max;
  const conductTotalMax = conductSummary?.total_max;

  const items = enriched?.items ?? [];
  const stats = enriched?.stats ?? { highest: null, lowest: null, classAvg: null };
  const classInfo = enriched?.response.class;
  const period = enriched?.response.period ?? { from: null, to: null };
  const subjects = enriched?.response.subjects ?? [];
  const subjectComponents = enriched?.response.subject_components ?? [];
  const subjectGroups = enriched?.response.subject_groups ?? [];

  const handlePrint = () => {
    if (!items.length) return;
    if (typeof window !== "undefined") window.print();
  };

  return (
    <>
      {/* Styles A4 : aperçu écran + impression */}
      <style jsx global>{`
        .bdr {
          border: 1px solid #000;
        }

        /* ✅ Aperçu écran : feuille A4 (taille réelle) */
        .print-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          padding: 8mm; /* simule la marge du papier */
          font-family: Arial, Helvetica, sans-serif;
          background: #fff;
        }

        /* ✅ Responsive preview: sur écran (overlay), on scale la feuille */
        .preview-overlay {
          overflow-x: hidden; /* éviter l’impression “coupé” sur mobile */
        }

        @supports (zoom: 1) {
          .preview-overlay .print-page {
            zoom: var(--preview-zoom, 1);
          }
        }

        @supports not (zoom: 1) {
          .preview-overlay .print-page {
            transform: scale(var(--preview-zoom, 1));
            transform-origin: top center;
          }
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          html,
          body {
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* contenu imprimé = zone utile (A4 - marges) */
          .print-page {
            width: 194mm;
            min-height: 281mm;
            margin: 0 auto;
            padding: 0;
            zoom: 1 !important;
            transform: none !important;
          }

          .print-break {
            page-break-after: always;
            break-after: page;
          }

          .print\\:hidden {
            display: none !important;
          }

          /* overlay preview devient "normal" à l’impression */
          .preview-overlay {
            position: static !important;
            inset: auto !important;
            overflow: visible !important;
            background: transparent !important;
            padding: 0 !important;
          }
          .preview-actions {
            display: none !important;
          }
        }
      `}</style>

      {/* ✅ MODE CLEAN : uniquement le bulletin */}
      {previewOpen && items.length > 0 && enriched && classInfo ? (
        <div
          className="preview-overlay fixed inset-0 z-[60] overflow-y-auto bg-slate-200 p-2 md:p-6"
          style={{ ["--preview-zoom" as any]: previewZoom }}
        >
          {/* Actions minimales (écran seulement) */}
          <div className="preview-actions sticky top-2 z-10 mb-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPreviewOpen(false)}
            >
              <X className="h-4 w-4" />
              Fermer
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={handleLoadBulletin}
              disabled={bulletinLoading || !selectedClassId}
            >
              <RefreshCw className="h-4 w-4" />
              Recharger
            </Button>
            <Button type="button" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
          </div>

          {/* Bulletins */}
          <div className="flex flex-col gap-6 pb-6">
            {items.map((it, idx) => (
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
          </div>
        </div>
      ) : (
        /* Mode normal : filtres + génération */
        <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
          {/* Header + actions */}
          <div className="flex items-center justify-between gap-4 print:hidden">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Bulletins de notes
              </h1>
              <p className="text-sm text-slate-500">
                Charger une classe + période, puis ouvrir l’aperçu A4.
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
                onClick={() => setPreviewOpen(true)}
                disabled={!items.length}
              >
                <Printer className="h-4 w-4" />
                Aperçu / Imprimer
              </Button>
            </div>
          </div>

          {/* Filtres */}
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden md:grid-cols-6">
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
                  {academicYears.length === 0 ? "Non configuré" : "Toutes années…"}
                </option>
                {academicYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[0.7rem] text-slate-500">
                Filtre les périodes. Si vous choisissez une période, les dates sont
                remplies automatiquement.
              </p>
            </div>

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
                La période positionne automatiquement les dates.
              </p>
            </div>

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
                {classes.map((c) => {
                  const label = (c.name || c.label || "").trim();
                  return (
                    <option key={c.id} value={c.id}>
                      {label || "Classe"}
                      {c.level ? ` (${c.level})` : ""}
                    </option>
                  );
                })}
              </Select>
            </div>

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

          {!items.length && !bulletinLoading && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600 print:hidden">
              Aucun bulletin à afficher. Choisissez une classe, une période puis cliquez sur{" "}
              <span className="font-semibold">Recharger</span>.
            </div>
          )}

          <div className="mt-2 text-center text-[0.7rem] text-slate-400 print:hidden">
            {institutionLoading ? "Chargement établissement…" : ""}
          </div>
        </div>
      )}
    </>
  );
}
