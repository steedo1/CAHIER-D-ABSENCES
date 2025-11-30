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

type PerSubjectAvg = { subject_id: string; avg20: number | null };
type PerGroupAvg = { group_id: string; group_avg: number | null };

type PerSubjectComponentAvg = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
};

type BulletinItemBase = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  per_subject: PerSubjectAvg[];
  per_group: PerGroupAvg[];
  general_avg: number | null;
  // ➕ optionnel : moyennes par sous-matière
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
  // ➕ sous-matières renvoyées par l’API (toujours présent côté back, mais on garde optionnel côté TS)
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

  return { response: res, items: itemsWithRank, stats };
}

/* ───────── Student bulletin card ───────── */

type StudentBulletinCardProps = {
  index: number;
  total: number;
  item: BulletinItemWithRank;
  subjects: BulletinSubject[];
  subjectComponents: BulletinSubjectComponent[];
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

  // Map (subject_id + component_id) -> moyenne de l'élève
  const perSubjectComponentMap = useMemo(() => {
    const m = new Map<string, number | null>();
    const per = item.per_subject_components ?? [];
    per.forEach((psc) => {
      const key = `${psc.subject_id}__${psc.component_id}`;
      m.set(key, psc.avg20);
    });
    return m;
  }, [item.per_subject_components]);

  return (
    <div
      className="mb-6 border border-slate-400 bg-white p-4 text-xs shadow-sm print:mb-0"
      style={{ pageBreakAfter: "always" }}
    >
      {/* En-tête établissement */}
      <div className="mb-2 flex items-start justify-between gap-4 border-b border-slate-400 pb-2">
        <div className="flex-1">
          <div className="font-semibold uppercase">
            {institution?.institution_name || "Établissement"}
          </div>
          {institution?.institution_postal_address && (
            <div>{institution.institution_postal_address}</div>
          )}
          {(institution?.institution_phone || institution?.institution_email) && (
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
        <div className="flex flex-col items-end text-right">
          <div className="font-bold uppercase">
            Bulletin de notes trimestriel
          </div>
          <div className="text-[0.7rem]">
            {period.label || period.short_label || "Période"}
            {period.from && period.to && (
              <>
                {" "}
                ({period.from} → {period.to})
              </>
            )}
          </div>
          {classInfo.academic_year && (
            <div className="text-[0.7rem]">
              Année scolaire : {classInfo.academic_year}
            </div>
          )}
          <div className="text-[0.7rem] text-slate-500">
            Élève {index + 1} / {total}
          </div>
        </div>
      </div>

      {/* Bloc élève + classe */}
      <div className="mb-3 grid grid-cols-2 gap-2 border border-slate-400 p-2">
        <div className="space-y-1">
          <div>
            <span className="font-semibold">Nom & prénom(s) : </span>
            <span className="uppercase">{item.full_name}</span>
          </div>
          <div className="flex gap-4">
            <div>
              <span className="font-semibold">Matricule : </span>
              <span>{item.matricule || "—"}</span>
            </div>
          </div>
          <div className="flex gap-4">
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

      {/* Tableau disciplines + sous-matières */}
      <table className="mb-3 w-full border border-slate-400 text-[0.7rem]">
        <thead className="bg-slate-100">
          <tr>
            <th className="border border-slate-400 px-1 py-1 text-left">
              Discipline
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Moy./20
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Coeff
            </th>
            <th className="border border-slate-400 px-1 py-1 text-center">
              Moy. coeff
            </th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((s) => {
            const cell = item.per_subject.find(
              (ps) => ps.subject_id === s.subject_id
            );
            const avg = cell?.avg20 ?? null;
            const moyCoeff =
              avg !== null ? round2(avg * (s.coeff_bulletin || 0)) : null;

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
                </tr>

                {/* Lignes des sous-matières, si présentes */}
                {subComps.map((comp) => {
                  const key = `${s.subject_id}__${comp.id}`;
                  const cAvg = perSubjectComponentMap.get(key) ?? null;
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
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
          <tr className="bg-slate-50 font-semibold">
            <td className="border border-slate-400 px-1 py-0.5 text-right">
              Totaux
            </td>
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5 text-center">
              {formatNumber(
                subjects.reduce(
                  (acc, s) =>
                    acc +
                    (Number.isFinite(s.coeff_bulletin)
                      ? s.coeff_bulletin
                      : 0),
                  0
                ),
                0
              )}
            </td>
            <td className="border border-slate-400 px-1 py-0.5" />
          </tr>
        </tbody>
      </table>

      {/* Bloc moyennes & résultats de la classe */}
      <div className="grid grid-cols-3 gap-2 text-[0.7rem]">
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

        <div className="border border-slate-400 p-2">
          <div className="mb-1 font-semibold">Observations</div>
          <div className="text-[0.65rem] text-slate-500">
            Zone réservée aux appréciations du conseil de classe, mentions et
            sanctions.
          </div>
        </div>
      </div>

      {/* Bloc bilan / discipline / signatures (mise en forme bulletin papier) */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem]">
        <div className="border border-slate-400 p-2 min-h-[80px]">
          <div className="mb-1 font-semibold uppercase">Bilan du trimestre</div>
          <div className="text-[0.65rem] text-slate-500">
            Appréciation générale du travail de l&apos;élève :
          </div>
        </div>
        <div className="border border-slate-400 p-2 min-h-[80px]">
          <div className="mb-1 font-semibold uppercase">
            Discipline / Assiduité
          </div>
          {conduct ? (
            <div className="space-y-1 text-[0.65rem]">
              <div>
                Absences injustifiées :{" "}
                <span className="font-semibold">
                  {conduct.absence_count ?? 0}
                </span>
              </div>
              <div>
                Retards injustifiés :{" "}
                <span className="font-semibold">
                  {conduct.tardy_count ?? 0}
                </span>
              </div>
              <div className="mt-1">
                Note de conduite :{" "}
                <span className="font-semibold">
                  {formatNumber(conduct.total)} /{" "}
                  {conductTotalMax ?? 20}
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
                {", "}Discipline {formatNumber(conduct.breakdown.discipline)} /{" "}
                {conductRubricMax?.discipline ?? 7}
              </div>
            </div>
          ) : (
            <div className="text-[0.65rem] text-slate-500">
              Retards, absences, comportement, sanctions :
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[0.7rem]">
        <div className="border border-slate-400 p-2 min-h-[60px]">
          <div className="mb-1 font-semibold text-[0.65rem]">
            Visa du professeur principal
          </div>
        </div>
        <div className="border border-slate-400 p-2 min-h-[60px]">
          <div className="mb-1 font-semibold text-[0.65rem]">
            Visa du chef d&apos;établissement
          </div>
        </div>
        <div className="border border-slate-400 p-2 min-h-[60px]">
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

  /* Chargement des périodes (trimestres / séquences) pour l'année sélectionnée.
     Si la route n'existe pas ou renvoie une erreur, on garde les dates manuelles. */
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

  /* Années scolaires disponibles
     - à partir des classes (toutes les années de l'établissement)
     - + des périodes déjà chargées, pour être robuste */
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
        fetch(`/api/admin/conduct/summary?${params.toString()}`),
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
          "[Bulletins] /api/admin/conduct/summary a renvoyé",
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

      {/* Filtres : ANNEE SCOLAIRE d’abord, puis PÉRIODE, puis CLASSE, puis dates */}
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

        {/* Période (trimestre / séquence) */}
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

        {/* Dates (toujours visibles, remplies automatiquement si période choisie) */}
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
        items.map((it, idx) => (
          <StudentBulletinCard
            key={it.student_id}
            index={idx}
            total={items.length}
            item={it}
            subjects={subjects}
            subjectComponents={subjectComponents}
            classInfo={classInfo!}
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
        par l&apos;équipe pédagogique.
      </div>
    </div>
  );
}
