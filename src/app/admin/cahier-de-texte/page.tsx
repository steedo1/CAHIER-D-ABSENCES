"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";

type SubjectItem = {
  id: string;
  name: string;
  inst_subject_id?: string | null;
};
type EducationClassMeta = {
  education_type?: string | null;
  education_label?: string | null;
  formation_code?: string | null;
  formation_label?: string | null;
  formation_level_code?: string | null;
  formation_level_label?: string | null;
  education_context_label?: string | null;
};

type ClassItem = EducationClassMeta & {
  id: string;
  label?: string;
  name?: string;
  level?: string | null;
  academic_year?: string | null;
};
type Progression = {
  id: string;
  title: string;
  academic_year: string;
  subject_id?: string | null;
  institution_subject_id?: string | null;
  subject_name?: string | null;
  level?: string | null;
  series?: string | null;
  education_type?: string | null;
  education_label?: string | null;
  formation_code?: string | null;
  formation_label?: string | null;
  formation_level_code?: string | null;
  formation_level_label?: string | null;
  education_context_label?: string | null;
  description?: string | null;
  status?: string | null;
  scope?: "national" | "school" | string | null;
  source_national_template_id?: string | null;
  is_customized?: boolean | null;
  document?: {
    original_name?: string | null;
    signed_url?: string | null;
  } | null;
  items?: Array<{ id: string }>;
  assignments?: Array<{ id: string; class_id: string; is_active: boolean }>;
};

type ProgressionItem = {
  id: string;
  item_type: string;
  title: string;
  rubric?: string | null;
  theme?: string | null;
  trimester?: string | null;
  week_label?: string | null;
  planned_duration_minutes?: number | null;
  sort_order?: number | null;
  indent_level?: number | null;
};

type Assignment = {
  id: string;
  class_id: string;
  is_active: boolean;
  classes?: (EducationClassMeta & {
    id: string;
    label?: string | null;
    level?: string | null;
  }) | null;
};

type StatsItem = EducationClassMeta & {
  assignment_id: string;
  progression_title: string;
  class_label: string;
  level: string | null;
  subject_name: string;
  teacher_name: string;
  expected_items: number;
  completed_items: number;
  completion_rate: number;
  sessions_count: number;
  realized_hours: number;
};

type EducationLevelContext = {
  education_type: string;
  education_label: string;
  formation_code: string | null;
  formation_label: string | null;
  level: string;
  level_label: string;
};

type EducationContextSubject = EducationLevelContext & {
  subject_id: string;
  subject_name: string;
};

type AdminTextbookTab = "library" | "progressions" | "stats";

const ITEM_TYPE_OPTIONS = [
  "lesson",
  "regulation",
  "revision",
  "evaluation",
  "remediation",
  "session",
  "theme",
  "rubric",
  "competency",
  "chapter",
  "other",
];

