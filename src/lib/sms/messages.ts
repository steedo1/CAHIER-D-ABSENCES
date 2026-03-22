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

export type GradeDigestSmsInput = {
  appName?: string | null;
  institutionName?: string | null;
  studentName?: string | null;
  items: GradeDigestSmsItem[];
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
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•·]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\|/g, "-")
    .replace(/\u00A0/g, " ");

  const withoutDiacritics = replaced
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const asciiSafe = withoutDiacritics.replace(/[^A-Za-z0-9 @!\"#\$%&'\(\)\*\+,\-\.\/:;<=>\?\n]/g, " ");

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

function studentNameFromPayload(payload: AttendanceSmsPayload | null | undefined): string {
  return firstNonEmpty(
    payload?.student?.name,
    payload?.student?.full_name,
    payload?.student?.display_name,
    payload?.student?.matricule,
    "Eleve"
  );
}

function classLabelFromPayload(payload: AttendanceSmsPayload | null | undefined): string {
  return firstNonEmpty(payload?.class?.label, payload?.class?.name);
}

function subjectNameFromPayload(payload: AttendanceSmsPayload | null | undefined): string {
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

  const kind = s((payload as any).kind).toLowerCase();
  const event = s((payload as any).event).toLowerCase();

  return kind === "attendance" || ["absent", "late", "fix"].includes(event);
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
  const institutionName = s(options.institutionName);
  const maxLength = clampSmsMaxLength(options.maxLength);

  const event = resolveAttendanceEvent(payload);
  const studentName = sanitizeSmsText(studentNameFromPayload(payload));
  const classLabel = sanitizeSmsText(classLabelFromPayload(payload));
  const subjectName = sanitizeSmsText(subjectNameFromPayload(payload));
  const when = formatDateTimeCompactFr(payload.session?.started_at);
  const minutesLate = Math.max(0, toSafeNumber(payload.minutes_late) ?? 0);
  const reason = sanitizeSmsText(s(payload.reason));

  let main = "";

  if (event === "absent") {
    main = `${appName}: ${studentName} absent`;
  } else if (event === "late") {
    main = `${appName}: ${studentName} en retard`;
    if (minutesLate > 0) {
      main += ` (${minutesLate} min)`;
    }
  } else {
    main =
      minutesLate > 0
        ? `${appName}: correction assiduite ${studentName} retard ${minutesLate} min`
        : `${appName}: correction assiduite ${studentName} absence`;
  }

  const details = joinParts(
    [
      subjectName ? `Matiere ${subjectName}` : "",
      classLabel ? `Classe ${classLabel}` : "",
      when ? `${when}` : "",
      institutionName ? `Etab ${institutionName}` : "",
      reason ? `Motif ${reason}` : "",
    ],
    " - "
  );

  return limitSmsText(details ? `${main}. ${details}.` : `${main}.`, maxLength);
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
    [
      title ? `${appName}: ${title}` : `${appName}: Notification`,
      body || "",
    ],
    " - "
  );

  return limitSmsText(text, maxLength);
}

export function buildGradesDigestSmsMessage(
  input: GradeDigestSmsInput,
  options: BuildSmsOptions = {}
): string {
  const appName = normalizeAppName(input.appName || options.appName);
  const institutionName = sanitizeSmsText(s(input.institutionName || options.institutionName));
  const studentName = sanitizeSmsText(firstNonEmpty(input.studentName, "Eleve"));
  const maxLength = clampSmsMaxLength(options.maxLength);

  const items = (input.items || [])
    .map((it) => {
      const subject = sanitizeSmsText(s(it.subject));
      if (!subject) return "";

      const score = sanitizeSmsText(s(it.score));
      const scale = sanitizeSmsText(s(it.scale));

      if (score && scale) return `${subject} ${score}/${scale}`;
      if (score) return `${subject} ${score}`;
      return subject;
    })
    .filter(Boolean);

  const head = `${appName}: Notes pour ${studentName}`;
  const body = items.length ? items.join(", ") : "Aucune nouvelle note.";
  const tail = institutionName ? ` Etab ${institutionName}.` : "";

  return limitSmsText(`${head} - ${body}.${tail}`, maxLength);
}

export function buildSmsMessageFromQueue(
  input: NotificationQueueSmsInput
): string {
  const payload = input.payload;

  if (isAttendancePayload(payload)) {
    return buildAttendanceSmsMessage(payload, {
      appName: input.appName,
      institutionName: input.institutionName,
      maxLength: input.maxLength,
    });
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