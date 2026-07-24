export type StructuredProgressionItem = {
  sort_order: number;
  item_type: string;
  rubric: string | null;
  theme: string | null;
  competency?: string | null;
  title: string;
  planned_duration_minutes: number | null;
  planned_sessions_count?: number | null;
  trimester?: string | null;
  month_label?: string | null;
  week_label?: string | null;
  indent_level: number;
};

export type ProgressionImportContext = {
  title?: string | null;
  subject_name?: string | null;
  level?: string | null;
  series?: string | null;
  academic_year?: string | null;
} | null;

export const IMPORT_HEADER = "Ordre;Type;Rubrique;Thème;Compétence;Titre;Durée minutes;Nb séances;Période;Mois;Semaine";

const LEGACY_HEADER = "Ordre;Type;Rubrique;Thème;Titre;Durée minutes;Période;Semaine";

const STRUCTURAL_ITEM_TYPES = new Set(["section", "theme", "rubric", "competency", "chapter"]);

const MONTHS = [
  "septembre",
  "octobre",
  "novembre",
  "décembre",
  "decembre",
  "janvier",
  "février",
  "fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "aout",
];

const SKILL_LINES = new Set(["speaking", "reading", "listening", "writing", "lang skills"]);

export const ANGLAIS_2NDE_A_C_SAMPLE = [
  IMPORT_HEADER,
  "1;theme;UNIT 1;People;;UNIT 1 PEOPLE;;9;T1;Septembre;Semaines 1-3",
  "2;lesson;UNIT 1;People;Speaking / Reading / Listening / Writing;UNIT 1 PEOPLE;360;6;T1;Septembre;Semaines 1-2",
  "3;revision;UNIT 1;People;;Révisions - UNIT 1 PEOPLE;60;1;T1;Septembre;Semaine 3",
  "4;evaluation;UNIT 1;People;;Évaluation - UNIT 1 PEOPLE;60;1;T1;Septembre;Semaine 3",
  "5;remediation;UNIT 1;People;;Correction / Remédiation - UNIT 1 PEOPLE;60;1;T1;Septembre;Semaine 3",
  "6;theme;UNIT 2;Health and lifestyle;;UNIT 2 HEALTH AND LIFESTYLE;;9;T1;Octobre;Semaines 4-6",
  "7;lesson;UNIT 2;Health and lifestyle;Speaking / Reading / Listening / Writing;UNIT 2 HEALTH AND LIFESTYLE;360;6;T1;Octobre;Semaines 4-5",
  "8;revision;UNIT 2;Health and lifestyle;;Révisions - UNIT 2 HEALTH AND LIFESTYLE;60;1;T1;Octobre;Semaine 6",
  "9;evaluation;UNIT 2;Health and lifestyle;;Évaluation - UNIT 2 HEALTH AND LIFESTYLE;60;1;T1;Octobre;Semaine 6",
  "10;remediation;UNIT 2;Health and lifestyle;;Correction / Remédiation - UNIT 2 HEALTH AND LIFESTYLE;60;1;T1;Octobre;Semaine 6",
].join("\n");

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanCell(value: unknown, max = 300) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isHeaderLine(line: string) {
  const normalized = normalizeText(line);
  return normalized.startsWith("ordre;") || normalized.startsWith("ordre\t") || normalized.includes("duree minutes");
}