function normalizeSearch(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const emptyCreate = {
  title: "",
  academic_year: "",
  level: "",
  series: "",
  subject_id: "",
  description: "",
  education_type: "general_secondary",
  formation_code: "",
  formation_level_code: "",
};

const IMPORT_HEADER =
  "Ordre;Type;Rubrique;Thème;Titre;Durée minutes;Période;Semaine";

const ANGLAIS_2NDE_A_C_OFFICIAL_SAMPLE = [
  IMPORT_HEADER,
  "1;theme;UNIT 1;People;UNIT 1 PEOPLE;;T1;Semaines 1-2",
  "2;lesson;UNIT 1;People;UNIT 1 PEOPLE;360;T1;Semaines 1-2",
  "3;revision;UNIT 1;People;Révisions - UNIT 1 PEOPLE;60;T1;Semaine 3",
  "4;evaluation;UNIT 1;People;Évaluation - UNIT 1 PEOPLE;60;T1;Semaine 3",
  "5;remediation;UNIT 1;People;Correction / Remédiation - UNIT 1 PEOPLE;60;T1;Semaine 3",
  "6;theme;UNIT 2;Health and lifestyle;UNIT 2 HEALTH AND LIFESTYLE;;T1;Semaines 4-5",
  "7;lesson;UNIT 2;Health and lifestyle;UNIT 2 HEALTH AND LIFESTYLE;360;T1;Semaines 4-5",
  "8;revision;UNIT 2;Health and lifestyle;Révisions - UNIT 2 HEALTH AND LIFESTYLE;60;T1;Semaine 6",
  "9;evaluation;UNIT 2;Health and lifestyle;Évaluation - UNIT 2 HEALTH AND LIFESTYLE;60;T1;Semaine 6",
  "10;remediation;UNIT 2;Health and lifestyle;Correction / Remédiation - UNIT 2 HEALTH AND LIFESTYLE;60;T1;Semaine 6",
  "11;theme;UNIT 3;Technology;UNIT 3 TECHNOLOGY;;T1;Semaines 7-8",
  "12;lesson;UNIT 3;Technology;UNIT 3 TECHNOLOGY;360;T1;Semaines 7-8",
  "13;revision;UNIT 3;Technology;Révisions - UNIT 3 TECHNOLOGY;60;T1;Semaine 9",
  "14;evaluation;UNIT 3;Technology;Évaluation - UNIT 3 TECHNOLOGY;60;T1;Semaine 9",
  "15;remediation;UNIT 3;Technology;Correction / Remédiation - UNIT 3 TECHNOLOGY;60;T1;Semaine 9",
  "16;theme;UNIT 4;Looking forward;UNIT 4 LOOKING FORWARD;;T1;Semaines 10-11",
  "17;lesson;UNIT 4;Looking forward;UNIT 4 LOOKING FORWARD;360;T1;Semaines 10-11",
  "18;revision;UNIT 4;Looking forward;Révisions - UNIT 4 LOOKING FORWARD;60;T1;Semaine 12",
  "19;evaluation;UNIT 4;Looking forward;Évaluation - UNIT 4 LOOKING FORWARD;60;T1;Semaine 12",
  "20;remediation;UNIT 4;Looking forward;Correction / Remédiation - UNIT 4 LOOKING FORWARD;60;T1;Semaine 12",
  "21;theme;UNIT 5;Gender and education;UNIT 5 GENDER AND EDUCATION;;T2;Semaines 13-14",
  "22;lesson;UNIT 5;Gender and education;UNIT 5 GENDER AND EDUCATION;360;T2;Semaines 13-14",
  "23;revision;UNIT 5;Gender and education;Révisions - UNIT 5 GENDER AND EDUCATION;60;T2;Semaine 15",
  "24;evaluation;UNIT 5;Gender and education;Évaluation - UNIT 5 GENDER AND EDUCATION;60;T2;Semaine 15",
  "25;remediation;UNIT 5;Gender and education;Correction / Remédiation - UNIT 5 GENDER AND EDUCATION;60;T2;Semaine 15",
  "26;theme;UNIT 6;Citizenship;UNIT 6 CITIZENSHIP;;T2;Semaines 16-17",
  "27;lesson;UNIT 6;Citizenship;UNIT 6 CITIZENSHIP;360;T2;Semaines 16-17",
  "28;revision;UNIT 6;Citizenship;Révisions - UNIT 6 CITIZENSHIP;60;T2;Semaine 18",
  "29;evaluation;UNIT 6;Citizenship;Évaluation - UNIT 6 CITIZENSHIP;60;T2;Semaine 18",
  "30;remediation;UNIT 6;Citizenship;Correction / Remédiation - UNIT 6 CITIZENSHIP;60;T2;Semaine 18",
  "31;theme;UNIT 7;Sports;UNIT 7 SPORTS;;T2;Semaines 19-20",
  "32;lesson;UNIT 7;Sports;UNIT 7 SPORTS;360;T2;Semaines 19-20",
  "33;revision;UNIT 7;Sports;Révisions - UNIT 7 SPORTS;60;T2;Semaine 21",
  "34;evaluation;UNIT 7;Sports;Évaluation - UNIT 7 SPORTS;60;T2;Semaine 21",
  "35;remediation;UNIT 7;Sports;Correction / Remédiation - UNIT 7 SPORTS;60;T2;Semaine 21",
  "36;theme;UNIT 8;Science;UNIT 8 SCIENCE;;T3;Semaines 22-23",
  "37;lesson;UNIT 8;Science;UNIT 8 SCIENCE;360;T3;Semaines 22-23",
  "38;revision;UNIT 8;Science;Révisions - UNIT 8 SCIENCE;60;T3;Semaine 24",
  "39;evaluation;UNIT 8;Science;Évaluation - UNIT 8 SCIENCE;60;T3;Semaine 24",
  "40;remediation;UNIT 8;Science;Correction / Remédiation - UNIT 8 SCIENCE;60;T3;Semaine 24",
  "41;theme;UNIT 9;Wildlife;UNIT 9 WILDLIFE;;T3;Semaines 25-26",
  "42;lesson;UNIT 9;Wildlife;UNIT 9 WILDLIFE;360;T3;Semaines 25-26",
  "43;revision;UNIT 9;Wildlife;Révisions - UNIT 9 WILDLIFE;60;T3;Semaine 27",
  "44;evaluation;UNIT 9;Wildlife;Évaluation - UNIT 9 WILDLIFE;60;T3;Semaine 27",
  "45;remediation;UNIT 9;Wildlife;Correction / Remédiation - UNIT 9 WILDLIFE;60;T3;Semaine 27",
  "46;theme;UNIT 10;Culture and civilization;UNIT 10 CULTURE AND CIVILIZATION;;T3;Semaines 28-29",
  "47;lesson;UNIT 10;Culture and civilization;UNIT 10 CULTURE AND CIVILIZATION;360;T3;Semaines 28-29",
  "48;revision;UNIT 10;Culture and civilization;Révisions - UNIT 10 CULTURE AND CIVILIZATION;60;T3;Semaine 30",
  "49;evaluation;UNIT 10;Culture and civilization;Évaluation - UNIT 10 CULTURE AND CIVILIZATION;60;T3;Semaine 30",
  "50;remediation;UNIT 10;Culture and civilization;Correction / Remédiation - UNIT 10 CULTURE AND CIVILIZATION;60;T3;Semaine 30",
].join("\n");
const STRUCTURAL_ITEM_TYPES = new Set([
  "section",
  "theme",
  "rubric",
  "competency",
  "chapter",
]);

function normalizeImportType(value: unknown, hasDuration: boolean) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  const compact = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-]+/g, " ");

  const map: Record<string, string> = {
    section: "section",
    partie: "section",
    theme: "theme",
    rubrique: "rubric",
    competence: "competency",
    chapitre: "chapter",
    chapter: "chapter",
    lecon: "lesson",
    lesson: "lesson",
    cours: "lesson",
    sequence: "sequence",
    seance: "session",
    session: "session",
    evaluation: "evaluation",
    devoir: "evaluation",
    remediation: "remediation",
    regulation: "regulation",
    revision: "revision",
    autre: "other",
    other: "other",
  };

  const normalized = map[compact] || "lesson";
  // Si une ligne est importée comme thème/rubrique mais porte une durée,
  // on la rend exploitable par le professeur comme une leçon cliquable.
  if (STRUCTURAL_ITEM_TYPES.has(normalized) && hasDuration) return "lesson";
  return normalized;
}

function makeImportSample(progression?: Progression | null) {
  const subject = String(
    progression?.subject_name || progression?.title || "",
  ).toLowerCase();

  if (subject.includes("anglais") || subject.includes("english")) {
    return ANGLAIS_2NDE_A_C_OFFICIAL_SAMPLE;
  }

  if (subject.includes("français") || subject.includes("francais")) {
    return [
      IMPORT_HEADER,
      "1;rubric;Grammaire;Phrase;La phrase simple;;T1;Semaine 1",
      "2;lesson;Grammaire;Phrase;Les constituants de la phrase simple;55;T1;Semaine 1",
      "3;lesson;Expression écrite;Rédaction;Rédiger un paragraphe cohérent;55;T1;Semaine 2",
    ].join("\n");
  }

  return [
    IMPORT_HEADER,
    "1;theme;Activités numériques;Nombres;Nombres et calculs;;T1;Semaine 1",
    "2;lesson;Activités numériques;Nombres;Nombres entiers naturels;120;T1;Semaine 1",
    "3;lesson;Activités numériques;Nombres;Comparaison et rangement;55;T1;Semaine 2",
  ].join("\n");
}

