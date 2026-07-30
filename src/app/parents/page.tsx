"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MON_CAHIER_SW_URL } from "@/lib/offline";

const LOGOUT_PARENTS = "/parents/logout";

type PrimaryScreen = "home" | "children" | "attach" | "messages";
type ChildScreen =
  | "child"
  | "absences"
  | "notes"
  | "textbook"
  | "bulletins"
  | "timetable"
  | "sanctions";
type Screen = PrimaryScreen | ChildScreen;

type Kid = {
  id: string;
  full_name: string;
  class_label: string | null;
  matricule?: string | null;
  institution_id?: string | null;
};

type AttendanceEvent = {
  id: string;
  when: string;
  expected_minutes?: number | null;
  type: "absent" | "late";
  minutes_late?: number | null;
  class_label?: string | null;
  subject_name?: string | null;
};

type KidPenalty = {
  id: string;
  when: string;
  rubric: "discipline" | "tenue" | "moralite";
  points: number;
  reason?: string | null;
  class_label?: string | null;
  subject_name?: string | null;
  author_subject_name?: string | null;
  author_name?: string | null;
  author_role_label?: string | null;
};

type Conduct = {
  breakdown: {
    assiduite: number;
    tenue: number;
    moralite: number;
    discipline: number;
  };
  total: number;
  appreciation: string;
  rubric_max: {
    assiduite: number;
    tenue: number;
    moralite: number;
    discipline: number;
  };
};

type KidGradeRow = {
  id: string;
  eval_date: string;
  eval_kind: "devoir" | "interro_ecrite" | "interro_orale";
  scale: number;
  coeff: number;
  title?: string | null;
  score: number | null;
  subject_name?: string | null;
  subject_id?: string | null;
};

type GradePeriod = {
  id: string;
  institution_id: string;
  academic_year: string;
  code: string | null;
  label: string;
  short_label: string;
  start_date: string | null;
  end_date: string | null;
  order_index: number;
};

type ParentBulletin = {
  code: string;
  url: string;
  student_id: string;
  academic_year: string | null;
  period_label: string;
  period_from: string | null;
  period_to: string | null;
  general_avg?: number | null;
  annual_avg?: number | null;
  created_at: string | null;
};

type ParentTextbookSession = {
  id: string;
  session_title: string | null;
  session_date: string | null;
  session_period_label?: string | null;
  session_start_time?: string | null;
  session_end_time?: string | null;
  duration_minutes?: number | null;
  content?: string | null;
  homework?: string | null;
  teacher_name?: string | null;
  created_at?: string | null;
};

type ParentTextbookItem = {
  id: string;
  item_type: string | null;
  title: string;
  description?: string | null;
  trimester?: string | null;
  month_label?: string | null;
  week_label?: string | null;
  planned_duration_minutes?: number | null;
  planned_sessions_count?: number | null;
  sort_order?: number | null;
  sessions?: ParentTextbookSession[];
  completion?: { status?: string | null; updated_at?: string | null } | null;
};

type ParentTextbookProgression = {
  assignment_id: string;
  class_id: string;
  class_label?: string | null;
  subject_name: string;
  teacher_name?: string | null;
  planned_total_minutes: number;
  completed_total_minutes: number;
  progress_percent: number;
  sessions_count: number;
  latest_session?: ParentTextbookSession | null;
  progression: {
    id: string;
    title: string;
    academic_year?: string | null;
    level?: string | null;
    series?: string | null;
    document?: { original_name?: string | null; signed_url?: string | null } | null;
  };
  items: ParentTextbookItem[];
};

type TimetablePeriod = {
  key: string;
  start_time: string;
  end_time: string;
  label: string;
  period_no: number;
};

type TimetableItem = {
  id: string;
  weekday: number;
  period_id: string;
  period_key: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_name: string;
};

type TimetablePayload = {
  ok?: boolean;
  class_label?: string | null;
  academic_year?: string | null;
  periods?: TimetablePeriod[];
  items?: TimetableItem[];
  error?: string;
};

type ParentNotification = {
  id: string;
  title: string | null;
  body: string | null;
  severity: string | null;
  created_at: string;
  read_at: string | null;
  status?: string | null;
  payload?: Record<string, unknown> | null;
};

type ChildData = {
  loading: boolean;
  error: string | null;
  events: AttendanceEvent[];
  penalties: KidPenalty[];
  grades: KidGradeRow[];
  conduct: Conduct | null;
  textbook: ParentTextbookProgression[];
  timetable: TimetablePayload | null;
};

type IconName =
  | "home"
  | "children"
  | "plus"
  | "message"
  | "book"
  | "notes"
  | "calendar"
  | "clock"
  | "shield"
  | "bulletin"
  | "arrow"
  | "logout"
  | "bell"
  | "chevron"
  | "refresh"
  | "wifi"
  | "check";

const EMPTY_CHILD_DATA: ChildData = {
  loading: false,
  error: null,
  events: [],
  penalties: [],
  grades: [],
  conduct: null,
  textbook: [],
  timetable: null,
};

const DAY_NAMES: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
};

const DAY_SHORT_NAMES: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Jeu",
  5: "Ven",
  6: "Sam",
};

function preferredTimetableDay(items: TimetableItem[] = []): number {
  const current = new Date().getDay();
  const today = current >= 1 && current <= 6 ? current : 1;
  if (items.some((item) => item.weekday === today)) return today;
  return items.find((item) => item.weekday >= 1 && item.weekday <= 6)?.weekday || today;
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5" />
        <path d="M9.5 20v-5.5h5V20" />
      </>
    ),
    children: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2" />
        <path d="M16 5.5a3 3 0 0 1 0 5.8" />
        <path d="M18 14a4.5 4.5 0 0 1 2.5 4v2" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    message: (
      <>
        <path d="M4 5.5h16v11H8l-4 3v-14Z" />
        <path d="M8 10h8" />
        <path d="M8 13h5" />
      </>
    ),
    book: (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2V5Z" />
        <path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2V5Z" />
      </>
    ),
    notes: (
      <>
        <path d="M6 3h12v18H6z" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 7 4v5c0 5-3.4 8.4-7 10-3.6-1.6-7-5-7-10V7l7-4Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    bulletin: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v4h4" />
        <path d="M9 11h6M9 15h6" />
      </>
    ),
    arrow: <path d="m9 18 6-6-6-6" />,
    logout: (
      <>
        <path d="M10 5H5v14h5" />
        <path d="M13 8l4 4-4 4M17 12H9" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    refresh: (
      <>
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.5 9A7 7 0 0 0 6 6l-2 3M5.5 15A7 7 0 0 0 18 18l2-3" />
      </>
    ),
    wifi: (
      <>
        <path d="M5 12.5a10 10 0 0 1 14 0" />
        <path d="M8 15.5a6 6 0 0 1 8 0" />
        <path d="M11 18.5a2 2 0 0 1 2 0" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {paths[name]}
    </svg>
  );
}

