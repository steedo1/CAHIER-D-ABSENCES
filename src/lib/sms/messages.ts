// src/lib/sms/messages.ts

const SMS_TIMEZONE = "Africa/Abidjan";
const DEFAULT_APP_NAME = "Mon Cahier";
const DEFAULT_MAX_SMS_LENGTH = 280;

type Maybe<T> = T | null | undefined;

export type AttendanceEventKind = "absent" | "late" | "fix";

export type AttendanceSmsPayload = {
  kind?: string | null;
  event?: string | null;

  student?: {
    id?: string | null;
    name?: string | null;
    full_name?: string | null;
    display_name?: string | null;
    matricule?: string | null;
  } | null;

  class?: {
    id?: string | null;
    label?: string | null;
    name?: string | null;
  } | null;

  subject?: {
    id?: string | null;
    name?: string | null;
    label?: string | null;
  } | null;

  session?: {
    id?: string | null;
    started_at?: string | null;
    expected_minutes?: number | null;
  } | null;

  minutes_late?: number | null;
  reason?: string | null;
  title?: string | null;
  body?: string | null;
  severity?: string | null;
};

export type GradeDigestSmsItem = {
  subject: string;
  score: number | string;
  scale?: number | string | null;
};

export type NotesDigestSmsPayload = {
  kind?: string | null;
  event?: string | null;

  student?: {
    id?: string | null;
    name?: string | null;
    full_name?: string | null;
    display_name?: string | null;
    matricule?: string | null;
  } | null;

  class?: {
    id?: string | null;
    label?: string | null;
    name?: string | null;
  } | null;

  institution?: {
    id?: string | null;
    name?: string | null;
  } | null;

  period_label?: string | null;
  average?: number | string | null;
  items?: GradeDigestSmsItem[] | null;

  title?: string | null;
  body?: string | null;
};

export type GradeDigestSmsInput = {
  appName?: string | null;
  institutionName?: string | null;
  studentName?: string | null;
  items: GradeDigestSmsItem[];
  classLabel?: string | null;
  periodLabel?: string | null;
  average?: number | string | null;
};

export type BuildSmsOptions = {
  appName?: string | null;
  institutionName?: string | null;
  maxLength?: number | null;
};

export type NotificationQueueSmsInput = {
  title?: string | null;
  body?: string | null;
  payload?: unknown;
  appName?: string | null;
  institutionName?: string | null;
  maxLength?: number | null;
};

function s(v: Maybe<unknown>): string {
  return String(v ?? "").trim();
}

function firstNonEmpty(...values: Array<Maybe<unknown>>): string {
  for (const value of values) {
    const x = s(value);
    if (x) return x;
  }
  return "";
}

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toSafeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeAppName(appName?: string | null): string {
  return firstNonEmpty(appName, DEFAULT_APP_NAME);
}

