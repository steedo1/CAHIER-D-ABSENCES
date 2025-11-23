"use client";

import React, { useEffect, useState } from "react";

/* ───────── routes dédiées parents + fallbacks ───────── */
const LOGOUT_PARENTS = "/parents/logout";
const LOGIN_PARENTS = "/parents/login";

/* ───────── helpers ───────── */
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
  const minutes = Number.isFinite(Number(expectedMinutes)) ? Number(expectedMinutes) : 60;
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
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
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
  const day = d.getDay(); // 0 (dimanche) -> 6 (samedi)
  const diff = day === 0 ? -6 : 1 - day; // Lundi comme début
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

/* ───────── thèmes (couleurs différentes par enfant / matière) ───────── */
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

/* ───────── types ───────── */
type Kid = { id: string; full_name: string; class_label: string | null };
type Ev = {
  id: string;
  when: string; // session.started_at
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
  breakdown: { assiduite: number; tenue: number; moralite: number; discipline: number };
  total: number;
  appreciation: string;
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

type NavSection = "dashboard" | "conduct" | "absences" | "notes";

/* ───────── UI ───────── */
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "red" | "white" | "outline";
    iconLeft?: React.ReactNode;
  }
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
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-sm transition-all",
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
        "w-full rounded-xl border border-slate-200 bg-white/90 backdrop-blur px-3 py-2.5 text-sm shadow-sm outline-none transition",
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
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        toneMap[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}
function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      {label && <div className="mb-1 text-xs text-slate-600">{label}</div>}
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;
}

/* Petites icônes inline (pas de dépendances) */
const IconBell = () => (
  <svg
    width="16"
    height="16"
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
    width="16"
    height="16"
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
    width="16"
    height="16"
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
    width="16"
    height="16"
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
    width="16"
    height="16"
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
    width="16"
    height="16"
    viewBox="0 0 24 24"
    className="shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);
const IconX = () => (
  <svg
    width="16"
    height="16"
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

/* ───────── Carte 3D (tilt) réutilisable ───────── */
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
      setHasFinePointer(window.matchMedia?.("(pointer: fine)")?.matches ?? false);
    }
  }, []);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!hasFinePointer) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width; // 0..1
    const py = (e.clientY - rect.top) / rect.height; // 0..1

    const rotMax = 8; // degrés
    const rx = (py - 0.5) * -2 * rotMax;
    const ry = (px - 0.5) * 2 * rotMax;

    setStyle({
      transform: `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(
        2
      )}deg) translateZ(0) scale(1.01)`,
      transition: "transform 60ms linear",
      transformStyle: "preserve-3d",
    });

    const x = Math.round(px * rect.width);
    const y = Math.round(py * rect.height);
    setShineStyle({
      background: `radial-gradient(300px circle at ${x}px ${y}px, rgba(255,255,255,0.18), transparent 45%)`,
    });
  }
  function onLeave() {
    setStyle({
      transform: "rotateX(0deg) rotateY(0deg) translateZ(0)",
      transition: "transform 180ms ease",
      transformStyle: "preserve-3d",
    });
    setShineStyle({});
  }

  return (
    <div
      style={{ perspective: "1000px" }}
      className="[transform-style:preserve-3d] "
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div
        className={`relative rounded-xl bg-white transition-shadow will-change-transform ${className}`}
        style={style}
      >
        {/* halo lumineux */}
        <div className="pointer-events-none absolute inset-0 rounded-xl" style={shineStyle} />
        {children}
      </div>
    </div>
  );
}

/* ───────── PUSH: ensure registration + subscribe + server upsert ───────── */
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
      return { ok: false, reason: "sw_register_failed:" + (e?.message || e) };
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
      return { ok: false, reason: "subscribe_failed:" + (e?.message || e) };
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
    const err = `${res.status} ${body?.error || ""}${body?.stage ? ` [${body.stage}]` : ""}`;
    return { ok: false, reason: "server_upsert_failed:" + err };
  }
  return { ok: true };
}

/* ───────── group by day ───────── */
type DayGroup = { day: string; label: string; absentCount: number; lateCount: number; items: Ev[] };
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

