// src/app/parents/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/* ————————— routes dédiées parents + fallbacks ————————— */
const LOGOUT_PARENTS = "/parents/logout";
const LOGIN_PARENTS = "/parents/login";

/* ————————— helpers ————————— */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64url);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

function slotLabel(iso: string, expectedMinutes?: number | null): string {
  const start = new Date(iso);
  const minutes = Number.isFinite(Number(expectedMinutes))
    ? Number(expectedMinutes)
    : 60;
  const end = new Date(start.getTime() + minutes * 60_000);

  const sh = String(start.getHours()).padStart(2, "0");
  const sm = String(start.getMinutes()).padStart(2, "0");
  const eh = String(end.getHours()).padStart(2, "0");
  const em = String(end.getMinutes()).padStart(2, "0");

  const left = sm === "00" ? `${sh}h` : `${sh}h${sm}`;
  const right = em === "00" ? `${eh}h` : `${eh}h${em}`;
  return `${left}-${right}`;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yday = new Date(today.getTime() - 24 * 3600 * 1000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, today)) return "Aujourd’hui";
  if (same(d, yday)) return "Hier";
  return d.toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function rubricLabel(r: "discipline" | "tenue" | "moralite") {
  if (r === "tenue") return "Tenue";
  if (r === "moralite") return "Moralité";
  return "Discipline";
}

function gradeKindLabel(kind: "devoir" | "interro_ecrite" | "interro_orale") {
  if (kind === "devoir") return "Devoir";
  if (kind === "interro_ecrite") return "Interrogation écrite";
  return "Interrogation orale";
}

function yyyyMMdd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getInitials(name: string) {
  const parts = (name || "").trim().split(/\s+/);
  const pick = (s: string) => (s ? s[0].toUpperCase() : "");
  if (parts.length === 1) return pick(parts[0]);
  return pick(parts[0]) + pick(parts[parts.length - 1]);
}

function dateFr(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return value;
  }
}


function isInDateRange(iso: string, from?: string | null, to?: string | null) {
  const d = new Date(iso);
  if (from) {
    const f = new Date(from + "T00:00:00");
    if (d < f) return false;
  }
  if (to) {
    const t = new Date(to + "T23:59:59");
    if (d > t) return false;
  }
  return true;
}

function formatPhoneForDisplay(phone?: string | null) {
  const s = String(phone || "").trim();
  if (!s) return "Non configuré";
  if (!s.startsWith("+")) return s;
  const digits = s.slice(1);
  if (digits.startsWith("225") && digits.length >= 11) {
    const core = digits.slice(3);
    if (core.length === 10) {
      return `+225 ${core.slice(0, 2)} ${core.slice(2, 4)} ${core.slice(
        4,
        6,
      )} ${core.slice(6, 8)} ${core.slice(8, 10)}`;
    }
    if (core.length === 8) {
      return `+225 ${core.slice(0, 2)} ${core.slice(2, 4)} ${core.slice(
        4,
        6,
      )} ${core.slice(6, 8)}`;
    }
  }
  return s;
}

function notificationKindLabel(payload: any) {
  const kind = String(payload?.kind || payload?.event || payload?.type || "").toLowerCase();
  if (kind === "finance_reminder") return "Rappel financier";
  if (kind === "communication") return "Communication";
  if (kind === "infirmary_visit" || kind === "infirmary_visit_created") return "Infirmerie";
  if (kind === "attendance" || kind === "absent" || kind === "late") return "Absence / retard";
  if (kind === "penalty" || kind === "conduct_penalty") return "Conduite";
  return "Notification";
}

function notificationTone(payload: any, severity?: string | null) {
  const kind = String(payload?.kind || payload?.event || payload?.type || "").toLowerCase();
  if (kind === "finance_reminder") return "amber" as const;
  if (kind === "communication") return "emerald" as const;
  if (kind === "infirmary_visit" || kind === "infirmary_visit_created") return "sky" as const;
  if (severity === "error" || severity === "warning") return "rose" as const;
  return "slate" as const;
}

function formatNotificationDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

/* ————————— thèmes (couleurs différentes par enfant / matière) ————————— */
const THEMES = [
  {
    name: "emerald",
    ring: "hover:ring-emerald-300",
    border: "border-emerald-200",
    bar: "from-emerald-500 to-teal-500",
    chipBg: "bg-emerald-100",
    chipText: "text-emerald-800",
  },
  {
    name: "indigo",
    ring: "hover:ring-indigo-300",
    border: "border-indigo-200",
    bar: "from-indigo-500 to-blue-500",
    chipBg: "bg-indigo-100",
    chipText: "text-indigo-800",
  },
  {
    name: "violet",
    ring: "hover:ring-violet-300",
    border: "border-violet-200",
    bar: "from-violet-500 to-fuchsia-500",
    chipBg: "bg-violet-100",
    chipText: "text-violet-800",
  },
  {
    name: "sky",
    ring: "hover:ring-sky-300",
    border: "border-sky-200",
    bar: "from-sky-500 to-cyan-500",
    chipBg: "bg-sky-100",
    chipText: "text-sky-800",
  },
  {
    name: "amber",
    ring: "hover:ring-amber-300",
    border: "border-amber-200",
    bar: "from-amber-500 to-orange-500",
    chipBg: "bg-amber-100",
    chipText: "text-amber-900",
  },
  {
    name: "rose",
    ring: "hover:ring-rose-300",
    border: "border-rose-200",
    bar: "from-rose-500 to-pink-500",
    chipBg: "bg-rose-100",
    chipText: "text-rose-800",
  },
  {
    name: "teal",
    ring: "hover:ring-teal-300",
    border: "border-teal-200",
    bar: "from-teal-500 to-emerald-500",
    chipBg: "bg-teal-100",
    chipText: "text-teal-800",
  },
  {
    name: "cyan",
    ring: "hover:ring-cyan-300",
    border: "border-cyan-200",
    bar: "from-cyan-500 to-sky-500",
    chipBg: "bg-cyan-100",
    chipText: "text-cyan-800",
  },
] as const;

function themeFor(i: number) {
  return THEMES[i % THEMES.length];
}

/* ————————— thèmes par rubrique (pour jauges verticales) ————————— */
const RUBRIC_THEMES = {
  assiduite: {
    bg: "bg-emerald-100",
    fill: "bg-emerald-500",
    text: "text-emerald-700",
  },
  tenue: {
    bg: "bg-sky-100",
    fill: "bg-sky-500",
    text: "text-sky-700",
  },
  moralite: {
    bg: "bg-violet-100",
    fill: "bg-violet-500",
    text: "text-violet-700",
  },
  discipline: {
    bg: "bg-amber-100",
    fill: "bg-amber-500",
    text: "text-amber-800",
  },
} as const;

type RubricKey = keyof typeof RUBRIC_THEMES;

/* ————————— types ————————— */
type Kid = {
  id: string;
  full_name: string;
  class_label: string | null;
  matricule?: string | null;
  institution_id?: string | null;
};

type Ev = {
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
  author_role?: string | null;
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

type SubjectGradeSummary = {
  key: string;
  label: string;
  grades: KidGradeRow[];
  average: number | null;
  latest: KidGradeRow | null;
};

function formatMoney(value?: number | null) {
  const n = Number(value || 0);
  return `${Math.round(n).toLocaleString("fr-FR")} F`;
}

function scoreOn20(g: KidGradeRow) {
  const score = Number(g.score);
  const scale = Number(g.scale || 20);
  if (!Number.isFinite(score) || !Number.isFinite(scale) || scale <= 0) return null;
  return (score / scale) * 20;
}

function weightedAverageOn20(grades: KidGradeRow[]) {
  let total = 0;
  let coeffSum = 0;
  for (const g of grades) {
    const value = scoreOn20(g);
    if (value == null) continue;
    const coeff = Number(g.coeff || 1) > 0 ? Number(g.coeff || 1) : 1;
    total += value * coeff;
    coeffSum += coeff;
  }
  return coeffSum > 0 ? total / coeffSum : null;
}

function formatAverage(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2).replace(".", ",");
}

function formatHoursFromMinutes(value?: number | null) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function itemTypeLabel(type?: string | null) {
  const t = String(type || "").toLowerCase();
  if (t === "regulation") return "Régulation";
  if (t === "revision") return "Révision";
  if (t === "evaluation") return "Évaluation";
  if (t === "remediation") return "Remédiation";
  return "Leçon";
}

function visibleParentSessions(items: ParentTextbookItem[] = []) {
  return items
    .flatMap((item) =>
      (item.sessions || []).map((session) => ({
        ...session,
        item_title: item.title,
        item_type: item.item_type,
      })),
    )
    .sort((a, b) =>
      String(b.session_date || "").localeCompare(String(a.session_date || "")) ||
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
    );
}

function averageFromBulletin(b?: ParentBulletin | null) {
  if (!b || b.general_avg === null || b.general_avg === undefined) return null;
  const n = Number(b.general_avg);
  return Number.isFinite(n) ? n : null;
}

function findBulletinForPeriod(
  list: ParentBulletin[],
  from?: string | null,
  to?: string | null,
  periodLabel?: string | null,
) {
  if (!list.length) return null;
  const exact = list.find((b) => {
    if (from && to && b.period_from && b.period_to) {
      return b.period_from === from && b.period_to === to;
    }
    return false;
  });
  if (exact) return exact;

  const label = String(periodLabel || "").trim().toLowerCase();
  if (label) {
    const byLabel = list.find((b) =>
      String(b.period_label || "").trim().toLowerCase() === label,
    );
    if (byLabel) return byLabel;
  }

  return list[0] || null;
}

function formatGradeScore(g?: KidGradeRow | null) {
  if (!g || g.score == null) return "—";
  return `${Number(g.score).toFixed(2).replace(".", ",")}/${g.scale || 20}`;
}

function subjectKeyOf(g: KidGradeRow) {
  return g.subject_id || g.subject_name || "__unknown__";
}

function buildSubjectGradeSummaries(grades: KidGradeRow[]): SubjectGradeSummary[] {
  const map = new Map<string, SubjectGradeSummary>();
  for (const g of grades) {
    const key = subjectKeyOf(g);
    const label = g.subject_name || "Matière non précisée";
    if (!map.has(key)) {
      map.set(key, { key, label, grades: [], average: null, latest: null });
    }
    map.get(key)!.grades.push(g);
  }

  const list = Array.from(map.values()).map((item) => {
    const ordered = [...item.grades].sort((a, b) => b.eval_date.localeCompare(a.eval_date));
    return {
      ...item,
      grades: ordered,
      latest: ordered[0] || null,
      average: weightedAverageOn20(ordered),
    };
  });

  list.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  return list;
}

function latestGradeOf(grades: KidGradeRow[]) {
  return [...grades].sort((a, b) => b.eval_date.localeCompare(a.eval_date))[0] || null;
}

type ParentPaymentProvider = {
  id: string;
  provider: string;
  label: string;
  environment: string;
};

type ParentPaymentChild = {
  student_id: string;
  providers?: ParentPaymentProvider[];
  charges?: Array<{ id: string; balance_due?: number }>;
};

