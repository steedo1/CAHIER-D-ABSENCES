"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Users, BookOpen, Clock, Play, Save, Square, LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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
type MyClass = { id: string; label: string; level: string | null; institution_id: string };
type Subject = { id: string; label: string };
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

type InstCfg = {
  tz: string;
  default_session_minutes: number;
  auto_lateness: boolean;
  institution_name?: string | null;
  academic_year_label?: string | null;
};
type Period = { weekday: number; label: string; start_time: string; end_time: string };

type ConductMax = {
  discipline: number;
  tenue: number;
  moralite: number;
};

/* ───────── Utils (périodes) ───────── */
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
function toMinutes(hm: string) {
  const [h, m] = (hm || "00:00").split(":").map((x) => +x);
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
}
function minutesDiff(a: string, b: string) {
  return Math.max(0, toMinutes(b) - toMinutes(a));
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

export default function ClassDevicePage() {
  /* état de base */
  const [classes, setClasses] = useState<MyClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");

  // paramètres établissement & périodes
  const [inst, setInst] = useState<InstCfg>({
    tz: "Africa/Abidjan",
    default_session_minutes: 60,
    auto_lateness: true,
    institution_name: "COURS SECONDAIRE CATHOLIQUE ABOISSO",
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
  const [roster, setRoster] = useState<RosterItem[]>([]);
  type Row = { absent?: boolean; late?: boolean; reason?: string };
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);

  const changedCount = useMemo(
    () => Object.values(rows).filter((r) => r.absent || r.late).length,
    [rows]
  );

  /* ───────── Sanctions (inline) ───────── */
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [penRubric, setPenRubric] = useState<Rubric>("discipline");
  const [penBusy, setPenBusy] = useState(false);
  const [penRows, setPenRows] = useState<Record<string, { points: number; reason?: string }>>({});
  const [penMsg, setPenMsg] = useState<string | null>(null);
  const hasPenChanges = useMemo(
    () => Object.values(penRows).some((v) => (v.points || 0) > 0),
    [penRows]
  );

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
      const labelBase =
        r === "discipline" ? "Discipline" : r === "tenue" ? "Tenue" : "Moralité";
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
      const j = await fetch(`/api/class/roster?class_id=${cid}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setRoster((j.items || []) as RosterItem[]);
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
      const res = await fetch("/api/class/penalties/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: cid,
          subject_id: open?.subject_id ?? (subjectId || null),
          rubric: coerceRubric(penRubric),
          items,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Échec enregistrement sanctions");
      setPenMsg(`Sanctions enregistrées (${items.length}).`);
      setPenRows({});
      setTimeout(() => setPenaltyOpen(false), 600);
    } catch (e: any) {
      setPenMsg(e?.message || "Échec enregistrement sanctions");
    } finally {
      setPenBusy(false);
    }
  }

  /* 1) charger mes classes (liées au téléphone) + éventuelle séance ouverte */
  useEffect(() => {
    (async () => {
      try {
        const [cls, os] = await Promise.all([
          fetch("/api/class/my-classes", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/teacher/sessions/open", { cache: "no-store" }).then((r) => r.json()),
        ]);
        const items = (cls.items || []) as Array<any>;
        const mapped: MyClass[] = items.map((c: any) => ({
          id: c.id,
          label: c.label,
          level: c.level ?? null,
          institution_id: c.institution_id,
        }));
        setClasses(mapped);
        if (!classId && mapped.length) setClassId(mapped[0].id);
        setOpen((os.item as OpenSession) || null);
      } catch {
        setClasses([]);
        setOpen(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 1bis) charger paramètres + périodes + réglages de conduite */
  async function loadInstitutionBasics() {
    async function getJson(url: string) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("not ok");
        return await r.json();
      } catch {
        return null;
      }
    }

    // 1) paramètres & périodes
    let instConfig: InstCfg = {
      tz: "Africa/Abidjan",
      default_session_minutes: 60,
      auto_lateness: true,
      institution_name: inst.institution_name || "COURS SECONDAIRE CATHOLIQUE ABOISSO",
      academic_year_label: inst.academic_year_label || null,
    };
    let grouped: Record<number, Period[]> = {};

    const all =
      (await getJson("/api/teacher/institution/basics")) ||
      (await getJson("/api/institution/basics"));

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
          weekday: w,
          label: row.label || "Séance",
          start_time: String(row.start_time || "08:00").slice(0, 5),
          end_time: String(row.end_time || "09:00").slice(0, 5),
        });
      });
    } else {
      const settings =
        (await getJson("/api/teacher/institution/settings")) ||
        (await getJson("/api/institution/settings")) || {
          tz: "Africa/Abidjan",
          default_session_minutes: 60,
          auto_lateness: true,
        };

      const per =
        (await getJson("/api/teacher/institution/periods")) ||
        (await getJson("/api/institution/periods")) || { periods: [] };

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
          weekday: w,
          label: row.label || "Séance",
          start_time: String(row.start_time || "08:00").slice(0, 5),
          end_time: String(row.end_time || "09:00").slice(0, 5),
        });
      });
    }

    // 🔁 Complément : harmoniser le nom avec /api/admin/institution/settings (comme le dashboard)
    const adminSettings = await getJson("/api/admin/institution/settings");
    if (adminSettings) {
      const nameFromAdmin = String(
        adminSettings?.institution_name ||
          adminSettings?.name ||
          adminSettings?.institution_label ||
          ""
      ).trim();

      const yearFromAdmin =
        adminSettings?.academic_year_label ||
        adminSettings?.current_academic_year_label ||
        adminSettings?.active_academic_year ||
        null;

      if (nameFromAdmin) {
        instConfig.institution_name = nameFromAdmin;
      }
      if (yearFromAdmin && !instConfig.academic_year_label) {
        instConfig.academic_year_label = yearFromAdmin;
      }
    }

    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time))
    );

    setInst(instConfig);
    setPeriodsByDay(grouped);

    // 2) config de conduite (maxima) — loader ultra défensif
    const defaults: ConductMax = { discipline: 7, tenue: 3, moralite: 4 };

    try {
      const rawConf =
        ((await getJson("/api/teacher/conduct/settings")) as any) ??
        ((await getJson("/api/institution/conduct/settings")) as any) ??
        ((await getJson("/api/admin/conduct/settings")) as any);

      console.log("[ClassDevice] conduct settings rawConf =", rawConf);

      if (!rawConf) {
        setConductMax(defaults);
        return;
      }

      // On essaie de retrouver l’objet "vraiment utile"
      let src: any = rawConf;

      // cas { item: {...} }
      if (src && typeof src === "object" && src.item) {
        const it = src.item;
        src = it.settings_json || it.settings || it;
      }
      // cas { items: [...] }
      else if (src && typeof src === "object" && Array.isArray(src.items) && src.items.length) {
        const it = src.items[0];
        src = it.settings_json || it.settings || it;
      }
      // cas { data: [...] } (retour supabase brut)
      else if (src && typeof src === "object" && Array.isArray(src.data) && src.data.length) {
        const it = src.data[0];
        src = it.settings_json || it.settings || it;
      }
      // cas direct settings_json / settings
      else if (src && typeof src === "object" && (src.settings_json || src.settings)) {
        src = src.settings_json || src.settings;
      }
      // cas array direct [ {...} ]
      else if (Array.isArray(src) && src.length) {
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
    loadInstitutionBasics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ✅ Fallback doux : récupérer nom établissement + année via dataset / globals */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const body: any = document.body;

      const fromDataName =
        body?.dataset?.institutionName || body?.dataset?.institution || null;
      const fromGlobalName = (window as any).__MC_INSTITUTION_NAME__
        ? String((window as any).__MC_INSTITUTION_NAME__)
        : null;
      const finalName = fromDataName || fromGlobalName;

      const fromDataYear =
        body?.dataset?.academicYear ||
        body?.dataset?.schoolYear ||
        body?.dataset?.anneeScolaire ||
        null;
      const fromGlobalYear = (window as any).__MC_ACADEMIC_YEAR__
        ? String((window as any).__MC_ACADEMIC_YEAR__)
        : null;
      const finalYear = fromDataYear || fromGlobalYear;

      if (!finalName && !finalYear) return;

      setInst((prev) => ({
        ...prev,
        institution_name: finalName || prev.institution_name,
        academic_year_label: finalYear || prev.academic_year_label || null,
      }));
    } catch {
      // on ne casse rien si ça échoue
    }
  }, []);

  // Calcul du créneau par défaut « du moment » (timezone-aware)
  function computeDefaultsForNow() {
    const tz = inst?.tz || "Africa/Abidjan";
    const now = new Date();
    const nowHM = hmInTZ(now, tz);
    const wd = weekdayInTZ1to7(now, tz); // 1..6 (lun..sam), 7 = dimanche (hors créneau)
    const slots = periodsByDay[wd] || [];

    // Pas de créneau ce jour / dimanche → fallback heure actuelle
    if (wd === 7 || slots.length === 0) {
      setStartTime(nowHM);
      setDuration(inst.default_session_minutes || 60);
      setSlotLabel("Hors créneau — utilisation de l’heure actuelle");
      setLocked(true);
      return;
    }

    const nowMin = toMinutes(nowHM);
    // 1) créneau en cours
    let pick = slots.find(
      (s) => nowMin >= toMinutes(s.start_time) && nowMin < toMinutes(s.end_time)
    );
    // 2) sinon, prochain à venir
    if (!pick) pick = slots.find((s) => nowMin <= toMinutes(s.start_time));
    // 3) si après le dernier créneau → fallback heure actuelle
    if (!pick) {
      setStartTime(nowHM);
      setDuration(inst.default_session_minutes || 60);
      setSlotLabel("Hors créneau — utilisation de l’heure actuelle");
      setLocked(true);
      return;
    }

    setStartTime(pick.start_time);
    setDuration(
      Math.max(
        1,
        minutesDiff(pick.start_time, pick.end_time) ||
          inst.default_session_minutes ||
          60
      )
    );
    setSlotLabel(`${pick.label} • ${pick.start_time} → ${pick.end_time}`);
    setLocked(true);
  }

  useEffect(() => {
    computeDefaultsForNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(periodsByDay), inst.default_session_minutes, inst.tz, classId]);

  /* 2) charger les matières quand la classe change */
  useEffect(() => {
    if (!classId) {
      setSubjects([]);
      setSubjectId("");
      return;
    }
    (async () => {
      const j = await fetch(`/api/class/subjects?class_id=${classId}`, {
        cache: "no-store",
      }).then((r) => r.json());
      const list = (j.items || []) as Subject[];
      setSubjects(list);
      setSubjectId(list[0]?.id || "");
    })();
  }, [classId]);

  /* 3) charger roster si séance ouverte */
  useEffect(() => {
    if (!open) {
      setRoster([]);
      setRows({});
      return;
    }
    (async () => {
      setLoadingRoster(true);
      const j = await fetch(`/api/class/roster?class_id=${open.class_id}`, {
        cache: "no-store",
      }).then((r) => r.json());
      setRoster((j.items || []) as RosterItem[]);
      setRows({});
      setLoadingRoster(false);
    })();
  }, [open?.class_id]);

  /* helpers saisie */
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

  /* actions */
  async function startSession() {
    if (!classId) return;
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

      const r = await fetch("/api/class/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: classId,
          subject_id: subjectId || null,
          started_at: started.toISOString(),
          expected_minutes: duration, // verrouillé par l’établissement
        }),
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
        if (r.late) return { student_id, status: "late" as const, reason: r.reason ?? null }; // minutes auto
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
      const r = await fetch("/api/class/sessions/end", { method: "PATCH" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec fin de séance");
      setOpen(null);
      setRoster([]);
      setRows({});
      setMsg("Séance terminée.");
      computeDefaultsForNow();
    } catch (e: any) {
      setMsg(e?.message || "Échec fin de séance");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
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
      // 4) Retour écran de connexion global
      window.location.href = "/login";
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Header compact avec établissement + année scolaire */}
      <header className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-900 to-slate-950 px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-200/80">
              {inst.institution_name || "COURS SECONDAIRE CATHOLIQUE ABOISSO"}
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
          {/* Bouton déconnexion or, très visible */}
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
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <BookOpen className="h-3.5 w-3.5" />
              Discipline
            </div>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.length === 0 ? <option value="">— (facultatif) —</option> : null}
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
              <div className="mt-1 text-[11px] text-slate-500">
                Verrouillée par l’établissement.
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!open ? (
          <div className="flex items-center gap-2">
            <Button onClick={startSession} disabled={!classId || busy}>
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
            <Button onClick={saveMarks} disabled={busy}>
              <Save className="h-4 w-4" />
              {busy ? "Enregistrement…" : `Enregistrer${changedCount ? ` (${changedCount})` : ""}`}
            </Button>
            <GhostButton
              tone="red"
              onClick={() => (penaltyOpen ? setPenaltyOpen(false) : openPenalty())}
              disabled={busy || (!classId && !penaltyOpen)}
            >
              Sanctions
            </GhostButton>
            <GhostButton tone="red" onClick={endSession} disabled={busy}>
              <Square className="h-4 w-4" />
              Terminer
            </GhostButton>
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
                <b>règles de conduite de l’établissement</b>. L’assiduité est calculée via les
                absences.
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
              <Button
                onClick={submitClassPenalties}
                disabled={penBusy || !hasPenChanges || rubricDisabled}
              >
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
                            max={
                              currentRubricMax && currentRubricMax > 0
                                ? currentRubricMax
                                : undefined
                            }
                            value={pr.points || 0}
                            onChange={(e) =>
                              setPenPoint(st.id, parseInt(e.target.value || "0", 10))
                            }
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
          <div className="mb-3 text-sm font-semibold text-slate-700">
            Appel — {open.class_label}{" "}
            {open.subject_name ? `• ${open.subject_name}` : ""} •{" "}
            {new Date(open.started_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
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
                      Chargement…
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={5}>
                      Aucun élève.
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
