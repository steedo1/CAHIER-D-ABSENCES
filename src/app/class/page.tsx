// src/app/class/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Users, BookOpen, Clock, Play, Square, LogOut, Loader2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { clearActiveOfflineAccess } from "@/lib/offline-auth-client";
import {
  registerServiceWorker,
  offlineGetJson,
  offlineMutateJson,
  outboxCount,
  flushOutbox,
  cacheGet,
  cacheSet,
  resolveOfflineSessionReference,
} from "@/lib/offline";
import { getClassDeviceCoherentSchedule } from "@/lib/offline-readiness";
import {
  saveClassDeviceSnapshot,
  loadClassDeviceSnapshot,
  validateClassDeviceScheduleScope,
} from "@/lib/offlineClassDevice";
import OfflineReadinessCard from "@/components/OfflineReadinessCard";
import {
  deliverTeacherAttendance,
  markTeacherAttendanceSyncedInCloud,
  stageTeacherAttendanceDraft,
} from "@/lib/teacher-attendance-delivery";
import {
  openTeacherAttendanceSessionOnRelay,
  stageTeacherAttendanceSessionOpen,
  markTeacherSessionOpenedInCloud,
  teacherSessionDeliveryMessage,
} from "@/lib/teacher-session-delivery";
import {
  closeTeacherAttendanceSessionOnRelay,
  isTeacherSessionLocallyFinalized,
  markTeacherSessionClosedInCloud,
  stageTeacherAttendanceSessionClose,
  teacherSessionLifecycleDeliveryMessage,
} from "@/lib/teacher-session-lifecycle-delivery";
import {
  countClassDeviceAttendanceRecovery,
  recoverClassDeviceAttendance,
  type ClassDeviceAttendanceRecoverySummary,
} from "@/lib/class-device-attendance-recovery";
import {
  fetchRelayTeacherOfflineSchedule,
  type RelayTeacherOfflineSchedule,
} from "@/lib/local-relay";
import {
  captureLiveCloudClock,
  captureLiveRelayClock,
  estimateClassDeviceNow,
  type LiveRelayClockReference,
} from "@/lib/class-device-clock";
import {
  chooseRestorableClassDeviceOpen,
  runClassDeviceSingleFlight,
} from "@/lib/class-device-session-state";

/* ───────── UI helpers ───────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" }
) {
  const tone = p.tone ?? "emerald";
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition focus:outline-none focus:ring-4 disabled:opacity-60 disabled:cursor-not-allowed";
  const tones: Record<"emerald" | "slate", string> = {
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-600/30",
  };
  const cls = [base, tones[tone], p.className ?? ""].join(" ");
  const { tone: _tone, ...rest } = p;
  return <button {...rest} className={cls} />;
}
function GhostButton(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "red" | "slate" | "emerald" }
) {
  const tone = p.tone ?? "slate";
  const map: Record<"red" | "slate" | "emerald", string> = {
    red: "border-red-300 text-red-700 hover:bg-red-50 focus:ring-red-500/20",
    slate: "border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500/20",
    emerald: "border-emerald-300 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-500/20",
  };
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
        "transition focus:outline-none focus:ring-4",
        map[tone],
        p.className ?? "",
      ].join(" ")}
    />
  );
}

/* ───────── Types ───────── */
type MyClass = {
  id: string;
  label: string;
  level: string | null;
  institution_id: string;
  education_type?: string | null;
  education_label?: string | null;
  education_short_label?: string | null;
  formation_code?: string | null;
  formation_label?: string | null;
  formation_level_code?: string | null;
  formation_level_label?: string | null;
  education_context_key?: string | null;
  education_context_label?: string | null;
  actor_profile_id?: string | null;
  attendance_presence?: {
    enabled?: boolean;
    allow_local_relay?: boolean;
    relay_local_url?: string | null;
    relay_access_token?: string | null;
    access_contract_version?: number | null;
    actor_kind?: "class_device" | null;
    authorized_class_id?: string | null;
    authorized_actor_profile_id?: string | null;
    diagnostic?: string | null;
  } | null;
};
type Subject = { id: string; label: string };
type RosterItem = { id: string; full_name: string; matricule: string | null };
type SessionDeliveryOrigin = "relay" | "cloud_fallback" | "local_pending";
type SessionRuntimeState =
  | "idle"
  | "opening"
  | "open_relay"
  | "open_cloud_fallback"
  | "open_local_pending"
  | "closing"
  | "closed_pending_sync"
  | "closed_synced"
  | "recoverable_error";
type ConnectivityState = "checking" | "connected" | "slow" | "unavailable";

type OpenSession = {
  id: string;
  institution_id?: string | null;
  actor_profile_id?: string | null;
  class_id: string;
  class_label: string;
  subject_id: string | null;
  subject_name: string | null;
  started_at: string;
  actual_call_at?: string | null;
  expected_minutes?: number | null;
  local_relay?: boolean;
  delivery_origin?: SessionDeliveryOrigin;
  open_operation_id?: string | null;
  period_id?: string | null;
  scheduled_end_at?: string | null;
  grace_expires_at?: string | null;
  session_state?: "open" | "finalizing" | "closed";
  education_type?: string | null;
  education_label?: string | null;
  education_short_label?: string | null;
  formation_code?: string | null;
  formation_label?: string | null;
  formation_level_code?: string | null;
  formation_level_label?: string | null;
  education_context_key?: string | null;
  education_context_label?: string | null;
};

type InstCfg = {
  tz: string;
  default_session_minutes: number;
  auto_lateness: boolean;
  institution_name?: string | null;
  academic_year_label?: string | null;
};
type Period = { id: string | null; weekday: number; label: string; start_time: string; end_time: string };

type ConductMax = {
  discipline: number;
  tenue: number;
  moralite: number;
};

type SubjectLoadMode =
  | "relay"
  | "auto"
  | "auto-offline"
  | "legacy-fallback"
  | "legacy-offline"
  | "closed-online"
  | "empty";

function mapClassDeviceItems(items: any[]) {
  let institutionName: string | null = null;
  const classes: MyClass[] = items.map((item: any) => {
    if (institutionName == null) {
      const candidate =
        item.institution_name ||
        item.institution_label ||
        item.institution?.name ||
        item.institution?.label ||
        item.institution?.short_name ||
        null;
      if (candidate) institutionName = String(candidate);
    }
    return {
      id: item.id,
      label: item.label,
      level: item.level ?? null,
      institution_id: item.institution_id,
      education_type: item.education_type || "general_secondary",
      education_label: item.education_label || "Secondaire général",
      education_short_label: item.education_short_label || "Général",
      formation_code: item.formation_code || null,
      formation_label: item.formation_label || null,
      formation_level_code: item.formation_level_code || null,
      formation_level_label: item.formation_level_label || null,
      education_context_key:
        item.education_context_key ||
        item.education_type ||
        "general_secondary",
      education_context_label:
        item.education_context_label ||
        item.education_label ||
        "Secondaire général",
      actor_profile_id: item.actor_profile_id || null,
      attendance_presence: item.attendance_presence || null,
    };
  });
  return { classes, institutionName };
}


/* Nom par défaut (fallback local / dev) */
const DEFAULT_INSTITUTION_NAME = "NOM DE L'ETABLISSEMENT";

function relayScheduleErrorMessage(error: unknown) {
  const code = String(
    error instanceof Error ? error.message : error || "",
  ).trim();
  if (
    code === "unauthorized" ||
    code === "institution_not_allowed" ||
    code === "relay_access_denied"
  ) {
    return "Le relais refuse l’autorisation de cet appareil.";
  }
  if (
    code === "schedule_snapshot_not_prepared" ||
    code === "relay_schedule_snapshot_invalid"
  ) {
    return "Le planning de la classe n’est pas préparé sur le relais.";
  }
  if (code === "relay_class_schedule_contract_stale") {
    return "Le relais actif utilise encore un ancien contrat pour les téléphones de classe. Il doit être recompilé puis redémarré.";
  }
  if (code === "relay_class_schedule_institution_mismatch") {
    return "Le relais a répondu pour un autre établissement.";
  }
  if (code === "relay_class_schedule_class_mismatch") {
    return "Le relais a répondu pour une autre classe.";
  }
  if (code === "relay_class_schedule_device_mismatch") {
    return "Le relais a répondu pour un autre appareil de classe.";
  }
  if (
    code === "relay_class_schedule_scope_mismatch" ||
    code === "relay_class_schedule_snapshot_invalid"
  ) {
    return "Le planning borné renvoyé par le relais est invalide.";
  }
  return "Le relais local est inaccessible ; le planning préparé reste disponible pour le fallback Cloud ou local.";
}

type PendingEndPayload = {
  actual_end_at: string;
  client_session_id?: string | null;
};

/** Marqueur local : quand l’utilisateur termine une séance locale avant que la séance serveur existe. */
const PENDING_END_KEY = "classDevice:pending-end";
const LAST_COMPLETION_KEY = "classDevice:last-completion:v1";

type ClassDeviceCompletion = {
  version: 1;
  institution_id: string;
  class_id: string;
  class_label: string;
  session_id: string;
  open_operation_id?: string | null;
  subject_id?: string | null;
  subject_name: string | null;
  started_at?: string | null;
  period_id?: string | null;
  planned_range: string;
  ended_at: string;
  absent_count: number;
  late_count: number;
  relay_state: "relay_confirmed" | "cloud_confirmed" | "device_pending";
};

/* ───────── Institution identity helpers (même méthode que le fichier qui marche) ───────── */
const INSTITUTION_NAME_KEYS = [
  "institution_name",
  "institution_label",
  "short_name",
  "name",
  "header_title",
  "school_name",
] as const;

const ACADEMIC_YEAR_KEYS = [
  "current_academic_year_label",
  "academic_year_label",
  "academic_year",
  "year_label",
  "header_academic_year",
  "active_academic_year",
  "school_year",
  "annee_scolaire",
] as const;

