"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
  Search,
  Loader2,
  FileText,
  ShieldCheck,
  Hourglass,
} from "lucide-react";
import { fetchAdminAttendanceMonitor, type LocalDataSource } from "@/lib/local-relay";
import EducationScopeFilter from "@/components/admin/EducationScopeFilter";
import {
  educationTypeLabel,
  useEducationTeachingContext,
} from "@/hooks/useEducationTeachingContext";
import type { EducationType } from "@/lib/education-organization";
import {
  ALL_EDUCATION_TYPES,
  classMatchesEducationScope,
  getClassDisplayLabel,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";

type MonitorStatus =
  | "missing"
  | "late"
  | "ok"
  | "waiting"
  | "pending_absence"
  | "justified_absence";

type MonitorRow = {
  id: string;
  date: string; // "YYYY-MM-DD"
  weekday_label?: string | null;
  period_label?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  class_id?: string | null;
  class_label?: string | null;
  class_level?: string | null;
  education_type?: EducationType | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
  subject_name?: string | null;
  teacher_name: string;
  status: MonitorStatus;
  late_minutes?: number | null;
  opened_from?: "teacher" | "class_device" | null;

  absence_request_status?: "pending" | "approved" | "rejected" | null;
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
};

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

type InstitutionSettings = {
  institution_name?: string | null;
  institution_label?: string | null;
  name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;
};

type TeacherSummaryRow = {
  teacher_name: string;
  total: number;
  missing: number;
  late: number;
  waiting: number;
  pending_absence: number;
  justified_absence: number;
  ok: number;
};

type SubjectGroup = {
  subject_name: string;
  rows: MonitorRow[];
  teacher_summary: TeacherSummaryRow[];
  totals: {
    total: number;
    missing: number;
    late: number;
    waiting: number;
    pending_absence: number;
    justified_absence: number;
    ok: number;
  };
};

const DEFAULT_MONITOR_SCOPE: EducationScopeValue = {
  educationType: ALL_EDUCATION_TYPES,
  formationCode: "",
  levelCode: "",
  classId: "",
};

function classFromMonitorRow(row: MonitorRow): EducationScopedClass | null {
  const id = String(row.class_id || "").trim();
  if (!id) return null;

  return {
    id,
    label: row.class_label || id,
    level: row.class_level || null,
    education_type: row.education_type || null,
    formation_code: row.formation_code || null,
    formation_level_code: row.formation_level_code || null,
  };
}

function uniqueClassesFromRows(rows: MonitorRow[]) {
  const map = new Map<string, EducationScopedClass>();
  for (const row of rows) {
    const classRow = classFromMonitorRow(row);
    if (classRow) map.set(classRow.id, classRow);
  }
  return Array.from(map.values());
}

function rowMatchesScope(
  row: MonitorRow,
  scope: EducationScopeValue,
  knownClasses: EducationScopedClass[],
) {
  if (scope.educationType === ALL_EDUCATION_TYPES) return true;

  let classRow = classFromMonitorRow(row);
  if (!classRow && row.class_label) {
    const matches = knownClasses.filter(
      (candidate) => getClassDisplayLabel(candidate) === row.class_label,
    );
    if (matches.length === 1) classRow = matches[0] || null;
  }

  if (!classRow) {
    // Compatibilite temporaire des anciennes reponses du relais : elles ne
    // transportaient pas encore l'identifiant ni le contexte de la classe.
    return (
      scope.educationType === "general_secondary" &&
      !scope.formationCode &&
      !scope.levelCode &&
      !scope.classId
    );
  }

  return classMatchesEducationScope(classRow, scope);
}

/* ───────── Helpers ───────── */

function toLocalDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateHumanFR(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function dateLongFR(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function escapeHtml(input: string | number | null | undefined) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function institutionDisplayName(cfg: InstitutionSettings) {
  return (
    (cfg.institution_name || "").trim() ||
    (cfg.institution_label || "").trim() ||
    (cfg.name || "").trim() ||
    "Établissement scolaire"
  );
}

function institutionMetaLine(cfg: InstitutionSettings) {
  return [
    (cfg.institution_region || "").trim(),
    (cfg.institution_postal_address || "").trim(),
    [(cfg.institution_phone || "").trim(), (cfg.institution_email || "").trim()]
      .filter(Boolean)
      .join(" • "),
  ]
    .filter(Boolean)
    .join(" • ");
}

function normalizeTeacherName(name?: string | null) {
  return (name || "").trim() || "Enseignant non renseigné";
}

function normalizeSubjectName(name?: string | null) {
  return (name || "").trim() || "Discipline non renseignée";
}

function countStatuses(rows: MonitorRow[]) {
  return {
    total: rows.length,
    missing: rows.filter((r) => r.status === "missing").length,
    late: rows.filter((r) => r.status === "late").length,
    waiting: rows.filter((r) => r.status === "waiting").length,
    pending_absence: rows.filter((r) => r.status === "pending_absence").length,
    justified_absence: rows.filter((r) => r.status === "justified_absence").length,
    ok: rows.filter((r) => r.status === "ok").length,
  };
}

function teacherSummary(rows: MonitorRow[]): TeacherSummaryRow[] {
  const map = new Map<string, TeacherSummaryRow>();

  for (const row of rows) {
    const key = normalizeTeacherName(row.teacher_name);
    const existing =
      map.get(key) || {
        teacher_name: key,
        total: 0,
        missing: 0,
        late: 0,
        waiting: 0,
        pending_absence: 0,
        justified_absence: 0,
        ok: 0,
      };

    existing.total += 1;

    switch (row.status) {
      case "missing":
        existing.missing += 1;
        break;
      case "late":
        existing.late += 1;
        break;
      case "waiting":
        existing.waiting += 1;
        break;
      case "pending_absence":
        existing.pending_absence += 1;
        break;
      case "justified_absence":
        existing.justified_absence += 1;
        break;
      case "ok":
        existing.ok += 1;
        break;
    }

    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) =>
    a.teacher_name.localeCompare(b.teacher_name, "fr", { sensitivity: "base" })
  );
}

function sortRows(rows: MonitorRow[]) {
  return [...rows].sort((a, b) => {
    const byTeacher = normalizeTeacherName(a.teacher_name).localeCompare(
      normalizeTeacherName(b.teacher_name),
      "fr",
      { sensitivity: "base" }
    );
    if (byTeacher !== 0) return byTeacher;

    const byDate = (a.date || "").localeCompare(b.date || "");
    if (byDate !== 0) return byDate;

    const aTime = a.planned_start || a.period_label || "";
    const bTime = b.planned_start || b.period_label || "";
    const byTime = aTime.localeCompare(bTime, "fr", { sensitivity: "base" });
    if (byTime !== 0) return byTime;

    return (a.class_label || "").localeCompare(b.class_label || "", "fr", {
      sensitivity: "base",
    });
  });
}

function groupRowsBySubject(rows: MonitorRow[]): SubjectGroup[] {
  const map = new Map<string, MonitorRow[]>();

  for (const row of rows) {
    const subject = normalizeSubjectName(row.subject_name);
    const existing = map.get(subject) || [];
    existing.push(row);
    map.set(subject, existing);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, "fr", { sensitivity: "base" }))
    .map(([subject_name, subjectRows]) => {
      const sorted = sortRows(subjectRows);
      return {
        subject_name,
        rows: sorted,
        teacher_summary: teacherSummary(sorted),
        totals: countStatuses(sorted),
      };
    });
}

function statusText(r: MonitorRow) {
  if (r.status === "missing") return "Appel manquant";
  if (r.status === "waiting") return "Créneau en attente";
  if (r.status === "late") {
    return `Appel en retard${
      typeof r.late_minutes === "number" ? ` (+${r.late_minutes} min)` : ""
    }`;
  }
  if (r.status === "pending_absence") return "Demande en attente";
  if (r.status === "justified_absence") return "Absence justifiée";
  return "Appel conforme";
}

function detailsText(r: MonitorRow) {
  if (r.status === "missing") {
    return "Aucun appel détecté pour ce créneau.";
  }
  if (r.status === "waiting") {
    return "Le créneau n’a pas encore atteint l’heure limite de l’appel.";
  }
  if (r.status === "late") {
    return `Appel réalisé avec retard${
      typeof r.late_minutes === "number" ? ` (+${r.late_minutes} min)` : ""
    }.`;
  }
  if (r.status === "pending_absence") {
    return `Demande d’absence soumise et en attente de validation${
      r.absence_reason_label ? ` (${r.absence_reason_label})` : ""
    }.`;
  }
  if (r.status === "justified_absence") {
    return `Absence approuvée par l’administration${
      r.absence_reason_label ? ` (${r.absence_reason_label})` : ""
    }${
      r.absence_admin_comment ? ` — ${r.absence_admin_comment}` : ""
    }.`;
  }
  return "Appel dans les délais.";
}

function openPrintDocument(html: string) {
  if (typeof window === "undefined") return;

  const win = window.open("", "_blank", "width=1200,height=900");
  if (!win) {
    window.alert(
      "Votre navigateur a bloqué la fenêtre d'impression. Autorisez les fenêtres pop-up pour ce site."
    );
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}

function buildPrintHtml(args: {
  cfg: InstitutionSettings;
  from: string;
  to: string;
  statusLabel: string;
  teacherLabelText: string;
  educationScopeLabel: string;
  rows: MonitorRow[];
}) {
  const {
    cfg,
    from,
    to,
    statusLabel,
    teacherLabelText,
    educationScopeLabel,
    rows,
  } = args;

  const institutionName = institutionDisplayName(cfg);
  const logoUrl = (cfg.institution_logo_url || "").trim();
  const institutionMeta = institutionMetaLine(cfg);
  const headName = (cfg.institution_head_name || "").trim() || "Administration";
  const headTitle =
    (cfg.institution_head_title || "").trim() || "Responsable administratif";

  const totals = countStatuses(rows);
  const groups = groupRowsBySubject(rows);

  const subjectSections = groups
    .map((group) => {
      const teacherTable = group.teacher_summary
        .map(
          (t) => `
            <tr>
              <td>${escapeHtml(t.teacher_name)}</td>
              <td>${t.total}</td>
              <td>${t.missing}</td>
              <td>${t.late}</td>
              <td>${t.waiting}</td>
              <td>${t.pending_absence}</td>
              <td>${t.justified_absence}</td>
              <td>${t.ok}</td>
            </tr>
          `
        )
        .join("");

      const detailsTable = group.rows
        .map((r, idx) => {
          const period =
            (r.planned_start && r.planned_end
              ? `${r.planned_start} – ${r.planned_end}`
              : null) ??
            r.period_label ??
            "—";

          return `
            <tr>
              <td>${idx + 1}</td>
              <td>${escapeHtml(dateHumanFR(r.date))}</td>
              <td>${escapeHtml(period)}</td>
              <td>${escapeHtml(r.class_label || "—")}</td>
              <td>${escapeHtml(r.teacher_name || "—")}</td>
              <td>${escapeHtml(statusText(r))}</td>
              <td>${escapeHtml(detailsText(r))}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="subject-block">
          <div class="subject-title">${escapeHtml(group.subject_name)}</div>

          <div class="mini-summary">
            <div class="mini-card"><span>Créneaux</span><strong>${group.totals.total}</strong></div>
            <div class="mini-card"><span>Manquants</span><strong>${group.totals.missing}</strong></div>
            <div class="mini-card"><span>Retards</span><strong>${group.totals.late}</strong></div>
            <div class="mini-card"><span>Créneaux en attente</span><strong>${group.totals.waiting}</strong></div>
            <div class="mini-card"><span>Absences à valider</span><strong>${group.totals.pending_absence}</strong></div>
            <div class="mini-card"><span>Justifiées</span><strong>${group.totals.justified_absence}</strong></div>
            <div class="mini-card"><span>Conformes</span><strong>${group.totals.ok}</strong></div>
          </div>

          <div class="section-subtitle">Synthèse des enseignants</div>
          <table>
            <thead>
              <tr>
                <th>Enseignant</th>
                <th>Total</th>
                <th>Manquants</th>
                <th>Retards</th>
                <th>Créneaux en attente</th>
                <th>Absences à valider</th>
                <th>Justifiées</th>
                <th>Conformes</th>
              </tr>
            </thead>
            <tbody>
              ${teacherTable || `<tr><td colspan="8">Aucune donnée</td></tr>`}
            </tbody>
          </table>

          <div class="section-subtitle">Détail des créneaux</div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Créneau</th>
                <th>Classe</th>
                <th>Enseignant</th>
                <th>Statut</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              ${detailsTable || `<tr><td colspan="7">Aucune donnée</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Point de surveillance des appels</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: #eef2f7;
      color: #0f172a;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
    }

    body {
      padding: 14px;
    }

    .page {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      border: 1px solid #e2e8f0;
      padding: 14mm 12mm;
    }

    .top {
      display: grid;
      grid-template-columns: 70px 1fr;
      gap: 14px;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 2px solid #0f766e;
    }

    .logo-wrap {
      width: 70px;
      height: 70px;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #fff;
    }

    .logo-wrap img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .logo-placeholder {
      color: #64748b;
      font-size: 11px;
      font-weight: 700;
    }

    .establishment-name {
      font-size: 20px;
      font-weight: 800;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .establishment-meta {
      margin-top: 4px;
      color: #475569;
      line-height: 1.4;
    }

    .title-wrap {
      margin-top: 16px;
      text-align: center;
    }

    .report-title {
      font-size: 18px;
      font-weight: 800;
      text-transform: uppercase;
      color: #0f172a;
    }

    .report-subtitle {
      margin-top: 6px;
      color: #475569;
      line-height: 1.5;
    }

    .summary {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
    }

    .card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 10px;
      text-align: center;
      background: #f8fafc;
    }

    .card .label {
      font-size: 10px;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 4px;
      font-weight: 700;
    }

    .card .value {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
    }

    .subject-block {
      margin-top: 18px;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 12px;
      page-break-inside: avoid;
    }

    .subject-title {
      font-size: 14px;
      font-weight: 800;
      text-transform: uppercase;
      color: #0f172a;
      border-left: 4px solid #10b981;
      padding-left: 8px;
      margin-bottom: 10px;
    }

    .mini-summary {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }

    .mini-card {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 10px;
      padding: 8px;
      text-align: center;
    }

    .mini-card span {
      display: block;
      color: #64748b;
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 4px;
      font-weight: 700;
    }

    .mini-card strong {
      font-size: 15px;
      color: #0f172a;
    }

    .section-subtitle {
      margin-top: 12px;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    th, td {
      border: 1px solid #e2e8f0;
      padding: 6px 7px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #f1f5f9;
      font-weight: 700;
    }

    .signatures {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-top: 26px;
    }

    .signature-box {
      text-align: center;
    }

    .signature-line {
      margin-top: 42px;
      border-top: 1px solid #94a3b8;
      padding-top: 6px;
      font-size: 11px;
      color: #334155;
    }

    .footer-note {
      margin-top: 14px;
      font-size: 10px;
      color: #64748b;
      text-align: right;
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }

      .page {
        border: none;
        max-width: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="logo-wrap">
        ${
          logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="Logo établissement" />`
            : `<div class="logo-placeholder">LOGO</div>`
        }
      </div>
      <div>
        <div class="establishment-name">${escapeHtml(institutionName)}</div>
        ${
          institutionMeta
            ? `<div class="establishment-meta">${escapeHtml(institutionMeta)}</div>`
            : ""
        }
      </div>
    </div>

    <div class="title-wrap">
      <div class="report-title">Point de surveillance des appels</div>
      <div class="report-subtitle">
        Période du <strong>${escapeHtml(dateLongFR(from))}</strong> au
        <strong>${escapeHtml(dateLongFR(to))}</strong><br />
        Périmètre : <strong>${escapeHtml(educationScopeLabel)}</strong><br />
        Filtre statut : <strong>${escapeHtml(statusLabel)}</strong> •
        <strong>${escapeHtml(teacherLabelText)}</strong>
      </div>
    </div>

    <div class="summary">
      <div class="card"><div class="label">Manquants</div><div class="value">${totals.missing}</div></div>
      <div class="card"><div class="label">Retards</div><div class="value">${totals.late}</div></div>
      <div class="card"><div class="label">Créneaux en attente</div><div class="value">${totals.waiting}</div></div>
      <div class="card"><div class="label">Absences à valider</div><div class="value">${totals.pending_absence}</div></div>
      <div class="card"><div class="label">Justifiées</div><div class="value">${totals.justified_absence}</div></div>
      <div class="card"><div class="label">Conformes</div><div class="value">${totals.ok}</div></div>
    </div>

    ${subjectSections || `<div class="subject-block">Aucune donnée</div>`}

    <div class="signatures">
      <div class="signature-box">
        <div class="signature-line">Administration</div>
      </div>
      <div class="signature-box">
        <div class="signature-line">${escapeHtml(headName)}${
          headTitle ? ` — ${escapeHtml(headTitle)}` : ""
        }</div>
      </div>
    </div>

    <div class="footer-note">
      Document édité le ${escapeHtml(
        new Date().toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      )}
    </div>
  </div>

  <script>
    window.addEventListener("load", function () {
      setTimeout(function () {
        try {
          window.focus();
          window.print();
        } catch (e) {}
      }, 350);
    });
  </script>
</body>
</html>`;
}

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
        "disabled:cursor-not-allowed disabled:opacity-60",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "violet" | "sky" | "blue" | "emerald";
}) {
  const toneClasses =
    tone === "red"
      ? "border-red-100 bg-red-50 text-red-800"
      : tone === "amber"
      ? "border-amber-100 bg-amber-50 text-amber-800"
      : tone === "violet"
      ? "border-violet-100 bg-violet-50 text-violet-800"
      : tone === "sky"
      ? "border-sky-100 bg-sky-50 text-sky-800"
      : tone === "blue"
      ? "border-blue-100 bg-blue-50 text-blue-800"
      : "border-emerald-100 bg-emerald-50 text-emerald-800";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${toneClasses}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export default function SurveillanceAppelsPage() {
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toLocalDateInputValue(d);
  });
  const [to, setTo] = useState<string>(() => toLocalDateInputValue(new Date()));
  const [statusFilter, setStatusFilter] = useState<MonitorStatus | "all">("all");
  const [teacherQuery, setTeacherQuery] = useState<string>("");
  const [educationScope, setEducationScope] =
    useState<EducationScopeValue>(DEFAULT_MONITOR_SCOPE);
  const [availableClasses, setAvailableClasses] = useState<
    EducationScopedClass[]
  >([]);
  const educationContext = useEducationTeachingContext();

  const [rowsState, setRowsState] = useState<FetchState<MonitorRow[]>>({
    loading: false,
    error: null,
    data: null,
  });
  const [dataSource, setDataSource] = useState<LocalDataSource>("cloud");

  const [cfg, setCfg] = useState<InstitutionSettings>({});

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadInstitutionSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/institution/settings", {
        cache: "no-store",
      });

      if (!res.ok) return;

      const settingsJson = await res.json().catch(() => ({}));
      setCfg({
        institution_name: settingsJson?.institution_name ?? "",
        institution_label: settingsJson?.institution_label ?? "",
        name: settingsJson?.name ?? "",
        institution_logo_url: settingsJson?.institution_logo_url ?? "",
        institution_phone: settingsJson?.institution_phone ?? "",
        institution_email: settingsJson?.institution_email ?? "",
        institution_region: settingsJson?.institution_region ?? "",
        institution_postal_address: settingsJson?.institution_postal_address ?? "",
        institution_status: settingsJson?.institution_status ?? "",
        institution_head_name: settingsJson?.institution_head_name ?? "",
        institution_head_title: settingsJson?.institution_head_title ?? "",
        country_name: settingsJson?.country_name ?? "",
        country_motto: settingsJson?.country_motto ?? "",
        ministry_name: settingsJson?.ministry_name ?? "",
        institution_code: settingsJson?.institution_code ?? "",
      });
    } catch {
      // non bloquant
    }
  }, []);

  useEffect(() => {
    void loadInstitutionSettings();
  }, [loadInstitutionSettings]);

  const loadClasses = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/classes?limit=999", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setAvailableClasses(
        Array.isArray(payload?.items) ? payload.items : [],
      );
    } catch {
      // Non bloquant : en source relais, les classes présentes dans les lignes
      // restent utilisables comme solution de repli.
    }
  }, []);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  const loadRows = useCallback(async () => {
    if (!from || !to) return;

    if (from > to) {
      setRowsState((prev) => ({
        ...prev,
        loading: false,
        error: "La date de début ne peut pas être postérieure à la date de fin.",
      }));
      return;
    }

    inFlightRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRowsState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const result = await fetchAdminAttendanceMonitor<MonitorRow>(
        from,
        to,
        controller.signal,
        educationScope,
      );
      setDataSource(result.source);
      setRowsState({
        loading: false,
        error: null,
        data: result.data.rows || [],
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;

      setRowsState((prev) => ({
        loading: false,
        error: e?.message || "Erreur lors du chargement des données.",
        data: prev.data,
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [educationScope, from, to]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const rawRows = useMemo(() => rowsState.data || [], [rowsState.data]);
  const classesFromRows = useMemo(
    () => uniqueClassesFromRows(rawRows),
    [rawRows],
  );
  const scopeClasses = useMemo(() => {
    const map = new Map<string, EducationScopedClass>();
    for (const row of [...availableClasses, ...classesFromRows]) {
      map.set(row.id, row);
    }
    return Array.from(map.values());
  }, [availableClasses, classesFromRows]);
  const rows = useMemo(
    () =>
      rawRows.filter((row) =>
        rowMatchesScope(row, educationScope, scopeClasses),
      ),
    [educationScope, rawRows, scopeClasses],
  );
  const initialLoading = rowsState.loading && rawRows.length === 0;
  const refreshing = rowsState.loading && rawRows.length > 0;

  const educationScopeLabel = useMemo(() => {
    if (educationScope.educationType === ALL_EDUCATION_TYPES) {
      return "Tous les enseignements";
    }

    const parts: string[] = [educationTypeLabel(educationScope.educationType)];
    if (educationScope.formationCode) {
      const formation = educationContext
        .formationsFor(educationScope.educationType)
        .find((row) => row.key === educationScope.formationCode);
      parts.push(
        formation
          ? `${formation.diplomaLabel} — ${formation.name}`
          : educationScope.formationCode,
      );
    }
    if (educationScope.levelCode) {
      const level = educationContext
        .levelsFor(
          educationScope.educationType,
          educationScope.formationCode || null,
        )
        .find((row) => row.level === educationScope.levelCode);
      parts.push(level?.level_label || educationScope.levelCode);
    }
    if (educationScope.classId) {
      const classRow = scopeClasses.find(
        (row) => row.id === educationScope.classId,
      );
      parts.push(classRow ? getClassDisplayLabel(classRow) : educationScope.classId);
    }
    return parts.join(" • ");
  }, [educationContext, educationScope, scopeClasses]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;

      if (
        teacherQuery.trim() &&
        !String(r.teacher_name || "")
          .toLowerCase()
          .includes(teacherQuery.trim().toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  }, [rows, statusFilter, teacherQuery]);

  const groupedRows = useMemo(() => groupRowsBySubject(filteredRows), [filteredRows]);

  const totalMissing = rows.filter((r) => r.status === "missing").length;
  const totalLate = rows.filter((r) => r.status === "late").length;
  const totalWaiting = rows.filter((r) => r.status === "waiting").length;
  const totalOk = rows.filter((r) => r.status === "ok").length;
  const totalPendingAbsence = rows.filter((r) => r.status === "pending_absence").length;
  const totalJustified = rows.filter((r) => r.status === "justified_absence").length;

  function setToday() {
    const today = toLocalDateInputValue(new Date());
    setFrom(today);
    setTo(today);
  }

  function setThisWeek() {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    setFrom(toLocalDateInputValue(monday));
    setTo(toLocalDateInputValue(today));
  }

  function statusBadge(r: MonitorRow) {
    if (r.status === "missing") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
          <AlertTriangle className="h-3 w-3" />
          Appel manquant
        </span>
      );
    }
    if (r.status === "late") {
      const mins = typeof r.late_minutes === "number" ? r.late_minutes : null;
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          <Clock className="h-3 w-3" />
          Appel en retard {mins !== null && mins >= 0 ? `( +${mins} min )` : ""}
        </span>
      );
    }
    if (r.status === "waiting") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
          <Hourglass className="h-3 w-3" />
          Créneau en attente
        </span>
      );
    }
    if (r.status === "pending_absence") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
          <Hourglass className="h-3 w-3" />
          Demande en attente
        </span>
      );
    }
    if (r.status === "justified_absence") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
          <ShieldCheck className="h-3 w-3" />
          Absence justifiée
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        OK
      </span>
    );
  }

  function originEmoji(o?: "teacher" | "class_device" | null) {
    if (o === "class_device") return "🖥️";
    if (o === "teacher") return "📱";
    return "";
  }

  function exportPdf() {
    if (!filteredRows.length) return;

    const statusLabel =
      statusFilter === "all"
        ? "Tous les statuts"
        : statusFilter === "missing"
        ? "Appels manquants"
        : statusFilter === "late"
        ? "Appels en retard"
        : statusFilter === "waiting"
        ? "Créneaux en attente"
        : statusFilter === "pending_absence"
        ? "Demandes en attente"
        : statusFilter === "justified_absence"
        ? "Absences justifiées"
        : "Appels conformes";

    const teacherLabelText = teacherQuery.trim()
      ? `Enseignant : ${teacherQuery.trim()}`
      : "Tous les enseignants";

    const html = buildPrintHtml({
      cfg,
      from,
      to,
      statusLabel,
      teacherLabelText,
      educationScopeLabel,
      rows: filteredRows,
    });

    openPrintDocument(html);
  }

  return (
    <main className="min-h-screen bg-slate-50/80 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                Tableau de contrôle
              </p>
            <div className={`mb-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold ${
              dataSource === "cloud"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : dataSource === "relay"
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}>
              {dataSource === "cloud" ? "Cloud" : dataSource === "relay" ? "Relais local" : "Dernière vue locale"}
            </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                Surveillance des appels
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Vue simplifiée des appels manquants, retards et absences, avec
                regroupement des enseignants par matière.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void loadRows()}
                disabled={rowsState.loading}
                className="bg-slate-800 hover:bg-slate-900"
              >
                {rowsState.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {rowsState.loading ? "Actualisation..." : "Actualiser"}
              </Button>

              <Button
                type="button"
                onClick={exportPdf}
                disabled={!filteredRows.length}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <FileText className="h-4 w-4" />
                Imprimer / PDF
              </Button>
            </div>
          </div>
        </header>

        <EducationScopeFilter
          value={educationScope}
          onChange={setEducationScope}
          classes={scopeClasses}
          allowAllEducationTypes
          showLevel={educationScope.educationType !== ALL_EDUCATION_TYPES}
          showClass={educationScope.educationType !== ALL_EDUCATION_TYPES}
          classLabel="Classe (facultatif)"
          title="Filtrer la surveillance par enseignement"
        />

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-red-100 bg-red-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-red-800">
                Appels manquants
              </span>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-red-900">{totalMissing}</div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-amber-900">
                Appels en retard
              </span>
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-amber-900">{totalLate}</div>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-violet-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-violet-900">
                Créneaux en attente
              </span>
              <Hourglass className="h-5 w-5 text-violet-600" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-violet-900">
              {totalWaiting}
            </div>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-sky-900">
                Absences à valider
              </span>
              <Hourglass className="h-5 w-5 text-sky-600" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-sky-900">
              {totalPendingAbsence}
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-blue-900">
                Justifiées
              </span>
              <ShieldCheck className="h-5 w-5 text-blue-600" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-blue-900">{totalJustified}</div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-emerald-900">
                Appels conformes
              </span>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-emerald-900">{totalOk}</div>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Filter className="h-4 w-4 text-slate-500" />
              <span>Filtres</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                type="button"
                className="!px-3 !py-1.5 bg-slate-800 hover:bg-slate-900"
                onClick={setToday}
              >
                Aujourd&apos;hui
              </Button>
              <Button
                type="button"
                className="!px-3 !py-1.5 bg-slate-800 hover:bg-slate-900"
                onClick={setThisWeek}
              >
                Cette semaine
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Date de début</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Date de fin</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Statut</label>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as MonitorStatus | "all")}
              >
                <option value="all">Tous les statuts</option>
                <option value="missing">Appels manquants</option>
                <option value="late">Appels en retard</option>
                <option value="waiting">Créneaux en attente</option>
                <option value="pending_absence">Absences à valider</option>
                <option value="justified_absence">Absences justifiées</option>
                <option value="ok">Appels conformes</option>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Filtrer par enseignant
              </label>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Nom de l’enseignant"
                  value={teacherQuery}
                  onChange={(e) => setTeacherQuery(e.target.value)}
                  className="pl-8"
                />
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="mr-1">Légende :</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-red-700">
              <AlertTriangle className="h-3 w-3" /> Appel manquant
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-amber-800">
              <Clock className="h-3 w-3" /> Appel en retard
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-violet-800">
              <Hourglass className="h-3 w-3" /> Créneau en attente
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-sky-800">
              <Hourglass className="h-3 w-3" /> Absence à valider
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-blue-800">
              <ShieldCheck className="h-3 w-3" /> Absence justifiée
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> Appel conforme
            </span>
          </div>

          {refreshing && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              Actualisation en cours...
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          {initialLoading ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-sm font-medium text-slate-800">
                Chargement de la surveillance des appels...
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Veuillez patienter quelques instants.
              </p>
            </div>
          ) : rowsState.error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {rowsState.error}
            </div>
          ) : groupedRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Aucun créneau ne correspond aux filtres sélectionnés.
            </div>
          ) : (
            <div className="space-y-5">
              {groupedRows.map((group) => (
                <div
                  key={group.subject_name}
                  className="overflow-hidden rounded-2xl border border-slate-200"
                >
                  <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-slate-900">
                        {group.subject_name}
                      </h2>
                      <p className="text-sm text-slate-500">
                        {group.totals.total} créneau(x) trouvé(s)
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatPill label="Manquants" value={group.totals.missing} tone="red" />
                      <StatPill label="Retards" value={group.totals.late} tone="amber" />
                      <StatPill
                        label="Créneaux en attente"
                        value={group.totals.waiting}
                        tone="violet"
                      />
                      <StatPill
                        label="Absences à valider"
                        value={group.totals.pending_absence}
                        tone="sky"
                      />
                      <StatPill
                        label="Justifiées"
                        value={group.totals.justified_absence}
                        tone="blue"
                      />
                      <StatPill label="Conformes" value={group.totals.ok} tone="emerald" />
                    </div>
                  </div>

                  <div className="space-y-4 p-4">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">
                        Synthèse des enseignants
                      </h3>
                      <div className="overflow-auto rounded-xl border border-slate-200">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-100/90 text-slate-700">
                            <tr>
                              <th className="px-3 py-2 text-left">Enseignant</th>
                              <th className="px-3 py-2 text-left">Total</th>
                              <th className="px-3 py-2 text-left">Manquants</th>
                              <th className="px-3 py-2 text-left">Retards</th>
                              <th className="px-3 py-2 text-left">Créneaux en attente</th>
                              <th className="px-3 py-2 text-left">Absences à valider</th>
                              <th className="px-3 py-2 text-left">Justifiées</th>
                              <th className="px-3 py-2 text-left">Conformes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {group.teacher_summary.map((teacher) => (
                              <tr key={`${group.subject_name}-${teacher.teacher_name}`}>
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  {teacher.teacher_name}
                                </td>
                                <td className="px-3 py-2 text-slate-700">{teacher.total}</td>
                                <td className="px-3 py-2 text-slate-700">{teacher.missing}</td>
                                <td className="px-3 py-2 text-slate-700">{teacher.late}</td>
                                <td className="px-3 py-2 text-slate-700">{teacher.waiting}</td>
                                <td className="px-3 py-2 text-slate-700">
                                  {teacher.pending_absence}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {teacher.justified_absence}
                                </td>
                                <td className="px-3 py-2 text-slate-700">{teacher.ok}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">
                        Détail des créneaux
                      </h3>
                      <div className="overflow-auto rounded-xl border border-slate-200">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-100/90 text-slate-700">
                            <tr>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Créneau</th>
                              <th className="px-3 py-2 text-left">Classe</th>
                              <th className="px-3 py-2 text-left">Enseignant</th>
                              <th className="px-3 py-2 text-left">Statut</th>
                              <th className="px-3 py-2 text-left">Détails</th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-100">
                            {group.rows.map((r) => {
                              const statusColor =
                                r.status === "missing"
                                  ? "border-l-4 border-red-400 bg-red-50/40 hover:bg-red-50"
                                  : r.status === "late"
                                  ? "border-l-4 border-amber-400 bg-amber-50/30 hover:bg-amber-50"
                                  : r.status === "waiting"
                                  ? "border-l-4 border-violet-400 bg-violet-50/30 hover:bg-violet-50"
                                  : r.status === "pending_absence"
                                  ? "border-l-4 border-sky-400 bg-sky-50/30 hover:bg-sky-50"
                                  : r.status === "justified_absence"
                                  ? "border-l-4 border-blue-400 bg-blue-50/30 hover:bg-blue-50"
                                  : "border-l-4 border-emerald-400 bg-white hover:bg-emerald-50/60";

                              const timeRange =
                                r.planned_start && r.planned_end
                                  ? `${r.planned_start} – ${r.planned_end}`
                                  : null;

                              return (
                                <tr key={r.id} className={`transition-colors ${statusColor}`}>
                                  <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                                    {dateHumanFR(r.date)}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                                    {timeRange ?? r.period_label ?? "—"}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                                    {r.class_label || "—"}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                                    {normalizeTeacherName(r.teacher_name)}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                                    {statusBadge(r)}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {r.status === "missing" && (
                                      <span>
                                        Aucun appel détecté pour ce créneau.{" "}
                                        {originEmoji(r.opened_from)}
                                      </span>
                                    )}
                                    {r.status === "late" && (
                                      <span>
                                        Appel réalisé avec retard. {originEmoji(r.opened_from)}{" "}
                                        {typeof r.late_minutes === "number"
                                          ? `Retard estimé : ${r.late_minutes} min.`
                                          : ""}
                                      </span>
                                    )}
                                    {r.status === "waiting" && (
                                      <span>
                                        Créneau à venir ou délai d’appel encore ouvert.
                                      </span>
                                    )}
                                    {r.status === "pending_absence" && (
                                      <span>
                                        Demande d’absence soumise et en attente de validation.
                                        {r.absence_reason_label
                                          ? ` Motif : ${r.absence_reason_label}.`
                                          : ""}
                                      </span>
                                    )}
                                    {r.status === "justified_absence" && (
                                      <span>
                                        Absence approuvée par l’administration.
                                        {r.absence_reason_label
                                          ? ` Motif : ${r.absence_reason_label}.`
                                          : ""}
                                        {r.absence_admin_comment
                                          ? ` Commentaire admin : ${r.absence_admin_comment}.`
                                          : ""}
                                      </span>
                                    )}
                                    {r.status === "ok" && (
                                      <span>
                                        Appel dans les délais. {originEmoji(r.opened_from)}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