function toTitleCase(value: string) {
  const text = cleanCell(value);
  if (!text) return "";
  return text
    .toLowerCase()
    .split(" ")
    .map((part) => (part.length <= 2 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function normalizeImportType(value: unknown, hasDuration: boolean) {
  const compact = normalizeText(value).replace(/[\s_\-]+/g, " ");

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
    "correction remediation": "remediation",
    regulation: "regulation",
    revision: "revision",
    revise: "revision",
    autre: "other",
    other: "other",
  };

  const normalized = map[compact] || "lesson";
  if (STRUCTURAL_ITEM_TYPES.has(normalized) && hasDuration) return "lesson";
  return normalized;
}

function toPositiveNumber(value: unknown) {
  const raw = String(value || "")
    .replace(",", ".")
    .trim();
  if (!raw) return null;

  const hourMatch = raw.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);

  const minuteMatch = raw.match(/(\d+)\s*(?:min|mn|minutes?)?/i);
  const n = minuteMatch ? Number(minuteMatch[1]) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function inferTrimesterFromWeek(week: number | null) {
  if (!week) return null;
  if (week <= 12) return "T1";
  if (week <= 21) return "T2";
  return "T3";
}

function inferMonthFromWeek(week: number | null) {
  if (!week) return null;
  if (week <= 3) return "Septembre";
  if (week <= 7) return "Octobre";
  if (week <= 11) return "Novembre";
  if (week <= 14) return "Décembre";
  if (week <= 18) return "Janvier";
  if (week <= 21) return "Février";
  if (week <= 25) return "Mars";
  if (week <= 28) return "Avril";
  return "Mai";
}

function rowFromParts(parts: string[], index: number): StructuredProgressionItem | null {
  const columns = parts.map((p) => cleanCell(p, 500));
  const isModern = columns.length >= 11;

  const order = columns[0];
  const type = columns[1];
  const rubric = columns[2];
  const theme = columns[3];
  const competency = isModern ? columns[4] : null;
  const title = isModern ? columns[5] : columns[4];
  const duration = isModern ? columns[6] : columns[5];
  const sessions = isModern ? columns[7] : null;
  const trimester = isModern ? columns[8] : columns[6];
  const month = isModern ? columns[9] : null;
  const week = isModern ? columns[10] : columns[7];

  const finalTitle = cleanCell(title || theme || rubric, 300);
  if (!finalTitle) return null;

  const minutes = toPositiveNumber(duration);
  const sessionsCount = toPositiveNumber(sessions);
  const itemType = normalizeImportType(type, Boolean(minutes));

  return {
    sort_order: Number(order) || index + 1,
    item_type: itemType,
    rubric: rubric || null,
    theme: theme || null,
    competency: competency || null,
    title: finalTitle,
    planned_duration_minutes: minutes,
    planned_sessions_count: sessionsCount,
    trimester: trimester || null,
    month_label: month || null,
    week_label: week || null,
    indent_level: STRUCTURAL_ITEM_TYPES.has(itemType) ? 0 : 1,
  };
}

export function parseImportLines(raw: string): StructuredProgressionItem[] {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .filter((line) => !isHeaderLine(line))
    .map((line, index) => {
      const parts = line.includes(";") ? line.split(";") : line.split("\t");
      return rowFromParts(parts, index);
    })
    .filter(Boolean) as StructuredProgressionItem[];
}

function escapeCell(value: unknown) {
  return String(value ?? "")
    .replace(/;/g, ",")
    .replace(/\r?\n/g, " ")
    .trim();
}

export function serializeImportLines(items: StructuredProgressionItem[]) {
  return [
    IMPORT_HEADER,
    ...items.map((item, index) =>
      [
        item.sort_order || index + 1,
        item.item_type || "lesson",
        item.rubric || "",
        item.theme || "",
        item.competency || "",
        item.title || "",
        item.planned_duration_minutes || "",
        item.planned_sessions_count || "",
        item.trimester || "",
        item.month_label || "",
        item.week_label || "",
      ]
        .map(escapeCell)
        .join(";"),
    ),
  ].join("\n");
}

function isNoiseLine(line: string) {
  const raw = cleanCell(line);
  const normalized = normalizeText(raw);
  if (!raw || raw.length < 2) return true;
  if (/^\d+$/.test(raw)) return true;
  if (/^\d+\s*h$/i.test(raw)) return true;
  if (MONTHS.includes(normalized)) return true;
  if (SKILL_LINES.has(normalized.replace(/^-\s*/, ""))) return true;
  if (normalized.includes("progressions nationales")) return true;
  if (normalized.includes("volume horaire")) return true;
  if (normalized.includes("total horaire")) return true;
  if (normalized.includes("cometence") || normalized.includes("competence")) return true;
  return false;
}

function extractEnglishUnits(raw: string): StructuredProgressionItem[] {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => cleanCell(line))
    .filter(Boolean);

  const units: Array<{ number: number; topic: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/\bUNIT\s*(\d+)\b\s*(.*)$/i);
    if (!match) continue;

    const unitNumber = Number(match[1]);
    const fragments: string[] = [];
    const sameLineAfter = cleanCell(match[2]).replace(/^[-–—\d\s]+/, "");
    if (sameLineAfter && !isNoiseLine(sameLineAfter)) fragments.push(sameLineAfter);

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const candidate = lines[j];
      if (/\bUNIT\s*\d+\b/i.test(candidate)) break;
      if (/revision|révision|evaluation|évaluation|correction|remédiation|remediation/i.test(candidate)) break;
      if (isNoiseLine(candidate)) continue;
      if (/^[-–—\d\s]+$/.test(candidate)) continue;
      fragments.push(candidate);
      if (fragments.join(" ").length > 35) break;
    }

    const topic = cleanCell(fragments.join(" ").replace(/\s+/g, " "));
    if (unitNumber && topic) {
      units.push({ number: unitNumber, topic });
    }
  }

  const uniqueUnits = units.filter(
    (unit, index, arr) => arr.findIndex((candidate) => candidate.number === unit.number) === index,
  );

  const out: StructuredProgressionItem[] = [];
  let order = 1;

  uniqueUnits
    .sort((a, b) => a.number - b.number)
    .forEach((unit) => {
      const startWeek = (unit.number - 1) * 3 + 1;
      const lessonEndWeek = startWeek + 1;
      const controlWeek = startWeek + 2;
      const theme = `UNIT ${unit.number}`;
      const topic = toTitleCase(unit.topic);
      const upperTitle = `UNIT ${unit.number} ${unit.topic.toUpperCase()}`;
      const trimester = inferTrimesterFromWeek(controlWeek);
      const month = inferMonthFromWeek(startWeek);

      out.push({
        sort_order: order++ ,
        item_type: "theme",
        rubric: theme,
        theme: topic,
        competency: null,
        title: upperTitle,
        planned_duration_minutes: null,
        planned_sessions_count: 9,
        trimester,
        month_label: month,
        week_label: `Semaines ${startWeek}-${controlWeek}`,
        indent_level: 0,
      });

      out.push({
        sort_order: order++ ,
        item_type: "lesson",
        rubric: theme,
        theme: topic,
        competency: "Speaking / Reading / Listening / Writing",
        title: upperTitle,
        planned_duration_minutes: 360,
        planned_sessions_count: 6,
        trimester,
        month_label: month,
        week_label: `Semaines ${startWeek}-${lessonEndWeek}`,
        indent_level: 1,
      });

      out.push({
        sort_order: order++ ,
        item_type: "revision",
        rubric: theme,
        theme: topic,
        competency: null,
        title: `Révisions - ${upperTitle}`,
        planned_duration_minutes: 60,
        planned_sessions_count: 1,
        trimester,
        month_label: inferMonthFromWeek(controlWeek),
        week_label: `Semaine ${controlWeek}`,
        indent_level: 1,
      });

      out.push({
        sort_order: order++ ,
        item_type: "evaluation",
        rubric: theme,
        theme: topic,
        competency: null,
        title: `Évaluation - ${upperTitle}`,
        planned_duration_minutes: 60,
        planned_sessions_count: 1,
        trimester,
        month_label: inferMonthFromWeek(controlWeek),
        week_label: `Semaine ${controlWeek}`,
        indent_level: 1,
      });

      out.push({
        sort_order: order++ ,
        item_type: "remediation",
        rubric: theme,
        theme: topic,
        competency: null,
        title: `Correction / Remédiation - ${upperTitle}`,
        planned_duration_minutes: 60,
        planned_sessions_count: 1,
        trimester,
        month_label: inferMonthFromWeek(controlWeek),
        week_label: `Semaine ${controlWeek}`,
        indent_level: 1,
      });
    });

  return out;
}