/* ───────── component ───────── */
export default function ParentPage() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [feed, setFeed] = useState<Record<string, Ev[]>>({});
  const [kidPenalties, setKidPenalties] = useState<Record<string, KidPenalty[]>>({});
  const [conduct, setConduct] = useState<Record<string, Conduct>>({});
  const [kidGrades, setKidGrades] = useState<Record<string, KidGradeRow[]>>({});
  const [loadingKids, setLoadingKids] = useState(true);
  const [loadingConduct, setLoadingConduct] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Filtre période pour la conduite (par défaut : 90 jours glissants)
  const [conductFrom, setConductFrom] = useState<string>("");
  const [conductTo, setConductTo] = useState<string>("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllDaysForKid, setShowAllDaysForKid] = useState<Record<string, boolean>>({});
  const [showAllPenForKid, setShowAllPenForKid] = useState<Record<string, boolean>>({});

  // Filtre période pour les notes
  const [gradeFilterMode, setGradeFilterMode] = useState<"week" | "month" | "all" | "custom">(
    "week"
  );
  const [gradeFrom, setGradeFrom] = useState<string>("");
  const [gradeTo, setGradeTo] = useState<string>("");

  // Matière sélectionnée par enfant (onglet Cahier de notes)
  const [activeSubjectPerKid, setActiveSubjectPerKid] = useState<Record<string, string | null>>(
    {}
  );

  // 🔔 Permission de notification déjà accordée ?
  const [granted, setGranted] = useState(false);

  // 📱 iOS + mode standalone (PWA installée)
  const [isiOS, setIsiOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  // ⛔ État de déconnexion
  const [loggingOut, setLoggingOut] = useState(false);

  // Menu mobile (drawer)
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sélection enfant + section (sidebar / mobile nav)
  const [activeChildId, setActiveChildId] = useState<string | "all">("all");
  const [activeSection, setActiveSection] = useState<NavSection>("dashboard");

  const hasKids = kids.length > 0;
  const filteredKids = activeChildId === "all" ? kids : kids.filter((k) => k.id === activeChildId);

  const isDashboard = activeSection === "dashboard";
  const isConduct = activeSection === "conduct";
  const isAbsences = activeSection === "absences";
  const isNotes = activeSection === "notes";
  const showConductSection = isDashboard || isConduct;
  const showEventsSection = isDashboard || isAbsences;
  const showNotesSection = isNotes;

  // — init des dates par défaut + états push
  useEffect(() => {
    // Dates par défaut : aujourd’hui et J-90 pour la conduite
    const today = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const f = yyyyMMdd(start);
    const t = yyyyMMdd(today);
    setConductFrom(f);
    setConductTo(t);

    const refresh = () =>
      setGranted(typeof Notification !== "undefined" && Notification.permission === "granted");
    refresh();

    setIsiOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const mq = window.matchMedia?.("(display-mode: standalone)");
    setIsStandalone(!!(mq?.matches || (navigator as any).standalone === true));

    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  // Init période notes selon le mode (semaine / mois / all)
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
    // custom : on ne touche pas aux valeurs, c'est l'utilisateur qui choisit
  }, [gradeFilterMode]);

  async function loadKids(from?: string, to?: string) {
    setLoadingKids(true);
    try {
      // 1) enfants
      const j = await fetch("/api/parent/children", {
        cache: "no-store",
        credentials: "include",
      }).then((r) => r.json());
      const ks = (j.items || []) as Kid[];
      setKids(ks);
      setActiveChildId((prev) => {
        if (prev !== "all" && ks.some((k) => k.id === prev)) return prev;
        if (ks.length === 1) return ks[0].id;
        if (ks.length === 0) return "all";
        return "all";
      });

      // 2) événements + sanctions + notes publiées
      const feedEntries: Array<[string, Ev[]]> = [];
      const penEntries: Array<[string, KidPenalty[]]> = [];
      const gradeEntries: Array<[string, KidGradeRow[]]> = [];

      for (const k of ks) {
        const f = await fetch(
          `/api/parent/children/events?student_id=${encodeURIComponent(k.id)}&limit=50`,
          { cache: "no-store", credentials: "include" }
        ).then((r) => r.json());
        feedEntries.push([k.id, (f.items || []) as Ev[]]);

        const p = await fetch(
          `/api/parent/children/penalties?student_id=${encodeURIComponent(k.id)}&limit=20`,
          { cache: "no-store", credentials: "include" }
        )
          .then((r) => r.json())
          .catch(() => ({ items: [] }));
        penEntries.push([k.id, (p.items || []) as KidPenalty[]]);

        const g = await fetch(
          `/api/parent/children/grades?student_id=${encodeURIComponent(k.id)}&limit=200`,
          { cache: "no-store", credentials: "include" }
        )
          .then((r) => r.json())
          .catch(() => ({ items: [] }));
        gradeEntries.push([k.id, (g.items || []) as KidGradeRow[]]);
      }

      setFeed(Object.fromEntries(feedEntries));
      setKidPenalties(Object.fromEntries(penEntries));
      setKidGrades(Object.fromEntries(gradeEntries));

      // 3) expand auto si une seule ligne dans une journée
      const initialExpanded: Record<string, boolean> = {};
      for (const [kidId, list] of feedEntries) {
        const groups = groupByDay(list);
        for (const g of groups) if (g.items.length === 1) initialExpanded[`${kidId}|${g.day}`] = true;
      }
      setExpanded(initialExpanded);

      // 4) conduite avec intervalle (par défaut 90j)
      const useFrom = from || conductFrom;
      const useTo = to || conductTo;
      await loadConductForAll(ks, useFrom, useTo);
    } catch (e: any) {
      setMsg(e?.message || "Erreur de chargement.");
    } finally {
      setLoadingKids(false);
    }
  }

  async function loadConductForAll(kidsList: Kid[] = kids, from?: string, to?: string) {
    setLoadingConduct(true);
    try {
      const condEntries: Array<[string, Conduct]> = [];
      for (const k of kidsList) {
        const qs = new URLSearchParams({ student_id: k.id });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const c = await fetch(`/api/parent/children/conduct?${qs.toString()}`, {
          cache: "no-store",
          credentials: "include",
        })
          .then((r) => r.json())
          .catch(() => ({}));
        if (c && c.total != null) condEntries.push([k.id, c as Conduct]);
      }
      setConduct(Object.fromEntries(condEntries));
    } finally {
      setLoadingConduct(false);
    }
  }

  async function applyConductFilter() {
    await loadConductForAll(kids, conductFrom, conductTo);
  }

  // premier chargement (après que les dates par défaut aient été posées)
  useEffect(() => {
    if (!conductFrom || !conductTo) return; // attend l'init des dates
    loadKids(conductFrom, conductTo);
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
      setMsg("Notifications push activées ✓");
    } else {
      setMsg("Activation push impossible: " + r.reason);
    }
  }

  /* ───────── Déconnexion “propre” (parents d’abord) ───────── */
  async function safeLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setMsg("Déconnexion en cours…");

    try {
      // 1) Tentative de désinscription push (silencieuse)
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

      // 2) Fin de session côté API (si présente)
      try {
        await fetch("/api/auth/sync", { method: "DELETE", credentials: "include" });
      } catch {}
    } finally {
      // 3) Toujours passer par /parents/logout (qui redirige vers /parents/login)
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
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function SidebarNavItem({
    label,
    icon,
    section,
  }: {
    label: string;
    icon: React.ReactNode;
    section: NavSection;
  }) {
    const active = activeSection === section;
    return (
      <button
        onClick={() => selectSection(section)}
        className={[
          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
          active
            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "text-slate-700 hover:bg-slate-100",
        ].join(" ")}
      >
        <span className="text-slate-500">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950/5">
      {/* Drawer mobile (style app, ouverture à gauche) */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          {/* Panneau gauche */}
          <div className="relative h-full w-72 max-w-[80%] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-xs font-semibold text-white">
                  MC
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">Mon Cahier</div>
                  <div className="text-[11px] text-slate-500">Espace parent</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fermer le menu"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700"
              >
                <IconX />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Enfants (mobile drawer) */}
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Enfants
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setActiveChildId("all");
                      setMobileNavOpen(false);
                    }}
                    className={[
                      "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition",
                      activeChildId === "all"
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <span>Vue globale</span>
                    <span className="rounded-full bg-slate-900/5 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {kids.length || 0}
                    </span>
                  </button>
                  {kids.map((k) => {
                    const active = activeChildId === k.id;
                    return (
                      <button
                        key={k.id}
                        onClick={() => {
                          setActiveChildId(k.id);
                          setMobileNavOpen(false);
                        }}
                        className={[
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition",
                          active
                            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                            : "text-slate-700 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        <div className="grid h-6 w-6 place-items-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-700">
                          {getInitials(k.full_name)}
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="truncate">{k.full_name}</div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {k.class_label || "—"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Navigation (mobile drawer) */}
              <div className="px-3 py-3 space-y-1">
                <SidebarNavItem label="Tableau de bord" icon={<IconHome />} section="dashboard" />
                <SidebarNavItem
                  label="Conduite & points"
                  icon={<IconClipboard />}
                  section="conduct"
                />
                <SidebarNavItem
                  label="Cahier d’absences"
                  icon={<IconClipboard />}
                  section="absences"
                />
                <SidebarNavItem label="Cahier de notes" icon={<IconBook />} section="notes" />
              </div>
            </div>

            <div className="border-t border-slate-200 px-4 py-3">
              <Button
                tone="slate"
                onClick={safeLogout}
                disabled={loggingOut}
                title="Se déconnecter"
                iconLeft={<IconPower />}
                className="w-full justify-start"
              >
                {loggingOut ? "Déconnexion…" : "Se déconnecter"}
              </Button>
            </div>
          </div>

          {/* Overlay à droite */}
          <button
            type="button"
            aria-label="Fermer le menu"
            className="flex-1 bg-slate-950/40"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className="flex min-h-screen">
        {/* Sidebar desktop */}
        <aside className="hidden md:flex w-64 flex-col border-r border-slate-200 bg-white/95 backdrop-blur">
          {/* Brand */}
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-xs font-semibold text-white shadow-sm">
              MC
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">Mon Cahier</div>
              <div className="text-xs text-slate-500">Espace parent</div>
            </div>
          </div>

          {/* Enfants */}
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Enfants
            </div>
            <div className="space-y-1">
              <button
                onClick={() => setActiveChildId("all")}
                className={[
                  "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition",
                  activeChildId === "all"
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100",
                ].join(" ")}
              >
                <span>Vue globale</span>
                <span className="rounded-full bg-slate-900/5 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {kids.length || 0}
                </span>
              </button>
              {kids.map((k) => {
                const active = activeChildId === k.id;
                return (
                  <button
                    key={k.id}
                    onClick={() => setActiveChildId(k.id)}
                    className={[
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition",
                      active
                        ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                        : "text-slate-700 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <div className="grid h-6 w-6 place-items-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-700">
                      {getInitials(k.full_name)}
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="truncate">{k.full_name}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {k.class_label || "—"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex-1 px-3 py-3 space-y-1">
            <SidebarNavItem label="Tableau de bord" icon={<IconHome />} section="dashboard" />
            <SidebarNavItem
              label="Conduite & points"
              icon={<IconClipboard />}
              section="conduct"
            />
            <SidebarNavItem
              label="Cahier d’absences"
              icon={<IconClipboard />}
              section="absences"
            />
            <SidebarNavItem label="Cahier de notes" icon={<IconBook />} section="notes" />
          </div>

          {/* Logout bas sidebar */}
          <div className="border-t border-slate-200 px-4 py-3">
            <Button
              tone="white"
              onClick={safeLogout}
              disabled={loggingOut}
              title="Se déconnecter"
              iconLeft={<IconPower />}
              className="w-full justify-start"
            >
              {loggingOut ? "Déconnexion…" : "Se déconnecter"}
            </Button>
          </div>
        </aside>

        {/* Contenu principal */}
        <div className="flex-1">
          <main
            className={[
              "relative mx-auto max-w-6xl p-4 pb-24 md:px-6 md:py-6 md:pb-8 space-y-6 scroll-smooth",
            ].join(" ")}
          >
            {/* Background décoratif non intrusif */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  "radial-gradient(90% 60% at 100% 0%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(70% 50% at 0% 0%, rgba(16,185,129,0.10), transparent 60%)",
              }}
            />

            {/* Header */}
            <header className="relative overflow-hidden rounded-3xl border border-slate-800/20 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-5 md:px-7 md:py-6 text-white shadow-sm">
              <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(60%_50%_at_100%_0%,white,transparent_70%)]" />
              <div className="relative z-10 flex flex-col gap-3">
                {/* Ligne supérieure : brand + actions */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950/80 text-xs font-semibold">
                      MC
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                        Espace parent
                      </p>
                      <h1 className="text-lg md:text-xl font-semibold tracking-tight">
                        Mon Cahier
                      </h1>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Bouton menu mobile */}
                    <button
                      type="button"
                      aria-label="Ouvrir le menu"
                      onClick={() => setMobileNavOpen(true)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white md:hidden"
                    >
                      <IconMenu />
                    </button>

                    {/* Actions (push + logout) en md+ */}
                    <div className="hidden sm:flex items-center gap-2">
                      {!granted ? (
                        <Button
                          tone="white"
                          onClick={enablePush}
                          title="Activer les notifications push"
                          iconLeft={<IconBell />}
                        >
                          Activer les push
                        </Button>
                      ) : (
                        <span className="hidden md:inline rounded-full bg-white px-3 py-1.5 text-sm text-slate-900 ring-1 ring-white/40">
                          Push activés ✅
                        </span>
                      )}
                      <Button
                        tone="white"
                        onClick={safeLogout}
                        disabled={loggingOut}
                        title="Se déconnecter"
                        iconLeft={<IconPower />}
                      >
                        {loggingOut ? "Déconnexion…" : "Déconnexion"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="mt-1 text-sm text-white/80 max-w-2xl">
                  Suivez en temps réel les <b>absences</b>, <b>retards</b>, <b>sanctions</b> et{" "}
                  <b>notes</b> de vos enfants.
                </p>

                {/* Actions (push + logout) en mobile */}
                <div className="mt-3 flex gap-2 sm:hidden">
                  {!granted ? (
                    <Button
                      tone="white"
                      onClick={enablePush}
                      title="Activer les notifications push"
                      iconLeft={<IconBell />}
                      className="flex-1"
                    >
                      Activer les push
                    </Button>
                  ) : (
                    <div className="flex-1 rounded-full bg-white/10 px-3 py-2 text-xs text-white/90 flex items-center justify-center">
                      Push activés ✅
                    </div>
                  )}
                  <Button
                    tone="white"
                    onClick={safeLogout}
                    disabled={loggingOut}
                    title="Se déconnecter"
                    iconLeft={<IconPower />}
                    className="flex-1"
                  >
                    {loggingOut ? "Déconnexion…" : "Déconnexion"}
                  </Button>
                </div>

                {/* Mobile : sélection enfant (nav sections via bottom-nav) */}
                {hasKids && (
                  <div className="relative z-10 mt-4 space-y-2 md:hidden">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      <button
                        onClick={() => setActiveChildId("all")}
                        className={[
                          "whitespace-nowrap rounded-full px-3 py-1 text-xs",
                          activeChildId === "all"
                            ? "bg-white text-slate-900"
                            : "bg-slate-900/40 text-slate-100 border border-white/10",
                        ].join(" ")}
                      >
                        Vue globale
                      </button>
                      {kids.map((k) => (
                        <button
                          key={k.id}
                          onClick={() => setActiveChildId(k.id)}
                          className={[
                            "flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs",
                            activeChildId === k.id
                              ? "bg-emerald-300 text-slate-900"
                              : "bg-slate-900/40 text-slate-100 border border-white/10",
                          ].join(" ")}
                        >
                          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                            {getInitials(k.full_name)}
                          </span>
                          <span className="truncate max-w-[120px]">{k.full_name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </header>

            {/* iOS hint */}
            {isiOS && !isStandalone && !granted && (
              <div className="rounded-2xl border p-3 bg-amber-50 text-amber-900">
                <div className="text-sm">
                  <b>iPhone/iPad :</b> pour recevoir les notifications, ajoutez d’abord l’app à
                  l’écran d’accueil : ouvrez cette page dans <b>Safari</b> → <b>Partager</b> →{" "}
                  <b>Ajouter à l’écran d’accueil</b>. Puis rouvrez l’app et appuyez sur{" "}
                  <i>Activer les notifications</i>.
                </div>
              </div>
            )}

            {/* Conduite — moyenne par enfant (visible en Dashboard + Conduite) */}
            {showConductSection && (
              <section className="rounded-2xl border bg-white/90 backdrop-blur p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                    Conduite — Moyenne par enfant
                  </div>
                  <div className="hidden md:flex items-center gap-2">
                    <Input
                      type="date"
                      value={conductFrom}
                      onChange={(e) => setConductFrom(e.target.value)}
                    />
                    <span className="text-slate-600 text-xs">au</span>
                    <Input
                      type="date"
                      value={conductTo}
                      onChange={(e) => setConductTo(e.target.value)}
                    />
                    <Button onClick={applyConductFilter} disabled={loadingConduct}>
                      {loadingConduct ? "…" : "Valider"}
                    </Button>
                  </div>
                </div>

                {/* Filtres (mobile) */}
                <div className="md:hidden mb-4 grid grid-cols-2 gap-2">
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
                  <div className="col-span-2">
                    <Button
                      className="w-full"
                      onClick={applyConductFilter}
                      disabled={loadingConduct}
                    >
                      {loadingConduct ? "…" : "Valider"}
                    </Button>
                  </div>
                </div>

                {loadingKids ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : kids.length === 0 ? (
                  <div className="flex items-center justify-between rounded-xl border bg-slate-50 p-4">
                    <div className="text-sm text-slate-700">
                      Aucun enfant lié à votre compte pour l’instant.
                    </div>
                    {!granted && (
                      <Button tone="outline" onClick={enablePush} iconLeft={<IconBell />}>
                        Activer les push
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Mobile: cartes */}
                    <div className="md:hidden space-y-3">
                      {filteredKids.map((k) => {
                        const c = conduct[k.id];
                        return (
                          <div
                            key={k.id}
                            className="rounded-xl border border-slate-200 p-4 hover:shadow-sm transition ring-emerald-100 hover:ring-2"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-slate-900">{k.full_name}</div>
                                <div className="text-xs text-slate-600">
                                  {k.class_label || "—"}
                                </div>
                              </div>
                              {c ? (
                                <Badge tone="emerald">
                                  {c.total.toFixed(2).replace(".", ",")} / 20
                                </Badge>
                              ) : (
                                <Badge>—</Badge>
                              )}
                            </div>
                            {c ? (
                              <div className="mt-3 space-y-2">
                                <Meter
                                  value={c.breakdown.assiduite}
                                  max={6}
                                  label={`Assiduité — ${Math.round(
                                    c.breakdown.assiduite
                                  )}/6`}
                                />
                                <Meter
                                  value={c.breakdown.tenue}
                                  max={3}
                                  label={`Tenue — ${Math.round(
                                    c.breakdown.tenue
                                  )}/3`}
                                />
                                <Meter
                                  value={c.breakdown.moralite}
                                  max={4}
                                  label={`Moralité — ${Math.round(
                                    c.breakdown.moralite
                                  )}/4`}
                                />
                                <Meter
                                  value={c.breakdown.discipline}
                                  max={7}
                                  label={`Discipline — ${Math.round(
                                    c.breakdown.discipline
                                  )}/7`}
                                />
                                <div className="pt-1 text-xs text-slate-600">
                                  <span className="font-medium">Appréciation : </span>
                                  {c.appreciation}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 text-sm text-slate-600">—</div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop: tableau */}
                    <div className="hidden md:block overflow-x-auto mt-2 rounded-xl border">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left">Enfant</th>
                            <th className="px-3 py-2 text-left">Classe</th>
                            <th className="px-3 py-2 text-left">Assiduité (/6)</th>
                            <th className="px-3 py-2 text-left">Tenue (/3)</th>
                            <th className="px-3 py-2 text-left">Moralité (/4)</th>
                            <th className="px-3 py-2 text-left">Discipline (/7)</th>
                            <th className="px-3 py-2 text-left">Moyenne (/20)</th>
                            <th className="px-3 py-2 text-left">Appréciation</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white/60">
                          {filteredKids.map((k) => {
                            const c = conduct[k.id];
                            return (
                              <tr key={k.id} className="border-t">
                                <td className="px-3 py-2">{k.full_name}</td>
                                <td className="px-3 py-2">{k.class_label || "—"}</td>
                                {c ? (
                                  <>
                                    <td className="px-3 py-2">
                                      {c.breakdown.assiduite
                                        .toFixed(2)
                                        .replace(".", ",")}
                                    </td>
                                    <td className="px-3 py-2">
                                      {c.breakdown.tenue.toFixed(2).replace(".", ",")}
                                    </td>
                                    <td className="px-3 py-2">
                                      {c.breakdown.moralite
                                        .toFixed(2)
                                        .replace(".", ",")}
                                    </td>
                                    <td className="px-3 py-2">
                                      {c.breakdown.discipline
                                        .toFixed(2)
                                        .replace(".", ",")}
                                    </td>
                                    <td className="px-3 py-2 font-semibold">
                                      {c.total.toFixed(2).replace(".", ",")}
                                    </td>
                                    <td className="px-3 py-2">{c.appreciation}</td>
                                  </>
                                ) : (
                                  <td className="px-3 py-2 text-slate-600" colSpan={6}>
                                    —
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* Absences / Sanctions / Notes (vue Dashboard + onglet Absences) */}
            {showEventsSection && (
              <section className="rounded-2xl border bg-white/90 backdrop-blur p-5 shadow-sm">
                {(() => {
                  const title = isAbsences
                    ? "Cahier d’absences — Absences/retards récents et sanctions"
                    : "Mes enfants — Absences/retards récents, sanctions et notes publiées";
                  return (
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                        {title}
                      </div>
                      <div className="flex items-center gap-2">
                        {granted ? (
                          <span className="text-xs text-emerald-700">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                ) : kids.length === 0 ? (
                  <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
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

                      const showEventsBlock = isDashboard || isAbsences;
                      const showSanctionsBlock = isDashboard || isAbsences;
                      const showNotesBlock = isDashboard; // résumé notes sur Dashboard

                      return (
                        <TiltCard key={k.id} className={t.ring}>
                          <div
                            className={`relative rounded-xl border ${t.border} p-4 transition shadow-sm bg-white`}
                          >
                            {/* liseré dégradé haut */}
                            <div
                              className={`absolute inset-x-0 top-0 h-1 rounded-t-xl bg-gradient-to-r ${t.bar}`}
                              style={{ transform: "translateZ(20px)" }}
                            />
                            <div
                              className="flex items-center justify-between"
                              style={{ transform: "translateZ(16px)" }}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                {/* avatar initiales coloré */}
                                <div
                                  className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-semibold ${t.chipBg} ${t.chipText} shadow-sm`}
                                >
                                  {getInitials(k.full_name)}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-900 truncate">
                                    {k.full_name}{" "}
                                    <span className="text-xs text-slate-600">
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
                                  className="text-xs text-slate-700 underline-offset-2 hover:underline shrink-0"
                                  style={{ transform: "translateZ(16px)" }}
                                >
                                  {showAll ? "Réduire" : "Voir plus"}
                                </button>
                              )}
                            </div>

                            {/* Absences / retards par jour */}
                            {showEventsBlock && (
                              <ul className="mt-3 space-y-2">
                                {visibleGroups.map((g) => {
                                  const key = `${k.id}|${g.day}`;
                                  const isOpen = !!expanded[key];
                                  const hasSingle = g.items.length === 1;

                                  const parts: string[] = [];
                                  if (g.absentCount)
                                    parts.push(
                                      `${g.absentCount} absence${
                                        g.absentCount > 1 ? "s" : ""
                                      }`
                                    );
                                  if (g.lateCount)
                                    parts.push(
                                      `${g.lateCount} retard${
                                        g.lateCount > 1 ? "s" : ""
                                      }`
                                    );
                                  const summary = parts.length
                                    ? parts.join(" • ")
                                    : "Aucun évènement";

                                  return (
                                    <li
                                      key={g.day}
                                      className="rounded-lg border p-3 hover:bg-slate-50/70 transition"
                                      style={{ transform: "translateZ(10px)" }}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="text-sm font-medium text-slate-800">
                                          {g.label} :{" "}
                                          <span className="font-normal text-slate-700">
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
                                            className="text-xs text-emerald-700 underline-offset-2 hover:underline shrink-0"
                                          >
                                            {isOpen || hasSingle
                                              ? "Masquer"
                                              : "Voir détails"}
                                          </button>
                                        )}
                                      </div>
                                      {(isOpen || hasSingle) && g.items.length > 0 && (
                                        <ul className="mt-2 divide-y">
                                          {g.items.map((ev) => (
                                            <li
                                              key={ev.id}
                                              className="py-2 flex items-center justify-between text-sm"
                                            >
                                              <div className="min-w-0">
                                                <div className="text-slate-800 truncate">
                                                  {ev.type === "absent" ? (
                                                    <Badge tone="rose">Absence</Badge>
                                                  ) : (
                                                    <Badge tone="amber">
                                                      Retard
                                                    </Badge>
                                                  )}
                                                  <span className="ml-2">
                                                    {ev.subject_name || "—"}
                                                  </span>
                                                </div>
                                                <div className="mt-0.5 text-xs text-slate-600">
                                                  {slotLabel(
                                                    ev.when,
                                                    ev.expected_minutes
                                                  )}{" "}
                                                  {ev.type === "late" &&
                                                  ev.minutes_late
                                                    ? `• ${ev.minutes_late} min`
                                                    : ""}
                                                </div>
                                              </div>
                                              <div className="text-xs text-slate-500 shrink-0 pl-2">
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
                                  <li className="py-2 text-sm text-slate-600">
                                    Aucun évènement récent.
                                  </li>
                                )}
                              </ul>
                            )}

                            {/* Sanctions */}
                            {showSanctionsBlock && (
                              <div
                                className="mt-3 rounded-lg border p-3 bg-amber-50/40"
                                style={{ transform: "translateZ(8px)" }}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="text-sm font-medium text-slate-800">
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
                                      className="text-xs text-slate-700 underline-offset-2 hover:underline"
                                    >
                                      {showAllPenForKid[k.id] ? "Réduire" : "Voir plus"}
                                    </button>
                                  )}
                                </div>
                                {(kidPenalties[k.id]?.length || 0) === 0 ? (
                                  <div className="mt-2 text-sm text-slate-600">
                                    Aucune sanction récente.
                                  </div>
                                ) : (
                                  <ul className="mt-2 divide-y">
                                    {(showAllPenForKid[k.id]
                                      ? kidPenalties[k.id] || []
                                      : (kidPenalties[k.id] || []).slice(0, 5)
                                    ).map((p) => (
                                      <li
                                        key={p.id}
                                        className="py-2 flex items-center justify-between text-sm"
                                      >
                                        <div className="min-w-0">
                                          <div className="text-slate-800">
                                            <span className="mr-2">
                                              <Badge tone="amber">
                                                {rubricLabel(p.rubric)}
                                              </Badge>
                                            </span>
                                            −{Number(p.points || 0).toFixed(2)} pt
                                            {(() => {
                                              const subj =
                                                p.author_subject_name ||
                                                p.subject_name;
                                              if (p.author_role_label === "Enseignant")
                                                return subj
                                                  ? ` — par le prof de ${subj}`
                                                  : " — par un enseignant";
                                              if (
                                                p.author_role_label ===
                                                "Administration"
                                              )
                                                return " — par l’administration";
                                              return p.author_name
                                                ? ` — par ${p.author_name}`
                                                : "";
                                            })()}
                                          </div>
                                          <div className="text-xs text-slate-600 truncate">
                                            {fmt(p.when)}{" "}
                                            {p.class_label
                                              ? `• ${p.class_label}`
                                              : ""}{" "}
                                            {p.reason ? `• Motif: ${p.reason}` : ""}
                                          </div>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}

                            {/* Notes publiées (petit résumé Dashboard uniquement) */}
                            {showNotesBlock && (
                              <div
                                className="mt-3 rounded-lg border p-3 bg-slate-50/60"
                                style={{ transform: "translateZ(6px)" }}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="text-sm font-medium text-slate-800">
                                    Notes publiées (dernières)
                                  </div>
                                </div>
                                {gradesForKid.length === 0 ? (
                                  <div className="mt-2 text-sm text-slate-600">
                                    Aucune note publiée pour le moment.
                                  </div>
                                ) : (
                                  <ul className="mt-2 space-y-1">
                                    {gradesForKid.slice(0, 5).map((gr) => (
                                      <li
                                        key={gr.id}
                                        className="text-sm flex items-center justify-between gap-2"
                                      >
                                        <div className="min-w-0">
                                          <div className="text-slate-800 truncate">
                                            {gradeKindLabel(gr.eval_kind)}{" "}
                                            <span className="text-xs text-slate-500">
                                              (
                                              {new Date(
                                                gr.eval_date
                                              ).toLocaleDateString("fr-FR")}
                                              )
                                            </span>
                                            {gr.subject_name && (
                                              <span className="ml-1 text-xs text-slate-500">
                                                • {gr.subject_name}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs text-slate-600">
                                            {gr.score == null
                                              ? "Non noté"
                                              : `${Number(gr.score)
                                                  .toFixed(2)
                                                  .replace(".", ",")} / ${
                                                  gr.scale
                                                }`}{" "}
                                            {gr.coeff ? (
                                              <span className="text-[11px] text-slate-500">
                                                • coeff {gr.coeff}
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
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

            {/* Cahier de notes — vue dédiée par matière */}
            {showNotesSection && (
              <section className="rounded-2xl border bg-white/90 backdrop-blur p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                      Cahier de notes — Par matière
                    </div>
                    <div className="text-xs text-slate-600">
                      Sélectionnez une période, puis une matière pour voir les notes publiées.
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={() => setGradeFilterMode("week")}
                      className={[
                        "rounded-full px-3 py-1",
                        gradeFilterMode === "week"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                      ].join(" ")}
                    >
                      Cette semaine
                    </button>
                    <button
                      onClick={() => setGradeFilterMode("month")}
                      className={[
                        "rounded-full px-3 py-1",
                        gradeFilterMode === "month"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                      ].join(" ")}
                    >
                      Ce mois-ci
                    </button>
                    <button
                      onClick={() => setGradeFilterMode("all")}
                      className={[
                        "rounded-full px-3 py-1",
                        gradeFilterMode === "all"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                      ].join(" ")}
                    >
                      Toute l’année
                    </button>
                    <button
                      onClick={() => setGradeFilterMode("custom")}
                      className={[
                        "rounded-full px-3 py-1",
                        gradeFilterMode === "custom"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                      ].join(" ")}
                    >
                      Perso.
                    </button>
                  </div>
                </div>

                {gradeFilterMode === "custom" && (
                  <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
                    <Input
                      type="date"
                      value={gradeFrom}
                      onChange={(e) => setGradeFrom(e.target.value)}
                    />
                    <span className="hidden sm:inline text-xs text-slate-500 text-center">
                      au
                    </span>
                    <Input
                      type="date"
                      value={gradeTo}
                      onChange={(e) => setGradeTo(e.target.value)}
                    />
                  </div>
                )}

                {(gradeFrom || gradeTo) && gradeFilterMode !== "all" && (
                  <div className="mb-4 text-xs text-slate-600">
                    Période sélectionnée{" "}
                    {gradeFrom ? `du ${gradeFrom.split("-").reverse().join("/")}` : ""}{" "}
                    {gradeTo ? `au ${gradeTo.split("-").reverse().join("/")}` : ""}
                  </div>
                )}

                {loadingKids ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : kids.length === 0 ? (
                  <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
                    Aucun enfant lié à votre compte pour l’instant.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {filteredKids.map((k, kidIndex) => {
                      const allGrades = kidGrades[k.id] || [];
                      const filteredGrades = allGrades.filter((gr) =>
                        isInDateRange(gr.eval_date, gradeFrom || undefined, gradeTo || undefined)
                      );

                      // Regroupement par matière (uniquement celles avec au moins une note sur la période)
                      const subjectMap = new Map<
                        string,
                        { key: string; name: string; count: number }
                      >();
                      for (const gr of filteredGrades) {
                        const key = gr.subject_id || gr.subject_name || "autre";
                        const name = gr.subject_name || "Matière inconnue";
                        if (!subjectMap.has(key)) {
                          subjectMap.set(key, { key, name, count: 0 });
                        }
                        subjectMap.get(key)!.count += 1;
                      }
                      const subjects = Array.from(subjectMap.values()).sort((a, b) =>
                        a.name.localeCompare(b.name, "fr")
                      );

                      const selectedKey = activeSubjectPerKid[k.id] || null;
                      const selectedGrades =
                        selectedKey == null
                          ? []
                          : filteredGrades
                              .filter((gr) => {
                                const key = gr.subject_id || gr.subject_name || "autre";
                                return key === selectedKey;
                              })
                              .sort(
                                (a, b) =>
                                  new Date(b.eval_date).getTime() -
                                  new Date(a.eval_date).getTime()
                              );

                      // Moyenne /20 sur la période pour la matière sélectionnée
                      let avg20: number | null = null;
                      if (selectedGrades.length > 0) {
                        const numeric = selectedGrades.filter(
                          (g) => g.score != null && g.scale > 0
                        );
                        if (numeric.length > 0) {
                          const sum = numeric.reduce(
                            (acc, g) => acc + ((g.score as number) / g.scale) * 20,
                            0
                          );
                          avg20 = sum / numeric.length;
                        }
                      }

                      const containerTheme = themeFor(kidIndex);

                      return (
                        <div
                          key={k.id}
                          className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-semibold ${containerTheme.chipBg} ${containerTheme.chipText}`}
                              >
                                {getInitials(k.full_name)}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-slate-900 truncate">
                                  {k.full_name}
                                </div>
                                <div className="text-xs text-slate-600">
                                  {k.class_label || "—"}
                                </div>
                              </div>
                            </div>
                            <div className="text-xs text-slate-500">
                              {subjects.length === 0
                                ? "Aucune note publiée sur cette période."
                                : `${subjects.length} matière${
                                    subjects.length > 1 ? "s" : ""
                                  } avec au moins une note publiée.`}
                            </div>
                          </div>

                          {/* Cartes matières */}
                          {subjects.length > 0 && (
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {subjects.map((s, idx) => {
                                const th = themeFor(idx);
                                const active = selectedKey === s.key;
                                return (
                                  <button
                                    key={s.key}
                                    onClick={() =>
                                      setActiveSubjectPerKid((prev) => ({
                                        ...prev,
                                        [k.id]:
                                          prev[k.id] === s.key ? null : s.key,
                                      }))
                                    }
                                    className={[
                                      "flex flex-col items-start rounded-xl border p-3 text-left transition shadow-sm",
                                      active
                                        ? "border-slate-900 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white"
                                        : `bg-white hover:shadow-md ${th.border}`,
                                    ].join(" ")}
                                  >
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={`h-8 w-1.5 rounded-full bg-gradient-to-b ${th.bar}`}
                                      />
                                      <div className="min-w-0">
                                        <div
                                          className={[
                                            "text-sm font-semibold",
                                            active ? "text-white" : "text-slate-900",
                                          ].join(" ")}
                                        >
                                          {s.name}
                                        </div>
                                        <div
                                          className={[
                                            "text-[11px]",
                                            active
                                              ? "text-slate-200"
                                              : "text-slate-500",
                                          ].join(" ")}
                                        >
                                          {s.count} note{s.count > 1 ? "s" : ""} sur la
                                          période
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Détail notes pour la matière sélectionnée */}
                          {selectedKey && (
                            <div className="mt-4 rounded-xl border bg-slate-50/80 p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-800">
                                  Notes détaillées en{" "}
                                  {
                                    subjects.find((s) => s.key === selectedKey)
                                      ?.name
                                  }
                                </div>
                                {avg20 != null && (
                                  <div className="text-xs text-slate-700">
                                    Moyenne sur la période :{" "}
                                    <span className="font-semibold">
                                      {avg20.toFixed(2).replace(".", ",")} / 20
                                    </span>
                                  </div>
                                )}
                              </div>

                              {selectedGrades.length === 0 ? (
                                <div className="text-sm text-slate-600">
                                  Aucune note pour cette période dans cette matière.
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead>
                                      <tr className="border-b bg-slate-100/80">
                                        <th className="px-2 py-1 text-left">Date</th>
                                        <th className="px-2 py-1 text-left">Évaluation</th>
                                        <th className="px-2 py-1 text-left">Type</th>
                                        <th className="px-2 py-1 text-left">Note</th>
                                        <th className="px-2 py-1 text-left">Coeff</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {selectedGrades.map((gr) => (
                                        <tr key={gr.id} className="border-b last:border-0">
                                          <td className="px-2 py-1">
                                            {new Date(
                                              gr.eval_date
                                            ).toLocaleDateString("fr-FR")}
                                          </td>
                                          <td className="px-2 py-1">
                                            {gr.title || "—"}
                                          </td>
                                          <td className="px-2 py-1">
                                            {gradeKindLabel(gr.eval_kind)}
                                          </td>
                                          <td className="px-2 py-1">
                                            {gr.score == null
                                              ? "Non noté"
                                              : `${Number(
                                                  gr.score
                                                ).toFixed(2).replace(".", ",")} / ${
                                                  gr.scale
                                                }`}
                                          </td>
                                          <td className="px-2 py-1">
                                            {gr.coeff || 1}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Si pas de matière et pas de notes sur la période */}
                          {subjects.length === 0 && (
                            <div className="mt-3 text-xs text-slate-600">
                              Aucune matière n’a de note publiée sur cette période pour cet
                              enfant.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!loadingKids && kids.length > 0 && filteredKids.length === 0 && (
                  <div className="mt-3 text-xs text-slate-600">
                    Aucun enfant sélectionné pour l’instant.
                  </div>
                )}
              </section>
            )}

            {msg && (
              <div className="text-sm text-slate-700" aria-live="polite">
                {msg}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Bottom navigation mobile type app native */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-6xl items-stretch justify-between">
          <button
            type="button"
            onClick={() => selectSection("dashboard")}
            className={[
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium border-t-2",
              isDashboard ? "text-emerald-700 border-emerald-500" : "text-slate-500 border-transparent",
            ].join(" ")}
          >
            <span className="mb-0.5">
              <IconHome />
            </span>
            <span>Tableau</span>
          </button>
          <button
            type="button"
            onClick={() => selectSection("conduct")}
            className={[
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium border-t-2",
              isConduct ? "text-emerald-700 border-emerald-500" : "text-slate-500 border-transparent",
            ].join(" ")}
          >
            <span className="mb-0.5">
              <IconClipboard />
            </span>
            <span>Conduite</span>
          </button>
          <button
            type="button"
            onClick={() => selectSection("absences")}
            className={[
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium border-t-2",
              isAbsences ? "text-emerald-700 border-emerald-500" : "text-slate-500 border-transparent",
            ].join(" ")}
          >
            <span className="mb-0.5">
              <IconClipboard />
            </span>
            <span>Absences</span>
          </button>
          <button
            type="button"
            onClick={() => selectSection("notes")}
            className={[
              "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium border-t-2",
              isNotes ? "text-emerald-700 border-emerald-500" : "text-slate-500 border-transparent",
            ].join(" ")}
          >
            <span className="mb-0.5">
              <IconBook />
            </span>
            <span>Notes</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
