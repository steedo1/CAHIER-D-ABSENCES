// src/app/parents/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

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

/** Ex: "10h-11h" si les deux minutes = 00, sinon "10h15-11h" / "10h-11h30" */
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

/* ───────── types ───────── */
type Kid = { id: string; full_name: string; class_label: string | null };
type Ev = {
  id: string;
  when: string;                         // session.started_at
  expected_minutes?: number | null;     // ⬅️ ajouté
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
  author_subject_name?: string | null; // ✅
  author_name?: string | null;
  author_role?: string | null;
  author_role_label?: string | null;
};
type Notif = {
  id: string;
  title: string;
  body: string;
  severity?: "high" | "medium" | "low";
  created_at: string;
  read_at: string | null;
  payload?: Record<string, unknown>;
};
type Conduct = {
  breakdown: { assiduite: number; tenue: number; moralite: number; discipline: number };
  total: number;
  appreciation: string;
};

/* ───────── icons ───────── */
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

/* ───────── UI ───────── */
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
const TONES = {
  red: { bg: "bg-rose-50/60", text: "text-rose-700", ring: "border-rose-200" },
  amber: { bg: "bg-amber-50/60", text: "text-amber-700", ring: "border-amber-200" },
  sky: { bg: "bg-sky-50/60", text: "text-sky-700", ring: "border-sky-200" },
} as const;
type NotifTone = keyof typeof TONES;

/* ✅ Absences/retards ET sanctions */
function getNotifMeta(n: Notif): { tone: NotifTone; Icon: React.ComponentType<{ className?: string }>; label: string } {
  const payload = (n.payload ?? {}) as any;
  const kind = String(payload.kind || "").toLowerCase();

  // Sanctions
  if (kind === "penalty") {
    const sev = String(n.severity || payload.severity || "").toLowerCase();
    if (sev === "high")   return { tone: "red",   Icon: XCircleIcon, label: "Sanction" };
    if (sev === "medium") return { tone: "amber", Icon: BellIcon,   label: "Sanction" };
    return { tone: "sky", Icon: BellIcon, label: "Sanction" };
  }

  // Assiduité (absence/retard)
  if (n.severity === "high")   return { tone: "red",   Icon: XCircleIcon, label: "Absence" };
  if (n.severity === "medium") return { tone: "amber", Icon: ClockIcon,   label: "Retard" };

  const t = `${payload.event ?? payload.status ?? n.title}`.toLowerCase();
  if (t.includes("absent") || t.includes("absence")) return { tone: "red",   Icon: XCircleIcon, label: "Absence" };
  if (t.includes("late")   || t.includes("retard"))  return { tone: "amber", Icon: ClockIcon,   label: "Retard" };
  return { tone: "sky", Icon: BellIcon, label: "Notification" };
}

