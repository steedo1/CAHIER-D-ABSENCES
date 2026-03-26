// src/app/admin/students-by-class/page.tsx
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

/* =========================
   UI helpers
========================= */

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "white" | "slate" | "danger";
  }
) {
  const tone = props.tone ?? "emerald";

  const toneMap: Record<NonNullable<typeof tone>, string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
    white:
      "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100",
    slate: "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950",
    danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800",
  };

  const { tone: _tone, className, ...rest } = props;

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        toneMap[tone],
        className ?? "",
      ].join(" ")}
    />
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
      {children}
    </span>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;
}

/* =========================
   Types
========================= */

type ClassRow = {
  id: string;
  name: string;
  level: string;
  label?: string | null;
};

type StudentRow = {
  id: string;
  full_name: string;
  class_id: string | null;
  class_label: string | null;
  matricule?: string | null;
  level?: string | null;

  // Champs additionnels compatibles avec le bulletin
  birthdate?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  is_scholarship?: boolean | null;

  // Photo élève
  photo_url?: string | null;
  student_photo_url?: string | null;
};

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

type SearchStudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  matricule: string | null;
  class_id: string | null;
  class_label: string | null;
};

/* =========================
   Helpers
========================= */

function nomAvantPrenoms(full: string): string {
  const t = (full || "").trim().replace(/\s+/g, " ");
  if (!t) return "-";
  const parts = t.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const firsts = parts.slice(0, -1).join(" ");
  return `${last} ${firsts}`;
}

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(input: string | null | undefined) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeSlug(input: string | null | undefined) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function computeAcademicYearFromDate(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function formatDateLongFr(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString("fr-FR");
  }
}

function formatDateShortFr(dateLike: string | null | undefined) {
  if (!dateLike) return "—";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleDateString("fr-FR");
}

function institutionDisplayName(cfg: InstitutionSettings) {
  return (
    (cfg.institution_name || "").trim() ||
    (cfg.institution_label || "").trim() ||
    (cfg.name || "").trim() ||
    "Etablissement scolaire"
  );
}