function initials(value: string) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function dateFr(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function formatAverage(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2).replace(".", ",");
}

function scoreOn20(grade: KidGradeRow) {
  if (grade.score == null) return null;
  const score = Number(grade.score);
  const scale = Number(grade.scale || 20);
  if (!Number.isFinite(score) || !Number.isFinite(scale) || scale <= 0) return null;
  return (score / scale) * 20;
}

function weightedAverage(grades: KidGradeRow[]) {
  let sum = 0;
  let weights = 0;
  for (const grade of grades) {
    const score = scoreOn20(grade);
    if (score == null) continue;
    const coeff = Math.max(1, Number(grade.coeff || 1));
    sum += score * coeff;
    weights += coeff;
  }
  return weights ? sum / weights : null;
}

function gradeKindLabel(value: KidGradeRow["eval_kind"]) {
  if (value === "devoir") return "Devoir";
  if (value === "interro_ecrite") return "Interrogation écrite";
  return "Interrogation orale";
}

function rubricLabel(value: KidPenalty["rubric"]) {
  if (value === "tenue") return "Tenue";
  if (value === "moralite") return "Moralité";
  return "Discipline";
}

function lessonTypeLabel(value?: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "revision") return "Révision";
  if (normalized === "evaluation") return "Évaluation";
  if (normalized === "remediation") return "Remédiation";
  if (normalized === "regulation") return "Régulation";
  return "Leçon";
}

function lessonTone(value?: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "revision") return "border-sky-200 bg-sky-50 text-sky-800";
  if (normalized === "evaluation") return "border-violet-200 bg-violet-50 text-violet-800";
  if (normalized === "remediation") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function notificationLabel(item: ParentNotification) {
  const payload = item.payload || {};
  const kind = String(
    payload.kind || payload.event || payload.type || payload.category || "",
  ).toLowerCase();
  if (kind.includes("finance") || kind.includes("payment")) return "Finance";
  if (kind.includes("attendance") || kind.includes("absent") || kind.includes("late")) {
    return "Absence / retard";
  }
  if (kind.includes("penalty") || kind.includes("conduct")) return "Conduite";
  if (kind.includes("grade") || kind.includes("note")) return "Note";
  return "Message";
}

function currentDateOnly() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Données indisponibles.");
  }
  return payload as T;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(safe);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function ensurePushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Les notifications push ne sont pas prises en charge sur cet appareil.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("L’autorisation de notification n’a pas été accordée.");
  }

  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register(MON_CAHIER_SW_URL, {
      scope: "/",
    });
  }
  registration = await navigator.serviceWorker.ready;

  const vapid = await fetchJson<{ key?: string }>("/api/push/vapid");
  if (!vapid.key) throw new Error("Clé de notification indisponible.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.key),
    });
  }

  await fetchJson("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: "web",
      device_id: subscription.endpoint,
      subscription: subscription.toJSON(),
    }),
  });
}

async function hasActivePushSubscription() {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  return Boolean(await registration.pushManager.getSubscription());
}

