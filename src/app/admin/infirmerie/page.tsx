// src/app/admin/infirmerie/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  HeartPulse,
  Loader2,
  Printer,
  RefreshCw,
  Search,
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
  photo_url?: string | null;
  student_photo_url?: string | null;
  class_id: string;
  class_label?: string | null;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_logo_url?: string | null;
  logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_code?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  settings_json?: Record<string, unknown> | null;
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
  condition_description?: string | null;
  rest_start_date?: string | null;
  rest_end_date?: string | null;
  rest_days?: number | null;
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
  student_photo_url?: string | null;
  photo_url?: string | null;
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
  };
};

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
        "min-h-[96px] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
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

function restLabel(visit: Pick<InfirmaryVisit, "rest_start_date" | "rest_end_date" | "rest_days">) {
  if (!visit.rest_start_date || !visit.rest_end_date) return "Aucun repos indiqué";
  const days = Number(visit.rest_days || 0);
  const daysText = days > 0 ? ` (${days} jour${days > 1 ? "s" : ""})` : "";
  return `Du ${formatDateShort(visit.rest_start_date)} au ${formatDateShort(visit.rest_end_date)}${daysText}`;
}

function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeInstitutionSettings(json: any): InstitutionSettings {
  const raw = json?.institution || json?.settings || json?.item || json || {};
  const settingsJson = raw?.settings_json || {};

  return {
    ...settingsJson,
    ...raw,
    institution_name:
      raw?.institution_name ||
      raw?.name ||
      settingsJson?.institution_name ||
      settingsJson?.name ||
      null,
    institution_logo_url:
      raw?.institution_logo_url ||
      raw?.logo_url ||
      raw?.logo ||
      settingsJson?.institution_logo_url ||
      settingsJson?.logo_url ||
      settingsJson?.logo ||
      null,
    logo_url:
      raw?.logo_url ||
      raw?.institution_logo_url ||
      settingsJson?.logo_url ||
      settingsJson?.institution_logo_url ||
      null,
    institution_phone:
      raw?.institution_phone || raw?.phone || settingsJson?.institution_phone || settingsJson?.phone || null,
    institution_email:
      raw?.institution_email || raw?.email || settingsJson?.institution_email || settingsJson?.email || null,
    institution_postal_address:
      raw?.institution_postal_address ||
      raw?.postal_address ||
      raw?.address ||
      settingsJson?.institution_postal_address ||
      settingsJson?.postal_address ||
      settingsJson?.address ||
      null,
    institution_code:
      raw?.institution_code || raw?.code || settingsJson?.institution_code || settingsJson?.code || null,
  };
}

function institutionName(institution?: InstitutionSettings | null) {
  return String(institution?.institution_name || "ÉTABLISSEMENT").trim() || "ÉTABLISSEMENT";
}

function logoUrl(institution?: InstitutionSettings | null) {
  return String(
    institution?.institution_logo_url ||
      institution?.logo_url ||
      (institution?.settings_json as any)?.institution_logo_url ||
      (institution?.settings_json as any)?.logo_url ||
      "",
  ).trim();
}

function studentPhotoUrl(visit: InfirmaryVisit) {
  return String(visit.student_photo_url || visit.photo_url || "").trim();
}

function conditionText(visit: InfirmaryVisit) {
  return String(visit.condition_description || visit.reason_details || "").trim();
}

