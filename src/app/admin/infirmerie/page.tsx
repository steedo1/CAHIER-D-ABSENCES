// src/app/admin/infirmerie/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  HeartPulse,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

type ClassRow = {
  id: string;
  label?: string | null;
  name?: string | null;
  level?: string | null;
  academic_year?: string | null;
};

type StudentRow = {
  id: string;
  full_name: string;
  matricule?: string | null;
  class_id: string;
  class_label?: string | null;
};

type InfirmaryVisit = {
  id: string;
  student_id: string;
  class_id: string | null;
  receipt_code: string;
  visit_date: string;
  entry_time: string;
  exit_time: string | null;
  duration_minutes: number | null;
  reason_category: string;
  reason_details: string | null;
  action_taken: string | null;
  status: string;
  notify_parent_requested: boolean;
  parent_notified: boolean;
  parent_notified_at: string | null;
  notification_count: number;
  notes: string | null;
  created_at: string;
  student_name: string;
  student_matricule: string | null;
  class_label: string | null;
  class_level: string | null;
};

type ApiList<T> = { ok?: boolean; items?: T[]; error?: string };

type SaveResponse = {
  ok?: boolean;
  item?: InfirmaryVisit;
  error?: string;
  message?: string;
  notification?: {
    queued: number;
    push_dispatched: boolean;
    sms_dispatched: boolean;
  };
};

const REASONS = [
  { value: "malaise", label: "Malaise" },
  { value: "douleur", label: "Douleur / plainte" },
  { value: "blessure_legere", label: "Blessure légère" },
  { value: "fatigue", label: "Fatigue" },
  { value: "prise_traitement", label: "Prise de traitement signalée" },
  { value: "controle", label: "Contrôle / observation" },
  { value: "autre", label: "Autre" },
];