type GradePeriod = {
  id: string;
  institution_id: string;
  academic_year: string;
  code: string | null;
  label: string;
  short_label: string;
  kind: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number;
  coeff: number | null;
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

type ParentTextbookPayload = {
  ok?: boolean;
  items?: ParentTextbookProgression[];
  class_label?: string | null;
  error?: string;
};

type NavSection = "home" | "textbook" | "conduct" | "absences" | "notes" | "notifications";

type ParentNotification = {
  id: string;
  title: string | null;
  body: string | null;
  severity: string | null;
  created_at: string;
  read_at: string | null;
  status?: string | null;
  payload?: any;
};

type ParentNotificationContact = {
  id: string;
  institution_id: string | null;
  profile_id: string;
  phone_e164: string;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  is_primary: boolean;
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type InstitutionNotificationSetting = {
  institution_id: string;
  push_enabled: boolean;
  sms_premium_enabled: boolean;
  sms_provider: string | null;
  sms_sender_name: string | null;
  sms_absence_enabled: boolean;
  sms_late_enabled: boolean;
  sms_notes_digest_enabled: boolean;
  sms_communication_enabled: boolean;
  sms_finance_reminders_enabled: boolean;
  sms_notes_digest_weekday: number | null;
  sms_notes_digest_hour: number | null;
  whatsapp_premium_enabled: boolean;
};

type ParentNotificationContactsResponse = {
  ok: boolean;
  profile_id?: string;
  source?: string;
  preferred_institution_id?: string | null;
  institution_ids?: string[];
  contacts?: ParentNotificationContact[];
  primary_contact?: ParentNotificationContact | null;
  institution_settings?: InstitutionNotificationSetting[];
  sms_premium_any_enabled?: boolean;
  error?: string;
};

/* ————————— UI ————————— */
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "red" | "white" | "outline";
    iconLeft?: React.ReactNode;
  },
) {
  const tone = p.tone ?? "emerald";
  const map: Record<NonNullable<typeof p.tone>, string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 focus:ring-emerald-500",
    slate:
      "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-900 focus:ring-slate-700",
    red: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus:ring-rose-500",
    white:
      "bg-white text-slate-900 hover:bg-white/90 ring-1 ring-slate-200 focus:ring-slate-300 active:bg-slate-50",
    outline:
      "bg-transparent text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-50 focus:ring-emerald-400",
  };
  const { tone: _t, className, iconLeft, children, ...rest } = p;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-semibold shadow-sm transition-all",
        "focus:outline-none focus:ring-2 focus:ring-offset-1",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        map[tone],
        className ?? "",
      ].join(" ")}
    >
      {iconLeft}
      {children}
    </button>
  );
}

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-[15px] shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 focus:border-emerald-500",
        "disabled:cursor-not-allowed disabled:bg-slate-50",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "emerald" | "amber" | "rose" | "sky";
}) {
  const toneMap: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
  };
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1",
        toneMap[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-slate-200/70 ${className}`} />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition",
        checked
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-white hover:bg-slate-50",
        disabled ? "opacity-60 cursor-not-allowed" : "",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-bold text-slate-900">{label}</div>
        {description && (
          <div className="mt-1 text-[12px] text-slate-600">{description}</div>
        )}
      </div>

      <div
        className={[
          "relative h-7 w-12 shrink-0 rounded-full transition",
          checked ? "bg-emerald-500" : "bg-slate-300",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-6" : "left-1",
          ].join(" ")}
        />
      </div>
    </button>
  );
}

const IconBell = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);
const IconFamily = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M16 20v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="10" cy="7" r="3" />
    <path d="M22 20v-2a4 4 0 00-3-3.87" />
    <path d="M16 4.13a4 4 0 010 7.75" />
  </svg>
);
const IconChild = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="6.5" r="2.5" />
    <path d="M9 22v-5l-2.1-1.7A2 2 0 016 13.8l1.2-4A2.2 2.2 0 019.3 8.2h5.4a2.2 2.2 0 012.1 1.6l1.2 4a2 2 0 01-.9 2.5L15 17v5" />
    <path d="M12 11v11" />
  </svg>
);
const IconPower = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M12 2v10" />
    <path d="M5.5 7a7 7 0 1013 0" />
  </svg>
);
const IconHome = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M3 11l9-8 9 8" />
    <path d="M5 12v8h14v-8" />
  </svg>
);
const IconClipboard = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <rect x="5" y="7" width="14" height="14" rx="2" />
  </svg>
);
const IconBook = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M4 4h10a2 2 0 012 2v14H6a2 2 0 01-2-2V4z" />
    <path d="M14 4h2a2 2 0 012 2v14" />
  </svg>
);
const IconMenu = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
  >
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);
const IconX = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M6 6l12 12" />
    <path d="M18 6l-12 12" />
  </svg>
);
const IconLock = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M7 11V8a5 5 0 0110 0v3" />
    <rect x="5" y="11" width="14" height="10" rx="2" />
  </svg>
);
const IconPhone = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.08 4.18 2 2 0 014.06 2h3a2 2 0 012 1.72c.12.9.35 1.77.68 2.6a2 2 0 01-.45 2.11L8.1 9.91a16 16 0 006 6l1.48-1.17a2 2 0 012.11-.45c.83.33 1.7.56 2.6.68A2 2 0 0122 16.92z" />
  </svg>
);
const IconSparkles = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
    <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z" />
    <path d="M5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14z" />
  </svg>
);
const IconShield = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M12 3l7 4v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V7l7-4z" />
  </svg>
);

/* ————————— Carte “tilt” ————————— */
function TiltCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const [shineStyle, setShineStyle] = useState<React.CSSProperties>({});
  const [hasFinePointer, setHasFinePointer] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHasFinePointer(
        window.matchMedia?.("(pointer: fine)")?.matches ?? false,
      );
    }
  }, []);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!hasFinePointer) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    const rotMax = 6;
    const rx = (py - 0.5) * -2 * rotMax;
    const ry = (px - 0.5) * 2 * rotMax;

    setStyle({
      transform: `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(
        2,
      )}deg) translateZ(0)`,
      transition: "transform 60ms linear",
      transformStyle: "preserve-3d",
    });

    const x = Math.round(px * rect.width);
    const y = Math.round(py * rect.height);
    setShineStyle({
      background: `radial-gradient(280px circle at ${x}px ${y}px, rgba(255,255,255,0.16), transparent 45%)`,
    });
  }

  function onLeave() {
    setStyle({
      transform: "rotateX(0deg) rotateY(0deg) translateZ(0)",
      transition: "transform 160ms ease",
      transformStyle: "preserve-3d",
    });
    setShineStyle({});
  }

  return (
    <div
      style={{ perspective: "1000px" }}
      className="[transform-style:preserve-3d]"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div
        className={`relative rounded-2xl bg-white transition-shadow will-change-transform ${className}`}
        style={style}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={shineStyle}
        />
        {children}
      </div>
    </div>
  );
}

/* ————————— PUSH: ensure registration + subscribe + server upsert ————————— */
async function ensurePushSubscription() {
  if (typeof window === "undefined") return { ok: false, reason: "ssr" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return { ok: false, reason: "browser_no_push" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch (e: any) {
      return {
        ok: false,
        reason: "sw_register_failed:" + (e?.message || e),
      };
    }
  }
  reg = await navigator.serviceWorker.ready;

  let key = "";
  try {
    const r = await fetch("/api/push/vapid", { cache: "no-store" });
    const j = await r.json();
    key = String(j?.key || "");
  } catch {}
  if (!key) return { ok: false, reason: "no_vapid_key" };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    } catch (e: any) {
      return {
        ok: false,
        reason: "subscribe_failed:" + (e?.message || e),
      };
    }
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      platform: "web",
      device_id: sub.endpoint,
      subscription: sub.toJSON(),
    }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    const err = `${res.status} ${body?.error || ""}${
      body?.stage ? ` [${body.stage}]` : ""
    }`;
    return { ok: false, reason: "server_upsert_failed:" + err };
  }
  return { ok: true };
}

/* ————————— group by day ————————— */
type DayGroup = {
  day: string;
  label: string;
  absentCount: number;
  lateCount: number;
  items: Ev[];
};

function groupByDay(events: Ev[]): DayGroup[] {
  const buckets = new Map<string, Ev[]>();
  for (const ev of events) {
    const k = dayKey(ev.when);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(ev);
  }
  const groups: DayGroup[] = [];
  for (const [k, arr] of buckets) {
    const ordered = [...arr].sort((a, b) => b.when.localeCompare(a.when));
    const absentCount = ordered.filter((e) => e.type === "absent").length;
    const lateCount = ordered.filter((e) => e.type === "late").length;
    groups.push({
      day: k,
      label: dayLabel(ordered[0].when),
      absentCount,
      lateCount,
      items: ordered,
    });
  }
  groups.sort((a, b) => b.day.localeCompare(a.day));
  return groups;
}

/* ————————— fetch helpers (notes robustes) ————————— */
async function fetchJsonSafe(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any; errorText?: string }> {
  try {
    const res = await fetch(url, init);
    const status = res.status;
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      try {
        const t = await res.text();
        return {
          ok: res.ok,
          status,
          json: null,
          errorText: t?.slice(0, 200) || "non-json",
        };
      } catch {
        return { ok: res.ok, status, json: null, errorText: "non-json" };
      }
    }
    return { ok: res.ok, status, json };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      json: null,
      errorText: e?.message || "fetch_failed",
    };
  }
}

async function firstOkItems(
  urls: string[],
  init?: RequestInit,
): Promise<
  | { ok: true; items: any[]; usedUrl: string }
  | { ok: false; err: string }
> {
  for (const u of urls) {
    const r = await fetchJsonSafe(u, init);
    if (!r.ok) continue;
    const j = r.json;
    const items =
      (Array.isArray(j?.items) ? j.items : null) ??
      (Array.isArray(j?.data) ? j.data : null) ??
      (Array.isArray(j) ? j : null) ??
      [];
    if (Array.isArray(items)) return { ok: true, items, usedUrl: u };
  }
  const last = await fetchJsonSafe(urls[0], init);
  const err = `API grades: ${last.status || "?"} ${
    (last.json?.error && String(last.json.error)) ||
    (last.errorText ? String(last.errorText) : "no_items")
  }`;
  return { ok: false, err };
}

/* ————————— Jauge verticale par rubrique (mobile) ————————— */
function VerticalGauge({
  label,
  value,
  max,
  rubric,
}: {
  label: string;
  value: number;
  max: number;
  rubric: RubricKey;
}) {
  const disabled = !(Number.isFinite(max) && max > 0);
  const theme = disabled
    ? { bg: "bg-slate-100", fill: "bg-slate-300", text: "text-slate-500" }
    : RUBRIC_THEMES[rubric];

  const safeMax = max > 0 ? max : 1;
  const pct = disabled
    ? 0
    : Math.max(0, Math.min(100, (value / safeMax) * 100));

  const fmtNumber = (n: number) => {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1).replace(".", ",");
  };

  const vLabel = disabled
    ? "Désactivée"
    : `${fmtNumber(value)} / ${fmtNumber(max)} pt${
        Math.abs(max - 1) < 0.001 ? "" : "s"
      }`;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <div className="relative flex h-28 w-10 overflow-hidden rounded-full">
        <div className={`absolute inset-0 ${theme.bg}`} />
        <div
          className={`absolute bottom-0 left-0 right-0 ${theme.fill}`}
          style={{ height: `${pct}%` }}
        />
        {disabled && (
          <div className="absolute inset-0 grid place-items-center text-slate-500">
            <IconLock />
          </div>
        )}
      </div>
      <div className={`mt-2 text-[13px] font-bold leading-tight ${theme.text}`}>
        {label}
      </div>
      <div className="text-[12px] text-slate-600">{vLabel}</div>
    </div>
  );
}

/* ————————— component ————————— */
export default function ParentPage() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [feed, setFeed] = useState<Record<string, Ev[]>>({});
  const [kidPenalties, setKidPenalties] = useState<
    Record<string, KidPenalty[]>
  >({});
  const [conduct, setConduct] = useState<Record<string, Conduct>>({});
  const [kidGrades, setKidGrades] = useState<Record<string, KidGradeRow[]>>(
    {},
  );
  const [kidGradesErr, setKidGradesErr] = useState<Record<string, string>>({});

  const [loadingKids, setLoadingKids] = useState(true);
  const [loadingConduct, setLoadingConduct] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Filtre période conduite (90 jours)
  const [conductFrom, setConductFrom] = useState<string>("");
  const [conductTo, setConductTo] = useState<string>("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllDaysForKid, setShowAllDaysForKid] = useState<
    Record<string, boolean>
  >({});
  const [showAllPenForKid, setShowAllPenForKid] = useState<
    Record<string, boolean>
  >({});

  // Périodes parent : on travaille par trimestre, pas par semaine/mois.
  const [gradePeriods, setGradePeriods] = useState<GradePeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [gradeFrom, setGradeFrom] = useState<string>("");
  const [gradeTo, setGradeTo] = useState<string>("");

  // Bulletins + cahier de texte visibles côté parent
  const [bulletins, setBulletins] = useState<ParentBulletin[]>([]);
  const [textbookByKid, setTextbookByKid] = useState<Record<string, ParentTextbookProgression[]>>({});
  const [textbookLoading, setTextbookLoading] = useState(false);
  const [textbookMsg, setTextbookMsg] = useState<string | null>(null);
  const [activeTextbookSubject, setActiveTextbookSubject] = useState<string | "all">("all");

  // Matière sélectionnée par enfant + détails ouverts dans le cahier de notes
  const [activeSubjectPerKid, setActiveSubjectPerKid] = useState<
    Record<string, string | "all" | null>
  >({});
  const [expandedGradeSubjects, setExpandedGradeSubjects] = useState<Record<string, boolean>>({});

  // Notifications parent
  const [granted, setGranted] = useState(false);
  const [notifications, setNotifications] = useState<ParentNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsMsg, setNotificationsMsg] = useState<string | null>(null);

  // iOS / standalone
  const [isiOS, setIsiOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  // logout
  const [loggingOut, setLoggingOut] = useState(false);

  // Drawer mobile
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sélection enfant + section
  const [activeChildId, setActiveChildId] = useState<string>("");
  const [activeSection, setActiveSection] = useState<NavSection>("home");
  const [attachMatricule, setAttachMatricule] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);

  // SMS premium
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [smsContacts, setSmsContacts] = useState<ParentNotificationContact[]>(
    [],
  );
  const [smsPrimaryContact, setSmsPrimaryContact] =
    useState<ParentNotificationContact | null>(null);
  const [smsSettings, setSmsSettings] = useState<
    InstitutionNotificationSetting[]
  >([]);
  const [smsPreferredInstitutionId, setSmsPreferredInstitutionId] = useState<
    string | null
  >(null);
  const [smsInstitutionId, setSmsInstitutionId] = useState<string>("");
  const [smsPhone, setSmsPhone] = useState<string>("");
  const [smsEnabled, setSmsEnabled] = useState<boolean>(true);

  const hasKids = kids.length > 0;

  const selectedKid = useMemo(() => {
    if (!kids.length) return null;
    return kids.find((k) => k.id === activeChildId) || kids[0] || null;
  }, [kids, activeChildId]);

  const filteredKids = useMemo(() => {
    return selectedKid ? [selectedKid] : [];
  }, [selectedKid]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !item.read_at).length,
    [notifications],
  );

  const bulletinsByKid = useMemo(() => {
    const map = new Map<string, ParentBulletin[]>();
    for (const item of bulletins) {
      if (!map.has(item.student_id)) map.set(item.student_id, []);
      map.get(item.student_id)!.push(item);
    }
    return map;
  }, [bulletins]);

  const selectedKidBulletins = useMemo(() => {
    return selectedKid ? bulletinsByKid.get(selectedKid.id) || [] : [];
  }, [bulletinsByKid, selectedKid]);

  const selectedKidTextbook = useMemo(() => {
    return selectedKid ? textbookByKid[selectedKid.id] || [] : [];
  }, [textbookByKid, selectedKid]);

  const selectedKidPeriods = useMemo(() => {
    if (!selectedKid?.institution_id) return gradePeriods;
    const own = gradePeriods.filter((p) => p.institution_id === selectedKid.institution_id);
    return own.length ? own : gradePeriods;
  }, [gradePeriods, selectedKid?.institution_id]);

  const activeGradePeriod = useMemo(() => {
    return selectedKidPeriods.find((p) => p.id === selectedPeriodId) || selectedKidPeriods[0] || null;
  }, [selectedKidPeriods, selectedPeriodId]);

  const isHome = activeSection === "home";
  const isTextbook = activeSection === "textbook";
  const isConduct = activeSection === "conduct";
  const isAbsences = activeSection === "absences";
  const isNotes = activeSection === "notes";
  const isNotifications = activeSection === "notifications";

  const showTextbookSection = isTextbook;
  const showConductSection = isConduct;
  const showEventsSection = isAbsences;
  const showNotesSection = isNotes;

  const sectionMeta: Record<NavSection, { breadcrumb: string; title: string; tab: string }> = {
    home: { breadcrumb: "Accueil", title: "Bienvenue cher parent", tab: "Accueil" },
    textbook: { breadcrumb: "Cahier de texte", title: "Progression et devoirs", tab: "Cahier de texte" },
    conduct: { breadcrumb: "Conduite", title: "Conduite en temps réel", tab: "Conduite" },
    absences: { breadcrumb: "Assiduité", title: "Absences et retards", tab: "Assiduité" },
    notes: { breadcrumb: "Notes", title: "Notes, moyennes et bulletins", tab: "Notes" },
    notifications: { breadcrumb: "Notifications", title: "Centre de notifications", tab: "Notifications" },
  };

  const tabs: Array<{
    key: NavSection;
    label: string;
    icon: React.ReactNode;
    activeClass: string;
    idleClass: string;
  }> = [
    {
      key: "textbook",
      label: "Cahier de texte",
      icon: <IconBook />,
      activeClass:
        "bg-gradient-to-r from-[#006633] to-[#0f9f6e] text-white shadow-lg shadow-emerald-900/20",
      idleClass: "bg-[#e8f8ef] text-[#166534] hover:bg-[#d7f1e2]",
    },
    {
      key: "absences",
      label: "Absences",
      icon: <IconClipboard />,
      activeClass:
        "bg-gradient-to-r from-[#a16207] to-[#d97706] text-white shadow-lg shadow-amber-900/20",
      idleClass: "bg-[#fff3db] text-[#9a5d00] hover:bg-[#fde8ba]",
    },
    {
      key: "notes",
      label: "Notes",
      icon: <IconBook />,
      activeClass:
        "bg-gradient-to-r from-[#003766] to-[#0057a8] text-white shadow-lg shadow-[#003766]/20",
      idleClass: "bg-[#e7f0fa] text-[#003766] hover:bg-[#d9e8f7]",
    },
    {
      key: "conduct",
      label: "Conduite",
      icon: <IconShield />,
      activeClass:
        "bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white shadow-lg shadow-violet-900/20",
      idleClass: "bg-[#f3e8ff] text-[#6d28d9] hover:bg-[#ead8ff]",
    },
  ];

  const currentSectionMeta = sectionMeta[activeSection];

  const smsAnyPremiumEnabled = useMemo(
    () => smsSettings.some((s) => s.sms_premium_enabled),
    [smsSettings],
  );

  const smsActiveSetting = useMemo(() => {
    if (!smsSettings.length) return null;
    if (smsInstitutionId) {
      const byId = smsSettings.find((s) => s.institution_id === smsInstitutionId);
      if (byId) return byId;
    }
    if (smsPreferredInstitutionId) {
      const preferred = smsSettings.find(
        (s) => s.institution_id === smsPreferredInstitutionId,
      );
      if (preferred) return preferred;
    }
    return smsSettings[0] || null;
  }, [smsSettings, smsInstitutionId, smsPreferredInstitutionId]);

  const smsSummaryLabel = useMemo(() => {
    if (!smsSettings.length) return "Chargement de la configuration SMS…";
    if (!smsAnyPremiumEnabled)
      return "Le module SMS premium n’est pas encore activé par votre établissement.";
    if (!smsPrimaryContact?.phone_e164)
      return "Ajoutez votre numéro pour recevoir les alertes SMS premium.";
    if (!smsPrimaryContact.sms_enabled)
      return "Votre numéro est enregistré, mais l’envoi SMS est désactivé.";
    return "Votre numéro principal est prêt pour les alertes SMS premium.";
  }, [smsSettings, smsAnyPremiumEnabled, smsPrimaryContact]);

  // lock body scroll when drawer open
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    if (mobileNavOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  // init dates + push states
  useEffect(() => {
    const today = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const f = yyyyMMdd(start);
    const t = yyyyMMdd(today);
    setConductFrom(f);
    setConductTo(t);

    const refresh = () =>
      setGranted(
        typeof Notification !== "undefined" &&
          Notification.permission === "granted",
      );
    refresh();

    setIsiOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const mq = window.matchMedia?.("(display-mode: standalone)");
    setIsStandalone(!!(mq?.matches || (navigator as any).standalone === true));

    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);


  async function loadConductForAll(
    kidsList: Kid[] = kids,
    from?: string,
    to?: string,
  ) {
    setLoadingConduct(true);
    try {
      const condEntries: Array<[string, Conduct]> = [];
      for (const k of kidsList) {
        const qs = new URLSearchParams({ student_id: k.id });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const c = await fetch(
          `/api/parent/children/conduct?${qs.toString()}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        )
          .then((r) => r.json())
          .catch(() => ({}));
        if (c && (c as any).total != null) condEntries.push([k.id, c as Conduct]);
      }
      setConduct(Object.fromEntries(condEntries));
    } finally {
      setLoadingConduct(false);
    }
  }

  async function loadSmsContacts(silent = false) {
    if (!silent) setSmsLoading(true);
    try {
      const res = await fetch("/api/parent/notification-contacts", {
        cache: "no-store",
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as ParentNotificationContactsResponse;

      if (!res.ok || !j?.ok) {
        setSmsMsg(j?.error || "Impossible de charger la configuration SMS.");
        return;
      }

      const contacts = j.contacts || [];
      const primary = j.primary_contact || contacts.find((c) => c.is_primary) || null;
      const settings = j.institution_settings || [];
      const preferred = j.preferred_institution_id || null;

      setSmsContacts(contacts);
      setSmsPrimaryContact(primary);
      setSmsSettings(settings);
      setSmsPreferredInstitutionId(preferred);
      setSmsPhone(primary?.phone_e164 || "");
      setSmsEnabled(primary?.sms_enabled ?? true);

      const chosenInstitutionId =
        (primary?.institution_id as string | null) ||
        preferred ||
        settings[0]?.institution_id ||
        "";

      setSmsInstitutionId(chosenInstitutionId);
      if (!silent) setSmsMsg(null);
    } catch (e: any) {
      setSmsMsg(e?.message || "Erreur de chargement SMS.");
    } finally {
      if (!silent) setSmsLoading(false);
    }
  }

  async function loadGradePeriods() {
    try {
      const res = await fetch("/api/parent/grading-periods", {
        cache: "no-store",
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      setGradePeriods(Array.isArray(j?.items) ? j.items : []);
    } catch {
      setGradePeriods([]);
    }
  }

  async function loadBulletins() {
    try {
      const res = await fetch("/api/parent/bulletins", {
        cache: "no-store",
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      setBulletins(Array.isArray(j?.items) ? j.items : []);
    } catch {
      setBulletins([]);
    }
  }

  async function loadTextbookForKid(studentId: string, silent = false) {
    if (!studentId) return;
    if (!silent) setTextbookLoading(true);
    setTextbookMsg(null);
    try {
      const qs = new URLSearchParams({ student_id: studentId });
      const res = await fetch(`/api/parent/textbook?${qs.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as ParentTextbookPayload;
      if (!res.ok || j?.ok === false) throw new Error(j?.error || "Cahier de texte indisponible.");
      setTextbookByKid((prev) => ({
        ...prev,
        [studentId]: Array.isArray(j?.items) ? j.items : [],
      }));
    } catch (e: any) {
      setTextbookMsg(e?.message || "Impossible de charger le cahier de texte.");
      setTextbookByKid((prev) => ({ ...prev, [studentId]: [] }));
    } finally {
      if (!silent) setTextbookLoading(false);
    }
  }


  async function loadParentNotifications(silent = false) {
    if (!silent) setNotificationsLoading(true);
    setNotificationsMsg(null);
    try {
      const res = await fetch("/api/parent/notifications?limit=80", {
        cache: "no-store",
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Impossible de charger les notifications.");
      setNotifications(Array.isArray(j?.items) ? j.items : []);
    } catch (e: any) {
      setNotificationsMsg(e?.message || "Notifications indisponibles.");
    } finally {
      if (!silent) setNotificationsLoading(false);
    }
  }

  async function markNotificationsRead(ids?: string[]) {
    const targetIds = (ids?.length ? ids : notifications.filter((item) => !item.read_at).map((item) => item.id)).filter(Boolean);
    if (!targetIds.length) return;
    const readAt = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((item) =>
        targetIds.includes(item.id) ? { ...item, read_at: item.read_at || readAt } : item,
      ),
    );
    try {
      await fetch("/api/parent/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: targetIds }),
      });
    } catch {}
  }

  async function saveSmsContact() {
    setSmsSaving(true);
    setSmsMsg(null);

    try {
      const hasExisting = !!smsPrimaryContact?.id;
      const method = hasExisting ? "PATCH" : "POST";

      const body: any = {
        phone: smsPhone,
        institution_id: smsInstitutionId || null,
        sms_enabled: smsEnabled,
        is_primary: true,
      };

      if (hasExisting) body.id = smsPrimaryContact!.id;

      const res = await fetch("/api/parent/notification-contacts", {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setSmsMsg(j?.error || "Impossible d’enregistrer le numéro SMS.");
        return;
      }

      setSmsMsg("Numéro SMS enregistré avec succès ✅");
      await loadSmsContacts(true);
    } catch (e: any) {
      setSmsMsg(e?.message || "Erreur lors de l’enregistrement du numéro.");
    } finally {
      setSmsSaving(false);
    }
  }

  async function removeSmsContact() {
    if (!smsPrimaryContact?.id) return;

    setSmsSaving(true);
    setSmsMsg(null);

    try {
      const res = await fetch("/api/parent/notification-contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: smsPrimaryContact.id }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setSmsMsg(j?.error || "Impossible de supprimer le contact SMS.");
        return;
      }

      setSmsMsg("Contact SMS supprimé.");
      await loadSmsContacts(true);
    } catch (e: any) {
      setSmsMsg(e?.message || "Erreur lors de la suppression du contact.");
    } finally {
      setSmsSaving(false);
    }
  }

  async function loadKids(from?: string, to?: string): Promise<Kid[]> {
    setLoadingKids(true);
    setMsg(null);
    try {
      const j = await fetch("/api/parent/children", {
        cache: "no-store",
        credentials: "include",
      }).then((r) => r.json());
      const ks = (j.items || []) as Kid[];
      setKids(ks);

      setActiveChildId((prev) => {
        if (prev && ks.some((k) => k.id === prev)) return prev;
        if (ks.length > 0) return ks[0].id;
        return "";
      });

      const feedEntries: Array<[string, Ev[]]> = [];
      const penEntries: Array<[string, KidPenalty[]]> = [];
      const gradeEntries: Array<[string, KidGradeRow[]]> = [];
      const gradeErrs: Record<string, string> = {};

      for (const k of ks) {
        const f = await fetch(
          `/api/parent/children/events?student_id=${encodeURIComponent(
            k.id,
          )}&limit=50`,
          { cache: "no-store", credentials: "include" },
        ).then((r) => r.json());
        feedEntries.push([k.id, (f.items || []) as Ev[]]);

        const p = await fetch(
          `/api/parent/children/penalties?student_id=${encodeURIComponent(
            k.id,
          )}&limit=20`,
          { cache: "no-store", credentials: "include" },
        )
          .then((r) => r.json())
          .catch(() => ({ items: [] }));
        penEntries.push([k.id, (p.items || []) as KidPenalty[]]);

        const sid = encodeURIComponent(k.id);
        const gradeUrls = [
          `/api/parent/children/grades?student_id=${sid}&limit=200`,
          `/api/parents/children/grades?student_id=${sid}&limit=200`,
          `/api/parent/children/grades/published?student_id=${sid}&limit=200`,
        ];

        const gRes = await firstOkItems(gradeUrls, {
          cache: "no-store",
          credentials: "include",
        });

        if (gRes.ok) {
          gradeEntries.push([k.id, (gRes.items || []) as KidGradeRow[]]);
        } else {
          gradeEntries.push([k.id, []]);
          gradeErrs[k.id] = "err" in gRes ? gRes.err : "Notes indisponibles.";
        }
      }

      setFeed(Object.fromEntries(feedEntries));
      setKidPenalties(Object.fromEntries(penEntries));
      setKidGrades(Object.fromEntries(gradeEntries));
      setKidGradesErr(gradeErrs);

      const initialExpanded: Record<string, boolean> = {};
      for (const [kidId, list] of feedEntries) {
        const groups = groupByDay(list);
        for (const g of groups)
          if (g.items.length === 1) initialExpanded[`${kidId}|${g.day}`] = true;
      }
      setExpanded(initialExpanded);

      const useFrom = from || conductFrom;
      const useTo = to || conductTo;
      await loadConductForAll(ks, useFrom, useTo);
      return ks;
    } catch (e: any) {
      setMsg(e?.message || "Erreur de chargement.");
      return [];
    } finally {
      setLoadingKids(false);
    }
  }

  async function attachChildByMatricule(e?: React.FormEvent) {
    e?.preventDefault?.();
    const cleanMatricule = attachMatricule.trim().toUpperCase();
    if (!cleanMatricule) return;

    setAttachBusy(true);
    setAttachMsg(null);
    const beforeIds = new Set(kids.map((k) => k.id));

    try {
      const res = await fetch("/api/parent/children/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ matricule: cleanMatricule }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = String(j?.error || "ATTACH_FAILED");
        setAttachMsg(err === "MATRICULE_NOT_FOUND" ? "Matricule introuvable." : "Impossible d’ajouter cet enfant pour le moment.");
        return;
      }

      const refreshedKids = await loadKids(conductFrom, conductTo);
      const hintedId = String(j?.child?.id || j?.item?.id || j?.student_id || "").trim();
      const added =
        refreshedKids.find((k) => k.id === hintedId) ||
        refreshedKids.find((k) => !beforeIds.has(k.id)) ||
        refreshedKids.find((k) => k.id !== activeChildId) ||
        null;

      if (added) {
        setActiveChildId(added.id);
        setActiveSection("textbook");
      }
      setAttachMatricule("");
      setAttachMsg("Enfant ajouté avec succès.");
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e: any) {
      setAttachMsg(e?.message || "Échec de l’ajout. Réessayez.");
    } finally {
      setAttachBusy(false);
    }
  }


  // premier chargement
  useEffect(() => {
    if (!conductFrom || !conductTo) return;
    loadKids(conductFrom, conductTo);
    loadSmsContacts(true);
    loadGradePeriods();
    loadBulletins();
    loadParentNotifications(true);
    ensurePushSubscription().then((r) => {
      if (r.ok) setGranted(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conductFrom, conductTo]);

  useEffect(() => {
    if (!selectedKidPeriods.length) return;
    setSelectedPeriodId((prev) => {
      if (prev && selectedKidPeriods.some((p) => p.id === prev)) return prev;
      const today = yyyyMMdd(new Date());
      const current = selectedKidPeriods.find(
        (p) => p.start_date && p.end_date && p.start_date <= today && today <= p.end_date,
      );
      return (current || selectedKidPeriods[0]).id;
    });
  }, [selectedKidPeriods]);

  useEffect(() => {
    if (!activeGradePeriod) return;
    setGradeFrom(activeGradePeriod.start_date || "");
    setGradeTo(activeGradePeriod.end_date || "");
    if (activeGradePeriod.start_date && activeGradePeriod.end_date && kids.length) {
      loadConductForAll(kids, activeGradePeriod.start_date, activeGradePeriod.end_date);
      setConductFrom(activeGradePeriod.start_date);
      setConductTo(activeGradePeriod.end_date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGradePeriod?.id]);

  useEffect(() => {
    if (!selectedKid?.id) return;
    loadTextbookForKid(selectedKid.id, true);
    setActiveTextbookSubject("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKid?.id]);

  async function enablePush() {
    setMsg(null);
    const r = await ensurePushSubscription();
    if (r.ok) {
      setGranted(true);
      setMsg("Notifications push activées.");
    } else {
      setMsg("Activation push impossible: " + r.reason);
    }
  }

  /* ————————— Déconnexion “propre” ————————— */
  async function safeLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setMsg("Déconnexion en cours…");

    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        const device_id = sub?.endpoint || "";

        if (device_id) {
          try {
            await fetch("/api/push/subscribe", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ device_id }),
            });
          } catch {}
          try {
            await fetch("/api/push/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ device_id }),
            });
          } catch {}
        }
        try {
          await sub?.unsubscribe();
        } catch {}
      }

      try {
        await fetch("/api/auth/sync", {
          method: "DELETE",
          credentials: "include",
        });
      } catch {}
    } finally {
      window.location.assign(LOGOUT_PARENTS);
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.location.replace(LOGIN_PARENTS);
        }
      }, 1500);
    }
  }

  function selectSection(section: NavSection) {
    setActiveSection(section);
    if (section === "notifications") loadParentNotifications(true);
    if (section === "textbook" && selectedKid) loadTextbookForKid(selectedKid.id, true);
    setMobileNavOpen(false);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openChildSection(childId: string, section: NavSection = "textbook") {
    setActiveChildId(childId);
    setActiveSection(section);
    setMobileNavOpen(false);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }


  function rubricCellValue(val: number, max: number) {
    if (!(Number.isFinite(max) && max > 0)) return "Désactivée";
    return val.toFixed(2).replace(".", ",");
  }

  /* ————————— RENDER ————————— */
  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 text-slate-900 text-[15px]">
      {/* ————— Drawer mobile ————— */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="relative flex h-full w-80 max-w-[86%] flex-col overflow-y-auto overscroll-contain bg-[#003766] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/15 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-white">
                  <IconFamily />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="text-[12px] opacity-90">Bienvenue cher parent</div>
                  <div className="text-[15px] font-extrabold truncate">
                    Espace parent Mon Cahier
                  </div>
                  <div className="mt-1 truncate text-[11px] text-white/80">
                    Cahier de texte, assiduité, notes et bulletins.
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-emerald-200">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <span>En ligne</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                aria-label="Fermer le menu"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10"
              >
                <IconX />
              </button>
            </div>

            <div className="border-b border-white/10 px-4 py-3">
              <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
                Navigation
              </div>
              <button
                type="button"
                onClick={() => selectSection("home")}
                className={[
                  "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                  isHome ? "bg-white text-[#003766]" : "bg-white/10 text-white hover:bg-white/15",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid h-10 w-10 place-items-center rounded-2xl",
                    isHome ? "bg-[#e7f0fa] text-[#003766]" : "bg-white/10 text-white",
                  ].join(" ")}
                >
                  <IconHome />
                </span>
                <span>Accueil</span>
              </button>
              <button
                type="button"
                onClick={() => selectSection("textbook")}
                className={[
                  "mt-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                  isTextbook ? "bg-white text-[#003766]" : "bg-white/10 text-white hover:bg-white/15",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                    isTextbook ? "bg-[#e8f8ef] text-[#166534]" : "bg-white/15 text-white",
                  ].join(" ")}
                >
                  <IconBook />
                </span>
                <span className="min-w-0 flex-1 truncate">Cahier de texte</span>
              </button>
              <button
                type="button"
                onClick={() => selectSection("notifications")}
                className={[
                  "mt-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                  isNotifications ? "bg-white text-[#003766]" : "bg-white/10 text-white hover:bg-white/15",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                    isNotifications ? "bg-[#fff3db] text-[#9a5d00]" : "bg-white/15 text-white",
                  ].join(" ")}
                >
                  <IconBell />
                </span>
                <span className="min-w-0 flex-1 truncate">Notifications</span>
                {unreadNotificationsCount > 0 ? (
                  <span className="grid min-h-6 min-w-6 place-items-center rounded-full bg-amber-300 px-2 text-[12px] font-black text-[#003766]">
                    {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="border-b border-white/10 px-4 py-3">
              <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
                Ajouter un enfant
              </div>
              <form onSubmit={attachChildByMatricule} className="space-y-2">
                <Input
                  value={attachMatricule}
                  onChange={(e) => setAttachMatricule(e.target.value.toUpperCase())}
                  placeholder="Matricule élève"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  className="border-white/15 bg-white text-slate-900"
                />
                <Button
                  type="submit"
                  tone="white"
                  disabled={attachBusy || !attachMatricule.trim()}
                  className="w-full justify-center rounded-2xl"
                >
                  {attachBusy ? "Ajout…" : "Ajouter l’enfant"}
                </Button>
              </form>
              {attachMsg && (
                <div className="mt-3 rounded-2xl bg-white/10 px-3 py-3 text-[13px] text-white/90">
                  {attachMsg}
                </div>
              )}
            </div>

            <div className="border-b border-white/10 px-4 py-3">
              <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
                Enfants
              </div>
              <div className="space-y-2">
                {kids.map((k) => {
                  const active = activeChildId === k.id;
                  return (
                    <button
                      key={k.id}
                      onClick={() => {
                        openChildSection(k.id);
                      }}
                      className={[
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-[14px] font-semibold",
                        active
                          ? "bg-white/90 text-[#003766]"
                          : "text-white hover:bg-white/10",
                      ].join(" ")}
                    >
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-white">
                        <IconChild />
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="truncate">{k.full_name}</div>
                        <div className="truncate text-[12px] text-emerald-100">
                          {k.class_label || "—"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1" />

            <div className="border-t border-white/15 px-4 py-4">
              <Button
                tone="white"
                onClick={safeLogout}
                disabled={loggingOut}
                iconLeft={<IconPower />}
                className="w-full justify-start rounded-2xl"
              >
                {loggingOut ? "Déconnexion…" : "Se déconnecter"}
              </Button>
              <div className="mt-4 leading-tight text-white/80">
                <div className="text-[12px] opacity-80">Développé par</div>
                <div className="text-[15px] font-extrabold text-amber-300">
                  Nexa Digital SARL
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Fermer le menu"
            className="flex-1 bg-black/30"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* ————— HEADER PRINCIPAL sticky ————— */}
      <header className="sticky top-0 z-30 bg-[#003766] text-white shadow">
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-3 py-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#006633] text-white lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <IconMenu />
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-white">
                <IconFamily />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-extrabold uppercase tracking-wide">
                  Mon Cahier
                </div>
                <div className="text-[12px] opacity-80 truncate">
                  Espace parent
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => selectSection("notifications")}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white transition hover:bg-white/15"
              aria-label="Ouvrir les notifications"
            >
              <IconBell />
              {unreadNotificationsCount > 0 ? (
                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-300 px-1 text-[11px] font-black text-[#003766] ring-2 ring-[#003766]">
                  {unreadNotificationsCount > 9 ? "9+" : unreadNotificationsCount}
                </span>
              ) : null}
            </button>
            <div className="text-right leading-tight">
              <div className="font-extrabold uppercase tracking-[0.25em] text-amber-300 text-[12px]">
                PARENT
              </div>
              <div className="text-[13px] font-bold">2025-2026</div>
            </div>
          </div>
        </div>
      </header>

      {/* ————— CORPS ————— */}
      <div className="mx-auto grid w-full max-w-[1440px] min-w-0 grid-cols-1 gap-0 px-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        {/* Sidebar desktop */}
        <aside className="hidden w-full shrink-0 bg-[#003766] text-white lg:sticky lg:top-[72px] lg:flex lg:h-[calc(100vh-72px)] lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:rounded-b-[28px] lg:shadow-xl lg:shadow-slate-900/10">
          <div className="border-b border-white/15 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-white">
                <IconFamily />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-[12px]">Bienvenue cher parent</div>
                <div className="text-[15px] font-extrabold truncate">
                  Espace parent Mon Cahier
                </div>
                <div className="mt-1 truncate text-[11px] text-white/80">
                  Cahier de texte, assiduité, notes et bulletins.
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-emerald-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span>En ligne</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-white/15 px-4 py-3">
            <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
              Navigation
            </div>
            <button
              type="button"
              onClick={() => selectSection("home")}
              className={[
                "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                isHome ? "bg-white text-[#003766]" : "bg-white/10 text-white hover:bg-white/15",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-10 w-10 place-items-center rounded-2xl",
                  isHome ? "bg-[#e7f0fa] text-[#003766]" : "bg-white/10 text-white",
                ].join(" ")}
              >
                <IconHome />
              </span>
              <span>Accueil</span>
            </button>
            <button
              type="button"
              onClick={() => selectSection("textbook")}
              className={[
                "mt-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                isTextbook ? "bg-white text-[#003766]" : "bg-white/10 text-white hover:bg-white/15",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                  isTextbook ? "bg-[#e8f8ef] text-[#166534]" : "bg-white/15 text-white",
                ].join(" ")}
              >
                <IconBook />
              </span>
              <span className="min-w-0 flex-1 truncate">Cahier de texte</span>
            </button>
            <button
              type="button"
              onClick={() => selectSection("notifications")}
              className={[
                "mt-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                isNotifications ? "bg-white text-[#003766]" : "bg-white/10 text-white hover:bg-white/15",
              ].join(" ")}
              >
                <span
                  className={[
                    "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                    isNotifications ? "bg-[#fff3db] text-[#9a5d00]" : "bg-white/15 text-white",
                  ].join(" ")}
                >
                  <IconBell />
                </span>
                <span className="min-w-0 flex-1 truncate">Notifications</span>
                {unreadNotificationsCount > 0 ? (
                  <span className="grid min-h-6 min-w-6 place-items-center rounded-full bg-amber-300 px-2 text-[12px] font-black text-[#003766]">
                    {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
                  </span>
                ) : null}
              </button>
          </div>

          <div className="border-b border-white/15 px-4 py-3">
            <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
              Ajouter un enfant
            </div>
            <form onSubmit={attachChildByMatricule} className="space-y-2">
              <Input
                value={attachMatricule}
                onChange={(e) => setAttachMatricule(e.target.value.toUpperCase())}
                placeholder="Matricule élève"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                className="border-white/15 bg-white text-slate-900"
              />
              <Button
                type="submit"
                tone="white"
                disabled={attachBusy || !attachMatricule.trim()}
                className="w-full justify-center rounded-2xl"
              >
                {attachBusy ? "Ajout…" : "Ajouter l’enfant"}
              </Button>
            </form>
            {attachMsg && (
              <div className="mt-3 rounded-2xl bg-white/10 px-3 py-3 text-[13px] text-white/90">
                {attachMsg}
              </div>
            )}
          </div>

          <div className="border-b border-white/15 px-4 py-3">
            <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
              Enfants
            </div>
            <div className="space-y-2">
              {kids.map((k) => {
                const active = activeChildId === k.id;
                return (
                  <button
                    key={k.id}
                    onClick={() => openChildSection(k.id)}
                    className={[
                      "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-[14px] font-semibold",
                      active
                        ? "bg-white/90 text-[#003766]"
                        : "text-white hover:bg-white/10",
                    ].join(" ")}
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-[12px] font-extrabold">
                      {getInitials(k.full_name)}
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="truncate">{k.full_name}</div>
                      <div className="truncate text-[12px] text-emerald-100">
                        {k.class_label || "—"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1" />

          <div className="border-t border-white/15 px-4 py-4">
            <Button
              tone="white"
              onClick={safeLogout}
              disabled={loggingOut}
              iconLeft={<IconPower />}
              className="w-full justify-start rounded-2xl"
            >
              {loggingOut ? "Déconnexion…" : "Se déconnecter"}
            </Button>
            <div className="mt-4 leading-tight text-white/80">
              <div className="text-[12px] opacity-80">Développé par</div>
              <div className="text-[15px] font-extrabold text-amber-300">
                Nexa Digital SARL
              </div>
            </div>
          </div>
        </aside>

        {/* Contenu principal */}
        <main className="min-w-0 px-3 py-5 pb-6 sm:px-4 lg:px-0 lg:py-6">
          <div className="mb-5 flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm lg:px-5">
            <div className="text-[12px] text-slate-500">
              Vous êtes ici : <span className="mx-1">›</span> {currentSectionMeta.breadcrumb}
            </div>
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <h1 className="text-2xl font-extrabold text-slate-900">
                {currentSectionMeta.title}
              </h1>
              <div className="text-[14px] font-semibold text-slate-600">
                {isHome
                  ? "Cahier de texte, assiduité, notes et bulletins."
                  : selectedKid?.full_name || "Aucun enfant sélectionné"}
                {!isHome && selectedKid?.class_label
                  ? ` · ${selectedKid.class_label}`
                  : ""}
              </div>
            </div>
          </div>

          {msg && (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-800">
              {msg}
            </div>
          )}

          {isHome && (
            <>
              {(() => {
                const k = selectedKid;
                const periodLabel = activeGradePeriod?.short_label || activeGradePeriod?.label || "Période en cours";
                const periodGrades = k
                  ? (kidGrades[k.id] || []).filter((g) =>
                      isInDateRange(g.eval_date, gradeFrom || undefined, gradeTo || undefined),
                    )
                  : [];
                const bulletinForPeriod = k
                  ? findBulletinForPeriod(
                      bulletinsByKid.get(k.id) || [],
                      gradeFrom || undefined,
                      gradeTo || undefined,
                      periodLabel,
                    )
                  : null;
                const officialAverage = averageFromBulletin(bulletinForPeriod);
                const overallAverage = officialAverage ?? weightedAverageOn20(periodGrades);
                const averageCaption = officialAverage !== null ? "Moyenne bulletin" : "Moyenne provisoire";
                const latestGrade = latestGradeOf(periodGrades);
                const periodEvents = k
                  ? (feed[k.id] || []).filter((ev) =>
                      isInDateRange(ev.when, conductFrom || undefined, conductTo || undefined),
                    )
                  : [];
                const conductForKid = k ? conduct[k.id] || null : null;
                const absencesCount = periodEvents.filter((ev) => ev.type === "absent").length;
                const latesCount = periodEvents.filter((ev) => ev.type === "late").length;
                const totalLateMinutes = periodEvents.reduce(
                  (sum, ev) => sum + (ev.type === "late" ? Number(ev.minutes_late || 0) : 0),
                  0,
                );
                const kidTextbook = k ? textbookByKid[k.id] || [] : [];
                const totalProgressions = kidTextbook.length;
                const averageProgress = totalProgressions
                  ? Math.round(kidTextbook.reduce((sum, item) => sum + Number(item.progress_percent || 0), 0) / totalProgressions)
                  : 0;
                const latestTextbookSession = kidTextbook
                  .flatMap((item) => visibleParentSessions(item.items).map((session) => ({ ...session, subject_name: item.subject_name })))
                  .sort((a, b) => String(b.session_date || "").localeCompare(String(a.session_date || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
                const homeworkCount = kidTextbook
                  .flatMap((item) => visibleParentSessions(item.items))
                  .filter((session) => String(session.homework || "").trim()).length;
                const latestBulletin = bulletinForPeriod || (k ? (bulletinsByKid.get(k.id) || [])[0] || null : null);

                return (
                  <>
                    <section className="mb-5 rounded-[32px] bg-gradient-to-r from-[#003766] via-[#0057a8] to-[#0c7d70] p-5 text-white shadow-sm lg:p-6">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[24px] bg-white/15 text-white sm:h-16 sm:w-16">
                            <IconFamily />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[12px] font-black uppercase tracking-[0.22em] text-amber-300">Espace parent</div>
                            <h2 className="mt-1 text-2xl font-black">Suivi de votre enfant</h2>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="emerald">{kids.length} enfant{kids.length > 1 ? "s" : ""}</Badge>
                          {periodLabel ? <span className="rounded-full bg-white/12 px-3 py-1 text-[12px] font-bold text-white ring-1 ring-white/10">{periodLabel}</span> : null}
                        </div>
                      </div>

                      {k ? (
                        <div className="mt-5 rounded-[28px] bg-white/10 p-4 ring-1 ring-white/10">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate text-lg font-black">{k.full_name}</div>
                              <div className="mt-1 text-sm text-white/80">{k.class_label || "Classe non précisée"}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openChildSection(k.id, "textbook")}
                                className="rounded-2xl bg-white px-4 py-2 text-[13px] font-black text-[#003766] transition hover:bg-white/90"
                              >
                                Cahier de texte
                              </button>
                              <button
                                type="button"
                                onClick={() => openChildSection(k.id, "absences")}
                                className="rounded-2xl bg-white/10 px-4 py-2 text-[13px] font-black text-white ring-1 ring-white/15 transition hover:bg-white/15"
                              >
                                Absences
                              </button>
                              {latestBulletin ? (
                                <a
                                  href={latestBulletin.url}
                                  className="rounded-2xl bg-amber-300 px-4 py-2 text-[13px] font-black text-[#003766] transition hover:bg-amber-200"
                                >
                                  Bulletin
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    {loadingKids ? (
                      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-32 w-full" />
                      </section>
                    ) : !hasKids ? (
                      <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
                        Aucun enfant lié à votre compte pour l’instant. Ajoutez un enfant avec son matricule depuis le menu.
                      </section>
                    ) : (
                      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <button
                          type="button"
                          onClick={() => k && openChildSection(k.id, "textbook")}
                          className="rounded-[28px] border border-emerald-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md xl:col-span-2"
                        >
                          <div className="text-[12px] font-black uppercase tracking-[0.16em] text-emerald-700">Cahier de texte</div>
                          <div className="mt-2 flex items-end gap-2">
                            <span className="text-3xl font-black text-slate-950">{averageProgress}%</span>
                            <span className="pb-1 text-[13px] font-bold text-slate-500">progression</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-slate-100">
                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, averageProgress))}%` }} />
                          </div>
                          <div className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2 text-[13px] font-bold text-emerald-800">
                            {latestTextbookSession
                              ? `${latestTextbookSession.subject_name || "Matière"} · ${latestTextbookSession.item_title}`
                              : totalProgressions
                                ? `${totalProgressions} progression${totalProgressions > 1 ? "s" : ""} suivie${totalProgressions > 1 ? "s" : ""}`
                                : "Aucune progression affectée"}
                          </div>
                          <div className="mt-2 text-[12px] font-semibold text-slate-500">
                            {homeworkCount} devoir{homeworkCount > 1 ? "s" : ""} / travail à faire renseigné{homeworkCount > 1 ? "s" : ""}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => k && openChildSection(k.id, "absences")}
                          className="rounded-[28px] border border-amber-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                        >
                          <div className="text-[12px] font-black uppercase tracking-[0.16em] text-amber-700">Assiduité</div>
                          <div className="mt-2 flex items-end gap-2">
                            <span className="text-2xl font-black text-slate-950">{absencesCount}</span>
                            <span className="pb-1 text-[13px] font-bold text-slate-500">absence{absencesCount > 1 ? "s" : ""}</span>
                          </div>
                          <div className="mt-1 text-[13px] font-semibold text-slate-500">
                            {latesCount} retard{latesCount > 1 ? "s" : ""}{totalLateMinutes ? ` · ${totalLateMinutes} min` : ""}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => k && openChildSection(k.id, "notes")}
                          className="rounded-[28px] border border-sky-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                        >
                          <div className="text-[12px] font-black uppercase tracking-[0.16em] text-sky-700">Notes</div>
                          <div className="mt-2 text-2xl font-black text-slate-950">{formatAverage(overallAverage)}/20</div>
                          <div className="mt-1 text-[13px] font-semibold text-slate-500">{averageCaption}</div>
                          <div className="mt-3 rounded-2xl bg-sky-50 px-3 py-2 text-[13px] font-bold text-sky-800">
                            {latestGrade ? `${latestGrade.subject_name || "Matière"} · ${formatGradeScore(latestGrade)}` : "Aucune note publiée"}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => k && openChildSection(k.id, "conduct")}
                          className="rounded-[28px] border border-violet-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                        >
                          <div className="text-[12px] font-black uppercase tracking-[0.16em] text-violet-700">Conduite</div>
                          <div className="mt-2 text-2xl font-black text-slate-950">{conductForKid ? conductForKid.total.toFixed(2).replace(".", ",") : "—"}</div>
                          <div className="mt-1 text-[13px] font-semibold text-slate-500">{conductForKid?.appreciation || "Temps réel"}</div>
                        </button>

                        <div className="rounded-[28px] border border-slate-200 bg-white p-4 text-left shadow-sm">
                          <div className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-600">Bulletin</div>
                          <div className="mt-2 text-lg font-black text-slate-950">
                            {latestBulletin ? "Disponible" : "Non disponible"}
                          </div>
                          <div className="mt-1 text-[13px] font-semibold text-slate-500">
                            {latestBulletin?.period_label || "Dernier bulletin publié"}
                          </div>
                          {latestBulletin ? (
                            <a
                              href={latestBulletin.url}
                              className="mt-3 inline-flex rounded-2xl bg-slate-900 px-3 py-2 text-[13px] font-black text-white transition hover:bg-slate-800"
                            >
                              Ouvrir
                            </a>
                          ) : null}
                        </div>
                      </section>
                    )}

                  </>
                );
              })()}
            </>
          )}

          {selectedKid && !isHome && (
            <div className="mb-5 rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
                {tabs.map((tab) => {
                  const active = activeSection === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => selectSection(tab.key)}
                      className={[
                        "flex min-w-[132px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-center text-[14px] font-extrabold transition-transform duration-150 hover:-translate-y-0.5 sm:min-h-[76px] sm:w-full sm:justify-start sm:gap-3 sm:rounded-[24px] sm:px-5 sm:py-4 sm:text-left",
                        active ? tab.activeClass : tab.idleClass,
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-12 sm:w-12 sm:rounded-2xl",
                          active ? "bg-white/15 text-white" : "bg-white/70",
                        ].join(" ")}
                      >
                        {tab.icon}
                      </span>
                      <span className="text-[14px] leading-none sm:text-[17px]">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!selectedKid && !loadingKids && !isHome && (
            <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 text-center text-[15px] text-slate-600 shadow-sm">
              Sélectionnez un enfant pour afficher son tableau de bord.
            </div>
          )}

          {showTextbookSection && selectedKid && (
            <section className="mb-6 space-y-4">
              {(() => {
                const progressions = selectedKidTextbook;
                const subjects = Array.from(new Set(progressions.map((p) => p.subject_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr"));
                const filtered = activeTextbookSubject === "all"
                  ? progressions
                  : progressions.filter((p) => p.subject_name === activeTextbookSubject);
                const allSessions = filtered
                  .flatMap((prog) => visibleParentSessions(prog.items).map((session) => ({ ...session, subject_name: prog.subject_name, progression_title: prog.progression.title })))
                  .slice(0, 8);
                const homeworks = allSessions.filter((session) => String(session.homework || "").trim()).slice(0, 5);
                const avgProgress = filtered.length
                  ? Math.round(filtered.reduce((sum, p) => sum + Number(p.progress_percent || 0), 0) / filtered.length)
                  : 0;

                return (
                  <>
                    <div className="rounded-[32px] border border-emerald-100 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-[12px] font-black uppercase tracking-[0.18em] text-emerald-700">Cahier de texte</div>
                          <h2 className="mt-1 text-2xl font-black text-slate-950">Suivi de la progression</h2>
                          <p className="mt-1 max-w-2xl text-[14px] font-semibold text-slate-500">
                            Les leçons vues en classe, le contenu de séance et le travail à faire.
                          </p>
                        </div>
                        <div className="min-w-[180px] rounded-3xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-100">
                          <div className="text-3xl font-black text-emerald-700">{avgProgress}%</div>
                          <div className="mt-1 text-[12px] font-black uppercase tracking-[0.12em] text-emerald-800">Avancement</div>
                        </div>
                      </div>

                      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                        <button
                          type="button"
                          onClick={() => setActiveTextbookSubject("all")}
                          className={[
                            "shrink-0 rounded-full px-4 py-2 text-[13px] font-black ring-1 transition",
                            activeTextbookSubject === "all" ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                          ].join(" ")}
                        >
                          Toutes
                        </button>
                        {subjects.map((subject) => (
                          <button
                            key={subject}
                            type="button"
                            onClick={() => setActiveTextbookSubject(subject)}
                            className={[
                              "shrink-0 rounded-full px-4 py-2 text-[13px] font-black ring-1 transition",
                              activeTextbookSubject === subject ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            {subject}
                          </button>
                        ))}
                      </div>
                    </div>

                    {textbookLoading ? (
                      <div className="grid gap-3 lg:grid-cols-3">
                        <Skeleton className="h-40" />
                        <Skeleton className="h-40" />
                        <Skeleton className="h-40" />
                      </div>
                    ) : textbookMsg ? (
                      <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 text-sm font-bold text-rose-700">{textbookMsg}</div>
                    ) : !filtered.length ? (
                      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                        <div className="text-xl font-black text-slate-950">Aucune progression disponible</div>
                        <p className="mt-2 text-sm font-semibold text-slate-500">
                          L’établissement doit affecter les progressions à la classe de votre enfant.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                          <div className="space-y-3">
                            {filtered.map((prog) => {
                              const completed = prog.items.filter((item) => item.completion?.status === "completed").length;
                              const total = prog.items.length;
                              return (
                                <article key={prog.assignment_id} className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-black uppercase tracking-[0.16em] text-emerald-700">{prog.subject_name}</div>
                                      <h3 className="mt-1 truncate text-xl font-black text-slate-950">{prog.progression.title}</h3>
                                      <div className="mt-1 text-sm font-semibold text-slate-500">
                                        {completed}/{total} élément{total > 1 ? "s" : ""} terminé{completed > 1 ? "s" : ""} · {prog.sessions_count} séance{prog.sessions_count > 1 ? "s" : ""}
                                      </div>
                                    </div>
                                    {prog.progression.document?.signed_url ? (
                                      <a
                                        href={prog.progression.document.signed_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-slate-900 px-4 py-2 text-[13px] font-black text-white hover:bg-slate-800"
                                      >
                                        PDF officiel
                                      </a>
                                    ) : null}
                                  </div>
                                  <div className="mt-4 h-2 rounded-full bg-slate-100">
                                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, prog.progress_percent || 0))}%` }} />
                                  </div>
                                  <div className="mt-3 flex items-center justify-between text-[13px] font-bold text-slate-600">
                                    <span>{prog.progress_percent || 0}%</span>
                                    <span>{formatHoursFromMinutes(prog.completed_total_minutes)} / {formatHoursFromMinutes(prog.planned_total_minutes)}</span>
                                  </div>
                                </article>
                              );
                            })}
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-[28px] border border-amber-200 bg-white p-4 shadow-sm">
                              <div className="text-[12px] font-black uppercase tracking-[0.16em] text-amber-700">Travail à faire</div>
                              <div className="mt-3 space-y-3">
                                {homeworks.length ? homeworks.map((session) => (
                                  <div key={session.id} className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-100">
                                    <div className="text-[13px] font-black text-slate-950">{session.subject_name} · {dateFr(session.session_date)}</div>
                                    <div className="mt-1 text-sm font-semibold text-amber-900">{session.homework}</div>
                                  </div>
                                )) : (
                                  <div className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">Aucun travail à faire renseigné récemment.</div>
                                )}
                              </div>
                            </div>

                            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                              <div className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-600">Dernières séances</div>
                              <div className="mt-3 space-y-3">
                                {allSessions.length ? allSessions.map((session) => (
                                  <div key={session.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="truncate text-[14px] font-black text-slate-950">{session.subject_name} · {session.item_title}</div>
                                        <div className="mt-1 text-[12px] font-bold text-slate-500">{dateFr(session.session_date)} {session.session_period_label ? `· ${session.session_period_label}` : ""}</div>
                                      </div>
                                      <Badge tone="emerald">{itemTypeLabel(session.item_type)}</Badge>
                                    </div>
                                    {session.content ? <p className="mt-2 text-sm font-semibold text-slate-700">{session.content}</p> : null}
                                  </div>
                                )) : (
                                  <div className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">Aucune séance renseignée pour le moment.</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </section>
          )}

          {isNotifications && (
            <section className="mb-6 rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-3xl bg-[#e7f0fa] text-[#003766]">
                  <IconPhone />
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold text-slate-900">
                    Préférences notifications
                  </h2>
                  <div className="mt-1 text-[14px] text-slate-500">
                    {smsPrimaryContact?.phone_e164
                      ? formatPhoneForDisplay(smsPrimaryContact.phone_e164)
                      : "Aucun numéro enregistré"}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={[
                        "grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-sm",
                        granted ? "bg-emerald-100 text-emerald-700" : "bg-white text-[#003766]",
                      ].join(" ")}
                    >
                      <IconBell />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[16px] font-extrabold text-slate-900">
                        Notifications push
                      </div>
                      <div className="mt-1 text-[14px] text-slate-500">
                        {granted
                          ? "Activées sur cet appareil"
                          : "Non activées sur cet appareil"}
                      </div>
                    </div>
                  </div>

                  {granted ? (
                    <Badge tone="emerald">Activées</Badge>
                  ) : (
                    <Button
                      type="button"
                      tone="outline"
                      onClick={enablePush}
                      iconLeft={<IconBell />}
                      className="sm:min-w-[220px]"
                    >
                      Activer les push
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-[13px] font-extrabold uppercase tracking-wide text-slate-600">
                  Numéro à rattacher
                </label>
                <Input
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                  placeholder="Ex : +2250713023762"
                  inputMode="tel"
                  className="h-14 text-[16px]"
                />
              </div>

              <div className="mt-4">
                <Toggle
                  checked={smsEnabled}
                  onChange={setSmsEnabled}
                  label={smsEnabled ? "SMS activés" : "SMS désactivés"}
                  description="Activer ou couper les SMS sur ce numéro."
                />
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  tone="emerald"
                  onClick={saveSmsContact}
                  disabled={smsSaving || smsLoading || !smsPhone.trim()}
                  iconLeft={<IconPhone />}
                  className="sm:min-w-[220px]"
                >
                  {smsSaving ? "Enregistrement…" : "Enregistrer"}
                </Button>

                {smsPrimaryContact?.id ? (
                  <Button
                    type="button"
                    tone="white"
                    onClick={removeSmsContact}
                    disabled={smsSaving}
                    className="sm:min-w-[190px]"
                  >
                    Supprimer
                  </Button>
                ) : null}
              </div>

              {smsMsg && (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] text-slate-700">
                  {smsMsg}
                </div>
              )}
            </section>
          )}

          {isNotifications && (
            <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[12px] font-black uppercase tracking-[0.16em] text-amber-800 ring-1 ring-amber-200">
                    <IconBell />
                    Notifications parent
                  </div>
                  <h2 className="mt-3 text-xl font-black text-slate-900">Alertes, messages et rappels financiers</h2>
                  <p className="mt-1 max-w-2xl text-[14px] leading-6 text-slate-600">
                    Les rappels de solde scolarité et internat apparaissent ici chaque mois.
                    Si l’établissement a activé le SMS premium pour les rappels financiers, le parent peut aussi recevoir le rappel par SMS.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" tone="outline" onClick={() => loadParentNotifications(false)} disabled={notificationsLoading}>
                    {notificationsLoading ? "Actualisation…" : "Actualiser"}
                  </Button>
                  <Button type="button" tone="slate" onClick={() => markNotificationsRead()} disabled={!unreadNotificationsCount}>
                    Tout marquer lu
                  </Button>
                </div>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-slate-500">Total</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{notifications.length}</div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-amber-700">Non lues</div>
                  <div className="mt-1 text-2xl font-black text-amber-900">{unreadNotificationsCount}</div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-emerald-700">Rappels financiers</div>
                  <div className="mt-1 text-2xl font-black text-emerald-900">{financeReminderCount}</div>
                </div>
              </div>

              {notificationsMsg ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">
                  {notificationsMsg}
                </div>
              ) : null}

              {notificationsLoading && !notifications.length ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : !notifications.length ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-[14px] text-slate-600">
                  Aucune notification pour le moment.
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map((item) => {
                    const tone = notificationTone(item.payload, item.severity);
                    const isUnread = !item.read_at;
                    return (
                      <article
                        key={item.id}
                        className={[
                          "rounded-2xl border px-4 py-4 transition",
                          isUnread ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white",
                        ].join(" ")}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Badge tone={tone}>{notificationKindLabel(item.payload)}</Badge>
                              {isUnread ? <Badge tone="amber">Non lue</Badge> : <Badge>Déjà lue</Badge>}
                              <span className="text-[12px] font-semibold text-slate-500">
                                {formatNotificationDate(item.created_at)}
                              </span>
                            </div>
                            <h3 className="text-[16px] font-black text-slate-900">
                              {item.title || "Notification"}
                            </h3>
                            {item.body ? (
                              <p className="mt-1 text-[14px] leading-6 text-slate-700">{item.body}</p>
                            ) : null}
                            {item.payload?.url ? (
                              <a
                                href={String(item.payload.url)}
                                className="mt-3 inline-flex text-[13px] font-black text-[#003766] underline-offset-4 hover:underline"
                              >
                                Ouvrir le détail
                              </a>
                            ) : null}
                          </div>
                          {isUnread ? (
                            <Button
                              type="button"
                              tone="white"
                              className="shrink-0 rounded-2xl px-3 py-2 text-[13px]"
                              onClick={() => markNotificationsRead([item.id])}
                            >
                              Marquer lu
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ————— CONDUITE ————— */}

          {showConductSection && (
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[13px] font-extrabold uppercase tracking-wide text-slate-700">
                    Conduite — points par rubrique
                  </div>
                  <div className="mt-1 text-[13px] text-slate-500">
                    Filtre par trimestre de l’année scolaire.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedKidPeriods.length ? (
                    <select
                      value={activeGradePeriod?.id || ""}
                      onChange={(e) => setSelectedPeriodId(e.target.value)}
                      className="h-12 w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-[15px] font-bold text-slate-800 shadow-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:min-w-[190px]"
                    >
                      {selectedKidPeriods.map((period) => (
                        <option key={period.id} value={period.id}>
                          {period.short_label || period.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="rounded-2xl bg-slate-100 px-4 py-2 text-[13px] font-bold text-slate-600">
                      Trimestres non configurés
                    </div>
                  )}
                  {conductFrom && conductTo ? (
                    <span className="rounded-2xl bg-slate-100 px-3 py-2 text-center text-[12px] font-bold text-slate-600 sm:text-left">
                      {dateFr(conductFrom)} au {dateFr(conductTo)}
                    </span>
                  ) : null}
                </div>
              </div>


              {loadingKids ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : !hasKids ? (
                <div className="rounded-2xl border bg-slate-50 p-4 text-[15px] text-slate-700">
                  Aucun enfant lié à votre compte pour l’instant.
                </div>
              ) : (
                <>
                  <div className="space-y-4 md:hidden">
                    {filteredKids.map((k) => {
                      const c = conduct[k.id];
                      return (
                        <div
                          key={k.id}
                          className="rounded-2xl border border-slate-200 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-extrabold text-slate-900 text-[16px]">
                                {k.full_name}
                              </div>
                              <div className="text-[13px] text-slate-600">
                                {k.class_label || "—"}
                              </div>
                            </div>
                            {c ? (
                              <Badge tone="emerald">Points de conduite</Badge>
                            ) : (
                              <Badge>—</Badge>
                            )}
                          </div>

                          {c ? (
                            <div className="mt-4 space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <VerticalGauge
                                  label="Assiduité"
                                  value={c.breakdown.assiduite}
                                  max={c.rubric_max.assiduite}
                                  rubric="assiduite"
                                />
                                <VerticalGauge
                                  label="Tenue"
                                  value={c.breakdown.tenue}
                                  max={c.rubric_max.tenue}
                                  rubric="tenue"
                                />
                                <VerticalGauge
                                  label="Moralité"
                                  value={c.breakdown.moralite}
                                  max={c.rubric_max.moralite}
                                  rubric="moralite"
                                />
                                <VerticalGauge
                                  label="Discipline"
                                  value={c.breakdown.discipline}
                                  max={c.rubric_max.discipline}
                                  rubric="discipline"
                                />
                              </div>

                              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-[14px] text-slate-700">
                                <span className="font-extrabold">
                                  Appréciation :{" "}
                                </span>
                                {c.appreciation}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 text-[15px] text-slate-600">
                              —
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 hidden overflow-x-auto rounded-2xl border md:block">
                    {(() => {
                      const anyConduct = filteredKids
                        .map((k) => conduct[k.id])
                        .find(Boolean);
                      const rubricMax =
                        anyConduct?.rubric_max ?? {
                          assiduite: 6,
                          tenue: 3,
                          moralite: 4,
                          discipline: 7,
                        };

                      return (
                        <table className="min-w-full text-[14px]">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3 text-left">Enfant</th>
                              <th className="px-4 py-3 text-left">Classe</th>
                              <th className="px-4 py-3 text-left">
                                Assiduité (/{rubricMax.assiduite})
                              </th>
                              <th className="px-4 py-3 text-left">
                                Tenue (/{rubricMax.tenue})
                              </th>
                              <th className="px-4 py-3 text-left">
                                Moralité (/{rubricMax.moralite})
                              </th>
                              <th className="px-4 py-3 text-left">
                                Discipline (/{rubricMax.discipline})
                              </th>
                              <th className="px-4 py-3 text-left">
                                Appréciation
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {filteredKids.map((k) => {
                              const c = conduct[k.id];
                              return (
                                <tr
                                  key={k.id}
                                  className="border-t last:border-b-0"
                                >
                                  <td className="px-4 py-3 font-semibold">
                                    {k.full_name}
                                  </td>
                                  <td className="px-4 py-3">
                                    {k.class_label || "—"}
                                  </td>
                                  {c ? (
                                    <>
                                      <td className="px-4 py-3">
                                        {rubricCellValue(
                                          c.breakdown.assiduite,
                                          c.rubric_max.assiduite,
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {rubricCellValue(
                                          c.breakdown.tenue,
                                          c.rubric_max.tenue,
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {rubricCellValue(
                                          c.breakdown.moralite,
                                          c.rubric_max.moralite,
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {rubricCellValue(
                                          c.breakdown.discipline,
                                          c.rubric_max.discipline,
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {c.appreciation}
                                      </td>
                                    </>
                                  ) : (
                                    <td
                                      className="px-4 py-3 text-slate-600"
                                      colSpan={5}
                                    >
                                      —
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ————— ABSENCES / SANCTIONS ————— */}
          {showEventsSection && (
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {(() => {
                const title = "Assiduité — absences et retards du trimestre";

                return (
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-[13px] font-extrabold uppercase tracking-wide text-slate-700">
                      {title}
                    </div>
                    <div className="flex items-center gap-2">
                      {granted ? (
                        <Badge tone="emerald">Push activées</Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })()}

              {loadingKids ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </div>
              ) : !hasKids ? (
                <div className="rounded-2xl border bg-slate-50 p-4 text-[15px] text-slate-700">
                  Aucun enfant lié à votre compte pour l’instant.
                </div>
              ) : (
                <div className="space-y-4 md:grid md:grid-cols-2 md:gap-5 md:space-y-0 xl:grid-cols-3">
                  {filteredKids.map((k, i) => {
                    const periodEvents = (feed[k.id] || []).filter((ev) =>
                      isInDateRange(ev.when, conductFrom || undefined, conductTo || undefined),
                    );
                    const groups = groupByDay(periodEvents);
                    const absencesCount = periodEvents.filter((ev) => ev.type === "absent").length;
                    const latesCount = periodEvents.filter((ev) => ev.type === "late").length;
                    const totalLateMinutes = periodEvents.reduce(
                      (sum, ev) => sum + (ev.type === "late" ? Number(ev.minutes_late || 0) : 0),
                      0,
                    );
                    const sanctionsCount = kidPenalties[k.id]?.length || 0;
                    const showAll = !!showAllDaysForKid[k.id];
                    const visibleGroups = showAll ? groups : groups.slice(0, 3);
                    const t = themeFor(i);
                    const gradesForKid = kidGrades[k.id] || [];

                    const showEventsBlock = true;
                    const showSanctionsBlock = true;
                    const showNotesBlock = false;

                    return (
                      <TiltCard key={k.id} className={t.ring}>
                        <div
                          className={`relative rounded-2xl border ${t.border} bg-white p-4 shadow-sm`}
                        >
                          <div
                            className={`absolute inset-x-0 top-0 h-1.5 rounded-t-2xl bg-gradient-to-r ${t.bar}`}
                          />

                          <div className="mt-2 flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className={`grid h-10 w-10 place-items-center rounded-2xl text-[13px] font-extrabold ${t.chipBg} ${t.chipText}`}
                              >
                                {getInitials(k.full_name)}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-extrabold text-slate-900 text-[15px]">
                                  {k.full_name}{" "}
                                  <span className="text-[13px] font-semibold text-slate-600">
                                    ({k.class_label || "—"})
                                  </span>
                                </div>
                              </div>
                            </div>

                            {groups.length > 3 && showEventsBlock && (
                              <button
                                onClick={() =>
                                  setShowAllDaysForKid((m) => ({
                                    ...m,
                                    [k.id]: !m[k.id],
                                  }))
                                }
                                className="shrink-0 text-[13px] font-semibold text-slate-700 underline-offset-2 hover:underline"
                              >
                                {showAll ? "Réduire" : "Voir plus"}
                              </button>
                            )}
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded-2xl bg-rose-50 px-3 py-3 ring-1 ring-rose-100">
                              <div className="text-[11px] font-black uppercase tracking-wide text-rose-700">Absences</div>
                              <div className="mt-1 text-xl font-black text-rose-900">{absencesCount}</div>
                            </div>
                            <div className="rounded-2xl bg-amber-50 px-3 py-3 ring-1 ring-amber-100">
                              <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">Retards</div>
                              <div className="mt-1 text-xl font-black text-amber-900">{latesCount}</div>
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                              <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Minutes</div>
                              <div className="mt-1 text-xl font-black text-slate-950">{totalLateMinutes}</div>
                            </div>
                            <div className="rounded-2xl bg-violet-50 px-3 py-3 ring-1 ring-violet-100">
                              <div className="text-[11px] font-black uppercase tracking-wide text-violet-700">Sanctions</div>
                              <div className="mt-1 text-xl font-black text-violet-900">{sanctionsCount}</div>
                            </div>
                          </div>

                          {showEventsBlock && (
                            <ul className="mt-4 space-y-3">
                              {visibleGroups.map((g) => {
                                const key = `${k.id}|${g.day}`;
                                const isOpen = !!expanded[key];
                                const hasSingle = g.items.length === 1;

                                const parts: string[] = [];
                                if (g.absentCount)
                                  parts.push(
                                    `${g.absentCount} absence${
                                      g.absentCount > 1 ? "s" : ""
                                    }`,
                                  );
                                if (g.lateCount)
                                  parts.push(
                                    `${g.lateCount} retard${
                                      g.lateCount > 1 ? "s" : ""
                                    }`,
                                  );
                                const summary = parts.length
                                  ? parts.join(" · ")
                                  : "Aucun évènement";

                                return (
                                  <li
                                    key={g.day}
                                    className="rounded-2xl border p-3 transition hover:bg-slate-50/70"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="min-w-0 text-[15px] font-bold text-slate-800">
                                        {g.label} :{" "}
                                        <span className="font-semibold text-slate-700">
                                          {summary}
                                        </span>
                                      </div>
                                      {g.items.length > 0 && (
                                        <button
                                          onClick={() =>
                                            setExpanded((m) => ({
                                              ...m,
                                              [key]: !m[key],
                                            }))
                                          }
                                          className="shrink-0 text-[13px] font-bold text-emerald-700 underline-offset-2 hover:underline"
                                        >
                                          {isOpen || hasSingle
                                            ? "Masquer"
                                            : "Voir détails"}
                                        </button>
                                      )}
                                    </div>

                                    {(isOpen || hasSingle) &&
                                      g.items.length > 0 && (
                                        <ul className="mt-3 divide-y">
                                          {g.items.map((ev) => (
                                            <li
                                              key={ev.id}
                                              className="flex items-start justify-between gap-3 py-3"
                                            >
                                              <div className="min-w-0">
                                                <div className="truncate text-[15px] text-slate-800">
                                                  {ev.type === "absent" ? (
                                                    <Badge tone="rose">
                                                      Absence
                                                    </Badge>
                                                  ) : (
                                                    <Badge tone="amber">
                                                      Retard
                                                    </Badge>
                                                  )}
                                                  <span className="ml-2 font-semibold">
                                                    {ev.subject_name || "—"}
                                                  </span>
                                                </div>
                                                <div className="mt-1 text-[13px] text-slate-600">
                                                  {slotLabel(
                                                    ev.when,
                                                    ev.expected_minutes,
                                                  )}{" "}
                                                  {ev.type === "late" &&
                                                  ev.minutes_late
                                                    ? `· ${ev.minutes_late} min`
                                                    : ""}
                                                </div>
                                              </div>
                                              <div className="shrink-0 text-[13px] text-slate-500">
                                                {ev.class_label || ""}
                                              </div>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                  </li>
                                );
                              })}

                              {visibleGroups.length === 0 && (
                                <li className="py-2 text-[15px] text-slate-600">
                                  Aucun évènement récent.
                                </li>
                              )}
                            </ul>
                          )}

                          {showSanctionsBlock && (
                            <div className="mt-4 rounded-2xl border bg-amber-50/40 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[15px] font-extrabold text-slate-800">
                                  Sanctions récentes
                                </div>
                                {(kidPenalties[k.id]?.length || 0) > 5 && (
                                  <button
                                    onClick={() =>
                                      setShowAllPenForKid((m) => ({
                                        ...m,
                                        [k.id]: !m[k.id],
                                      }))
                                    }
                                    className="text-[13px] font-semibold text-slate-700 underline-offset-2 hover:underline"
                                  >
                                    {showAllPenForKid[k.id]
                                      ? "Réduire"
                                      : "Voir plus"}
                                  </button>
                                )}
                              </div>

                              {(kidPenalties[k.id]?.length || 0) === 0 ? (
                                <div className="mt-3 text-[15px] text-slate-600">
                                  Aucune sanction récente.
                                </div>
                              ) : (
                                <ul className="mt-3 divide-y">
                                  {(showAllPenForKid[k.id]
                                    ? kidPenalties[k.id] || []
                                    : (kidPenalties[k.id] || []).slice(0, 5)
                                  ).map((p) => (
                                    <li key={p.id} className="py-3">
                                      <div className="text-[15px] text-slate-800">
                                        <span className="mr-2">
                                          <Badge tone="amber">
                                            {rubricLabel(p.rubric)}
                                          </Badge>
                                        </span>
                                        <span className="font-extrabold">
                                          −
                                          {Number(p.points || 0)
                                            .toFixed(2)
                                            .replace(".", ",")}{" "}
                                          pt
                                        </span>
                                        {p.reason?.trim() ? (
                                          <span className="ml-2 text-[13px] text-slate-600">
                                            — {p.reason.trim()}
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="mt-1 text-[13px] text-slate-500">
                                        {fmt(p.when)}
                                        {p.class_label ? ` · ${p.class_label}` : ""}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {showNotesBlock && (
                            <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
                              <div className="mb-2 text-[15px] font-extrabold text-slate-800">
                                Notes publiées (aperçu)
                              </div>
                              <ul className="space-y-2 text-[14px] text-slate-700">
                                {gradesForKid.slice(0, 3).map((g) => (
                                  <li
                                    key={g.id}
                                    className="flex items-start justify-between gap-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate font-semibold">
                                        {g.subject_name || "—"} ·{" "}
                                        {gradeKindLabel(g.eval_kind)}
                                      </div>
                                      <div className="text-[13px] text-slate-500">
                                        {fmt(g.eval_date)}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {g.score == null ? (
                                        <span className="text-[13px] text-slate-500">
                                          —
                                        </span>
                                      ) : (
                                        <span className="text-[15px] font-extrabold text-slate-900">
                                          {g.score.toFixed(2).replace(".", ",")}/
                                          {g.scale}
                                        </span>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {kidGradesErr[k.id] && (
                            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
                              <b>Notes indisponibles :</b> {kidGradesErr[k.id]}
                            </div>
                          )}
                        </div>
                      </TiltCard>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ————— CAHIER DE NOTES — onglet dédié ————— */}
          {showNotesSection && (
            <section className="mb-6 rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[13px] font-extrabold uppercase tracking-wide text-emerald-700">
                    Cahier de notes
                  </div>
                </div>

                <div className="grid w-full gap-2 text-[13px] sm:w-auto sm:grid-flow-col sm:auto-cols-max sm:items-center">
                  {selectedKidPeriods.length ? (
                    <select
                      value={activeGradePeriod?.id || ""}
                      onChange={(e) => setSelectedPeriodId(e.target.value)}
                      className="h-12 w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-[15px] font-bold text-slate-800 shadow-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:min-w-[190px]"
                    >
                      {selectedKidPeriods.map((period) => (
                        <option key={period.id} value={period.id}>
                          {period.short_label || period.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="rounded-2xl bg-slate-100 px-4 py-2 text-[13px] font-bold text-slate-600">
                      Trimestres non configurés
                    </div>
                  )}

                  {gradeFrom && gradeTo ? (
                    <span className="rounded-2xl bg-slate-100 px-3 py-2 text-center text-[12px] font-bold text-slate-600 sm:text-left">
                      {dateFr(gradeFrom)} au {dateFr(gradeTo)}
                    </span>
                  ) : null}
                </div>
              </div>

              {selectedKidBulletins.length ? (
                <div className="mb-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[13px] font-black uppercase tracking-wide text-emerald-700">
                        Bulletin trimestriel disponible
                      </div>
                      <div className="mt-1 text-[13px] text-emerald-800">
                        Le bulletin est le document officiel avec QR code sécurisé.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedKidBulletins.slice(0, 3).map((b) => (
                        <a
                          key={b.code}
                          href={b.url}
                          className="rounded-2xl bg-white px-4 py-2 text-sm font-extrabold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                        >
                          {b.period_label || "Bulletin"}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {loadingKids ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : !hasKids ? (
                <div className="rounded-2xl border bg-slate-50 p-4 text-[15px] text-slate-700">
                  Aucun enfant lié à votre compte pour l’instant.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredKids.map((k, idx) => {
                    const allGrades = kidGrades[k.id] || [];
                    const byDate = allGrades.filter((g) =>
                      isInDateRange(
                        g.eval_date,
                        gradeFrom || undefined,
                        gradeTo || undefined,
                      ),
                    );
                    const summaries = buildSubjectGradeSummaries(byDate);
                    const subjectList = summaries.map((item) => [item.key, item.label] as const);
                    const activeSubject = activeSubjectPerKid[k.id] || "";
                    const visibleSummaries =
                      activeSubject === "all"
                        ? summaries
                        : activeSubject
                          ? summaries.filter((item) => item.key === activeSubject)
                          : [];
                    const bulletinForPeriod = findBulletinForPeriod(
                      bulletinsByKid.get(k.id) || [],
                      gradeFrom || undefined,
                      gradeTo || undefined,
                      activeGradePeriod?.short_label || activeGradePeriod?.label || null,
                    );
                    const officialAverage = averageFromBulletin(bulletinForPeriod);
                    const totalAverage = officialAverage ?? weightedAverageOn20(byDate);
                    const averageCaption = officialAverage !== null ? "Moyenne bulletin" : "Moyenne provisoire";
                    const latestGrade = latestGradeOf(byDate);
                    const t = themeFor(idx);

                    return (
                      <div
                        key={k.id}
                        className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`grid h-11 w-11 place-items-center rounded-2xl text-[13px] font-extrabold ${t.chipBg} ${t.chipText}`}
                            >
                              {getInitials(k.full_name)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[17px] font-black text-slate-900">
                                {k.full_name}
                              </div>
                              <div className="text-[13px] text-slate-600">
                                {k.class_label || "—"}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                              <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">{averageCaption}</div>
                              <div className="mt-1 text-xl font-black text-slate-950">{formatAverage(totalAverage)}/20</div>
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                              <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Notes publiées</div>
                              <div className="mt-1 text-xl font-black text-slate-950">{byDate.length}</div>
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                              <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Dernière note</div>
                              <div className="mt-1 text-xl font-black text-slate-950">{formatGradeScore(latestGrade)}</div>
                            </div>
                          </div>
                        </div>

                        {kidGradesErr[k.id] && (
                          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
                            <b>Notes indisponibles :</b> {kidGradesErr[k.id]}
                          </div>
                        )}

                        <div className="mt-4">
                          <label className="mb-2 block text-[12px] font-black uppercase tracking-wide text-slate-500">
                            Discipline
                          </label>
                          <select
                            value={activeSubject}
                            onChange={(e) =>
                              setActiveSubjectPerKid((m) => ({
                                ...m,
                                [k.id]: e.target.value,
                              }))
                            }
                            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[15px] font-bold text-slate-800 shadow-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          >
                            <option value="">Choisir une discipline</option>
                            <option value="all">Toutes les disciplines</option>
                            {subjectList.map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {visibleSummaries.length === 0 ? (
                          <div className="mt-4 rounded-2xl bg-white px-4 py-4 text-[14px] text-slate-600 ring-1 ring-slate-200">
                            {summaries.length
                              ? "Choisissez une discipline pour afficher les notes."
                              : "Aucune note publiée pour cette période."}
                          </div>
                        ) : (
                          <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            {visibleSummaries.map((item) => {
                              const detailKey = `${k.id}|${item.key}`;
                              const isOpen = !!expandedGradeSubjects[detailKey] || (activeSubject !== "all" && activeSubject !== "");
                              return (
                                <article key={item.key} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <h3 className="truncate text-[16px] font-black text-slate-950">{item.label}</h3>
                                      <div className="mt-1 text-[13px] font-semibold text-slate-500">
                                        {item.grades.length} note{item.grades.length > 1 ? "s" : ""} publiée{item.grades.length > 1 ? "s" : ""}
                                      </div>
                                    </div>
                                    <div className="shrink-0 rounded-2xl bg-emerald-50 px-3 py-2 text-right ring-1 ring-emerald-100">
                                      <div className="text-lg font-black text-emerald-800">{formatAverage(item.average)}/20</div>
                                      <div className="text-[11px] font-bold text-emerald-700">provisoire</div>
                                    </div>
                                  </div>

                                  {item.latest ? (
                                    <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-3 text-[13px] text-slate-700">
                                      Dernière note : <b>{formatGradeScore(item.latest)}</b> · {gradeKindLabel(item.latest.eval_kind)}
                                      {item.latest.title ? ` · ${item.latest.title}` : ""}
                                    </div>
                                  ) : null}

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedGradeSubjects((m) => ({
                                        ...m,
                                        [detailKey]: !m[detailKey],
                                      }))
                                    }
                                    className="mt-3 rounded-2xl bg-[#e7f0fa] px-3 py-2 text-[13px] font-black text-[#003766] transition hover:bg-[#d9e8f7]"
                                  >
                                    {isOpen ? "Masquer le détail" : "Voir le détail"}
                                  </button>

                                  {isOpen ? (
                                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                                      <div className="hidden bg-slate-50 px-3 py-2 text-[12px] font-black uppercase tracking-wide text-slate-500 md:grid md:grid-cols-[120px_1fr_90px_90px] md:gap-3">
                                        <span>Date</span>
                                        <span>Évaluation</span>
                                        <span>Coeff.</span>
                                        <span className="text-right">Note</span>
                                      </div>
                                      <div className="divide-y divide-slate-100">
                                        {item.grades.map((g) => (
                                          <div key={g.id} className="grid gap-2 px-3 py-3 text-[13px] md:grid-cols-[120px_1fr_90px_90px] md:gap-3 md:items-center">
                                            <div className="font-semibold text-slate-600">{fmt(g.eval_date)}</div>
                                            <div className="min-w-0">
                                              <div className="font-bold text-slate-900">{gradeKindLabel(g.eval_kind)}</div>
                                              {g.title ? <div className="truncate text-slate-500">{g.title}</div> : null}
                                            </div>
                                            <div className="text-slate-600">Coeff. {g.coeff || 1}</div>
                                            <div className="text-right text-[15px] font-black text-slate-950">{formatGradeScore(g)}</div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

