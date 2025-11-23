// src/app/admin/bulletins/page.tsx
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

type BulletinItemBase = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  per_subject: { subject_id: string; avg20: number | null }[];
  per_group: { group_id: string; group_avg: number | null }[];
  general_avg: number | null;
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
  classInfo: BulletinResponse["class"];
  period: BulletinResponse["period"];
  institution: InstitutionSettings | null;
  stats: ClassStats;
};

function StudentBulletinCard({
  index,
  total,
  item,
  subjects,
  classInfo,
  period,
  institution,
  stats,
}: StudentBulletinCardProps) {
  const coeffTotal = useMemo(
    () =>
      subjects.reduce(
        (acc, s) => acc + (Number.isFinite(s.coeff_bulletin) ? s.coeff_bulletin : 0),
        0
      ),
    [subjects]
  );

  return (
    <div
      className="mb-6 border border-slate-400 bg-white p-4 text-xs shadow-sm print:mb-0"
      style={{ pageBreakAfter: "always" }}
    >
      {/* En-tête établissement */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-400 pb-2 mb-2">
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
              {institution.institution_phone && institution.institution_email && " • "}
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

      {/* Tableau disciplines */}
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

            return (
              <tr key={s.subject_id}>
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
            );
          })}
          <tr className="bg-slate-50 font-semibold">
            <td className="border border-slate-400 px-1 py-0.5 text-right">
              Totaux
            </td>
            <td className="border border-slate-400 px-1 py-0.5" />
            <td className="border border-slate-400 px-1 py-0.5 text-center">
              {formatNumber(coeffTotal, 0)}
            </td>
            <td className="border border-slate-400 px-1 py-0.5" />
          </tr>
        </tbody>
      </table>

      {/* Bloc moyennes & résultats de la classe */}
      <div className="grid grid-cols-3 gap-2 text-[0.7rem]">
        <div className="border border-slate-400 p-2">
          <div className="font-semibold mb-1">Moyenne trimestrielle</div>
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
          <div className="font-semibold mb-1">Résultats de la classe</div>
          <div>Moyenne générale : {formatNumber(stats.classAvg)}</div>
          <div>Moyenne la plus forte : {formatNumber(stats.highest)}</div>
          <div>Moyenne la plus faible : {formatNumber(stats.lowest)}</div>
        </div>

        <div className="border border-slate-400 p-2">
          <div className="font-semibold mb-1">Observations</div>
          <div className="text-[0.65rem] text-slate-500">
            (Appréciations du conseil de classe, mentions, sanctions… seront
            ajoutées dans une étape suivante.)
          </div>
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
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [bulletinRaw, setBulletinRaw] = useState<BulletinResponse | null>(null);
  const [bulletinLoading, setBulletinLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("from", dateFrom);
      params.set("to", dateTo);

      const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          `Erreur bulletin (${res.status}) : ${
            txt || "Impossible de générer le bulletin."
          }`
        );
      }
      const json = (await res.json()) as BulletinResponse;
      if (!json.ok) {
        throw new Error(json as any);
      }
      setBulletinRaw(json);
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
              items.length ? "Imprimer les bulletins" : "Aucun bulletin à imprimer"
            }
          >
            <Printer className="h-4 w-4" />
            Imprimer
          </Button>
        </div>
      </div>

      {/* Filtres (non imprimés) */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden md:grid-cols-4">
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
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Date de début
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
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
                  Période : {period.label || period.short_label || ""}{" "}
                  ({period.from} → {period.to})
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
                Effectif : <span className="font-semibold">{items.length}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulletins par élève (imprimables) */}
      {items.length === 0 && !bulletinLoading && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">
          Aucun bulletin à afficher. Choisissez une classe et une période puis
          cliquez sur <span className="font-semibold">Recharger</span>.
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
            classInfo={classInfo!}
            period={period}
            institution={institution}
            stats={stats}
          />
        ))}

      {/* Petite note en bas de page (non imprimée) */}
      <div className="mt-4 text-center text-[0.65rem] text-slate-400 print:hidden">
        Première version simplifiée des bulletins. Les blocs d&apos;assiduité,
        mentions et sanctions seront ajoutés dans les prochaines étapes.
      </div>
    </div>
  );
}
