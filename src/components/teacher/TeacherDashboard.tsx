// src/components/teacher/TeacherDashboard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  BookOpen,
  Clock,
  Save,
  Play,
  StepForward,
  Square,
  LogOut,
  Bell,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/* ─────────────────────────────────────────
   Types
────────────────────────────────────────── */
type TeachClass = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};
type RosterItem = { id: string; full_name: string; matricule: string | null };
type OpenSession = {
  id: string;
  class_id: string;
  class_label: string;
  subject_id: string | null;
  subject_name: string | null;
  started_at: string;
  expected_minutes?: number | null;
};

/* ─────────────────────────────────────────
   UI helpers
────────────────────────────────────────── */
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
function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1.5 text-sm transition",
        active
          ? "bg-emerald-600 text-white shadow"
          : "border border-slate-200 text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
function Chip({
  children,
  tone = "emerald",
}: {
  children: React.ReactNode;
  tone?: "emerald" | "slate" | "amber";
}) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    slate: "bg-slate-50 text-slate-800 ring-slate-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
  } as const;
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1",
        map[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────
   Helpers parent (dates + grouping)
────────────────────────────────────────── */
const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

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

/* ─────────────────────────────────────────
   Push helper (VAPID)
────────────────────────────────────────── */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64url);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ─────────────────────────────────────────
   Component
