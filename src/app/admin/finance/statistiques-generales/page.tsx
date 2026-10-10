"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Printer, RotateCcw } from "lucide-react";

type Student = {
  id: string;
  matricule: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  class_id: string | null;
  class_label: string | null;
  level: string | null;
  gender: string | null;
  birthdate: string | null;
  lv2: string | null;
  is_boarder: boolean | null;
  is_affecte: boolean | null;
  is_scholarship: boolean | null;
  regime: string | null;
};

type Institution = {
  institution_name?: string | null;
  name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;
};

type Choice = "all" | "yes" | "no";
type SexChoice = "all" | "F" | "M";
type Lv2Choice = "all" | "allemand" | "espagnol";
type PrintColumnKey =
  | "number" | "matricule" | "full_name" | "class"
  | "sex" | "age" | "boarding" | "affectation" | "scholarship" | "lv2";

const PRINT_COLUMN_META: Record<PrintColumnKey, { label: string; weight: number; center?: boolean }> = {
  number: { label: "N°", weight: 5, center: true },
  matricule: { label: "Matricule", weight: 14 },
  full_name: { label: "Nom et prénoms", weight: 32 },
  class: { label: "Classe", weight: 10 },
  sex: { label: "Sexe", weight: 6, center: true },
  age: { label: "Âge", weight: 6, center: true },
  boarding: { label: "Régime", weight: 11 },
  affectation: { label: "Affectation", weight: 13 },
  scholarship: { label: "Bourse", weight: 11 },
  lv2: { label: "LV2", weight: 11 },
};

const MON_CAHIER_EXPORT_SIGNATURE =
  "Mon Cahier — La plateforme complète de gestion scolaire | www.mon-cahier.com";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sex(value: unknown): "F" | "M" | null {
  const v = norm(value);
  if (!v) return null;
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m") || v.startsWith("h") || v.startsWith("g")) return "M";
  return null;
}

function lv2(value: unknown): "allemand" | "espagnol" | null {
  const v = norm(value);
  if (!v) return null;
  if (v.includes("allem") || v === "all") return "allemand";
  if (v.includes("esp") || v === "esp") return "espagnol";
  return null;
}

function ageOf(value: string | null | undefined) {
  const raw = clean(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function boolMatches(value: boolean | null, choice: Choice) {
  if (choice === "all") return true;
  return choice === "yes" ? value === true : value === false;
}

function labelBool(value: boolean | null, yes: string, no: string) {
  if (value === true) return yes;
  if (value === false) return no;
  return "—";
}

function printCellValue(key: PrintColumnKey, student: Student, index: number): string | number {
  switch (key) {
    case "number": return index + 1;
    case "matricule": return student.matricule || "—";
    case "full_name": return student.full_name;
    case "class": return student.class_label || "—";
    case "sex": return sex(student.gender) || "—";
    case "age": return ageOf(student.birthdate) ?? "—";
    case "boarding": return labelBool(student.is_boarder, "Interne", "Externe");
    case "affectation": return labelBool(student.is_affecte, "Affecté", "Non affecté");
    case "scholarship": return labelBool(student.is_scholarship, "Boursier", "Non boursier");
    case "lv2": return lv2(student.lv2) === "allemand" ? "Allemand"
      : lv2(student.lv2) === "espagnol" ? "Espagnol" : student.lv2 || "—";
  }
}

function displayLevel(value: string | null | undefined) {
  return clean(value) || "—";
}

function sortedUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base", numeric: true }),
  );
}

