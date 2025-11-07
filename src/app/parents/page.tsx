// src/app/parents/page.tsx
"use client";

import React, { useEffect, useState } from "react";

/* ───────── routes dédiées parents + fallbacks ───────── */
const LOGOUT_PARENTS = "/parents/logout";
const LOGIN_PARENTS  = "/parents/login";
const LOGOUT_GENERIC = "/logout";
const LOGIN_GENERIC  = "/login";

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

/** Ex: "10h-11h" si minutes = 00; sinon "10h15-11h" / "10h-11h30" */
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

/* ───────── UI ───────── */
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "red" | "white" | "outline";
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
  const { tone: _t, className, ...rest } = p;
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
    />
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
  const [loadingKids, setLoadingKids] = useState(true);
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

  // 📱 iOS + mode standalone (PWA installée)
  const [isiOS, setIsiOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  // ⛔ État de déconnexion
  const [loggingOut, setLoggingOut] = useState(false);

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
        const f = await fetch(
          `/api/parent/children/events?student_id=${encodeURIComponent(k.id)}`,
          { cache: "no-store" }
        ).then((r) => r.json());
        feedEntries.push([k.id, (f.items || []) as Ev[]]);

        const p = await fetch(
          `/api/parent/children/penalties?student_id=${encodeURIComponent(k.id)}&limit=20`,
          { cache: "no-store" }
        )
          .then((r) => r.json())
          .catch(() => ({ items: [] }));
        penEntries.push([k.id, (p.items || []) as KidPenalty[]]);
      }

      setFeed(Object.fromEntries(feedEntries));
      setKidPenalties(Object.fromEntries(penEntries));

      const initialExpanded: Record<string, boolean> = {};
      for (const [kidId, list] of feedEntries) {
        const groups = groupByDay(list);
        for (const g of groups) if (g.items.length === 1) initialExpanded[`${kidId}|${g.day}`] = true;
      }
      setExpanded(initialExpanded);

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
        const c = await fetch(`/api/parent/children/conduct?${qs.toString()}`, {
          cache: "no-store",
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

  useEffect(() => {
    loadKids();
    ensurePushSubscription().then((r) => {
      if (r.ok) setGranted(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // 1) Désinscription push côté serveur (si endpoint dispo) + côté client
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        const device_id = sub?.endpoint || "";

        // Tentatives API (options, ignorer si non présentes)
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

        try { await sub?.unsubscribe(); } catch {}
      }
    } catch {}

    // 2) Sync auth côté API si utilisé
    try { await fetch("/api/auth/sync", { method: "DELETE", credentials: "include" }); } catch {}

    // 3) Redirection : priorité au logout Parents
    try {
      const target = `${LOGOUT_PARENTS}?from=parents`;
      window.location.assign(target);

      // Si la nav n'a pas démarré, fallback login parents puis générique
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.location.replace(LOGIN_PARENTS);
          setTimeout(() => {
            if (document.visibilityState === "visible") {
              window.location.replace(LOGOUT_GENERIC);
              setTimeout(() => {
                if (document.visibilityState === "visible") {
                  window.location.replace(LOGIN_GENERIC);
                }
              }, 800);
            }
          }, 800);
        }
      }, 1200);
    } catch {
      // Dernier recours
      window.location.href = LOGOUT_GENERIC;
    }
  }

  /* Render */
  return (
    <main
      className={[
        "mx-auto max-w-6xl p-4 md:p-6 space-y-6 scroll-smooth",
        "relative",
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
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Espace parent</h1>
            <p className="mt-1 text-white/80 text-sm">
              Suivez en temps réel les <b>absences</b>, <b>retards</b> et <b>sanctions</b> de vos
              enfants.
            </p>
          </div>

          {/* Actions entête */}
          <div className="flex items-center gap-2 shrink-0">
            {!granted ? (
              <Button tone="white" onClick={enablePush} title="Activer les notifications push">
                Activer les push
              </Button>
            ) : (
              <span className="hidden sm:inline rounded-full bg-white px-3 py-1.5 text-sm text-slate-900 ring-1 ring-white/40">
                Push activés ✅
              </span>
            )}
            <Button tone="white" onClick={safeLogout} disabled={loggingOut} title="Se déconnecter">
              {loggingOut ? "Déconnexion…" : "Déconnexion"}
            </Button>
          </div>
        </div>
      </header>

      {/* iOS hint */}
      {isiOS && !isStandalone && !granted && (
        <div className="rounded-2xl border p-3 bg-amber-50 text-amber-900">
          <div className="text-sm">
            <b>iPhone/iPad :</b> pour recevoir les notifications, ajoutez d’abord l’app à l’écran
            d’accueil : ouvrez cette page dans <b>Safari</b> → <b>Partager</b> →{" "}
            <b>Ajouter à l’écran d’accueil</b>. Puis rouvrez l’app et appuyez sur{" "}
            <i>Activer les notifications</i>.
          </div>
        </div>
      )}

      {/* Conduite — moyenne par enfant */}
      <section className="rounded-2xl border bg-white/90 backdrop-blur p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Conduite — Moyenne par enfant
          </div>
        <div className="hidden md:flex items-center gap-2">
            <Input type="date" value={conductFrom} onChange={(e) => setConductFrom(e.target.value)} />
            <span className="text-slate-600 text-xs">au</span>
            <Input type="date" value={conductTo} onChange={(e) => setConductTo(e.target.value)} />
            <Button onClick={applyConductFilter} disabled={loadingConduct}>
              {loadingConduct ? "…" : "Valider"}
            </Button>
          </div>
        </div>

        {/* Filtres (mobile) */}
        <div className="md:hidden mb-4 grid grid-cols-2 gap-2">
          <Input type="date" value={conductFrom} onChange={(e) => setConductFrom(e.target.value)} />
          <Input type="date" value={conductTo} onChange={(e) => setConductTo(e.target.value)} />
          <div className="col-span-2">
            <Button className="w-full" onClick={applyConductFilter} disabled={loadingConduct}>
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
              <Button tone="outline" onClick={enablePush}>
                Activer les push
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile: cartes */}
            <div className="md:hidden space-y-3">
              {kids.map((k) => {
                const c = conduct[k.id];
                return (
                  <div key={k.id} className="rounded-xl border border-slate-200 p-4 hover:shadow-sm transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{k.full_name}</div>
                        <div className="text-xs text-slate-600">{k.class_label || "—"}</div>
                      </div>
                      {c ? <Badge tone="emerald">{c.total.toFixed(2).replace(".", ",")} / 20</Badge> : <Badge>—</Badge>}
                    </div>
                    {c ? (
                      <div className="mt-3 space-y-2">
                        <Meter value={c.breakdown.assiduite} max={6} label="Assiduité (/6)" />
                        <Meter value={c.breakdown.tenue} max={3} label="Tenue (/3)" />
                        <Meter value={c.breakdown.moralite} max={4} label="Moralité (/4)" />
                        <Meter value={c.breakdown.discipline} max={7} label="Discipline (/7)" />
                        <div className="pt-1 text-xs text-slate-600">
                          <span className="font-medium">Appréciation : </span>{c.appreciation}
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
                          <td className="px-3 py-2 text-slate-600" colSpan={6}>—</td>
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

      {/* Mes enfants — Absences/retards + Sanctions */}
      <section className="rounded-2xl border bg-white/90 backdrop-blur p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Mes enfants — Absences/retards récents
          </div>
          <div className="flex items-center gap-2">
            {granted ? (
              <span className="text-xs text-emerald-700">Notifications déjà activées ✅</span>
            ) : (
              <Button tone="outline" onClick={enablePush} title="Activer les notifications push">
                Activer les push
              </Button>
            )}
          </div>
        </div>

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
          <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
            {kids.map((k) => {
              const groups = groupByDay(feed[k.id] || []);
              const showAll = !!showAllDaysForKid[k.id];
              const visibleGroups = showAll ? groups : groups.slice(0, 3);

              return (
                <div key={k.id} className="rounded-xl border border-slate-200 p-4 hover:shadow-sm transition">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-900">
                      {k.full_name} <span className="text-xs text-slate-600">({k.class_label || "—"})</span>
                    </div>
                    {groups.length > 3 && (
                      <button
                        onClick={() => setShowAllDaysForKid((m) => ({ ...m, [k.id]: !m[k.id] }))}
                        className="text-xs text-emerald-700 underline-offset-2 hover:underline"
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
                        <li key={g.day} className="rounded-lg border p-3 hover:bg-slate-50/60 transition">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-800">
                              {g.label} : <span className="font-normal text-slate-700">{summary}</span>
                            </div>
                            {g.items.length > 0 && (
                              <button
                                onClick={() => setExpanded((m) => ({ ...m, [key]: !m[key] }))}
                                className="text-xs text-emerald-700 underline-offset-2 hover:underline shrink-0"
                              >
                                {isOpen || hasSingle ? "Masquer" : "Voir détails"}
                              </button>
                            )}
                          </div>
                          {(isOpen || hasSingle) && g.items.length > 0 && (
                            <ul className="mt-2 divide-y">
                              {g.items.map((ev) => (
                                <li key={ev.id} className="py-2 flex items-center justify-between text-sm">
                                  <div className="min-w-0">
                                    <div className="text-slate-800 truncate">
                                      {ev.type === "absent" ? <Badge tone="rose">Absence</Badge> : <Badge tone="amber">Retard</Badge>}
                                      <span className="ml-2">{ev.subject_name || "—"}</span>
                                    </div>
                                    <div className="mt-0.5 text-xs text-slate-600">
                                      {slotLabel(ev.when, ev.expected_minutes)}{" "}
                                      {ev.type === "late" && ev.minutes_late ? `• ${ev.minutes_late} min` : ""}
                                    </div>
                                  </div>
                                  <div className="text-xs text-slate-500 shrink-0 pl-2">{ev.class_label || ""}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                    {visibleGroups.length === 0 && <li className="py-2 text-sm text-slate-600">Aucun évènement récent.</li>}
                  </ul>

                  {/* Sanctions */}
                  <div className="mt-3 rounded-lg border p-3 bg-amber-50/40">
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
                      <div className="mt-2 text-sm text-slate-600">Aucune sanction récente.</div>
                    ) : (
                      <ul className="mt-2 divide-y">
                        {(showAllPenForKid[k.id] ? (kidPenalties[k.id] || []) : (kidPenalties[k.id] || []).slice(0, 5)).map((p) => (
                          <li key={p.id} className="py-2 flex items-center justify-between text-sm">
                            <div className="min-w-0">
                              <div className="text-slate-800">
                                <span className="mr-2"><Badge tone="amber">{rubricLabel(p.rubric)}</Badge></span>
                                −{Number(p.points || 0).toFixed(2)} pt
                                {(() => {
                                  const subj = p.author_subject_name || p.subject_name;
                                  if (p.author_role_label === "Enseignant") return subj ? ` — par le prof de ${subj}` : " — par un enseignant";
                                  if (p.author_role_label === "Administration") return " — par l’administration";
                                  return p.author_name ? ` — par ${p.author_name}` : "";
                                })()}
                              </div>
                              <div className="text-xs text-slate-600 truncate">
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