function getLineItemType(line: string) {
  const normalized = normalizeText(line);
  if (/evaluation|devoir|composition|controle/.test(normalized)) return "evaluation";
  if (/remediation|remediat|correction/.test(normalized)) return "remediation";
  if (/revision|revisions/.test(normalized)) return "revision";
  if (/regulation|regulation/.test(normalized)) return "regulation";
  if (/seance|session/.test(normalized)) return "session";
  if (/sequence|sequence/.test(normalized)) return "sequence";
  if (/lecon|lesson|cours/.test(normalized)) return "lesson";
  if (/chapitre|chapter/.test(normalized)) return "chapter";
  if (/theme|unite|unit /.test(normalized)) return "theme";
  if (/competence/.test(normalized)) return "competency";
  if (/rubrique/.test(normalized)) return "rubric";
  return "lesson";
}

function cleanGenericTitle(line: string) {
  return cleanCell(
    line
      .replace(/^\d+[.)\-\s]+/, "")
      .replace(/^(leçon|lecon|lesson|séance|seance|session|sequence|séquence|theme|thème|chapitre|chapter)\s*[:\-–—]?\s*/i, "")
      .replace(/\b\d+\s*h\b/gi, "")
      .replace(/\b\d+\s*(min|mn|minutes?)\b/gi, "")
      .trim(),
    300,
  );
}