function isBundledImportSample(text: string) {
  const value = String(text || "").trim();
  if (!value) return true;
  return (
    value.startsWith(IMPORT_HEADER) &&
    (value.includes("Nombres entiers naturels") ||
      value.includes("Greetings and introductions") ||
      value.includes("UNIT 1 PEOPLE") ||
      value.includes("La phrase simple"))
  );
}

function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function labelClass(c: ClassItem | Assignment["classes"]) {
  return String(c?.label || (c as any)?.name || "Classe");
}

function classContextLabel(c: EducationClassMeta | null | undefined) {
  if (!c || String(c.education_type || "general_secondary") === "general_secondary") {
    return "";
  }
  return String(
    c.education_context_label ||
      [c.formation_label, c.formation_level_label].filter(Boolean).join(" • ") ||
      c.education_label ||
      "",
  );
}

function progressionContextLabel(p: Progression | null | undefined) {
  if (!p || String(p.education_type || "general_secondary") === "general_secondary") {
    return "";
  }
  return String(
    p.education_context_label ||
      [p.formation_label, p.formation_level_label].filter(Boolean).join(" • ") ||
      p.education_label ||
      "",
  );
}

function parseImportLines(text: string) {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = line.split(";").map((cell) => cell.trim());
      if (
        index === 0 &&
        /type|titre|le[cç]on|rubrique/i.test(line) &&
        cells.length > 3
      ) {
        return null;
      }

      const [order, type, rubric, theme, title, duration, trimester, week] =
        cells;
      const finalTitle = title || theme || rubric || line;
      const minutes = Number(String(duration || "").replace(/[^0-9]/g, ""));
      const hasDuration = Number.isFinite(minutes) && minutes > 0;
      const itemType = normalizeImportType(type, hasDuration);

      return {
        sort_order: Number(order) || index + 1,
        item_type: itemType,
        rubric: rubric || null,
        theme: theme || null,
        title: finalTitle,
        planned_duration_minutes: hasDuration ? minutes : null,
        trimester: trimester || null,
        week_label: week || null,
        indent_level: STRUCTURAL_ITEM_TYPES.has(itemType) ? 0 : 1,
      };
    })
    .filter(Boolean);
}

