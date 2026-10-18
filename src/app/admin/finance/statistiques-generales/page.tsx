"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Printer, RotateCcw } from "lucide-react";
import {
  formatStatisticsAverage, loadStatisticsAcademicData, statisticsAverageBounds,
  statisticsAverageMatches, statisticsStudentAverage,
  type StatisticsAcademicData, type StatisticsAverage, type StatisticsBulletinCache, type StatisticsGradePeriod,
} from "@/lib/general-statistics-averages";

type Student = {
  id: string;
  matricule: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  class_id: string | null;
  class_label: string | null;
  level: string | null;
  school_cycle?: "preschool" | "primary" | "secondary";
  teaching_tracks?: Array<"french" | "arabic">;
  program_class_ids?: Partial<Record<"french" | "arabic", string>>;
  gender: string | null;
  birthdate: string | null;
  nationality?: string | null;
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
type SchoolCycle = "preschool" | "primary" | "secondary";
type TeachingTrack = "french" | "arabic";
type SchoolConfiguration = {
  enabled: boolean;
  enabled_cycles: SchoolCycle[];
  teaching_tracks_by_cycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
};
const CYCLE_LABELS: Record<SchoolCycle, string> = {
  preschool: "Préscolaire", primary: "Primaire", secondary: "Secondaire",
};
const TRACK_LABELS: Record<TeachingTrack, string> = {
  french: "Enseignement français", arabic: "Enseignement arabe",
};
type SexChoice = "all" | "F" | "M";
type Lv2Choice = "all" | "allemand" | "espagnol";
type PrintColumnKey =
  | "number" | "matricule" | "full_name" | "class"
  | "sex" | "age" | "nationality" | "boarding" | "affectation" | "scholarship" | "lv2" | "average";

const PRINT_COLUMN_META: Record<PrintColumnKey, { label: string; weight: number; center?: boolean }> = {
  number: { label: "N°", weight: 5, center: true },
  matricule: { label: "Matricule", weight: 14 },
  full_name: { label: "Nom et prénoms", weight: 32 },
  class: { label: "Classe", weight: 10 },
  average: { label: "Moyenne /20", weight: 10, center: true },
  sex: { label: "Sexe", weight: 6, center: true },
  age: { label: "Âge", weight: 6, center: true },
  nationality: { label: "Nationalité", weight: 13 },
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

/** Réunir les variantes de nationalité présentes dans les établissements. */
function nationalityLabel(value: unknown): string {
  const raw = clean(value);
  const v = norm(value).replace(/[._-]+/g, " ").trim();
  if (!v || ["unknown", "inconnue", "non renseignee", "n/a", "aucune", "-"].includes(v))
    return "Non renseignée";
  if (v === "iv" || v === "ci" || v === "cote d'ivoire" || v.startsWith("ivoir")) return "Ivoirienne";
  if (v.startsWith("burkin")) return "Burkinabè";
  if (v.startsWith("malien")) return "Malienne";
  if (v.startsWith("nigerien")) return "Nigérienne";
  if (v.startsWith("nigerian")) return "Nigériane";
  return raw.charAt(0).toLocaleUpperCase("fr") + raw.slice(1).toLocaleLowerCase("fr");
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

function printCellValue(key: PrintColumnKey, student: Student, index: number, average?: StatisticsAverage): string | number {
  switch (key) {
    case "number": return index + 1;
    case "matricule": return student.matricule || "—";
    case "full_name": return student.full_name;
    case "class": return student.class_label || "—";
    case "average": return formatStatisticsAverage(average);
    case "sex": return sex(student.gender) || "—";
    case "age": return ageOf(student.birthdate) ?? "—";
    case "nationality": return nationalityLabel(student.nationality);
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
  cycle?: string;
  track?: string;
  level: string;
  classLabel: string;
  boarding: Choice;
  affectation: Choice;
  scholarship: Choice;
  gender: SexChoice;
  language: Lv2Choice;
  nationality: string;
  minAge: string;
  maxAge: string;
  academicPeriod: string;
  academicSubject: string;
  minAverage: string;
  maxAverage: string;
}) {
  const out: string[] = [];
  if (args.cycle && args.cycle !== "all") out.push(`Cycle : ${args.cycle}`);
  if (args.track && args.track !== "all") out.push(args.track);
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
  if (args.nationality !== "all") out.push(`Nationalité : ${args.nationality}`);
  if (args.minAge && args.maxAge) out.push(`${args.minAge}–${args.maxAge} ans`);
  else if (args.minAge) out.push(`≥ ${args.minAge} ans`);
  else if (args.maxAge) out.push(`≤ ${args.maxAge} ans`);
  if (args.academicPeriod) {
    out.push(args.academicPeriod, args.academicSubject);
    const min = args.minAverage.trim(), max = args.maxAverage.trim();
    if (min && max) out.push(`Moyenne : ${min}–${max}/20`);
    else if (min) out.push(`Moyenne ≥ ${min}/20`);
    else if (max) out.push(`Moyenne ≤ ${max}/20`);
  }
  return out.join(" · ") || "Tous les élèves";
}

function Select({
  label,
  value,
  onChange,
  children,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
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
  const [schoolConfiguration, setSchoolConfiguration] = useState<SchoolConfiguration | null>(null);
  const [cycle, setCycle] = useState<SchoolCycle | "all">("all");
  const [track, setTrack] = useState<TeachingTrack | "all">("all");
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
  const [nationality, setNationality] = useState("all");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [canFilterAverages, setCanFilterAverages] = useState(false);
  const [academicPeriods, setAcademicPeriods] = useState<StatisticsGradePeriod[]>([]);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [academicPeriod, setAcademicPeriod] = useState("");
  const [academicSubject, setAcademicSubject] = useState("all");
  const [academicSubjects, setAcademicSubjects] = useState<{ id: string; label: string; track?: TeachingTrack }[]>([]);
  const [minAverage, setMinAverage] = useState("");
  const [maxAverage, setMaxAverage] = useState("");
  const [academicResult, setAcademicResult] = useState<{ key: string; data: StatisticsAcademicData } | null>(null);
  const [academicError, setAcademicError] = useState<string | null>(null);
  const [academicProgress, setAcademicProgress] = useState("");
  const [academicRetry, setAcademicRetry] = useState(0);
  const academicCache = useRef<StatisticsBulletinCache>(new Map());

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
          const config = statsJson?.school_configuration as SchoolConfiguration | undefined;
          if (config?.enabled) {
            setSchoolConfiguration(config);
            const offered = Array.from(new Set(config.enabled_cycles.flatMap(
              (schoolCycle) => config.teaching_tracks_by_cycle[schoolCycle] || [],
            )));
            setTrack(offered.length === 1 ? offered[0] : "all");
          } else {
            setSchoolConfiguration(null);
          }
          setCanFilterAverages(statsJson?.can_filter_averages === true);
          setAcademicPeriods(Array.isArray(statsJson?.academic_periods) ? statsJson.academic_periods : []);
          setPeriodError(statsJson?.academic_filter_error || null);
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

  const specialSchool = schoolConfiguration?.enabled === true;
  const availableTracks = useMemo(() => Array.from(new Set(
    (schoolConfiguration?.enabled_cycles || []).filter((item) => cycle === "all" || cycle === item)
      .flatMap((item) => schoolConfiguration?.teaching_tracks_by_cycle[item] || []),
  )), [schoolConfiguration, cycle]);
  const scopedStudents = useMemo(() => students.filter((student) =>
    (!specialSchool || cycle === "all" || student.school_cycle === cycle) &&
    (!specialSchool || track === "all" || student.teaching_tracks?.includes(track) === true),
  ), [students, specialSchool, cycle, track]);
  const unclassified = specialSchool ? students.filter((student) => !student.teaching_tracks?.length).length : 0;
  const levels = useMemo(() => sortedUnique(scopedStudents.map((student) => student.level)), [scopedStudents]);
  const nationalities = useMemo(() => sortedUnique(students.map((student) => nationalityLabel(student.nationality))), [students]);

  const classes = useMemo(() => {
    const choices = new Map<string, string>();
    for (const student of scopedStudents) {
      if (student.class_id && (level === "all" || clean(student.level) === level)) {
        choices.set(student.class_id, clean(student.class_label) || student.class_id);
      }
    }
    return Array.from(choices, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { sensitivity: "base", numeric: true }),
    );
  }, [scopedStudents, level]);
  const selectedClassLabel = classes.find((item) => item.id === classId)?.label || "";

  const baseFiltered = useMemo(() => {
    const min = minAge === "" ? null : Number(minAge);
    const max = maxAge === "" ? null : Number(maxAge);

    return scopedStudents.filter((student) => {
      if (level !== "all" && clean(student.level) !== level) return false;
      if (classId !== "all" && student.class_id !== classId) return false;
      if (!boolMatches(student.is_boarder, boarding)) return false;
      if (!boolMatches(student.is_affecte, affectation)) return false;
      if (!boolMatches(student.is_scholarship, scholarship)) return false;
      if (gender !== "all" && sex(student.gender) !== gender) return false;
      if (language !== "all" && lv2(student.lv2) !== language) return false;
      if (nationality !== "all" && nationalityLabel(student.nationality) !== nationality) return false;

      if (min !== null || max !== null) {
        const age = ageOf(student.birthdate);
        if (age === null) return false;
        if (min !== null && Number.isFinite(min) && age < min) return false;
        if (max !== null && Number.isFinite(max) && age > max) return false;
      }
      return true;
    });
  }, [scopedStudents, level, classId, boarding, affectation, scholarship, gender, language, nationality, minAge, maxAge]);

  const academicClassIds = useMemo(() => sortedUnique(baseFiltered.map((student) =>
    specialSchool && track !== "all" ? student.program_class_ids?.[track] || null : student.class_id,
  )), [baseFiltered, specialSchool, track]);
  const academicKey = JSON.stringify([academicYear, academicPeriod, academicClassIds, academicRetry]);
  const availablePeriods = useMemo(() => academicPeriods.filter((period) =>
    academicClassIds.some((id) => period.class_ids.includes(id)),
  ), [academicPeriods, academicClassIds]);
  const academicData = academicResult?.key === academicKey ? academicResult.data : null;
  const academicBusy = Boolean(academicPeriod && !academicData && !academicError);
  const averageBounds = statisticsAverageBounds(minAverage, maxAverage);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setAcademicResult(null);
    setAcademicError(null);
    if (academicPeriod && canFilterAverages && (!specialSchool || track !== "all")) {
      setAcademicProgress("Chargement des moyennes…");
      void loadStatisticsAcademicData({ classIds: academicClassIds, selection: academicPeriod,
        academicYear, periods: academicPeriods, cache: academicCache.current, signal: controller.signal,
        onProgress: (done, total) => { if (active) setAcademicProgress(`Chargement des moyennes : ${done}/${total}…`); },
      }).then((data) => {
        if (!active) return;
        setAcademicResult({ key: academicKey, data });
        setAcademicSubjects((previous) => {
          const known = new Map(previous.map((subject) => [subject.id, subject]));
          for (const subject of data.subjects) known.set(subject.id, subject);
          return Array.from(known.values()).sort((a, b) => a.label.localeCompare(b.label, "fr"));
        });
      })
        .catch((cause) => {
          if (active) setAcademicError(cause instanceof Error ? cause.message : "Impossible de charger les moyennes.");
          controller.abort();
        });
    }
    return () => { active = false; controller.abort(); };
  }, [academicKey, academicClassIds, academicPeriod, academicPeriods, academicYear, canFilterAverages, specialSchool, track]);

  const studentAverages = useMemo(() => new Map(baseFiltered.map((student) => [student.id,
    statisticsStudentAverage(academicData,
      specialSchool && track !== "all" ? student.program_class_ids?.[track] || null : student.class_id,
      student.id, academicPeriod, academicSubject, specialSchool && track !== "all" ? track : undefined),
  ])), [baseFiltered, academicData, academicPeriod, academicSubject, specialSchool, track]);
  const filtered = useMemo(() => {
    if (!academicPeriod) return baseFiltered;
    if (!academicData || academicError || averageBounds.error) return [];
    return baseFiltered.filter((student) => statisticsAverageMatches(studentAverages.get(student.id)!, averageBounds.min, averageBounds.max));
  }, [baseFiltered, academicPeriod, academicData, academicError, averageBounds.error, averageBounds.min, averageBounds.max, studentAverages]);
  const academicPeriodLabel = academicPeriod === "annual" ? "Année scolaire entière"
    : academicPeriods.find((period) => period.id === academicPeriod)?.label || "";
  const academicSubjectLabel = academicSubject === "all" ? "Moyenne générale"
    : academicSubjects.find((subject) => subject.id === academicSubject &&
      (!specialSchool || subject.track === track))?.label || "Discipline";
  const visibleAcademicSubjects = academicSubjects.filter((subject) =>
    !specialSchool || subject.track === track);
  const canPrint = !academicBusy && !academicError && !averageBounds.error;

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

  const nationalityBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of filtered) {
      const label = nationalityLabel(student.nationality);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts, ([label, count]) => ({ label, count })).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr"),
    );
  }, [filtered]);
  const nationalityRecap = nationalityBreakdown.map(({ label, count }) => `${label}: ${count}`).join(" · ");

  const criteria = useMemo(
    () =>
      filterLabel({
        cycle: specialSchool && cycle !== "all" ? CYCLE_LABELS[cycle] : undefined,
        track: specialSchool && track !== "all" ? TRACK_LABELS[track] : undefined,
        level,
        classLabel: selectedClassLabel,
        boarding,
        affectation,
        scholarship,
        gender,
        language,
        nationality,
        minAge,
        maxAge,
        academicPeriod: academicPeriodLabel,
        academicSubject: academicSubjectLabel,
        minAverage,
        maxAverage,
      }),
    [specialSchool, cycle, track, level, selectedClassLabel, boarding, affectation, scholarship, gender, language, nationality, minAge, maxAge, academicPeriodLabel, academicSubjectLabel, minAverage, maxAverage],
  );

  // Le filtre d'âge compte pour un seul critère, même avec deux bornes.
  // Pour quatre critères ou plus, le détail reste intégralement sous le titre.
  const printTitle = useMemo(() => {
    const filterCount = [
      specialSchool && cycle !== "all",
      specialSchool && track !== "all",
      level !== "all",
      classId !== "all",
      boarding !== "all",
      affectation !== "all",
      scholarship !== "all",
      gender !== "all",
      language !== "all",
      nationality !== "all",
      minAge !== "" || maxAge !== "",
      academicPeriod !== "",
      academicPeriod !== "" && academicSubject !== "all",
      academicPeriod !== "" && (minAverage !== "" || maxAverage !== ""),
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
    if (specialSchool && cycle !== "all") title += " — " + CYCLE_LABELS[cycle].toLocaleUpperCase("fr");
    if (specialSchool && track !== "all") title += " — " + TRACK_LABELS[track].toLocaleUpperCase("fr");
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
    if (nationality !== "all") title += " — NATIONALITÉ " + nationality.toLocaleUpperCase("fr");
    if (academicPeriod) {
      title += " — " + academicPeriodLabel.toLocaleUpperCase("fr");
      if (academicSubject !== "all") title += " — " + academicSubjectLabel.toLocaleUpperCase("fr");
      if (minAverage.trim() && maxAverage.trim()) title += ` — MOYENNE DE ${minAverage} À ${maxAverage}/20`;
      else if (minAverage.trim()) title += ` — MOYENNE ≥ ${minAverage}/20`;
      else if (maxAverage.trim()) title += ` — MOYENNE ≤ ${maxAverage}/20`;
    }
    return title;
  }, [specialSchool, cycle, track, level, classId, selectedClassLabel, boarding, affectation, scholarship, gender, language, nationality, minAge, maxAge, academicPeriod, academicPeriodLabel, academicSubject, academicSubjectLabel, minAverage, maxAverage]);

  // Une sélection de niveau reste distincte d'une classe. Même sous d'autres
  // filtres, ne retirer CLASSE que si toutes les lignes ont la même classe connue.
  const singleClass = filtered.length > 0 && Boolean(filtered[0].class_id) &&
    filtered.every((student) => student.class_id === filtered[0].class_id);
  const exactAge = minAge !== "" && maxAge !== "" && Number(minAge) === Number(maxAge);
  const printColumns: PrintColumnKey[] = [
    "number", "matricule", "full_name",
    ...(!singleClass ? ["class" as const] : []),
    ...(academicPeriod ? ["average" as const] : []),
    ...(gender === "all" ? ["sex" as const] : []),
    ...(!exactAge ? ["age" as const] : []),
    ...(nationality === "all" ? ["nationality" as const] : []),
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
    setCycle("all");
    setTrack(specialSchool && availableTracks.length === 1 ? availableTracks[0] : "all");
    setLevel("all");
    setClassId("all");
    setBoarding("all");
    setAffectation("all");
    setScholarship("all");
    setGender("all");
    setLanguage("all");
    setNationality("all");
    setMinAge("");
    setMaxAge("");
    setAcademicPeriod("");
    setAcademicSubject("all");
    setMinAverage("");
    setMaxAverage("");
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
          .stats-print-sheet.stats-with-averages th,
          .stats-print-sheet.stats-with-averages td { padding: 2px 4px; }
          .stats-print-sheet.stats-with-averages td { font-size: 10px; }
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
          .stats-print-sheet .stats-criterion { display: inline-block; max-width: 100%; }
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
                  {academicBusy ? "Chargement des moyennes…" : `${filtered.length} élève${filtered.length > 1 ? "s" : ""}`}
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
                disabled={filtered.length === 0 || !canPrint}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer className="h-4 w-4" />
                Imprimer
              </button>
            </div>
          </header>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {specialSchool && <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Select label="Cycle" value={cycle} onChange={(value) => {
                setCycle(value as SchoolCycle | "all"); setTrack("all"); setLevel("all"); setClassId("all");
                setAcademicPeriod(""); setAcademicSubject("all"); setAcademicSubjects([]);
              }}>
                <option value="all">Tous les cycles</option>
                {schoolConfiguration?.enabled_cycles.map((item) =>
                  <option key={item} value={item}>{CYCLE_LABELS[item]}</option>)}
              </Select>
              <Select label="Enseignement" value={track} onChange={(value) => {
                setTrack(value as TeachingTrack | "all"); setLevel("all"); setClassId("all");
                setAcademicPeriod(""); setAcademicSubject("all"); setAcademicSubjects([]);
              }}>
                <option value="all">Toute l'école — effectifs sans doublon</option>
                {availableTracks.map((item) => <option key={item} value={item}>{TRACK_LABELS[item]}</option>)}
              </Select>
            </div>}
            {specialSchool && track === "all" && <p className="mb-3 text-sm text-sky-800" role="status">
              Les effectifs regroupent chaque élève une seule fois. Sélectionnez l’enseignement français ou arabe
              pour obtenir ses moyennes propres : aucune moyenne commune n’est calculée.
            </p>}
            {specialSchool && unclassified > 0 && <p className="mb-3 text-sm text-amber-800" role="status">
              {unclassified} élève(s) sans enseignement pédagogique configuré : comptés dans toute l’école,
              mais non attribués arbitrairement au français ou à l’arabe.
            </p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
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

              <Select label="Nationalité" value={nationality} onChange={setNationality}>
                <option value="all">Toutes</option>
                {nationalities.map((item) => <option key={item} value={item}>{item}</option>)}
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

          {canFilterAverages && (!specialSchool || track !== "all") && <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm" aria-busy={academicBusy}>
            <h2 className="text-sm font-bold text-slate-800">Résultats scolaires</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select label="Période des moyennes" value={academicPeriod} disabled={Boolean(periodError) || !availablePeriods.length} onChange={(value) => {
                setAcademicPeriod(value);
                if (!value) { setAcademicSubject("all"); setMinAverage(""); setMaxAverage(""); }
              }}>
                <option value="">Sans filtre de moyenne</option>
                {availablePeriods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
                <option value="annual">Année scolaire entière</option>
              </Select>
              <Select label="Discipline" value={academicSubject} disabled={!academicData || academicBusy} onChange={setAcademicSubject}>
                <option value="all">Toutes — moyenne générale</option>
                {visibleAcademicSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
              </Select>
              {([["Moyenne min", minAverage, setMinAverage], ["Moyenne max", maxAverage, setMaxAverage]] as const).map(([label, value, setter]) => (
                <label key={label} className="block min-w-0">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                  <input type="text" inputMode="decimal" maxLength={6} value={value}
                    disabled={!academicPeriod} onChange={(event) => setter(event.target.value)} placeholder="— /20"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-50" />
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Sans discipline sélectionnée : moyenne générale de la période. Avec une discipline : moyenne de cette discipline. Bornes inclusives sur 20 ; « — » indique une moyenne indisponible et * une moyenne provisoire.</p>
            {(periodError || averageBounds.error) && <p role="alert" className="mt-2 text-sm text-rose-700">{periodError || averageBounds.error}</p>}
            {academicBusy && <p role="status" className="mt-2 text-sm font-semibold text-emerald-700">{academicProgress}</p>}
            {academicError && <div role="alert" className="mt-2 text-sm text-rose-700">{academicError} <button type="button" className="font-bold underline" onClick={() => setAcademicRetry((value) => value + 1)}>Réessayer les moyennes</button></div>}
          </section>}

          <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700">Répartition par nationalité</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {nationalityBreakdown.length > 0
                ? nationalityBreakdown.map(({ label, count }) => (
                  <span key={label} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                    {label} : <strong>{count}</strong>
                  </span>
                ))
                : <span className="text-xs text-slate-500">Aucun élève pour ces filtres.</span>}
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
                    {academicPeriod && <th className="px-3 py-2.5 text-center">Moyenne /20</th>}
                    <th className="px-3 py-2.5 text-center">Sexe</th>
                    <th className="px-3 py-2.5 text-center">Âge</th>
                    <th className="px-3 py-2.5">Nationalité</th>
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
                        {academicPeriod && <td className="px-3 py-2.5 text-center font-bold text-slate-800">{formatStatisticsAverage(studentAverages.get(student.id))}</td>}
                        <td className="px-3 py-2.5 text-center text-slate-700">{sex(student.gender) || "—"}</td>
                        <td className="px-3 py-2.5 text-center text-slate-700">{ageOf(student.birthdate) ?? "—"}</td>
                        <td className="px-3 py-2.5 text-slate-700">{nationalityLabel(student.nationality)}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_boarder, "Interne", "Externe")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_affecte, "Affecté", "Non affecté")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_scholarship, "Boursier", "Non boursier")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{lv2(student.lv2) === "allemand" ? "Allemand" : lv2(student.lv2) === "espagnol" ? "Espagnol" : student.lv2 || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={academicPeriod ? 12 : 11} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
                        {academicBusy ? academicProgress : academicError || averageBounds.error || "Aucun élève pour ces filtres."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {printTarget && canPrint && createPortal(<section className={`stats-print-sheet${academicPeriod ? " stats-with-averages" : ""}`}>
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
              Critères : {criteria.split(" · ").map((criterion, index) => <span key={index} className="stats-criterion">{index ? " · " : ""}{criterion}</span>)}<br />
              Effectif : {filtered.length} élève{filtered.length > 1 ? "s" : ""}
            </div>
          </div>

          <div className="stats-right-meta">
            <div>Année scolaire : {academicYear || "—"}</div>
            {specialSchool && <div>Cycle : {cycle === "all" ? "Tous" : CYCLE_LABELS[cycle]}</div>}
            {specialSchool && <div>Enseignement : {track === "all" ? "Toute l’école" : TRACK_LABELS[track]}</div>}
            <div>Niveau : {level === "all" ? "Tous" : displayLevel(level)}</div>
            {classId !== "all" ? <div>Classe : {selectedClassLabel}</div> : null}
            <div>Effectif : {filtered.length}</div>
          </div>
        </header>

        {academicPeriod && <p className="mb-2 text-[9px]">Moyenne : {academicSubjectLabel} · {academicPeriodLabel} · /20. — : indisponible ; * : provisoire.</p>}
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
                    {printCellValue(key, student, index, studentAverages.get(student.id))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={printColumns.length}>
                <footer className="stats-sheet-footer">
                  <div>Filles : {totals.girls} &nbsp;|&nbsp; Garçons : {totals.boys}<div className="mt-1 text-[8px]">Nationalités : {nationalityRecap || "—"}</div></div>
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