/** Essaie de reconstruire un créneau ou une heure depuis la payload */
function tryNotifSlotPayload(payload?: Record<string, unknown>): string | null {
  if (!payload) return null;
  const p: any = payload;
  const kind = String(p.kind || "").toLowerCase();

  // 👉 Sanction : heure de l’événement (occurred_at)
  if (kind === "penalty" && typeof p.occurred_at === "string") {
    const d = new Date(p.occurred_at);
    const sh = String(d.getHours()).padStart(2, "0");
    const sm = String(d.getMinutes()).padStart(2, "0");
    return sm === "00" ? `${sh}h` : `${sh}h${sm}`;
  }

  // 👉 Assiduité : créneau depuis la session
  const startIso =
    p.session_started_at ||
    p.started_at ||
    p.start ||
    p.session?.started_at ||
    p.mark?.session?.started_at ||
    null;

  const mins =
    p.expected_minutes ??
    p.duration_minutes ??
    p.duration ??
    p.session?.expected_minutes ??
    p.mark?.session?.expected_minutes ??
    null;

  if (typeof startIso === "string") {
    return slotLabel(startIso, typeof mins === "number" ? mins : undefined);
  }
  return null;
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
    groups.push({ day: k, label: dayLabel(ordered[0].when), absentCount, lateCount, items: ordered });
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
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loadingKids, setLoadingKids] = useState(true);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [loadingConduct, setLoadingConduct] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Filtre période pour la conduite
  const [conductFrom, setConductFrom] = useState<string>("");
  const [conductTo, setConductTo] = useState<string>("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllDaysForKid, setShowAllDaysForKid] = useState<Record<string, boolean>>({});
  const [showAllPenForKid, setShowAllPenForKid] = useState<Record<string, boolean>>({});

  // 🔔 Permission de notification déjà accordée ?
  const [granted, setGranted] = useState(false);

  // 📱 iOS + mode standalone (PWA installée) → utile pour expliquer la contrainte iOS
  const [isiOS, setIsiOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const refresh = () =>
      setGranted(typeof Notification !== "undefined" && Notification.permission === "granted");
    refresh();

    setIsiOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const mq = window.matchMedia?.("(display-mode: standalone)");
    setIsStandalone(!!(mq?.matches || (navigator as any).standalone === true));

    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  async function loadKids() {
    setLoadingKids(true);
    try {
      const j = await fetch("/api/parent/children", { cache: "no-store" }).then((r) => r.json());
      const ks = (j.items || []) as Kid[];
      setKids(ks);

      const feedEntries: Array<[string, Ev[]]> = [];
      const penEntries: Array<[string, KidPenalty[]]> = [];

      for (const k of ks) {
        const f = await fetch(`/api/parent/children/events?student_id=${encodeURIComponent(k.id)}`, { cache: "no-store" }).then((r) => r.json());
        feedEntries.push([k.id, (f.items || []) as Ev[]]);

        const p = await fetch(`/api/parent/children/penalties?student_id=${encodeURIComponent(k.id)}&limit=20`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ items: [] }));
        penEntries.push([k.id, (p.items || []) as KidPenalty[]]);
      }

      setFeed(Object.fromEntries(feedEntries));
      setKidPenalties(Object.fromEntries(penEntries));

      // Ouvre automatiquement les journées avec un seul évènement
      const initialExpanded: Record<string, boolean> = {};
      for (const [kidId, list] of feedEntries) {
        const groups = groupByDay(list);
        for (const g of groups) if (g.items.length === 1) initialExpanded[`${kidId}|${g.day}`] = true;
      }
      setExpanded(initialExpanded);

      // Charger la conduite (avec période courante si définie)
      await loadConductForAll(ks, conductFrom, conductTo);
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
        const c = await fetch(`/api/parent/children/conduct?${qs.toString()}`, { cache: "no-store" })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasUnread = useMemo(() => notifs.some((n) => !n.read_at), [notifs]);
  async function markAllRead() {
    const ids = notifs.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    await fetch("/api/parent/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const iso = new Date().toISOString();
    setNotifs((n) => n.map((x) => (x.read_at ? x : { ...x, read_at: iso })));
  }
  async function markOneRead(id: string) {
    await fetch("/api/parent/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    const iso = new Date().toISOString();
    setNotifs((n) => n.map((x) => (x.id === id && !x.read_at ? { ...x, read_at: iso } : x)));
  }

  /* Push */
  async function enablePush() {
    try {
      setMsg(null);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setMsg("Votre navigateur ne supporte pas les notifications push.");
        return;
      }
      const { key } = await fetch("/api/push/vapid", { cache: "no-store" }).then((r) => r.json());
      if (!key) { setMsg("Clé VAPID indisponible."); return; }

      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setMsg("Permission refusée."); return; }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(String(key)),
        });
      }
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: sub }),
      });

      let payload: any = null;
      try { payload = await res.json(); } catch {}

      if (!res.ok) {
        console.error("subscribe_fail", { status: res.status, body: payload });
        setMsg(`Push KO (${res.status}) — ${payload?.error || "?"}${payload?.stage ? ` [${payload.stage}]` : ""}`);
        return;
      }
      console.info("subscribe_ok", payload);
      setMsg("Notifications push activées ✓");
      setGranted(true);
    } catch (e: any) {
      setMsg(e?.message || "Activation push impossible");
    }
  }

  /* Render */
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6 space-y-6 scroll-smooth">
      {/* Header */}
      <header className="flex items-center justify-between rounded-2xl px-5 py-4 shadow-sm border border-blue-900/60 ring-1 ring-blue-800/40 bg-blue-950 text-white">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Espace parent</h1>
          <p className="text-white/80 text-sm">Suivez les absences, retards et sanctions récentes de vos enfants. Activez les push pour être alerté.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/logout" className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white ring-1 ring-white/30 hover:bg-white/15 hover:ring-white/50" title="Se déconnecter">
            Déconnexion
          </a>
          {granted ? (
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/90 ring-1 ring-white/20">
              Notifications activées ✅
            </span>
          ) : (
            <button
              onClick={enablePush}
              className="rounded-full bg-emerald-400/90 px-3 py-1.5 text-sm text-emerald-950 ring-1 ring-emerald-300 hover:bg-emerald-300"
              title="Activer les notifications push"
            >
              Activer les push
            </button>
          )}
        </div>
      </header>

      {/* iOS hint (seulement si non installé + non autorisé) */}
      {isiOS && !isStandalone && !granted && (
        <div className="rounded-xl border p-3 bg-amber-50 text-amber-900">
          <div className="text-sm">
            <b>iPhone/iPad :</b> pour recevoir les notifications, ajoutez d’abord l’app à l’écran d’accueil :
            ouvrez cette page dans <b>Safari</b> → <b>Partager</b> → <b>Ajouter à l’écran d’accueil</b>.
            Puis rouvrez l’app et appuyez sur <i>Activer les notifications</i>.
          </div>
        </div>
      )}

      {/* Notifications */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Mes notifications</div>
          <div className="flex items-center gap-3">
            <button onClick={loadNotifs} className="text-xs text-slate-700 underline-offset-2 hover:underline">Rafraîchir</button>
            <button className="text-xs text-emerald-700 underline-offset-2 hover:underline disabled:opacity-40" onClick={markAllRead} disabled={!hasUnread}>Tout marquer comme lu</button>
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
              const slot = tryNotifSlotPayload(n.payload);

              return (
                <li key={n.id} className={`rounded-xl border p-3 transition ${unread ? toneCls.bg : "bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 grid h-9 w-9 place-items-center rounded-full border bg-white ${toneCls.text} ${toneCls.ring}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate font-medium">
                          {n.title || label}
                          {unread && <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">non lu</span>}
                        </div>
                        {!n.read_at && (
                          <button onClick={() => markOneRead(n.id)} className={`shrink-0 text-xs ${toneCls.text} underline-offset-2 hover:underline`}>Marquer lu</button>
                        )}
                      </div>
                      {n.body && <div className="mt-0.5 text-sm text-slate-700">{n.body}</div>}
                      {slot && <div className="mt-0.5 text-xs text-slate-600">Créneau : <span className="font-medium">{slot}</span></div>}
                      <div className="mt-1 text-[11px] text-slate-500">{fmt(n.created_at)} {n.read_at ? "• lu" : "• non lu"}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Conduite — moyenne par enfant (avec filtre période) */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Conduite — Moyenne par enfant</div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2">
              <Input type="date" value={conductFrom} onChange={(e) => setConductFrom(e.target.value)} />
              <span className="text-slate-500 text-xs">au</span>
              <Input type="date" value={conductTo} onChange={(e) => setConductTo(e.target.value)} />
            </div>
            <Button onClick={applyConductFilter} disabled={loadingConduct}>{loadingConduct ? "…" : "Valider"}</Button>
          </div>
        </div>

        {/* Inputs visibles aussi en mobile (sous le titre) */}
        <div className="md:hidden mb-3 grid grid-cols-2 gap-2">
          <Input type="date" value={conductFrom} onChange={(e) => setConductFrom(e.target.value)} />
          <Input type="date" value={conductTo} onChange={(e) => setConductTo(e.target.value)} />
        </div>

        {loadingKids ? (
          <div className="text-sm text-slate-500">Chargement…</div>
        ) : kids.length === 0 ? (
          <div className="text-sm text-slate-500">Aucun enfant lié à votre compte pour l’instant.</div>
        ) : (
          <div className="overflow-x-auto">
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
              <tbody>
                {kids.map((k) => {
                  const c = conduct[k.id];
                  return (
                    <tr key={k.id} className="border-t">
                      <td className="px-3 py-2">{k.full_name}</td>
                      <td className="px-3 py-2">{k.class_label || "—"}</td>
                      {c ? (
                        <>
                          <td className="px-3 py-2">{c.breakdown.assiduite.toFixed(2).replace(".", ",")}</td>
                          <td className="px-3 py-2">{c.breakdown.tenue.toFixed(2).replace(".", ",")}</td>
                          <td className="px-3 py-2">{c.breakdown.moralite.toFixed(2).replace(".", ",")}</td>
                          <td className="px-3 py-2">{c.breakdown.discipline.toFixed(2).replace(".", ",")}</td>
                          <td className="px-3 py-2 font-semibold">{c.total.toFixed(2).replace(".", ",")}</td>
                          <td className="px-3 py-2">{c.appreciation}</td>
                        </>
                      ) : (
                        <td className="px-3 py-2 text-slate-500" colSpan={6}>—</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Mes enfants — Absences/retards + Sanctions */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Mes enfants — Absences/retards récents</div>
          <div className="flex items-center gap-2">
            {granted ? (
              <span className="text-xs text-emerald-700">Notifications déjà activées ✅</span>
            ) : (
              <button
                onClick={enablePush}
                className="rounded-full border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                title="Activer les notifications push"
              >
                Activer les push
              </button>
            )}
          </div>
        </div>

        {loadingKids ? (
          <div className="text-sm text-slate-500">Chargement…</div>
        ) : kids.length === 0 ? (
          <div className="text-sm text-slate-500">Aucun enfant lié à votre compte pour l’instant.</div>
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

                  <ul className="mt-2 space-y-2">
                    {visibleGroups.map((g) => {
                      const key = `${k.id}|${g.day}`;
                      const isOpen = !!expanded[key];
                      const hasSingle = g.items.length === 1;

                      const parts: string[] = [];
                      if (g.absentCount) parts.push(`${g.absentCount} absence${g.absentCount > 1 ? "s" : ""}`);
                      if (g.lateCount) parts.push(`${g.lateCount} retard${g.lateCount > 1 ? "s" : ""}`);
                      const summary = parts.length ? parts.join(" • ") : "Aucun évènement";

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
                                    <div className="text-slate-800">{ev.type === "absent" ? "Absence" : "Retard"} — {ev.subject_name || "—"}</div>
                                    <div className="text-xs text-slate-500">
                                      {/* ⬇️ Plage horaire */}
                                      {slotLabel(ev.when, ev.expected_minutes)}{" "}
                                      {ev.type === "late" && ev.minutes_late ? `• ${ev.minutes_late} min` : ""}
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
                    {visibleGroups.length === 0 && <li className="py-2 text-sm text-slate-500">Aucun évènement récent.</li>}
                  </ul>

                  {/* Sanctions */}
                  <div className="mt-3 rounded-lg border p-3 bg-amber-50/30">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-800">Sanctions récentes</div>
                      {(kidPenalties[k.id]?.length || 0) > 5 && (
                        <button
                          onClick={() => setShowAllPenForKid((m) => ({ ...m, [k.id]: !m[k.id] }))}
                          className="text-xs text-slate-700 underline-offset-2 hover:underline"
                        >
                          {showAllPenForKid[k.id] ? "Réduire" : "Voir plus"}
                        </button>
                      )}
                    </div>
                    {(kidPenalties[k.id]?.length || 0) === 0 ? (
                      <div className="mt-2 text-sm text-slate-500">Aucune sanction récente.</div>
                    ) : (
                      <ul className="mt-2 divide-y">
                        {(showAllPenForKid[k.id] ? (kidPenalties[k.id] || []) : (kidPenalties[k.id] || []).slice(0, 5)).map((p) => (
                          <li key={p.id} className="py-2 flex items-center justify-between text-sm">
                            <div className="min-w-0">
                              <div className="text-slate-800">
                                <span className="mr-2">
                                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 bg-amber-50 text-amber-800 ring-amber-200">
                                    {rubricLabel(p.rubric)}
                                  </span>
                                </span>
                                −{Number(p.points || 0).toFixed(2)} pt
                                {(() => {
                                  const subj = p.author_subject_name || p.subject_name; // ✅ fallback correct
                                  if (p.author_role_label === "Enseignant") {
                                    return subj ? ` — par le prof de ${subj}` : " — par un enseignant";
                                  }
                                  if (p.author_role_label === "Administration") {
                                    return " — par l’administration";
                                  }
                                  return p.author_name ? ` — par ${p.author_name}` : "";
                                })()}
                              </div>
                              <div className="text-xs text-slate-500 truncate">
                                {fmt(p.when)} {p.class_label ? `• ${p.class_label}` : ""} {p.reason ? `• Motif: ${p.reason}` : ""}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {msg && <div className="text-sm text-slate-700" aria-live="polite">{msg}</div>}
    </main>
  );
}