function buildAttestationHtml(args: {
  cfg: InstitutionSettings;
  academicYear: string;
  rows: StudentRow[];
  fallbackClassLabel?: string;
}) {
  const { cfg, academicYear, rows, fallbackClassLabel } = args;

  const today = formatDateLongFr(new Date());

  const place =
    (cfg.institution_region || "").trim() ||
    (cfg.institution_postal_address || "").trim() ||
    "................";

  const countryName =
    (cfg.country_name || "").trim() || "REPUBLIQUE DE COTE D'IVOIRE";

  const countryMotto =
    (cfg.country_motto || "").trim() || "Union - Discipline - Travail";

  const ministryName =
    (cfg.ministry_name || "").trim() || "MINISTERE DE L'EDUCATION NATIONALE";

  const institutionName = institutionDisplayName(cfg);
  const institutionStatus = (cfg.institution_status || "").trim();
  const institutionRegion = (cfg.institution_region || "").trim();
  const institutionPostalAddress = (cfg.institution_postal_address || "").trim();
  const institutionPhone = (cfg.institution_phone || "").trim();
  const institutionEmail = (cfg.institution_email || "").trim();
  const institutionCode = (cfg.institution_code || "").trim();
  const headName = (cfg.institution_head_name || "").trim() || "Le responsable";
  const headTitle =
    (cfg.institution_head_title || "").trim() || "Chef d'etablissement";
  const logoUrl = (cfg.institution_logo_url || "").trim();

  const pages = rows.map((student, idx) => {
    const classLabel =
      (student.class_label || "").trim() ||
      (fallbackClassLabel || "").trim() ||
      "-";

    const birthDateLabel = formatDateShortFr(
      student.birthdate || student.birth_date || null
    );

    const birthPlaceLabel = (student.birth_place || "").trim() || "—";

    const scholarshipLabel =
      student.is_scholarship === true
        ? "boursier"
        : student.is_scholarship === false
        ? "non boursier"
        : "boursier / non boursier";

    const photoUrl =
      (student.photo_url || student.student_photo_url || "").trim() || "";

    const ref = `AF-${safeSlug(academicYear).toUpperCase()}-${safeSlug(
      classLabel
    ).toUpperCase()}-${String(idx + 1).padStart(4, "0")}`;

    return `
      <section class="page">
        <div class="sheet">
          <div class="sheet-border"></div>

          <header class="top">
            <div class="republic">
              <div class="country">${escapeHtml(countryName)}</div>
              <div class="motto">${escapeHtml(countryMotto)}</div>
              <div class="ministry">${escapeHtml(ministryName)}</div>
            </div>

            <div class="institution-row">
              <div class="logo-wrap">
                ${
                  logoUrl
                    ? `<img src="${escapeHtml(logoUrl)}" alt="Logo etablissement" class="logo" />`
                    : `<div class="logo-placeholder">LOGO</div>`
                }
              </div>

              <div class="institution">
                <div class="institution-name">${escapeHtml(institutionName)}</div>
                ${
                  institutionStatus
                    ? `<div class="institution-sub">${escapeHtml(institutionStatus)}</div>`
                    : ""
                }
                ${
                  institutionRegion
                    ? `<div class="institution-meta">${escapeHtml(institutionRegion)}</div>`
                    : ""
                }
                ${
                  institutionPostalAddress
                    ? `<div class="institution-meta">${escapeHtml(
                        institutionPostalAddress
                      )}</div>`
                    : ""
                }
                ${
                  institutionPhone || institutionEmail
                    ? `<div class="institution-meta">${escapeHtml(
                        [institutionPhone, institutionEmail].filter(Boolean).join(" - ")
                      )}</div>`
                    : ""
                }
                ${
                  institutionCode
                    ? `<div class="institution-meta">Code etablissement : ${escapeHtml(
                        institutionCode
                      )}</div>`
                    : ""
                }
              </div>
            </div>
          </header>

          <main class="content">
            <div class="title-wrap">
              <div class="doc-ref">Ref. : ${escapeHtml(ref)}</div>
              <h1>ATTESTATION DE FREQUENTATION</h1>
            </div>

            <p class="body">
              Je soussigné(e), <strong>${escapeHtml(headName)}</strong>,
              <strong>${escapeHtml(headTitle)}</strong> du
              <strong>${escapeHtml(institutionName)}</strong>, atteste que l'élève :
            </p>

            <div class="student-box">
              <div class="student-main">
                <div class="student-left">
                  <div class="row">
                    <span class="label">Nom et prénoms</span>
                    <span class="value">${escapeHtml(
                      nomAvantPrenoms(student.full_name || "")
                    )}</span>
                  </div>
                  <div class="row">
                    <span class="label">Matricule</span>
                    <span class="value">${escapeHtml(student.matricule || "-")}</span>
                  </div>
                  <div class="row">
                    <span class="label">Classe</span>
                    <span class="value">${escapeHtml(classLabel)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Année scolaire</span>
                    <span class="value">${escapeHtml(academicYear)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Date de naissance</span>
                    <span class="value">${escapeHtml(birthDateLabel)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Lieu de naissance</span>
                    <span class="value">${escapeHtml(birthPlaceLabel)}</span>
                  </div>
                </div>

                <div class="student-photo">
                  ${
                    photoUrl
                      ? `<img src="${escapeHtml(photoUrl)}" alt="Photo eleve" class="student-photo-img" />`
                      : `<div class="student-photo-placeholder">PHOTO</div>`
                  }
                </div>
              </div>
            </div>

            <p class="body justified">
              est régulièrement inscrit(e) dans notre établissement et y suit
              effectivement les cours en qualité de <strong>${escapeHtml(
                scholarshipLabel
              )}</strong> au titre de l'année scolaire susmentionnée.
            </p>

            <p class="body justified">
              La présente attestation lui est delivrée pour servir et valoir ce que
              de droit.
            </p>

            <div class="signature-wrap">
              <div class="signature-box">
                <div>Fait à ${escapeHtml(place)} le ${escapeHtml(today)}</div>
                <div class="signature-title">${escapeHtml(headTitle)}</div>
                <div class="signature-space"></div>
                <div class="signature-name">${escapeHtml(headName)}</div>
              </div>
            </div>
          </main>
        </div>
      </section>
    `;
  });

  return `
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Attestations de fréquentation</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
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
      font-family: "Times New Roman", Georgia, serif;
    }

    body {
      padding: 12px;
    }

    .page {
      width: 210mm;
      height: 297mm;
      margin: 0 auto 10px auto;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
    }

    .page:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    .sheet {
      position: relative;
      width: 100%;
      height: 297mm;
      background: white;
      padding: 13mm 13mm 13mm 13mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .sheet-border {
      position: absolute;
      inset: 10mm;
      border: 1.4px solid #cbd5e1;
      pointer-events: none;
    }

    .top {
      position: relative;
      z-index: 1;
      flex: 0 0 auto;
    }

    .republic {
      text-align: center;
      margin-bottom: 7mm;
    }

    .country {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }

    .motto {
      margin-top: 3px;
      font-size: 11.5px;
      font-style: italic;
    }

    .ministry {
      margin-top: 6px;
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      line-height: 1.25;
    }

    .institution-row {
      display: grid;
      grid-template-columns: 78px 1fr;
      gap: 12px;
      align-items: start;
      margin-bottom: 5mm;
    }

    .logo-wrap {
      width: 78px;
      height: 78px;
      border: 1px solid #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
    }

    .logo {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .logo-placeholder {
      font-size: 12px;
      color: #64748b;
      font-weight: 600;
    }

    .institution {
      padding-top: 2px;
    }

    .institution-name {
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      line-height: 1.15;
    }

    .institution-sub {
      margin-top: 3px;
      font-size: 11.5px;
      font-weight: 600;
    }

    .institution-meta {
      margin-top: 2px;
      font-size: 11px;
      line-height: 1.25;
    }

    .content {
      position: relative;
      z-index: 1;
      margin-top: 4mm;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .title-wrap {
      text-align: center;
      margin-bottom: 7mm;
    }

    .doc-ref {
      text-align: right;
      font-size: 11px;
      margin-bottom: 6px;
      color: #334155;
      font-family: Arial, Helvetica, sans-serif;
    }

    h1 {
      margin: 0;
      font-size: 19px;
      text-transform: uppercase;
      text-decoration: underline;
      letter-spacing: 0.4px;
    }

    .body {
      font-size: 14px;
      line-height: 1.55;
      margin: 0 0 4mm 0;
    }

    .justified {
      text-align: justify;
    }

    .student-box {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      padding: 8px 10px;
      margin: 4mm 0 5mm 0;
    }

    .student-main {
      display: grid;
      grid-template-columns: 1fr 30mm;
      gap: 10px;
      align-items: start;
    }

    .student-left {
      min-width: 0;
    }

    .student-box .row {
      display: grid;
      grid-template-columns: 42mm 1fr;
      gap: 8px;
      padding: 3px 0;
      border-bottom: 1px dashed #cbd5e1;
      font-size: 13px;
    }

    .student-box .row:last-child {
      border-bottom: none;
    }

    .student-box .label {
      font-weight: 700;
    }

    .student-box .value {
      font-weight: 600;
    }

    .student-photo {
      width: 30mm;
      height: 38mm;
      border: 1px solid #cbd5e1;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .student-photo-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .student-photo-placeholder {
      font-size: 11px;
      color: #64748b;
      font-weight: 700;
      letter-spacing: 0.4px;
    }

    .signature-wrap {
      margin-top: auto;
      display: flex;
      justify-content: flex-end;
      padding-top: 5mm;
    }

    .signature-box {
      width: 76mm;
      text-align: center;
      font-size: 13px;
      line-height: 1.45;
    }

    .signature-title {
      margin-top: 8px;
      font-weight: 700;
    }

    .signature-space {
      height: 18mm;
    }

    .signature-name {
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    @media print {
      body {
        padding: 0;
        background: white;
      }

      .page {
        margin: 0;
      }
    }
  </style>
</head>
<body>
  ${pages.join("\n")}
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () {
        try {
          window.focus();
          window.print();
        } catch (e) {}
      }, 500);
    });
  </script>
</body>
</html>
  `;
}

