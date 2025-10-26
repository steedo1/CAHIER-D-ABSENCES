// src/app/parents/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

/** YYYY-MM-DD (UTC-safe pour notre usage d’affichage) */
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

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ types â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type Kid = { id: string; full_name: string; class_label: string | null };
type Ev = {
  id: string;
  when: string;
  type: "absent" | "late";
  minutes_late?: number | null;
  class_label?: string | null;
  subject_name?: string | null;
};
type Notif = {
  id: string;
  title: string;
  body: string;
  severity?: "high" | "medium" | "low";
  created_at: string;
  read_at: string | null;
  payload?: Record<string, any>;
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ petites icônes inline (aucune dépendance externe) â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function BellIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={p.className}>
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14v-3a6 6 0 1 0-12 0v3c0 .53-.21 1.04-.59 1.41L4 17h5m2 3a2 2 0 0 0 2-2H9a2 2 0 0 0 2 2z" />
    </svg>
  );
}
function XCircleIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={p.className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}
function ClockIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={p.className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ UI helpers (inputs/boutons pro & accessibles) â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" | "red" }
) {
  const tone = p.tone ?? "emerald";
  const map: Record<"emerald" | "slate" | "red", string> = {
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-600/30",
    red: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30",
  };
  const { tone: _t, className, ...rest } = p;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition",
        "focus:outline-none focus:ring-4 disabled:opacity-60 disabled:cursor-not-allowed",
        map[tone],
        className ?? "",
      ].join(" ")}
    />
  );
}
function GhostButton(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "red" | "slate" | "emerald" }
) {
  const tone = p.tone ?? "slate";
  const map: Record<typeof tone, string> = {
    red: "border-red-300 text-red-700 hover:bg-red-50 focus:ring-red-500/20",
    slate: "border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500/20",
    emerald: "border-emerald-300 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-500/20",
  };
  const { tone: _t, className, ...rest } = p;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition",
        "focus:outline-none focus:ring-4",
        map[tone],
        className ?? "",
      ].join(" ")}
    />
  );
}
function Chip({ children, tone = "emerald" }: { children: React.ReactNode; tone?: "emerald" | "slate" | "amber" }) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    slate: "bg-slate-50 text-slate-800 ring-slate-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
  } as const;
  return (
    <span className={["inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1", map[tone]].join(" ")}>
      {children}
    </span>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ thèmes de couleur â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const TONES = {
  red: { bg: "bg-rose-50/60", text: "text-rose-700", ring: "border-rose-200" },
  amber: { bg: "bg-amber-50/60", text: "text-amber-700", ring: "border-amber-200" },
  sky: { bg: "bg-sky-50/60", text: "text-sky-700", ring: "border-sky-200" },
} as const;
type NotifTone = keyof typeof TONES;

/** Déduit l’apparence Ã  partir de severity et du contenu (fallback robuste) */
function getNotifMeta(
  n: Notif
): {
  tone: NotifTone;
  Icon: (p: { className?: string }) => any;
  label: string;
} {
  if (n.severity === "high") return { tone: "red", Icon: XCircleIcon, label: "Absence" };
  if (n.severity === "medium") return { tone: "amber", Icon: ClockIcon, label: "Retard" };

  const t = `${(n.payload as any)?.event ?? (n.payload as any)?.status ?? n.title}`.toLowerCase();
  if (t.includes("absent") || t.includes("absence")) return { tone: "red", Icon: XCircleIcon, label: "Absence" };
  if (t.includes("late") || t.includes("retard")) return { tone: "amber", Icon: ClockIcon, label: "Retard" };

  return { tone: "sky", Icon: BellIcon, label: "Notification" };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ regroupement des événements par jour â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type DayGroup = {
  day: string;      // "YYYY-MM-DD"
  label: string;    // "Aujourd’hui" / "Hier" / "23/10/2025"
  absentCount: number;
  lateCount: number;
  items: Ev[];      // triés du plus récent au plus ancien
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
    groups.push({ day: k, label: dayLabel(ordered[0].when), absentCount, lateCount, items: ordered });
  }
  groups.sort((a, b) => b.day.localeCompare(a.day));
  return groups;
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ composant â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function ParentPage() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [feed, setFeed] = useState<Record<string, Ev[]>>({});
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loadingKids, setLoadingKids] = useState(true);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // mot de passe
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);

  // état UI résumé â†’ détails
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllDaysForKid, setShowAllDaysForKid] = useState<Record<string, boolean>>({});

  /* ---- chargements ---- */
  async function loadKids() {
    setLoadingKids(true);
    try {
      const j = await fetch("/api/parent/children", { cache: "no-store" }).then((r) => r.json());
      const ks = (j.items || []) as Kid[];
      setKids(ks);

      const entries = await Promise.all(
        ks.map(async (k) => {
          const f = await fetch(`/api/parent/children/events?student_id=${encodeURIComponent(k.id)}`, {
            cache: "no-store",
          }).then((r) => r.json());
          return [k.id, (f.items || []) as Ev[]] as const;
        })
      );
      setFeed(Object.fromEntries(entries));

      const initialExpanded: Record<string, boolean> = {};
      for (const [kidId, list] of entries) {
        const groups = groupByDay(list);
        for (const g of groups) if (g.items.length === 1) initialExpanded[`${kidId}|${g.day}`] = true;
      }
      setExpanded(initialExpanded);
    } catch (e: any) {
      setMsg(e?.message || "Erreur de chargement.");
    } finally {
      setLoadingKids(false);
    }
  }
  async function loadNotifs() {
    setLoadingNotifs(true);
    try {
      const j = await fetch("/api/parent/notifications", { cache: "no-store" }).then((r) => r.json());
      setNotifs((j.items || []) as Notif[]);
    } finally {
      setLoadingNotifs(false);
    }
  }
  useEffect(() => {
    loadKids();
    loadNotifs();
  }, []);

  /* ---- actions notifs ---- */
  async function markAllRead() {
    const ids = notifs.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    await fetch("/api/parent/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const iso = new Date().toISOString();
    setNotifs((n) => n.map((x) => (x.read_at ? x : { ...x, read_at: iso })));
  }
  async function markOneRead(id: string) {
    await fetch("/api/parent/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    const iso = new Date().toISOString();
    setNotifs((n) => n.map((x) => (x.id === id && !x.read_at ? { ...x, read_at: iso } : x)));
  }

  /* ---- push ---- */
  async function enablePush() {
    try {
      setMsg(null);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setMsg("Votre navigateur ne supporte pas les notifications push.");
        return;
      }
      const { key } = await fetch("/api/push/vapid", { cache: "no-store" }).then((r) => r.json());
      if (!key) {
        setMsg("Clé VAPID indisponible.");
        return;
      }
      const applicationServerKey = urlBase64ToUint8Array(String(key));
      const reg = await navigator.serviceWorker.register("/sw.js");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Ã‰chec enregistrement push");
      }
      setMsg("Notifications push activées âœ…");
    } catch (e: any) {
      setMsg(e?.message || "Activation push impossible");
    }
  }

  /* ---- mot de passe ---- */
  async function changePassword() {
    setPwdMsg(null);
    if (!newPwd.trim() || newPwd.length < 6) {
      setPwdMsg("Mot de passe trop court (6+).");
      return;
    }
    if (newPwd !== newPwd2) {
      setPwdMsg("La confirmation ne correspond pas.");
      return;
    }
    setPwdBusy(true);
    try {
      const r = await fetch("/api/parent/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newPwd }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Ã‰chec");
      setPwdMsg("Mot de passe mis Ã  jour âœ…");
      setNewPwd("");
      setNewPwd2("");
    } catch (e: any) {
      setPwdMsg(e?.message || "Erreur");
    } finally {
      setPwdBusy(false);
    }
  }

  const hasUnread = useMemo(() => notifs.some((n) => !n.read_at), [notifs]);

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€ rendu â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6 space-y-6 scroll-smooth">
      {/* Bande d’en-tête BLEU NUIT (locale Ã  la page, ne casse rien au layout) */}
      <header
        className={[
          "flex items-center justify-between rounded-2xl px-5 py-4 shadow-sm",
          "border border-blue-900/60 ring-1 ring-blue-800/40",
          "bg-blue-950 text-white",
        ].join(" ")}
      >
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Espace parent</h1>
          <p className="text-white/80 text-sm">
            Suivez les absences et retards de vos enfants, et recevez des notifications.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="#mon-compte"
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white ring-1 ring-white/30 hover:bg-white/15 hover:ring-white/50"
            title="Accéder Ã  la section Mon compte"
          >
            Mon compte
          </a>
          <a
            href="/logout"
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white ring-1 ring-white/30 hover:bg-white/15 hover:ring-white/50"
            title="Se déconnecter"
          >
            Déconnexion
          </a>
          <button
            onClick={enablePush}
            className="rounded-full bg-emerald-400/90 px-3 py-1.5 text-sm text-emerald-950 ring-1 ring-emerald-300 hover:bg-emerald-300"
            title="Activer les notifications push"
          >
            Activer les push
          </button>
        </div>
      </header>

      {/* Notifications */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Mes notifications</div>
          <div className="flex items-center gap-3">
            <button
              onClick={loadNotifs}
              className="text-xs text-slate-700 underline-offset-2 hover:underline"
              title="Rafraîchir"
            >
              Rafraîchir
            </button>
            <button
              className="text-xs text-emerald-700 underline-offset-2 hover:underline disabled:opacity-40"
              onClick={markAllRead}
              disabled={!hasUnread}
            >
              Tout marquer comme lu
            </button>
          </div>
        </div>

        {loadingNotifs ? (
          <div className="text-sm text-slate-500">Chargement…</div>
        ) : notifs.length === 0 ? (
          <div className="text-sm text-slate-500">Aucune notification.</div>
        ) : (
          <ul className="space-y-2">
            {notifs.map((n) => {
              const unread = !n.read_at;
              const { tone, Icon, label } = getNotifMeta(n);
              const toneCls = TONES[tone];

              return (
                <li key={n.id} className={`rounded-xl border p-3 transition ${unread ? toneCls.bg : "bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 grid h-9 w-9 place-items-center rounded-full border bg-white ${toneCls.text} ${toneCls.ring}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate font-medium">
                          {n.title || label}
                          {unread && (
                            <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                              non lu
                            </span>
                          )}
                        </div>
                        {!n.read_at && (
                          <button
                            onClick={() => markOneRead(n.id)}
                            className={`shrink-0 text-xs ${toneCls.text} underline-offset-2 hover:underline`}
                          >
                            Marquer lu
                          </button>
                        )}
                      </div>

                      {n.body && <div className="mt-0.5 text-sm text-slate-700">{n.body}</div>}
                      <div className="mt-1 text-[11px] text-slate-500">
                        {fmt(n.created_at)} {n.read_at ? "Â· lu" : "Â· non lu"}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Mes enfants — avec résumé/accordéon par jour */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Mes enfants — Absences/retards récents
        </div>

        {loadingKids ? (
          <div className="text-sm text-slate-500">Chargement…</div>
        ) : kids.length === 0 ? (
          <div className="text-sm text-slate-500">Aucun enfant lié Ã  votre compte pour l’instant.</div>
        ) : (
          <div className="space-y-4">
            {kids.map((k) => {
              const groups = groupByDay(feed[k.id] || []);
              const showAll = !!showAllDaysForKid[k.id];
              const visibleGroups = showAll ? groups : groups.slice(0, 3);

              return (
                <div key={k.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {k.full_name} <span className="text-xs text-slate-500">({k.class_label || "—"})</span>
                    </div>
                    {groups.length > 3 && (
                      <button
                        onClick={() => setShowAllDaysForKid((m) => ({ ...m, [k.id]: !m[k.id] }))}
                        className="text-xs text-slate-700 underline-offset-2 hover:underline"
                      >
                        {showAll ? "Réduire" : "Voir plus"}
                      </button>
                    )}
                  </div>

                  {/* Groupes par jour (résumé â†’ accordéon) */}
                  <ul className="mt-2 space-y-2">
                    {visibleGroups.map((g) => {
                      const key = `${k.id}|${g.day}`;
                      const isOpen = !!expanded[key];
                      const hasSingle = g.items.length === 1;

                      const parts: string[] = [];
                      if (g.absentCount) parts.push(`${g.absentCount} absence${g.absentCount > 1 ? "s" : ""}`);
                      if (g.lateCount) parts.push(`${g.lateCount} retard${g.lateCount > 1 ? "s" : ""}`);
                      const summary = parts.length ? parts.join(" â€¢ ") : "Aucun événement";

                      return (
                        <li key={g.day} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-slate-800">
                              {g.label} : <span className="font-normal text-slate-700">{summary}</span>
                            </div>

                            {g.items.length > 0 && (
                              <button
                                onClick={() => setExpanded((m) => ({ ...m, [key]: !m[key] }))}
                                className="text-xs text-emerald-700 underline-offset-2 hover:underline"
                              >
                                {isOpen || hasSingle ? "Masquer" : "Voir détails"}
                              </button>
                            )}
                          </div>

                          {(isOpen || hasSingle) && g.items.length > 0 && (
                            <ul className="mt-2 divide-y">
                              {g.items.map((ev) => (
                                <li key={ev.id} className="py-2 flex items-center justify-between text-sm">
                                  <div>
                                    <div className="text-slate-800">
                                      {ev.type === "absent" ? "Absence" : "Retard"} — {ev.subject_name || "—"}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {fmt(ev.when)} {ev.type === "late" && ev.minutes_late ? `â€¢ ${ev.minutes_late} min` : ""}
                                    </div>
                                  </div>
                                  <div className="text-xs text-slate-400">{ev.class_label || ""}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}

                    {visibleGroups.length === 0 && (
                      <li className="py-2 text-sm text-slate-500">Aucun événement récent.</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Mon compte */}
      <section id="mon-compte" className="rounded-2xl border bg-white p-5 shadow-sm scroll-mt-24">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Mon compte</div>
          <Chip tone="slate">Sécurité</Chip>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="mb-1 text-xs text-slate-500">Nouveau mot de passe</div>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Confirmer</div>
            <Input
              type="password"
              value={newPwd2}
              onChange={(e) => setNewPwd2(e.target.value)}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={changePassword} disabled={pwdBusy}>
              {pwdBusy ? "Mise Ã  jour…" : "Changer mon mot de passe"}
            </Button>
          </div>
        </div>
        {pwdMsg && <div className="mt-2 text-sm text-slate-700" aria-live="polite">{pwdMsg}</div>}
      </section>

      {msg && <div className="text-sm text-slate-700" aria-live="polite">{msg}</div>}
    </main>
  );
}


