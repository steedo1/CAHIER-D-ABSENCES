// src/components/teacher/TeacherDashboard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Users, Clock, Save, Play, Square, LogOut, WifiOff, RefreshCcw } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  registerServiceWorker,
  offlineGetJson,
  offlineMutateJson,
  outboxCount,
  flushOutbox,
  cacheGet,
  cacheSet,
  clearOfflineAll,
} from "@/lib/offline";

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

  // ✅ Heure effective du clic "Démarrer l’appel" (offline-friendly)
  actual_call_at?: string | null;
};

type InstCfg = {
  tz: string;
  default_session_minutes: number;
  auto_lateness: boolean;
  institution_name?: string | null;
  academic_year_label?: string | null;
};
type Period = { weekday: number; label: string; start_time: string; end_time: string };

type InstBasics = InstCfg & { periods: Period[] };

type ConductMax = {
  discipline: number;
  tenue: number;
  moralite: number;
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
   Utils (périodes)
────────────────────────────────────────── */
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const toMinutes = (hm: string) => {
  const [h, m] = (hm || "00:00").split(":").map((x) => +x);
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
};
const minutesDiff = (a: string, b: string) => Math.max(0, toMinutes(b) - toMinutes(a));

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
  const map: Record<string, number> = {
    sun: 7,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return map[w] ?? 7;
};

/* ─────────────────────────────────────────
   Institution identity (même logique que la page offline qui marche)
────────────────────────────────────────── */
const DEFAULT_INSTITUTION_NAME = "NOM DE L'ETABLISSEMENT";

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
  let root = payload;

  if (isPlainObject(root) && isPlainObject((root as any).item)) root = (root as any).item;
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

  let name = pickFrom(settings, INSTITUTION_NAME_KEYS) || null;
  let year = pickFrom(settings, ACADEMIC_YEAR_KEYS) || null;

  if (!name) name = pickFrom(root, INSTITUTION_NAME_KEYS) || null;
  if (!year) year = pickFrom(root, ACADEMIC_YEAR_KEYS) || null;

  return { name, year };
}

function isClientSessionId(id: string | null | undefined) {
  return !!id && id.startsWith("client:");
}
function clientSessionIdFromOpen(open: OpenSession | null) {
  if (!open?.id) return null;
  if (!isClientSessionId(open.id)) return null;
  return open.id.slice("client:".length);
}