function openPrintDocument(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error(
      "Impossible d'ouvrir la fenetre de l'attestation. Verifiez le bloqueur de pop-up."
    );
  }

  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  };

  try {
    win.addEventListener(
      "load",
      () => {
        setTimeout(revoke, 15000);
      },
      { once: true }
    );
  } catch {
    setTimeout(revoke, 15000);
  }

  try {
    win.focus();
  } catch {}
}

/* =========================
   Page
========================= */

export default function AdminStudentsByClassPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [cfg, setCfg] = useState<InstitutionSettings>({});
  const [academicYear, setAcademicYear] = useState("");

  const [level, setLevel] = useState("");
  const [classId, setClassId] = useState("");
  const [q, setQ] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);
  const [authErr, setAuthErr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState<null | {
    id: string;
    first_name: string;
    last_name: string;
    matricule: string;
  }>(null);

  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"new" | "transfer">("new");
  const [assigning, setAssigning] = useState(false);

  const [form, setForm] = useState({
    new_last_name: "",
    new_first_name: "",
    new_matricule: "",
    transfer_matricule: "",
  });

  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchItems, setSearchItems] = useState<SearchStudentRow[]>([]);
  const [selectedStu, setSelectedStu] = useState<null | {
    id: string;
    first_name: string | null;
    last_name: string | null;
    matricule: string | null;
  }>(null);

  const searchAbort = useRef<AbortController | null>(null);

  function resetAssign() {
    setAssignMode("new");
    setForm({
      new_last_name: "",
      new_first_name: "",
      new_matricule: "",
      transfer_matricule: "",
    });
    setSearchQ("");
    setSearchItems([]);
    setSelectedStu(null);
  }

  async function loadInstitutionAndYears() {
    let currentYear = "";

    try {
      const [settingsRes, yearsRes] = await Promise.all([
        fetch("/api/admin/institution/settings", { cache: "no-store" }),
        fetch("/api/admin/institution/academic-years", { cache: "no-store" }),
      ]);

      if (settingsRes.status === 401 || yearsRes.status === 401) {
        setAuthErr(true);
        return;
      }

      const settingsJson = await settingsRes.json().catch(() => ({}));
      if (settingsRes.ok) {
        setCfg({
          institution_name: settingsJson?.institution_name ?? "",
          institution_label: settingsJson?.institution_label ?? "",
          name: settingsJson?.name ?? "",
          institution_logo_url: settingsJson?.institution_logo_url ?? "",
          institution_phone: settingsJson?.institution_phone ?? "",
          institution_email: settingsJson?.institution_email ?? "",
          institution_region: settingsJson?.institution_region ?? "",
          institution_postal_address:
            settingsJson?.institution_postal_address ?? "",
          institution_status: settingsJson?.institution_status ?? "",
          institution_head_name: settingsJson?.institution_head_name ?? "",
          institution_head_title: settingsJson?.institution_head_title ?? "",
          country_name: settingsJson?.country_name ?? "",
          country_motto: settingsJson?.country_motto ?? "",
          ministry_name: settingsJson?.ministry_name ?? "",
          institution_code: settingsJson?.institution_code ?? "",
        });
      }

      const yearsJson = await yearsRes.json().catch(() => ({}));
      if (yearsRes.ok && yearsJson?.ok && Array.isArray(yearsJson.items)) {
        const items = yearsJson.items as Array<{
          code?: string | null;
          start_date?: string | null;
          is_current?: boolean;
        }>;

        const mapped = items
          .map((row, idx) => ({
            id: String(idx),
            code: String(row.code || "").trim(),
            start_date: row.start_date ? String(row.start_date) : "",
            is_current: row.is_current === true,
          }))
          .filter((x) => x.code);

        mapped.sort((a, b) => {
          const ak = a.start_date || a.code;
          const bk = b.start_date || b.code;
          return ak.localeCompare(bk);
        });

        const current = mapped.find((y) => y.is_current);
        currentYear =
          current?.code ||
          mapped[mapped.length - 1]?.code ||
          computeAcademicYearFromDate();
      } else {
        currentYear = computeAcademicYearFromDate();
      }
    } catch {
      currentYear = computeAcademicYearFromDate();
    } finally {
      setAcademicYear(currentYear || computeAcademicYearFromDate());
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      try {
        const [classesRes, studentsRes] = await Promise.all([
          fetch("/api/admin/classes?limit=999", { cache: "no-store" }),
          fetch("/api/admin/students", { cache: "no-store" }),
        ]);

        if (classesRes.status === 401 || studentsRes.status === 401) {
          setAuthErr(true);
          setLoading(false);
          return;
        }

        const [classesJson, studentsJson] = await Promise.all([
          classesRes.json().catch(() => ({})),
          studentsRes.json().catch(() => ({})),
        ]);

        if (!classesRes.ok || !studentsRes.ok) {
          throw new Error(
            classesJson?.error || studentsJson?.error || "HTTP_ERROR"
          );
        }

        setClasses((classesJson.items || []) as ClassRow[]);
        setStudents((studentsJson.items || []) as StudentRow[]);

        await loadInstitutionAndYears();
      } catch (e: any) {
        setMsg(e?.message || "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const classLevelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes) {
      map.set(c.id, c.level);
    }
    return map;
  }, [classes]);

  const levels = useMemo(() => {
    return Array.from(new Set(classes.map((c) => c.level).filter(Boolean))).sort(
      (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })
    );
  }, [classes]);

  const classesOfLevel = useMemo(() => {
    return classes.filter((c) => !level || c.level === level);
  }, [classes, level]);

  const studentsFiltered = useMemo(() => {
    let list = students;

    if (level) {
      list = list.filter(
        (s) => (s.level ?? classLevelById.get(s.class_id || "") ?? "") === level
      );
    }

    if (classId) {
      list = list.filter((s) => s.class_id === classId);
    }

    if (q.trim()) {
      const k = norm(q.trim());
      list = list.filter((s) => {
        const full = s.full_name || "";
        const display = nomAvantPrenoms(full);
        return (
          norm(full).includes(k) ||
          norm(display).includes(k) ||
          norm(s.matricule ?? "").includes(k)
        );
      });
    }

    return [...list].sort((a, b) =>
      nomAvantPrenoms(a.full_name).localeCompare(
        nomAvantPrenoms(b.full_name),
        undefined,
        { sensitivity: "base" }
      )
    );
  }, [students, level, classId, q, classLevelById]);

  const total = studentsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const startIdx = (pageSafe - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageItems = studentsFiltered.slice(startIdx, endIdx);

  const pageIds = useMemo(() => pageItems.map((s) => s.id), [pageItems]);

  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const somePageSelected =
    pageIds.length > 0 && pageIds.some((id) => selectedIds.has(id));

  const selectedStudents = useMemo(() => {
    return studentsFiltered.filter((s) => selectedIds.has(s.id));
  }, [studentsFiltered, selectedIds]);

  useEffect(() => {
    setPage(1);
  }, [level, classId, q, pageSize]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const visibleIds = new Set(studentsFiltered.map((s) => s.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [studentsFiltered]);

  useEffect(() => {
    if (assignMode !== "transfer") return;

    const k = searchQ.trim();
    if (k.length < 2) {
      setSearchItems([]);
      setSelectedStu(null);
      return;
    }

    setSearchBusy(true);
    searchAbort.current?.abort();

    const ctrl = new AbortController();
    searchAbort.current = ctrl;

    const tid = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/students/search?q=${encodeURIComponent(k)}`,
          { signal: ctrl.signal }
        );
        const json = await res.json().catch(() => ({}));

        if (res.ok) {
          setSearchItems(Array.isArray(json?.items) ? json.items : []);
        } else {
          setSearchItems([]);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setSearchItems([]);
        }
      } finally {
        setSearchBusy(false);
      }
    }, 250);

    return () => {
      clearTimeout(tid);
      ctrl.abort();
    };
  }, [assignMode, searchQ]);

  function toggleStudentSelection(studentId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(studentId);
      else next.delete(studentId);
      return next;
    });
  }

  function toggleSelectAllPage(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openEdit(student: StudentRow) {
    const parts = (student.full_name || "").trim().split(/\s+/);
    const first_name = parts[0] ?? "";
    const last_name = parts.slice(1).join(" ");

    setEditing({
      id: student.id,
      first_name,
      last_name,
      matricule: student.matricule || "",
    });
  }

  async function saveEdit() {
    if (!editing) return;

    setSaving(true);
    setMsg(null);

    try {
      const res = await fetch(
        `/api/admin/students/${encodeURIComponent(editing.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: editing.first_name || null,
            last_name: editing.last_name || null,
            matricule: editing.matricule || null,
          }),
        }
      );

      const json = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setAuthErr(true);
        return;
      }

      if (!res.ok) throw new Error(json?.error || "SAVE_FAILED");

      setStudents((prev) =>
        prev.map((s) =>
          s.id === editing.id
            ? {
                ...s,
                full_name:
                  [editing.first_name, editing.last_name]
                    .filter(Boolean)
                    .join(" ") || s.full_name,
                matricule: editing.matricule || null,
              }
            : s
        )
      );

      setEditing(null);
      setMsg("Eleve mis a jour");
    } catch (e: any) {
      setMsg(e?.message || "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function removeFromClass(student: StudentRow) {
    if (!student.class_id) return;

    const ok = window.confirm(
      `Retirer ${nomAvantPrenoms(student.full_name)} de la classe ${
        student.class_label ?? ""
      } ?`
    );

    if (!ok) return;

    setRemovingId(student.id);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/enrollments/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: student.class_id, student_id: student.id }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setAuthErr(true);
        return;
      }

      if (!res.ok) throw new Error(json?.error || "REMOVE_FAILED");

      setStudents((prev) =>
        prev.map((x) =>
          x.id === student.id ? { ...x, class_id: null, class_label: null } : x
        )
      );

      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(student.id);
        return next;
      });

      setMsg("Eleve retire de la classe");
    } catch (e: any) {
      setMsg(e?.message || "Erreur lors du retrait");
    } finally {
      setRemovingId(null);
    }
  }

  function asExcelText(val: string) {
    return `="${val.replace(/"/g, '""')}"`;
  }

  function toCsvCell(v: string, sep: string) {
    if (v.includes('"') || v.includes("\n") || v.includes(sep)) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }

  function exportCsv(currentPageOnly: boolean) {
    const sep = ",";
    const eol = "\r\n";
    const rows = currentPageOnly ? pageItems : studentsFiltered;
    const baseIndex = currentPageOnly ? startIdx : 0;

    const header = ["N", "Nom complet", "Matricule", "Classe"];
    const lines: string[] = [];
    lines.push(`sep=${sep}`);
    lines.push(header.join(sep));

    rows.forEach((row, i) => {
      const numero = String(baseIndex + i + 1);
      const nomComplet = nomAvantPrenoms(row.full_name || "");
      const matricule = row.matricule ? asExcelText(row.matricule) : "";
      const classe = row.class_label ? asExcelText(row.class_label) : "";

      lines.push(
        [
          toCsvCell(numero, sep),
          toCsvCell(nomComplet, sep),
          matricule,
          classe,
        ].join(sep)
      );
    });

    const csv = "\uFEFF" + lines.join(eol);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    const cls = classes.find((c) => c.id === classId);
    const filename =
      (cls
        ? `eleves_${(cls.name || cls.label || "classe").replace(/\s+/g, "_")}`
        : "eleves") + (q.trim() ? "_filtre" : "") + ".csv";

    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }

  async function generateAttestations(rows: StudentRow[], label: string) {
    if (!rows.length) {
      setMsg(`Aucun eleve pour ${label}.`);
      return;
    }

    setDocsLoading(true);
    setMsg(null);

    try {
      const cls = classes.find((c) => c.id === classId);

      const html = buildAttestationHtml({
        cfg,
        academicYear: academicYear || computeAcademicYearFromDate(),
        rows,
        fallbackClassLabel: cls?.name || cls?.label || "",
      });

      openPrintDocument(html);

      setMsg(
        `${rows.length} attestation${rows.length > 1 ? "s" : ""} prete${
          rows.length > 1 ? "s" : ""
        } a imprimer`
      );
    } catch (e: any) {
      setMsg(e?.message || "Impossible de generer les attestations");
    } finally {
      setDocsLoading(false);
    }
  }

  function chooseStudent(it: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    matricule: string | null;
  }) {
    setSelectedStu(it);
    setForm((f) => ({ ...f, transfer_matricule: it.matricule || "" }));
  }

  async function submitAssign() {
    if (!classId) {
      setMsg("Choisissez d'abord une classe.");
      return;
    }

    setAssigning(true);
    setMsg(null);

    try {
      let body: any;

      if (assignMode === "new") {
        const first_name = form.new_first_name.trim();
        const last_name = form.new_last_name.trim();
        const matricule = form.new_matricule.trim();

        if (!first_name && !last_name) {
          throw new Error("Renseignez au moins le nom ou les prenoms.");
        }

        body = {
          action: "create_and_assign",
          class_id: classId,
          first_name: first_name || null,
          last_name: last_name || null,
          matricule: matricule || null,
        };
      } else {
        if (selectedStu?.id && !form.transfer_matricule.trim()) {
          body = {
            action: "assign",
            class_id: classId,
            student_id: selectedStu.id,
          };
        } else {
          const matr = form.transfer_matricule.trim();
          if (!matr) {
            throw new Error(
              "Renseignez un matricule ou selectionnez un eleve dans la recherche."
            );
          }

          body = {
            action: "assign",
            class_id: classId,
            matricule: matr,
          };
        }
      }

      const res = await fetch("/api/admin/enrollments/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setAuthErr(true);
        return;
      }

      if (!res.ok) throw new Error(json?.error || "ASSIGN_FAILED");

      const stu = json?.student as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        matricule: string | null;
      };

      if (!stu?.id) throw new Error("Reponse incomplete: student manquant.");

      const cls = classes.find((c) => c.id === classId);
      const full =
        [stu.first_name || "", stu.last_name || ""].filter(Boolean).join(" ").trim() ||
        "-";

      setStudents((prev) => {
        const existing = prev.find((x) => x.id === stu.id);
        const class_label = cls?.name || cls?.label || null;
        const levelOfClass = cls?.level || null;

        if (existing) {
          return prev.map((x) =>
            x.id === stu.id
              ? {
                  ...x,
                  full_name: full,
                  class_id: classId,
                  class_label,
                  matricule: stu.matricule,
                  level: levelOfClass,
                }
              : x
          );
        }

        return [
          ...prev,
          {
            id: stu.id,
            full_name: full,
            class_id: classId,
            class_label,
            matricule: stu.matricule,
            level: levelOfClass,
          },
        ];
      });

      setAssignOpen(false);
      resetAssign();
      setMsg(assignMode === "new" ? "Eleve ajoute et inscrit" : "Eleve transfere");
    } catch (e: any) {
      setMsg(e?.message || "Erreur lors de l'operation");
    } finally {
      setAssigning(false);
    }
  }

  if (authErr) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-700">
            Votre session a expire.{" "}
            <a className="text-emerald-700 underline" href="/login">
              Se reconnecter
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="relative overflow-hidden rounded-3xl border border-slate-800/20 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-5 text-white shadow-sm md:px-7 md:py-6">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(60%_50%_at_100%_0%,white,transparent_70%)]" />

        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                Liste des eleves par classe
              </h1>
              <p className="mt-1 text-sm text-white/80">
                Selectionnez un niveau, choisissez la classe, recherchez,
                modifiez un eleve et generez les attestations de frequentation.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                tone="white"
                onClick={() => exportCsv(true)}
                disabled={loading || (!classId && !studentsFiltered.length)}
              >
                Exporter CSV (page)
              </Button>

              <Button
                onClick={() => exportCsv(false)}
                disabled={loading || (!classId && !studentsFiltered.length)}
              >
                Exporter CSV (tous)
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="slate"
              onClick={() => generateAttestations(selectedStudents, "la selection")}
              disabled={loading || docsLoading || selectedStudents.length === 0}
              title={
                selectedStudents.length > 0
                  ? "Generer les attestations des eleves coches"
                  : "Cochez d'abord au moins un eleve"
              }
            >
              {docsLoading ? "Generation..." : "Generer attestations selectionnees"}
              {selectedStudents.length > 0 ? ` (${selectedStudents.length})` : ""}
            </Button>

            <Button
              tone="white"
              onClick={() => generateAttestations(pageItems, "la page")}
              disabled={loading || docsLoading || pageItems.length === 0}
            >
              Attestations (page)
            </Button>

            <Button
              tone="white"
              onClick={() => generateAttestations(studentsFiltered, "tous les resultats")}
              disabled={loading || docsLoading || studentsFiltered.length === 0}
            >
              Attestations (tous)
            </Button>

            {selectedStudents.length > 0 ? (
              <Button tone="white" onClick={clearSelection} disabled={docsLoading}>
                Vider la selection
              </Button>
            ) : null}

            <div className="ml-auto flex items-center gap-2 text-xs text-white/80">
              <span>Annee scolaire :</span>
              <Badge>{academicYear || computeAcademicYearFromDate()}</Badge>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-slate-600">Niveau</div>
            <Select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                setClassId("");
              }}
            >
              <option value="">- Tous -</option>
              {levels.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-600">Classe</div>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">- Choisir -</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.label || c.id}
                </option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-600">
              Recherche (nom ou matricule)
            </div>
            <Input
              placeholder="Ex : KOUASSI / 20166309J"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
            <span>Eleves</span>
            {classId ? <Badge>{total}</Badge> : null}
            {selectedStudents.length > 0 ? (
              <Badge>{selectedStudents.length} selectionne(s)</Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="slate"
              onClick={() => setAssignOpen(true)}
              disabled={!classId || loading}
              title={
                classId
                  ? "Ajouter ou transferer un eleve dans cette classe"
                  : "Choisissez une classe d'abord"
              }
            >
              Ajouter / Transferer
            </Button>

            <span className="text-xs text-slate-600">Par page :</span>

            <Select
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-24"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>

            <div className="text-xs text-slate-600">
              Page {pageSafe} / {totalPages}
            </div>

            <Button
              tone="white"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageSafe <= 1}
            >
              {"<-"} Prec.
            </Button>

            <Button
              tone="white"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageSafe >= totalPages}
            >
              Suiv. {"->"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !classId ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
            Choisissez d'abord une <b>classe</b>.
          </div>
        ) : pageItems.length === 0 ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
            Aucun eleve pour cette page ou ce filtre.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="w-14 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = !allPageSelected && somePageSelected;
                        }
                      }}
                      onChange={(e) => toggleSelectAllPage(e.target.checked)}
                      title="Selectionner toute la page"
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>

                  <th className="w-14 px-3 py-2 text-left">N</th>
                  <th className="px-3 py-2 text-left">Nom et Prenoms</th>
                  <th className="px-3 py-2 text-left">Matricule</th>
                  <th className="px-3 py-2 text-left">Classe</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>

              <tbody>
                {pageItems.map((student, i) => {
                  const numero = startIdx + i + 1;
                  const zebra = i % 2 === 0 ? "bg-white" : "bg-slate-50";
                  const checked = selectedIds.has(student.id);

                  return (
                    <tr
                      key={student.id}
                      className={`border-t ${zebra} hover:bg-slate-100`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            toggleStudentSelection(student.id, e.target.checked)
                          }
                          className="h-4 w-4 rounded border-slate-300"
                          title={`Selectionner ${nomAvantPrenoms(student.full_name)}`}
                        />
                      </td>

                      <td className="px-3 py-2 tabular-nums">{numero}</td>
                      <td className="px-3 py-2">
                        {nomAvantPrenoms(student.full_name)}
                      </td>
                      <td className="px-3 py-2">{student.matricule || "-"}</td>
                      <td className="px-3 py-2">{student.class_label || "-"}</td>

                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            tone="white"
                            onClick={() => generateAttestations([student], "cet eleve")}
                            disabled={docsLoading}
                          >
                            Attestation
                          </Button>

                          <Button tone="white" onClick={() => openEdit(student)}>
                            Modifier
                          </Button>

                          <Button
                            tone="danger"
                            onClick={() => removeFromClass(student)}
                            disabled={!student.class_id || removingId === student.id}
                            title="Retirer l'eleve de cette classe"
                          >
                            {removingId === student.id ? "Retrait..." : "Retirer"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {msg && (
          <div className="mt-3 text-sm text-slate-700" aria-live="polite">
            {msg}
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold">Modifier l'eleve</h3>
              <button
                onClick={() => setEditing(null)}
                className="text-slate-500 hover:text-slate-700"
              >
                X
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-slate-600">Prenom(s)</div>
                <Input
                  value={editing.first_name}
                  onChange={(e) =>
                    setEditing({ ...editing, first_name: e.target.value })
                  }
                  placeholder="Ex : ANGE"
                />
              </div>

              <div>
                <div className="mb-1 text-xs text-slate-600">Nom</div>
                <Input
                  value={editing.last_name}
                  onChange={(e) =>
                    setEditing({ ...editing, last_name: e.target.value })
                  }
                  placeholder="Ex : KOUASSI"
                />
              </div>

              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-slate-600">Matricule</div>
                <Input
                  value={editing.matricule}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      matricule: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="Ex : 20166309J"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </Button>
              <Button tone="white" onClick={() => setEditing(null)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}

      {assignOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold">
                Ajouter / Transferer un eleve
              </h3>

              <button
                onClick={() => {
                  setAssignOpen(false);
                  resetAssign();
                }}
                className="text-slate-500 hover:text-slate-700"
                aria-label="Fermer"
              >
                X
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Button
                  tone={assignMode === "new" ? "emerald" : "white"}
                  onClick={() => setAssignMode("new")}
                >
                  Nouvel eleve
                </Button>

                <Button
                  tone={assignMode === "transfer" ? "emerald" : "white"}
                  onClick={() => setAssignMode("transfer")}
                >
                  Transferer
                </Button>
              </div>

              {assignMode === "new" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs text-slate-600">Nom</div>
                    <Input
                      value={form.new_last_name}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          new_last_name: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="Ex : AMON"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs text-slate-600">Prenom(s)</div>
                    <Input
                      value={form.new_first_name}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          new_first_name: e.target.value,
                        }))
                      }
                      placeholder="Ex : ANGE ARISTIDE"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="mb-1 text-xs text-slate-600">
                      Matricule <span className="text-slate-400">(optionnel)</span>
                    </div>
                    <Input
                      value={form.new_matricule}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          new_matricule: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="Ex : 20166309J"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <div className="mb-1 text-xs text-slate-600">
                      Par matricule (rapide)
                    </div>
                    <Input
                      value={form.transfer_matricule}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          transfer_matricule: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="Ex : 20166309J"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs text-slate-600">
                      Ou rechercher par nom (autocomplete global)
                    </div>
                    <Input
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder="Ex : KOUASSI, TRAORE, NGUESSAN... (min. 2 caracteres)"
                    />

                    <div className="mt-2 max-h-56 overflow-auto rounded-xl border">
                      {searchBusy ? (
                        <div className="p-3 text-sm text-slate-600">Recherche...</div>
                      ) : searchItems.length === 0 ? (
                        <div className="p-3 text-sm text-slate-500">Aucun resultat</div>
                      ) : (
                        <ul className="divide-y">
                          {searchItems.map((it) => {
                            const ln = (it.last_name || "").toUpperCase();
                            const fn = (it.first_name || "").trim();
                            const nm = [ln, fn].filter(Boolean).join(" ");

                            return (
                              <li
                                key={it.id}
                                className="flex items-center justify-between gap-2 p-2 hover:bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-medium">
                                    {nm || "-"}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {it.matricule
                                      ? `Matricule : ${it.matricule}`
                                      : "Sans matricule"}
                                    {it.class_label ? ` - Classe : ${it.class_label}` : ""}
                                  </div>
                                </div>

                                <Button tone="white" onClick={() => chooseStudent(it)}>
                                  Choisir
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {selectedStu && (
                      <div className="mt-2 text-xs text-emerald-700">
                        Selectionne : {(selectedStu.last_name || "").toUpperCase()}{" "}
                        {selectedStu.first_name || ""}{" "}
                        {selectedStu.matricule
                          ? `- ${selectedStu.matricule}`
                          : "(sans matricule)"}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-5 flex items-center gap-2">
                <Button onClick={submitAssign} disabled={assigning || !classId}>
                  {assigning
                    ? "Traitement..."
                    : assignMode === "new"
                    ? "Ajouter dans la classe"
                    : "Transferer vers la classe"}
                </Button>

                <Button
                  tone="white"
                  onClick={() => {
                    setAssignOpen(false);
                    resetAssign();
                  }}
                  disabled={assigning}
                >
                  Annuler
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}