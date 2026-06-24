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
type ClassItem = {
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
  classes?: { id: string; label?: string | null; level?: string | null } | null;
};

type StatsItem = {
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

const emptyCreate = {
  title: "",
  academic_year: "",
  level: "",
  series: "",
  subject_id: "",
  description: "",
};

const IMPORT_HEADER =
  "Ordre;Type;Rubrique;Thème;Titre;Durée minutes;Trimestre;Semaine";

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

  const selected = useMemo(
    () => progressions.find((p) => p.id === selectedId) || null,
    [progressions, selectedId],
  );

  const selectedNational = useMemo(
    () => nationalProgressions.find((p) => p.id === nationalSelectedId) || null,
    [nationalProgressions, nationalSelectedId],
  );

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
        json?.error || json?.details || `Erreur HTTP ${res.status}`,
      );
    }
    return json;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [subjectJson, classJson, progressionJson, statsJson, nationalJson] =
        await Promise.all([
          fetchJson("/api/admin/subjects"),
          fetchJson("/api/admin/classes?limit=999"),
          fetchJson("/api/admin/textbook/progressions"),
          fetchJson("/api/admin/textbook/stats"),
          fetchJson("/api/admin/textbook/national"),
        ]);

      setSubjects(subjectJson.items || []);
      setClasses(classJson.items || []);
      setProgressions(progressionJson.items || []);
      setStats(statsJson.items || []);
      setNationalProgressions(nationalJson.items || []);
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
      setItems(itemsJson.items || []);
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
        body: JSON.stringify({}),
      });
      setMessage(
        json.already_exists
          ? "Cette progression nationale est déjà disponible dans votre établissement."
          : `Progression copiée dans l’établissement avec ${json.copied_items || 0} ligne(s).`,
      );
      await loadAll();
      if (json.item?.id) setSelectedId(json.item.id);
    } catch (e: any) {
      setError(e?.message || "Copie depuis la bibliothèque nationale impossible");
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
      const form = new FormData();
      form.set("title", createForm.title);
      form.set("academic_year", createForm.academic_year);
      form.set("level", createForm.level);
      form.set("series", createForm.series);
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
    if (!selected?.level) return classes;
    const level = selected.level.toLowerCase();
    return classes.filter(
      (c) =>
        String(c.level || "").toLowerCase() === level ||
        labelClass(c).toLowerCase().includes(level),
    );
  }, [classes, selected?.level]);

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

        {loading ? (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement du cahier de
            texte…
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <section className="space-y-6">
              <section className="rounded-[28px] border border-indigo-100 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
                      Bibliothèque nationale Nexa
                    </div>
                    <h2 className="mt-1 text-lg font-black">Étape 1 — Copier une progression nationale</h2>
                    <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                      Fonctionnement normal : Nexa met les progressions officielles à disposition.
                      L’établissement clique sur « Utiliser dans mon établissement », puis affecte la copie aux classes.
                    </p>
                  </div>
                </div>

                {canManageNational ? (
                  <form onSubmit={createNationalProgression} className="mt-4 space-y-3 rounded-2xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
                    <div className="text-sm font-black text-indigo-900">Ajouter un modèle national</div>
                    <input
                      className="w-full rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400"
                      placeholder="Titre : Progression nationale Anglais 2nde A-C"
                      value={nationalForm.title}
                      onChange={(e) => setNationalForm((f) => ({ ...f, title: e.target.value }))}
                      required
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        className="rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400"
                        placeholder="Année 2026-2027"
                        value={nationalForm.academic_year}
                        onChange={(e) => setNationalForm((f) => ({ ...f, academic_year: e.target.value }))}
                      />
                      <input
                        className="rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400"
                        placeholder="Niveau : 2nde A-C"
                        value={nationalForm.level}
                        onChange={(e) => setNationalForm((f) => ({ ...f, level: e.target.value }))}
                        required
                      />
                    </div>
                    <select
                      className="w-full rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400"
                      value={nationalForm.subject_id}
                      onChange={(e) => setNationalForm((f) => ({ ...f, subject_id: e.target.value }))}
                      required
                    >
                      <option value="">Choisir la discipline</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <input
                      className="w-full rounded-2xl border border-indigo-100 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400"
                      placeholder="Série / option si nécessaire"
                      value={nationalForm.series}
                      onChange={(e) => setNationalForm((f) => ({ ...f, series: e.target.value }))}
                    />
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-indigo-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
                      <Upload className="h-4 w-4" />
                      <span>{nationalDocumentFile ? nationalDocumentFile.name : "Joindre le fichier officiel national"}</span>
                      <input
                        className="hidden"
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
                        onChange={(e) => setNationalDocumentFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button
                      disabled={busy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Publier dans la bibliothèque nationale
                    </button>
                  </form>
                ) : null}

                <div className="mt-4 space-y-2">
                  {nationalProgressions.map((p) => (
                    <div key={p.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <button
                        type="button"
                        onClick={() => setNationalSelectedId(p.id)}
                        className={classNames(
                          "w-full rounded-xl px-3 py-2 text-left transition",
                          nationalSelectedId === p.id ? "bg-white ring-2 ring-indigo-200" : "bg-transparent hover:bg-white",
                        )}
                      >
                        <div className="text-sm font-black text-slate-900">{p.title}</div>
                        <div className="mt-1 text-xs font-bold text-slate-500">
                          {p.subject_name || "Matière"} · {p.level || "Niveau"} · {p.academic_year}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                          <span className="rounded-full bg-white px-2 py-1 text-indigo-700 ring-1 ring-indigo-100">
                            Nationale
                          </span>
                          <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">
                            {p.items?.length || 0} lignes
                          </span>
                        </div>
                      </button>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyNationalProgression(p)}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-60"
                        >
                          Utiliser dans mon établissement
                        </button>
                        {p.document?.signed_url ? (
                          <a
                            href={p.document.signed_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200"
                          >
                            Fichier officiel
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!nationalProgressions.length ? (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
                      Aucun modèle national publié pour le moment. Vérifiez d’abord que Nexa a alimenté la bibliothèque nationale dans l’espace Super Admin.
                    </div>
                  ) : null}
                </div>

                {canManageNational && selectedNational ? (
                  <div className="mt-4 rounded-2xl border border-indigo-100 bg-white p-3">
                    <div className="text-sm font-black text-slate-900">
                      Lignes nationales : {selectedNational.title}
                    </div>
                    <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                      Import réservé à Nexa. Ces lignes serviront de source aux copies établissement.
                    </p>
                    <textarea
                      className="mt-3 h-44 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:border-indigo-400"
                      value={nationalImportText}
                      onChange={(e) => setNationalImportText(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={importNationalItems}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Importer les lignes nationales
                    </button>
                  </div>
                ) : null}
              </section>

              <details className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-amber-700 ring-1 ring-amber-100">
                      <Plus className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-black text-amber-950">
                        Cas exceptionnel : créer une progression établissement
                      </h2>
                      <p className="text-xs font-bold leading-5 text-amber-800">
                        À utiliser seulement si aucune progression nationale Nexa ne convient.
                        Le chemin normal reste : bibliothèque nationale → copie établissement → affectation aux classes.
                      </p>
                    </div>
                  </div>
                </summary>

                <form onSubmit={createProgression} className="mt-5 space-y-3">
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    placeholder="Titre : Progression Mathématiques 4e"
                    value={createForm.title}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, title: e.target.value }))
                    }
                    required
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      placeholder="Année 2026-2027"
                      value={createForm.academic_year}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          academic_year: e.target.value,
                        }))
                      }
                    />
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      placeholder="Niveau : 4e"
                      value={createForm.level}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, level: e.target.value }))
                      }
                      required
                    />
                  </div>
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
                    <option value="">Choisir la discipline</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    placeholder="Série / option si nécessaire : 2nde C, Tle A2…"
                    value={createForm.series}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, series: e.target.value }))
                    }
                  />
                  <textarea
                    className="min-h-20 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400"
                    placeholder="Observation ou précision sur le modèle de progression"
                    value={createForm.description}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        description: e.target.value,
                      }))
                    }
                  />
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                    <Upload className="h-4 w-4" />
                    <span>
                      {documentFile
                        ? documentFile.name
                        : "Joindre le fichier officiel PDF/Word/Excel"}
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
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Enregistrer la progression établissement
                  </button>
                </form>
              </details>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black">Progressions établissement</h2>
                <div className="mt-4 space-y-2">
                  {progressions.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={classNames(
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        selectedId === p.id
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                      )}
                    >
                      <div className="text-sm font-black text-slate-900">
                        {p.title}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        {p.subject_name || "Matière"} · {p.level || "Niveau"} ·{" "}
                        {p.academic_year}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                        {p.source_national_template_id ? (
                          <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700 ring-1 ring-indigo-100">
                            Depuis bibliothèque Nexa
                          </span>
                        ) : null}
                        {p.is_customized ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-100">
                            Adaptée
                          </span>
                        ) : null}
                        <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">
                          {p.items?.length || 0} lignes
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">
                          {p.assignments?.length || 0} classes
                        </span>
                      </div>
                    </button>
                  ))}
                  {!progressions.length ? (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
                      Aucune progression créée pour le moment.
                    </div>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="space-y-6">
              {!selected ? (
                <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
                  Copiez d’abord une progression depuis la bibliothèque nationale Nexa, puis sélectionnez la copie établissement pour l’affecter aux classes.
                </div>
              ) : (
                <>
                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                          Progression sélectionnée
                        </div>
                        <h2 className="mt-1 text-2xl font-black">
                          {selected.title}
                        </h2>
                        <p className="mt-1 text-sm font-bold text-slate-500">
                          {selected.subject_name || "Matière"} ·{" "}
                          {selected.level || "Niveau"} ·{" "}
                          {selected.academic_year}
                        </p>
                      </div>
                      {selected.document?.signed_url ? (
                        <a
                          href={selected.document.signed_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700"
                        >
                          <FileText className="h-4 w-4" /> Ouvrir le fichier
                          officiel
                        </a>
                      ) : null}
                    </div>
                  </section>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-lg font-black">
                        Progression copiée / adaptée
                      </h3>
                      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                        Les lignes viennent normalement de la bibliothèque nationale Nexa.
                        Cette zone sert uniquement à corriger ou adapter la copie établissement, pas à ré-uploader la progression officielle.
                      </p>
                      <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold leading-5 text-emerald-800 ring-1 ring-emerald-100">
                        {items.length || selected.items?.length || 0} ligne(s) disponible(s).
                        Utilisez surtout l’affectation aux classes à droite.
                      </div>
                      <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer text-sm font-black text-slate-800">
                          Mode avancé : modifier / remplacer les lignes de la copie établissement
                        </summary>
                      <textarea
                        className="mt-4 h-52 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:border-emerald-400"
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                      />
                      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs font-bold leading-5 text-amber-900">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={replaceExisting}
                          onChange={(e) => setReplaceExisting(e.target.checked)}
                        />
                        <span>
                          Remplacer les lignes existantes. À garder coché si vous
                          corrigez une progression ou si un exemple a été importé
                          par erreur. Le fichier officiel reste attaché, mais les
                          statistiques utilisent uniquement les lignes ci-dessus.
                        </span>
                      </label>
                      <button
                        onClick={importItems}
                        disabled={busy}
                        className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        Remplacer / importer dans la copie : {selected.title}
                      </button>
                      </details>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-lg font-black">
                        Affecter aux classes
                      </h3>
                      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                        La progression devient visible dans le cahier de texte
                        des enseignants affectés à la classe et à la discipline.
                      </p>
                      <div className="mt-4 max-h-64 space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        {compatibleClasses.map((c) => {
                          const checked = selectedClassIds.includes(c.id);
                          const already = assignments.some(
                            (a) => a.class_id === c.id && a.is_active,
                          );
                          return (
                            <label
                              key={c.id}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm font-bold ring-1 ring-slate-200"
                            >
                              <span>
                                {labelClass(c)}{" "}
                                <span className="text-xs text-slate-400">
                                  {c.level || ""}
                                </span>
                              </span>
                              <span className="flex items-center gap-2">
                                {already ? (
                                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                                    Déjà liée
                                  </span>
                                ) : null}
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setSelectedClassIds((prev) =>
                                      e.target.checked
                                        ? [...prev, c.id]
                                        : prev.filter((id) => id !== c.id),
                                    )
                                  }
                                />
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <button
                        onClick={assignClasses}
                        disabled={busy || !selectedClassIds.length}
                        className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Affecter les
                        classes sélectionnées
                      </button>
                    </section>
                  </div>

                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-black">
                      Lignes de progression
                    </h3>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-3">Ordre</th>
                            <th className="px-3 py-3">Type</th>
                            <th className="px-3 py-3">Titre</th>
                            <th className="px-3 py-3">Durée</th>
                            <th className="px-3 py-3">Période</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-3 font-bold text-slate-500">
                                {item.sort_order || "—"}
                              </td>
                              <td className="px-3 py-3">
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                                  {item.item_type}
                                </span>
                              </td>
                              <td
                                className="px-3 py-3 font-bold"
                                style={{
                                  paddingLeft: `${12 + (item.indent_level || 0) * 18}px`,
                                }}
                              >
                                {item.title}
                              </td>
                              <td className="px-3 py-3 text-slate-600">
                                {item.planned_duration_minutes
                                  ? `${item.planned_duration_minutes} min`
                                  : "—"}
                              </td>
                              <td className="px-3 py-3 text-slate-600">
                                {item.trimester || item.week_label || "—"}
                              </td>
                            </tr>
                          ))}
                          {!items.length ? (
                            <tr>
                              <td
                                colSpan={5}
                                className="px-3 py-8 text-center font-bold text-slate-400"
                              >
                                Aucune ligne importée.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-black">
                      Statistiques d’exécution
                    </h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase text-slate-500">
                          Classes suivies
                        </div>
                        <div className="mt-1 text-2xl font-black">
                          {stats.length}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-emerald-50 p-4">
                        <div className="text-xs font-black uppercase text-emerald-700">
                          Séances saisies
                        </div>
                        <div className="mt-1 text-2xl font-black text-emerald-800">
                          {stats.reduce((s, i) => s + i.sessions_count, 0)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-sky-50 p-4">
                        <div className="text-xs font-black uppercase text-sky-700">
                          Heures réalisées
                        </div>
                        <div className="mt-1 text-2xl font-black text-sky-800">
                          {Math.round(
                            stats.reduce((s, i) => s + i.realized_hours, 0) *
                              10,
                          ) / 10}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-3">Classe</th>
                            <th className="px-3 py-3">Matière</th>
                            <th className="px-3 py-3">Prof</th>
                            <th className="px-3 py-3">Progression</th>
                            <th className="px-3 py-3">Séances</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stats.slice(0, 12).map((row) => (
                            <tr key={row.assignment_id}>
                              <td className="px-3 py-3 font-black">
                                {row.class_label}
                              </td>
                              <td className="px-3 py-3">{row.subject_name}</td>
                              <td className="px-3 py-3 text-slate-600">
                                {row.teacher_name}
                              </td>
                              <td className="px-3 py-3">
                                <span className="font-black text-emerald-700">
                                  {row.completion_rate}%
                                </span>{" "}
                                <span className="text-xs text-slate-500">
                                  ({row.completed_items}/{row.expected_items})
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                {row.sessions_count}
                              </td>
                            </tr>
                          ))}
                          {!stats.length ? (
                            <tr>
                              <td
                                colSpan={5}
                                className="px-3 py-8 text-center font-bold text-slate-400"
                              >
                                Aucune statistique disponible.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
