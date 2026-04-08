// src/lib/sms/messages.ts

const SMS_TIMEZONE = "Africa/Abidjan";
const DEFAULT_APP_NAME = "Mon Cahier";
const DEFAULT_MAX_SMS_LENGTH = 140;

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
    .replace(/\p{Diacritic}/gu, "");

  const asciiSafe = withoutDiacritics.replace(
    /[^A-Za-z0-9 @!"#$%&'()*+,\-./:;<=>?\n]/g,
    " "
  );

  return compactSpaces(asciiSafe).replace(/\s+([:;,.!?])/g, "$1");
}

function joinParts(parts: Array<Maybe<string>>, sep = " - "): string {
  return parts
    .map((x) => sanitizeSmsText(s(x)))
    .filter(Boolean)
    .join(sep)
    .trim();
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

function isProbablyStudentCode(value: string): boolean {
  const x = sanitizeSmsText(value).trim();
  if (!x) return false;
  if (x.includes(" ")) return false;

  return (
    /^\d{4,}[A-Za-z0-9-]*$/.test(x) ||
    /^[A-Z]{1,5}\d{3,}[A-Z0-9-]*$/i.test(x)
  );
}

function normalizeStudentDisplayName(...values: Array<Maybe<unknown>>): string {
  for (const value of values) {
    const x = sanitizeSmsText(s(value));
    if (!x) continue;
    if (isProbablyStudentCode(x)) continue;
    return x;
  }
  return "Eleve";
}

function studentNameFromPayload(
  payload: AttendanceSmsPayload | NotesDigestSmsPayload | null | undefined
): string {
  return normalizeStudentDisplayName(
    payload?.student?.name,
    payload?.student?.full_name,
    payload?.student?.display_name,
    payload?.student?.matricule
  );
}

function classLabelFromPayload(
  payload: AttendanceSmsPayload | NotesDigestSmsPayload | null | undefined
): string {
  return firstNonEmpty(payload?.class?.label, payload?.class?.name);
}

function subjectNameFromPayload(
  payload: AttendanceSmsPayload | null | undefined
): string {
  return firstNonEmpty(payload?.subject?.name, payload?.subject?.label);
}

function formatDateFr(iso: Maybe<string>): string {
  const raw = s(iso);
  if (!raw) return "";

  try {
    return new Date(raw).toLocaleDateString("fr-FR", {
      timeZone: SMS_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return raw;
  }
}

function formatTimeFr(iso: Maybe<string>): string {
  const raw = s(iso);
  if (!raw) return "";

  try {
    return new Date(raw).toLocaleTimeString("fr-FR", {
      timeZone: SMS_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function formatDateTimeCompactFr(iso: Maybe<string>): string {
  const date = formatDateFr(iso);
  const time = formatTimeFr(iso);
  return joinParts([date, time], " ");
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

function isGenericSubjectLabel(value: string): boolean {
  const x = sanitizeSmsText(value).toLowerCase();
  return !x || ["matiere", "matieres", "subject", "cours", "course"].includes(x);
}

function formatGradeItemForSms(it: GradeDigestSmsItem): string {
  const subject = sanitizeSmsText(s(it.subject));
  const score = sanitizeSmsText(s(it.score));
  const scale = sanitizeSmsText(s(it.scale));

  if (!score) return "";

  if (subject && !isGenericSubjectLabel(subject)) {
    if (scale) return `${subject} ${score}/${scale}`;
    return `${subject} ${score}`;
  }

  if (scale) return `Note ${score}/${scale}`;
  return `Note ${score}`;
}

function hasConcreteGradeSubjects(items: GradeDigestSmsItem[]): boolean {
  return items.some((it) => {
    const subject = sanitizeSmsText(s(it.subject));
    const score = sanitizeSmsText(s(it.score));
    return !!score && !!subject && !isGenericSubjectLabel(subject);
  });
}

export function buildAttendanceSmsMessage(
  payload: AttendanceSmsPayload,
  options: BuildSmsOptions = {}
): string {
  const appName = normalizeAppName(options.appName);
  const institutionName = sanitizeSmsText(s(options.institutionName));
  const maxLength = clampSmsMaxLength(options.maxLength);

  const event = resolveAttendanceEvent(payload);
  const studentName = studentNameFromPayload(payload);
  const subjectName = sanitizeSmsText(subjectNameFromPayload(payload));
  const when = formatDateTimeCompactFr(payload.session?.started_at);
  const minutesLate = Math.max(0, toSafeNumber(payload.minutes_late) ?? 0);
  const reason = sanitizeSmsText(s(payload.reason));

  let main = "";

  if (event === "absent") {
    main = `${appName}: ${studentName} absent`;
  } else if (event === "late") {
    main = `${appName}: ${studentName} en retard`;
    if (minutesLate > 0) main += ` (${minutesLate} min)`;
  } else {
    main =
      minutesLate > 0
        ? `${appName}: correction assiduite ${studentName} retard ${minutesLate} min`
        : `${appName}: correction assiduite ${studentName} absence`;
  }

  const details = joinParts(
    [
      subjectName ? `Matiere ${subjectName}` : "",
      when || "",
      institutionName ? `Etab ${institutionName}` : "",
      reason ? `Motif ${reason}` : "",
    ],
    " - "
  );

  return limitSmsText(details ? `${main}. ${details}.` : `${main}.`, maxLength);
}

export function buildGradesDigestSmsMessage(
  input: GradeDigestSmsInput,
  options: BuildSmsOptions = {}
): string {
  const appName = normalizeAppName(input.appName || options.appName);
  const studentName = normalizeStudentDisplayName(input.studentName);
  const periodLabel = sanitizeSmsText(s(input.periodLabel));
  const average = sanitizeSmsText(s(input.average));
  const maxLength = clampSmsMaxLength(options.maxLength);

  const items = (input.items || [])
    .map((it) => formatGradeItemForSms(it))
    .filter(Boolean);

  const head = `${appName}: Notes ${studentName}`;
  const meta = joinParts(
    [
      periodLabel ? periodLabel : "",
      average ? `Moy ${average}` : "",
    ],
    " - "
  );

  const body = items.length ? items.join(", ") : "Nouvelle note disponible.";

  const full = joinParts([head, meta, body], " - ");
  return limitSmsText(`${full}.`, maxLength);
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

  const text = joinParts(
    [title ? `${appName}: ${title}` : `${appName}: Notification`, body || ""],
    " - "
  );

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
    const items = Array.isArray(p.items) ? p.items : [];

    if (!hasConcreteGradeSubjects(items) && s(input.body)) {
      return limitSmsText(s(input.body), clampSmsMaxLength(input.maxLength));
    }

    return buildGradesDigestSmsMessage(
      {
        appName: input.appName,
        institutionName: p.institution?.name || input.institutionName,
        studentName: studentNameFromPayload(p),
        classLabel: classLabelFromPayload(p),
        periodLabel: p.period_label,
        average: p.average,
        items,
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