const STATUSES = [
  { value: "observation", label: "En observation" },
  { value: "retour_classe", label: "Retourné en classe" },
  { value: "parent_informe", label: "Parent informé" },
  { value: "evacue", label: "Évacué / pris en charge" },
  { value: "cloture", label: "Clôturé" },
];

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[
        "min-h-[88px] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function labelFor(list: Array<{ value: string; label: string }>, value?: string | null) {
  return list.find((item) => item.value === value)?.label || value || "—";
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDate(ymd?: string | null) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(ymd?: string | null) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(v?: string | null) {
  if (!v) return "—";
  return String(v).slice(0, 5);
}

function durationLabel(minutes?: number | null) {
  const n = Number(minutes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

function statusClasses(status: string) {
  switch (status) {
    case "retour_classe":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "parent_informe":
      return "bg-sky-50 text-sky-800 ring-sky-200";
    case "evacue":
      return "bg-red-50 text-red-800 ring-red-200";
    case "cloture":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-amber-50 text-amber-800 ring-amber-200";
  }
}

function PrintReceiptButton({ visit }: { visit: InfirmaryVisit }) {
  function handlePrint() {
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return;

    const receiptHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Reçu infirmerie ${visit.receipt_code}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
            .receipt { border: 2px solid #0f172a; padding: 24px; border-radius: 14px; }
            .top { display: flex; justify-content: space-between; gap: 20px; border-bottom: 1px solid #cbd5e1; padding-bottom: 14px; margin-bottom: 18px; }
            .title { font-size: 22px; font-weight: 800; text-transform: uppercase; }
            .code { font-size: 16px; font-weight: 800; color: #047857; }
            .muted { color: #475569; font-size: 12px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 22px; }
            .box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
            .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px; }
            .value { font-size: 15px; font-weight: 700; }
            .wide { grid-column: 1 / -1; }
            .note { margin-top: 18px; padding: 12px; border-left: 4px solid #10b981; background: #ecfdf5; font-size: 13px; line-height: 1.45; }
            .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 46px; }
            .sig { border-top: 1px solid #0f172a; padding-top: 8px; text-align: center; font-size: 12px; color: #334155; }
            @media print { body { margin: 18mm; } .receipt { break-inside: avoid; } }
          </style>
        </head>
        <body>
          <div class="receipt">
            <div class="top">
              <div>
                <div class="title">Reçu de passage à l'infirmerie</div>
                <div class="muted">Mon Cahier — Pièce justificative scolaire interne</div>
              </div>
              <div style="text-align:right">
                <div class="code">${escapeHtml(visit.receipt_code)}</div>
                <div class="muted">Émis le ${escapeHtml(formatDateTime(visit.created_at))}</div>
              </div>
            </div>

            <div class="grid">
              <div class="box"><div class="label">Élève</div><div class="value">${escapeHtml(visit.student_name)}</div></div>
              <div class="box"><div class="label">Classe</div><div class="value">${escapeHtml(visit.class_label || "—")}</div></div>
              <div class="box"><div class="label">Matricule</div><div class="value">${escapeHtml(visit.student_matricule || "—")}</div></div>
              <div class="box"><div class="label">Date</div><div class="value">${escapeHtml(formatDate(visit.visit_date))}</div></div>
              <div class="box"><div class="label">Heure d'entrée</div><div class="value">${escapeHtml(formatTime(visit.entry_time))}</div></div>
              <div class="box"><div class="label">Heure de sortie</div><div class="value">${escapeHtml(formatTime(visit.exit_time))}</div></div>
              <div class="box"><div class="label">Durée</div><div class="value">${escapeHtml(durationLabel(visit.duration_minutes))}</div></div>
              <div class="box"><div class="label">Statut</div><div class="value">${escapeHtml(labelFor(STATUSES, visit.status))}</div></div>
              <div class="box"><div class="label">Motif général</div><div class="value">${escapeHtml(labelFor(REASONS, visit.reason_category))}</div></div>
              <div class="box"><div class="label">Parent informé</div><div class="value">${visit.parent_notified ? "Oui" : "Non"}</div></div>
              <div class="box wide"><div class="label">Action posée / observation scolaire</div><div class="value">${escapeHtml(visit.action_taken || "—")}</div></div>
              <div class="box wide"><div class="label">Précision simple</div><div class="value">${escapeHtml(visit.reason_details || "—")}</div></div>
            </div>

            <div class="note">
              Ce reçu confirme uniquement le passage de l'élève à l'infirmerie aux date et heures indiquées. Il ne justifie pas automatiquement les absences et ne modifie pas les notes. Il peut servir de pièce à l'éducateur et au professeur selon la procédure de l'établissement.
            </div>

            <div class="signatures">
              <div class="sig">Infirmerie</div>
              <div class="sig">Éducateur / Administration</div>
              <div class="sig">Parent / Responsable</div>
            </div>
          </div>
          <script>window.print(); setTimeout(() => window.close(), 500);</script>
        </body>
      </html>`;

    win.document.open();
    win.document.write(receiptHtml);
    win.document.close();
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
    >
      <Printer className="h-4 w-4" />
      Imprimer le reçu
    </button>
  );
}

function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ReceiptPreview({ visit }: { visit: InfirmaryVisit }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
            <FileText className="h-4 w-4" /> Reçu généré
          </div>
          <h2 className="mt-2 text-lg font-black text-slate-950">
            {visit.receipt_code}
          </h2>
          <p className="text-sm text-slate-600">
            Pièce justificative de passage à l'infirmerie.
          </p>
        </div>
        <PrintReceiptButton visit={visit} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Info label="Élève" value={visit.student_name} />
        <Info label="Classe" value={visit.class_label || "—"} />
        <Info label="Date" value={formatDate(visit.visit_date)} />
        <Info
          label="Heures"
          value={`${formatTime(visit.entry_time)} → ${formatTime(visit.exit_time)}`}
        />
        <Info label="Durée" value={durationLabel(visit.duration_minutes)} />
        <Info label="Statut" value={labelFor(STATUSES, visit.status)} />
        <Info label="Motif général" value={labelFor(REASONS, visit.reason_category)} />
        <Info
          label="Notification parent"
          value={visit.parent_notified ? "Envoyée / mise en file" : "Non envoyée"}
        />
        <Info className="md:col-span-2" label="Action posée" value={visit.action_taken || "—"} />
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Règle métier :</strong> ce reçu ne détecte pas les évaluations, ne justifie pas automatiquement les absences et n'annule pas les zéros. Il sert de preuve pour les traitements manuels par les personnes concernées.
      </div>
    </section>
  );
}

function Info({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={["rounded-xl border border-slate-100 bg-slate-50 px-4 py-3", className].join(" ")}>
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default function AdminInfirmaryPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [visits, setVisits] = useState<InfirmaryVisit[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<InfirmaryVisit | null>(null);

  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [visitDate, setVisitDate] = useState(todayYmd());
  const [entryTime, setEntryTime] = useState(nowTime());
  const [exitTime, setExitTime] = useState("");
  const [reasonCategory, setReasonCategory] = useState("malaise");
  const [status, setStatus] = useState("observation");
  const [reasonDetails, setReasonDetails] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [notes, setNotes] = useState("");
  const [notifyParent, setNotifyParent] = useState(true);
  const [search, setSearch] = useState("");

  const [loadingClasses, setLoadingClasses] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredVisits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter((visit) =>
      [visit.student_name, visit.class_label, visit.receipt_code, visit.student_matricule]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [search, visits]);

  async function loadClasses() {
    try {
      setLoadingClasses(true);
      const res = await fetch("/api/admin/classes", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as ApiList<ClassRow>;
      if (!res.ok) throw new Error(json.error || "Erreur chargement des classes.");
      setClasses(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || "Impossible de charger les classes.");
    } finally {
      setLoadingClasses(false);
    }
  }

  async function loadStudents(nextClassId = classId) {
    try {
      setLoadingStudents(true);
      setStudentId("");
      const params = new URLSearchParams();
      if (nextClassId) params.set("class_id", nextClassId);
      const res = await fetch(`/api/admin/students?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as ApiList<StudentRow>;
      if (!res.ok) throw new Error(json.error || "Erreur chargement des élèves.");
      setStudents(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || "Impossible de charger les élèves.");
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  }

  async function loadVisits() {
    try {
      setLoadingVisits(true);
      const res = await fetch("/api/admin/infirmary?limit=80", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as ApiList<InfirmaryVisit>;
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "Erreur chargement des passages infirmerie.");
      }
      setVisits(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || "Impossible de charger les passages infirmerie.");
      setVisits([]);
    } finally {
      setLoadingVisits(false);
    }
  }

  useEffect(() => {
    void loadClasses();
    void loadStudents("");
    void loadVisits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onClassChange(value: string) {
    setClassId(value);
    void loadStudents(value);
  }

  async function saveVisit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!studentId) {
      setError("Merci de sélectionner l'élève.");
      return;
    }
    if (!entryTime) {
      setError("Merci d'indiquer l'heure d'entrée.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/admin/infirmary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: classId,
          student_id: studentId,
          visit_date: visitDate,
          entry_time: entryTime,
          exit_time: exitTime || null,
          reason_category: reasonCategory,
          reason_details: reasonDetails,
          action_taken: actionTaken,
          status,
          notes,
          notify_parent: notifyParent,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as SaveResponse;
      if (!res.ok || json.ok === false || !json.item) {
        throw new Error(json.error || "Impossible d'enregistrer le passage.");
      }

      setSelectedVisit(json.item);
      setVisits((prev) => [json.item as InfirmaryVisit, ...prev]);
      setSuccess(json.message || "Passage infirmerie enregistré.");
      setReasonDetails("");
      setActionTaken("");
      setNotes("");
      setExitTime("");
      setEntryTime(nowTime());
      setStatus("observation");
    } catch (e: any) {
      setError(e?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-700 via-emerald-600 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-bold ring-1 ring-white/15">
              <HeartPulse className="h-4 w-4" /> Vie scolaire & sécurité
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">
              Infirmerie scolaire
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50">
              Enregistrer un passage, générer un reçu clair et notifier le parent si nécessaire. Le reçu sert ensuite de pièce justificative pour les absences ou les notes, sans automatisme risqué.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadVisits()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/12 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/20 transition hover:bg-white/18"
          >
            <RefreshCw className="h-4 w-4" /> Actualiser
          </button>
        </div>
      </header>

      <section className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <FileText className="h-4 w-4 text-emerald-600" /> Reçu officiel interne
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Date, heure d'entrée, heure de sortie, motif général, action posée et code reçu.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <Bell className="h-4 w-4 text-emerald-600" /> Notification parent
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Notification interne + push, SMS si le service est actif et si un parent est lié à l'élève.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black text-amber-950">
            <ShieldCheck className="h-4 w-4 text-amber-700" /> Pas d'automatisme dangereux
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            L'infirmerie ne détecte pas les évaluations et ne justifie rien automatiquement.
          </p>
        </div>
      </section>

      {error && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}
      {success && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-black text-slate-950">Nouveau passage</h2>
            <p className="mt-1 text-sm text-slate-600">
              Saisir uniquement les informations nécessaires au suivi scolaire. Éviter les diagnostics médicaux détaillés.
            </p>
          </div>

          <form onSubmit={saveVisit} className="space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">1</span>
                Élève concerné
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Classe
                  </span>
                  <Select value={classId} onChange={(e) => onClassChange(e.target.value)} disabled={loadingClasses}>
                    <option value="">Toutes les classes</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label || c.name || "Classe"}
                        {c.academic_year ? ` — ${c.academic_year}` : ""}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    La classe sert seulement à retrouver rapidement l'élève.
                  </p>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Élève
                  </span>
                  <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={loadingStudents} required>
                    <option value="">
                      {loadingStudents ? "Chargement..." : "Sélectionner l'élève"}
                    </option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.full_name} {student.class_label ? `— ${student.class_label}` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">2</span>
                Date et heures du passage
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Date
                  </span>
                  <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} required />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Heure d'entrée
                  </span>
                  <Input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} required />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Heure de sortie
                  </span>
                  <Input type="time" value={exitTime} onChange={(e) => setExitTime(e.target.value)} />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Facultatif si l'élève est encore en observation.
                  </p>
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">3</span>
                Reçu et information parent
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Motif général
                  </span>
                  <Select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>
                    {REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Situation à la sortie
                  </span>
                  <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Observation courte sur le reçu
                  </span>
                  <Textarea
                    value={reasonDetails}
                    onChange={(e) => setReasonDetails(e.target.value)}
                    placeholder="Ex. malaise signalé pendant la matinée, repos observé, parent contacté si nécessaire..."
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Rester simple : pas de diagnostic médical détaillé.
                  </p>
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Suite donnée
                  </span>
                  <Textarea
                    value={actionTaken}
                    onChange={(e) => setActionTaken(e.target.value)}
                    placeholder="Ex. repos, retour en classe, parent appelé, évacuation, observation prolongée..."
                  />
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={notifyParent}
                    onChange={(e) => setNotifyParent(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-black text-emerald-950">
                      Notifier le parent maintenant
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-emerald-800">
                      Une notification est envoyée dans l'espace parent, puis le push/SMS est déclenché si le téléphone du parent est enregistré et si le service est actif.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <button
                type="button"
                onClick={() => {
                  setEntryTime(nowTime());
                  setExitTime("");
                  setReasonDetails("");
                  setActionTaken("");
                  setNotes("");
                  setStatus("observation");
                  setSuccess(null);
                  setError(null);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Réinitialiser
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Enregistrer et générer le reçu
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          {selectedVisit ? (
            <ReceiptPreview visit={selectedVisit} />
          ) : (
            <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
              <Clock3 className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-3 text-base font-black text-slate-900">Aucun reçu sélectionné</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Après enregistrement, le reçu apparaîtra ici pour impression immédiate.
              </p>
            </section>
          )}
        </aside>
      </div>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">Derniers passages</h2>
            <p className="text-sm text-slate-600">Historique récent des reçus générés.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher élève, classe, reçu..."
              className="pl-9"
            />
          </div>
        </div>

        {loadingVisits ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 py-10 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des passages...
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            Aucun passage trouvé.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Reçu</th>
                  <th className="px-3 py-3">Élève</th>
                  <th className="px-3 py-3">Classe</th>
                  <th className="px-3 py-3">Date / heures</th>
                  <th className="px-3 py-3">Motif</th>
                  <th className="px-3 py-3">Statut</th>
                  <th className="px-3 py-3">Parent</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVisits.map((visit) => (
                  <tr key={visit.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-3 py-3 font-black text-emerald-700">{visit.receipt_code}</td>
                    <td className="px-3 py-3">
                      <div className="font-bold text-slate-900">{visit.student_name}</div>
                      <div className="text-xs text-slate-500">{visit.student_matricule || "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{visit.class_label || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">
                      <div>{formatDateShort(visit.visit_date)}</div>
                      <div className="text-xs text-slate-500">
                        {formatTime(visit.entry_time)} → {formatTime(visit.exit_time)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{labelFor(REASONS, visit.reason_category)}</td>
                    <td className="px-3 py-3">
                      <span className={["inline-flex rounded-full px-2 py-1 text-xs font-bold ring-1", statusClasses(visit.status)].join(" ")}>
                        {labelFor(STATUSES, visit.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {visit.parent_notified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Notifié
                        </span>
                      ) : visit.notify_parent_requested ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5" /> Non trouvé
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Non demandé</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedVisit(visit)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                      >
                        Voir reçu
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