function filterLabel(args: {
  level: string;
  classLabel: string;
  boarding: Choice;
  affectation: Choice;
  scholarship: Choice;
  gender: SexChoice;
  language: Lv2Choice;
  minAge: string;
  maxAge: string;
}) {
  const out: string[] = [];
  if (args.level !== "all") out.push(`Niveau : ${args.level}`);
  if (args.classLabel) out.push(args.classLabel);
  if (args.boarding === "yes") out.push("Interne");
  if (args.boarding === "no") out.push("Externe");
  if (args.affectation === "yes") out.push("Affecté");
  if (args.affectation === "no") out.push("Non affecté");
  if (args.scholarship === "yes") out.push("Boursier");
  if (args.scholarship === "no") out.push("Non boursier");
  if (args.gender === "F") out.push("Filles");
  if (args.gender === "M") out.push("Garçons");
  if (args.language === "allemand") out.push("Allemand");
  if (args.language === "espagnol") out.push("Espagnol");
  if (args.minAge && args.maxAge) out.push(`${args.minAge}–${args.maxAge} ans`);
  else if (args.minAge) out.push(`≥ ${args.minAge} ans`);
  else if (args.maxAge) out.push(`≤ ${args.maxAge} ans`);
  return out.join(" · ") || "Tous les élèves";
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
      >
        {children}
      </select>
    </label>
  );
}

