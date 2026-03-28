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

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
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
type Kid = { id: string; full_name: string; class_label: string | null };

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

type NavSection = "home" | "conduct" | "absences" | "notes";

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
  tone?: "slate" | "emerald" | "amber" | "rose";
}) {
  const toneMap: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
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

  // Filtre période notes
  const [gradeFilterMode, setGradeFilterMode] = useState<
    "week" | "month" | "all" | "custom"
  >("week");
  const [gradeFrom, setGradeFrom] = useState<string>("");
  const [gradeTo, setGradeTo] = useState<string>("");

  // Matière sélectionnée par enfant
  const [activeSubjectPerKid, setActiveSubjectPerKid] = useState<
    Record<string, string | "all" | null>
  >({});

  // ðŸ”” notifications
  const [granted, setGranted] = useState(false);

  // ðŸ“± iOS / standalone
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

  const isHome = activeSection === "home";
  const isConduct = activeSection === "conduct";
  const isAbsences = activeSection === "absences";
  const isNotes = activeSection === "notes";

  const showConductSection = isConduct;
  const showEventsSection = isAbsences;
  const showNotesSection = isNotes;

  const sectionMeta: Record<NavSection, { breadcrumb: string; title: string; tab: string }> = {
    home: { breadcrumb: "Accueil", title: "Accueil", tab: "Accueil" },
    conduct: { breadcrumb: "Conduite", title: "Conduite et points", tab: "Conduite" },
    absences: { breadcrumb: "Absences", title: "Cahier d'absences", tab: "Absences" },
    notes: { breadcrumb: "Notes", title: "Cahier de notes", tab: "Notes" },
  };

  const tabs: Array<{
    key: NavSection;
    label: string;
    icon: React.ReactNode;
    activeClass: string;
    idleClass: string;
  }> = [
    {
      key: "conduct",
      label: "Conduite",
      icon: <IconClipboard />,
      activeClass:
        "bg-gradient-to-r from-[#003766] to-[#0057a8] text-white shadow-lg shadow-[#003766]/20",
      idleClass: "bg-[#e7f0fa] text-[#003766] hover:bg-[#d9e8f7]",
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
        "bg-gradient-to-r from-[#166534] to-[#16a34a] text-white shadow-lg shadow-emerald-900/20",
      idleClass: "bg-[#e8f8ef] text-[#166534] hover:bg-[#d7f1e2]",
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

  // init période notes
  useEffect(() => {
    const today = new Date();
    if (gradeFilterMode === "week") {
      const start = startOfWeek(today);
      setGradeFrom(yyyyMMdd(start));
      setGradeTo(yyyyMMdd(today));
    } else if (gradeFilterMode === "month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setGradeFrom(yyyyMMdd(start));
      setGradeTo(yyyyMMdd(today));
    } else if (gradeFilterMode === "all") {
      setGradeFrom("");
      setGradeTo("");
    }
  }, [gradeFilterMode]);

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
          gradeErrs[k.id] = gRes.err;
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
        setActiveSection("conduct");
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

  async function applyConductFilter() {
    await loadConductForAll(kids, conductFrom, conductTo);
  }

  // premier chargement
  useEffect(() => {
    if (!conductFrom || !conductTo) return;
    loadKids(conductFrom, conductTo);
    loadSmsContacts(true);
    ensurePushSubscription().then((r) => {
      if (r.ok) setGranted(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conductFrom, conductTo]);

  async function enablePush() {
    setMsg(null);
    const r = await ensurePushSubscription();
    if (r.ok) {
      setGranted(true);
      setMsg("Notifications push activées“");
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
    setMobileNavOpen(false);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openChildSection(childId: string, section: NavSection = "conduct") {
    setActiveChildId(childId);
    setActiveSection(section);
    setMobileNavOpen(false);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function gradeFilterLabel(mode: typeof gradeFilterMode): string {
    if (mode === "week") return "Semaine";
    if (mode === "month") return "Mois";
    if (mode === "all") return "Toute l’année";
    return "Période libre";
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
          <div className="relative flex h-full w-80 max-w-[86%] flex-col bg-[#003766] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/15 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-sm font-extrabold">
                  MC
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="text-[12px] opacity-90">Bienvenue</div>
                  <div className="text-[15px] font-extrabold truncate">
                    Espace parent Mon Cahier
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

            <div className="border-b border-white/10 px-4 py-4">
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
            </div>

            <div className="border-b border-white/10 px-4 py-4">
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

            <div className="border-b border-white/10 px-4 py-4">
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
                  Nexa Digital
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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-3 lg:px-4">
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
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-sm font-extrabold">
                MC
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

          <div className="text-right leading-tight">
            <div className="font-extrabold uppercase tracking-[0.25em] text-amber-300 text-[12px]">
              PARENT
            </div>
            <div className="text-[13px] font-bold">2025-2026</div>
          </div>
        </div>
      </header>

      {/* ————— CORPS ————— */}
      <div className="mx-auto flex w-full max-w-6xl min-w-0">
        {/* Sidebar desktop */}
        <aside className="hidden w-72 flex-col bg-[#003766] text-white lg:flex">
          <div className="border-b border-white/15 px-4 py-5">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-sm font-extrabold">
                MC
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-[12px]">Bienvenue</div>
                <div className="text-[15px] font-extrabold truncate">
                  Espace parent Mon Cahier
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-emerald-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span>En ligne</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-white/15 px-4 py-4">
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
          </div>

          <div className="border-b border-white/15 px-4 py-4">
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

          <div className="border-b border-white/15 px-4 py-4">
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
                Nexa Digital
              </div>
            </div>
          </div>
        </aside>

        {/* Contenu principal */}
        <main className="flex-1 min-w-0 px-3 py-5 lg:px-6 lg:py-6 pb-6">
          <div className="mb-5 flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="text-[12px] text-slate-500">
              Vous êtes ici : <span className="mx-1">›</span> {currentSectionMeta.breadcrumb}
            </div>
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <h1 className="text-2xl font-extrabold text-slate-900">
                {currentSectionMeta.title}
              </h1>
              <div className="text-[14px] font-semibold text-slate-600">
                {isHome
                  ? "Gestion du numéro parent"
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

          {selectedKid && (
            <div className="mb-5 rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tabs.map((tab) => {
                  const active = activeSection === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => selectSection(tab.key)}
                      className={[
                        "flex min-h-[94px] w-full items-center gap-4 rounded-[28px] px-5 py-5 text-left text-[15px] font-extrabold transition-transform duration-150 hover:-translate-y-0.5",
                        active ? tab.activeClass : tab.idleClass,
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "grid h-14 w-14 shrink-0 place-items-center rounded-2xl",
                          active ? "bg-white/15 text-white" : "bg-white/70",
                        ].join(" ")}
                      >
                        {tab.icon}
                      </span>
                      <span className="text-[18px] leading-none">{tab.label}</span>
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

          {isHome && (
            <section className="mb-6 rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-3xl bg-[#e7f0fa] text-[#003766]">
                  <IconPhone />
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold text-slate-900">
                    Numéro parent
                  </h2>
                  <div className="mt-1 text-[14px] text-slate-500">
                    {smsPrimaryContact?.phone_e164
                      ? formatPhoneForDisplay(smsPrimaryContact.phone_e164)
                      : "Aucun numéro enregistré"}
                  </div>
                </div>
              </div>

              <div className="mt-6">
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

          {/* ————— CONDUITE ————— */}

          {showConductSection && (
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-[13px] font-extrabold uppercase tracking-wide text-slate-700">
                  Conduite — points par rubrique
                </div>

                <div className="hidden items-center gap-2 md:flex">
                  <Input
                    type="date"
                    value={conductFrom}
                    onChange={(e) => setConductFrom(e.target.value)}
                  />
                  <span className="text-[13px] text-slate-600">au</span>
                  <Input
                    type="date"
                    value={conductTo}
                    onChange={(e) => setConductTo(e.target.value)}
                  />
                  <Button
                    onClick={applyConductFilter}
                    disabled={loadingConduct}
                    className="px-4 py-3 text-[14px]"
                  >
                    {loadingConduct ? "…" : "Valider"}
                  </Button>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 md:hidden">
                <Input
                  type="date"
                  value={conductFrom}
                  onChange={(e) => setConductFrom(e.target.value)}
                />
                <Input
                  type="date"
                  value={conductTo}
                  onChange={(e) => setConductTo(e.target.value)}
                />
                <div className="col-span-2 flex justify-center">
                  <Button
                    className="mx-auto w-full max-w-[220px]"
                    onClick={applyConductFilter}
                    disabled={loadingConduct}
                  >
                    {loadingConduct ? "…" : "Valider"}
                  </Button>
                </div>
              </div>

              {loadingKids ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : !hasKids ? (
                <div className="flex items-center justify-between rounded-2xl border bg-slate-50 p-4 text-[15px] text-slate-700">
                  <div>Aucun enfant lié à votre compte pour l’instant.</div>
                  {!granted && (
                    <Button
                      tone="outline"
                      onClick={enablePush}
                      iconLeft={<IconBell />}
                    >
                      Activer les push
                    </Button>
                  )}
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
                const title = "Cahier d’absences — absences/retards récents et sanctions";

                return (
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-[13px] font-extrabold uppercase tracking-wide text-slate-700">
                      {title}
                    </div>
                    <div className="flex items-center gap-2">
                      {granted ? (
                        <span className="text-[13px] font-bold text-emerald-700">
                          Notifications déjà activées ✅
                        </span>
                      ) : (
                        <Button
                          tone="outline"
                          onClick={enablePush}
                          title="Activer les notifications push"
                          iconLeft={<IconBell />}
                        >
                          Activer les push
                        </Button>
                      )}
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
                    const groups = groupByDay(feed[k.id] || []);
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
                                  ? parts.join(" ¢ ")
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
                                                    ? `¢ ${ev.minutes_late} min`
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
                                        {p.class_label ? ` ¢ ${p.class_label}` : ""}
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
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[13px] font-extrabold uppercase tracking-wide text-slate-700">
                    Cahier de notes
                  </div>
                  <div className="text-[13px] text-slate-500">
                    Notes publiées par les enseignants, filtrées par période.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  {(["week", "month", "all", "custom"] as const).map((m) => {
                    const active = gradeFilterMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setGradeFilterMode(m)}
                        className={[
                          "rounded-full px-4 py-2 font-bold",
                          active
                            ? "bg-[#003766] text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                        ].join(" ")}
                      >
                        {gradeFilterLabel(m)}
                      </button>
                    );
                  })}

                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={gradeFrom}
                      disabled={gradeFilterMode !== "custom"}
                      onChange={(e) => setGradeFrom(e.target.value)}
                      className="h-11 w-[150px] px-3 py-2 text-[14px]"
                    />
                    <span className="text-[13px] text-slate-500">au</span>
                    <Input
                      type="date"
                      value={gradeTo}
                      disabled={gradeFilterMode !== "custom"}
                      onChange={(e) => setGradeTo(e.target.value)}
                      className="h-11 w-[150px] px-3 py-2 text-[14px]"
                    />
                  </div>
                </div>
              </div>

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

                    const subjectKey = (g: KidGradeRow) =>
                      g.subject_id || g.subject_name || "";
                    const subjectMap = new Map<string, string>();
                    for (const g of byDate) {
                      const key = subjectKey(g);
                      if (!key) continue;
                      if (!subjectMap.has(key))
                        subjectMap.set(key, g.subject_name || "—");
                    }
                    const subjectList = Array.from(subjectMap.entries());

                    const activeSubject =
                      activeSubjectPerKid[k.id] &&
                      activeSubjectPerKid[k.id] !== "all"
                        ? activeSubjectPerKid[k.id]
                        : "all";

                    const filtered =
                      activeSubject === "all"
                        ? byDate
                        : byDate.filter((g) => subjectKey(g) === activeSubject);

                    const t = themeFor(idx);

                    return (
                      <div
                        key={k.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
                      >
                        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`grid h-10 w-10 place-items-center rounded-2xl text-[13px] font-extrabold ${t.chipBg} ${t.chipText}`}
                            >
                              {getInitials(k.full_name)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[16px] font-extrabold text-slate-900">
                                {k.full_name}
                              </div>
                              <div className="text-[13px] text-slate-600">
                                {k.class_label || "—"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-slate-500">
                              Matières :
                            </span>
                            <div className="flex max-w-full gap-2 overflow-x-auto whitespace-nowrap pb-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveSubjectPerKid((m) => ({
                                    ...m,
                                    [k.id]: "all",
                                  }))
                                }
                                className={[
                                  "rounded-full px-3 py-2 text-[13px] font-bold",
                                  activeSubject === "all"
                                    ? "bg-slate-900 text-white"
                                    : "bg-white text-slate-700 hover:bg-slate-200",
                                ].join(" ")}
                              >
                                Toutes
                              </button>

                              {subjectList.map(([id, label]) => (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() =>
                                    setActiveSubjectPerKid((m) => ({
                                      ...m,
                                      [k.id]: id,
                                    }))
                                  }
                                  className={[
                                    "max-w-[220px] truncate rounded-full px-3 py-2 text-[13px] font-bold",
                                    activeSubject === id
                                      ? "bg-[#003766] text-white"
                                      : "bg-white text-slate-700 hover:bg-slate-200",
                                  ].join(" ")}
                                  title={label}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {kidGradesErr[k.id] && (
                          <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
                            <b>Notes indisponibles :</b> {kidGradesErr[k.id]}
                          </div>
                        )}

                        {filtered.length === 0 ? (
                          <div className="rounded-2xl bg-white px-4 py-3 text-[14px] text-slate-600">
                            Aucune note publiée pour cette période.
                          </div>
                        ) : (
                          <>
                            <div className="space-y-3 md:hidden">
                              {filtered.map((g) => (
                                <div
                                  key={g.id}
                                  className="rounded-2xl border bg-white p-4"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-[15px] font-extrabold text-slate-900 truncate">
                                        {g.subject_name || "—"}
                                      </div>
                                      <div className="text-[13px] text-slate-600">
                                        {gradeKindLabel(g.eval_kind)}{" "}
                                        {g.title ? `¢ ${g.title}` : ""}
                                      </div>
                                      <div className="mt-1 text-[13px] text-slate-500">
                                        {fmt(g.eval_date)}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {g.score == null ? (
                                        <span className="text-[13px] text-slate-500">
                                          —
                                        </span>
                                      ) : (
                                        <span className="text-[16px] font-extrabold text-slate-900">
                                          {g.score.toFixed(2).replace(".", ",")}/
                                          {g.scale}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="hidden overflow-x-auto rounded-2xl border bg-white md:block">
                              <table className="min-w-full text-[14px]">
                                <thead className="bg-slate-50">
                                  <tr>
                                    <th className="px-4 py-3 text-left">Date</th>
                                    <th className="px-4 py-3 text-left">
                                      Matière
                                    </th>
                                    <th className="px-4 py-3 text-left">Type</th>
                                    <th className="px-4 py-3 text-left">
                                      Titre
                                    </th>
                                    <th className="px-4 py-3 text-right">Note</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filtered.map((g) => (
                                    <tr
                                      key={g.id}
                                      className="border-t last:border-b-0"
                                    >
                                      <td className="px-4 py-3">
                                        {fmt(g.eval_date)}
                                      </td>
                                      <td className="px-4 py-3">
                                        {g.subject_name || "—"}
                                      </td>
                                      <td className="px-4 py-3">
                                        {gradeKindLabel(g.eval_kind)}
                                      </td>
                                      <td className="px-4 py-3">
                                        {g.title || "—"}
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        {g.score == null ? (
                                          <span className="text-slate-500">
                                            —
                                          </span>
                                        ) : (
                                          <span className="font-extrabold text-slate-900">
                                            {g.score.toFixed(2).replace(".", ",")}/
                                            {g.scale}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
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