function sanitizeSmsText(value: string): string {
  const raw = String(value || "");

  const replaced = raw
    .replace(/[\u2018\u2019\u00B4`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\|/g, "-")
    .replace(/\u00A0/g, " ");

  const withoutDiacritics = replaced
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const asciiSafe = withoutDiacritics.replace(
    /[^A-Za-z0-9 @!"#$%&'()*+,\-./:;<=>?\n]/g,
    " "
  );

  return compactSpaces(asciiSafe).replace(/\s+([:;,.!?])/g, "$1");
}

function clampSmsMaxLength(value: unknown): number {
  const n = toSafeNumber(value);
  if (!n) return DEFAULT_MAX_SMS_LENGTH;
  return Math.max(60, Math.min(n, DEFAULT_MAX_SMS_LENGTH));
}

function limitSmsText(value: string, maxLength = DEFAULT_MAX_SMS_LENGTH): string {
  const clean = sanitizeSmsText(value);
  if (clean.length <= maxLength) return clean;

  const trimmed = clean.slice(0, Math.max(0, maxLength - 3)).trim();
  return `${trimmed}...`;
}

function studentNameFromPayload(
  payload: AttendanceSmsPayload | NotesDigestSmsPayload | null | undefined
): string {
  return firstNonEmpty(
    payload?.student?.name,
    payload?.student?.full_name,
    payload?.student?.display_name,
    payload?.student?.matricule,
    "Eleve"
  );
}

function subjectNameFromPayload(
  payload: AttendanceSmsPayload | null | undefined
): string {
  return firstNonEmpty(payload?.subject?.name, payload?.subject?.label);
}

function formatDateShortFr(iso: Maybe<string>): string {
  const raw = s(iso);
  if (!raw) return "";

  try {
    return new Date(raw).toLocaleDateString("fr-FR", {
      timeZone: SMS_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatTimeShortFr(iso: Maybe<string>): string {
  const raw = s(iso);
  if (!raw) return "";

  try {
    const value = new Date(raw).toLocaleTimeString("fr-FR", {
      timeZone: SMS_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return value.replace(":", "h");
  } catch {
    return "";
  }
}

function abbreviateInstitutionName(value: Maybe<string>, maxLength = 26): string {
  let name = sanitizeSmsText(s(value));
  if (!name) return "";

  const replacements: Array<[RegExp, string]> = [
    [/\bLYCEE\b/gi, "Lyc."],
    [/\bCOLLEGE\b/gi, "Coll."],
    [/\bECOLE\b/gi, "Ecol."],
    [/\bGROUPE\b/gi, "Grp."],
    [/\bSCOLAIRE\b/gi, "Scol."],
    [/\bMODERNE\b/gi, "Mod."],
    [/\bPRIMAIRE\b/gi, "Prim."],
    [/\bSECONDAIRE\b/gi, "Sec."],
    [/\bTECHNIQUE\b/gi, "Tech."],
    [/\bPROFESSIONNELLE?\b/gi, "Prof."],
    [/\bCATHOLIQUE\b/gi, "Cath."],
    [/\bPROTESTANTE?\b/gi, "Prot."],
    [/\bMUNICIPALE?\b/gi, "Mun."],
    [/\bPRIVEE?\b/gi, "Priv."],
    [/\bPUBLIQUE\b/gi, "Publ."],
    [/\bINTERNATIONAL(E)?\b/gi, "Intl."],
    [/\bEXCELLENCE\b/gi, "Exc."],
    [/\bINSTITUT\b/gi, "Inst."],
    [/\bACADEMIE\b/gi, "Acad."],
    [/\bENSEIGNEMENT\b/gi, "Ens."],
  ];

  for (const [pattern, replacement] of replacements) {
    name = name.replace(pattern, replacement);
  }

  name = compactSpaces(name);

  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1).trimEnd()}.`;
}

function abbreviateSubjectName(value: Maybe<string>, maxLength = 14): string {
  let subject = sanitizeSmsText(s(value));
  if (!subject) return "";

  const replacements: Array<[RegExp, string]> = [
    [/^MATHEMATIQUES$/i, "Maths"],
    [/^MATHEMATIQUE$/i, "Maths"],
    [/^MATHS?$/i, "Maths"],

    [/^PHYSIQUE\s*-\s*CHIMIE$/i, "PC"],
    [/^PHYSIQUE\s+CHIMIE$/i, "PC"],
    [/^PHYSIQUE\/CHIMIE$/i, "PC"],
    [/^PC$/i, "PC"],

    [/^SCIENCES?\s+DE\s+LA\s+VIE\s+ET\s+DE\s+LA\s+TERRE$/i, "SVT"],
    [/^SCIENCES?\s+DE\s+LA\s+VIE\s+ET\s+TERRE$/i, "SVT"],
    [/^SVT$/i, "SVT"],

    [/^HISTOIRE\s*-\s*GEOGRAPHIE$/i, "HG"],
    [/^HISTOIRE\s+GEOGRAPHIE$/i, "HG"],
    [/^HISTOIRE\/GEOGRAPHIE$/i, "HG"],
    [/^HG$/i, "HG"],

    [/^FRANCAIS$/i, "Fr"],
    [/^ANGLAIS$/i, "Angl"],
    [/^ALLEMAND$/i, "All"],
    [/^ESPAGNOL$/i, "Esp"],
    [/^PHILOSOPHIE$/i, "Philo"],
    [/^INFORMATIQUE$/i, "Info"],
    [/^TIC$/i, "TIC"],
    [/^EPS$/i, "EPS"],

    [/^EDUCATION\s+CIVIQUE\s+ET\s+MORALE$/i, "ECM"],
    [/^ECM$/i, "ECM"],

    [/^SCIENCES?\s+ECONOMIQUES?\s+ET\s+SOCIALES?$/i, "SES"],
    [/^SES$/i, "SES"],

    [/^COMPTABILITE$/i, "Compta"],
    [/^ECONOMIE$/i, "Eco"],
    [/^DESSIN$/i, "Dess."],
    [/^MUSIQUE$/i, "Mus."],
    [/^ARTS?\s+PLASTIQUES?$/i, "Arts"],
    [/^CONDUITE\s+DE\s+PROJET$/i, "Proj."],
    [/^EDUCATION\s+PHYSIQUE\s+SPORTIVE$/i, "EPS"],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(subject)) {
      subject = replacement;
      break;
    }
  }

  subject = compactSpaces(subject);

  if (subject.length <= maxLength) return subject;
  return `${subject.slice(0, maxLength - 1).trimEnd()}.`;
}

function formatGradeItem(item: GradeDigestSmsItem): string {
  const subject = abbreviateSubjectName(item.subject);
  const score = sanitizeSmsText(s(item.score));
  const scale =
    item.scale === null || item.scale === undefined
      ? ""
      : sanitizeSmsText(s(item.scale));

  if (!subject || !score) return "";
  return scale ? `${subject} ${score}/${scale}` : `${subject} ${score}`;
}

function isAttendancePayload(payload: unknown): payload is AttendanceSmsPayload {
  if (!payload || typeof payload !== "object") return false;

  const obj = payload as Record<string, unknown>;
  const kind = s(obj.kind).toLowerCase();
  const event = s(obj.event).toLowerCase();

  return kind === "attendance" || ["absent", "late", "fix"].includes(event);
}

function isNotesDigestPayload(payload: unknown): payload is NotesDigestSmsPayload {
  if (!payload || typeof payload !== "object") return false;

  const obj = payload as Record<string, unknown>;
  const kind = s(obj.kind).toLowerCase();
  const event = s(obj.event).toLowerCase();

  return (
    ["grades_digest", "grade_digest", "notes_digest", "weekly_notes", "weekly_grades"].includes(
      kind
    ) ||
    ["grades_digest", "grade_digest", "notes_digest"].includes(event)
  );
}

function resolveAttendanceEvent(payload: AttendanceSmsPayload): AttendanceEventKind {
  const event = s(payload.event).toLowerCase();
  if (event === "late") return "late";
  if (event === "fix") return "fix";
  return "absent";
}

export function buildAttendanceSmsMessage(
  payload: AttendanceSmsPayload,
  options: BuildSmsOptions = {}
): string {
  const appName = normalizeAppName(options.appName);
  const maxLength = clampSmsMaxLength(options.maxLength);

  const event = resolveAttendanceEvent(payload);
  const studentName = sanitizeSmsText(studentNameFromPayload(payload));
  const subjectName = abbreviateSubjectName(subjectNameFromPayload(payload));
  const date = formatDateShortFr(payload.session?.started_at);
  const time = formatTimeShortFr(payload.session?.started_at);
  const minutesLate = Math.max(0, toSafeNumber(payload.minutes_late) ?? 0);
  const reason = sanitizeSmsText(s(payload.reason));

  let text = `${appName}: ${studentName}`;

  if (event === "absent") {
    text += " absent";
  } else if (event === "late") {
    text += " en retard";
    if (minutesLate > 0) text += ` (${minutesLate} min)`;
  } else {
    text += minutesLate > 0 ? ` retard corrige (${minutesLate} min)` : " absence corrigee";
  }

  if (subjectName) {
    text += ` en ${subjectName}`;
  }

  if (date) {
    text += ` le ${date}`;
    if (time) text += ` a ${time}`;
  } else if (time) {
    text += ` a ${time}`;
  }

  if (reason) {
    text += `. Motif: ${reason}`;
  }

  return limitSmsText(`${text}.`, maxLength);
}

export function buildGradesDigestSmsMessage(
  input: GradeDigestSmsInput,
  options: BuildSmsOptions = {}
): string {
  const appName = normalizeAppName(input.appName || options.appName);
  const studentName = sanitizeSmsText(firstNonEmpty(input.studentName, "Eleve"));
  const institutionName = abbreviateInstitutionName(
    input.institutionName || options.institutionName
  );
  const maxLength = clampSmsMaxLength(options.maxLength);

  const notes = (input.items || []).map(formatGradeItem).filter(Boolean);

  const prefix = `${appName}: ${studentName}`;
  const suffix = institutionName ? `. Etab: ${institutionName}.` : ".";

  if (notes.length === 0) {
    return limitSmsText(`${prefix}${suffix}`, maxLength);
  }

  let kept: string[] = [];

  for (let i = 0; i < notes.length; i += 1) {
    const nextKept = [...kept, notes[i]];
    const remaining = notes.length - nextKept.length;
    const extra = remaining > 0 ? `; +${remaining} autres` : "";
    const candidate = `${prefix} - ${nextKept.join("; ")}${extra}${suffix}`;

    if (sanitizeSmsText(candidate).length <= maxLength) {
      kept = nextKept;
      continue;
    }

    break;
  }

  if (kept.length === 0) {
    const fallback = `${prefix} - +${notes.length} autres${suffix}`;
    return limitSmsText(fallback, maxLength);
  }

  const remaining = notes.length - kept.length;
  const extra = remaining > 0 ? `; +${remaining} autres` : "";
  return limitSmsText(`${prefix} - ${kept.join("; ")}${extra}${suffix}`, maxLength);
}

export function buildGenericSmsMessage(
  input: {
    title?: string | null;
    body?: string | null;
  },
  options: BuildSmsOptions = {}
): string {
  const appName = normalizeAppName(options.appName);
  const maxLength = clampSmsMaxLength(options.maxLength);

  const title = sanitizeSmsText(s(input.title));
  const body = sanitizeSmsText(s(input.body));

  const text = [title ? `${appName}: ${title}` : `${appName}: Notification`, body]
    .filter(Boolean)
    .join(" - ");

  return limitSmsText(text, maxLength);
}

export function buildSmsMessageFromQueue(input: NotificationQueueSmsInput): string {
  const payload = input.payload;

  if (isAttendancePayload(payload)) {
    return buildAttendanceSmsMessage(payload, {
      appName: input.appName,
      institutionName: input.institutionName,
      maxLength: input.maxLength,
    });
  }

  if (isNotesDigestPayload(payload)) {
    const p = payload as NotesDigestSmsPayload;

    return buildGradesDigestSmsMessage(
      {
        appName: input.appName,
        institutionName: p.institution?.name || input.institutionName,
        studentName: studentNameFromPayload(p),
        classLabel: undefined,
        periodLabel: undefined,
        average: undefined,
        items: Array.isArray(p.items) ? p.items : [],
      },
      {
        appName: input.appName,
        institutionName: p.institution?.name || input.institutionName,
        maxLength: input.maxLength,
      }
    );
  }

  return buildGenericSmsMessage(
    {
      title: input.title,
      body: input.body,
    },
    {
      appName: input.appName,
      institutionName: input.institutionName,
      maxLength: input.maxLength,
    }
  );
}