────────────────────────────────────────── */
export default function TeacherDashboard() {
  const [tab, setTab] = useState<"classes" | "parent">("classes");

  // données prof
  const [teachClasses, setTeachClasses] = useState<TeachClass[]>([]);
  const options = useMemo(
    () =>
      teachClasses.map((tc) => ({
        key: `${tc.class_id}|${tc.subject_id ?? ""}`,
        label: `${tc.class_label}${tc.subject_name ? ` — ${tc.subject_name}` : ""}`,
        value: tc,
      })),
    [teachClasses]
  );

  // sélection classe
  const [selKey, setSelKey] = useState<string>("");
  const sel = useMemo(
    () => options.find((o) => o.key === selKey)?.value || null,
    [options, selKey]
  );

  // saisie horaire
  const now = new Date();
  const defTime = new Date(
    now.getTime() - now.getMinutes() * 60000
  )
    .toTimeString()
    .slice(0, 5);
  const [startTime, setStartTime] = useState<string>(defTime);
  const [duration, setDuration] = useState<number>(60);

  // séance + liste élèves + marques
  const [open, setOpen] = useState<OpenSession | null>(null);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  type Row = { absent?: boolean; late?: boolean; lateMin?: number; reason?: string };
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const changedCount = useMemo(
    () =>
      Object.values(rows).filter(
        (r) => r.absent || (r.late && (r.lateMin || 0) > 0)
      ).length,
    [rows]
  );

  // ───────────── Espace parent (aperçu avancé) ─────────────
  type Kid = { id: string; full_name: string; class_label: string | null };
  type KidEvent = {
    id: string;
    when: string;
    type: "absent" | "late";
    minutes_late?: number | null;
    class_label?: string | null;
    subject_name?: string | null;
  };
  const [kids, setKids] = useState<Kid[]>([]);
  const [kidFeed, setKidFeed] = useState<Record<string, KidEvent[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllDaysForKid, setShowAllDaysForKid] = useState<Record<string, boolean>>({});

  type DayGroup = {
    day: string;
    label: string;
    absentCount: number;
    lateCount: number;
    items: KidEvent[];
  };
  function groupByDay(events: KidEvent[]): DayGroup[] {
    const buckets = new Map<string, KidEvent[]>();
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

  /* Chargement initial */
  useEffect(() => {
    (async () => {
      try {
        const [cl, os] = await Promise.all([
          fetch("/api/teacher/classes", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => ({ items: [] })),
          fetch("/api/teacher/sessions/open", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => ({ item: null })),
        ]);
        setTeachClasses((cl.items || []) as TeachClass[]);
        setOpen((os.item as OpenSession) || null);
      } catch {
        setTeachClasses([]);
        setOpen(null);
      }
    })();
  }, []);

  /* Charger roster si séance ouverte */
  useEffect(() => {
    if (!open) {
      setRoster([]);
      setRows({});
      return;
    }
    (async () => {
      setLoadingRoster(true);
      const j = await fetch(`/api/teacher/roster?class_id=${open.class_id}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setRoster((j.items || []) as RosterItem[]);
      setRows({});
      setLoadingRoster(false);
    })();
  }, [open?.class_id]);

  /* Espace parent : enfants + feed */
  useEffect(() => {
    if (tab !== "parent") return;
    (async () => {
      try {
        const j = await fetch("/api/teacher/children", {
          cache: "no-store",
        }).then((r) => r.json());
        const items = (j.items || []) as Kid[];
        setKids(items);

        const feeds: Record<string, KidEvent[]> = {};
        for (const k of items) {
          const f = await fetch(
            `/api/teacher/children/events?student_id=${k.id}`
          ).then((r) => r.json());
          feeds[k.id] = (f.items || []) as KidEvent[];
        }
        setKidFeed(feeds);

        const initialExpanded: Record<string, boolean> = {};
        for (const kid of items) {
          const groups = groupByDay(feeds[kid.id] || []);
          for (const g of groups) if (g.items.length === 1) initialExpanded[`${kid.id}|${g.day}`] = true;
        }
        setExpanded(initialExpanded);
      } catch {
        setKids([]);
        setKidFeed({});
      }
    })();
  }, [tab]);

  /* Helpers marquage */
  function toggleAbsent(id: string, v: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, absent: v };
      if (v) {
        next.late = false;
        next.lateMin = undefined;
      }
      return { ...prev, [id]: next };
    });
  }
  function toggleLate(id: string, v: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = {
        ...cur,
        late: v,
        lateMin: v ? cur.lateMin ?? 5 : undefined,
        absent: v ? false : cur.absent,
      };
      return { ...prev, [id]: next };
    });
  }
  function setLateMin(id: string, m: number) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, late: true, lateMin: Math.max(0, m || 0) };
      return { ...prev, [id]: next };
    });
  }
  function setReason(id: string, s: string) {
    setRows((prev) => {
      const cur = prev[id] || {};
      return { ...prev, [id]: { ...cur, reason: s } };
    });
  }

  /* Actions */
  async function startSession() {
    if (!sel) return;
    setBusy(true);
    setMsg(null);
    try {
      const today = new Date();
      const [hh, mm] = (startTime || "08:00").split(":").map((x) => +x);
      const started = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        hh,
        mm,
        0,
        0
      );
      const payload = {
        class_id: sel.class_id,
        subject_id: sel.subject_id,
        started_at: started.toISOString(),
        expected_minutes: duration,
      };
      const r = await fetch("/api/teacher/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec démarrage séance");
      setOpen(j.item as OpenSession);
      setMsg("Séance démarrée.");
    } catch (e: any) {
      setMsg(e?.message || "Échec démarrage séance");
    } finally {
      setBusy(false);
    }
  }

  async function saveMarks() {
    if (!open) return;
    setBusy(true);
    setMsg(null);
    try {
      const marks = Object.entries(rows).map(([student_id, r]) => {
        if (r.absent) return { student_id, status: "absent" as const, reason: r.reason ?? null };
        if (r.late && (r.lateMin || 0) > 0)
          return {
            student_id,
            status: "late" as const,
            minutes_late: r.lateMin || 0,
            reason: r.reason ?? null,
          };
        return { student_id, status: "present" as const };
      });

      const r = await fetch("/api/teacher/attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: open.id, marks }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec enregistrement");
      setMsg(`Enregistré : ${j.upserted} abs./ret. — ${j.deleted} suppressions (présent).`);
    } catch (e: any) {
      setMsg(e?.message || "Échec enregistrement");
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    if (!open) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/teacher/sessions/end", { method: "PATCH" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec fin de séance");
      setOpen(null);
      setRoster([]);
      setRows({});
      setMsg("Séance terminée.");
    } catch (e: any) {
      setMsg(e?.message || "Échec fin de séance");
    } finally {
      setBusy(false);
    }
  }

  async function nextHour() {
    if (!open) return;
    setBusy(true);
    setMsg(null);
    try {
      const base = open.started_at ? new Date(open.started_at) : new Date();
      const exp = open.expected_minutes ?? duration;
      const nextStart = new Date(base.getTime() + (exp || 60) * 60000);

      await fetch("/api/teacher/sessions/end", { method: "PATCH" });

      const payload = {
        class_id: open.class_id,
        subject_id: open.subject_id,
        started_at: nextStart.toISOString(),
        expected_minutes: exp,
      };
      const r2 = await fetch("/api/teacher/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j2 = await r2.json();
      if (!r2.ok) throw new Error(j2?.error || "Échec prochaine heure");
      setOpen(j2.item as OpenSession);
      setMsg("Nouvelle heure démarrée.");
    } catch (e: any) {
      setMsg(e?.message || "Échec enchaînement");
    } finally {
      setBusy(false);
    }
  }

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
      if (!sub)
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Échec enregistrement push");
      setMsg("Notifications push activées ✅");
    } catch (e: any) {
      setMsg(e?.message || "Échec d’activation des push");
    }
  }

  /* Barre d’actions collante (mobile) */
  const showSticky = tab === "classes";
  const mobileBar = showSticky ? (
    <>
      <div className="h-[70px] md:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur md:hidden px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0)+12px)]">
        {!open ? (
          <div className="grid grid-cols-1 gap-2">
            <Button onClick={startSession} disabled={!selKey || busy} aria-label="Démarrer l’appel">
              <Play className="h-4 w-4" />
              {busy ? "Démarrage…" : "Démarrer l’appel"}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={saveMarks} disabled={busy} aria-label="Enregistrer">
              <Save className="h-4 w-4" />
              {busy ? "…" : `Enregistrer${changedCount ? ` (${changedCount})` : ""}`}
            </Button>
            <Button onClick={nextHour} disabled={busy} aria-label="Prochaine heure">
              <StepForward className="h-4 w-4" />
              Prochaine
            </Button>
            <GhostButton tone="red" onClick={endSession} disabled={busy} aria-label="Terminer la séance">
              <Square className="h-4 w-4" />
              Terminer
            </GhostButton>
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Espace enseignant</h1>
          <p className="text-slate-600 text-sm">
            Sélectionnez une classe, choisissez l’horaire, puis marquez uniquement <b>absents</b> et <b>retards</b>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TabButton active={tab === "classes"} onClick={() => setTab("classes")}>
            <Users className="mr-1 h-4 w-4" /> Mes classes
          </TabButton>
          <TabButton active={tab === "parent"} onClick={() => setTab("parent")}>
            <BookOpen className="mr-1 h-4 w-4" /> Espace parent
          </TabButton>
          <a href="/logout" className="sr-only md:not-sr-only">
            <GhostButton tone="red">
              <LogOut className="h-4 w-4" /> Déconnexion
            </GhostButton>
          </a>
        </div>
      </header>

      {tab === "classes" ? (
        <>
          {/* Sélection + paramètres horaire */}
          <div className="rounded-2xl border border-emerald-200 bg-linear-to-b from-emerald-50/60 to-white p-5 space-y-4 ring-1 ring-emerald-100">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <Users className="h-3.5 w-3.5" />
                  Classe — Discipline
                </div>
                <Select value={selKey} onChange={(e) => setSelKey(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <div className="mt-1 text-[11px] text-slate-500">
                  <Chip tone="amber">Astuce</Chip> Seules les classes où vous êtes affecté(e) apparaissent.
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Heure de début
                </div>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Durée (minutes)
                </div>
                <Select value={String(duration)} onChange={(e) => setDuration(parseInt(e.target.value, 10))}>
                  {[30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Actions desktop */}
            {!open ? (
              <div className="hidden md:block">
                <Button onClick={startSession} disabled={!selKey || busy} aria-label="Démarrer l’appel">
                  <Play className="h-4 w-4" />
                  {busy ? "Démarrage…" : "Démarrer l’appel"}
                </Button>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Button onClick={saveMarks} disabled={busy} aria-label="Enregistrer">
                  <Save className="h-4 w-4" />
                  {busy ? "Enregistrement…" : `Enregistrer${changedCount ? ` (${changedCount})` : ""}`}
                </Button>
                <Button onClick={nextHour} disabled={busy} aria-label="Prochaine heure">
                  <StepForward className="h-4 w-4" />
                  Prochaine heure
                </Button>
                <GhostButton tone="red" onClick={endSession} disabled={busy} aria-label="Terminer la séance">
                  <Square className="h-4 w-4" />
                  Terminer la séance
                </GhostButton>
              </div>
            )}
            {msg && (
              <div className="text-sm text-slate-700" aria-live="polite">
                {msg}
              </div>
            )}
          </div>

          {/* Liste élèves + marquage */}
          {open && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-700">
                  Appel — {open.class_label} {open.subject_name ? `• ${open.subject_name}` : ""} •{" "}
                  {new Date(open.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {open.expected_minutes
                    ? ` → ${new Date(new Date(open.started_at).getTime() + open.expected_minutes * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                </div>
                <Chip>{changedCount} modif{changedCount > 1 ? "s" : ""} en cours</Chip>
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
                      <th className="px-3 py-2 w-24">Minutes</th>
                      <th className="px-3 py-2">Motif (facultatif)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingRoster ? (
                      <tr>
                        <td className="px-3 py-4 text-slate-500" colSpan={7}>
                          Chargement de la liste…
                        </td>
                      </tr>
                    ) : roster.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-slate-500" colSpan={7}>
                          Aucun élève dans cette classe.
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
                                aria-label={`Absent: ${st.full_name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-amber-600"
                                checked={!!r.late}
                                onChange={(e) => toggleLate(st.id, e.target.checked)}
                                disabled={!!r.absent}
                                aria-label={`Retard: ${st.full_name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min={0}
                                value={r.late ? r.lateMin || 0 : 0}
                                onChange={(e) => setLateMin(st.id, parseInt(e.target.value || "0", 10))}
                                disabled={!r.late || !!r.absent}
                                className="w-24"
                                aria-label={`Minutes de retard: ${st.full_name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                placeholder="(optionnel)"
                                value={r.reason || ""}
                                onChange={(e) => setReason(st.id, e.target.value)}
                                aria-label={`Motif: ${st.full_name}`}
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

          {/* Barre mobile sticky */}
          {mobileBar}
        </>
      ) : (
        // ───────────── Espace parent (aperçu résumé + accordéon) ─────────────
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Mes enfants — Absences/retards récents
            </div>
            <div className="flex items-center gap-2">
              <GhostButton onClick={enablePush} title="Activer les notifications push">
                <Bell className="h-4 w-4" />
                Activer les push
              </GhostButton>
            </div>
          </div>

          {kids.length === 0 ? (
            <div className="text-sm text-slate-500">Aucun enfant lié à votre compte pour l’instant.</div>
          ) : (
            <div className="space-y-4">
              {kids.map((k) => {
                const groups = groupByDay(kidFeed[k.id] || []);
                const showAll = !!showAllDaysForKid[k.id];
                const visibleGroups = showAll ? groups : groups.slice(0, 3);

                return (
                  <div key={k.id} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {k.full_name}{" "}
                        <span className="text-xs text-slate-500">({k.class_label || "—"})</span>
                      </div>
                      {groups.length > 3 && (
                        <button
                          onClick={() =>
                            setShowAllDaysForKid((m) => ({ ...m, [k.id]: !m[k.id] }))
                          }
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
                                  onClick={() =>
                                    setExpanded((m) => ({ ...m, [key]: !m[key] }))
                                  }
                                  className="inline-flex items-center gap-1 text-xs text-emerald-700 underline-offset-2 hover:underline"
                                >
                                  {isOpen || hasSingle ? (
                                    <>
                                      <ChevronUp className="h-3.5 w-3.5" />
                                      Masquer
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="h-3.5 w-3.5" />
                                      Voir détails
                                    </>
                                  )}
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
                                        {fmt(ev.when)}{" "}
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
                      {visibleGroups.length === 0 && (
                        <li className="py-2 text-sm text-slate-500">Aucun évènement récent.</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {msg && (
            <div className="mt-3 text-sm text-slate-700" aria-live="polite">
              {msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