function PrintReceiptButton({ visit, institution }: { visit: InfirmaryVisit; institution: InstitutionSettings | null }) {
  function handlePrint() {
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return;

    const instName = institutionName(institution);
    const logo = logoUrl(institution);
    const studentPhoto = studentPhotoUrl(visit);
    const phone = String(institution?.institution_phone || "").trim();
    const email = String(institution?.institution_email || "").trim();
    const address = String(institution?.institution_postal_address || "").trim();
    const code = String(institution?.institution_code || "").trim();
    const condition = conditionText(visit) || "—";
    const receiptHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Billet infirmerie ${escapeHtml(visit.receipt_code)}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; background: #f8fafc; }
            .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 18mm 16mm 14mm; position: relative; }
            .watermark { position: absolute; inset: 42mm 24mm auto; height: 150mm; opacity: 0.035; object-fit: contain; pointer-events: none; }
            .official-line { height: 5px; background: linear-gradient(90deg, #064e3b, #10b981, #d97706); border-radius: 999px; margin-bottom: 12px; }
            .header { display: grid; grid-template-columns: 76px 1fr 132px; gap: 14px; align-items: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 12px; }
            .logo { width: 74px; height: 74px; border: 1px solid #e2e8f0; border-radius: 14px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #fff; }
            .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
            .logo span { font-size: 11px; color: #64748b; font-weight: 700; }
            .student-row { display: grid; grid-template-columns: 1fr 96px; gap: 12px; align-items: stretch; margin-bottom: 10px; }
            .student-photo { width: 96px; min-height: 114px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            .student-photo img { width: 100%; height: 100%; object-fit: cover; }
            .student-photo span { color: #94a3b8; font-size: 11px; font-weight: 900; letter-spacing: .08em; }
            .school { text-align: center; }
            .school-name { font-size: 18px; line-height: 1.15; font-weight: 900; text-transform: uppercase; color: #064e3b; letter-spacing: .02em; }
            .school-meta { margin-top: 5px; font-size: 11px; line-height: 1.4; color: #475569; }
            .receipt-code { text-align: right; }
            .code-label { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 800; letter-spacing: .08em; }
            .code-value { margin-top: 4px; color: #047857; font-size: 15px; font-weight: 900; }
            .title { margin: 18px 0 14px; border: 2px solid #064e3b; border-radius: 14px; padding: 11px; text-align: center; }
            .title-main { font-size: 22px; font-weight: 900; letter-spacing: .05em; color: #064e3b; }
            .title-sub { margin-top: 3px; font-size: 12px; color: #475569; font-weight: 700; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
            .box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; background: rgba(255,255,255,.92); }
            .wide { grid-column: 1 / -1; }
            .label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 900; letter-spacing: .05em; margin-bottom: 4px; }
            .value { font-size: 14px; font-weight: 800; line-height: 1.35; color: #0f172a; white-space: pre-wrap; }
            .condition { border-left: 5px solid #059669; background: #ecfdf5; }
            .rest { border-left: 5px solid #d97706; background: #fffbeb; }
            .signature { margin-top: 46px; display: grid; grid-template-columns: 1fr 1fr; gap: 36px; align-items: end; }
            .sig-box { min-height: 78px; border-top: 1px solid #0f172a; padding-top: 8px; text-align: center; font-size: 12px; color: #334155; font-weight: 700; }
            .issued { font-size: 11px; color: #475569; line-height: 1.5; }
            .footer { position: absolute; left: 16mm; right: 16mm; bottom: 9mm; border-top: 1px solid #cbd5e1; padding-top: 5px; text-align: center; font-size: 9px; line-height: 1.35; color: #0f172a; }
            .footer .site { font-weight: 900; letter-spacing: .04em; }
            @media print {
              body { background: #fff; }
              .sheet { margin: 0; width: auto; min-height: 0; box-shadow: none; padding: 16mm 14mm 14mm; }
              @page { size: A4 portrait; margin: 0; }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            ${logo ? `<img class="watermark" src="${escapeHtml(logo)}" alt="" />` : ""}
            <div class="official-line"></div>
            <section class="header">
              <div class="logo">${logo ? `<img src="${escapeHtml(logo)}" alt="Logo" />` : "<span>Logo</span>"}</div>
              <div class="school">
                <div class="school-name">${escapeHtml(instName)}</div>
                <div class="school-meta">
                  ${escapeHtml(address)}${address && phone ? " • " : ""}${phone ? `Tél : ${escapeHtml(phone)}` : ""}${email ? ` • ${escapeHtml(email)}` : ""}${code ? `<br/>Code : ${escapeHtml(code)}` : ""}
                </div>
              </div>
              <div class="receipt-code">
                <div class="code-label">Code billet</div>
                <div class="code-value">${escapeHtml(visit.receipt_code)}</div>
                <div class="issued">Émis le ${escapeHtml(formatDateTime(visit.created_at))}</div>
              </div>
            </section>

            <section class="title">
              <div class="title-main">BILLET D'INFIRMERIE</div>
              <div class="title-sub">Passage de l'élève à l'infirmerie scolaire</div>
            </section>

            <section class="student-row">
              <div class="grid">
                <div class="box"><div class="label">Élève</div><div class="value">${escapeHtml(visit.student_name)}</div></div>
                <div class="box"><div class="label">Classe</div><div class="value">${escapeHtml(visit.class_label || "—")}</div></div>
                <div class="box"><div class="label">Matricule</div><div class="value">${escapeHtml(visit.student_matricule || "—")}</div></div>
                <div class="box"><div class="label">Date du passage</div><div class="value">${escapeHtml(formatDate(visit.visit_date))}</div></div>
              </div>
              <div class="student-photo">${studentPhoto ? `<img src="${escapeHtml(studentPhoto)}" alt="Photo élève" />` : "<span>PHOTO</span>"}</div>
            </section>

            <section class="grid">
              <div class="box"><div class="label">Heure d'entrée</div><div class="value">${escapeHtml(formatTime(visit.entry_time))}</div></div>
              <div class="box"><div class="label">Heure de sortie</div><div class="value">${escapeHtml(formatTime(visit.exit_time))}</div></div>
              <div class="box"><div class="label">Durée</div><div class="value">${escapeHtml(durationLabel(visit.duration_minutes))}</div></div>
              <div class="box"><div class="label">Alerte parent</div><div class="value">${visit.parent_notified ? "Créée" : "Non créée"}</div></div>
              <div class="box wide condition"><div class="label">Ce dont souffre l'enfant / constat</div><div class="value">${escapeHtml(condition)}</div></div>
              <div class="box wide rest"><div class="label">Repos ou congé accordé</div><div class="value">${escapeHtml(restLabel(visit))}</div></div>
            </section>

            <section class="signature">
              <div class="issued">
                Ce billet est produit comme pièce justificative du passage à l'infirmerie. Il peut être présenté à l'administration scolaire, à l'éducateur ou au professeur concerné selon la procédure de l'établissement.
              </div>
              <div class="sig-box">Signature et cachet de l'infirmerie</div>
            </section>

            <footer class="footer">
              <div class="site">www.mon-cahier.com</div>
              <div>Billet d'infirmerie généré par Mon Cahier</div>
            </footer>
          </main>
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
      Imprimer le billet
    </button>
  );
}

function ReceiptPreview({ visit, institution }: { visit: InfirmaryVisit; institution: InstitutionSettings | null }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
            <FileText className="h-4 w-4" /> Billet généré
          </div>
          <h2 className="mt-2 text-lg font-black text-slate-950">{visit.receipt_code}</h2>
          <p className="text-sm text-slate-600">Pièce justificative de passage à l'infirmerie.</p>
        </div>
        <PrintReceiptButton visit={visit} institution={institution} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-400">
            {studentPhotoUrl(visit) ? (
              <img src={studentPhotoUrl(visit)} alt="Photo élève" className="h-full w-full object-cover" />
            ) : (
              "PHOTO"
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Élève</p>
            <p className="truncate text-base font-black text-slate-950">{visit.student_name}</p>
            <p className="text-sm font-semibold text-slate-600">{visit.class_label || "—"} • Matricule : {visit.student_matricule || "—"}</p>
          </div>
        </div>
        <Info label="Date" value={formatDate(visit.visit_date)} />
        <Info label="Heures" value={`${formatTime(visit.entry_time)} → ${formatTime(visit.exit_time)}`} />
        <Info label="Durée" value={durationLabel(visit.duration_minutes)} />
        <Info label="Alerte parent" value={visit.parent_notified ? "Créée" : "Non créée"} />
        <Info className="md:col-span-2" label="Ce dont souffre l'enfant" value={conditionText(visit) || "—"} />
        <Info className="md:col-span-2" label="Repos ou congé accordé" value={restLabel(visit)} />
      </div>
    </section>
  );
}

function Info({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={["rounded-xl border border-slate-100 bg-slate-50 px-4 py-3", className].join(" ")}>
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default function AdminInfirmaryPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [visits, setVisits] = useState<InfirmaryVisit[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<InfirmaryVisit | null>(null);
  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);

  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [visitDate, setVisitDate] = useState(todayYmd());
  const [entryTime, setEntryTime] = useState(nowTime());
  const [exitTime, setExitTime] = useState("");
  const [conditionDescription, setConditionDescription] = useState("");
  const [hasRest, setHasRest] = useState(false);
  const [restStartDate, setRestStartDate] = useState(todayYmd());
  const [restEndDate, setRestEndDate] = useState(todayYmd());
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
      [
        visit.student_name,
        visit.class_label,
        visit.receipt_code,
        visit.student_matricule,
        conditionText(visit),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [search, visits]);

  async function loadInstitution() {
    try {
      const res = await fetch("/api/institution/settings", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as InstitutionSettings & { error?: string };
      if (res.ok && !json.error) setInstitution(normalizeInstitutionSettings(json));
    } catch {
      setInstitution(null);
    }
  }

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
      const res = await fetch(`/api/admin/students?${params.toString()}`, { cache: "no-store" });
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
    void loadInstitution();
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
    if (!conditionDescription.trim()) {
      setError("Merci d'indiquer ce dont souffre l'enfant ou le constat fait à l'infirmerie.");
      return;
    }
    if (hasRest && (!restStartDate || !restEndDate)) {
      setError("Merci d'indiquer les dates du repos ou congé accordé.");
      return;
    }
    if (hasRest && restEndDate < restStartDate) {
      setError("La date de fin du repos doit être après la date de début.");
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
          condition_description: conditionDescription,
          reason_details: conditionDescription,
          reason_category: "autre",
          status: exitTime ? "cloture" : "observation",
          rest_start_date: hasRest ? restStartDate : null,
          rest_end_date: hasRest ? restEndDate : null,
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
      setConditionDescription("");
      setHasRest(false);
      setRestStartDate(todayYmd());
      setRestEndDate(todayYmd());
      setExitTime("");
      setEntryTime(nowTime());
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
              <HeartPulse className="h-4 w-4" /> Vie scolaire & santé
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">Infirmerie scolaire</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50">
              Informer rapidement le parent et générer un billet d'infirmerie utilisable comme justificatif scolaire.
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
            <h2 className="text-lg font-black text-slate-950">Nouveau billet d'infirmerie</h2>
            <p className="mt-1 text-sm text-slate-600">
              Saisir le passage, le constat utile et le repos éventuel. Le billet est imprimable immédiatement.
            </p>
          </div>

          <form onSubmit={saveVisit} className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Classe</span>
              <Select value={classId} onChange={(e) => onClassChange(e.target.value)} disabled={loadingClasses}>
                <option value="">Toutes les classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label || c.name || "Classe"}
                    {c.academic_year ? ` — ${c.academic_year}` : ""}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Élève</span>
              <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={loadingStudents} required>
                <option value="">{loadingStudents ? "Chargement..." : "Sélectionner l'élève"}</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name} {student.class_label ? `— ${student.class_label}` : ""}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Date</span>
              <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} required />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Entrée</span>
                <Input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} required />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Sortie</span>
                <Input type="time" value={exitTime} onChange={(e) => setExitTime(e.target.value)} />
              </label>
            </div>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Ce dont souffre l'enfant / constat</span>
              <Textarea
                value={conditionDescription}
                onChange={(e) => setConditionDescription(e.target.value)}
                placeholder="Ex. maux de tête, fièvre signalée, douleur abdominale, blessure légère, malaise..."
                required
              />
            </label>

            <label className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 md:col-span-2">
              <input
                type="checkbox"
                checked={hasRest}
                onChange={(e) => setHasRest(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                <span className="block text-sm font-black text-amber-950">Repos ou congé accordé</span>
                <span className="mt-1 block text-xs leading-5 text-amber-800">
                  À cocher seulement si l'élève est mis au repos sur une période donnée.
                </span>
              </span>
            </label>

            {hasRest && (
              <div className="grid gap-3 rounded-2xl border border-amber-100 bg-white p-4 md:col-span-2 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Début du repos</span>
                  <Input type="date" value={restStartDate} onChange={(e) => setRestStartDate(e.target.value)} required={hasRest} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Fin du repos</span>
                  <Input type="date" value={restEndDate} onChange={(e) => setRestEndDate(e.target.value)} required={hasRest} />
                </label>
              </div>
            )}

            <label className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 md:col-span-2">
              <input
                type="checkbox"
                checked={notifyParent}
                onChange={(e) => setNotifyParent(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="block text-sm font-black text-emerald-950">Notifier le parent maintenant</span>
                <span className="mt-1 block text-xs leading-5 text-emerald-800">
                  La notification contient le motif saisi, les heures de passage, le repos éventuel et le code du billet.
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-3 md:col-span-2 md:flex-row md:items-center md:justify-end">
              <button
                type="button"
                onClick={() => {
                  setEntryTime(nowTime());
                  setExitTime("");
                  setConditionDescription("");
                  setHasRest(false);
                  setRestStartDate(todayYmd());
                  setRestEndDate(todayYmd());
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
                Enregistrer et générer le billet
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          {selectedVisit ? (
            <ReceiptPreview visit={selectedVisit} institution={institution} />
          ) : (
            <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
              <Clock3 className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-3 text-base font-black text-slate-900">Aucun billet sélectionné</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Après enregistrement, le billet apparaîtra ici pour impression immédiate.
              </p>
            </section>
          )}
        </aside>
      </div>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">Derniers passages</h2>
            <p className="text-sm text-slate-600">Historique récent des billets générés.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher élève, classe, billet..." className="pl-9" />
          </div>
        </div>

        {loadingVisits ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 py-10 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des passages...
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">Aucun passage trouvé.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Billet</th>
                  <th className="px-3 py-3">Élève</th>
                  <th className="px-3 py-3">Date / heures</th>
                  <th className="px-3 py-3">Constat</th>
                  <th className="px-3 py-3">Repos</th>
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
                      <div className="text-xs text-slate-500">{visit.class_label || "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div>{formatDateShort(visit.visit_date)}</div>
                      <div className="text-xs text-slate-500">{formatTime(visit.entry_time)} → {formatTime(visit.exit_time)}</div>
                    </td>
                    <td className="max-w-xs px-3 py-3 text-slate-700">
                      <div className="line-clamp-2">{conditionText(visit) || "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{restLabel(visit)}</td>
                    <td className="px-3 py-3">
                      {visit.parent_notified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                          <Bell className="h-3.5 w-3.5" /> Alerte créée
                        </span>
                      ) : visit.notify_parent_requested ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5" /> Non créée
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
                        Voir billet
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