/* ─────────────────────────────────────────
   Component (teacher only)
────────────────────────────────────────── */
export default function TeacherDashboard() {
  // offline / sync
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pending, setPending] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);

  async function refreshPending() {
    try {
      const n = await outboxCount();
      setPending(Number.isFinite(n) ? n : 0);
    } catch {
      setPending(0);
    }
  }

  async function syncNow() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMsg("Hors connexion : synchronisation impossible.");
      return;
    }
    setSyncing(true);
    setMsg(null);
    try {
      await flushOutbox();
      await refreshPending();

      // refresh open session depuis le serveur (si dispo)
      try {
        const os = (await offlineGetJson("/api/teacher/sessions/open", "teacher:open:afterSync")) as any;
        setOpen((os?.item as OpenSession) || null);
        await cacheSet("teacher:local-open", null);
      } catch {
        /* ignore */
      }

      setMsg("Synchronisation terminée ✅");
    } catch (e: any) {
      setMsg(e?.message || "Synchronisation échouée");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    registerServiceWorker();

    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    setIsOnline(online);

    void refreshPending();

    const onOnline = () => {
      setIsOnline(true);
      void refreshPending();
      void syncNow();
    };
    const onOffline = () => {
      setIsOnline(false);
      void refreshPending();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // paramètres établissement / périodes
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

  // horaire UI (verrouillé par l’établissement)
  const now = new Date();
  const defTime = hhmm(
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0)
  );
  const [startTime, setStartTime] = useState<string>(defTime);
  const [duration, setDuration] = useState<number>(60);
  const [locked, setLocked] = useState<boolean>(true); // verrouillage UI heure/durée

  // séance + liste élèves + marques
  const [open, setOpen] = useState<OpenSession | null>(null);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  type Row = { absent?: boolean; late?: boolean; reason?: string };
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const changedCount = useMemo(
    () => Object.values(rows).filter((r) => r.absent || r.late).length,
    [rows]
  );

  /* Chargement initial (classes + open) — OFFLINE OK */
  useEffect(() => {
    (async () => {
      try {
        const [cl, os, localOpen] = await Promise.all([
          offlineGetJson("/api/teacher/classes", "teacher:classes").catch(() => ({ items: [] })),
          offlineGetJson("/api/teacher/sessions/open", "teacher:open").catch(() => ({ item: null })),
          cacheGet("teacher:local-open").catch(() => null),
        ]);

        setTeachClasses(((cl as any)?.items || []) as TeachClass[]);

        const openServer = ((os as any)?.item as OpenSession) || null;
        const openLocal = (localOpen as OpenSession) || null;

        setOpen(openServer || openLocal || null);
      } catch {
        setTeachClasses([]);
        try {
          const localOpen = await cacheGet("teacher:local-open");
          setOpen((localOpen as OpenSession) || null);
        } catch {
          setOpen(null);
        }
      }
    })();
  }, []);

  // Charger paramètres & périodes (lecture côté prof) + config conduite — OFFLINE OK
  async function loadInstitutionBasics() {
    async function getJson(url: string, key: string) {
      try {
        return await offlineGetJson(url, key);
      } catch {
        return null;
      }
    }

    // 1) route unifiée si présente
    let basics: InstBasics | null =
      (await getJson("/api/teacher/institution/basics", "teacher:inst:basics")) as InstBasics | null;

    // 2) sinon, anciennes routes (settings + periods)
    if (!basics) {
      const c =
        (await getJson("/api/teacher/institution/settings", "teacher:inst:settings:teacher")) ||
        (await getJson("/api/institution/settings", "teacher:inst:settings:institution")) ||
        (await getJson("/api/admin/institution/settings", "teacher:inst:settings:admin")) || {
          tz: "Africa/Abidjan",
          default_session_minutes: 60,
          auto_lateness: true,
        };

      const p =
        (await getJson("/api/teacher/institution/periods", "teacher:inst:periods:teacher")) ||
        (await getJson("/api/institution/periods", "teacher:inst:periods:institution")) ||
        (await getJson("/api/admin/institution/periods", "teacher:inst:periods:admin")) || {
          periods: [],
        };

      const { name, year } = extractInstitutionIdentity(c);

      basics = {
        tz: safeStr((c as any)?.tz) || "Africa/Abidjan",
        default_session_minutes: Number((c as any)?.default_session_minutes || 60),
        auto_lateness: !!(c as any)?.auto_lateness,
        institution_name: name,
        academic_year_label: year,
        periods: Array.isArray((p as any)?.periods) ? (p as any).periods : [],
      };
    }

    if (!basics) {
      basics = {
        tz: "Africa/Abidjan",
        default_session_minutes: 60,
        auto_lateness: true,
        institution_name: null,
        academic_year_label: null,
        periods: [],
      };
    }

    // 🔁 Complément : harmoniser le nom & l'année avec /api/admin/institution/settings
    const adminSettings = await getJson("/api/admin/institution/settings", "teacher:inst:adminSettings");
    if (adminSettings) {
      const { name: nameFromAdmin, year: yearFromAdmin } = extractInstitutionIdentity(adminSettings);
      if (nameFromAdmin) basics.institution_name = nameFromAdmin;
      if (yearFromAdmin && !basics.academic_year_label) basics.academic_year_label = yearFromAdmin;
    }

    // Regrouper/trier par jour
    const grouped: Record<number, Period[]> = {};
    (basics.periods || []).forEach((row: any) => {
      const w = Number(row.weekday || 1);
      if (!grouped[w]) grouped[w] = [];
      grouped[w].push({
        weekday: w,
        label: row.label || "Séance",
        start_time: String(row.start_time || "08:00").slice(0, 5),
        end_time: String(row.end_time || "09:00").slice(0, 5),
      });
    });
    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time))
    );

    setInst((prev) => ({
      ...prev,
      tz: safeStr(basics!.tz) || prev.tz || "Africa/Abidjan",
      default_session_minutes: Number(basics!.default_session_minutes || prev.default_session_minutes || 60),
      auto_lateness: typeof basics!.auto_lateness === "boolean" ? !!basics!.auto_lateness : prev.auto_lateness,
      institution_name:
        safeStr(basics!.institution_name) ||
        prev.institution_name ||
        DEFAULT_INSTITUTION_NAME,
      academic_year_label:
        safeStr(basics!.academic_year_label) || prev.academic_year_label || null,
    }));
    setPeriodsByDay(grouped);

    // 3) Config conduite (maxima par rubrique) — loader ultra défensif (OFFLINE OK)
    const defaults: ConductMax = { discipline: 7, tenue: 3, moralite: 4 };

    try {
      const rawConf =
        ((await getJson("/api/teacher/conduct/settings", "teacher:conduct:teacher")) as any) ??
        ((await getJson("/api/institution/conduct/settings", "teacher:conduct:institution")) as any) ??
        ((await getJson("/api/admin/conduct/settings", "teacher:conduct:admin")) as any);

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

      const d = Number(
        src?.discipline_max ??
          src?.discipline ??
          src?.max_discipline ??
          src?.discipline_points_max ??
          defaults.discipline
      );
      const t = Number(
        src?.tenue_max ??
          src?.tenue ??
          src?.max_tenue ??
          src?.tenue_points_max ??
          defaults.tenue
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
      console.warn("[TeacherDashboard] erreur chargement règles de conduite:", e);
      setConductMax(defaults);
    }
  }

  useEffect(() => {
    void loadInstitutionBasics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ✅ Nom établissement + année : dataset/global puis fallback API (OFFLINE OK) */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof window === "undefined") return;

      try {
        const body: any = document.body;

        const fromDataName =
          safeStr(body?.dataset?.institutionName) ||
          safeStr(body?.dataset?.institution);
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

        // si les deux sont trouvés en local, on s'arrête
        if (finalName && finalYear) return;

        // fallback API
        const endpoints = [
          { url: "/api/teacher/institution/settings", key: "teacher:identity:settings:teacher" },
          { url: "/api/institution/settings", key: "teacher:identity:settings:institution" },
          { url: "/api/admin/institution/settings", key: "teacher:identity:settings:admin" },
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
            break;
          }
        }
      } catch {
        /* ne casse rien */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Calcul du créneau « du moment » + verrouillage heure/durée
  function computeDefaultsForNow() {
    const tz = inst?.tz || "Africa/Abidjan";
    const now = new Date();
    const nowHM = hmInTZ(now, tz);
    const wd = weekdayInTZ1to7(now, tz); // 1..6, 7 = dimanche (hors créneau)
    const slots = periodsByDay[wd] || [];

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
    setDuration(
      Math.max(1, minutesDiff(pick.start_time, pick.end_time) || inst.default_session_minutes || 60)
    );
    setSlotLabel(`${pick.label} • ${pick.start_time} → ${pick.end_time}`);
    setLocked(true);
  }

  useEffect(() => {
    computeDefaultsForNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(periodsByDay), inst.default_session_minutes, inst.tz, selKey]);

  /* Charger roster si séance ouverte — OFFLINE OK */
  useEffect(() => {
    if (!open) {
      setRoster([]);
      setRows({});
      return;
    }
    (async () => {
      setLoadingRoster(true);
      const j = await offlineGetJson(
        `/api/teacher/roster?class_id=${open.class_id}`,
        `teacher:roster:${open.class_id}`
      ).catch(() => ({ items: [] }));
      setRoster(((j as any)?.items || []) as RosterItem[]);
      setRows({});
      setLoadingRoster(false);
    })();
  }, [open?.class_id]);

  /* Helpers marquage */
  function toggleAbsent(id: string, v: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, absent: v };
      if (v) next.late = false;
      return { ...prev, [id]: next };
    });
  }
  function toggleLate(id: string, v: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, late: v, absent: v ? false : cur.absent };
      return { ...prev, [id]: next };
    });
  }

  /* Actions (séance) — OFFLINE OK */
  async function startSession() {
    if (!sel) return;
    setBusy(true);
    setMsg(null);
    try {
      const today = new Date();
      const [hhS, mmS] = (startTime || "08:00").split(":").map((x) => +x);
      const started = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        hhS,
        mmS,
        0,
        0
      );

      // ✅ Heure effective du clic (à envoyer au serveur, et à garder en offline)
      const actualCallAt = new Date().toISOString();

      const clientSessionId = `${sel.class_id}_${sel.subject_id || "none"}_${started.toISOString()}`;

      const body = {
        class_id: sel.class_id,
        subject_id: sel.subject_id,
        started_at: started.toISOString(), // créneau (sera canonisé côté API)
        actual_call_at: actualCallAt, // ✅ heure d'appel effectif
        expected_minutes: duration,
        client_session_id: clientSessionId,
      };

      const r: any = await offlineMutateJson(
        "/api/teacher/sessions/start",
        { method: "POST", body },
        { mergeKey: `teacher:start:${clientSessionId}`, meta: { clientSessionId } }
      );

      if (r?.ok) {
        setOpen(r.data.item as OpenSession);
        await cacheSet("teacher:local-open", null);
        setMsg("Séance démarrée ✅");
      } else {
        const localOpen: OpenSession = {
          id: `client:${clientSessionId}`,
          class_id: sel.class_id,
          class_label: sel.class_label,
          subject_id: sel.subject_id,
          subject_name: sel.subject_name,
          started_at: started.toISOString(),
          actual_call_at: actualCallAt, // ✅ affichage correct même offline
          expected_minutes: duration,
        };
        setOpen(localOpen);
        await cacheSet("teacher:local-open", localOpen);
        setMsg("Hors connexion : séance enregistrée (sync dès que le réseau revient).");
        await refreshPending();
      }
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
        if (r.late) return { student_id, status: "late" as const, reason: r.reason ?? null };
        return { student_id, status: "present" as const };
      });

      const clientId = clientSessionIdFromOpen(open);
      const body: any = { session_id: open.id, marks };
      if (clientId) body.client_session_id = clientId;

      const r: any = await offlineMutateJson(
        "/api/teacher/attendance/bulk",
        { method: "POST", body },
        { mergeKey: `teacher:attendance:${open.id}` }
      );

      if (r?.ok) {
        const j = r.data || {};
        setMsg(`Enregistré ✅ : ${j.upserted ?? 0} abs./ret. — ${j.deleted ?? 0} suppressions (présent).`);
      } else {
        setMsg("Hors connexion : enregistrement mis en attente (sync auto).");
        await refreshPending();
      }
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
      const clientId = clientSessionIdFromOpen(open);
      const body = clientId ? { session_id: open.id, client_session_id: clientId } : undefined;

      const r: any = await offlineMutateJson(
        "/api/teacher/sessions/end",
        body ? { method: "PATCH", body } : { method: "PATCH" },
        { mergeKey: `teacher:end:${open.id}` }
      );

      // UI: on termine toujours localement
      setOpen(null);
      setRoster([]);
      setRows({});
      await cacheSet("teacher:local-open", null);
      computeDefaultsForNow();

      if (r?.ok) setMsg("Séance terminée ✅");
      else {
        setMsg("Hors connexion : fin de séance mise en attente (sync auto).");
        await refreshPending();
      }
    } catch (e: any) {
      setMsg(e?.message || "Échec fin de séance");
    } finally {
      setBusy(false);
    }
  }

  /* ─────────────────────────────────────────
     SANCTIONS libres (cohérentes avec la config) — OFFLINE OK
  ────────────────────────────────────────── */
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

  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [penRubric, setPenRubric] = useState<Rubric>("discipline");
  const [penBusy, setPenBusy] = useState(false);
  const [penRows, setPenRows] = useState<Record<string, { points: number; reason?: string }>>({});
  const [penMsg, setPenMsg] = useState<string | null>(null);

  const hasPenChanges = useMemo(
    () => Object.values(penRows).some((v) => (v.points || 0) > 0),
    [penRows]
  );

  // Options de rubriques avec les maxima réels
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
    if (roster.length === 0 && sel?.class_id) {
      try {
        setLoadingRoster(true);
        const j = await offlineGetJson(
          `/api/teacher/roster?class_id=${sel.class_id}`,
          `teacher:roster:${sel.class_id}`
        ).catch(() => ({ items: [] }));
        setRoster(((j as any)?.items || []) as RosterItem[]);
      } finally {
        setLoadingRoster(false);
      }
    }
  }

  function openPenalty() {
    if (!sel) {
      setMsg("Sélectionnez d’abord une classe/discipline.");
      return;
    }
    setPenRows({});
    setPenRubric((prev) => prev);
    setPenaltyOpen(true);
    void ensureRosterForPenalty();
  }

  function setPenPoint(student_id: string, n: number) {
    setPenRows((m) => {
      const cur = m[student_id] || { points: 0, reason: "" };
      return {
        ...m,
        [student_id]: { ...cur, points: Math.max(0, Math.floor(n || 0)) },
      };
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

  async function submitPenalties() {
    if (!sel) return;

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
      const cleanRubric = coerceRubric(penRubric);

      const mergeKey = `teacher:penalties:${sel.class_id}:${sel.subject_id ?? "none"}:${cleanRubric}:${new Date()
        .toISOString()
        .slice(0, 10)}`;

      const r: any = await offlineMutateJson(
        "/api/teacher/penalties/bulk",
        {
          method: "POST",
          body: {
            class_id: sel.class_id,
            subject_id: sel.subject_id,
            rubric: cleanRubric,
            items,
          },
        },
        { mergeKey }
      );

      if (r?.ok) {
        setPenMsg(`Sanctions enregistrées (${items.length}).`);
        setTimeout(() => {
          setPenaltyOpen(false);
          setPenRows({});
        }, 600);
      } else {
        setPenMsg("Hors connexion : sanctions mises en attente (sync auto).");
        await refreshPending();
      }
    } catch (e: any) {
      setPenMsg(e?.message || "Échec d’enregistrement des sanctions");
    } finally {
      setPenBusy(false);
    }
  }

  /* Déconnexion (avec nettoyage offline) */
  async function logout() {
    try {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch (e: any) {
        console.warn("[teacher/logout] supabase signOut:", e?.message || e);
      }

      try {
        await fetch("/api/auth/sync", { method: "DELETE" });
      } catch (e: any) {
        console.warn("[teacher/logout] /api/auth/sync DELETE:", e?.message || e);
      }

      const endpoints = ["/api/auth/signout", "/api/auth/logout", "/auth/signout"];
      for (const url of endpoints) {
        try {
          await fetch(url, { method: "POST", cache: "no-store" });
        } catch {
          /* ignore */
        }
      }
    } finally {
      // important : éviter de garder des queues offline d’un autre utilisateur
      try {
        await clearOfflineAll();
      } catch {
        /* ignore */
      }
      window.location.href = "/login";
    }
  }

  /* Barre d’actions collante (mobile) */
  const showSticky = true;
  const mobileBar = showSticky ? (
    <>
      <div className="h-[70px] md:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur md:hidden px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0)+12px)]">
        {!open ? (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={startSession} disabled={!selKey || busy} aria-label="Démarrer l’appel">
              <Play className="h-4 w-4" />
              {busy ? "Démarrage…" : "Appel"}
            </Button>
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!selKey && !penaltyOpen)}
              aria-label="Sanctions"
            >
              Sanctions
            </GhostButton>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={saveMarks} disabled={busy} aria-label="Enregistrer">
              <Save className="h-4 w-4" />
              {busy ? "…" : `Save${changedCount ? ` (${changedCount})` : ""}`}
            </Button>
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!selKey && !penaltyOpen)}
              aria-label="Sanctions"
            >
              Sanctions
            </GhostButton>
            <GhostButton tone="red" onClick={endSession} disabled={busy} aria-label="Terminer la séance">
              <Square className="h-4 w-4" />
              Stop
            </GhostButton>
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Header premium */}
      <header className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-900 to-slate-950 px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-200/80">
              {inst.institution_name || ""}
            </p>
            {inst.academic_year_label && (
              <p className="text-[11px] font-medium text-indigo-100/80">
                Année scolaire {inst.academic_year_label}
              </p>
            )}
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Espace enseignant — Appel
            </h1>
            <p className="mt-1 max-w-xl text-xs sm:text-sm text-indigo-100/85">
              Sélectionnez une classe avant de faire l’appel. Les minutes de retard sont{" "}
              <b>calculées automatiquement</b>.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip tone={isOnline ? "emerald" : "amber"}>
                {isOnline ? "En ligne" : "Hors ligne"}
              </Chip>
              {pending > 0 && (
                <Chip tone="amber">
                  {pending} en attente
                </Chip>
              )}
              <GhostButton
                tone="emerald"
                onClick={syncNow}
                disabled={!isOnline || syncing || pending === 0}
                className="bg-white/90"
                aria-label="Synchroniser"
                title={!isOnline ? "Revenez en ligne pour synchroniser" : undefined}
              >
                <RefreshCcw className="h-4 w-4" />
                {syncing ? "Sync…" : "Sync"}
              </GhostButton>
              {!isOnline && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-200/90">
                  <WifiOff className="h-3.5 w-3.5" />
                  Mode offline actif
                </span>
              )}
            </div>
          </div>

          {/* Bouton déconnexion */}
          <GhostButton
            tone="slate"
            onClick={logout}
            className="shrink-0 rounded-full border-amber-400 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-md hover:shadow-lg hover:from-amber-500 hover:via-yellow-400 hover:to-amber-500 focus:ring-amber-400/40"
          >
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </GhostButton>
        </div>
      </header>

      {/* Sélection + paramètres horaire */}
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-5 space-y-4 ring-1 ring-emerald-100">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Classe — Discipline */}
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

          {/* Heure de début (verrouillé) */}
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Heure de début
            </div>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={locked} />
            <div className="mt-1 text-[11px] text-slate-500">{slotLabel}</div>
          </div>

          {/* Durée (verrouillée) */}
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Durée (minutes)
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

        {/* Actions desktop */}
        {!open ? (
          <div className="hidden md:flex items-center gap-2">
            <Button onClick={startSession} disabled={!selKey || busy} aria-label="Démarrer l’appel">
              <Play className="h-4 w-4" />
              {busy ? "Démarrage…" : "Démarrer l’appel"}
            </Button>
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!selKey && !penaltyOpen)}
              aria-label="Sanctions"
            >
              Sanctions
            </GhostButton>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-2">
            <Button onClick={saveMarks} disabled={busy} aria-label="Enregistrer">
              <Save className="h-4 w-4" />
              {busy ? "Enregistrement…" : `Enregistrer${changedCount ? ` (${changedCount})` : ""}`}
            </Button>
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!selKey && !penaltyOpen)}
              aria-label="Sanctions"
            >
              Sanctions
            </GhostButton>
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

      {/* Sanctions inline */}
      {penaltyOpen && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          {/* ... inchangé ... */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-lg font-semibold">Autres sanctions</div>
              <div className="text-xs text-slate-500">
                {sel
                  ? `Classe : ${sel.class_label}${sel.subject_name ? ` • ${sel.subject_name}` : ""}`
                  : "—"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GhostButton onClick={() => resetPenRows()} disabled={penBusy}>
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

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip tone={penRubric === "discipline" ? "emerald" : "slate"}>Discipline</Chip>
                <Chip tone={penRubric === "tenue" ? "emerald" : "slate"}>Tenue</Chip>
                <Chip tone={penRubric === "moralite" ? "emerald" : "slate"}>Moralité</Chip>
              </div>

              <div className="mt-2 text-[11px] text-slate-500">
                <b>Note :</b> l’assiduité est <u>calculée automatiquement</u> via les absences injustifiées.
              </div>
            </div>

            <div className="md:col-span-2 flex items-end justify-end">
              <Button onClick={submitPenalties} disabled={penBusy || !hasPenChanges || rubricDisabled} tone="emerald">
                {penBusy ? "Enregistrement…" : "Enregistrer les sanctions"}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            {/* ... inchangé ... */}
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
                ) : !sel ? (
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

      {/* Liste élèves + marquage (Appel) */}
      {open && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {(() => {
              const startIso = open.actual_call_at || open.started_at; // ✅ heure effective
              const startMs = new Date(startIso).getTime();
              const endMs = open.expected_minutes ? startMs + open.expected_minutes * 60000 : null;

              return (
                <div className="text-sm font-semibold text-slate-700">
                  Appel — {open.class_label} {open.subject_name ? `• ${open.subject_name}` : ""} •{" "}
                  {new Date(startIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {endMs
                    ? ` → ${new Date(endMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                </div>
              );
            })()}
            <Chip>
              {changedCount} modif{changedCount > 1 ? "s" : ""} en cours
            </Chip>
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
    </div>
  );
}