function extractGenericItems(raw: string): StructuredProgressionItem[] {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => cleanCell(line))
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));

  const out: StructuredProgressionItem[] = [];
  let currentRubric: string | null = null;
  let currentTheme: string | null = null;
  let currentMonth: string | null = null;

  lines.forEach((line) => {
    const normalized = normalizeText(line);
    const month = MONTHS.find((m) => normalized === m);
    if (month) {
      currentMonth = line;
      return;
    }

    const itemType = getLineItemType(line);
    const minutes = toPositiveNumber(line);
    const title = cleanGenericTitle(line);

    if (!title || /^[-–—\d\s]+$/.test(title)) return;
    if (title.length < 4 && !minutes) return;

    if (itemType === "rubric" || itemType === "theme" || itemType === "chapter" || itemType === "competency") {
      currentRubric = itemType === "rubric" ? title : currentRubric;
      currentTheme = itemType !== "rubric" ? title : currentTheme;
    }

    const weekMatch = line.match(/semaine\s*(\d+)/i) || line.match(/^\s*(\d{1,2})\s+/);
    const weekNumber = weekMatch ? Number(weekMatch[1]) : null;

    out.push({
      sort_order: out.length + 1,
      item_type: itemType,
      rubric: currentRubric,
      theme: currentTheme,
      competency: itemType === "competency" ? title : null,
      title,
      planned_duration_minutes: minutes,
      planned_sessions_count: null,
      trimester: inferTrimesterFromWeek(weekNumber),
      month_label: currentMonth,
      week_label: weekNumber ? `Semaine ${weekNumber}` : null,
      indent_level: STRUCTURAL_ITEM_TYPES.has(itemType) ? 0 : 1,
    });
  });

  return out;
}

export function extractStructuredItems(raw: string, progression?: ProgressionImportContext) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const parsed = parseImportLines(text);
  if (parsed.length >= 2) return parsed;

  const subject = normalizeText(`${progression?.subject_name || ""} ${progression?.title || ""}`);
  const looksLikeEnglish = subject.includes("anglais") || subject.includes("english") || /\bUNIT\s*\d+/i.test(text);

  if (looksLikeEnglish) {
    const english = extractEnglishUnits(text);
    if (english.length) return english;
  }

  return extractGenericItems(text);
}

export function makeImportSample(progression?: ProgressionImportContext) {
  const subject = normalizeText(`${progression?.subject_name || ""} ${progression?.title || ""}`);
  if (subject.includes("anglais") || subject.includes("english")) return ANGLAIS_2NDE_A_C_SAMPLE;
  if (subject.includes("francais") || subject.includes("français")) {
    return [
      IMPORT_HEADER,
      "1;rubric;Grammaire;Phrase;;La phrase simple;;;T1;;Semaine 1",
      "2;lesson;Grammaire;Phrase;;Les constituants de la phrase simple;55;1;T1;;Semaine 1",
      "3;lesson;Expression écrite;Rédaction;;Rédiger un paragraphe cohérent;55;1;T1;;Semaine 2",
    ].join("\n");
  }
  return [
    IMPORT_HEADER,
    "1;theme;Activités numériques;Nombres;;Nombres et calculs;;;T1;;Semaine 1",
    "2;lesson;Activités numériques;Nombres;;Nombres entiers naturels;120;2;T1;;Semaine 1",
    "3;lesson;Activités numériques;Nombres;;Comparaison et rangement;55;1;T1;;Semaine 2",
  ].join("\n");
}

export function getLegacyImportHeader() {
  return LEGACY_HEADER;
}