function safeStr(x: any): string | null {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pickFrom(obj: any, keys: readonly string[]): string | null {
  if (!isPlainObject(obj)) return null;
  for (const k of keys) {
    const v = safeStr((obj as any)[k]);
    if (v) return v;
  }
  return null;
}

function unwrapPayload(payload: any): { root: any; settings: any } {
  // root = l'objet "le plus plausible" (item, premier item, etc.)
  let root = payload;

  if (isPlainObject(root) && isPlainObject(root.item)) root = root.item;
  else if (isPlainObject(root) && Array.isArray((root as any).items) && (root as any).items[0])
    root = (root as any).items[0];
  else if (isPlainObject(root) && Array.isArray((root as any).data) && (root as any).data[0])
    root = (root as any).data[0];

  const settings =
    (isPlainObject(root) &&
    isPlainObject((root as any).settings_json) &&
    Object.keys((root as any).settings_json).length
      ? (root as any).settings_json
      : null) ||
    (isPlainObject(payload) &&
    isPlainObject((payload as any).settings_json) &&
    Object.keys((payload as any).settings_json).length
      ? (payload as any).settings_json
      : null);

  return { root, settings };
}

function extractInstitutionIdentity(payload: any): { name: string | null; year: string | null } {
  const { root, settings } = unwrapPayload(payload);

  // même principe : si settings_json est là, on regarde d'abord dedans
  let name = pickFrom(settings, INSTITUTION_NAME_KEYS) || null;
  let year = pickFrom(settings, ACADEMIC_YEAR_KEYS) || null;

  // puis fallback racine (défensif)
  if (!name) name = pickFrom(root, INSTITUTION_NAME_KEYS) || null;
  if (!year) year = pickFrom(root, ACADEMIC_YEAR_KEYS) || null;

  return { name, year };
}

/* ───────── Utils (périodes) ───────── */
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
function toMinutes(hm: string) {
  const [h, m] = (hm || "00:00").split(":").map((x) => +x);
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
}
function minutesDiff(a: string, b: string) {
  return Math.max(0, toMinutes(b) - toMinutes(a));
}

function formatTimeLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function buildPlannedRangeLabel(startIso: string, durationMin: number | null | undefined) {
  try {
    const start = new Date(startIso);
    const mins = Math.max(1, Number(durationMin || 0));
    const end = new Date(start.getTime() + mins * 60_000);
    return `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } catch {
    return "—";
  }
}

/* Helpers fuseau établissement */
const hmInTZ = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

const weekdayInTZ1to7 = (d: Date, tz: string): number => {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
    .toLowerCase();
  const map: Record<string, number> = { sun: 7, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[w] ?? 7;
};

function periodsFromRelayClassSchedule(
  schedule: RelayTeacherOfflineSchedule,
  classId: string,
): Record<number, Period[]> {
  const byDay: Record<number, Period[]> = {};
  for (const slot of schedule.slots || []) {
    const hasClass = (slot.items || []).some((item) => item.class_id === classId);
    if (!hasClass) continue;
    const weekday = Number(slot.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
    const period: Period = {
      id: String(slot.period_id || "").trim() || null,
      weekday,
      label: String(slot.label || "Séance"),
      start_time: String(slot.start_time || "00:00").slice(0, 5),
      end_time: String(slot.end_time || "00:00").slice(0, 5),
    };
    if (!period.id || toMinutes(period.end_time) <= toMinutes(period.start_time)) continue;
    const day = byDay[weekday] || [];
    if (!day.some((candidate) => candidate.id === period.id)) day.push(period);
    byDay[weekday] = day.sort((left, right) =>
      left.start_time.localeCompare(right.start_time) ||
      left.end_time.localeCompare(right.end_time),
    );
  }
  return byDay;
}

function relaySubjectsForSlot(
  schedule: RelayTeacherOfflineSchedule | null,
  classId: string,
  period: Period | null,
): Subject[] | null {
  if (!schedule || !period?.id) return null;
  const slot = (schedule.slots || []).find((candidate) =>
    String(candidate.period_id || "") === period.id &&
    (candidate.items || []).some((item) => item.class_id === classId),
  );
  if (!slot) return [];
  const seen = new Set<string>();
  const subjects: Subject[] = [];
  for (const item of slot.items || []) {
    if (item.class_id !== classId || !item.subject_id || seen.has(item.subject_id)) continue;
    seen.add(item.subject_id);
    subjects.push({ id: item.subject_id, label: item.subject_name || "Discipline" });
  }
  return subjects;
}

function relayRosterForClass(
  schedule: RelayTeacherOfflineSchedule | null,
  classId: string,
): RosterItem[] | null {
  const raw = schedule?.rosters?.[classId]?.items;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((item: any) => ({
      id: String(item?.id || ""),
      full_name: String(item?.full_name || item?.display_name || ""),
      matricule: String(item?.matricule || item?.registration_number || "").trim() || null,
    }))
    .filter((item) => item.id && item.full_name);
}

/* Sanctions */
const ALLOWED_RUBRICS = ["discipline", "tenue", "moralite"] as const;
type Rubric = (typeof ALLOWED_RUBRICS)[number];
function coerceRubric(x: unknown): Rubric {
  let s = String(x ?? "").normalize("NFKC").trim().toLowerCase();
  if (s === "" || s === "-" || s === "—" || s === "–") s = "discipline";
  if (s.includes("moralit")) s = "moralite";
  if (s.includes("disciplin")) s = "discipline";
  if (s.includes("tenue")) s = "tenue";
  return (ALLOWED_RUBRICS.includes(s as any) ? s : "discipline") as Rubric;
}

function isClientSessionId(id: any): boolean {
  return typeof id === "string" && id.startsWith("client:");
}

function isRestorableClassDeviceOpen(value: OpenSession | null | undefined): value is OpenSession {
  if (!value?.id || !value.class_id) return false;
  return (
    value.local_relay === true ||
    value.delivery_origin === "relay" ||
    value.delivery_origin === "cloud_fallback" ||
    value.delivery_origin === "local_pending" ||
    isClientSessionId(value.id)
  );
}

function runtimeStateForOpen(value: OpenSession | null | undefined): SessionRuntimeState {
  if (!value) return "idle";
  if (value.delivery_origin === "local_pending" || isClientSessionId(value.id)) {
    return "open_local_pending";
  }
  if (
    value.delivery_origin === "cloud_fallback" ||
    value.local_relay === false
  ) {
    return "open_cloud_fallback";
  }
  return "open_relay";
}

function dateKeyInTZ(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function formatReminderCountdown(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Séance au-delà de l’heure prévue";
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s restantes avant la fin prévue`;
  return `${min} min ${String(sec).padStart(2, "0")} restantes avant la fin prévue`;
}

export default function ClassDevicePage() {
  /* état de base */
  const [classes, setClasses] = useState<MyClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [subjectLoadMode, setSubjectLoadMode] = useState<SubjectLoadMode>("empty");

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === classId) || null,
    [classes, classId],
  );
  const hasNonGeneralClasses = useMemo(
    () =>
      classes.some(
        (item) =>
          String(item.education_type || "general_secondary") !==
          "general_secondary",
      ),
    [classes],
  );

  // paramètres établissement & périodes
  const [inst, setInst] = useState<InstCfg>({
    tz: "Africa/Abidjan",
    default_session_minutes: 60,
    auto_lateness: true,
    institution_name: DEFAULT_INSTITUTION_NAME,
    academic_year_label: null,
  });
  const [periodsByDay, setPeriodsByDay] = useState<Record<number, Period[]>>({});
  const [slotLabel, setSlotLabel] = useState<string>(
    "Aucun créneau configuré (fallback automatique)"
  );

  // maxima de conduite (discipline / tenue / moralité)
  const [conductMax, setConductMax] = useState<ConductMax>({
    discipline: 7,
    tenue: 3,
    moralite: 4,
  });

  // horaire (verrouillé par l’établissement)
  const now = new Date();
  const defTime = hhmm(
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0)
  );
  const [startTime, setStartTime] = useState<string>(defTime);
  const [duration, setDuration] = useState<number>(60);
  const [locked, setLocked] = useState<boolean>(true);

  const [open, setOpen] = useState<OpenSession | null>(null);
  const openRef = useRef<OpenSession | null>(null);
  const pendingSnapshotSubjectRef = useRef<string>("");
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [roster, setRoster] = useState<RosterItem[]>([]);
  type Row = { absent?: boolean; late?: boolean; reason?: string; late_observed_at?: string | null };
  type PenaltyRow = { points: number; reason?: string };
  type ClassPageSnapshotState = {
    classId: string;
    subjectId: string;
    open: OpenSession | null;
    rows: Record<string, Row>;
    penaltyOpen: boolean;
    penRubric: Rubric;
    penRows: Record<string, PenaltyRow>;
    msg: string | null;
  };
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [lastCompletion, setLastCompletion] =
    useState<ClassDeviceCompletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [relayClassSchedule, setRelayClassSchedule] =
    useState<RelayTeacherOfflineSchedule | null>(null);
  const [relayScheduleIssue, setRelayScheduleIssue] = useState<string | null>(
    null,
  );
  const [subjectScheduleIssue, setSubjectScheduleIssue] = useState<string | null>(
    null,
  );
  const relayClassScheduleRef = useRef<RelayTeacherOfflineSchedule | null>(null);
  const subjectSelectionSlotRef = useRef<string>("");
  const relayScheduleRefreshRef = useRef<Promise<RelayTeacherOfflineSchedule | null> | null>(null);
  const relayClockRef = useRef<LiveRelayClockReference | null>(null);
  const [cloudStatus, setCloudStatus] = useState<ConnectivityState>(
    typeof navigator !== "undefined" && navigator.onLine === false
      ? "unavailable"
      : "checking",
  );
  const [relayStatus, setRelayStatus] = useState<ConnectivityState>("checking");
  const [sessionRuntimeState, setSessionRuntimeState] =
    useState<SessionRuntimeState>("idle");

  function relayAdjustedDate(baseMs = Date.now()) {
    return estimateClassDeviceNow(relayClockRef.current, {
      wallNowMs: baseMs,
    }).now;
  }

  function observedNowIso() {
    return relayAdjustedDate().toISOString();
  }

  const changedCount = useMemo(
    () => Object.values(rows).filter((r) => r.absent || r.late).length,
    [rows]
  );


  async function refreshClassScheduleFromRelay(
    target: MyClass | null = selectedClass,
  ): Promise<RelayTeacherOfflineSchedule | null> {
    const applySchedule = async (
      schedule: RelayTeacherOfflineSchedule,
      source: "live" | "prepared",
    ) => {
      if (
        !target?.institution_id ||
        !target.id ||
        !target.actor_profile_id
      ) {
        throw new Error("relay_class_schedule_scope_mismatch");
      }
      const scope = validateClassDeviceScheduleScope(schedule, {
        institutionId: target.institution_id,
        classId: target.id,
        actorProfileId: target.actor_profile_id,
      });
      if (!scope.ok) {
        const codeByStatus = {
          relay_contract_stale: "relay_class_schedule_contract_stale",
          institution_mismatch: "relay_class_schedule_institution_mismatch",
          class_mismatch: "relay_class_schedule_class_mismatch",
          device_mismatch: "relay_class_schedule_device_mismatch",
          schedule_not_prepared: "relay_schedule_snapshot_invalid",
          class_data_missing: "relay_class_schedule_snapshot_invalid",
        } as const;
        throw new Error(codeByStatus[scope.status]);
      }
      if (source === "live") {
        relayClockRef.current = captureLiveRelayClock(schedule.relay_time);
      }
      const relayPeriods = periodsFromRelayClassSchedule(schedule, target!.id);
      relayClassScheduleRef.current = schedule;
      setRelayClassSchedule(schedule);
      setPeriodsByDay(relayPeriods);

      const relayRoster = relayRosterForClass(schedule, target!.id);
      if (relayRoster) {
        await cacheSet(`classDevice:roster:${target!.id}`, {
          items: relayRoster,
        });
        if (openRef.current?.class_id === target!.id) setRoster(relayRoster);
      }
      return schedule;
    };
    const loadPreparedSchedule = async () => {
      if (
        !target?.institution_id ||
        !target.id ||
        !target.actor_profile_id
      ) {
        return null;
      }
      const prepared = await getClassDeviceCoherentSchedule({
        institutionId: target.institution_id,
        classId: target.id,
        actorProfileId: target.actor_profile_id,
      }).catch(() => null);
      return prepared ? await applySchedule(prepared, "prepared") : null;
    };

    const relay = target?.attendance_presence;
    if (
      !target?.institution_id ||
      !relay?.enabled ||
      relay.allow_local_relay === false ||
      !relay.relay_local_url ||
      !relay.relay_access_token
    ) {
      setRelayStatus("unavailable");
      setRelayScheduleIssue(
        "Les données d’accès au relais de cette classe sont absentes.",
      );
      return await loadPreparedSchedule();
    }
    if (relayScheduleRefreshRef.current) return await relayScheduleRefreshRef.current;

    const run = (async () => {
      const startedAt = performance.now();
      setRelayStatus("checking");
      try {
        const schedule = await fetchRelayTeacherOfflineSchedule({
          institutionId: target.institution_id,
          baseUrl: relay.relay_local_url!,
          accessToken: relay.relay_access_token!,
        });
        const applied = await applySchedule(schedule, "live");
        setRelayStatus("connected");
        setRelayScheduleIssue(null);
        return applied;
      } catch (error) {
        setRelayStatus(
          performance.now() - startedAt >= 2_500 ? "slow" : "unavailable",
        );
        setRelayScheduleIssue(relayScheduleErrorMessage(error));
        return await loadPreparedSchedule();
      } finally {
        relayScheduleRefreshRef.current = null;
      }
    })();
    relayScheduleRefreshRef.current = run;
    return await run;
  }

  /* ───────── Offline state (sync/outbox) ───────── */
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingSync, setPendingSync] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const syncNowRef = useRef<() => Promise<void>>(async () => undefined);
  const [loggingOut, setLoggingOut] = useState(false);
  const [nowTick, setNowTick] = useState<number>(Date.now());

  /* ───────── Rappel sonore de fin de séance ───────── */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const reminderIntervalRef = useRef<number | null>(null);
  const reminderBucketRef = useRef<string>("");
  const alarmBusyRef = useRef(false);
  const [reminderHint, setReminderHint] = useState<string | null>(null);

  function clearReminderLoop() {
    if (reminderIntervalRef.current != null && typeof window !== "undefined") {
      window.clearInterval(reminderIntervalRef.current);
      reminderIntervalRef.current = null;
    }
    reminderBucketRef.current = "";
    setReminderHint(null);
  }

  async function ensureAlarmReady(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    const W = window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };

    const Ctx = W.AudioContext || W.webkitAudioContext;
    if (!Ctx) return false;

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      return audioCtxRef.current.state === "running";
    } catch {
      return false;
    }
  }

  function vibrateIfPossible(pattern: number | number[]) {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);
      }
    } catch {
      // ignore
    }
  }

  async function playAlarmPattern(kind: "gentle" | "medium" | "urgent" | "overdue") {
    if (alarmBusyRef.current) return;
    alarmBusyRef.current = true;

    try {
      const ready = await ensureAlarmReady();
      const ctx = audioCtxRef.current;

      const patterns: Record<"gentle" | "medium" | "urgent" | "overdue", Array<{ f: number; d: number; gap: number; g: number }>> = {
        gentle: [
          { f: 880, d: 0.12, gap: 0.08, g: 0.03 },
          { f: 988, d: 0.12, gap: 0.08, g: 0.03 },
        ],
        medium: [
          { f: 880, d: 0.12, gap: 0.08, g: 0.04 },
          { f: 988, d: 0.12, gap: 0.08, g: 0.04 },
          { f: 1046, d: 0.14, gap: 0.1, g: 0.045 },
        ],
        urgent: [
          { f: 988, d: 0.14, gap: 0.06, g: 0.05 },
          { f: 1174, d: 0.14, gap: 0.06, g: 0.05 },
          { f: 1318, d: 0.18, gap: 0.08, g: 0.055 },
        ],
        overdue: [
          { f: 784, d: 0.12, gap: 0.05, g: 0.055 },
          { f: 988, d: 0.12, gap: 0.05, g: 0.055 },
          { f: 784, d: 0.12, gap: 0.05, g: 0.055 },
          { f: 1318, d: 0.2, gap: 0.08, g: 0.06 },
        ],
      };

      if (ready && ctx) {
        let t = ctx.currentTime + 0.02;
        for (const step of patterns[kind]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(step.f, t);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(step.g, t + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + step.d);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + step.d + 0.02);
          t += step.d + step.gap;
        }
      }

      if (kind === "gentle") vibrateIfPossible([120, 80, 120]);
      if (kind === "medium") vibrateIfPossible([160, 100, 160, 100, 160]);
      if (kind === "urgent") vibrateIfPossible([220, 120, 220, 120, 220]);
      if (kind === "overdue") vibrateIfPossible([260, 120, 260, 120, 260, 120, 260]);
    } finally {
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          alarmBusyRef.current = false;
        }, 1600);
      } else {
        alarmBusyRef.current = false;
      }
    }
  }

  async function countPendingForCurrentClass() {
    const legacyPending = await outboxCount().catch(() => 0);
    const relayPending = selectedClass?.institution_id && selectedClass.id
      ? await countClassDeviceAttendanceRecovery({
          institutionId: selectedClass.institution_id,
          classId: selectedClass.id,
        }).catch(() => 0)
      : 0;
    return legacyPending + relayPending;
  }

  async function refreshPending() {
    const next = await countPendingForCurrentClass();
    setPendingSync(next);
    return next;
  }

  // 🔁 Tente de récupérer une séance serveur et remplace une séance locale "client:*"
  async function refreshServerOpenSession(): Promise<OpenSession | null> {
    try {
      const os = await offlineGetJson(
        "/api/teacher/sessions/open",
        "classDevice:open-session",
      );
      const serverOpen = (os?.item as OpenSession) || null;

      if (serverOpen && serverOpen.id && !isClientSessionId(serverOpen.id)) {
        const current = openRef.current;
        if (
          current &&
          (String(serverOpen.class_id || "") !== String(current.class_id || "") ||
            (current.subject_id &&
              serverOpen.subject_id &&
              String(serverOpen.subject_id) !== String(current.subject_id)))
        ) {
          return null;
        }

        const institutionId =
          classes.find((candidate) => candidate.id === serverOpen.class_id)
            ?.institution_id ||
          selectedClass?.institution_id ||
          "";
        if (
          institutionId &&
          await isTeacherSessionLocallyFinalized(
            institutionId,
            serverOpen.id,
          )
        ) {
          await cacheSet("classDevice:open-session", { item: null });
          await cacheSet("classDevice:local-open", null);
          return null;
        }

        const normalizedOpen: OpenSession = {
          ...current,
          ...serverOpen,
          local_relay: false,
          delivery_origin:
            serverOpen.delivery_origin ||
            (current?.delivery_origin === "relay"
              ? "relay"
              : "cloud_fallback"),
          open_operation_id:
            current?.open_operation_id || serverOpen.open_operation_id || null,
          period_id: serverOpen.period_id || current?.period_id || null,
        };
        setOpen(normalizedOpen);
        setSessionRuntimeState(runtimeStateForOpen(normalizedOpen));
        await cacheSet("classDevice:local-open", normalizedOpen);
        if (normalizedOpen.open_operation_id && institutionId) {
          await markTeacherSessionOpenedInCloud({
            institutionId,
            operationId: normalizedOpen.open_operation_id,
            sessionId: normalizedOpen.id,
            subjectId: normalizedOpen.subject_id,
            startedAt: normalizedOpen.started_at,
            actualCallAt: normalizedOpen.actual_call_at,
          });
        }
        return normalizedOpen;
      }

      return serverOpen;
    } catch {
      return null;
    }
  }

  // 🔁 Si l'utilisateur a "terminé" une séance locale, on tente de fermer la séance serveur après sync
  async function processPendingEnd(): Promise<void> {
    try {
      const pending = await cacheGet<PendingEndPayload | null>(PENDING_END_KEY);
      if (!pending) return;

      // si pas en ligne, on attend
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      // Ancien marqueur sans identité : ne jamais risquer de fermer le cours suivant.
      const clientSessionId = String(pending.client_session_id || "").trim();
      if (!clientSessionId) {
        setMsg(
          "Une ancienne fin de séance locale ne contient pas assez d’informations pour être rejouée automatiquement. Elle reste conservée pour vérification.",
        );
        return;
      }

      const resolved = await resolveOfflineSessionReference(clientSessionId);
      const srvId = resolved.serverSessionId || "";
      if (!srvId) return;

      // tenter de fermer côté serveur avec l'heure réelle de fin capturée localement
      const r = await offlineMutateJson(
        "/api/class/sessions/end",
        {
          method: "PATCH",
          body: {
            session_id: srvId,
            actual_end_at: pending.actual_end_at,
          },
        },
        { mergeKey: `end:${srvId}` }
      );

      // si réussi OU si mis en attente offline, on purge le pending
      if ((r as any)?.ok || (r as any)?.queued || (r as any)?.offline) {
        await cacheSet(PENDING_END_KEY, null);
        await refreshPending();
      }
    } catch {
      // ne casse rien
    }
  }

  async function probeCloudAvailability(): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setCloudStatus("unavailable");
      return false;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(new DOMException("cloud_probe_timeout", "TimeoutError")),
      3_500,
    );
    setCloudStatus("checking");
    try {
      const response = await fetch(
        "/api/class/my-classes?offline_contract=v5&connectivity_probe=1",
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const reachable = response.status < 500;
      setCloudStatus(reachable ? "connected" : "unavailable");
      return reachable;
    } catch {
      setCloudStatus("unavailable");
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function applyCloudOutboxAcknowledgements(
    result: Awaited<ReturnType<typeof flushOutbox>>,
  ) {
    for (const acknowledgement of result.acknowledged) {
      const institutionId =
        acknowledgement.institutionId ||
        selectedClass?.institution_id ||
        lastCompletion?.institution_id ||
        openRef.current?.institution_id ||
        "";
      if (!institutionId) continue;

      if (acknowledgement.operationType === "attendance") {
        await markTeacherAttendanceSyncedInCloud({
          institutionId,
          operationId: acknowledgement.operationId,
          sessionId: acknowledgement.sessionId,
          status: acknowledgement.status,
        });
      } else if (acknowledgement.operationType === "session-end") {
        await markTeacherSessionClosedInCloud({
          institutionId,
          operationId: acknowledgement.operationId,
          status: acknowledgement.status,
        });
        const completion = lastCompletion;
        const completionClientSessionId = completion?.open_operation_id
          ? `client:${completion.open_operation_id}`
          : null;
        if (
          completion &&
          (acknowledgement.classId === completion.class_id ||
            acknowledgement.clientSessionId === completion.session_id ||
            acknowledgement.clientSessionId === completionClientSessionId)
        ) {
          const cloudConfirmedCompletion: ClassDeviceCompletion = {
            ...completion,
            relay_state: "cloud_confirmed",
          };
          setLastCompletion(cloudConfirmedCompletion);
          await cacheSet(LAST_COMPLETION_KEY, cloudConfirmedCompletion);
        }
      }
    }
  }

  async function syncNow() {
    await runClassDeviceSingleFlight(syncingRef, async () => {
      setSyncing(true);
      let result: Awaited<ReturnType<typeof flushOutbox>> | null = null;
      let recovery: ClassDeviceAttendanceRecoverySummary | null = null;

      try {
        const cloudReachable =
          typeof window === "undefined" ? true : await probeCloudAvailability();

        if (cloudReachable) {
          result = await flushOutbox();
          await applyCloudOutboxAcknowledgements(result);

          const active = openRef.current;
          const activeInstitutionId =
            active?.institution_id || selectedClass?.institution_id || "";
          if (active?.open_operation_id && activeInstitutionId) {
            const resolved = await resolveOfflineSessionReference(
              `client:${active.open_operation_id}`,
            );
            if (resolved.serverSessionId) {
              await markTeacherSessionOpenedInCloud({
                institutionId: activeInstitutionId,
                operationId: active.open_operation_id,
                sessionId: resolved.serverSessionId,
                subjectId: active.subject_id,
                startedAt: active.started_at,
                actualCallAt: active.actual_call_at,
              });
            }
          }

          if (
            lastCompletion?.open_operation_id &&
            lastCompletion.institution_id
          ) {
            const resolved = await resolveOfflineSessionReference(
              `client:${lastCompletion.open_operation_id}`,
            );
            if (resolved.serverSessionId) {
              await markTeacherSessionOpenedInCloud({
                institutionId: lastCompletion.institution_id,
                operationId: lastCompletion.open_operation_id,
                sessionId: resolved.serverSessionId,
                subjectId: lastCompletion.subject_id,
                startedAt: lastCompletion.started_at,
              });
            }
          }
        }

        const relay = selectedClass?.attendance_presence;
        if (
          selectedClass?.institution_id &&
          selectedClass.id &&
          selectedClass.actor_profile_id &&
          relay?.relay_local_url &&
          relay.relay_access_token
        ) {
          recovery = await recoverClassDeviceAttendance({
            institutionId: selectedClass.institution_id,
            classId: selectedClass.id,
            actorProfileId: selectedClass.actor_profile_id,
            relayBaseUrl: relay.relay_local_url,
            relayAccessToken: relay.relay_access_token,
          });
          setRelayStatus(
            recovery.relay_unreachable ? "unavailable" : "connected",
          );

          const current = openRef.current;
          const recoveredOpen = current?.open_operation_id
            ? recovery.recovered_sessions.find(
                (candidate) =>
                  candidate.operation_id === current.open_operation_id,
              )
            : null;
          if (current && recoveredOpen) {
            if (recoveredOpen.relay_time) {
              relayClockRef.current = captureLiveRelayClock(
                recoveredOpen.relay_time,
              );
            }
            const mappedOpen: OpenSession = {
              ...current,
              id: recoveredOpen.session_id,
              subject_id: recoveredOpen.subject_id || current.subject_id,
              started_at: recoveredOpen.started_at || current.started_at,
              actual_call_at:
                recoveredOpen.actual_call_at || current.actual_call_at,
              scheduled_end_at:
                recoveredOpen.scheduled_end_at || current.scheduled_end_at,
              grace_expires_at:
                recoveredOpen.grace_expires_at || current.grace_expires_at,
              local_relay: true,
              delivery_origin: "relay",
            };
            openRef.current = mappedOpen;
            setOpen(mappedOpen);
            setSessionRuntimeState("open_relay");
            await cacheSet("classDevice:local-open", mappedOpen);
          }
        }

        await processPendingEnd();
      } catch (e: any) {
        setMsg(
          e?.message ||
            "Synchronisation interrompue. Les données restent conservées.",
        );
      } finally {
        setSyncing(false);
        const remaining = await refreshPending();
        if (remaining === 0) {
          setSessionRuntimeState((current) =>
            current === "closed_pending_sync" ? "closed_synced" : current,
          );
        }

        // Après sync, si on affichait une séance locale, on tente de la remplacer.
        const cur = openRef.current;
        if (cur?.id && isClientSessionId(cur.id)) {
          await refreshServerOpenSession();
        }
      }

      if (recovery?.pending_before) {
        const completion = lastCompletion;
        if (
          recovery.closes_confirmed > 0 &&
          completion &&
          completion.class_id === selectedClass?.id
        ) {
          const confirmedCompletion: ClassDeviceCompletion = {
            ...completion,
            relay_state: "relay_confirmed",
          };
          setLastCompletion(confirmedCompletion);
          await cacheSet(LAST_COMPLETION_KEY, confirmedCompletion);
        }

        if (recovery.pending_after === 0) {
          setMsg(
            "Appel et fin de séance transmis au relais local dans le bon ordre.",
          );
        } else if (recovery.requires_attention > 0) {
          setMsg(
            `${recovery.pending_after} opération(s) restent conservées sur cet appareil et nécessitent une vérification.`,
          );
        } else if (recovery.relay_unreachable) {
          setMsg(
            "Appel et fin de séance conservés sur cet appareil. Le relais local sera réessayé automatiquement.",
          );
        } else if (recovery.closes_waiting_for_attendance > 0) {
          setMsg(
            "L’appel reste en attente sur cet appareil ; sa fermeture ne sera envoyée qu’après les marques.",
          );
        }
        return;
      }

      if (!result) return;
      if (result.authRequired) {
        setMsg(
          "Synchronisation suspendue : la session doit être renouvelée. Les données restent conservées sur cet appareil.",
        );
      } else if (result.blocked > 0) {
        setMsg(
          `${result.blocked} action(s) protégée(s) nécessitent une vérification. Aucune donnée n’a été supprimée.`,
        );
      } else if (result.remaining > 0) {
        setMsg(
          `Réseau encore instable : ${result.remaining} action(s) restent en attente sur cet appareil.`,
        );
      } else if (result.flushed > 0) {
        setMsg(`Synchronisation terminée (${result.flushed} action(s)).`);
      }
    });
  }

  syncNowRef.current = syncNow;

  useEffect(() => {
    void registerServiceWorker();
    void refreshPending();
    void probeCloudAvailability();

    const onOn = () => {
      setIsOnline(true);
      setCloudStatus("checking");
      void syncNowRef.current();
    };
    const onOff = () => {
      setIsOnline(false);
      setCloudStatus("unavailable");
    };

    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);

    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshPending();
    if (!selectedClass?.id || pendingSync <= 0) return;
    void syncNow();
    const retry = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const interval = window.setInterval(retry, 20_000);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", retry);
    };
    // Le relais LAN peut redevenir disponible sans événement "online".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedClass?.id,
    selectedClass?.institution_id,
    selectedClass?.actor_profile_id,
    selectedClass?.attendance_presence?.relay_local_url,
    selectedClass?.attendance_presence?.relay_access_token,
    pendingSync,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  // ✅ Helpers : distinguer offline / erreur serveur
  function extractRespError(r: any): string | null {
    const cands = [r?.error, r?.message, r?.data?.error, r?.data?.message, r?.data?.details];
    for (const v of cands) {
      const s = typeof v === "string" ? v.trim() : "";
      if (s) return s;
    }
    return null;
  }

  function shouldTreatAsOffline(r: any): boolean {
    if (!isOnline) return true;
    if (r?.offline === true) return true;
    if (r?.queued === true) return true;
    if (r?.status === 0) return true;
    return false;
  }

  /* ───────── Sanctions (inline) ───────── */
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [penRubric, setPenRubric] = useState<Rubric>("discipline");
  const [penBusy, setPenBusy] = useState(false);
  const [penRows, setPenRows] = useState<Record<string, PenaltyRow>>({});
  const [penMsg, setPenMsg] = useState<string | null>(null);
  const hasPenChanges = useMemo(
    () => Object.values(penRows).some((v) => (v.points || 0) > 0),
    [penRows]
  );


  function applySnapshotState(
    snapState: ClassPageSnapshotState | null | undefined,
    opts?: { restoreOpen?: boolean }
  ) {
    if (!snapState) return;

    if (snapState.classId) setClassId(snapState.classId);
    if (snapState.subjectId) pendingSnapshotSubjectRef.current = snapState.subjectId;

    if (
      opts?.restoreOpen !== false &&
      isRestorableClassDeviceOpen(snapState.open)
    ) {
      setOpen(snapState.open);
      setSessionRuntimeState(runtimeStateForOpen(snapState.open));
    }

    if (snapState.rows) setRows(snapState.rows);
    setPenaltyOpen(!!snapState.penaltyOpen);
    setPenRubric(coerceRubric(snapState.penRubric));
    if (snapState.penRows) setPenRows(snapState.penRows);
    if (typeof snapState.msg === "string") setMsg(snapState.msg);
  }

  const snapshotClassId = open?.class_id || classId;

  useEffect(() => {
    if (!snapshotClassId) return;

    const snapshotState: ClassPageSnapshotState = {
      classId: snapshotClassId,
      subjectId,
      open,
      rows,
      penaltyOpen,
      penRubric,
      penRows,
      msg,
    };

    saveClassDeviceSnapshot(snapshotClassId, snapshotState);
  }, [snapshotClassId, subjectId, open, rows, penaltyOpen, penRubric, penRows, msg]);

  // 🔒 Empêche d'envoyer un session_id "client:*" à une API serveur qui attend un UUID
  async function ensureServerSessionOrExplain(): Promise<OpenSession | null> {
    const cur = openRef.current;
    if (!cur) return null;
    if (!isClientSessionId(cur.id)) return cur;

    // 1) si on a des actions en attente, essayer de sync d'abord
    if (isOnline && pendingSync > 0) {
      setMsg("Synchronisation en cours…");
      await syncNow();
    }

    // 2) le rejeu de l'ouverture mémorise client:* -> UUID serveur.
    const resolved = await resolveOfflineSessionReference(cur.id);
    if (resolved.serverSessionId) {
      const mappedOpen: OpenSession = {
        ...cur,
        id: resolved.serverSessionId,
        local_relay: false,
        delivery_origin: "cloud_fallback",
      };
      setOpen(mappedOpen);
      setSessionRuntimeState("open_cloud_fallback");
      await cacheSet("classDevice:local-open", mappedOpen);
      return mappedOpen;
    }

    // 3) même si pendingSync==0, on tente un refresh serveur.
    const srv = await refreshServerOpenSession();
    if (srv && srv.id && !isClientSessionId(srv.id)) return srv;

    await refreshPending();
    setMsg(
      "Séance en attente de synchronisation. Appuyez sur Sync puis réessayez (le Wi-Fi est probablement instable)."
    );
    return null;
  }

  useEffect(() => {
    const cur = openRef.current;
    if (!cur || !isClientSessionId(cur.id) || !isOnline || pendingSync > 0) return;

    let cancelled = false;
    void (async () => {
      const resolved = await resolveOfflineSessionReference(cur.id);
      if (cancelled) return;

      if (resolved.serverSessionId) {
        const mappedOpen: OpenSession = {
          ...cur,
          id: resolved.serverSessionId,
          local_relay: false,
          delivery_origin: "cloud_fallback",
        };
        openRef.current = mappedOpen;
        setOpen(mappedOpen);
        setSessionRuntimeState("open_cloud_fallback");
        await cacheSet("classDevice:local-open", mappedOpen);
        return;
      }

      // L'ouverture peut avoir été confirmée avant que l'onglet ne reçoive la réponse.
      await refreshServerOpenSession();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, isOnline, pendingSync]);

  // options de rubriques basées sur la config de conduite
  const rubricOptions = useMemo(() => {
    const defaults: ConductMax = { discipline: 7, tenue: 3, moralite: 4 };
    const base: ConductMax = {
      discipline: conductMax.discipline ?? defaults.discipline,
      tenue: conductMax.tenue ?? defaults.tenue,
      moralite: conductMax.moralite ?? defaults.moralite,
    };
    const order: Rubric[] = ["discipline", "tenue", "moralite"];
    return order.map((r) => {
      const maxVal = base[r];
      const disabled = maxVal <= 0;
      const labelBase = r === "discipline" ? "Discipline" : r === "tenue" ? "Tenue" : "Moralité";
      const label = disabled ? `${labelBase} (désactivée)` : `${labelBase} (max ${maxVal})`;
      return { value: r, label, disabled, max: maxVal };
    });
  }, [conductMax]);

  // si la rubrique choisie devient désactivée (max=0), on bascule sur une autre active
  useEffect(() => {
    setPenRubric((prev) => {
      const defaults: ConductMax = { discipline: 7, tenue: 3, moralite: 4 };
      const merged: ConductMax = {
        discipline: conductMax.discipline ?? defaults.discipline,
        tenue: conductMax.tenue ?? defaults.tenue,
        moralite: conductMax.moralite ?? defaults.moralite,
      };
      if (merged[prev] > 0) return prev;
      const order: Rubric[] = ["discipline", "tenue", "moralite"];
      const candidate = order.find((r) => merged[r] > 0);
      return candidate ?? prev;
    });
  }, [conductMax.discipline, conductMax.tenue, conductMax.moralite]);

  const currentRubricMax = useMemo(() => {
    const opt = rubricOptions.find((o) => o.value === penRubric);
    return opt?.max ?? undefined;
  }, [rubricOptions, penRubric]);

  const rubricDisabled = currentRubricMax !== undefined && currentRubricMax <= 0;

  async function ensureRosterForPenalty() {
    const cid = open?.class_id || classId;
    if (!cid || roster.length > 0) return;
    try {
      setLoadingRoster(true);
      const j = await offlineGetJson(`/api/class/roster?class_id=${cid}`, `classDevice:roster:${cid}`);
      setRoster((j?.items || []) as RosterItem[]);
    } finally {
      setLoadingRoster(false);
    }
  }

  function openPenalty() {
    if (!(open?.class_id || classId)) {
      setMsg("Sélectionnez une classe/discipline d’abord.");
      return;
    }
    setPenRows({});
    setPenaltyOpen(true);
    void ensureRosterForPenalty();
  }

  function setPenPoint(student_id: string, n: number) {
    setPenRows((m) => {
      const cur = m[student_id] || { points: 0, reason: "" };
      return { ...m, [student_id]: { ...cur, points: Math.max(0, Math.floor(n || 0)) } };
    });
  }
  function setPenReason(student_id: string, s: string) {
    setPenRows((m) => {
      const cur = m[student_id] || { points: 0, reason: "" };
      return { ...m, [student_id]: { ...cur, reason: s } };
    });
  }
  function resetPenRows() {
    setPenRows({});
  }

  async function submitClassPenalties() {
    const cid = open?.class_id || classId;
    if (!cid) return;

    const items = Object.entries(penRows)
      .filter(([, v]) => (v.points || 0) > 0)
      .map(([student_id, v]) => ({
        student_id,
        points: Number(v.points || 0),
        reason: (v.reason || "").trim() || null,
      }));

    if (items.length === 0) {
      setPenMsg("Aucune pénalité à enregistrer.");
      return;
    }

    setPenBusy(true);
    setPenMsg(null);

    try {
      const payload = {
        class_id: cid,
        subject_id: open?.subject_id ?? (subjectId || null),
        rubric: coerceRubric(penRubric),
        items,
      };

      const r = await offlineMutateJson(
        "/api/class/penalties/bulk",
        { method: "POST", body: payload },
        {
          // Une sanction est un événement : chaque lot doit rester distinct.
          meta: { operationType: "penalty-batch" },
        }
      );

      if ((r as any).ok) {
        setPenMsg(`Sanctions enregistrées (${items.length}).`);
        setPenRows({});
        setTimeout(() => setPenaltyOpen(false), 600);
      } else if (shouldTreatAsOffline(r)) {
        setPenMsg("Hors connexion : sanctions mises en attente (sync auto).");
        await refreshPending();
      } else {
        const err = extractRespError(r);
        setPenMsg(err ? `Erreur serveur : ${err}` : "Erreur serveur : échec enregistrement sanctions.");
      }
    } catch (e: any) {
      setPenMsg(e?.message || "Échec enregistrement sanctions");
    } finally {
      setPenBusy(false);
    }
  }

  async function refreshClassContextAfterPreparation() {
    const payload = await cacheGet<{ items?: any[] }>(
      "classDevice:my-classes",
    );
    const fresh = mapClassDeviceItems(
      Array.isArray(payload?.items) ? payload.items : [],
    );
    if (fresh.classes.length === 0) {
      throw new Error(
        "La préparation a réussi, mais le contexte de classe actualisé est absent.",
      );
    }
    setClasses(fresh.classes);
    setClassId((current) =>
      fresh.classes.some((item) => item.id === current)
        ? current
        : fresh.classes[0]?.id || "",
    );
    if (fresh.institutionName) {
      setInst((current) => ({
        ...current,
        institution_name: fresh.institutionName,
      }));
    }
    setRelayScheduleIssue(null);
  }

  /* 1) charger mes classes (liées au téléphone) + éventuelle séance ouverte
       + récupérer un nom d’établissement si disponible */
  useEffect(() => {
    (async () => {
      try {
        const [cls, os, localOpenRaw, completionRaw] = await Promise.all([
          offlineGetJson(
            "/api/class/my-classes?offline_contract=v5",
            "classDevice:my-classes",
          ),
          offlineGetJson("/api/teacher/sessions/open", "classDevice:open-session").catch(
            () => ({ item: null })
          ),
          cacheGet("classDevice:local-open"),
          cacheGet<ClassDeviceCompletion | null>(LAST_COMPLETION_KEY),
        ]);
        if (completionRaw?.version === 1) {
          setLastCompletion(completionRaw);
        }

        const mappedContext = mapClassDeviceItems(
          Array.isArray(cls?.items) ? cls.items : [],
        );
        const mapped = mappedContext.classes;
        setClasses(mapped);

        const serverOpen = (os?.item as OpenSession) || null;
        const localOpenCandidate = (localOpenRaw as OpenSession) || null;
        const localOpen = isRestorableClassDeviceOpen(localOpenCandidate)
          ? localOpenCandidate
          : null;
        if (localOpenCandidate && !localOpen) {
          await cacheSet("classDevice:local-open", null);
        }
        // Le cache local représente l'action la plus récente de ce téléphone.
        // Une ancienne réponse Cloud mise en cache ne doit jamais réimposer
        // la matière d'une séance précédente après une panne.
        const resolvedCompletionServerId = completionRaw?.session_id
          ? (
              await resolveOfflineSessionReference(
                completionRaw.session_id,
              ).catch(() => ({ serverSessionId: null }))
            ).serverSessionId
          : null;
        let restoredOpen: OpenSession | null =
          chooseRestorableClassDeviceOpen({
            localOpen,
            serverOpen,
            completion:
              completionRaw?.version === 1 ? completionRaw : null,
            resolvedCompletionServerId,
          });
        if (serverOpen && !restoredOpen && completionRaw?.version === 1) {
          await cacheSet("classDevice:open-session", { item: null });
        }
        if (restoredOpen) {
          const restoredInstitutionId =
            mapped.find((item) => item.id === restoredOpen?.class_id)
              ?.institution_id || "";
          if (
            restoredInstitutionId &&
            await isTeacherSessionLocallyFinalized(
              restoredInstitutionId,
              restoredOpen.id,
            )
          ) {
            restoredOpen = null;
            await cacheSet("classDevice:open-session", { item: null });
            await cacheSet("classDevice:local-open", null);
          }
        }

        if (restoredOpen) {
          setOpen(restoredOpen);
          setSessionRuntimeState(runtimeStateForOpen(restoredOpen));
        }

        const initialClassId = restoredOpen?.class_id || mapped[0]?.id || "";
        if (!classId && initialClassId) {
          setClassId(initialClassId);
        }

        if (initialClassId) {
          const snap = loadClassDeviceSnapshot<ClassPageSnapshotState>(initialClassId);
          if (snap?.state) {
            let snapshotState = snap.state;
            const snapshotOpen = snapshotState.open;
            const snapshotInstitutionId =
              mapped.find((item) => item.id === initialClassId)
                ?.institution_id || "";
            if (
              snapshotOpen &&
              snapshotInstitutionId &&
              await isTeacherSessionLocallyFinalized(
                snapshotInstitutionId,
                snapshotOpen.id,
              )
            ) {
              snapshotState = {
                ...snapshotState,
                subjectId: "",
                open: null,
                rows: {},
              };
              saveClassDeviceSnapshot(initialClassId, snapshotState);
            }
            applySnapshotState(snapshotState, {
              restoreOpen: !restoredOpen,
            });
          }
        }

        if (mappedContext.institutionName) {
          setInst((prev) => ({
            ...prev,
            institution_name:
              !prev.institution_name || prev.institution_name === DEFAULT_INSTITUTION_NAME
                ? mappedContext.institutionName
                : prev.institution_name,
          }));
        }
      } catch (error) {
        setClasses([]);
        setMsg(
          String(
            error instanceof Error
              ? error.message
              : "Impossible de charger le contexte signé de la classe.",
          ),
        );
        const localOpenCandidate = (await cacheGet(
          "classDevice:local-open",
        )) as OpenSession | null;
        const completion = await cacheGet<ClassDeviceCompletion | null>(
          LAST_COMPLETION_KEY,
        );
        if (completion?.version === 1) {
          setLastCompletion(completion);
        }
        let localOpen = isRestorableClassDeviceOpen(localOpenCandidate)
          ? localOpenCandidate
          : null;
        if (
          localOpen &&
          completion?.version === 1 &&
          completion.session_id === localOpen.id
        ) {
          localOpen = null;
          await cacheSet("classDevice:local-open", null);
          await cacheSet("classDevice:open-session", { item: null });
        }
        if (localOpenCandidate && !localOpen) {
          await cacheSet("classDevice:local-open", null);
        }
        if (localOpen) {
          setOpen(localOpen);
          setSessionRuntimeState(runtimeStateForOpen(localOpen));
          const snap = loadClassDeviceSnapshot<ClassPageSnapshotState>(localOpen.class_id);
          if (snap?.state) {
            applySnapshotState(snap.state, { restoreOpen: false });
          }
        } else if (classId || completion?.class_id) {
          const fallbackClassId = classId || completion?.class_id || "";
          if (!classId && fallbackClassId) setClassId(fallbackClassId);
          const snap = loadClassDeviceSnapshot<ClassPageSnapshotState>(
            fallbackClassId,
          );
          if (snap?.state) {
            const snapshotAlreadyFinished =
              completion?.version === 1 &&
              snap.state.open?.id === completion.session_id;
            const safeSnapshot = snapshotAlreadyFinished
              ? {
                  ...snap.state,
                  subjectId: "",
                  open: null,
                  rows: {},
                }
              : snap.state;
            if (snapshotAlreadyFinished) {
              saveClassDeviceSnapshot(fallbackClassId, safeSnapshot);
            }
            applySnapshotState(safeSnapshot, {
              restoreOpen: !snapshotAlreadyFinished,
            });
          }
        }
      } finally {
        void processPendingEnd();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedClass) {
      relayClassScheduleRef.current = null;
      setRelayClassSchedule(null);
      setRelayScheduleIssue(null);
      return;
    }
    relayClassScheduleRef.current = null;
    setRelayClassSchedule(null);
    let cancelled = false;
    const refresh = async () => {
      const schedule = await refreshClassScheduleFromRelay(selectedClass);
      if (cancelled || !schedule) return;
      setNowTick(Date.now());
    };
    void refresh();
    const interval = window.setInterval(() => {
      if (!openRef.current) void refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // Le jeton est borné à la classe ; toute variation impose une nouvelle lecture relais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedClass?.id,
    selectedClass?.institution_id,
    selectedClass?.attendance_presence?.relay_local_url,
    selectedClass?.attendance_presence?.relay_access_token,
  ]);

  /* 1bis) charger paramètres + périodes + réglages de conduite */
  async function loadInstitutionBasics() {
    async function getJson(url: string, key: string) {
      try {
        return await offlineGetJson(url, key);
      } catch {
        return null;
      }
    }

    // 1) paramètres & périodes
    let instConfig: InstCfg = {
      tz: "Africa/Abidjan",
      default_session_minutes: 60,
      auto_lateness: true,
      institution_name: inst.institution_name || DEFAULT_INSTITUTION_NAME,
      academic_year_label: inst.academic_year_label || null,
    };
    const grouped: Record<number, Period[]> = {};

    const all =
      (await getJson("/api/teacher/institution/basics", "classDevice:inst:basics:teacher")) ||
      (await getJson("/api/institution/basics", "classDevice:inst:basics:institution"));

    if (all?.periods) {
      const nameFromAll =
        all?.institution_name ||
        all?.institution_label ||
        all?.short_name ||
        all?.name ||
        all?.settings_json?.institution_name ||
        all?.settings_json?.header_title ||
        all?.settings_json?.school_name ||
        null;

      const yearFromAll =
        all?.academic_year_label ||
        all?.current_academic_year_label ||
        all?.academic_year ||
        all?.year_label ||
        all?.settings_json?.academic_year_label ||
        all?.settings_json?.current_academic_year_label ||
        null;

      instConfig = {
        tz: all?.tz || "Africa/Abidjan",
        default_session_minutes: Number(all?.default_session_minutes || 60),
        auto_lateness: !!all?.auto_lateness,
        institution_name: nameFromAll || instConfig.institution_name,
        academic_year_label: yearFromAll || instConfig.academic_year_label || null,
      };

      (all.periods as any[]).forEach((row: any) => {
        const w = Number(row.weekday || 1);
        if (!grouped[w]) grouped[w] = [];
        grouped[w].push({
          id: safeStr(row.id),
          weekday: w,
          label: row.label || "Séance",
          start_time: String(row.start_time || "08:00").slice(0, 5),
          end_time: String(row.end_time || "09:00").slice(0, 5),
        });
      });
    } else {
      const settings =
        (await getJson("/api/teacher/institution/settings", "classDevice:inst:settings:teacher")) ||
        (await getJson("/api/institution/settings", "classDevice:inst:settings:institution")) || {
          tz: "Africa/Abidjan",
          default_session_minutes: 60,
          auto_lateness: true,
        };

      const per =
        (await getJson("/api/teacher/institution/periods", "classDevice:inst:periods:teacher")) ||
        (await getJson("/api/institution/periods", "classDevice:inst:periods:institution")) || {
          periods: [],
        };

      const nameFromSettings =
        settings?.institution_name ||
        settings?.institution_label ||
        settings?.short_name ||
        settings?.name ||
        settings?.header_title ||
        settings?.school_name ||
        null;

      const yearFromSettings =
        settings?.academic_year_label ||
        settings?.current_academic_year_label ||
        settings?.academic_year ||
        settings?.year_label ||
        settings?.header_academic_year ||
        null;

      instConfig = {
        tz: settings?.tz || "Africa/Abidjan",
        default_session_minutes: Number(settings?.default_session_minutes || 60),
        auto_lateness: !!settings?.auto_lateness,
        institution_name: nameFromSettings || instConfig.institution_name,
        academic_year_label: yearFromSettings || instConfig.academic_year_label || null,
      };

      (Array.isArray(per?.periods) ? per.periods : []).forEach((row: any) => {
        const w = Number(row.weekday || 1);
        if (!grouped[w]) grouped[w] = [];
        grouped[w].push({
          id: safeStr(row.id),
          weekday: w,
          label: row.label || "Séance",
          start_time: String(row.start_time || "08:00").slice(0, 5),
          end_time: String(row.end_time || "09:00").slice(0, 5),
        });
      });
    }

    // 🔁 Complément : harmoniser le nom avec /api/admin/institution/settings (comme le dashboard)
    const adminSettings = await getJson(
      "/api/admin/institution/settings",
      "classDevice:inst:adminSettings"
    );
    if (adminSettings) {
      const nameFromAdmin = String(
        adminSettings?.institution_name || adminSettings?.name || adminSettings?.institution_label || ""
      ).trim();

      const yearFromAdmin =
        adminSettings?.academic_year_label ||
        adminSettings?.current_academic_year_label ||
        adminSettings?.active_academic_year ||
        null;

      if (nameFromAdmin) instConfig.institution_name = nameFromAdmin;
      if (yearFromAdmin && !instConfig.academic_year_label) instConfig.academic_year_label = yearFromAdmin;
    }

    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time))
    );

    // ✅ Ne pas écraser ce qui a déjà été trouvé (comme le nom via /api/class/my-classes)
    setInst((prev) => ({
      ...prev,
      tz: instConfig.tz || prev.tz || "Africa/Abidjan",
      default_session_minutes:
        instConfig.default_session_minutes || prev.default_session_minutes || 60,
      auto_lateness:
        typeof instConfig.auto_lateness === "boolean" ? instConfig.auto_lateness : prev.auto_lateness,
      institution_name:
        instConfig.institution_name || prev.institution_name || DEFAULT_INSTITUTION_NAME,
      academic_year_label: instConfig.academic_year_label || prev.academic_year_label || null,
    }));
    if (!relayClassScheduleRef.current) setPeriodsByDay(grouped);

    // 2) config de conduite (maxima) — loader ultra défensif
    const defaults: ConductMax = { discipline: 7, tenue: 3, moralite: 4 };

    try {
      const rawConf =
        ((await getJson("/api/teacher/conduct/settings", "classDevice:conduct:teacher")) as any) ??
        ((await getJson("/api/institution/conduct/settings", "classDevice:conduct:institution")) as any) ??
        ((await getJson("/api/admin/conduct/settings", "classDevice:conduct:admin")) as any);

      console.log("[ClassDevice] conduct settings rawConf =", rawConf);

      if (!rawConf) {
        setConductMax(defaults);
        return;
      }

      let src: any = rawConf;

      if (src && typeof src === "object" && src.item) {
        const it = src.item;
        src = it.settings_json || it.settings || it;
      } else if (src && typeof src === "object" && Array.isArray(src.items) && src.items.length) {
        const it = src.items[0];
        src = it.settings_json || it.settings || it;
      } else if (src && typeof src === "object" && Array.isArray(src.data) && src.data.length) {
        const it = src.data[0];
        src = it.settings_json || it.settings || it;
      } else if (src && typeof src === "object" && (src.settings_json || src.settings)) {
        src = src.settings_json || src.settings;
      } else if (Array.isArray(src) && src.length) {
        const it = src[0];
        src =
          it && typeof it === "object" && (it.settings_json || it.settings)
            ? it.settings_json || it.settings
            : it;
      }

      console.log("[ClassDevice] conduct settings src (parsed) =", src);

      const d = Number(
        src?.discipline_max ??
          src?.discipline ??
          src?.max_discipline ??
          src?.discipline_points_max ??
          defaults.discipline
      );
      const t = Number(
        src?.tenue_max ?? src?.tenue ?? src?.max_tenue ?? src?.tenue_points_max ?? defaults.tenue
      );
      const m = Number(
        src?.moralite_max ??
          src?.moralite ??
          src?.max_moralite ??
          src?.moralite_points_max ??
          defaults.moralite
      );

      setConductMax({
        discipline: Number.isFinite(d) ? d : defaults.discipline,
        tenue: Number.isFinite(t) ? t : defaults.tenue,
        moralite: Number.isFinite(m) ? m : defaults.moralite,
      });
    } catch (e) {
      console.warn("[ClassDevice] erreur chargement règles de conduite:", e);
      setConductMax(defaults);
    }
  }

  useEffect(() => {
    void loadInstitutionBasics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ✅ Même logique que ton fichier qui marche :
        1) dataset/globals
        2) fallback settings endpoints (settings_json puis racine) */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof window === "undefined") return;

      try {
        const body: any = document.body;

        // 1) DOM / globals
        const fromDataName = safeStr(body?.dataset?.institutionName) || safeStr(body?.dataset?.institution);
        const fromGlobalName = safeStr((window as any).__MC_INSTITUTION_NAME__);
        const finalName = fromDataName || fromGlobalName;

        const fromDataYear =
          safeStr(body?.dataset?.academicYear) ||
          safeStr(body?.dataset?.schoolYear) ||
          safeStr(body?.dataset?.anneeScolaire);
        const fromGlobalYear = safeStr((window as any).__MC_ACADEMIC_YEAR__);
        const finalYear = fromDataYear || fromGlobalYear;

        if (finalName || finalYear) {
          setInst((prev) => ({
            ...prev,
            institution_name:
              finalName && finalName.trim().length > 0
                ? !prev.institution_name || prev.institution_name === DEFAULT_INSTITUTION_NAME
                  ? finalName
                  : prev.institution_name
                : prev.institution_name || DEFAULT_INSTITUTION_NAME,
            academic_year_label: finalYear || prev.academic_year_label || null,
          }));
        }

        // si les deux sont trouvés en local, on ne fait pas d'appel réseau (comme l'exemple)
        if (finalName && finalYear) return;

        // 2) fallback API (settings)
        const endpoints = [
          { url: "/api/teacher/institution/settings", key: "classDevice:identity:settings:teacher" },
          { url: "/api/institution/settings", key: "classDevice:identity:settings:institution" },
          { url: "/api/admin/institution/settings", key: "classDevice:identity:settings:admin" },
        ] as const;

        for (const ep of endpoints) {
          let data: any = null;
          try {
            data = await offlineGetJson(ep.url, ep.key);
          } catch {
            data = null;
          }

          const { name, year } = extractInstitutionIdentity(data);

          if (name || year) {
            if (cancelled) return;

            setInst((prev) => ({
              ...prev,
              institution_name:
                name && name.trim().length > 0
                  ? !prev.institution_name || prev.institution_name === DEFAULT_INSTITUTION_NAME
                    ? name
                    : prev.institution_name
                  : prev.institution_name || DEFAULT_INSTITUTION_NAME,
              academic_year_label: year || prev.academic_year_label || null,
            }));

            // dès qu'on a au moins un des deux, on stoppe (comme l'exemple)
            break;
          }
        }
      } catch {
        // ne casse rien
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Calcul du créneau par défaut « du moment » (timezone-aware)
  function computeDefaultsForNow(
    sourcePeriods: Record<number, Period[]> = periodsByDay,
    baseMs = Date.now(),
  ) {
    const tz = inst?.tz || "Africa/Abidjan";
    const now = relayAdjustedDate(baseMs);
    const nowHM = hmInTZ(now, tz);
    const wd = weekdayInTZ1to7(now, tz);
    const slots = sourcePeriods[wd] || [];

    if (wd === 7 || slots.length === 0) {
      setStartTime(nowHM);
      setDuration(inst.default_session_minutes || 60);
      setSlotLabel("Hors créneau — utilisation de l’heure actuelle");
      setLocked(true);
      return;
    }

    const nowMin = toMinutes(nowHM);
    let pick = slots.find((s) => nowMin >= toMinutes(s.start_time) && nowMin < toMinutes(s.end_time));
    if (!pick) pick = slots.find((s) => nowMin <= toMinutes(s.start_time));
    if (!pick) {
      setStartTime(nowHM);
      setDuration(inst.default_session_minutes || 60);
      setSlotLabel("Hors créneau — utilisation de l’heure actuelle");
      setLocked(true);
      return;
    }

    setStartTime(pick.start_time);
    setDuration(Math.max(1, minutesDiff(pick.start_time, pick.end_time) || inst.default_session_minutes || 60));
    setSlotLabel(`${pick.label} • ${pick.start_time} → ${pick.end_time}`);
    setLocked(true);
  }

  useEffect(() => {
    computeDefaultsForNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(periodsByDay), inst.default_session_minutes, inst.tz, classId, nowTick]);

  const activeConfiguredSlot = useMemo(() => {
    const tz = inst?.tz || "Africa/Abidjan";
    const now = relayAdjustedDate(nowTick);
    const wd = weekdayInTZ1to7(now, tz);
    const slots = periodsByDay[wd] || [];
    if (!slots.length) return null;

    const nowMin = toMinutes(hmInTZ(now, tz));
    return (
      slots.find((s) => nowMin >= toMinutes(s.start_time) && nowMin < toMinutes(s.end_time)) ||
      null
    );
  }, [periodsByDay, inst?.tz, nowTick]);

  const hasConfiguredSlotsToday = useMemo(() => {
    const tz = inst?.tz || "Africa/Abidjan";
    const wd = weekdayInTZ1to7(relayAdjustedDate(nowTick), tz);
    return (periodsByDay[wd] || []).length > 0;
  }, [periodsByDay, inst?.tz, nowTick]);

  const activeSlotKey = useMemo(() => {
    const tz = inst?.tz || "Africa/Abidjan";
    const wd = weekdayInTZ1to7(relayAdjustedDate(nowTick), tz);
    if (!hasConfiguredSlotsToday) return `no-config|${wd}`;
    if (!activeConfiguredSlot) return `closed|${wd}`;
    return `${wd}|${activeConfiguredSlot.start_time}|${activeConfiguredSlot.end_time}`;
  }, [activeConfiguredSlot, hasConfiguredSlotsToday, inst?.tz, nowTick]);

  const activeSubjectScopeKey = useMemo(() => {
    const periodId = String(activeConfiguredSlot?.id || "no-period");
    const revision = String(relayClassSchedule?.schedule_revision ?? "no-revision");
    return `${activeSlotKey}|${periodId}|${revision}`;
  }, [activeConfiguredSlot?.id, activeSlotKey, relayClassSchedule?.schedule_revision]);

  const canUseFallbackLegacyFlow = isOnline && !!activeConfiguredSlot;
  const usingUnverifiedLegacySubjects =
    subjectLoadMode === "legacy-offline" ||
    subjectLoadMode === "legacy-fallback";
  const canStartAttendanceNow =
    !!activeConfiguredSlot && !usingUnverifiedLegacySubjects;

  /* 2) charger les matières selon le mode courant
        - en ligne : le Cloud strict du créneau est prioritaire
        - en ligne + échec technique : relais, puis ancien cache en dernier recours
        - hors ligne : relais/cache strict du créneau, jamais une liste ambiguë */
  useEffect(() => {
    if (!classId) {
      setSubjects([]);
      setSubjectId("");
      setSubjectLoadMode("empty");
      setSubjectScheduleIssue(null);
      subjectSelectionSlotRef.current = "";
      return;
    }
    if (open) return;

    let cancelled = false;

    const normalizeSubjects = (list: Subject[]) => {
      const seen = new Set<string>();
      return (list || []).filter((subject) => {
        const id = String(subject?.id || "").trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    };

    const applyList = (rawList: Subject[], mode: SubjectLoadMode) => {
      if (cancelled) return;

      const automaticMode =
        mode === "relay" || mode === "auto" || mode === "auto-offline";
      const normalizedList = normalizeSubjects(rawList);
      const automaticConflict = automaticMode && normalizedList.length > 1;
      const list = automaticConflict ? [] : normalizedList;

      setSubjects(list);
      setSubjectLoadMode(automaticConflict ? "empty" : mode);
      setSubjectScheduleIssue(
        automaticConflict
          ? "Conflit d’emploi du temps détecté pour ce créneau. La matière précédente n’est pas réutilisée : actualisez le relais avant de démarrer le nouvel appel."
          : null,
      );

      const snap = loadClassDeviceSnapshot<ClassPageSnapshotState>(classId);
      const snapSubjectId = pendingSnapshotSubjectRef.current || snap?.state?.subjectId || "";

      const slotChanged = automaticMode
        ? subjectSelectionSlotRef.current !== activeSubjectScopeKey
        : false;
      subjectSelectionSlotRef.current = automaticMode
        ? activeSubjectScopeKey
        : "";

      setSubjectId((prev) => {
        if (automaticMode) {
          const soleSubjectId = list.length === 1 ? list[0]!.id : "";
          if (slotChanged || !prev || !list.some((subject) => subject.id === prev)) {
            return soleSubjectId;
          }
          return prev;
        }

        if (snapSubjectId && list.some((subject) => subject.id === snapSubjectId)) {
          return snapSubjectId;
        }
        if (prev && list.some((subject) => subject.id === prev)) {
          return prev;
        }
        return list[0]?.id || "";
      });

      pendingSnapshotSubjectRef.current = "";
    };

    const loadLegacySubjects = async () => {
      const payload = await offlineGetJson(
        `/api/class/subjects?class_id=${classId}`,
        `classDevice:subjects:${classId}`,
      ).catch(() => ({ items: [] as Subject[] }));
      return (payload?.items || []) as Subject[];
    };

    (async () => {
      if (!activeConfiguredSlot) {
        if (cancelled) return;
        setSubjects([]);
        setSubjectId("");
        setSubjectLoadMode("closed-online");
        setSubjectScheduleIssue(null);
        subjectSelectionSlotRef.current = "";
        pendingSnapshotSubjectRef.current = "";
        return;
      }

      const relayList = relaySubjectsForSlot(
        relayClassSchedule,
        classId,
        activeConfiguredSlot,
      );
      const normalizedRelayList =
        relayList === null ? null : normalizeSubjects(relayList);
      const periodParam = activeConfiguredSlot.id
        ? `&period_id=${encodeURIComponent(activeConfiguredSlot.id)}`
        : "";
      const strictUrl =
        `/api/class/subjects?class_id=${classId}` +
        `&slot=${encodeURIComponent(activeSlotKey)}${periodParam}`;
      const strictCacheKey =
        `classDevice:subjects:${classId}:${activeSubjectScopeKey}`;

      if (!isOnline) {
        if (normalizedRelayList !== null && normalizedRelayList.length <= 1) {
          await cacheSet(strictCacheKey, { items: normalizedRelayList }).catch(
            () => null,
          );
          applyList(normalizedRelayList, "relay");
          return;
        }

        const preparedResp = await offlineGetJson(
          strictUrl,
          strictCacheKey,
        ).catch(() => null as any);

        if (preparedResp != null) {
          applyList(
            ((preparedResp?.items || []) as Subject[]) ?? [],
            "auto-offline",
          );
          return;
        }

        if (normalizedRelayList !== null) {
          applyList(normalizedRelayList, "relay");
          return;
        }

        const legacyList = await loadLegacySubjects();
        applyList(legacyList, legacyList.length ? "legacy-offline" : "empty");
        return;
      }

      // En ligne, le Cloud du créneau courant est la source de vérité.
      // Un planning relais mémorisé avant une modification ne doit jamais
      // réintroduire la matière du créneau précédent.
      const legacyWarmPromise = loadLegacySubjects();
      const autoResp = await offlineGetJson(strictUrl, strictCacheKey).catch(
        () => null as any,
      );

      if (autoResp != null) {
        applyList(((autoResp?.items || []) as Subject[]) ?? [], "auto");
        return;
      }

      if (normalizedRelayList !== null) {
        applyList(normalizedRelayList, "relay");
        return;
      }

      if (canUseFallbackLegacyFlow) {
        const legacyList = await legacyWarmPromise;
        if (legacyList.length > 0) {
          applyList(legacyList, "legacy-fallback");
          return;
        }
      }

      applyList([], "empty");
    })();

    return () => {
      cancelled = true;
    };
  }, [
    classId,
    activeSlotKey,
    activeSubjectScopeKey,
    activeConfiguredSlot,
    canUseFallbackLegacyFlow,
    isOnline,
    open,
    relayClassSchedule?.schedule_revision,
  ]);

  /* 2bis) préchauffer la liste des élèves dès que la classe est connue en ligne
        pour que l'ouverture de séance hors réseau retrouve un roster déjà en cache */
  useEffect(() => {
    if (!classId || !isOnline) return;
    void offlineGetJson(
      `/api/class/roster?class_id=${classId}`,
      `classDevice:roster:${classId}`
    ).catch(() => null);
  }, [classId, isOnline]);

  /* 3) charger roster si séance ouverte */
  useEffect(() => {
    if (!open) {
      setRoster([]);
      setRows({});
      return;
    }
    (async () => {
      try {
        setLoadingRoster(true);
        const relayRoster = relayRosterForClass(relayClassSchedule, open.class_id);
        if (relayRoster !== null) {
          setRoster(relayRoster);
          await cacheSet(`classDevice:roster:${open.class_id}`, { items: relayRoster });
        } else {
          const j = await offlineGetJson(
            `/api/class/roster?class_id=${open.class_id}`,
            `classDevice:roster:${open.class_id}`
          ).catch(() => null as any);
          setRoster(((j?.items || []) as RosterItem[]) ?? []);
        }

        const snap = loadClassDeviceSnapshot<ClassPageSnapshotState>(open.class_id);
        setRows(snap?.state?.rows || {});
      } finally {
        setLoadingRoster(false);
      }
    })();
  }, [open?.class_id, relayClassSchedule?.schedule_revision]);

  /* helpers saisie */
  function persistAttendanceRowsImmediately(nextRows: Record<string, Row>) {
    const currentOpen = openRef.current;
    if (!currentOpen?.class_id) return;
    saveClassDeviceSnapshot<ClassPageSnapshotState>(currentOpen.class_id, {
      classId: currentOpen.class_id,
      subjectId: currentOpen.subject_id || subjectId,
      open: currentOpen,
      rows: nextRows,
      penaltyOpen,
      penRubric,
      penRows,
      msg,
    });
  }

  function toggleAbsent(id: string, v: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, absent: v };
      if (v) {
        next.late = false;
        next.late_observed_at = null;
      }
      const nextRows = { ...prev, [id]: next };
      persistAttendanceRowsImmediately(nextRows);
      return nextRows;
    });
  }
  function toggleLate(id: string, v: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = {
        ...cur,
        late: v,
        absent: v ? false : cur.absent,
        late_observed_at: v ? observedNowIso() : null,
      };
      const nextRows = { ...prev, [id]: next };
      persistAttendanceRowsImmediately(nextRows);
      return nextRows;
    });
  }

  function attendanceMarksFromRows(source: Record<string, Row>) {
    return Object.entries(source).map(([student_id, row]) => {
      if (row.absent) {
        return { student_id, status: "absent" as const, reason: row.reason ?? null, observed_at: null };
      }
      if (row.late) {
        return {
          student_id,
          status: "late" as const,
          reason: row.reason ?? null,
          observed_at: row.late_observed_at || observedNowIso(),
        };
      }
      return { student_id, status: "present" as const, observed_at: null };
    });
  }

  useEffect(() => {
    if (!open?.local_relay || !selectedClass?.institution_id || !selectedClass.actor_profile_id) return;
    const periodId = open.period_id || null;
    if (!periodId || Object.keys(rows).length === 0) return;
    const timer = window.setTimeout(() => {
      void stageTeacherAttendanceDraft({
        institutionId: selectedClass.institution_id,
        actorProfileId: selectedClass.actor_profile_id || "class-device",
        sessionId: open.id,
        classId: open.class_id,
        periodId,
        marks: attendanceMarksFromRows(rows),
        forceRelay: true,
      }).catch(() => {
        setMsg("Impossible de conserver les changements sur cet appareil. Ne fermez pas la séance.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, open?.id, open?.period_id, open?.local_relay, selectedClass?.institution_id]);

  /* actions */
  useEffect(() => {
    void ensureAlarmReady();
  }, []);

  const usingLegacyOfflineMode = !open && subjectLoadMode === "legacy-offline";
  const usingLegacyFallbackMode = !open && subjectLoadMode === "legacy-fallback";
  const scheduleBlocked = !open && !activeConfiguredSlot;
  const noScheduledSubjectNow =
    !!classId &&
    !!activeConfiguredSlot &&
    !open &&
    (subjectLoadMode === "empty" || subjectLoadMode === "auto-offline") &&
    subjects.length === 0;

  useEffect(() => {
    clearReminderLoop();
    if (!open) return;

    const computeEndMs = () => {
      const base = new Date(openRef.current?.started_at || open.started_at).getTime();
      const minutes = Number(
        openRef.current?.expected_minutes ?? open.expected_minutes ?? duration ?? inst.default_session_minutes ?? 60
      );
      if (!Number.isFinite(base) || !Number.isFinite(minutes) || minutes <= 0) return null;
      return base + minutes * 60_000;
    };

    const tick = () => {
      const endMs = computeEndMs();
      if (!endMs || !openRef.current) {
        clearReminderLoop();
        return;
      }

      const remainingMs = endMs - Date.now();
      setReminderHint(formatReminderCountdown(remainingMs));

      let nextBucket = "";
      let nextKind: "gentle" | "medium" | "urgent" | "overdue" | null = null;

      if (remainingMs <= 0) {
        nextBucket = `overdue:${Math.floor(Math.abs(remainingMs) / 30_000)}`;
        nextKind = "overdue";
      } else if (remainingMs <= 120_000) {
        nextBucket = `last2:${Math.floor((120_000 - remainingMs) / 30_000)}`;
        nextKind = "urgent";
      } else if (remainingMs <= 300_000) {
        nextBucket = `last5:${Math.floor((300_000 - remainingMs) / 60_000)}`;
        nextKind = remainingMs <= 180_000 ? "medium" : "gentle";
      } else {
        reminderBucketRef.current = "";
        return;
      }

      if (nextBucket && nextBucket !== reminderBucketRef.current) {
        reminderBucketRef.current = nextBucket;
        if (nextKind) {
          void playAlarmPattern(nextKind);
        }
      }
    };

    tick();
    if (typeof window !== "undefined") {
      reminderIntervalRef.current = window.setInterval(tick, 5_000);
    }

    return () => {
      clearReminderLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, open?.started_at, open?.expected_minutes, duration, inst.default_session_minutes]);

  async function startSession() {
    if (!classId) return;

    void ensureAlarmReady();

    if (!subjectId) {
      setMsg("Choisissez une discipline avant de démarrer l’appel.");
      return;
    }

    if (!activeConfiguredSlot?.id) {
      setMsg("L’appel n’est autorisé que pendant un créneau ouvert par l’administration.");
      return;
    }
    if (usingUnverifiedLegacySubjects) {
      setMsg(
        "Cet ancien cache reste consultable, mais ne peut pas ouvrir un appel. Actualisez la préparation v5.",
      );
      return;
    }

    setBusy(true);
    setSessionRuntimeState("opening");
    setMsg("Sécurisation du démarrage sur ce téléphone, puis réplication vers le relais et le Cloud…");

    try {
      const relayPolicy = selectedClass?.attendance_presence;
      let preparedSchedule = relayClassScheduleRef.current;
      if (
        selectedClass?.institution_id &&
        selectedClass.id &&
        selectedClass.actor_profile_id
      ) {
        preparedSchedule = await getClassDeviceCoherentSchedule({
          institutionId: selectedClass.institution_id,
          classId: selectedClass.id,
          actorProfileId: selectedClass.actor_profile_id,
        }).catch(() => preparedSchedule);
      }

      const verifiedPeriods: Record<number, Period[]> = preparedSchedule
        ? periodsFromRelayClassSchedule(preparedSchedule, classId)
        : periodsByDay;
      const verifiedPeriod = Object.values(verifiedPeriods)
        .flat()
        .find((period) => period.id === activeConfiguredSlot.id) || activeConfiguredSlot;
      const verifiedSubjects = preparedSchedule
        ? relaySubjectsForSlot(preparedSchedule, classId, verifiedPeriod)
        : subjects;

      if (
        preparedSchedule &&
        (!verifiedPeriod ||
          !verifiedSubjects ||
          !verifiedSubjects.some((subject) => subject.id === subjectId))
      ) {
        setSessionRuntimeState("recoverable_error");
        setMsg(
          "Le créneau ou la discipline ne figure pas dans le planning préparé de la classe. Actualisez la préparation de ce téléphone.",
        );
        return;
      }

      if (preparedSchedule) {
        relayClassScheduleRef.current = preparedSchedule;
        setRelayClassSchedule(preparedSchedule);
        setPeriodsByDay(verifiedPeriods);
      }

      const observedAt = relayAdjustedDate();
      const [hh, mm] = verifiedPeriod.start_time.split(":").map((value) => Number(value));
      const started = new Date(
        observedAt.getFullYear(),
        observedAt.getMonth(),
        observedAt.getDate(),
        Number.isFinite(hh) ? hh : observedAt.getHours(),
        Number.isFinite(mm) ? mm : 0,
        0,
        0,
      );
      const effectiveDuration = Math.max(
        1,
        minutesDiff(verifiedPeriod.start_time, verifiedPeriod.end_time),
      );
      const attemptKey = [
        classId,
        verifiedPeriod.id,
        subjectId,
        dateKeyInTZ(observedAt, inst.tz || "Africa/Abidjan"),
      ].join(":");
      const actualCallAtISO = observedAt.toISOString();

      const institutionId = selectedClass?.institution_id || "";
      const actorProfileId = selectedClass?.actor_profile_id || null;
      const cls = classes.find((candidate) => candidate.id === classId);
      const subj = (verifiedSubjects ?? []).find(
        (subject) => subject.id === subjectId,
      );

      // 1) Journal local d'abord : le réseau ne décide plus si l'appel peut commencer.
      const stagedOpen = await stageTeacherAttendanceSessionOpen({
        institutionId,
        classId,
        periodId: verifiedPeriod.id!,
        attemptKey,
      });
      const operationId = stagedOpen.operation_id;
      const clientSessionId = `client:${operationId}`;
      const pendingOpen: OpenSession = {
        id: stagedOpen.session_id || clientSessionId,
        institution_id: institutionId,
        actor_profile_id: actorProfileId,
        class_id: classId,
        class_label: cls?.label || "Classe",
        subject_id: stagedOpen.subject_id || subjectId,
        subject_name: subj?.label || null,
        started_at: stagedOpen.started_at || started.toISOString(),
        actual_call_at: stagedOpen.actual_call_at || actualCallAtISO,
        expected_minutes: effectiveDuration,
        local_relay: stagedOpen.state === "relay_opened",
        delivery_origin:
          stagedOpen.state === "relay_opened"
            ? "relay"
            : stagedOpen.state === "cloud_opened"
              ? "cloud_fallback"
              : "local_pending",
        open_operation_id: operationId,
        period_id: verifiedPeriod.id,
        scheduled_end_at: stagedOpen.scheduled_end_at,
        grace_expires_at: stagedOpen.grace_expires_at,
        session_state: stagedOpen.session_state || "open",
        education_type: cls?.education_type || "general_secondary",
        education_label: cls?.education_label || "Secondaire général",
        education_short_label: cls?.education_short_label || "Général",
        formation_code: cls?.formation_code || null,
        formation_label: cls?.formation_label || null,
        formation_level_code: cls?.formation_level_code || null,
        formation_level_label: cls?.formation_level_label || null,
        education_context_key:
          cls?.education_context_key ||
          cls?.education_type ||
          "general_secondary",
        education_context_label:
          cls?.education_context_label ||
          cls?.education_label ||
          "Secondaire général",
      };
      await cacheSet("classDevice:local-open", pendingOpen);
      openRef.current = pendingOpen;
      setOpen(pendingOpen);
      setSessionRuntimeState("open_local_pending");
      setMsg(
        "Appel ouvert et sécurisé sur ce téléphone. Vérification du relais et du Cloud en cours…",
      );
      await refreshPending();

      // 2) Le relais puis le Cloud améliorent la réplication, sans bloquer l'écran.
      const relayAttemptStartedAt = performance.now();
      const relayDelivery = await openTeacherAttendanceSessionOnRelay({
        institutionId,
        classId,
        periodId: verifiedPeriod.id!,
        attemptKey,
        relayBaseUrl: relayPolicy?.relay_local_url,
        relayAccessToken: relayPolicy?.relay_access_token,
      });
      const relayAttemptDuration = performance.now() - relayAttemptStartedAt;

      if (relayDelivery.state === "relay_opened" && relayDelivery.session_id) {
        setRelayStatus("connected");
        if (relayDelivery.relay_time) {
          relayClockRef.current = captureLiveRelayClock(
            relayDelivery.relay_time,
          );
        }
        const relaySubject = (verifiedSubjects ?? []).find(
          (subject) => subject.id === (relayDelivery.subject_id || subjectId),
        );
        const relayOpen: OpenSession = {
          ...pendingOpen,
          id: relayDelivery.session_id,
          subject_id: relayDelivery.subject_id || subjectId || null,
          subject_name: relaySubject?.label || pendingOpen.subject_name,
          started_at: relayDelivery.started_at || pendingOpen.started_at,
          actual_call_at:
            relayDelivery.actual_call_at || pendingOpen.actual_call_at,
          local_relay: true,
          delivery_origin: "relay",
          scheduled_end_at: relayDelivery.scheduled_end_at,
          grace_expires_at: relayDelivery.grace_expires_at,
          session_state: relayDelivery.session_state || "open",
        };
        openRef.current = relayOpen;
        setOpen(relayOpen);
        setSessionRuntimeState("open_relay");
        await cacheSet("classDevice:local-open", relayOpen);
        setMsg(teacherSessionDeliveryMessage(relayDelivery));
        await refreshPending();
        return;
      }

      setRelayStatus(
        relayDelivery.last_status && relayDelivery.last_status > 0
          ? relayAttemptDuration >= 2_500
            ? "slow"
            : "connected"
          : relayAttemptDuration >= 2_500
            ? "slow"
            : "unavailable",
      );
      const relayIssue = relayDelivery.state === "blocked"
        ? teacherSessionDeliveryMessage(relayDelivery)
        : null;

      const cloudStartInit = {
        method: "POST" as const,
        body: {
          class_id: classId,
          subject_id: subjectId,
          period_id: verifiedPeriod.id,
          expected_minutes: effectiveDuration,
          actual_call_at: actualCallAtISO,
          client_session_id: clientSessionId,
          operation_id: operationId,
        },
      };
      const cloudStartOptions = {
        operationId,
        mergeKey: `session-start:${attemptKey}`,
        meta: {
          operationType: "session-start",
          clientSessionId,
          institutionId,
          classId,
          periodId: verifiedPeriod.id,
          subjectId,
        },
        timeoutMs: 6_000,
      };
      const queueCloudStartForRetry = async () => {
        await offlineMutateJson(
          "/api/class/sessions/start",
          cloudStartInit,
          { ...cloudStartOptions, queueOnly: true },
        );
        await refreshPending();
      };
      const cloudResult = await offlineMutateJson<{
        item?: OpenSession & {
          period_id?: string | null;
          operation_id?: string | null;
          server_time?: string | null;
        };
      }>(
        "/api/class/sessions/start",
        cloudStartInit,
        cloudStartOptions,
      );

      if (cloudResult.ok === true) {
        const cloudItem = cloudResult.data?.item;
        if (!cloudItem?.id) {
          setCloudStatus("connected");
          await queueCloudStartForRetry();
          setSessionRuntimeState("open_local_pending");
          setMsg(
            "Le Cloud a répondu sans confirmer l'identifiant. L'appel reste sécurisé sur ce téléphone et sera rejoué avec le même identifiant.",
          );
          return;
        }
        if (
          String(cloudItem.operation_id || "") !== operationId
        ) {
          setCloudStatus("connected");
          await queueCloudStartForRetry();
          setSessionRuntimeState("open_local_pending");
          setMsg(
            "Le Cloud n’a pas confirmé le même identifiant d’ouverture. L’appel reste sécurisé localement et aucune séance différente ne sera acceptée.",
          );
          return;
        }
        if (
          String(cloudItem.class_id || "") !== classId ||
          String(cloudItem.subject_id || "") !== subjectId
        ) {
          setCloudStatus("connected");
          await queueCloudStartForRetry();
          setSessionRuntimeState("open_local_pending");
          setMsg(
            "Réponse Cloud incohérente. L'appel reste sécurisé sur ce téléphone ; aucune seconde séance ne sera créée.",
          );
          return;
        }

        const cloudCorrectedPeriod = Boolean(
          cloudItem.period_id &&
            String(cloudItem.period_id) !== String(verifiedPeriod.id),
        );
        relayClockRef.current = captureLiveCloudClock(
          cloudItem.server_time,
        );
        const cloudOpen: OpenSession = {
          ...pendingOpen,
          ...cloudItem,
          institution_id: institutionId,
          actor_profile_id: actorProfileId,
          class_id: classId,
          class_label: cloudItem.class_label || pendingOpen.class_label,
          subject_id: subjectId,
          subject_name: cloudItem.subject_name || pendingOpen.subject_name,
          started_at: cloudItem.started_at || pendingOpen.started_at,
          actual_call_at:
            cloudItem.actual_call_at || pendingOpen.actual_call_at,
          expected_minutes:
            cloudItem.expected_minutes ?? effectiveDuration,
          local_relay: false,
          delivery_origin: "cloud_fallback",
          open_operation_id: operationId,
          period_id: cloudItem.period_id || verifiedPeriod.id,
          session_state: cloudItem.session_state || "open",
        };
        setCloudStatus("connected");
        openRef.current = cloudOpen;
        setOpen(cloudOpen);
        setSessionRuntimeState("open_cloud_fallback");
        await cacheSet("classDevice:local-open", cloudOpen);
        await markTeacherSessionOpenedInCloud({
          institutionId,
          operationId,
          sessionId: cloudOpen.id,
          subjectId: cloudOpen.subject_id,
          startedAt: cloudOpen.started_at,
          actualCallAt: cloudOpen.actual_call_at,
        });
        setMsg(
          cloudCorrectedPeriod
            ? "Le Cloud a recalé le créneau avec son heure serveur. L'appel continue normalement."
            : relayIssue
              ? "Le relais n'a pas confirmé l'ouverture, mais le Cloud l'a sécurisée."
              : "Relais local indisponible. L'appel continue via le Cloud.",
        );
        if (cloudCorrectedPeriod) setNowTick(Date.now());
        await refreshPending();
        return;
      }

      if (cloudResult.ok === false && cloudResult.queued) {
        const cloudNetworkUnavailable =
          cloudResult.offline ||
          cloudResult.status === 0 ||
          cloudResult.status >= 500;
        setCloudStatus(
          cloudNetworkUnavailable ? "unavailable" : "connected",
        );
        setSessionRuntimeState("open_local_pending");
        setMsg(
          relayIssue
            ? `${relayIssue} L'appel reste sécurisé sur ce téléphone et le Cloud sera réessayé automatiquement.`
            : cloudResult.status === 401
              ? "La session Cloud doit être renouvelée. L'appel reste sécurisé sur ce téléphone et sera synchronisé automatiquement."
              : "Relais et Internet indisponibles. L'appel est sécurisé sur ce téléphone et sera synchronisé automatiquement.",
        );
        await refreshPending();
        return;
      }

      // Une réponse métier explicite du Cloud reste bloquante : le mode hors ligne
      // ne doit jamais contourner une règle d'autorisation ou de cohérence.
      setCloudStatus("connected");
      openRef.current = null;
      setOpen(null);
      await cacheSet("classDevice:local-open", null);
      setSessionRuntimeState("recoverable_error");
      setMsg(
        cloudResult.ok === false && cloudResult.error
          ? cloudResult.error
          : "Le Cloud a refusé l'ouverture pour une règle métier. Vérifiez la classe, la matière ou l'autorisation de l'appareil.",
      );
    } catch (e: any) {
      if (openRef.current?.open_operation_id) {
        setSessionRuntimeState("open_local_pending");
        setMsg(
          `L'appel reste sécurisé sur ce téléphone. ${e?.message || "La réplication réseau sera réessayée automatiquement."}`,
        );
        await refreshPending().catch(() => 0);
      } else {
        setSessionRuntimeState("recoverable_error");
        setMsg(e?.message || "Impossible de sécuriser le démarrage sur cet appareil.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    const cur = openRef.current;
    if (!cur) return;

    const finalMarksPreview = attendanceMarksFromRows(rows);
    const absentCount = finalMarksPreview.filter((mark) => mark.status === "absent").length;
    const lateCount = finalMarksPreview.filter((mark) => mark.status === "late").length;
    const confirmed = typeof window === "undefined" || window.confirm(
      `Terminer cette séance ?\n\nAbsents : ${absentCount}\nRetards : ${lateCount}\n\n` +
      "L’appel sera enregistré avant la fermeture. L’heure réelle capturée sur cet appareil sera conservée pendant la synchronisation.",
    );
    if (!confirmed) return;

    setBusy(true);
    setSessionRuntimeState("closing");
    setMsg(null);

    const finishLocal = async (input: {
      actualEndAt: string;
      relayState: "relay_confirmed" | "cloud_confirmed" | "device_pending";
      message: string;
    }) => {
      let preparedSchedule = relayClassScheduleRef.current;
      if (
        selectedClass?.institution_id &&
        selectedClass.id &&
        selectedClass.actor_profile_id
      ) {
        preparedSchedule = await getClassDeviceCoherentSchedule({
          institutionId: selectedClass.institution_id,
          classId: selectedClass.id,
          actorProfileId: selectedClass.actor_profile_id,
        }).catch(() => preparedSchedule);
      }
      const sourcePeriods = preparedSchedule && selectedClass
        ? periodsFromRelayClassSchedule(
            preparedSchedule,
            selectedClass.id,
          )
        : periodsByDay;
      if (preparedSchedule) {
        relayClassScheduleRef.current = preparedSchedule;
        setRelayClassSchedule(preparedSchedule);
        setPeriodsByDay(sourcePeriods);
      }
      const completion: ClassDeviceCompletion = {
        version: 1,
        institution_id:
          selectedClass?.institution_id || cur.institution_id || "",
        class_id: cur.class_id,
        class_label: cur.class_label,
        session_id: cur.id,
        open_operation_id: cur.open_operation_id || null,
        subject_id: cur.subject_id || null,
        subject_name: cur.subject_name || null,
        started_at: cur.started_at,
        period_id: cur.period_id || null,
        planned_range: buildPlannedRangeLabel(
          cur.started_at,
          cur.expected_minutes ??
            duration ??
            inst.default_session_minutes ??
            60,
        ),
        ended_at: input.actualEndAt,
        absent_count: absentCount,
        late_count: lateCount,
        relay_state: input.relayState,
      };
      await Promise.all([
        cacheSet("classDevice:local-open", null),
        cacheSet("classDevice:open-session", { item: null }),
        cacheSet(LAST_COMPLETION_KEY, completion),
      ]);
      saveClassDeviceSnapshot<ClassPageSnapshotState>(cur.class_id, {
        classId: cur.class_id,
        subjectId: "",
        open: null,
        rows: {},
        penaltyOpen: false,
        penRubric,
        penRows: {},
        msg: input.message,
      });
      clearReminderLoop();
      setSubjects([]);
      setSubjectScheduleIssue(null);
      subjectSelectionSlotRef.current = "";
      setOpen(null);
      setRoster([]);
      setRows({});
      setPenaltyOpen(false);
      setPenRows({});
      setSubjectId("");
      pendingSnapshotSubjectRef.current = "";
      setLastCompletion(completion);
      setSessionRuntimeState(
        input.relayState === "device_pending"
          ? "closed_pending_sync"
          : "closed_synced",
      );
      setMsg(input.message);
      const currentMs = Date.now();
      computeDefaultsForNow(sourcePeriods, currentMs);
      setNowTick(currentMs);
      void refreshClassScheduleFromRelay(selectedClass).then(() => {
        setNowTick(Date.now());
      });
    };

    const queueCloudFallbackForRelaySession = async (input: {
      institutionId: string;
      periodId: string;
      marks: ReturnType<typeof attendanceMarksFromRows>;
      attendanceOperationId: string | null;
      attendanceCapturedAt: string;
      closeOperationId: string;
      actualEndAt: string;
    }) => {
      const openOperationId = String(cur.open_operation_id || "").trim();
      const subjectId = String(cur.subject_id || "").trim();
      if (!openOperationId || !subjectId) return false;

      const clientSessionId = `client:${openOperationId}`;
      await offlineMutateJson(
        "/api/class/sessions/start",
        {
          method: "POST",
          body: {
            class_id: cur.class_id,
            subject_id: subjectId,
            period_id: input.periodId,
            expected_minutes:
              cur.expected_minutes ??
              duration ??
              inst.default_session_minutes ??
              60,
            actual_call_at: cur.actual_call_at || cur.started_at,
            client_session_id: clientSessionId,
            operation_id: openOperationId,
          },
        },
        {
          operationId: openOperationId,
          mergeKey: `session-start:${openOperationId}`,
          queueOnly: true,
          meta: {
            operationType: "session-start",
            clientSessionId,
            institutionId: input.institutionId,
            classId: cur.class_id,
            subjectId,
            periodId: input.periodId,
          },
        },
      );

      if (input.marks.length > 0 && input.attendanceOperationId) {
        await offlineMutateJson(
          "/api/teacher/attendance/bulk",
          {
            method: "POST",
            body: {
              session_id: clientSessionId,
              captured_at_device: input.attendanceCapturedAt,
              marks: input.marks,
            },
          },
          {
            operationId: input.attendanceOperationId,
            mergeKey: `attendance:${clientSessionId}`,
            queueOnly: true,
            meta: {
              operationType: "attendance",
              clientSessionId,
              institutionId: input.institutionId,
              classId: cur.class_id,
              subjectId,
              periodId: input.periodId,
            },
          },
        );
      }

      await offlineMutateJson(
        "/api/class/sessions/end",
        {
          method: "PATCH",
          body: {
            session_id: clientSessionId,
            actual_end_at: input.actualEndAt,
          },
        },
        {
          operationId: input.closeOperationId,
          mergeKey: `end:${clientSessionId}`,
          queueOnly: true,
          meta: {
            operationType: "session-end",
            clientSessionId,
            institutionId: input.institutionId,
            classId: cur.class_id,
            subjectId,
            periodId: input.periodId,
          },
        },
      );
      return true;
    };

    try {
      let openId = String(cur.id || "");
      const isClientLocal = isClientSessionId(openId);
      const actualEndAt = observedNowIso();
      // Même instant métier pour tous les chemins (téléphone, relais, Cloud/outbox).
      const attendanceCapturedAt = actualEndAt;

      if (cur.local_relay) {
        const relayPolicy = selectedClass?.attendance_presence;
        const periodId = cur.period_id || null;
        const sessionInstitutionId =
          selectedClass?.institution_id || cur.institution_id || "";
        const sessionActorProfileId =
          selectedClass?.actor_profile_id || cur.actor_profile_id || "";
        if (!sessionInstitutionId || !sessionActorProfileId || !periodId) {
          setMsg("La séance reste ouverte : la préparation locale de cette classe doit être actualisée.");
          return;
        }
        const marks = attendanceMarksFromRows(rows);
        let attendanceOperationId: string | null = null;
        let attendanceSecured = marks.length === 0;
        let attendanceNeedsAttention = false;
        if (marks.length > 0) {
          const attendance = await deliverTeacherAttendance({
            institutionId: sessionInstitutionId,
            actorProfileId: sessionActorProfileId,
            sessionId: cur.id,
            classId: cur.class_id,
            periodId,
            marks,
            relayBaseUrl: relayPolicy?.relay_local_url,
            relayAccessToken: relayPolicy?.relay_access_token,
            forceRelay: true,
            capturedAtDevice: attendanceCapturedAt,
          });
          attendanceOperationId = attendance.operation_id;
          attendanceSecured =
            attendance.state === "relay_secured" ||
            attendance.state === "cloud_synced";
          attendanceNeedsAttention =
            attendance.state === "blocked" ||
            attendance.state === "conflict" ||
            attendance.state === "delivery_unknown";
        }
        const closed = attendanceSecured
          ? await closeTeacherAttendanceSessionOnRelay({
              institutionId: sessionInstitutionId,
              sessionId: cur.id,
              classId: cur.class_id,
              attendanceOperationId,
              relayBaseUrl: relayPolicy?.relay_local_url,
              relayAccessToken: relayPolicy?.relay_access_token,
            })
          : await stageTeacherAttendanceSessionClose({
              institutionId: sessionInstitutionId,
              sessionId: cur.id,
              classId: cur.class_id,
              attendanceOperationId,
            });
        const relayConfirmed = closed.state === "relay_confirmed";
        const cloudFallbackQueued = relayConfirmed
          ? false
          : await queueCloudFallbackForRelaySession({
              institutionId: sessionInstitutionId,
              periodId,
              marks,
              attendanceOperationId,
              attendanceCapturedAt,
              closeOperationId: closed.operation_id,
              actualEndAt,
            });
        const message = relayConfirmed
          ? `Appel enregistré et séance terminée. ${teacherSessionLifecycleDeliveryMessage(closed)}`
          : attendanceNeedsAttention || closed.state === "blocked"
            ? "Appel et fin conservés sur cet appareil. Une vérification est requise, mais le cours suivant peut commencer."
            : cloudFallbackQueued
              ? "Appel et fin conservés sur cet appareil. Le relais ou le Cloud les synchronisera dans le bon ordre ; le cours suivant peut commencer."
              : "Appel et fin conservés sur cet appareil. Le relais sera réessayé automatiquement ; le cours suivant peut commencer.";
        await finishLocal({
          actualEndAt,
          relayState: relayConfirmed
            ? "relay_confirmed"
            : "device_pending",
          message,
        });
        await refreshPending();
        return;
      }

      // ✅ Si séance locale et en ligne : essayer de sync + récupérer la vraie séance serveur
      if (isClientLocal && isOnline) {
        const ensured = await ensureServerSessionOrExplain();
        if (ensured) {
          openId = String(ensured.id);
        } else {
          const pendingMarks = attendanceMarksFromRows(rows);
          if (pendingMarks.length > 0) {
            await offlineMutateJson(
              "/api/teacher/attendance/bulk",
              {
                method: "POST",
                body: {
                  session_id: openId,
                  captured_at_device: attendanceCapturedAt,
                  marks: pendingMarks,
                },
              },
              {
                mergeKey: `attendance:${openId}`,
                queueOnly: true,
                meta: {
                  operationType: "attendance",
                  clientSessionId: openId,
                  institutionId:
                    selectedClass?.institution_id || cur.institution_id || "",
                  classId: cur.class_id,
                  subjectId: cur.subject_id || null,
                  periodId: cur.period_id || null,
                },
              },
            );
          }
          // L'ordre monotone de l'outbox garantit ouverture → présences → fermeture.
          // Chaque cours garde sa propre fermeture : aucun marqueur unique ne peut être écrasé
          // par le cours suivant.
          await offlineMutateJson(
            "/api/class/sessions/end",
            {
              method: "PATCH",
              body: { session_id: openId, actual_end_at: actualEndAt },
            },
            {
              mergeKey: `end:${openId}`,
              queueOnly: true,
              meta: {
                operationType: "session-end",
                clientSessionId: openId,
                institutionId:
                  selectedClass?.institution_id || cur.institution_id || "",
                classId: cur.class_id,
                subjectId: cur.subject_id || null,
                periodId: cur.period_id || null,
              },
            },
          );
          await finishLocal({
            actualEndAt,
            relayState: "device_pending",
            message:
              "Séance terminée sur ce téléphone. L’appel et la fermeture sont en attente de synchronisation ; le cours suivant peut commencer.",
          });
          await refreshPending();
          return;
        }
      }

      const finalMarks = attendanceMarksFromRows(rows);
      if (finalMarks.length > 0) {
        const attendance = await offlineMutateJson(
          "/api/teacher/attendance/bulk",
          {
            method: "POST",
            body: {
              session_id: openId,
              captured_at_device: attendanceCapturedAt,
              marks: finalMarks,
            },
          },
          {
            mergeKey: `attendance:${openId}`,
            meta: {
              operationType: "attendance",
              clientSessionId: openId,
              institutionId:
                selectedClass?.institution_id || cur.institution_id || "",
              classId: cur.class_id,
              subjectId: cur.subject_id || null,
              periodId: cur.period_id || null,
            },
          },
        );
        if (!(attendance as any).ok && !shouldTreatAsOffline(attendance)) {
          const err = extractRespError(attendance);
          setMsg(
            err
              ? `La séance reste ouverte : ${err}`
              : "La séance reste ouverte : l’appel final n’a pas été enregistré.",
          );
          return;
        }
        if (!(attendance as any).ok && shouldTreatAsOffline(attendance)) {
          await offlineMutateJson(
            "/api/class/sessions/end",
            {
              method: "PATCH",
              body: {
                session_id: openId,
                actual_end_at: actualEndAt,
              },
            },
            {
              mergeKey: `end:${openId}`,
              queueOnly: true,
              meta: {
                operationType: "session-end",
                clientSessionId: openId,
                institutionId:
                  selectedClass?.institution_id || cur.institution_id || "",
                classId: cur.class_id,
                subjectId: cur.subject_id || null,
                periodId: cur.period_id || null,
              },
            },
          );
          await finishLocal({
            actualEndAt,
            relayState: "device_pending",
            message:
              "Appel et fin conservés sur ce téléphone. La fermeture attendra la confirmation de l’appel avant d’être synchronisée.",
          });
          await refreshPending();
          return;
        }
      }

      // ✅ On envoie toujours session_id + actual_end_at pour garder l'heure réelle de fin.
      const r = await offlineMutateJson(
        "/api/class/sessions/end",
        {
          method: "PATCH",
          body: {
            session_id: openId,
            actual_end_at: actualEndAt,
          },
        },
        {
          mergeKey: `end:${openId}`,
          meta: {
            operationType: "session-end",
            clientSessionId: openId,
            institutionId:
              selectedClass?.institution_id || cur.institution_id || "",
            classId: cur.class_id,
            subjectId: cur.subject_id || null,
            periodId: cur.period_id || null,
          },
        },
      );

      if ((r as any).ok) {
        await finishLocal({
          actualEndAt,
          relayState: "cloud_confirmed",
          message: "Séance terminée et confirmée par le Cloud.",
        });
        await refreshPending();
      } else if (shouldTreatAsOffline(r)) {
        await finishLocal({
          actualEndAt,
          relayState: "device_pending",
          message:
            "Hors connexion : fin de séance mise en attente (sync auto).",
        });
        await refreshPending();
      } else {
        const err = extractRespError(r);
        setMsg(err ? `Erreur serveur : ${err}` : "Erreur serveur : impossible de terminer la séance.");
      }
    } catch (e: any) {
      setSessionRuntimeState("recoverable_error");
      setMsg(e?.message || "Échec fin de séance");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (loggingOut) return;

    let remaining = await countPendingForCurrentClass();

    if (remaining > 0) {
      setMsg("Tentative de sécurisation des données avant déconnexion…");
      try {
        if (
          typeof navigator === "undefined" ||
          navigator.onLine !== false
        ) {
          await flushOutbox();
        }
        const relay = selectedClass?.attendance_presence;
        if (
          selectedClass?.institution_id &&
          selectedClass.id &&
          selectedClass.actor_profile_id &&
          relay?.relay_local_url &&
          relay.relay_access_token
        ) {
          await recoverClassDeviceAttendance({
            institutionId: selectedClass.institution_id,
            classId: selectedClass.id,
            actorProfileId: selectedClass.actor_profile_id,
            relayBaseUrl: relay.relay_local_url,
            relayAccessToken: relay.relay_access_token,
          });
        }
      } catch {}
      remaining = await countPendingForCurrentClass();
      setPendingSync(remaining);
    }

    if (remaining > 0) {
      const discard = window.confirm(
        `ATTENTION : ${remaining} action(s) ne sont pas encore synchronisées.\n\n` +
          "OK = se déconnecter en conservant ces données sur cet appareil.\n" +
          "Annuler = rester connecté pour tenter une synchronisation maintenant."
      );
      if (!discard) {
        setMsg(
          `${remaining} action(s) conservées sur cet appareil. Rejoignez le réseau local du relais puis appuyez sur Sync.`
        );
        return;
      }
    }

    setLoggingOut(true);
    clearReminderLoop();
    try {
      // 1) Déconnexion Supabase côté navigateur
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch (e: any) {
        console.warn("[class/logout] supabase signOut:", e?.message || e);
      }

      // 2) Nettoyage des cookies HttpOnly (sb-access/refresh, sb-*-auth-token)
      try {
        await fetch("/api/auth/sync", { method: "DELETE" });
      } catch (e: any) {
        console.warn("[class/logout] /api/auth/sync DELETE:", e?.message || e);
      }

      // 3) Endpoints legacy éventuels
      const endpoints = ["/api/auth/signout", "/api/auth/logout", "/auth/signout"];
      for (const url of endpoints) {
        try {
          await fetch(url, { method: "POST", cache: "no-store" });
        } catch {
          /* ignore */
        }
      }
    } finally {
      // La session active est fermée, mais la préparation de la classe, les
      // opérations en attente et le grant appareil restent disponibles.
      await clearActiveOfflineAccess().catch(() => {});

      // 4) Retour écran de connexion global
      window.location.href = "/login";
    }
  }

  const openIsClient = !!open?.id && isClientSessionId(open.id);
  const openPlannedRange = open
    ? buildPlannedRangeLabel(
        open.started_at,
        open.expected_minutes ?? duration ?? inst.default_session_minutes ?? 60
      )
    : "—";
  const openActualStart = open?.actual_call_at ? formatTimeLabel(open.actual_call_at) : null;
  const connectivityLabel = (status: ConnectivityState) =>
    status === "connected"
      ? "connecté"
      : status === "slow"
        ? "lent"
        : status === "unavailable"
          ? "indisponible"
          : "vérification";
  const connectivityTone = (status: ConnectivityState) =>
    status === "connected"
      ? "bg-emerald-500/20 text-emerald-100"
      : status === "slow"
        ? "bg-amber-500/20 text-amber-100"
        : status === "unavailable"
          ? "bg-rose-500/20 text-rose-100"
          : "bg-slate-500/30 text-slate-100";
  const callSyncLabel =
    syncing
      ? "synchronisation"
      : sessionRuntimeState === "open_local_pending" ||
          sessionRuntimeState === "closed_pending_sync" ||
          pendingSync > 0
        ? "en attente"
        : sessionRuntimeState === "recoverable_error"
          ? "à vérifier"
          : "synchronisé";
  const callSyncTone =
    callSyncLabel === "synchronisé"
      ? "bg-emerald-500/20 text-emerald-100"
      : callSyncLabel === "à vérifier"
        ? "bg-rose-500/20 text-rose-100"
        : "bg-amber-500/20 text-amber-100";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Header compact avec établissement + année scolaire */}
      <header className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-900 to-slate-950 px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-200/80">
              {inst.institution_name || DEFAULT_INSTITUTION_NAME}
            </p>
            {inst.academic_year_label && (
              <p className="text-[11px] font-medium text-indigo-100/80">
                Année scolaire {inst.academic_year_label}
              </p>
            )}
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Téléphone de classe — Appel
            </h1>
            <p className="mt-1 max-w-xl text-xs sm:text-sm text-indigo-100/85">
              Mode simplifié pour appeler la classe et enregistrer retards et sanctions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                connectivityTone(cloudStatus),
              ].join(" ")}
              title="Disponibilité réelle du service Cloud"
            >
              Cloud : {connectivityLabel(cloudStatus)}
            </span>
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                connectivityTone(relayStatus),
              ].join(" ")}
              title="Disponibilité réelle du relais local"
            >
              Relais local : {connectivityLabel(relayStatus)}
            </span>
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                callSyncTone,
              ].join(" ")}
              title="État de conservation et de synchronisation de l’appel"
            >
              Appel : {callSyncLabel}
            </span>

            <button
              onClick={() => void syncNow()}
              disabled={syncing || pendingSync === 0}
              className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/90 hover:bg-white/10 disabled:opacity-50"
              title="Réessayer le relais local et, si Internet est disponible, le Cloud"
            >
              {syncing ? "Sync..." : `Sync (${pendingSync})`}
            </button>

            {/* Bouton déconnexion or, très visible */}
            <GhostButton
              tone="slate"
              onClick={logout}
              disabled={loggingOut}
              aria-busy={loggingOut}
              className="shrink-0 rounded-full border-amber-400 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-md hover:shadow-lg hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 focus:ring-amber-400/40 disabled:cursor-wait disabled:opacity-80"
            >
              {loggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {loggingOut ? "Déconnexion..." : "Se déconnecter"}
            </GhostButton>
          </div>
        </div>
      </header>

      <OfflineReadinessCard
        role="class-device"
        classDeviceContext={{
          institutionId: selectedClass?.institution_id,
          classId: selectedClass?.id,
          actorProfileId: selectedClass?.actor_profile_id,
          relayBaseUrl:
            selectedClass?.attendance_presence?.relay_local_url,
          relayAccessToken:
            selectedClass?.attendance_presence?.relay_access_token,
        }}
        onPrepared={refreshClassContextAfterPreparation}
      />
      {(subjectScheduleIssue || relayScheduleIssue) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          {subjectScheduleIssue || relayScheduleIssue}
        </div>
      )}
      {!open &&
        lastCompletion &&
        (!classId || lastCompletion.class_id === classId) && (
          <div
            className={[
              "rounded-2xl border px-4 py-3 text-sm",
              lastCompletion.relay_state !== "device_pending"
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-amber-200 bg-amber-50 text-amber-950",
            ].join(" ")}
            aria-live="polite"
          >
            <div className="font-semibold">
              Séance précédente terminée — {lastCompletion.class_label}
              {lastCompletion.subject_name
                ? ` • ${lastCompletion.subject_name}`
                : ""}
              {" • "}
              {lastCompletion.planned_range}
            </div>
            <div className="mt-1 text-xs">
              Fin enregistrée à {formatTimeLabel(lastCompletion.ended_at)} •
              {" "}
              {lastCompletion.absent_count} absent(s) •
              {" "}
              {lastCompletion.late_count} retard(s).
              {" "}
              {lastCompletion.relay_state === "relay_confirmed"
                ? "Le relais local a confirmé la fermeture."
                : lastCompletion.relay_state === "cloud_confirmed"
                  ? "Le Cloud a confirmé l’appel et la fermeture sans modifier leurs heures originales."
                  : "L’appareil conserve l’appel et réessaiera le relais ou le Cloud automatiquement."}
            </div>
          </div>
        )}

      {/* Sélection */}
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-5 space-y-4 ring-1 ring-emerald-100">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <Users className="h-3.5 w-3.5" />
              Classe
            </div>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.length === 0 ? <option value="">— Aucune —</option> : null}
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {hasNonGeneralClasses &&
                  String(c.education_type || "general_secondary") !==
                    "general_secondary"
                    ? `${c.label} — ${c.education_short_label || "Autre"}`
                    : c.label}
                </option>
              ))}
            </Select>
            {selectedClass &&
              String(
                selectedClass.education_type || "general_secondary",
              ) !== "general_secondary" && (
                <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                  <div className="font-semibold">
                    {selectedClass.education_label ||
                      "Autre enseignement"}
                  </div>
                  <div className="mt-0.5">
                    {selectedClass.education_context_label ||
                      [
                        selectedClass.formation_label,
                        selectedClass.formation_level_label,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                  </div>
                </div>
              )}
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <BookOpen className="h-3.5 w-3.5" />
              Discipline
            </div>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!!open || subjects.length === 0}>
              {subjects.length === 0 ? (
                <option value="">
                  {isOnline
                    ? activeConfiguredSlot
                      ? "— Aucune discipline disponible —"
                      : "— Hors créneau —"
                    : subjectLoadMode === "auto-offline"
                      ? "— Aucun cours prévu —"
                      : "— Aucun cours vérifié pour ce créneau —"}
                </option>
              ) : null}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                Début
              </div>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={locked}
              />
              <div className="mt-1 text-[11px] text-slate-500">{slotLabel}</div>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                Durée (min)
              </div>
              <Select
                value={String(duration)}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                disabled={locked}
              >
                {[duration].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
              <div className="mt-1 text-[11px] text-slate-500">Verrouillée par l’établissement.</div>
            </div>
          </div>
        </div>

        {scheduleBlocked && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            Hors créneau : l’appel reste bloqué tant qu’aucun créneau administratif n’est ouvert.
          </div>
        )}

        {usingLegacyOfflineMode && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Ancien cache consultable hors connexion. Il ne peut pas autoriser
            l’ouverture d’un appel sans préparation v5 cohérente.
          </div>
        )}

        {usingLegacyFallbackMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Données legacy affichées en secours uniquement. Actualisez le
            planning vérifié avant de démarrer l’appel.
          </div>
        )}

        {noScheduledSubjectNow && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Aucune discipline n’a pu être positionnée automatiquement pour cette classe dans le créneau en cours.
          </div>
        )}

        {openIsClient && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Séance en attente de synchronisation (ID local). Appuyez sur <b>Sync</b> dès que le Wi-Fi est stable.
          </div>
        )}

        {open && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            Les coches sont conservées automatiquement sur l’appareil. « Terminer l’appel » enregistre l’état final puis ferme la séance.
          </div>
        )}

        {/* Actions */}
        {!open ? (
          <div className="flex items-center gap-2">
            <Button onClick={startSession} disabled={!classId || !subjectId || busy || !canStartAttendanceNow}>
              <Play className="h-4 w-4" />
              {busy ? "Démarrage…" : "Démarrer l’appel"}
            </Button>
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!classId && !penaltyOpen)}
            >
              Sanctions
            </GhostButton>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!classId && !penaltyOpen)}
            >
              Sanctions
            </GhostButton>
            <Button onClick={() => void endSession()} disabled={busy}>
              <Square className="h-4 w-4" />
              {busy
                ? "Enregistrement et fermeture…"
                : `Terminer l’appel${changedCount ? ` (${changedCount})` : ""}`}
            </Button>
          </div>
        )}

        {msg && (
          <div className="text-sm text-slate-700" aria-live="polite">
            {msg}
          </div>
        )}
      </div>

      {/* ───────── Bloc Sanctions (téléphone de classe) ───────── */}
      {penaltyOpen && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-lg font-semibold">Autres sanctions</div>
              <div className="text-xs text-slate-500">
                Rubriques : Discipline, Tenue, Moralité. Les maxima viennent des{" "}
                <b>règles de conduite de l’établissement</b>. L’assiduité est calculée via les absences.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GhostButton onClick={resetPenRows} disabled={penBusy}>
                Remettre tous les points à 0
              </GhostButton>
              <GhostButton tone="red" onClick={() => setPenaltyOpen(false)} disabled={penBusy}>
                Fermer
              </GhostButton>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 mb-3">
            <div className="md:col-span-1">
              <div className="mb-1 text-xs text-slate-500">Rubrique impactée</div>
              <Select
                value={penRubric}
                onChange={(e) => setPenRubric(coerceRubric(e.target.value))}
                disabled={penBusy || rubricOptions.every((o) => o.disabled)}
              >
                {rubricOptions.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-2 flex items-end justify-end">
              <Button onClick={submitClassPenalties} disabled={penBusy || !hasPenChanges || rubricDisabled}>
                {penBusy ? "Enregistrement…" : "Enregistrer les sanctions"}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2 w-12">N°</th>
                  <th className="px-3 py-2 w-40">Matricule</th>
                  <th className="px-3 py-2">Nom et prénoms</th>
                  <th className="px-3 py-2 w-28">Points (−)</th>
                  <th className="px-3 py-2">Motif (facultatif)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingRoster ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      Chargement de la liste…
                    </td>
                  </tr>
                ) : !(open?.class_id || classId) ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      Sélectionnez une classe/discipline pour saisir des sanctions.
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      Aucun élève dans cette classe.
                    </td>
                  </tr>
                ) : (
                  roster.map((st, idx) => {
                    const pr = penRows[st.id] || { points: 0, reason: "" };
                    return (
                      <tr key={st.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{st.matricule ?? ""}</td>
                        <td className="px-3 py-2">{st.full_name}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={currentRubricMax && currentRubricMax > 0 ? currentRubricMax : undefined}
                            value={pr.points || 0}
                            onChange={(e) => setPenPoint(st.id, parseInt(e.target.value || "0", 10))}
                            className="w-24"
                            aria-label={`Points à retrancher: ${st.full_name}`}
                            disabled={penBusy || rubricDisabled}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            placeholder="(optionnel)"
                            value={pr.reason || ""}
                            onChange={(e) => setPenReason(st.id, e.target.value)}
                            aria-label={`Motif: ${st.full_name}`}
                            disabled={penBusy}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {penMsg && (
            <div className="mt-3 text-sm text-slate-700" aria-live="polite">
              {penMsg}
            </div>
          )}
        </div>
      )}

      {/* Liste élèves (appel) */}
      {open && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 space-y-1">
            <div className="text-sm font-semibold text-slate-700">
              Appel — {open.class_label} {open.subject_name ? `• ${open.subject_name}` : ""} •{" "}
              {openPlannedRange}
              {openIsClient ? " • (en attente de sync)" : ""}
            </div>
            {String(open.education_type || "general_secondary") !==
              "general_secondary" && (
              <div className="text-xs font-medium text-indigo-700">
                {open.education_context_label ||
                  [
                    open.formation_label,
                    open.formation_level_label,
                  ]
                    .filter(Boolean)
                    .join(" • ") ||
                  open.education_label}
              </div>
            )}
            <div className="text-xs text-slate-500">
              Début réel : {openActualStart || "—"}
            </div>
            {reminderHint && (
              <div className="text-xs font-medium text-amber-700">
                Rappel sonore actif — {reminderHint}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2 w-12">N°</th>
                  <th className="px-3 py-2 w-40">Matricule</th>
                  <th className="px-3 py-2">Nom et prénoms</th>
                  <th className="px-3 py-2">Absent</th>
                  <th className="px-3 py-2">Retard</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingRoster ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      Chargement de la liste…
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      {isOnline
                        ? "Aucun élève."
                        : "Aucun élève en cache pour cette classe. Ouvrez une fois la classe en ligne pour rendre la liste disponible hors connexion."}
                    </td>
                  </tr>
                ) : (
                  roster.map((st, idx) => {
                    const r = rows[st.id] || {};
                    return (
                      <tr key={st.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{st.matricule ?? ""}</td>
                        <td className="px-3 py-2">{st.full_name}</td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-red-600"
                            checked={!!r.absent}
                            onChange={(e) => toggleAbsent(st.id, e.target.checked)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-amber-600"
                            checked={!!r.late}
                            onChange={(e) => toggleLate(st.id, e.target.checked)}
                            disabled={!!r.absent}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