function PageLoader({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[30px] border border-slate-200 bg-white p-8 shadow-sm">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
        <div className="mt-4 text-sm font-bold text-slate-600">{label}</div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  text,
  icon = "book",
}: {
  title: string;
  text: string;
  icon?: IconName;
}) {
  return (
    <div className="rounded-[30px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon name={icon} size={26} />
      </div>
      <h3 className="mt-4 text-lg font-black text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm font-medium leading-6 text-slate-500">{text}</p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function ChildIdentity({
  kid,
  kids,
  onChange,
}: {
  kid: Kid;
  kids: Kid[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-5 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[18px] bg-[#003766] text-base font-black text-white sm:h-14 sm:w-14">
            {initials(kid.full_name)}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">Enfant sélectionné</div>
            <div className="mt-1 truncate text-xl font-black text-slate-950">{kid.full_name}</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">
              {kid.class_label || "Classe non renseignée"}
              {kid.matricule ? ` · ${kid.matricule}` : ""}
            </div>
          </div>
        </div>

        {kids.length > 1 ? (
          <label className="relative block w-full sm:w-auto sm:min-w-[230px]">
            <span className="sr-only">Changer d’enfant</span>
            <select
              value={kid.id}
              onChange={(event) => onChange(event.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-10 text-sm font-bold text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              {kids.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name} — {item.class_label || "Sans classe"}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
              <Icon name="chevron" size={18} />
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}

function ModuleCard({
  title,
  icon,
  tone,
  onClick,
}: {
  title: string;
  icon: IconName;
  tone: "emerald" | "sky" | "amber" | "violet" | "rose" | "slate";
  onClick: () => void;
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[132px] flex-col items-center justify-center overflow-hidden rounded-[24px] border border-slate-200 bg-white p-4 text-center shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg active:translate-y-0 active:scale-[0.97]"
    >
      <div className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 transition duration-150 group-hover:scale-105 group-active:scale-95 ${tones[tone]}`}>
        <Icon name={icon} size={23} />
      </div>
      <div className="mt-3 text-sm font-black leading-5 text-slate-900 sm:text-base">{title}</div>
    </button>
  );
}

export default function ParentPage() {
  const [screen, setScreen] = useState<Screen>("home");
  const [kids, setKids] = useState<Kid[]>([]);
  const [selectedKidId, setSelectedKidId] = useState("");
  const [childData, setChildData] = useState<Record<string, ChildData>>({});
  const [bulletins, setBulletins] = useState<ParentBulletin[]>([]);
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [notifications, setNotifications] = useState<ParentNotification[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [attachMatricule, setAttachMatricule] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachMessage, setAttachMessage] = useState<string | null>(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageNotice, setMessageNotice] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [textbookSubject, setTextbookSubject] = useState("");
  const [expandedLessons, setExpandedLessons] = useState<Record<string, boolean>>({});
  const [showProgression, setShowProgression] = useState(false);
  const [selectedTimetableDay, setSelectedTimetableDay] = useState(1);

  const selectedKid = useMemo(
    () => kids.find((kid) => kid.id === selectedKidId) || kids[0] || null,
    [kids, selectedKidId],
  );

  const selectedData = selectedKid
    ? childData[selectedKid.id] || EMPTY_CHILD_DATA
    : EMPTY_CHILD_DATA;

  const selectedKidPeriods = useMemo(() => {
    if (!selectedKid?.institution_id) return periods;
    const own = periods.filter(
      (period) => period.institution_id === selectedKid.institution_id,
    );
    return own.length ? own : periods;
  }, [periods, selectedKid?.institution_id]);

  const selectedPeriod = useMemo(
    () =>
      selectedKidPeriods.find((period) => period.id === selectedPeriodId) ||
      selectedKidPeriods[0] ||
      null,
    [selectedKidPeriods, selectedPeriodId],
  );

  const kidBulletins = useMemo(
    () =>
      selectedKid
        ? bulletins.filter((bulletin) => bulletin.student_id === selectedKid.id)
        : [],
    [bulletins, selectedKid],
  );

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read_at).length,
    [notifications],
  );

  const primaryActive: PrimaryScreen =
    screen === "home"
      ? "home"
      : screen === "attach"
        ? "attach"
        : screen === "messages"
          ? "messages"
          : "children";

  async function loadInitialData() {
    setLoadingInitial(true);
    setGlobalError(null);
    try {
      const [kidsPayload, periodPayload, bulletinPayload, notificationPayload] =
        await Promise.all([
          fetchJson<{ items?: Kid[] }>("/api/parent/children"),
          fetchJson<{ items?: GradePeriod[] }>("/api/parent/grading-periods").catch(
            () => ({ items: [] }),
          ),
          fetchJson<{ items?: ParentBulletin[] }>("/api/parent/bulletins").catch(
            () => ({ items: [] }),
          ),
          fetchJson<{ items?: ParentNotification[] }>("/api/parent/notifications").catch(
            () => ({ items: [] }),
          ),
        ]);

      const nextKids = Array.isArray(kidsPayload.items) ? kidsPayload.items : [];
      setKids(nextKids);
      setSelectedKidId((current) => {
        if (current && nextKids.some((kid) => kid.id === current)) return current;
        return nextKids[0]?.id || "";
      });
      setPeriods(Array.isArray(periodPayload.items) ? periodPayload.items : []);
      setBulletins(Array.isArray(bulletinPayload.items) ? bulletinPayload.items : []);
      setNotifications(
        Array.isArray(notificationPayload.items) ? notificationPayload.items : [],
      );
    } catch (error: any) {
      setGlobalError(error?.message || "Impossible de charger l’espace parent.");
    } finally {
      setLoadingInitial(false);
    }
  }

  async function loadNotifications() {
    const payload = await fetchJson<{ items?: ParentNotification[] }>(
      "/api/parent/notifications",
    );
    setNotifications(Array.isArray(payload.items) ? payload.items : []);
  }

  async function loadChildData(kidId: string, force = false) {
    const previous = childData[kidId];
    if (previous?.loading) return;
    if (!force && previous && !previous.error && previous.timetable) return;

    setChildData((current) => ({
      ...current,
      [kidId]: {
        ...(current[kidId] || EMPTY_CHILD_DATA),
        loading: true,
        error: null,
      },
    }));

    const params = new URLSearchParams({ student_id: kidId });
    if (selectedPeriod?.id) params.set("period_id", selectedPeriod.id);
    if (selectedPeriod?.start_date) params.set("from", selectedPeriod.start_date);
    if (selectedPeriod?.end_date) params.set("to", selectedPeriod.end_date);

    const eventParams = new URLSearchParams({
      student_id: kidId,
      limit: "100",
      days: "180",
    });
    const penaltyParams = new URLSearchParams({ student_id: kidId, limit: "50" });
    if (selectedPeriod?.start_date) penaltyParams.set("from", selectedPeriod.start_date);
    if (selectedPeriod?.end_date) penaltyParams.set("to", selectedPeriod.end_date);

    const results = await Promise.allSettled([
      fetchJson<{ items?: AttendanceEvent[] }>(
        `/api/parent/children/events?${eventParams.toString()}`,
      ),
      fetchJson<{ items?: KidPenalty[] }>(
        `/api/parent/children/penalties?${penaltyParams.toString()}`,
      ),
      fetchJson<{ items?: KidGradeRow[] }>(
        `/api/parent/children/grades?${params.toString()}`,
      ),
      fetchJson<Conduct>(`/api/parent/children/conduct?${params.toString()}`),
      fetchJson<{ items?: ParentTextbookProgression[] }>(
        `/api/parent/textbook?student_id=${encodeURIComponent(kidId)}`,
      ),
      fetchJson<TimetablePayload>(
        `/api/parent/timetable?student_id=${encodeURIComponent(kidId)}`,
      ),
    ]);

    const value = <T,>(index: number, fallback: T): T => {
      const result = results[index];
      return result.status === "fulfilled" ? (result.value as T) : fallback;
    };

    const rejected = results.find((result) => result.status === "rejected") as
      | PromiseRejectedResult
      | undefined;

    setChildData((current) => ({
      ...current,
      [kidId]: {
        loading: false,
        error:
          results.every((result) => result.status === "rejected")
            ? rejected?.reason?.message || "Données indisponibles."
            : null,
        events: value<{ items?: AttendanceEvent[] }>(0, {}).items || [],
        penalties: value<{ items?: KidPenalty[] }>(1, {}).items || [],
        grades: value<{ items?: KidGradeRow[] }>(2, {}).items || [],
        conduct: value<Conduct | null>(3, null),
        textbook: value<{ items?: ParentTextbookProgression[] }>(4, {}).items || [],
        timetable: value<TimetablePayload | null>(5, null),
      },
    }));
  }

  useEffect(() => {
    setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    loadInitialData();
    void hasActivePushSubscription()
      .then(setPushEnabled)
      .catch(() => setPushEnabled(false));
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedKidPeriods.length) {
      setSelectedPeriodId("");
      return;
    }
    setSelectedPeriodId((current) => {
      if (current && selectedKidPeriods.some((period) => period.id === current)) {
        return current;
      }
      const today = currentDateOnly();
      const active = selectedKidPeriods.find(
        (period) =>
          period.start_date &&
          period.end_date &&
          period.start_date <= today &&
          today <= period.end_date,
      );
      return (active || selectedKidPeriods[0]).id;
    });
  }, [selectedKidPeriods]);

  useEffect(() => {
    if (!selectedKid?.id) return;
    loadChildData(selectedKid.id, true);
    setTextbookSubject("");
    setExpandedLessons({});
    setShowProgression(false);
    setSelectedTimetableDay(
      preferredTimetableDay(childData[selectedKid.id]?.timetable?.items || []),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKid?.id, selectedPeriodId]);

  function openPrimary(next: PrimaryScreen) {
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (next === "messages") loadNotifications().catch(() => undefined);
  }

  function openKid(kidId: string) {
    setSelectedKidId(kidId);
    setScreen("child");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openChildModule(next: ChildScreen) {
    if (next === "timetable") {
      setSelectedTimetableDay(
        preferredTimetableDay(selectedData.timetable?.items || []),
      );
    }
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function attachChild(event: React.FormEvent) {
    event.preventDefault();
    const matricule = attachMatricule.trim().toUpperCase();
    if (!matricule) return;
    if (!isOnline) {
      setAttachMessage("Une connexion Internet est nécessaire pour ajouter un enfant.");
      return;
    }

    setAttachBusy(true);
    setAttachMessage(null);
    try {
      const payload = await fetchJson<{ student_id?: string }>(
        "/api/parent/children/attach",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matricule }),
        },
      );
      await loadInitialData();
      setAttachMatricule("");
      setAttachMessage("Enfant ajouté avec succès.");
      if (payload.student_id) {
        setSelectedKidId(payload.student_id);
        setScreen("child");
      }
    } catch (error: any) {
      const message = String(error?.message || "");
      setAttachMessage(
        message === "MATRICULE_NOT_FOUND"
          ? "Matricule introuvable. Vérifiez-le puis réessayez."
          : "Impossible d’ajouter cet enfant pour le moment.",
      );
    } finally {
      setAttachBusy(false);
    }
  }

  async function markMessagesRead(ids?: string[]) {
    const targetIds = ids?.length
      ? ids
      : notifications.filter((item) => !item.read_at).map((item) => item.id);
    if (!targetIds.length) return;
    setMessageBusy(true);
    try {
      await fetchJson("/api/parent/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: targetIds }),
      });
      const now = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          targetIds.includes(item.id) ? { ...item, read_at: now } : item,
        ),
      );
    } catch (error: any) {
      setMessageNotice(error?.message || "Impossible de mettre les messages à jour.");
    } finally {
      setMessageBusy(false);
    }
  }

  async function activatePush() {
    setMessageBusy(true);
    setMessageNotice(null);
    try {
      await ensurePushSubscription();
      setPushEnabled(true);
      setMessageNotice("Les notifications sont activées sur cet appareil.");
    } catch (error: any) {
      setMessageNotice(error?.message || "Activation impossible.");
    } finally {
      setMessageBusy(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    window.location.assign(LOGOUT_PARENTS);
  }

  const navItems: Array<{
    key: PrimaryScreen;
    label: string;
    icon: IconName;
    badge?: number;
  }> = [
    { key: "home", label: "Accueil", icon: "home" },
    { key: "children", label: "Mes enfants", icon: "children" },
    { key: "attach", label: "Ajouter", icon: "plus" },
    { key: "messages", label: "Messages", icon: "message", badge: unreadCount },
  ];

  const absencesCount = selectedData.events.filter((event) => event.type === "absent").length;
  const lateEvents = selectedData.events.filter((event) => event.type === "late");
  const latesCount = lateEvents.length;
  const lateMinutes = lateEvents.reduce(
    (sum, event) => sum + Number(event.minutes_late || 0),
    0,
  );
  const overallAverage = weightedAverage(selectedData.grades);

  function renderHome() {
    return (
      <div className="mx-auto max-w-3xl pt-3 sm:pt-10">
        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-9 text-center shadow-sm sm:px-10 sm:py-12">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-[#003766] text-white shadow-sm">
            <Icon name="children" size={28} />
          </div>
          <div className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Mon Cahier</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Bienvenue cher parent</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm font-medium leading-6 text-slate-500 sm:text-base">
            Consultez simplement le suivi scolaire de vos enfants depuis le menu principal.
          </p>
        </section>
      </div>
    );
  }

  function renderChildren() {
    return (
      <>
        <SectionHeader
          eyebrow="Famille"
          title="Mes enfants"
          description="Sélectionnez un enfant pour afficher les six rubriques de son suivi."
        />
        {kids.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {kids.map((kid, index) => (
              <button
                key={kid.id}
                type="button"
                onClick={() => openKid(kid.id)}
                className="group overflow-hidden rounded-[30px] border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/5"
              >
                <div className={`h-2 ${index % 3 === 0 ? "bg-emerald-500" : index % 3 === 1 ? "bg-sky-500" : "bg-violet-500"}`} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-slate-100 text-xl font-black text-slate-700">
                      {initials(kid.full_name)}
                    </div>
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-50 text-slate-400 transition group-hover:bg-slate-900 group-hover:text-white">
                      <Icon name="arrow" size={18} />
                    </span>
                  </div>
                  <div className="mt-5 text-xl font-black text-slate-950">{kid.full_name}</div>
                  <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
                    {kid.class_label || "Classe non renseignée"}
                  </div>
                  {kid.matricule ? (
                    <div className="mt-4 text-xs font-bold text-slate-400">Matricule : {kid.matricule}</div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="children"
            title="Aucun enfant lié"
            text="Utilisez la rubrique Ajouter un enfant pour commencer."
          />
        )}
      </>
    );
  }

  function renderAttach() {
    return (
      <div className="mx-auto max-w-2xl">
        <SectionHeader
          eyebrow="Association"
          title="Ajouter un enfant"
          description="Saisissez uniquement le matricule communiqué par l’établissement."
        />
        <form
          onSubmit={attachChild}
          className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        >
          <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <Icon name="plus" size={28} />
          </div>
          <label className="mt-6 block text-sm font-black text-slate-800" htmlFor="parent-matricule">
            Matricule de l’enfant
          </label>
          <input
            id="parent-matricule"
            value={attachMatricule}
            onChange={(event) => setAttachMatricule(event.target.value.toUpperCase())}
            placeholder="Ex. LMA-000101"
            autoComplete="off"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-base font-black uppercase tracking-wide text-slate-900 outline-none transition placeholder:font-semibold placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
          <button
            type="submit"
            disabled={attachBusy || !attachMatricule.trim()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {attachBusy ? "Ajout en cours…" : "Ajouter l’enfant"}
          </button>
          {attachMessage ? (
            <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">{attachMessage}</div>
          ) : null}
          <p className="mt-5 text-xs font-semibold leading-5 text-slate-400">
            Une connexion Internet est obligatoire. Aucune donnée parent n’est enregistrée pour une consultation hors connexion.
          </p>
        </form>
      </div>
    );
  }

  function renderMessages() {
    return (
      <>
        <SectionHeader
          eyebrow="Communication"
          title="Messages"
          description="Les alertes et communications de l’établissement sont regroupées ici."
          action={
            unreadCount ? (
              <button
                type="button"
                onClick={() => markMessagesRead()}
                disabled={messageBusy}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                Tout marquer comme lu
              </button>
            ) : null
          }
        />

        <div className={`mb-5 flex flex-col gap-3 rounded-[26px] border p-4 sm:flex-row sm:items-center sm:justify-between ${
          pushEnabled
            ? "border-slate-200 bg-slate-100"
            : "border-emerald-100 bg-emerald-50"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-2xl bg-white shadow-sm ${pushEnabled ? "text-slate-500" : "text-emerald-700"}`}>
              <Icon name="bell" size={21} />
            </div>
            <div>
              <div className={`text-sm font-black ${pushEnabled ? "text-slate-700" : "text-emerald-950"}`}>
                {pushEnabled ? "Notifications activées" : "Recevoir les nouvelles alertes"}
              </div>
              <div className={`mt-1 text-xs font-semibold ${pushEnabled ? "text-slate-500" : "text-emerald-800/70"}`}>
                {pushEnabled
                  ? "Cet appareil recevra les nouvelles alertes."
                  : "Activez les notifications sur cet appareil."}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={activatePush}
            disabled={messageBusy || pushEnabled}
            className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
              pushEnabled
                ? "cursor-default bg-slate-300 text-slate-600"
                : "bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60"
            }`}
          >
            {pushEnabled ? "Activées" : "Activer"}
          </button>
        </div>

        {messageNotice ? (
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm">{messageNotice}</div>
        ) : null}

        {notifications.length ? (
          <div className="space-y-3">
            {notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => !item.read_at && markMessagesRead([item.id])}
                className={`w-full rounded-[26px] border p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md ${
                  item.read_at
                    ? "border-slate-200 bg-white"
                    : "border-emerald-200 bg-emerald-50/70"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.read_at ? "bg-slate-300" : "bg-emerald-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                        {notificationLabel(item)}
                      </span>
                      <span className="text-xs font-bold text-slate-400">{dateFr(item.created_at, true)}</span>
                    </div>
                    <div className="mt-3 text-base font-black text-slate-950">{item.title || "Information"}</div>
                    {item.body ? (
                      <p className="mt-2 whitespace-pre-line text-sm font-medium leading-6 text-slate-600">{item.body}</p>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon="message" title="Aucun message" text="Les communications de l’établissement apparaîtront ici." />
        )}
      </>
    );
  }

  function renderChildDashboard() {
    if (!selectedKid) {
      return <EmptyState icon="children" title="Aucun enfant sélectionné" text="Choisissez un enfant dans la rubrique Mes enfants." />;
    }

    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        <SectionHeader
          eyebrow="Tableau de bord"
          title="Suivi scolaire"
          description="Toutes les informations sont organisées en six rubriques simples."
          action={
            <button
              type="button"
              onClick={() => loadChildData(selectedKid.id, true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Icon name="refresh" size={17} />
              Actualiser
            </button>
          }
        />

        {selectedData.loading && !selectedData.timetable ? (
          <PageLoader label="Chargement du suivi…" />
        ) : selectedData.error ? (
          <EmptyState icon="wifi" title="Données indisponibles" text={selectedData.error} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            <ModuleCard
              title="Absences et retards"
              icon="clock"
              tone="amber"
              onClick={() => openChildModule("absences")}
            />
            <ModuleCard
              title="Cahier de notes"
              icon="notes"
              tone="sky"
              onClick={() => openChildModule("notes")}
            />
            <ModuleCard
              title="Cahier de texte"
              icon="book"
              tone="emerald"
              onClick={() => openChildModule("textbook")}
            />
            <ModuleCard
              title="Bulletin"
              icon="bulletin"
              tone="slate"
              onClick={() => openChildModule("bulletins")}
            />
            <ModuleCard
              title="Emploi du temps"
              icon="calendar"
              tone="violet"
              onClick={() => openChildModule("timetable")}
            />
            <ModuleCard
              title="Sanctions"
              icon="shield"
              tone="rose"
              onClick={() => openChildModule("sanctions")}
            />
          </div>
        )}
      </>
    );
  }

  function moduleBackHeader(title: string, description: string, eyebrow: string) {
    return (
      <>
        <button
          type="button"
          onClick={() => openChildModule("child")}
          className="mb-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          <span className="rotate-180"><Icon name="arrow" size={16} /></span>
          Retour au suivi
        </button>
        <SectionHeader eyebrow={eyebrow} title={title} description={description} />
      </>
    );
  }

  function renderAbsences() {
    if (!selectedKid) return null;
    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        {moduleBackHeader("Absences et retards", "Les événements récents sont présentés du plus récent au plus ancien.", "Assiduité")}
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[24px] border border-rose-100 bg-rose-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-rose-700">Absences</div>
            <div className="mt-2 text-3xl font-black text-rose-950">{absencesCount}</div>
          </div>
          <div className="rounded-[24px] border border-amber-100 bg-amber-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-amber-700">Retards</div>
            <div className="mt-2 text-3xl font-black text-amber-950">{latesCount}</div>
          </div>
          <div className="rounded-[24px] border border-sky-100 bg-sky-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-sky-700">Minutes de retard</div>
            <div className="mt-2 text-3xl font-black text-sky-950">{lateMinutes}</div>
          </div>
        </div>
        {selectedData.events.length ? (
          <div className="space-y-3">
            {selectedData.events.map((event) => (
              <div key={event.id} className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className={`grid h-11 w-11 place-items-center rounded-2xl ${event.type === "absent" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                    <Icon name="clock" size={21} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${event.type === "absent" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                        {event.type === "absent" ? "Absence" : `Retard${event.minutes_late ? ` · ${event.minutes_late} min` : ""}`}
                      </span>
                      <span className="text-xs font-bold text-slate-400">{dateFr(event.when, true)}</span>
                    </div>
                    <div className="mt-2 text-base font-black text-slate-950">{event.subject_name || "Matière non précisée"}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">{event.class_label || selectedKid.class_label || "Classe"}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="clock" title="Aucune absence ni aucun retard" text="Aucun événement récent n’a été enregistré pour cet enfant." />
        )}
      </>
    );
  }

  function renderPeriodSelector() {
    if (!selectedKidPeriods.length) return null;
    return (
      <label className="relative block w-full sm:w-auto sm:min-w-[230px]">
        <span className="sr-only">Période</span>
        <select
          value={selectedPeriodId}
          onChange={(event) => setSelectedPeriodId(event.target.value)}
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm font-black text-slate-700 shadow-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
        >
          {selectedKidPeriods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.short_label || period.label} · {period.academic_year}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
          <Icon name="chevron" size={17} />
        </span>
      </label>
    );
  }

  function renderNotes() {
    if (!selectedKid) return null;
    const grouped = new Map<string, KidGradeRow[]>();
    for (const grade of selectedData.grades) {
      const key = grade.subject_id || grade.subject_name || "unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(grade);
    }
    const subjects = Array.from(grouped.entries())
      .map(([key, grades]) => ({
        key,
        label: grades[0]?.subject_name || "Matière non précisée",
        grades: [...grades].sort((a, b) => b.eval_date.localeCompare(a.eval_date)),
        average: weightedAverage(grades),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));

    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        {moduleBackHeader("Cahier de notes", "Les notes sont organisées par matière et par trimestre.", "Résultats")}
        <div className="mb-5 flex flex-col gap-3 rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Moyenne des notes publiées</div>
            <div className="mt-1 text-3xl font-black text-slate-950">{formatAverage(overallAverage)}/20</div>
          </div>
          {renderPeriodSelector()}
        </div>
        {subjects.length ? (
          <div className="space-y-4">
            {subjects.map((subject) => (
              <section key={subject.key} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
                  <div>
                    <div className="text-lg font-black text-slate-950">{subject.label}</div>
                    <div className="mt-1 text-xs font-bold text-slate-400">{subject.grades.length} note{subject.grades.length > 1 ? "s" : ""}</div>
                  </div>
                  <div className="rounded-2xl bg-sky-50 px-4 py-2 text-lg font-black text-sky-800 ring-1 ring-sky-100">
                    {formatAverage(subject.average)}/20
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-black">Date</th>
                        <th className="px-5 py-3 font-black">Évaluation</th>
                        <th className="px-5 py-3 font-black">Intitulé</th>
                        <th className="px-5 py-3 text-center font-black">Coefficient</th>
                        <th className="px-5 py-3 text-right font-black">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {subject.grades.map((grade) => (
                        <tr key={grade.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4 font-semibold text-slate-500">{dateFr(grade.eval_date)}</td>
                          <td className="px-5 py-4 font-bold text-slate-700">{gradeKindLabel(grade.eval_kind)}</td>
                          <td className="px-5 py-4 font-semibold text-slate-500">{grade.title || "—"}</td>
                          <td className="px-5 py-4 text-center font-black text-slate-600">{grade.coeff || 1}</td>
                          <td className="px-5 py-4 text-right text-base font-black text-slate-950">{grade.score == null ? "—" : `${Number(grade.score).toFixed(2).replace(".", ",")}/${grade.scale || 20}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState icon="notes" title="Aucune note publiée" text="Les notes apparaîtront ici après leur publication par l’établissement." />
        )}
      </>
    );
  }

  function renderTextbook() {
    if (!selectedKid) return null;
    const subjects = Array.from(
      new Set<string>(selectedData.textbook.map((item) => String(item.subject_name || "")).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, "fr"));
    const subject = subjects.includes(textbookSubject) ? textbookSubject : subjects[0] || "";
    const progressions = selectedData.textbook.filter((item) => item.subject_name === subject);
    const planned = progressions.reduce(
      (sum, item) => sum + Number(item.planned_total_minutes || 0),
      0,
    );
    const completed = progressions.reduce(
      (sum, item) => sum + Number(item.completed_total_minutes || 0),
      0,
    );
    const progress = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;
    const items = progressions
      .flatMap((progression) =>
        progression.items.map((item) => ({
          ...item,
          teacher_name: progression.teacher_name,
          progression_title: progression.progression.title,
          document: progression.progression.document,
        })),
      )
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const lessons = items
      .flatMap((item) =>
        (item.sessions || []).map((session) => ({
          ...session,
          item_id: item.id,
          item_title: item.title,
          item_type: item.item_type,
          teacher_name: session.teacher_name || item.teacher_name,
        })),
      )
      .sort((a, b) =>
        String(b.session_date || b.created_at || "").localeCompare(
          String(a.session_date || a.created_at || ""),
        ),
      );

    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        {moduleBackHeader("Cahier de texte", "Choisissez une matière, puis ouvrez la leçon qui vous intéresse.", "Cours")}
        {subjects.length ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-500" htmlFor="textbook-subject">
                  Matière
                </label>
                <div className="relative mt-2">
                  <select
                    id="textbook-subject"
                    value={subject}
                    onChange={(event) => {
                      setTextbookSubject(event.target.value);
                      setExpandedLessons({});
                      setShowProgression(false);
                    }}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 pr-10 text-base font-black text-slate-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  >
                    {subjects.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="chevron" size={18} /></span>
                </div>
                <div className="mt-4 text-sm font-semibold text-slate-500">
                  Enseignant : {progressions.map((item) => item.teacher_name).filter(Boolean).join(", ") || "Non renseigné"}
                </div>
              </div>

              <div className="rounded-[28px] bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-lg shadow-emerald-900/10">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Taux d’exécution</div>
                <div className="mt-2 text-4xl font-black">{progress}%</div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-3 text-xs font-semibold text-white/75">Avancement de la matière sélectionnée</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowProgression((value) => !value)}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Icon name="calendar" size={18} />
              {showProgression ? "Masquer la progression" : "Voir la progression"}
            </button>

            {showProgression ? (
              <section className="mt-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Progression</div>
                    <h2 className="mt-1 text-xl font-black text-slate-950">Étapes de {subject}</h2>
                  </div>
                  <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-black text-emerald-700">{progress}%</div>
                </div>
                <div className="mt-5 space-y-3">
                  {items.map((item) => {
                    const completedItem = item.completion?.status === "completed";
                    const started = (item.sessions?.length || 0) > 0;
                    return (
                      <div key={item.id} className="flex items-start gap-3">
                        <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${completedItem ? "bg-emerald-600 text-white" : started ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200" : "bg-slate-100 text-slate-400"}`}>
                          {completedItem ? <Icon name="check" size={15} /> : started ? "●" : "○"}
                        </div>
                        <div className="min-w-0 flex-1 border-b border-slate-100 pb-3">
                          <div className="font-black text-slate-900">{item.title}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-400">{completedItem ? "Terminée" : started ? "En cours" : "À venir"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {progressions.find((item) => item.progression.document?.signed_url)?.progression.document?.signed_url ? (
                  <a
                    href={progressions.find((item) => item.progression.document?.signed_url)?.progression.document?.signed_url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800"
                  >
                    <Icon name="bulletin" size={17} />
                    Consulter le document de progression
                  </a>
                ) : null}
              </section>
            ) : null}

            <section className="mt-5">
              <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Leçons réalisées</div>
              {lessons.length ? (
                <div className="space-y-3">
                  {lessons.map((lesson) => {
                    const open = !!expandedLessons[lesson.id];
                    return (
                      <article key={lesson.id} className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedLessons((current) => ({
                              ...Object.fromEntries(Object.keys(current).map((key) => [key, false])),
                              [lesson.id]: !open,
                            }))
                          }
                          className="flex w-full items-start gap-4 p-4 text-left sm:p-5"
                        >
                          <div className={`mt-0.5 rounded-2xl border px-3 py-2 text-xs font-black ${lessonTone(lesson.item_type)}`}>
                            {lessonTypeLabel(lesson.item_type)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-400">{dateFr(lesson.session_date || lesson.created_at)}</div>
                            <h3 className="mt-1 text-lg font-black text-slate-950">{lesson.session_title || lesson.item_title}</h3>
                            <div className="mt-1 text-sm font-semibold text-slate-500">{lesson.teacher_name || "Enseignant non renseigné"}</div>
                          </div>
                          <span className={`mt-2 text-slate-400 transition ${open ? "rotate-180" : ""}`}><Icon name="chevron" size={19} /></span>
                        </button>
                        {open ? (
                          <div className="border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5">
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                                <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Contenu du cours</div>
                                <div className="mt-3 whitespace-pre-line text-sm font-medium leading-6 text-slate-700">{lesson.content || "Aucun contenu détaillé n’a été renseigné."}</div>
                              </div>
                              {lesson.homework ? (
                                <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                                  <div className="text-xs font-black uppercase tracking-wide text-amber-800">Travail à faire</div>
                                  <div className="mt-3 whitespace-pre-line text-sm font-medium leading-6 text-amber-950">{lesson.homework}</div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState icon="book" title="Aucune leçon publiée" text="Les leçons réalisées dans cette matière apparaîtront ici." />
              )}
            </section>
          </>
        ) : (
          <EmptyState icon="book" title="Cahier de texte vide" text="Aucune matière n’est encore disponible pour cet enfant." />
        )}
      </>
    );
  }

  function renderBulletins() {
    if (!selectedKid) return null;
    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        {moduleBackHeader("Bulletins", "Consultez les bulletins publiés par l’établissement.", "Documents")}
        {kidBulletins.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {kidBulletins.map((bulletin) => (
              <article key={bulletin.code} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-700"><Icon name="bulletin" size={23} /></div>
                <div className="mt-5 text-xs font-black uppercase tracking-[0.16em] text-slate-500">{bulletin.academic_year || "Année scolaire"}</div>
                <div className="mt-2 text-xl font-black text-slate-950">{bulletin.period_label}</div>
                {bulletin.general_avg != null ? (
                  <div className="mt-3 text-sm font-bold text-slate-600">Moyenne générale : <span className="text-lg font-black text-slate-950">{formatAverage(Number(bulletin.general_avg))}/20</span></div>
                ) : null}
                <div className="mt-2 text-xs font-semibold text-slate-400">Publié le {dateFr(bulletin.created_at)}</div>
                <a href={bulletin.url} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800">
                  Ouvrir le bulletin
                  <Icon name="arrow" size={16} />
                </a>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon="bulletin" title="Aucun bulletin disponible" text="Les bulletins apparaîtront ici après leur publication." />
        )}
      </>
    );
  }

  function renderTimetable() {
    if (!selectedKid) return null;
    const timetable = selectedData.timetable;
    const timetablePeriods = timetable?.periods || [];
    const timetableItems = timetable?.items || [];
    const selectedDayItems = timetableItems.filter(
      (item) => item.weekday === selectedTimetableDay,
    );
    const byPeriod = new Map<string, TimetableItem[]>();
    for (const item of selectedDayItems) {
      if (!byPeriod.has(item.period_key)) byPeriod.set(item.period_key, []);
      byPeriod.get(item.period_key)!.push(item);
    }

    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        {moduleBackHeader(
          "Emploi du temps",
          "Choisissez un jour pour afficher un tableau clair et entièrement visible à l’écran.",
          "Organisation",
        )}

        {timetablePeriods.length ? (
          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-lg font-black text-slate-950">
                    {timetable?.class_label || selectedKid.class_label || "Classe"}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-400">
                    {timetable?.academic_year || "Année scolaire en cours"}
                  </div>
                </div>
                <div className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-700">
                  {DAY_NAMES[selectedTimetableDay]}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-6 gap-1.5 sm:gap-2" aria-label="Choisir le jour">
                {[1, 2, 3, 4, 5, 6].map((day) => {
                  const active = selectedTimetableDay === day;
                  const hasCourse = timetableItems.some((item) => item.weekday === day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedTimetableDay(day)}
                      aria-pressed={active}
                      className={`relative rounded-xl px-1 py-2.5 text-xs font-black transition sm:px-3 sm:text-sm ${
                        active
                          ? "bg-violet-700 text-white shadow-sm"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      <span className="sm:hidden">{DAY_SHORT_NAMES[day]}</span>
                      <span className="hidden sm:inline">{DAY_NAMES[day]}</span>
                      {hasCourse ? (
                        <span
                          className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                            active ? "bg-white/80" : "bg-violet-500"
                          }`}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDayItems.length ? (
              <div className="p-3 sm:p-5">
                <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-2xl border border-slate-200 text-left">
                  <colgroup>
                    <col className="w-[108px] sm:w-[145px]" />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#003766] text-white">
                      <th className="px-3 py-3 text-xs font-black uppercase tracking-wide sm:px-4">Horaire</th>
                      <th className="border-l border-white/15 px-3 py-3 text-xs font-black uppercase tracking-wide sm:px-4">Cours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timetablePeriods.map((period, rowIndex) => {
                      const periodItems = byPeriod.get(period.key) || [];
                      return (
                        <tr key={period.key} className={rowIndex % 2 ? "bg-slate-50/70" : "bg-white"}>
                          <th className="border-t border-slate-200 px-3 py-3 align-middle sm:px-4">
                            <div className="whitespace-nowrap text-xs font-black text-slate-900 sm:text-sm">
                              {period.start_time} – {period.end_time}
                            </div>
                          </th>
                          <td className="border-l border-t border-slate-200 px-3 py-2.5 align-middle sm:px-4 sm:py-3">
                            {periodItems.length ? (
                              <div className="space-y-2">
                                {periodItems.map((item) => (
                                  <div key={item.id} className="rounded-xl bg-violet-50 px-3 py-2.5 ring-1 ring-violet-100">
                                    <div className="text-sm font-black leading-5 text-violet-950 sm:text-base">{item.subject_name}</div>
                                    <div className="mt-0.5 text-xs font-bold leading-4 text-violet-700/75 sm:text-sm">{item.teacher_name}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-slate-300 sm:text-sm">Aucun cours</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-10 text-center sm:px-6">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                  <Icon name="calendar" size={22} />
                </div>
                <div className="mt-3 text-base font-black text-slate-900">Aucun cours le {DAY_NAMES[selectedTimetableDay].toLowerCase()}</div>
                <div className="mt-1 text-sm font-medium text-slate-500">Sélectionnez un autre jour pour consulter l’emploi du temps.</div>
              </div>
            )}
          </section>
        ) : (
          <EmptyState icon="calendar" title="Emploi du temps indisponible" text="Aucun créneau publié n’a été trouvé pour cette classe." />
        )}
      </>
    );
  }

  function renderSanctions() {
    if (!selectedKid) return null;
    const conduct = selectedData.conduct;
    const rubrics: Array<{
      key: keyof Conduct["breakdown"];
      label: string;
      tone: string;
    }> = [
      { key: "assiduite", label: "Assiduité", tone: "bg-emerald-50 text-emerald-800" },
      { key: "tenue", label: "Tenue", tone: "bg-sky-50 text-sky-800" },
      { key: "moralite", label: "Moralité", tone: "bg-violet-50 text-violet-800" },
      { key: "discipline", label: "Discipline", tone: "bg-amber-50 text-amber-800" },
    ];

    return (
      <>
        <ChildIdentity kid={selectedKid} kids={kids} onChange={openKid} />
        {moduleBackHeader("Sanctions", "La conduite reste visible de façon synthétique, puis les sanctions sont détaillées.", "Conduite")}
        {conduct ? (
          <section className="mb-5 rounded-[30px] bg-gradient-to-br from-violet-700 to-indigo-800 p-5 text-white shadow-lg shadow-violet-900/10 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Note de conduite</div>
                <div className="mt-2 text-4xl font-black">{formatAverage(conduct.total)}</div>
                <div className="mt-2 text-sm font-bold text-white/75">{conduct.appreciation}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {rubrics.map((rubric) => (
                  <div key={rubric.key} className={`rounded-2xl px-3 py-3 ${rubric.tone}`}>
                    <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{rubric.label}</div>
                    <div className="mt-1 text-lg font-black">{formatAverage(conduct.breakdown[rubric.key])}/{formatAverage(conduct.rubric_max[rubric.key])}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {selectedData.penalties.length ? (
          <div className="space-y-3">
            {selectedData.penalties.map((penalty) => (
              <article key={penalty.id} className="rounded-[26px] border border-rose-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-50 text-rose-700"><Icon name="shield" size={21} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-black text-rose-800">{rubricLabel(penalty.rubric)}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">-{Number(penalty.points || 0).toFixed(1).replace(".", ",")} pt</span>
                      <span className="text-xs font-bold text-slate-400">{dateFr(penalty.when, true)}</span>
                    </div>
                    <div className="mt-3 text-base font-black text-slate-950">{penalty.reason || "Motif non renseigné"}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-500">
                      {penalty.author_name || penalty.author_role_label || "Administration"}
                      {penalty.author_subject_name ? ` · ${penalty.author_subject_name}` : ""}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon="shield" title="Aucune sanction" text="Aucune sanction n’a été enregistrée pour cette période." />
        )}
      </>
    );
  }

  function renderScreen() {
    if (loadingInitial) return <PageLoader label="Ouverture de l’espace parent…" />;
    if (globalError) return <EmptyState icon="wifi" title="Connexion impossible" text={globalError} />;
    if (screen === "home") return renderHome();
    if (screen === "children") return renderChildren();
    if (screen === "attach") return renderAttach();
    if (screen === "messages") return renderMessages();
    if (screen === "child") return renderChildDashboard();
    if (screen === "absences") return renderAbsences();
    if (screen === "notes") return renderNotes();
    if (screen === "textbook") return renderTextbook();
    if (screen === "bulletins") return renderBulletins();
    if (screen === "timetable") return renderTimetable();
    return renderSanctions();
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#003766] text-white shadow-sm">
              <Icon name="children" size={23} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-black text-slate-950">Mon Cahier</div>
              <div className="mt-0.5 text-xs font-bold text-slate-400">Espace parent</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-2 px-4 py-5">
          {navItems.map((item) => {
            const active = primaryActive === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => openPrimary(item.key)}
                aria-current={active ? "page" : undefined}
                className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-black transition ${
                  active
                    ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
                    active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge ? (
                  <span className="grid min-w-6 place-items-center rounded-full bg-rose-500 px-1.5 py-1 text-[10px] font-black text-white">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div
            className={`mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-black ${
              isOnline
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-900"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {isOnline ? "Connexion active" : "Internet requis"}
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <Icon name="logout" size={18} />
            {loggingOut ? "Déconnexion…" : "Déconnexion"}
          </button>
        </div>
      </aside>

      <div className="min-h-screen md:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#003766] text-white">
                <Icon name="children" size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black text-slate-950">Espace parent</div>
                <div className="text-[11px] font-bold text-slate-400">Mon Cahier</div>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              aria-label="Se déconnecter"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>

        {!isOnline ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-black text-amber-900">
            Connexion Internet requise pour utiliser l’espace parent.
          </div>
        ) : null}

        <main className="mx-auto max-w-[1180px] px-4 pb-28 pt-5 sm:px-6 md:pb-10 md:pt-8 xl:px-8">
          {renderScreen()}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
          {navItems.map((item) => {
            const active = primaryActive === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => openPrimary(item.key)}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-black transition ${
                  active ? "text-emerald-700" : "text-slate-400"
                }`}
              >
                <span
                  className={`absolute -top-2 h-1 w-9 rounded-b-full transition ${
                    active ? "bg-emerald-600" : "bg-transparent"
                  }`}
                />
                <span
                  className={`grid h-9 w-9 place-items-center rounded-2xl transition ${
                    active ? "bg-emerald-50 ring-1 ring-emerald-100" : "bg-transparent"
                  }`}
                >
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="max-w-[76px] truncate">{item.label}</span>
                {item.badge ? (
                  <span className="absolute right-[14%] top-1 grid min-w-5 place-items-center rounded-full bg-rose-500 px-1 py-0.5 text-[9px] font-black text-white">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );

}
