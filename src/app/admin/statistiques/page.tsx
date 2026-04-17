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
  real_minutes: number;
  actual_call_iso?: string | null;
  ended_at_iso?: string | null;
  class_id?: string | null; // ✅ récupéré par l’API
  class_label?: string | null; // ✅ récupéré par l’API
};

type SummaryRow = {
  teacher_id: string;
  teacher_name: string;
  total_minutes: number; // on le garde pour compat, même si non affiché
  sessions_count: number; // ✅ nouveau : nombre de séances (1 séance = 1h)
  subject_names?: string[];
};

type InspectorWeekRow = {
  weekKey: string;
  weekLabel: string;
  subject_name: string | null;
  class_label: string | null;
  sessions: number;
  total_minutes: number;
};

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

/* Timesheet */
type TimesheetClass = { id: string; label: string };
type TimesheetSlot = { start: string; end: string };
type CellsMetaItem = {
  hhmm: string;
  origin?: "class_device" | "teacher" | string;
};

type TimesheetPayload = {
  teacher: { id: string; name: string; subjects: string[]; total_minutes: number };
  dates: string[]; // "YYYY-MM-DD"
  classes: TimesheetClass[]; // classes du prof
  slots: TimesheetSlot[]; // créneaux (lignes)
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
function formatHHmmSafe(iso?: string | null) {
  if (!iso) return "—";
  try {
    return formatHHmm(iso);
  } catch {
    return "—";
  }
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

/** Ouvre une fenêtre imprimable pour générer un beau PDF (via "Imprimer" → Enregistrer en PDF) */
function openPdfPrintWindow(title: string, subtitle: string, tableHtml: string) {
  if (typeof window === "undefined") return;

  // ⚠️ IMPORTANT : pas de "noopener,noreferrer" ici sinon Edge/Chrome peuvent bloquer le document.write
  const w = window.open("", "_blank", "width=1024,height=768");

  if (!w) {
    alert(
      "Votre navigateur a bloqué la fenêtre d'impression. " +
        "Autorisez les fenêtres pop-up pour ce site."
    );
    return;
  }

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 24px;
      color: #0f172a;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 4px;
    }
    h2 {
      font-size: 12px;
      margin: 0 0 16px;
      color: #6b7280;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 4px 6px;
      text-align: left;
    }
    th {
      background-color: #f3f4f6;
    }
    tfoot td {
      font-weight: 600;
      background-color: #f9fafb;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <h2>${subtitle}</h2>
  ${tableHtml}
  <script>
    window.addEventListener('load', function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    });
  </script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

const teacherLabel = (t: Teacher) =>
  t.display_name?.trim() ||
  t.full_name?.trim() ||
  t.email?.trim() ||
  t.phone?.trim() ||
  "(enseignant)";

function dateHumanFR(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString([], {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
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

/* Helpers pour la vue "Contrôle inspecteur" */
function mondayOfWeek(d: Date) {
  const day = d.getDay(); // 0=dimanche, 1=lundi, ...
  const diff = day === 0 ? -6 : 1 - day; // pour tomber sur lundi
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function addDays(d: Date, days: number) {
  const nd = new Date(d);
  nd.setDate(d.getDate() + days);
  return nd;
}
function formatDateFRFromDate(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function weekLabelFromMonday(monday: Date) {
  const start = formatDateFRFromDate(monday);
  const end = formatDateFRFromDate(addDays(monday, 6));
  return `Semaine du ${start} au ${end}`;
}

/* ─────────────────────────────────────────
   UI atoms
────────────────────────────────────────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm",
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
        "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm",
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
        "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
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
    loading: false,
    error: null,
    data: null,
  });
  const [detail, setDetail] = useState<
    FetchState<{ rows: DetailRow[]; total_minutes: number; count: number }>
  >({
    loading: false,
    error: null,
    data: null,
  });

  const [detailMode, setDetailMode] = useState<"seances" | "inspecteur">("seances");

  const showDetail = teacherId !== "ALL";

  // ✅ total des séances sur la période (synthèse)
  const totalSessionsSummary = useMemo(() => {
    if (!summary.data) return 0;
    return summary.data.reduce((acc, it) => acc + (it.sessions_count || 0), 0);
  }, [summary.data]);

  const disciplineHeader =
    subjectId === "ALL" ? "Discipline(s)" : "Discipline (filtrée)";

  /* Agrégation hebdo pour la vue "Contrôle inspecteur" */
  const inspectorRows = useMemo<InspectorWeekRow[]>(() => {
    if (!detail.data) return [];
    const map = new Map<string, InspectorWeekRow>();

    for (const r of detail.data.rows) {
      const d = new Date(r.dateISO);
      const monday = mondayOfWeek(d);
      const yyyy = monday.getFullYear();
      const mm = String(monday.getMonth() + 1).padStart(2, "0");
      const dd = String(monday.getDate()).padStart(2, "0");
      const weekKey = `${yyyy}-${mm}-${dd}`;
      const classLabel = r.class_label || "—";
      const subjectName = r.subject_name || "Discipline non renseignée";
      const key = `${weekKey}|${classLabel}|${subjectName}`;
      const minutes = r.real_minutes ?? r.expected_minutes ?? 0;

      const existing = map.get(key);
      if (existing) {
        existing.sessions += 1;
        existing.total_minutes += minutes;
      } else {
        map.set(key, {
          weekKey,
          weekLabel: weekLabelFromMonday(monday),
          class_label: classLabel,
          subject_name: subjectName,
          sessions: 1,
          total_minutes: minutes,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        a.weekKey.localeCompare(b.weekKey) ||
        (a.class_label || "").localeCompare(b.class_label || "") ||
        (a.subject_name || "").localeCompare(b.subject_name || "")
    );
  }, [detail.data]);

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
            : `/api/admin/teachers/by-subject?subject_id=${encodeURIComponent(
                subjectId
              )}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as { items: Teacher[] };
        setTeachers([
          { id: "ALL", display_name: "Tous les enseignants" },
          ...(json.items || []),
        ]);
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
        const qs = new URLSearchParams({
          mode: "detail",
          from,
          to,
          teacher_id: teacherId,
        });
        if (subjectId !== "ALL") qs.set("subject_id", subjectId);
        const res = await fetch(`/api/admin/statistics?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          rows: DetailRow[];
          total_minutes: number;
          count: number;
        };
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
        const res = await fetch(`/api/admin/statistics?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { items?: SummaryRow[]; rows?: SummaryRow[] };
        const items = (json.items ?? json.rows ?? []) as SummaryRow[];
        setSummary({ loading: false, error: null, data: items });
        setDetail({ loading: false, error: null, data: null });
      } catch (e: any) {
        setSummary({ loading: false, error: e?.message || "Erreur", data: null });
      }
    }
  }
  useEffect(() => {
    if (view === "tableau") loadTableData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => {
    if (view === "tableau") loadTableData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, subjectId, teacherId]);

  /* ===== Exports PDF ===== */

  function exportSummaryPDF() {
    const items = summary.data || [];
    if (!items.length) return;

    const headerHtml = `
      <thead>
        <tr>
          <th>Enseignant</th>
          <th>${disciplineHeader}</th>
          <th>Nombre de séances</th>
        </tr>
      </thead>
    `;

    const bodyHtml = items
      .map((it) => {
        const disciplineCell =
          subjectId === "ALL"
            ? it.subject_names && it.subject_names.length
              ? it.subject_names.join(", ")
              : ""
            : subjects.find((s) => s.id === subjectId)?.name || "";
        return `
          <tr>
            <td>${it.teacher_name}</td>
            <td>${disciplineCell}</td>
            <td style="text-align:right;">${it.sessions_count ?? 0}</td>
          </tr>
        `;
      })
      .join("");

    const footerHtml = `
      <tfoot>
        <tr>
          <td colspan="2">Total</td>
          <td style="text-align:right;">${totalSessionsSummary}</td>
        </tr>
      </tfoot>
    `;

    const tableHtml = `<table>${headerHtml}<tbody>${bodyHtml}</tbody>${footerHtml}</table>`;

    openPdfPrintWindow(
      "Synthèse des séances d'appel par enseignant",
      `Période du ${from} au ${to}`,
      tableHtml
    );
  }

  function exportDetailPDF() {
    const d = detail.data;
    if (!d || !d.rows.length) return;

    const headerHtml = `
      <thead>
        <tr>
          <th>Date</th>
          <th>Plage horaire prévue</th>
          <th>Début réel</th>
          <th>Fin réelle</th>
          <th>Discipline</th>
          <th>Classe</th>
          <th>Minutes effectives</th>
          <th>Durée effective</th>
        </tr>
      </thead>
    `;

    const bodyHtml = d.rows
      .map((r) => {
        const start = formatHHmm(r.dateISO);
        const end = formatHHmm(addMinutesISO(r.dateISO, r.expected_minutes || 0));
        const eff = r.real_minutes ?? r.expected_minutes ?? 0;
        const actualStart = formatHHmmSafe(r.actual_call_iso);
        const actualEnd = formatHHmmSafe(r.ended_at_iso);
        return `
          <tr>
            <td>${formatDateFR(r.dateISO)}</td>
            <td>${start} → ${end}</td>
            <td>${actualStart}</td>
            <td>${actualEnd}</td>
            <td>${r.subject_name || "Discipline non renseignée"}</td>
            <td>${r.class_label || ""}</td>
            <td style="text-align:right;">${eff}</td>
            <td style="text-align:right;">${minutesToHourLabel(eff)}</td>
          </tr>
        `;
      })
      .join("");

    const total = d.total_minutes;
    const footerHtml = `
      <tfoot>
        <tr>
          <td colspan="6">Total</td>
          <td style="text-align:right;">${total}</td>
          <td style="text-align:right;">${minutesToHourLabel(total)}</td>
        </tr>
      </tfoot>
    `;

    const currentTeacher =
      teachers.find((t) => t.id === teacherId) || ({ id: teacherId } as Teacher);

    const tableHtml = `<table>${headerHtml}<tbody>${bodyHtml}</tbody>${footerHtml}</table>`;

    openPdfPrintWindow(
      "Détail des séances d'appel",
      `Enseignant ${teacherLabel(currentTeacher)} • Période du ${from} au ${to}`,
      tableHtml
    );
  }

  function exportInspectorPDF() {
    if (!detail.data || !inspectorRows.length) return;

    const headerHtml = `
      <thead>
        <tr>
          <th>Semaine</th>
          <th>Classe</th>
          <th>Discipline</th>
          <th>Nombre de séances (appels)</th>
          <th>Durée totale effective</th>
        </tr>
      </thead>
    `;

    const bodyHtml = inspectorRows
      .map(
        (r) => `
        <tr>
          <td>${r.weekLabel}</td>
          <td>${r.class_label || ""}</td>
          <td>${r.subject_name || ""}</td>
          <td style="text-align:right;">${r.sessions}</td>
          <td style="text-align:right;">${minutesToHourLabel(r.total_minutes)}</td>
        </tr>
      `
      )
      .join("");

    const totalMinutes = inspectorRows.reduce(
      (acc, r) => acc + (r.total_minutes || 0),
      0
    );
    const totalSessions = inspectorRows.reduce(
      (acc, r) => acc + (r.sessions || 0),
      0
    );

    const footerHtml = `
      <tfoot>
        <tr>
          <td colspan="3">Total</td>
          <td style="text-align:right;">${totalSessions}</td>
          <td style="text-align:right;">${minutesToHourLabel(totalMinutes)}</td>
        </tr>
      </tfoot>
    `;

    const currentTeacher =
      teachers.find((t) => t.id === teacherId) || ({ id: teacherId } as Teacher);

    const tableHtml = `<table>${headerHtml}<tbody>${bodyHtml}</tbody>${footerHtml}</table>`;

    openPdfPrintWindow(
      'Vue "Contrôle inspecteur"',
      `Enseignant ${teacherLabel(currentTeacher)} • Période du ${from} au ${to}`,
      tableHtml
    );
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
    loading: false,
    error: null,
    data: null,
  });

  // ✅ Sélection de classe (boutons) + mémo
  const [selectedClassId, setSelectedClassId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("timesheet.selectedClassId") || "";
  });
  useEffect(() => {
    if (selectedClassId)
      localStorage.setItem("timesheet.selectedClassId", selectedClassId);
  }, [selectedClassId]);

  // ✅ Jours scolaires uniquement
  const [onlyWeekdays, setOnlyWeekdays] = useState<boolean>(false);

  /* Charger liste enseignants pour le timesheet — avec filtre discipline optionnel */
  useEffect(() => {
    if (view !== "timesheet") return;
    (async () => {
      try {
        const url = tsSubjectId
          ? `/api/admin/teachers/by-subject?subject_id=${encodeURIComponent(
              tsSubjectId
            )}`
          : `/api/admin/teachers/by-subject`;
        const res = await fetch(url, { cache: "no-store" });
        const j = await res.json();
        const items: Teacher[] = (j?.items || []) as Teacher[];
        const opts = items.map((t) => ({ id: String(t.id), label: teacherLabel(t) }));
        setTsTeachers(opts);
        // Conserver la sélection si possible, sinon prendre le premier
        if (!opts.find((o) => o.id === tsTeacherId)) {
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
      from,
      to,
      slot: String(slot),
      start_hour: String(startHour),
      end_hour: String(endHour),
    });
    if (usePeriods) qs.set("use_periods", "1"); // ✅ active les créneaux établissement
    try {
      const res = await fetch(`/api/admin/statistics?${qs.toString()}`, {
        cache: "no-store",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setTsData({ loading: false, error: null, data: j as TimesheetPayload });

      // ✅ Initialiser/valider la classe sélectionnée
      const cls: TimesheetClass[] = (j?.classes || []) as TimesheetClass[];
      if (cls.length) {
        const exists = cls.some((c) => c.id === selectedClassId);
        if (!exists) setSelectedClassId(cls[0].id);
      } else {
        setSelectedClassId("");
      }
    } catch (e: any) {
      setTsData({ loading: false, error: e?.message || "Erreur", data: null });
      setSelectedClassId("");
    }
  }
  useEffect(() => {
    loadTimesheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tsTeacherId, from, to, slot, startHour, endHour, usePeriods]);

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
        if ((td.cells[key] || []).length > 0) {
          has = true;
          break;
        }
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
    <main className="min-h-screen bg-slate-50/80 p-4 md:p-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Statistiques</h1>
          <p className="text-sm text-slate-500 mt-1">
            Suivi des appels, contrôle des enseignants et emploi du temps d’appel.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm">
          <button
            onClick={() => setView("tableau")}
            className={[
              "rounded-full px-3 py-1.5 text-xs md:text-sm transition",
              view === "tableau"
                ? "bg-emerald-600 text-white shadow"
                : "text-slate-700 hover:bg-slate-100",
            ].join(" ")}
          >
            Tableau (synthèse / détail)
          </button>
          <button
            onClick={() => setView("timesheet")}
            className={[
              "rounded-full px-3 py-1.5 text-xs md:text-sm transition",
              view === "timesheet"
                ? "bg-emerald-600 text-white shadow"
                : "text-slate-700 hover:bg-slate-100",
            ].join(" ")}
          >
            Emploi du temps d’appel
          </button>
        </div>
      </header>

      {/* Filtres de période (communs) */}
      <section className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Filtres de période</h2>
          <span className="text-xs text-slate-500">
            Période active : <strong>{from}</strong> → <strong>{to}</strong>
          </span>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Date de début</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Date de fin</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          {view === "tableau" ? (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Discipline</label>
                <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Enseignant</label>
                <Select
                  value={teacherId}
                  onChange={(e) => {
                    setTeacherId(e.target.value);
                    setDetailMode("seances");
                  }}
                  disabled={loadingTeachers}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {teacherLabel(t)}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : (
            <>
              {/* ✅ Filtre Discipline (optionnel) pour le timesheet */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Discipline</label>
                <Select
                  value={tsSubjectId}
                  onChange={(e) => setTsSubjectId(e.target.value)}
                >
                  <option value="">Toutes les disciplines</option>
                  {subjects
                    .filter((s) => s.id !== "ALL")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Enseignant</label>
                <Select
                  value={tsTeacherId}
                  onChange={(e) => setTsTeacherId(e.target.value)}
                >
                  {!tsTeacherId && <option value="">— Sélectionner —</option>}
                  {tsTeachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">
                  Mode de créneaux
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      checked={usePeriods}
                      onChange={(e) => setUsePeriods(e.target.checked)}
                    />
                    Créneaux d’établissement
                  </label>
                  <span className="text-xs text-slate-500">
                    {usePeriods
                      ? "Utilise les créneaux définis dans Paramètres"
                      : "Utilise les créneaux manuels ci-dessous"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">
                    Créneau (min)
                  </label>
                  <Select
                    value={String(slot)}
                    onChange={(e) => setSlot(parseInt(e.target.value, 10))}
                    disabled={usePeriods}
                  >
                    {[30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Début (h)</label>
                  <Select
                    value={String(startHour)}
                    onChange={(e) => setStartHour(parseInt(e.target.value, 10))}
                    disabled={usePeriods}
                  >
                    {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Fin (h)</label>
                  <Select
                    value={String(endHour)}
                    onChange={(e) => setEndHour(parseInt(e.target.value, 10))}
                    disabled={usePeriods}
                  >
                    {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {view === "tableau" ? (
        /* ====== Tableau : synthèse/détail ====== */
        teacherId === "ALL" ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Synthèse par enseignant
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Vue globale du <strong>nombre de séances d’appel</strong> par enseignant
                  sur la période.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs md:text-sm rounded-full bg-emerald-50 text-emerald-800 px-3 py-1 border border-emerald-100">
                  Total période : <strong>{totalSessionsSummary}</strong> séance(s)
                </div>
                <Button
                  onClick={exportSummaryPDF}
                  disabled={summary.loading || !summary.data}
                >
                  Export PDF
                </Button>
              </div>
            </div>

            {summary.loading ? (
              <div className="p-4 border border-slate-200 rounded-2xl bg-white text-slate-700">
                Chargement…
              </div>
            ) : summary.error ? (
              <div className="p-4 border border-red-200 rounded-2xl bg-red-50 text-red-700">
                Erreur : {summary.error}
              </div>
            ) : (
              <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100/80 text-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2">Enseignant</th>
                      <th className="text-left px-3 py-2">{disciplineHeader}</th>
                      <th className="text-right px-3 py-2">Nombre de séances</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(summary.data || []).map((row) => {
                      const disciplineCell =
                        subjectId === "ALL"
                          ? row.subject_names && row.subject_names.length
                            ? row.subject_names.join(", ")
                            : ""
                          : subjects.find((s) => s.id === subjectId)?.name || "";
                      return (
                        <tr
                          key={row.teacher_id}
                          className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50/70 transition-colors"
                        >
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {row.teacher_name}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{disciplineCell}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {row.sessions_count ?? 0}
                          </td>
                        </tr>
                      );
                    })}
                    {(!summary.data || summary.data.length === 0) && (
                      <tr className="odd:bg-white">
                        <td
                          colSpan={3}
                          className="px-3 py-4 text-center text-gray-500"
                        >
                          Aucune donnée sur la période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  Détails de l’enseignant
                </h2>
                <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDetailMode("seances")}
                    className={[
                      "px-3 py-1 rounded-full transition",
                      detailMode === "seances"
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-600 hover:bg-white/60",
                    ].join(" ")}
                  >
                    Séances détaillées
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailMode("inspecteur")}
                    className={[
                      "px-3 py-1 rounded-full transition",
                      detailMode === "inspecteur"
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-600 hover:bg-white/60",
                    ].join(" ")}
                  >
                    Vue "Contrôle inspecteur"
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {detail.data && (
                  <div className="text-xs md:text-sm rounded-full bg-slate-100 text-slate-800 px-3 py-1 border border-slate-200">
                    {detail.data.count} séance(s) • Total :{" "}
                    <strong>{minutesToHourLabel(detail.data.total_minutes)}</strong>
                  </div>
                )}
                {detailMode === "seances" ? (
                  <Button
                    onClick={exportDetailPDF}
                    disabled={detail.loading || !detail.data}
                  >
                    Export séances PDF
                  </Button>
                ) : (
                  <Button
                    onClick={exportInspectorPDF}
                    disabled={
                      detail.loading || !detail.data || inspectorRows.length === 0
                    }
                  >
                    Export contrôle PDF
                  </Button>
                )}
              </div>
            </div>

            {detail.loading ? (
              <div className="p-4 border border-slate-200 rounded-2xl bg-white text-slate-700">
                Chargement…
              </div>
            ) : detail.error ? (
              <div className="p-4 border border-red-200 rounded-2xl bg-red-50 text-red-700">
                Erreur : {detail.error}
              </div>
            ) : detailMode === "seances" ? (
              <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100/80 text-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Plage horaire prévue</th>
                      <th className="text-left px-3 py-2">Début réel</th>
                      <th className="text-left px-3 py-2">Fin réelle</th>
                      <th className="text-left px-3 py-2">Discipline</th>
                      <th className="text-left px-3 py-2">Classe</th>
                      <th className="text-right px-3 py-2">Minutes effectives</th>
                      <th className="text-right px-3 py-2">Durée effective</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(detail.data?.rows || []).map((r) => {
                      const start = formatHHmm(r.dateISO);
                      const end = formatHHmm(
                        addMinutesISO(r.dateISO, r.expected_minutes || 0)
                      );
                      const eff = r.real_minutes ?? r.expected_minutes ?? 0;
                      return (
                        <tr
                          key={r.id}
                          className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50/70 transition-colors"
                        >
                          <td className="px-3 py-2 text-slate-800">
                            {formatDateFR(r.dateISO)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {start} → {end}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {formatHHmmSafe(r.actual_call_iso)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {formatHHmmSafe(r.ended_at_iso)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {r.subject_name || "Discipline non renseignée"}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {r.class_label || "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {eff}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {minutesToHourLabel(eff)}
                          </td>
                        </tr>
                      );
                    })}
                    {(!detail.data || detail.data.rows.length === 0) && (
                      <tr className="odd:bg-white">
                        <td
                          colSpan={8}
                          className="px-3 py-4 text-center text-gray-500"
                        >
                          Aucune donnée pour cet enseignant sur la période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100/80 text-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2">Semaine</th>
                      <th className="text-left px-3 py-2">Classe</th>
                      <th className="text-left px-3 py-2">Discipline</th>
                      <th className="text-right px-3 py-2">
                        Nombre de séances (appels)
                      </th>
                      <th className="text-right px-3 py-2">
                        Durée totale effective
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspectorRows.map((r, idx) => (
                      <tr
                        key={`${r.weekKey}-${idx}`}
                        className="odd:bg-white even:bg-slate-50 hover:bg-emerald-50/70 transition-colors"
                      >
                        <td className="px-3 py-2 text-slate-800">{r.weekLabel}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.class_label || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.subject_name || "Discipline non renseignée"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {r.sessions}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {minutesToHourLabel(r.total_minutes)}
                        </td>
                      </tr>
                    ))}
                    {inspectorRows.length === 0 && (
                      <tr className="odd:bg-white">
                        <td
                          colSpan={5}
                          className="px-3 py-4 text-center text-gray-500"
                        >
                          Aucune donnée agrégée pour cet enseignant sur la période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-500 px-1 pb-1">
                  Chaque ligne représente une <strong>semaine</strong> pour une{" "}
                  <strong>classe</strong> et une<strong> discipline</strong>. Le nombre
                  de séances correspond aux appels effectués, et la durée totale est
                  calculée à partir du <strong>temps réellement effectué</strong> (durée
                  prévue du créneau − retard au premier appel).
                </p>
              </div>
            )}
          </section>
        )
      ) : (
        /* ====== Emploi du temps d’appel ====== */
        <section className="space-y-4">
          {/* Bandeau enseignant + total */}
          {tsData.loading ? (
            <div className="p-4 border border-slate-200 rounded-2xl bg-white text-slate-700">
              Chargement…
            </div>
          ) : tsData.error ? (
            <div className="p-4 border border-red-200 rounded-2xl bg-red-50 text-red-700">
              Erreur : {tsData.error}
            </div>
          ) : td ? (
            <>
              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-5 shadow-sm ring-1 ring-emerald-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate text-slate-900">
                      {td.teacher.name}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(td.teacher.subjects || []).length > 0 ? (
                        td.teacher.subjects.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200"
                          >
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">
                          Discipline non renseignée
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm rounded-xl bg-white/80 border border-emerald-100 px-3 py-1.5 text-emerald-900 shadow-sm">
                    Total période :{" "}
                    <strong>{minutesToHourLabel(td.teacher.total_minutes)}</strong>
                  </div>
                </div>

                {/* Légende compactée */}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 border border-slate-200">
                    <span>📱</span> <span>prof</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 border border-slate-200">
                    <span>🖥️</span> <span>compte-classe</span>
                  </span>
                  <span className="text-slate-500">
                    La cellule montre la <em>durée effective</em> du créneau (1h − retard).
                  </span>
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
                          "px-3 py-1.5 rounded-full text-sm transition border",
                          active
                            ? "bg-emerald-600 text-white shadow border-emerald-700"
                            : "border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100",
                        ].join(" ")}
                        title={c.label}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                  {td.classes.length === 0 && (
                    <span className="text-sm text-slate-500">
                      Aucune classe attribuée.
                    </span>
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
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                {!selectedClassId ? (
                  <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50 text-slate-600">
                    Choisissez une classe ci-dessus.
                  </div>
                ) : activeDatesForClass.length === 0 ? (
                  <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50 text-slate-600">
                    Aucune date avec séance pour{" "}
                    <strong>
                      {td.classes.find((c) => c.id === selectedClassId)?.label ||
                        "la classe"}
                    </strong>{" "}
                    sur la période.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700">
                        <tr className="text-left">
                          {/* Colonne créneau STICKY */}
                          <th className="px-3 py-2 w-44 whitespace-nowrap sticky left-0 z-20 bg-slate-100">
                            Créneau
                          </th>
                          {activeDatesForClass.map((d) => (
                            <th key={d} className="px-3 py-2 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span>{dateHumanFR(d)}</span>
                                <span className="text-[11px] text-slate-500">
                                  {clicksPerDate.get(d) || 0} clic(s)
                                </span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {td.slots.map((sl) => (
                          <tr key={sl.start} className="odd:bg-white even:bg-slate-50">
                            {/* Cellule créneau STICKY */}
                            <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap sticky left-0 z-10 bg-white">
                              {sl.start} – {sl.end}
                            </td>
                            {activeDatesForClass.map((d) => {
                              const key = `${d}|${sl.start}|${selectedClassId}`;
                              const times = td.cells[key] || [];
                              const metas = td.cellsMeta?.[key] || [];
                              const eff = effectiveSlotMinutes(times, sl); // ✅ durée effective en minutes
                              const earliest = times.length ? [...times].sort()[0] : null;
                              const delta = earliest
                                ? diffToSlotStart(earliest, sl.start)
                                : 0;
                              const badge = clickBadgeClass(delta);
                              const origin = earliest
                                ? metas.find((m) => m.hhmm === earliest)?.origin
                                : undefined;
                              const hint = earliest
                                ? `${d} • début ${sl.start}, premier clic ${earliest} (${
                                    delta >= 0 ? "+" : ""
                                  }${delta} min)${origin ? ` • ${origin}` : ""}`
                                : `${d} • aucun clic`;
                              return (
                                <td key={key} className="px-3 py-2 align-top">
                                  <span
                                    title={hint}
                                    className={[
                                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition",
                                      times.length
                                        ? `${badge} hover:shadow-sm`
                                        : "border-slate-200 bg-slate-50 text-slate-500",
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
                  Chaque cellule affiche la <strong>durée effective</strong> du créneau :
                  longueur du créneau − (heure du premier clic − heure de début). Sans
                  clic, valeur <strong>0H00</strong>.
                </p>
              </div>
            </>
          ) : (
            <div className="p-4 border border-slate-200 rounded-2xl bg-white text-slate-600">
              Sélectionnez un enseignant pour afficher le tableau.
            </div>
          )}
        </section>
      )}
    </main>
  );
}