export default function GeneralStatisticsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [institution, setInstitution] = useState<Institution>({});
  const [academicYear, setAcademicYear] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [printTarget, setPrintTarget] = useState<HTMLElement | null>(null);
  const [level, setLevel] = useState("all");
  const [classId, setClassId] = useState("all");
  const [boarding, setBoarding] = useState<Choice>("all");
  const [affectation, setAffectation] = useState<Choice>("all");
  const [scholarship, setScholarship] = useState<Choice>("all");
  const [gender, setGender] = useState<SexChoice>("all");
  const [language, setLanguage] = useState<Lv2Choice>("all");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");

  useEffect(() => {
    setPrintTarget(document.body);
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, institutionRes] = await Promise.all([
          fetch("/api/admin/statistiques-generales", { cache: "no-store" }),
          fetch("/api/admin/institution/settings", { cache: "no-store" }),
        ]);

        const statsJson = await statsRes.json().catch(() => ({}));
        const institutionJson = await institutionRes.json().catch(() => ({}));

        if (!statsRes.ok) {
          throw new Error(statsJson?.error || "Impossible de charger les statistiques.");
        }
        if (!institutionRes.ok) {
          throw new Error(institutionJson?.error || "Impossible de charger l’établissement.");
        }

        if (!cancelled) {
          setStudents(Array.isArray(statsJson?.items) ? statsJson.items : []);
          setAcademicYear(clean(statsJson?.academic_year));
          setInstitution(institutionJson || {});
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Erreur de chargement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const levels = useMemo(() => sortedUnique(students.map((student) => student.level)), [students]);

  const classes = useMemo(() => {
    const choices = new Map<string, string>();
    for (const student of students) {
      if (student.class_id && (level === "all" || clean(student.level) === level)) {
        choices.set(student.class_id, clean(student.class_label) || student.class_id);
      }
    }
    return Array.from(choices, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { sensitivity: "base", numeric: true }),
    );
  }, [students, level]);
  const selectedClassLabel = classes.find((item) => item.id === classId)?.label || "";

  const filtered = useMemo(() => {
    const min = minAge === "" ? null : Number(minAge);
    const max = maxAge === "" ? null : Number(maxAge);

    return students.filter((student) => {
      if (level !== "all" && clean(student.level) !== level) return false;
      if (classId !== "all" && student.class_id !== classId) return false;
      if (!boolMatches(student.is_boarder, boarding)) return false;
      if (!boolMatches(student.is_affecte, affectation)) return false;
      if (!boolMatches(student.is_scholarship, scholarship)) return false;
      if (gender !== "all" && sex(student.gender) !== gender) return false;
      if (language !== "all" && lv2(student.lv2) !== language) return false;

      if (min !== null || max !== null) {
        const age = ageOf(student.birthdate);
        if (age === null) return false;
        if (min !== null && Number.isFinite(min) && age < min) return false;
        if (max !== null && Number.isFinite(max) && age > max) return false;
      }
      return true;
    });
  }, [students, level, classId, boarding, affectation, scholarship, gender, language, minAge, maxAge]);

  const totals = useMemo(() => {
    let girls = 0;
    let boys = 0;
    for (const student of filtered) {
      const value = sex(student.gender);
      if (value === "F") girls += 1;
      if (value === "M") boys += 1;
    }
    return { girls, boys };
  }, [filtered]);

  const criteria = useMemo(
    () =>
      filterLabel({
        level,
        classLabel: selectedClassLabel,
        boarding,
        affectation,
        scholarship,
        gender,
        language,
        minAge,
        maxAge,
      }),
    [level, classId, selectedClassLabel, boarding, affectation, scholarship, gender, language, minAge, maxAge],
  );

  // Le filtre d'âge compte pour un seul critère, même avec deux bornes.
  // Pour quatre critères ou plus, le détail reste intégralement sous le titre.
  const printTitle = useMemo(() => {
    const filterCount = [
      level !== "all",
      classId !== "all",
      boarding !== "all",
      affectation !== "all",
      scholarship !== "all",
      gender !== "all",
      language !== "all",
      minAge !== "" || maxAge !== "",
    ].filter(Boolean).length;

    if (filterCount === 0) return "LISTE GÉNÉRALE DES ÉLÈVES";
    if (filterCount >= 4) return "STATISTIQUES GÉNÉRALES";

    const feminine = gender === "F";
    const parts = [feminine ? "FILLES" : gender === "M" ? "GARÇONS" : "ÉLÈVES"];
    if (boarding !== "all") parts.push(boarding === "yes" ? "INTERNES" : "EXTERNES");
    if (affectation !== "all") {
      parts.push(affectation === "yes" ? (feminine ? "AFFECTÉES" : "AFFECTÉS") : (feminine ? "NON AFFECTÉES" : "NON AFFECTÉS"));
    }
    if (scholarship !== "all") {
      parts.push(scholarship === "yes" ? (feminine ? "BOURSIÈRES" : "BOURSIERS") : (feminine ? "NON BOURSIÈRES" : "NON BOURSIERS"));
    }

    let title = "LISTE DES " + parts.join(" ");
    if (minAge || maxAge) {
      const ageAdjective = feminine ? "ÂGÉES" : "ÂGÉS";
      title += minAge && maxAge ? Number(minAge) === Number(maxAge)
        ? ` ${ageAdjective} DE ${minAge} ANS`
        : ` ${ageAdjective} DE ${minAge} À ${maxAge} ANS`
        : minAge ? ` ${ageAdjective} DE ${minAge} ANS ET PLUS`
        : ` ${ageAdjective} DE ${maxAge} ANS AU PLUS`;
    }
    if (classId !== "all") title += " — CLASSE " + selectedClassLabel;
    if (level !== "all") title += " — NIVEAU " + level;
    if (language !== "all") title += " — LV2 " + (language === "allemand" ? "ALLEMAND" : "ESPAGNOL");
    return title;
  }, [level, classId, selectedClassLabel, boarding, affectation, scholarship, gender, language, minAge, maxAge]);

  // Une sélection de niveau reste distincte d'une classe. Même sous d'autres
  // filtres, ne retirer CLASSE que si toutes les lignes ont la même classe connue.
  const singleClass = filtered.length > 0 && Boolean(filtered[0].class_id) &&
    filtered.every((student) => student.class_id === filtered[0].class_id);
  const exactAge = minAge !== "" && maxAge !== "" && Number(minAge) === Number(maxAge);
  const printColumns: PrintColumnKey[] = [
    "number", "matricule", "full_name",
    ...(!singleClass ? ["class" as const] : []),
    ...(gender === "all" ? ["sex" as const] : []),
    ...(!exactAge ? ["age" as const] : []),
    ...(boarding === "all" ? ["boarding" as const] : []),
    ...(affectation === "all" ? ["affectation" as const] : []),
    ...(scholarship === "all" ? ["scholarship" as const] : []),
    ...(language === "all" ? ["lv2" as const] : []),
  ];
  const totalPrintWidth = printColumns.reduce((total, key) => total + PRINT_COLUMN_META[key].weight, 0);
  // Préserver le ministère configuré, y compris sa mention technique éventuelle.
  // Corriger aussi les variantes accentuées sans écrire dans les paramètres.
  const officialMinistry = (clean(institution.ministry_name) ||
    "MINISTÈRE DE L’ÉDUCATION NATIONALE ET DE L’ALPHABÉTISATION")
    .replace(/([EÉ]DUCATION NATIONALE)\s+DE L['’]ALPHAB[EÉ]TISATION\b/i, "$1 ET DE L’ALPHABÉTISATION");
  const ministryLines = officialMinistry.split(/\s+(?=ET DE L['’]ENSEIGNEMENT TECHNIQUE\b)/i);

  function reset() {
    setLevel("all");
    setClassId("all");
    setBoarding("all");
    setAffectation("all");
    setScholarship("all");
    setGender("all");
    setLanguage("all");
    setMinAge("");
    setMaxAge("");
  }

  const institutionName =
    clean(institution.institution_name) || clean(institution.name) || "Établissement scolaire";

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-7">
        <div className="mx-auto max-w-7xl animate-pulse space-y-4">
          <div className="h-14 rounded-2xl bg-slate-200" />
          <div className="h-32 rounded-2xl bg-slate-200" />
          <div className="h-72 rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-7">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-white p-6 text-sm font-semibold text-rose-700 shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        .stats-print-sheet { display: none; }
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          body:has(> .stats-print-sheet) {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            min-height: 0 !important;
            height: auto !important;
          }
          body:has(> .stats-print-sheet) > :not(.stats-print-sheet) { display: none !important; }
          .stats-print-sheet {
            display: block !important;
            position: static !important;
            box-sizing: border-box;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            color: #0f172a !important;
            font-family: Arial, Helvetica, sans-serif !important;
            line-height: 1.3;
            print-color-adjust: exact;
          }
          .stats-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .stats-print-sheet thead { display: table-header-group; }
          .stats-print-sheet tfoot { display: table-footer-group; }
          .stats-print-sheet tfoot td { border: 0; padding: 8px 0 0; }
          .stats-print-sheet tr { break-inside: avoid; page-break-inside: avoid; }
          .stats-print-sheet th,
          .stats-print-sheet td { border: 1px solid #64748b; padding: 3px 5px; vertical-align: middle; overflow-wrap: anywhere; }
          .stats-print-sheet th { background: #f1f5f9 !important; font-size: 10px; text-transform: uppercase; }
          .stats-print-sheet td { font-size: 10.5px; }
          .stats-print-sheet .stats-national-header {
            text-align: center;
            font-size: 10px;
            line-height: 1.25;
            font-weight: 700;
            margin: 0 auto 9px;
            width: 100%;
            break-inside: avoid;
          }
          .stats-print-sheet .stats-national-header .stats-motto {
            margin-top: 2px;
            font-size: 9px;
            font-weight: 500;
            text-transform: none;
          }
          .stats-print-sheet .stats-national-header .stats-ministry {
            margin: 3px auto 0;
            max-width: 95%;
            font-size: 9.6px;
            line-height: 1.3;
          }
          .stats-print-sheet .stats-official-header {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr);
            gap: 8px;
            align-items: center;
            margin-bottom: 10px;
            break-inside: avoid;
          }
          .stats-print-sheet .stats-school-block { overflow-wrap: anywhere; display: flex; align-items: center; gap: 8px; min-width: 0; }
          .stats-print-sheet .stats-school-logo { width: 42px; height: 42px; object-fit: contain; flex: 0 0 auto; }
          .stats-print-sheet .stats-school-name { font-size: 11.5px; font-weight: 900; line-height: 1.1; text-transform: uppercase; }
          .stats-print-sheet .stats-school-meta { margin-top: 2px; font-size: 8.3px; line-height: 1.25; color: #334155; }
          .stats-print-sheet .stats-list-title {
            border: 1.5px solid #0f172a;
            padding: 7px 8px;
            font-size: 12px;
            line-height: 1.3;
            font-weight: 900;
            text-align: center;
            text-transform: uppercase;
            overflow-wrap: anywhere;
          }
          .stats-print-sheet .stats-right-meta { font-size: 8.8px; line-height: 1.45; text-align: right; font-weight: 700; }
          .stats-print-sheet .stats-criteria-line {
            margin: 5px 0 0;
            padding: 4px 6px;
            background: #f8fafc !important;
            font-size: 10px;
            line-height: 1.4;
            overflow-wrap: anywhere;
            font-weight: 700;
          }
          .stats-print-sheet .stats-sheet-footer {
            display: grid;
            grid-template-columns: 1fr 1.45fr 1fr;
            align-items: end;
            gap: 12px;
            margin-top: 0;
            break-inside: avoid;
            padding-top: 6px;
            border-top: 1px solid #cbd5e1;
            font-size: 9.6px;
            color: #334155;
          }
          .stats-print-sheet .stats-export-brand-footer { text-align: center; line-height: 1.25; font-weight: 700; }
        }
      `}</style>

      <div className="min-h-screen bg-slate-50 p-4 md:p-7">
        <div className="mx-auto max-w-7xl space-y-4">
          <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-black text-slate-950">Statistiques générales</h1>
                <div className="mt-0.5 text-sm font-semibold text-slate-500">
                  {filtered.length} élève{filtered.length > 1 ? "s" : ""}
                  {academicYear ? ` · ${academicYear}` : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                Réinitialiser
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={filtered.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer className="h-4 w-4" />
                Imprimer
              </button>
            </div>
          </header>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <Select label="Niveau" value={level} onChange={(value) => { setLevel(value); setClassId("all"); }}>
                <option value="all">Tous</option>
                {levels.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>

              <Select label="Classe" value={classId} onChange={setClassId}>
                <option value="all">Toutes</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </Select>

              <Select label="Régime" value={boarding} onChange={(value) => setBoarding(value as Choice)}>
                <option value="all">Tous</option>
                <option value="yes">Interne</option>
                <option value="no">Externe</option>
              </Select>

              <Select label="Affectation" value={affectation} onChange={(value) => setAffectation(value as Choice)}>
                <option value="all">Tous</option>
                <option value="yes">Affecté</option>
                <option value="no">Non affecté</option>
              </Select>

              <Select label="Bourse" value={scholarship} onChange={(value) => setScholarship(value as Choice)}>
                <option value="all">Tous</option>
                <option value="yes">Boursier</option>
                <option value="no">Non boursier</option>
              </Select>

              <Select label="Sexe" value={gender} onChange={(value) => setGender(value as SexChoice)}>
                <option value="all">Tous</option>
                <option value="F">Fille</option>
                <option value="M">Garçon</option>
              </Select>

              <Select label="LV2" value={language} onChange={(value) => setLanguage(value as Lv2Choice)}>
                <option value="all">Toutes</option>
                <option value="allemand">Allemand</option>
                <option value="espagnol">Espagnol</option>
              </Select>

              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Âge min</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={minAge}
                  onChange={(event) => setMinAge(event.target.value)}
                  placeholder="—"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>

              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Âge max</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={maxAge}
                  onChange={(event) => setMaxAge(event.target.value)}
                  placeholder="—"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="truncate text-sm font-bold text-slate-700">{criteria}</div>
              <div className="ml-3 shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                {filtered.length}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">N°</th>
                    <th className="px-3 py-2.5">Matricule</th>
                    <th className="px-3 py-2.5">Nom et prénoms</th>
                    <th className="px-3 py-2.5">Classe</th>
                    <th className="px-3 py-2.5 text-center">Sexe</th>
                    <th className="px-3 py-2.5 text-center">Âge</th>
                    <th className="px-3 py-2.5">Régime</th>
                    <th className="px-3 py-2.5">Affectation</th>
                    <th className="px-3 py-2.5">Bourse</th>
                    <th className="px-3 py-2.5">LV2</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length ? (
                    filtered.map((student, index) => (
                      <tr key={student.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2.5 font-semibold text-slate-500">{index + 1}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-700">{student.matricule || "—"}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-950">{student.full_name}</td>
                        <td className="px-3 py-2.5 text-slate-700">{student.class_label || "—"}</td>
                        <td className="px-3 py-2.5 text-center text-slate-700">{sex(student.gender) || "—"}</td>
                        <td className="px-3 py-2.5 text-center text-slate-700">{ageOf(student.birthdate) ?? "—"}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_boarder, "Interne", "Externe")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_affecte, "Affecté", "Non affecté")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_scholarship, "Boursier", "Non boursier")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{lv2(student.lv2) === "allemand" ? "Allemand" : lv2(student.lv2) === "espagnol" ? "Espagnol" : student.lv2 || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
                        Aucun élève pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {printTarget && createPortal(<section className="stats-print-sheet">
        <div className="stats-national-header">
          <div>{clean(institution.country_name) || "République de Côte d’Ivoire"}</div>
          <div className="stats-motto">{clean(institution.country_motto) || "Union - Discipline - Travail"}</div>
          <div className="stats-ministry">{ministryLines.map((line, index) => <div key={index}>{line}</div>)}</div>
        </div>
        <header className="stats-official-header">
          <div className="stats-school-block">
            {clean(institution.institution_logo_url) ? (
              <img className="stats-school-logo" src={clean(institution.institution_logo_url)} alt="Logo de l’établissement" />
            ) : null}
            <div>
              <div className="stats-school-name">{institutionName}</div>
              <div className="stats-school-meta">
                {clean(institution.institution_code) ? <div>Code : {institution.institution_code}</div> : null}
                {clean(institution.institution_phone) ? <div>Tél. : {institution.institution_phone}</div> : null}
                {clean(institution.institution_email) ? <div>{institution.institution_email}</div> : null}
                {clean(institution.institution_postal_address) ? <div>{institution.institution_postal_address}</div> : null}
              </div>
            </div>
          </div>

          <div>
            <div className="stats-list-title">{printTitle}</div>
            <div className="stats-criteria-line">
              Critères : {criteria}<br />
              Effectif : {filtered.length} élève{filtered.length > 1 ? "s" : ""}
            </div>
          </div>

          <div className="stats-right-meta">
            <div>Année scolaire : {academicYear || "—"}</div>
            <div>Niveau : {level === "all" ? "Tous" : displayLevel(level)}</div>
            {classId !== "all" ? <div>Classe : {selectedClassLabel}</div> : null}
            <div>Effectif : {filtered.length}</div>
          </div>
        </header>

        <table>
          <colgroup>
            {printColumns.map((key) => (
              <col key={key} style={{ width: `${(PRINT_COLUMN_META[key].weight / totalPrintWidth) * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {printColumns.map((key) => (
                <th key={key} style={{ textAlign: PRINT_COLUMN_META[key].center ? "center" : "left" }}>
                  {PRINT_COLUMN_META[key].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((student, index) => (
              <tr key={`print-${student.id}`}>
                {printColumns.map((key) => (
                  <td key={key} style={{
                    textAlign: PRINT_COLUMN_META[key].center ? "center" : "left",
                    fontWeight: key === "full_name" ? 700 : undefined,
                  }}>
                    {printCellValue(key, student, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={printColumns.length}>
                <footer className="stats-sheet-footer">
                  <div>Filles : {totals.girls} &nbsp;|&nbsp; Garçons : {totals.boys}</div>
                  <div className="stats-export-brand-footer">{MON_CAHIER_EXPORT_SIGNATURE}</div>
                  <div aria-hidden="true" />
                </footer>
              </td>
            </tr>
          </tfoot>
        </table>

      </section>, printTarget)}
    </>
  );
}
