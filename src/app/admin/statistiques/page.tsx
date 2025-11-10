//src/app/admin/statistiques/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/* ─────────────────────────────────────────
   Types
────────────────────────────────────────── */
type Subject = { id: string; name: string };
type Teacher = {
  id: string;
  display_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

type DetailRow = {
  id: string;
  dateISO: string;
  subject_name: string | null;
  expected_minutes: number;
  class_id?: string | null;     // ✅ récupéré par l’API
  class_label?: string | null;  // ✅ récupéré par l’API
};

type SummaryRow = {
  teacher_id: string;
  teacher_name: string;
  total_minutes: number;
  subject_names?: string[];
};

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

/* Timesheet */
type TimesheetClass = { id: string; label: string };
type TimesheetSlot = { start: string; end: string };
type CellsMetaItem = { hhmm: string; origin?: "class_device" | "teacher" | string };

type TimesheetPayload = {
  teacher: { id: string; name: string; subjects: string[]; total_minutes: number };
  dates: string[];               // "YYYY-MM-DD"
  classes: TimesheetClass[];     // classes du prof
  slots: TimesheetSlot[];        // créneaux (lignes)
  // key = `${date}|${slotStart}|${classId}` → ["08:13","08:55", ...] (heures du clic)
  cells: Record<string, string[]>;
  // (optionnel) même clé → [{ hhmm:"08:13", origin:"class_device" }, ...]
  cellsMeta?: Record<string, CellsMetaItem[]>;
};

/* ─────────────────────────────────────────
   Utils
────────────────────────────────────────── */
function toLocalDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addMinutesISO(iso: string, minutes: number) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + (minutes || 0));
  return d.toISOString();
}
function formatHHmm(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function formatDateFR(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
/** UNIQUE format de durée : 2H50 (minutes toujours 2 chiffres) */
function minutesToHourLabel(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}H${String(r).padStart(2, "0")}`;
}
/* (gardé si besoin plus tard, mais non utilisé pour l’affichage)
function minutesToDecimalHours(min: number) {
  return Math.round(((min || 0) / 60) * 100) / 100;
}
*/
function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
const teacherLabel = (t: Teacher) =>
  (t.display_name?.trim() ||
    t.full_name?.trim() ||
    t.email?.trim() ||
    t.phone?.trim() ||
    "(enseignant)");

function dateHumanFR(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "2-digit" });
}
function isWeekday(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0=dim … 6=sam
  return day >= 1 && day <= 5;
}
// diff (minutes) entre une heure "HH:MM" et le début de créneau "HH:MM"
function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
}
function diffToSlotStart(hhmm: string, slotStart: string) {
  return hhmmToMinutes(hhmm) - hhmmToMinutes(slotStart);
}
// classe CSS pour la pastille selon l’écart (-5 … +10 = vert)
function clickBadgeClass(deltaMin: number) {
  if (deltaMin >= -5 && deltaMin <= 10) {
    return "bg-emerald-50 border-emerald-200 text-emerald-800";
  }
  return "bg-amber-50 border-amber-200 text-amber-800";
}
function originEmoji(o?: string) {
  if (o === "class_device") return "🖥️";
  if (o === "teacher") return "📱";
  return "";
}

/** Durée effective d’un créneau en minutes = longueur_slot − max(0, clic − début) */
function effectiveSlotMinutes(times: string[], slot: TimesheetSlot) {
  const slotLen = Math.max(0, hhmmToMinutes(slot.end) - hhmmToMinutes(slot.start));
  if (!times || times.length === 0) return 0;
  const earliest = [...times].sort()[0];
  const lateness = Math.max(0, hhmmToMinutes(earliest) - hhmmToMinutes(slot.start));
  return Math.max(0, slotLen - lateness);
}

/* ─────────────────────────────────────────
   UI atoms
────────────────────────────────────────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
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
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
        "bg-emerald-600 text-white shadow hover:bg-emerald-700",
        "focus:outline-none focus:ring-4 focus:ring-emerald-500/30",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

/* ─────────────────────────────────────────
   Page
────────────────────────────────────────── */
type ViewMode = "tableau" | "timesheet";

export default function AdminStatistiquesPage() {
  /* Onglets */
  const [view, setView] = useState<ViewMode>("tableau");

  /* Filtres communs */
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toLocalDateInputValue(d);
  });
  const [to, setTo] = useState<string>(() => toLocalDateInputValue(new Date()));

  /* ====== Tableau (synthèse/détail) ====== */
  const [subjectId, setSubjectId] = useState<string>("ALL");
  const [teacherId, setTeacherId] = useState<string>("ALL");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);

  const [summary, setSummary] = useState<FetchState<SummaryRow[]>>({
    loading: false, error: null, data: null,
  });
  const [detail, setDetail] = useState<FetchState<{ rows: DetailRow[]; total_minutes: number; count: number }>>({
    loading: false, error: null, data: null,
  });

  const showDetail = teacherId !== "ALL";
  const totalMinutesSummary = useMemo(() => {
    if (!summary.data) return 0;
    return summary.data.reduce((acc, it) => acc + (it.total_minutes || 0), 0);
  }, [summary.data]);
  const disciplineHeader = subjectId === "ALL" ? "Discipline(s)" : "Discipline (filtrée)";

  /* Charger disciplines (globale, réutilisée aussi par le timesheet) */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/subjects`, { cache: "no-store" });
        const json = (await res.json()) as { items: Subject[] };
        setSubjects([{ id: "ALL", name: "Toutes les disciplines" }, ...(json.items || [])]);
      } catch {
        setSubjects([{ id: "ALL", name: "Toutes les disciplines" }]);
      }
    })();
  }, []);

  /* Charger enseignants (selon filtre discipline) — vue Tableau */
  useEffect(() => {
    (async () => {
      setLoadingTeachers(true);
      try {
        const url =
          subjectId === "ALL"
            ? `/api/admin/teachers/by-subject`
            : `/api/admin/teachers/by-subject?subject_id=${encodeURIComponent(subjectId)}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as { items: Teacher[] };
        setTeachers([{ id: "ALL", display_name: "Tous les enseignants" }, ...(json.items || [])]);
        setTeacherId("ALL");
      } catch {
        setTeachers([{ id: "ALL", display_name: "Tous les enseignants" }]);
        setTeacherId("ALL");
      } finally {
        setLoadingTeachers(false);
      }
    })();
  }, [subjectId]);

  /* Charger données (tableau) */
  async function loadTableData() {
    if (!from || !to) return;
    if (showDetail) {
      setDetail({ loading: true, error: null, data: null });
      try {
        const qs = new URLSearchParams({ mode: "detail", from, to, teacher_id: teacherId });
        if (subjectId !== "ALL") qs.set("subject_id", subjectId);
        const res = await fetch(`/api/admin/statistics?${qs.toString()}`, { cache: "no-store" });
        const json = (await res.json()) as { rows: DetailRow[]; total_minutes: number; count: number };
        setDetail({ loading: false, error: null, data: json });
        setSummary({ loading: false, error: null, data: null });
      } catch (e: any) {
        setDetail({ loading: false, error: e?.message || "Erreur", data: null });
      }
    } else {
      setSummary({ loading: true, error: null, data: null });
      try {
        const qs = new URLSearchParams({ mode: "summary", from, to });
        if (subjectId !== "ALL") qs.set("subject_id", subjectId);
        const res = await fetch(`/api/admin/statistics?${qs.toString()}`, { cache: "no-store" });
        const json = (await res.json()) as { items?: SummaryRow[]; rows?: SummaryRow[] };
        const items = (json.items ?? json.rows ?? []) as SummaryRow[];
        setSummary({ loading: false, error: null, data: items });
        setDetail({ loading: false, error: null, data: null });
      } catch (e: any) {
        setSummary({ loading: false, error: e?.message || "Erreur", data: null });
      }
    }
  }
  useEffect(() => { if (view === "tableau") loadTableData(); /* eslint-disable-next-line */ }, [view]);
  useEffect(() => { if (view === "tableau") loadTableData(); /* eslint-disable-next-line */ }, [from, to, subjectId, teacherId]);

  /* Exports CSV (tableau) */
  function exportSummaryCSV() {
    const items = summary.data || [];
    const header = ["Enseignant", subjectId === "ALL" ? "Discipline(s)" : "Discipline (filtrée)", "Total minutes", "Total heures"];
    const lines = [header.join(";")];
    for (const it of items) {
      const disciplineCell =
        subjectId === "ALL"
          ? (it.subject_names && it.subject_names.length ? it.subject_names.join(", ") : "")
          : (subjects.find(s => s.id === subjectId)?.name || "");
      const cols = [
        it.teacher_name,
        disciplineCell,
        String(it.total_minutes),
        minutesToHourLabel(it.total_minutes),
      ];
      lines.push(cols.join(";"));
    }
    downloadText(`synthese_enseignants_${from}_${to}.csv`, lines.join("\n"));
  }
  function exportDetailCSV() {
    const d = detail.data;
    if (!d) return;
    const header = ["Date", "Heure début", "Plage horaire", "Discipline", "Classe", "Minutes", "Heures"];
    const lines = [header.join(";")];
    for (const r of d.rows) {
      const start = formatHHmm(r.dateISO);
      const end = formatHHmm(addMinutesISO(r.dateISO, r.expected_minutes || 0));
      const cols = [
        formatDateFR(r.dateISO),
        start,
        `${start} → ${end}`,
        r.subject_name || "Discipline non renseignée",
        r.class_label || "",
        String(r.expected_minutes ?? 0),
        minutesToHourLabel(r.expected_minutes ?? 0),
      ];
      lines.push(cols.join(";"));
    }
    downloadText(`detail_${teacherId}_${from}_${to}.csv`, lines.join("\n"));
  }

  /* ====== Timesheet (emploi du temps d’appel) ====== */
  const [tsSubjectId, setTsSubjectId] = useState<string>(""); // ✅ filtre discipline (vide = toutes)
  const [tsTeacherId, setTsTeacherId] = useState<string>("");
  const [tsTeachers, setTsTeachers] = useState<{ id: string; label: string }[]>([]);
  const [slot, setSlot] = useState<number>(60);
  const [startHour, setStartHour] = useState<number>(7);
  const [endHour, setEndHour] = useState<number>(18);
  const [usePeriods, setUsePeriods] = useState<boolean>(false); // ✅ toggle créneaux établissement
  const [tsData, setTsData] = useState<FetchState<TimesheetPayload>>({
    loading: false, error: null, data: null,
  });

  // ✅ Sélection de classe (boutons) + mémo
  const [selectedClassId, setSelectedClassId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("timesheet.selectedClassId") || "";
  });
  useEffect(() => {
    if (selectedClassId) localStorage.setItem("timesheet.selectedClassId", selectedClassId);
  }, [selectedClassId]);

  // ✅ Jours scolaires uniquement
  const [onlyWeekdays, setOnlyWeekdays] = useState<boolean>(false);

  /* Charger liste enseignants pour le timesheet — avec filtre discipline optionnel */
  useEffect(() => {
    if (view !== "timesheet") return;
    (async () => {
      try {
        const url = tsSubjectId
          ? `/api/admin/teachers/by-subject?subject_id=${encodeURIComponent(tsSubjectId)}`
          : `/api/admin/teachers/by-subject`;
        const res = await fetch(url, { cache: "no-store" });
        const j = await res.json();
        const items: Teacher[] = (j?.items || []) as Teacher[];
        const opts = items.map((t) => ({ id: String(t.id), label: teacherLabel(t) }));
        setTsTeachers(opts);
        // Conserver la sélection si possible, sinon prendre le premier
        if (!opts.find(o => o.id === tsTeacherId)) {
          setTsTeacherId(opts[0]?.id || "");
        }
      } catch {
        setTsTeachers([]);
        setTsTeacherId("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tsSubjectId]);

  async function loadTimesheet() {
    if (view !== "timesheet") return;
    if (!tsTeacherId || !from || !to) return;
    setTsData({ loading: true, error: null, data: null });
    const qs = new URLSearchParams({
      mode: "timesheet",
      teacher_id: tsTeacherId,
      from, to,
      slot: String(slot),
      start_hour: String(startHour),
      end_hour: String(endHour),
    });
    if (usePeriods) qs.set("use_periods", "1"); // ✅ active les créneaux établissement
    try {
      const res = await fetch(`/api/admin/statistics?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setTsData({ loading: false, error: null, data: j as TimesheetPayload });

      // ✅ Initialiser/valider la classe sélectionnée
      const cls: TimesheetClass[] = (j?.classes || []) as TimesheetClass[];
      if (cls.length) {
        const exists = cls.some(c => c.id === selectedClassId);
        if (!exists) setSelectedClassId(cls[0].id);
      } else {
        setSelectedClassId("");
      }
    } catch (e: any) {
      setTsData({ loading: false, error: e?.message || "Erreur", data: null });
      setSelectedClassId("");
    }
  }
  useEffect(() => { loadTimesheet(); /* eslint-disable-next-line */ }, [view, tsTeacherId, from, to, slot, startHour, endHour, usePeriods]);

  const td = tsData.data;

  // ✅ Calculs d’appui (dates actives / compteurs)
  const activeDatesForClass = useMemo(() => {
    if (!td || !selectedClassId) return [] as string[];
    const out: string[] = [];
    for (const d of td.dates) {
      if (onlyWeekdays && !isWeekday(d)) continue;
      let has = false;
      for (const sl of td.slots) {
        const key = `${d}|${sl.start}|${selectedClassId}`;
        if ((td.cells[key] || []).length > 0) { has = true; break; }
      }
      if (has) out.push(d);
    }
    return out;
  }, [td, selectedClassId, onlyWeekdays]);

  const clicksPerDate = useMemo(() => {
    const map = new Map<string, number>();
    if (!td || !selectedClassId) return map;
    for (const d of td.dates) {
      let c = 0;
      for (const sl of td.slots) {
        const key = `${d}|${sl.start}|${selectedClassId}`;
        c += (td.cells[key] || []).length;
      }
      map.set(d, c);
    }
    return map;
  }, [td, selectedClassId]);

  /* ─────────────────────────────────────────
     Rendu
  ────────────────────────────────────────── */
  return (
    <main className="p-4 md:p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Statistiques</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView("tableau")}
            className={[
              "rounded-full px-3 py-1.5 text-sm transition",
              view === "tableau" ? "bg-emerald-600 text-white shadow" : "border border-slate-200 text-slate-700 hover:bg-slate-50",
           ].join(" ")}
          >
            Tableau (synthèse/détail)
          </button>
          <button
            onClick={() => setView("timesheet")}
            className={[
              "rounded-full px-3 py-1.5 text-sm transition",
              view === "timesheet" ? "bg-emerald-600 text-white shadow" : "border border-slate-200 text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            Emploi du temps d’appel
          </button>
        </div>
      </header>

      {/* Filtres de période (communs) */}
      <section className="grid md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Date de début</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Date de fin</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>

        {view === "tableau" ? (
          <>
            <div className="space-y-1">
              <label className="text-sm font-medium">Discipline</label>
              <Select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                {subjects.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Enseignant</label>
              <Select value={teacherId} onChange={e => setTeacherId(e.target.value)} disabled={loadingTeachers}>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{teacherLabel(t)}</option>
                ))}
              </Select>
            </div>
          </>
        ) : (
          <>
            {/* ✅ Filtre Discipline (optionnel) pour le timesheet */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Discipline</label>
              <Select value={tsSubjectId} onChange={e => setTsSubjectId(e.target.value)}>
                <option value="">Toutes les disciplines</option>
                {subjects
                  .filter(s => s.id !== "ALL")
                  .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                }
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Enseignant</label>
              <Select value={tsTeacherId} onChange={e => setTsTeacherId(e.target.value)}>
                {!tsTeacherId && <option value="">— Sélectionner —</option>}
                {tsTeachers.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Mode de créneaux</label>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    checked={usePeriods}
                    onChange={(e) => setUsePeriods(e.target.checked)}
                  />
                  Créneaux d’établissement
                </label>
                <span className="text-xs text-slate-500">
                  {usePeriods ? "Utilise les créneaux définis dans Paramètres" : "Utilise les créneaux manuels ci-dessous"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Créneau (min)</label>
                <Select value={String(slot)} onChange={e => setSlot(parseInt(e.target.value, 10))} disabled={usePeriods}>
                  {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Début (h)</label>
                <Select value={String(startHour)} onChange={e => setStartHour(parseInt(e.target.value, 10))} disabled={usePeriods}>
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Fin (h)</label>
                <Select value={String(endHour)} onChange={e => setEndHour(parseInt(e.target.value, 10))} disabled={usePeriods}>
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </div>
            </div>
          </>
        )}
      </section>

      {view === "tableau" ? (
        /* ====== Tableau : synthèse/détail ====== */
        (teacherId === "ALL" ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Synthèse par enseignant</h2>
              <div className="flex items-center gap-2">
                <div className="text-sm">
                  Total période: <strong>{minutesToHourLabel(totalMinutesSummary)}</strong>
                </div>
                <Button onClick={exportSummaryCSV} disabled={summary.loading || !summary.data}>Export CSV</Button>
              </div>
            </div>

            {summary.loading ? (
              <div className="p-4 border rounded-xl">Chargement…</div>
            ) : summary.error ? (
              <div className="p-4 border rounded-xl text-red-600">Erreur : {summary.error}</div>
            ) : (
              <div className="overflow-auto border rounded-xl">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2">Enseignant</th>
                      <th className="text-left px-3 py-2">{disciplineHeader}</th>
                      <th className="text-right px-3 py-2">Total minutes</th>
                      <th className="text-right px-3 py-2">Total heures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.data || []).map((row) => {
                      const disciplineCell =
                        subjectId === "ALL"
                          ? (row.subject_names && row.subject_names.length ? row.subject_names.join(", ") : "")
                          : (subjects.find(s => s.id === subjectId)?.name || "");
                      return (
                        <tr key={row.teacher_id} className="border-t">
                          <td className="px-3 py-2">{row.teacher_name}</td>
                          <td className="px-3 py-2">{disciplineCell}</td>
                          <td className="px-3 py-2 text-right">{row.total_minutes}</td>
                          <td className="px-3 py-2 text-right">{minutesToHourLabel(row.total_minutes)}</td>
                        </tr>
                      );
                    })}
                    {(!summary.data || summary.data.length === 0) && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-gray-500">Aucune donnée sur la période.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Détails de l’enseignant</h2>
              <div className="flex items-center gap-2">
                {detail.data && (
                  <div className="text-sm">
                    {detail.data.count} séance(s) • Total : <strong>{minutesToHourLabel(detail.data.total_minutes)}</strong>
                  </div>
                )}
                <Button onClick={exportDetailCSV} disabled={detail.loading || !detail.data}>Export CSV</Button>
              </div>
            </div>

            {detail.loading ? (
              <div className="p-4 border rounded-xl">Chargement…</div>
            ) : detail.error ? (
              <div className="p-4 border rounded-xl text-red-600">Erreur : {detail.error}</div>
            ) : (
              <div className="overflow-auto border rounded-xl">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Plage horaire</th>
                      <th className="text-left px-3 py-2">Discipline</th>
                      <th className="text-left px-3 py-2">Classe</th>
                      <th className="text-right px-3 py-2">Minutes</th>
                      <th className="text-right px-3 py-2">Heures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.data?.rows || []).map((r) => {
                      const start = formatHHmm(r.dateISO);
                      const end = formatHHmm(addMinutesISO(r.dateISO, r.expected_minutes || 0));
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-3 py-2">{formatDateFR(r.dateISO)}</td>
                          <td className="px-3 py-2">{start} → {end}</td>
                          <td className="px-3 py-2">{r.subject_name || "Discipline non renseignée"}</td>
                          <td className="px-3 py-2">{r.class_label || "—"}</td>
                          <td className="px-3 py-2 text-right">{r.expected_minutes ?? 0}</td>
                          <td className="px-3 py-2 text-right">{minutesToHourLabel(r.expected_minutes ?? 0)}</td>
                        </tr>
                      );
                    })}
                    {(!detail.data || detail.data.rows.length === 0) && (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-gray-500">Aucune donnée pour cet enseignant sur la période.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      ) : (
        /* ====== Emploi du temps d’appel ====== */
        <section className="space-y-4">
          {/* Bandeau enseignant + total */}
          {tsData.loading ? (
            <div className="p-4 border rounded-xl">Chargement…</div>
          ) : tsData.error ? (
            <div className="p-4 border rounded-xl text-red-600">Erreur : {tsData.error}</div>
          ) : td ? (
            <>
              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-5 ring-1 ring-emerald-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate">{td.teacher.name}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(td.teacher.subjects || []).length > 0 ? (
                        td.teacher.subjects.map((s) => (
                          <span key={s} className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">Discipline non renseignée</span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm">
                    Total période : <strong>{minutesToHourLabel(td.teacher.total_minutes)}</strong>
                  </div>
                </div>

                {/* Légende compactée */}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <span>📱</span> <span>prof</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span>🖥️</span> <span>compte-classe</span>
                  </span>
                  <span className="text-slate-400">La cellule montre la <em>durée effective</em> du créneau (1h − retard).</span>
                </div>

                {/* Sélecteur de classe */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {td.classes.map((c) => {
                    const active = c.id === selectedClassId;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedClassId(c.id)}
                        aria-pressed={active}
                        className={[
                          "px-3 py-1.5 rounded-full text-sm transition",
                          active
                            ? "bg-emerald-600 text-white shadow"
                            : "border border-emerald-200 text-emerald-800 hover:bg-emerald-50",
                        ].join(" ")}
                        title={c.label}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                  {td.classes.length === 0 && (
                    <span className="text-sm text-slate-500">Aucune classe attribuée.</span>
                  )}

                  <label className="ml-auto inline-flex select-none items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      checked={onlyWeekdays}
                      onChange={(e) => setOnlyWeekdays(e.target.checked)}
                    />
                    Jours scolaires (lun-ven)
                  </label>
                </div>
              </div>

              {/* Tableau : LIGNES = créneaux ; COLONNES = dates actives */}
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                {!selectedClassId ? (
                  <div className="p-4 border rounded-xl text-slate-600">Choisissez une classe ci-dessus.</div>
                ) : activeDatesForClass.length === 0 ? (
                  <div className="p-4 border rounded-xl text-slate-600">
                    Aucune date avec séance pour <strong>{td.classes.find(c => c.id === selectedClassId)?.label || "la classe"}</strong> sur la période.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr className="text-left text-slate-600">
                          {/* Colonne créneau STICKY */}
                          <th className="px-3 py-2 w-44 whitespace-nowrap sticky left-0 z-20 bg-slate-50">
                            Créneau
                          </th>
                          {activeDatesForClass.map((d) => (
                            <th key={d} className="px-3 py-2 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span>{dateHumanFR(d)}</span>
                                <span className="text-[11px] text-slate-500">
                                  {(clicksPerDate.get(d) || 0)} clic(s)
                                </span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {td.slots.map((sl) => (
                          <tr key={sl.start}>
                            {/* Cellule créneau STICKY */}
                            <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap sticky left-0 z-10 bg-white">
                              {sl.start} – {sl.end}
                            </td>
                            {activeDatesForClass.map((d) => {
                              const key = `${d}|${sl.start}|${selectedClassId}`;
                              const times = td.cells[key] || [];
                              const metas = td.cellsMeta?.[key] || [];
                              const eff = effectiveSlotMinutes(times, sl);          // ✅ durée effective en minutes
                              const earliest = times.length ? [...times].sort()[0] : null;
                              const delta = earliest ? diffToSlotStart(earliest, sl.start) : 0;
                              const badge = clickBadgeClass(delta);
                              const origin = earliest ? metas.find(m => m.hhmm === earliest)?.origin : undefined;
                              const hint = earliest
                                ? `${d} • début ${sl.start}, premier clic ${earliest} (${delta >= 0 ? "+" : ""}${delta} min)${origin ? ` • ${origin}` : ""}`
                                : `${d} • aucun clic`;
                              return (
                                <td key={key} className="px-3 py-2 align-top">
                                  <span
                                    title={hint}
                                    className={[
                                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                                      times.length ? badge : "border-slate-200 bg-slate-50 text-slate-500",
                                    ].join(" ")}
                                  >
                                    {originEmoji(origin)} {minutesToHourLabel(eff)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  Chaque cellule affiche la <strong>durée effective</strong> du créneau&nbsp;: longueur du créneau − (heure du premier clic − heure de début). Sans clic, valeur <strong>0H00</strong>.
                </p>
              </div>
            </>
          ) : (
            <div className="p-4 border rounded-xl text-slate-600">Sélectionnez un enseignant pour afficher le tableau.</div>
          )}
        </section>
      )}
    </main>
  );
}