export default function AdminTextbookPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [educationContexts, setEducationContexts] = useState<EducationLevelContext[]>([]);
  const [educationContextSubjects, setEducationContextSubjects] = useState<EducationContextSubject[]>([]);
  const [progressions, setProgressions] = useState<Progression[]>([]);
  const [nationalProgressions, setNationalProgressions] = useState<Progression[]>([]);
  const [canManageNational, setCanManageNational] = useState(false);
  const [nationalSelectedId, setNationalSelectedId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [items, setItems] = useState<ProgressionItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [stats, setStats] = useState<StatsItem[]>([]);

  const [createForm, setCreateForm] = useState(emptyCreate);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [nationalForm, setNationalForm] = useState(emptyCreate);
  const [nationalDocumentFile, setNationalDocumentFile] = useState<File | null>(null);
  const [nationalImportText, setNationalImportText] = useState(() => makeImportSample(null));
  const [importText, setImportText] = useState(() => makeImportSample(null));
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<AdminTextbookTab>("library");
  const [nationalSearch, setNationalSearch] = useState("");
  const [nationalYearFilter, setNationalYearFilter] = useState("");
  const [nationalSubjectFilter, setNationalSubjectFilter] = useState("");
  const [nationalEducationFilter, setNationalEducationFilter] = useState("");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolEducationFilter, setSchoolEducationFilter] = useState("");
  const [showLocalCreate, setShowLocalCreate] = useState(false);
  const [editableItems, setEditableItems] = useState<ProgressionItem[]>([]);

  const selected = useMemo(
    () => progressions.find((p) => p.id === selectedId) || null,
    [progressions, selectedId],
  );

  const selectedNational = useMemo(
    () => nationalProgressions.find((p) => p.id === nationalSelectedId) || null,
    [nationalProgressions, nationalSelectedId],
  );

  const educationTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    map.set("general_secondary", "Secondaire général");
    for (const context of educationContexts) {
      map.set(context.education_type, context.education_label || context.education_type);
    }
    for (const c of classes) {
      const type = String(c.education_type || "general_secondary");
      map.set(type, c.education_label || map.get(type) || type);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [educationContexts, classes]);

  const createFormationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const context of educationContexts) {
      if (context.education_type !== createForm.education_type) continue;
      const code = String(context.formation_code || "");
      if (!code) continue;
      map.set(code, context.formation_label || code);
    }
    return Array.from(map.entries()).map(([code, label]) => ({ code, label }));
  }, [educationContexts, createForm.education_type]);

  const createLevelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const context of educationContexts) {
      if (context.education_type !== createForm.education_type) continue;
      if (String(context.formation_code || "") !== createForm.formation_code) continue;
      map.set(context.level, context.level_label || context.level);
    }
    return Array.from(map.entries()).map(([code, label]) => ({ code, label }));
  }, [educationContexts, createForm.education_type, createForm.formation_code]);

  const createSubjectOptions = useMemo(() => {
    if (createForm.education_type === "general_secondary") return subjects;
    const allowed = new Set(
      educationContextSubjects
        .filter(
          (row) =>
            row.education_type === createForm.education_type &&
            String(row.formation_code || "") === createForm.formation_code &&
            row.level === createForm.formation_level_code,
        )
        .map((row) => row.subject_id),
    );
    return subjects.filter((subject) => allowed.has(subject.id));
  }, [
    subjects,
    educationContextSubjects,
    createForm.education_type,
    createForm.formation_code,
    createForm.formation_level_code,
  ]);

  const nationalEducationTypes = useMemo(
    () =>
      Array.from(
        new Set(
          nationalProgressions.map((p) =>
            String(p.education_type || "general_secondary"),
          ),
        ),
      ),
    [nationalProgressions],
  );

  const nationalYears = useMemo(
    () =>
      Array.from(
        new Set(nationalProgressions.map((p) => p.academic_year).filter(Boolean)),
      ).sort((a, b) => String(b).localeCompare(String(a))),
    [nationalProgressions],
  );

  const nationalSubjects = useMemo(
    () =>
      Array.from(
        new Set(nationalProgressions.map((p) => String(p.subject_name || "")).filter(Boolean)),
      ).sort((a, b) => String(a).localeCompare(String(b))),
    [nationalProgressions],
  );

  const filteredNationalProgressions = useMemo(() => {
    const q = normalizeSearch(nationalSearch);
    return nationalProgressions.filter((p) => {
      if (nationalYearFilter && p.academic_year !== nationalYearFilter) return false;
      if (nationalSubjectFilter && (p.subject_name || "") !== nationalSubjectFilter) return false;
      if (
        nationalEducationFilter &&
        String(p.education_type || "general_secondary") !== nationalEducationFilter
      ) return false;
      if (!q) return true;
      const haystack = normalizeSearch(
        [p.title, p.subject_name, p.level, p.series, p.academic_year, progressionContextLabel(p)].join(" "),
      );
      return haystack.includes(q);
    });
  }, [nationalProgressions, nationalSearch, nationalYearFilter, nationalSubjectFilter, nationalEducationFilter]);

  const filteredProgressions = useMemo(() => {
    const q = normalizeSearch(schoolSearch);
    return progressions.filter((p) => {
      if (
        schoolEducationFilter &&
        String(p.education_type || "general_secondary") !== schoolEducationFilter
      ) return false;
      if (!q) return true;
      return normalizeSearch(
        [p.title, p.subject_name, p.level, p.academic_year, progressionContextLabel(p)].join(" "),
      ).includes(q);
    });
  }, [progressions, schoolSearch, schoolEducationFilter]);

  const selectedItemCount = items.length || selected?.items?.length || 0;

  useEffect(() => {
    if (!selected) return;
    setImportText((current) =>
      isBundledImportSample(current) ? makeImportSample(selected) : current,
    );
  }, [selected?.id]);

  useEffect(() => {
    if (!selectedNational) return;
    setNationalImportText((current) =>
      isBundledImportSample(current) ? makeImportSample(selectedNational) : current,
    );
  }, [selectedNational?.id]);

  async function fetchJson(url: string, init?: RequestInit) {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...init,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) {
      throw new Error(
        json?.message || json?.details || json?.error || `Erreur HTTP ${res.status}`,
      );
    }
    return json;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [
        subjectJson,
        classJson,
        progressionJson,
        statsJson,
        nationalJson,
        contextJson,
      ] = await Promise.all([
          fetchJson("/api/admin/subjects"),
          fetchJson("/api/admin/classes?limit=999"),
          fetchJson("/api/admin/textbook/progressions"),
          fetchJson("/api/admin/textbook/stats"),
          fetchJson("/api/admin/textbook/national"),
          fetchJson("/api/admin/institution/subject-coeffs"),
        ]);

      setSubjects(subjectJson.items || []);
      setClasses(classJson.items || []);
      setProgressions(progressionJson.items || []);
      setStats(statsJson.items || []);
      setNationalProgressions(nationalJson.items || []);
      setEducationContexts(contextJson.levels || []);
      setEducationContextSubjects(contextJson.items || []);
      setCanManageNational(Boolean(nationalJson.can_manage_national));

      const firstId = progressionJson.items?.[0]?.id || "";
      const firstNationalId = nationalJson.items?.[0]?.id || "";
      setSelectedId((current) => current || firstId);
      setNationalSelectedId((current) => current || firstNationalId);
    } catch (e: any) {
      setError(e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelected(id: string) {
    if (!id) return;
    try {
      const [itemsJson, assignmentsJson] = await Promise.all([
        fetchJson(`/api/admin/textbook/progressions/${id}/items`),
        fetchJson(`/api/admin/textbook/progressions/${id}/assignments`),
      ]);
      const loadedItems = itemsJson.items || [];
      setItems(loadedItems);
      setEditableItems(loadedItems);
      setAssignments(assignmentsJson.items || []);
    } catch (e: any) {
      setError(e?.message || "Détails indisponibles");
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setItems([]);
    setEditableItems([]);
    setAssignments([]);
    setSelectedClassIds([]);
    if (selectedId) loadSelected(selectedId);
  }, [selectedId]);

  async function createNationalProgression(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageNational) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const subject = subjects.find((s) => s.id === nationalForm.subject_id);
      const form = new FormData();
      form.set("title", nationalForm.title);
      form.set("academic_year", nationalForm.academic_year);
      form.set("level", nationalForm.level);
      form.set("series", nationalForm.series);
      form.set("subject_id", subject?.id || "");
      form.set("institution_subject_id", subject?.inst_subject_id || "");
      form.set("subject_name", subject?.name || "");
      form.set("description", nationalForm.description);
      form.set("status", "active");
      if (nationalDocumentFile) form.set("document_file", nationalDocumentFile);

      const json = await fetchJson("/api/admin/textbook/national", {
        method: "POST",
        body: form,
      });

      setMessage("Modèle national créé. Vous pouvez maintenant importer ses lignes cliquables.");
      setNationalForm(emptyCreate);
      setNationalDocumentFile(null);
      await loadAll();
      setNationalSelectedId(json.item?.id || "");
    } catch (e: any) {
      setError(e?.message || "Création du modèle national impossible");
    } finally {
      setBusy(false);
    }
  }

  async function importNationalItems() {
    if (!selectedNational || !canManageNational) return;
    const parsed = parseImportLines(nationalImportText);
    if (!parsed.length) {
      setError("Aucune ligne exploitable dans l'import national.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(`/api/admin/textbook/national/${selectedNational.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsed, replace: true }),
      });
      setMessage(`${parsed.length} ligne(s) publiée(s) dans le modèle national.`);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Import national impossible");
    } finally {
      setBusy(false);
    }
  }

  async function copyNationalProgression(progression: Progression) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const json = await fetchJson(`/api/admin/textbook/national/${progression.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_assign: true }),
      });
      const autoAssigned = Number(json.auto_assigned_classes || 0);
      const autoText = autoAssigned
        ? ` ${autoAssigned} classe(s) liée(s) automatiquement.`
        : json.auto_assign_skipped === "manual_subject"
          ? " Affectation manuelle requise pour cette discipline."
          : json.auto_assign_skipped === "subject_not_configured_for_context"
            ? " La matière doit d’abord être configurée pour cette formation et cette année."
            : json.auto_assign_skipped === "no_matching_class"
              ? " Aucune classe compatible n’a été trouvée dans cet établissement."
              : "";
      setMessage(
        json.already_exists
          ? `Cette progression est déjà disponible dans votre établissement.${autoText}`
          : `Progression copiée avec ${json.copied_items || 0} ligne(s).${autoText}`,
      );
      await loadAll();
      if (json.item?.id) setSelectedId(json.item.id);
      setActiveTab("progressions");
    } catch (e: any) {
      setError(e?.message || "Copie depuis la bibliothèque nationale impossible");
    } finally {
      setBusy(false);
    }
  }

  async function copyFilteredNationalProgressions() {
    const list = filteredNationalProgressions;
    if (!list.length) {
      setError("Aucun modèle affiché à utiliser.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let copied = 0;
      let already = 0;
      let autoAssigned = 0;
      let lastCopiedId = "";

      for (const progression of list) {
        const json = await fetchJson(`/api/admin/textbook/national/${progression.id}/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto_assign: true }),
        });
        if (json.already_exists) already += 1;
        else copied += 1;
        autoAssigned += Number(json.auto_assigned_classes || 0);
        if (json.item?.id) lastCopiedId = json.item.id;
      }

      await loadAll();
      if (lastCopiedId) setSelectedId(lastCopiedId);
      setActiveTab("progressions");
      setMessage(
        `${copied} nouvelle(s) progression(s), ${already} déjà existante(s). ${autoAssigned} affectation(s) automatique(s) créée(s).`,
      );
    } catch (e: any) {
      setError(e?.message || "Copie groupée impossible");
    } finally {
      setBusy(false);
    }
  }

  async function createProgression(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const subject = subjects.find((s) => s.id === createForm.subject_id);
      const selectedContext = educationContexts.find(
        (context) =>
          context.education_type === createForm.education_type &&
          String(context.formation_code || "") === createForm.formation_code &&
          context.level === createForm.formation_level_code,
      );
      const form = new FormData();
      form.set("title", createForm.title);
      form.set("academic_year", createForm.academic_year);
      form.set(
        "level",
        createForm.education_type === "general_secondary"
          ? createForm.level
          : createForm.formation_level_code,
      );
      form.set("series", createForm.series);
      form.set("education_type", createForm.education_type);
      form.set("formation_code", createForm.formation_code);
      form.set("formation_label", selectedContext?.formation_label || "");
      form.set("formation_level_code", createForm.formation_level_code);
      form.set("formation_level_label", selectedContext?.level_label || "");
      form.set("subject_id", subject?.id || "");
      form.set("institution_subject_id", subject?.inst_subject_id || "");
      form.set("subject_name", subject?.name || "");
      form.set("description", createForm.description);
      if (documentFile) form.set("document_file", documentFile);

      const json = await fetchJson("/api/admin/textbook/progressions", {
        method: "POST",
        body: form,
      });

      setMessage(
        "Progression créée. Vous pouvez maintenant importer les leçons et affecter les classes.",
      );
      setCreateForm(emptyCreate);
      setDocumentFile(null);
      await loadAll();
      setSelectedId(json.item?.id || "");
    } catch (e: any) {
      setError(e?.message || "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  async function importItems() {
    if (!selected) return;
    const parsed = parseImportLines(importText);
    if (!parsed.length) {
      setError("Aucune ligne exploitable dans l'import.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(`/api/admin/textbook/progressions/${selected.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsed, replace: replaceExisting }),
      });
      setMessage(
        replaceExisting
          ? `${parsed.length} ligne(s) importée(s). Les anciennes lignes ont été remplacées.`
          : `${parsed.length} ligne(s) ajoutée(s) dans la progression.`,
      );
      await loadSelected(selected.id);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Import impossible");
    } finally {
      setBusy(false);
    }
  }


  function updateEditableItem(
    index: number,
    key: keyof ProgressionItem,
    value: string,
  ) {
    setEditableItems((prev) =>
      prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (key === "sort_order" || key === "planned_duration_minutes") {
          const n = Number(value);
          return { ...row, [key]: Number.isFinite(n) && value !== "" ? n : null };
        }
        return { ...row, [key]: value };
      }),
    );
  }

  function addEditableItem() {
    setEditableItems((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}`,
        sort_order: prev.length + 1,
        item_type: "lesson",
        title: "Nouvelle leçon",
        rubric: "",
        theme: "",
        trimester: "",
        week_label: "",
        planned_duration_minutes: 55,
        indent_level: 1,
      },
    ]);
  }

  function removeEditableItem(index: number) {
    setEditableItems((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }

  async function saveEditableItems() {
    if (!selected) return;
    const prepared = editableItems
      .map((row, index) => {
        const title = String(row.title || "").trim();
        if (!title) return null;
        const type = normalizeImportType(
          row.item_type || "lesson",
          Number(row.planned_duration_minutes || 0) > 0,
        );
        return {
          sort_order: Number(row.sort_order || index + 1),
          item_type: type,
          rubric: row.rubric || null,
          theme: row.theme || null,
          title,
          planned_duration_minutes: Number(row.planned_duration_minutes || 0) || null,
          trimester: row.trimester || null,
          week_label: row.week_label || null,
          indent_level: STRUCTURAL_ITEM_TYPES.has(type) ? 0 : 1,
        };
      })
      .filter(Boolean);

    if (!prepared.length) {
      setError("Aucune ligne exploitable à enregistrer.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(`/api/admin/textbook/progressions/${selected.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: prepared, replace: true }),
      });
      setMessage(`${prepared.length} ligne(s) enregistrée(s) dans la copie établissement.`);
      await loadSelected(selected.id);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Enregistrement du tableau impossible");
    } finally {
      setBusy(false);
    }
  }

  async function assignClasses() {
    if (!selected || !selectedClassIds.length) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(
        `/api/admin/textbook/progressions/${selected.id}/assignments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class_ids: selectedClassIds }),
        },
      );
      setMessage("Progression affectée aux classes sélectionnées.");
      await loadSelected(selected.id);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Affectation impossible");
    } finally {
      setBusy(false);
    }
  }

  const compatibleClasses = useMemo(() => {
    if (!selected) return [];
    const educationType = String(
      selected.education_type || "general_secondary",
    );

    if (educationType !== "general_secondary") {
      return classes.filter(
        (c) =>
          String(c.education_type || "general_secondary") === educationType &&
          String(c.formation_code || "") ===
            String(selected.formation_code || "") &&
          String(c.formation_level_code || "") ===
            String(selected.formation_level_code || selected.level || "") &&
          (!selected.academic_year ||
            !c.academic_year ||
            String(c.academic_year) === String(selected.academic_year)),
      );
    }

    if (!selected.level) {
      return classes.filter(
        (c) =>
          String(c.education_type || "general_secondary") ===
          "general_secondary",
      );
    }
    const level = selected.level.toLowerCase();
    return classes.filter(
      (c) =>
        String(c.education_type || "general_secondary") ===
          "general_secondary" &&
        (String(c.level || "").toLowerCase() === level ||
          labelClass(c).toLowerCase().includes(level)),
    );
  }, [classes, selected]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-[30px] border border-emerald-100 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-sky-600 px-6 py-7 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ring-1 ring-white/20">
                  <BookOpen className="h-4 w-4" /> Module pédagogique
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight md:text-4xl">
                  Cahier de texte
                </h1>
                <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-emerald-50">
                  Progressions officielles, séances réalisées par les
                  enseignants, leçons terminées et statistiques de suivi par
                  classe, matière et professeur.
                </p>
              </div>
              <button
                onClick={loadAll}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-emerald-700 shadow-sm"
              >
                <RefreshCw className="h-4 w-4" /> Actualiser
              </button>
            </div>
          </div>
        </header>

        {message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-[26px] border border-slate-200 bg-white p-2 shadow-sm">
          <div className="grid gap-2 md:grid-cols-3">
            {[
              ["library", "Choisir depuis Nexa", `${filteredNationalProgressions.length} modèle(s)`],
              ["progressions", "Progressions & affectations", `${progressions.length} progression(s)`],
              ["stats", "Tableau de bord", `${stats.length} classe(s)`],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as AdminTextbookTab)}
                className={classNames(
                  "rounded-2xl px-4 py-3 text-left transition",
                  activeTab === key
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                )}
              >
                <div className="text-sm font-black">{label}</div>
                <div className={classNames("mt-1 text-xs font-bold", activeTab === key ? "text-emerald-50" : "text-slate-400")}>{count}</div>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement du cahier de texte…
          </div>
        ) : activeTab === "library" ? (
          <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
            <div className="rounded-[28px] border border-indigo-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
                    Bibliothèque nationale Nexa
                  </div>
                  <h2 className="mt-1 text-lg font-black">Choisir un modèle</h2>
                </div>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                  {filteredNationalProgressions.length}/{nationalProgressions.length}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                <input
                  value={nationalSearch}
                  onChange={(e) => setNationalSearch(e.target.value)}
                  placeholder="Rechercher : matière, niveau, année..."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400"
                />
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    value={nationalYearFilter}
                    onChange={(e) => setNationalYearFilter(e.target.value)}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"
                  >
                    <option value="">Toutes années</option>
                    {nationalYears.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                  <select
                    value={nationalSubjectFilter}
                    onChange={(e) => setNationalSubjectFilter(e.target.value)}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"
                  >
                    <option value="">Toutes matières</option>
                    {nationalSubjects.map((subject) => (
                      <option key={subject} value={subject}>{subject}</option>
                    ))}
                  </select>
                  <select
                    value={nationalEducationFilter}
                    onChange={(e) => setNationalEducationFilter(e.target.value)}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400"
                  >
                    <option value="">Tous enseignements</option>
                    {nationalEducationTypes.map((type) => (
                      <option key={type} value={type}>
                        {educationTypeOptions.find((item) => item.id === type)?.label || type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={copyFilteredNationalProgressions}
                disabled={busy || !filteredNationalProgressions.length}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Utiliser tous les modèles affichés
              </button>

              <div className="mt-4 max-h-[460px] space-y-2 overflow-auto pr-1">
                {filteredNationalProgressions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setNationalSelectedId(p.id)}
                    className={classNames(
                      "w-full rounded-2xl border px-3 py-3 text-left transition",
                      nationalSelectedId === p.id
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-slate-50 hover:bg-white",
                    )}
                  >
                    <div className="line-clamp-1 text-sm font-black text-slate-950">{p.title}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-black text-slate-500">
                      <span>{p.subject_name || "Matière"}</span>
                      <span>·</span>
                      <span>{progressionContextLabel(p) || p.level || "Niveau"}</span>
                      <span>·</span>
                      <span>{p.academic_year}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-indigo-700 ring-1 ring-indigo-100">
                        {p.items?.length || 0} lignes
                      </span>
                    </div>
                  </button>
                ))}
                {!filteredNationalProgressions.length ? (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
                    Aucun modèle ne correspond aux filtres.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-5">
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                {!selectedNational ? (
                  <div className="py-10 text-center text-sm font-bold text-slate-400">
                    Sélectionnez une progression nationale.
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
                        Modèle sélectionné
                      </div>
                      <h2 className="mt-1 text-2xl font-black">{selectedNational.title}</h2>
                      <p className="mt-1 text-sm font-bold text-slate-500">
                        {selectedNational.subject_name || "Matière"} · {progressionContextLabel(selectedNational) || selectedNational.level || "Niveau"} · {selectedNational.academic_year}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">Nationale</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{selectedNational.items?.length || 0} lignes</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedNational.document?.signed_url ? (
                        <a
                          href={selectedNational.document.signed_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700"
                        >
                          <FileText className="h-4 w-4" /> Fichier officiel
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => copyNationalProgression(selectedNational)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                      >
                        Utiliser ce modèle
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {canManageNational ? (
                <details className="rounded-[28px] border border-indigo-100 bg-white p-5 shadow-sm">
                  <summary className="cursor-pointer text-sm font-black text-indigo-800">
                    Gestion nationale avancée
                  </summary>
                  <form onSubmit={createNationalProgression} className="mt-4 grid gap-3 md:grid-cols-2">
                    <input className="rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400" placeholder="Titre national" value={nationalForm.title} onChange={(e) => setNationalForm((f) => ({ ...f, title: e.target.value }))} required />
                    <input className="rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400" placeholder="Année" value={nationalForm.academic_year} onChange={(e) => setNationalForm((f) => ({ ...f, academic_year: e.target.value }))} />
                    <input className="rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400" placeholder="Niveau" value={nationalForm.level} onChange={(e) => setNationalForm((f) => ({ ...f, level: e.target.value }))} required />
                    <select className="rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400" value={nationalForm.subject_id} onChange={(e) => setNationalForm((f) => ({ ...f, subject_id: e.target.value }))} required>
                      <option value="">Discipline</option>
                      {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <label className="md:col-span-2 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-slate-700">
                      <Upload className="h-4 w-4" />
                      <span>{nationalDocumentFile ? nationalDocumentFile.name : "Joindre le fichier officiel national"}</span>
                      <input className="hidden" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => setNationalDocumentFile(e.target.files?.[0] || null)} />
                    </label>
                    <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Publier
                    </button>
                  </form>
                  {selectedNational ? (
                    <div className="mt-5">
                      <textarea className="h-44 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:border-indigo-400" value={nationalImportText} onChange={(e) => setNationalImportText(e.target.value)} />
                      <button type="button" onClick={importNationalItems} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                        <Upload className="h-4 w-4" /> Importer les lignes nationales
                      </button>
                    </div>
                  ) : null}
                </details>
              ) : null}
            </div>
          </section>
        ) : activeTab === "progressions" ? (
          <section className="grid gap-5 xl:grid-cols-[320px_1fr]">
            <aside className="space-y-4">
              <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black">Progressions de l’établissement</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{filteredProgressions.length}</span>
                </div>
                <div className="mt-3 grid gap-2">
                  <input
                    value={schoolSearch}
                    onChange={(e) => setSchoolSearch(e.target.value)}
                    placeholder="Rechercher une copie..."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                  />
                  <select
                    value={schoolEducationFilter}
                    onChange={(e) => setSchoolEducationFilter(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                  >
                    <option value="">Tous les enseignements</option>
                    {educationTypeOptions.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black outline-none focus:border-emerald-400"
                >
                  <option value="">Sélectionner une progression</option>
                  {filteredProgressions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} — {progressionContextLabel(p) || p.level || "Niveau"}
                    </option>
                  ))}
                </select>
                <div className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1">
                  {filteredProgressions.slice(0, 18).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={classNames(
                        "w-full rounded-2xl border px-3 py-3 text-left transition",
                        selectedId === p.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50 hover:bg-white",
                      )}
                    >
                      <div className="line-clamp-1 text-sm font-black">{p.title}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        {p.subject_name || "Matière"} · {progressionContextLabel(p) || p.level || "Niveau"} · {p.academic_year}
                      </div>
                      <div className="mt-2 text-[11px] font-black text-slate-500">{p.items?.length || 0} lignes · {p.assignments?.length || 0} classes</div>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowLocalCreate((v) => !v)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-800 ring-1 ring-amber-100"
                >
                  <Plus className="h-4 w-4" /> Créer une progression personnalisée
                </button>
              </section>

              {showLocalCreate ? (
                <form
                  onSubmit={createProgression}
                  className="space-y-3 rounded-[28px] border border-amber-200 bg-amber-50 p-4 shadow-sm"
                >
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    placeholder="Titre"
                    value={createForm.title}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, title: e.target.value }))
                    }
                    required
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      placeholder="Année scolaire"
                      value={createForm.academic_year}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          academic_year: e.target.value,
                        }))
                      }
                    />
                    <select
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      value={createForm.education_type}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          education_type: e.target.value,
                          formation_code: "",
                          formation_level_code: "",
                          subject_id: "",
                        }))
                      }
                    >
                      {educationTypeOptions.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {createForm.education_type === "general_secondary" ? (
                    <input
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      placeholder="Niveau"
                      value={createForm.level}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, level: e.target.value }))
                      }
                      required
                    />
                  ) : (
                    <div className="grid gap-2">
                      <select
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                        value={createForm.formation_code}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            formation_code: e.target.value,
                            formation_level_code: "",
                            subject_id: "",
                          }))
                        }
                        required
                      >
                        <option value="">Formation / filière</option>
                        {createFormationOptions.map((formation) => (
                          <option key={formation.code} value={formation.code}>
                            {formation.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                        value={createForm.formation_level_code}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            formation_level_code: e.target.value,
                            subject_id: "",
                          }))
                        }
                        required
                      >
                        <option value="">Année de formation</option>
                        {createLevelOptions.map((level) => (
                          <option key={level.code} value={level.code}>
                            {level.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <select
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    value={createForm.subject_id}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        subject_id: e.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">Discipline</option>
                    {createSubjectOptions.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                  {createForm.education_type !== "general_secondary" &&
                  createForm.formation_level_code &&
                  !createSubjectOptions.length ? (
                    <p className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                      Aucune matière n’est encore configurée pour cette formation et cette année.
                    </p>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">
                    <Upload className="h-4 w-4" />
                    <span>
                      {documentFile ? documentFile.name : "Fichier officiel"}
                    </span>
                    <input
                      className="hidden"
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
                      onChange={(e) =>
                        setDocumentFile(e.target.files?.[0] || null)
                      }
                    />
                  </label>
                  <button
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" /> Enregistrer
                  </button>
                </form>
              ) : null}
            </aside>

            {!selected ? (
              <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
                Choisissez ou copiez une progression pour continuer.
              </div>
            ) : (
              <div className="space-y-5">
                <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Progression d’établissement</div>
                      <h2 className="mt-1 text-2xl font-black">{selected.title}</h2>
                      <p className="mt-1 text-sm font-bold text-slate-500">
                        {selected.subject_name || "Matière"} · {progressionContextLabel(selected) || selected.level || "Niveau"} · {selected.academic_year}
                      </p>
                    </div>
                    {selected.document?.signed_url ? (
                      <a href={selected.document.signed_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700">
                        <FileText className="h-4 w-4" /> Fichier officiel
                      </a>
                    ) : null}
                  </div>
                </section>

                <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-lg font-black">Adapter les lignes</h3>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={addEditableItem} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"><Plus className="h-4 w-4" /> Ligne</button>
                        <button type="button" onClick={saveEditableItems} disabled={busy || !editableItems.length} className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-60"><Save className="h-4 w-4" /> Enregistrer</button>
                      </div>
                    </div>
                    <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
                      <table className="min-w-[900px] w-full text-left text-xs">
                        <thead className="bg-slate-50 uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-2 py-3">Ordre</th>
                            <th className="px-2 py-3">Type</th>
                            <th className="px-2 py-3">Titre</th>
                            <th className="px-2 py-3">Rubrique</th>
                            <th className="px-2 py-3">Thème</th>
                            <th className="px-2 py-3">Min</th>
                            <th className="px-2 py-3">Période</th>
                            <th className="px-2 py-3">Semaine</th>
                            <th className="px-2 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {editableItems.map((item, index) => (
                            <tr key={item.id || index}>
                              <td className="px-2 py-2"><input className="w-16 rounded-lg border border-slate-200 px-2 py-1 font-bold" value={item.sort_order ?? index + 1} onChange={(e) => updateEditableItem(index, "sort_order", e.target.value)} /></td>
                              <td className="px-2 py-2"><select className="w-28 rounded-lg border border-slate-200 px-2 py-1 font-bold" value={item.item_type || "lesson"} onChange={(e) => updateEditableItem(index, "item_type", e.target.value)}>{ITEM_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}</select></td>
                              <td className="px-2 py-2"><input className="min-w-72 rounded-lg border border-slate-200 px-2 py-1 font-bold" value={item.title || ""} onChange={(e) => updateEditableItem(index, "title", e.target.value)} /></td>
                              <td className="px-2 py-2"><input className="w-32 rounded-lg border border-slate-200 px-2 py-1" value={item.rubric || ""} onChange={(e) => updateEditableItem(index, "rubric", e.target.value)} /></td>
                              <td className="px-2 py-2"><input className="w-32 rounded-lg border border-slate-200 px-2 py-1" value={item.theme || ""} onChange={(e) => updateEditableItem(index, "theme", e.target.value)} /></td>
                              <td className="px-2 py-2"><input className="w-20 rounded-lg border border-slate-200 px-2 py-1" value={item.planned_duration_minutes ?? ""} onChange={(e) => updateEditableItem(index, "planned_duration_minutes", e.target.value)} /></td>
                              <td className="px-2 py-2"><input className="w-20 rounded-lg border border-slate-200 px-2 py-1" value={item.trimester || ""} onChange={(e) => updateEditableItem(index, "trimester", e.target.value)} /></td>
                              <td className="px-2 py-2"><input className="w-32 rounded-lg border border-slate-200 px-2 py-1" value={item.week_label || ""} onChange={(e) => updateEditableItem(index, "week_label", e.target.value)} /></td>
                              <td className="px-2 py-2"><button type="button" onClick={() => removeEditableItem(index)} className="rounded-full bg-red-50 px-2 py-1 font-black text-red-600">×</button></td>
                            </tr>
                          ))}
                          {!editableItems.length ? (
                            <tr><td colSpan={9} className="px-3 py-8 text-center font-bold text-slate-400">Aucune ligne.</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-emerald-200 bg-white p-5 shadow-sm lg:sticky lg:top-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-black">Classes concernées</h3>
                      <button
                        type="button"
                        onClick={() => setSelectedClassIds(compatibleClasses.map((c) => c.id))}
                        className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 ring-1 ring-emerald-100"
                      >
                        Tout cocher
                      </button>
                    </div>
                    <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                      Seules les classes du même type d’enseignement, de la même formation et de la même année sont proposées.
                    </p>
                    <div className="mt-4 max-h-[420px] space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {compatibleClasses.map((c) => {
                        const checked = selectedClassIds.includes(c.id);
                        const already = assignments.some((a) => a.class_id === c.id && a.is_active);
                        return (
                          <label key={c.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm font-bold ring-1 ring-slate-200">
                            <span>
                              {labelClass(c)} <span className="text-xs text-slate-400">{c.level || ""}</span>
                              {classContextLabel(c) ? (
                                <span className="mt-1 block text-[10px] font-black uppercase tracking-wide text-indigo-600">
                                  {classContextLabel(c)}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex items-center gap-2">
                              {already ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">Déjà liée</span> : null}
                              <input type="checkbox" checked={checked} onChange={(e) => setSelectedClassIds((prev) => e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id))} />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <button onClick={assignClasses} disabled={busy || !selectedClassIds.length} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                      <CheckCircle2 className="h-4 w-4" /> Affecter les classes
                    </button>
                    <details className="mt-4 rounded-2xl bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-black text-slate-600">Import CSV avancé</summary>
                      <textarea className="mt-3 h-40 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs outline-none focus:border-emerald-400" value={importText} onChange={(e) => setImportText(e.target.value)} />
                      <button onClick={importItems} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                        <Upload className="h-4 w-4" /> Remplacer par CSV
                      </button>
                    </details>
                  </section>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black">Tableau de bord des progressions</h2>
              <button onClick={loadAll} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"><RefreshCw className="h-4 w-4" /> Actualiser</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs font-black uppercase text-slate-500">Classes suivies</div><div className="mt-1 text-2xl font-black">{stats.length}</div></div>
              <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-xs font-black uppercase text-emerald-700">Séances saisies</div><div className="mt-1 text-2xl font-black text-emerald-800">{stats.reduce((s, i) => s + i.sessions_count, 0)}</div></div>
              <div className="rounded-2xl bg-sky-50 p-4"><div className="text-xs font-black uppercase text-sky-700">Heures réalisées</div><div className="mt-1 text-2xl font-black text-sky-800">{Math.round(stats.reduce((s, i) => s + i.realized_hours, 0) * 10) / 10}</div></div>
            </div>
            <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-[820px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-3">Classe</th><th className="px-3 py-3">Matière</th><th className="px-3 py-3">Prof</th><th className="px-3 py-3">Progression</th><th className="px-3 py-3">Séances</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.map((row) => (
                    <tr key={row.assignment_id}>
                      <td className="px-3 py-3 font-black">
                        {row.class_label}
                        {classContextLabel(row) ? (
                          <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-indigo-600">
                            {classContextLabel(row)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">{row.subject_name}</td>
                      <td className="px-3 py-3 text-slate-600">{row.teacher_name}</td>
                      <td className="px-3 py-3"><span className="font-black text-emerald-700">{row.completion_rate}%</span> <span className="text-xs text-slate-500">({row.completed_items}/{row.expected_items})</span></td>
                      <td className="px-3 py-3">{row.sessions_count}</td>
                    </tr>
                  ))}
                  {!stats.length ? <tr><td colSpan={5} className="px-3 py-8 text-center font-bold text-slate-400">Aucune statistique disponible.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
