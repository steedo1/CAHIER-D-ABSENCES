// src/app/admin/classes/liste/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type ProfileMini = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

type StudentRow = {
  id: string;
  matricule: string | null;
  full_name: string;
  gender: string | null;
  birthdate: string | null;
  birth_place: string | null;
  nationality: string | null;
  is_repeater: boolean | null;
  enrollment_start_date: string | null;
};

type ClassListPayload = {
  ok?: boolean;
  class: {
    id: string;
    label: string;
    level: string | null;
    code: string | null;
    academic_year: string | null;
  };
  academic_year: {
    code: string | null;
    label: string | null;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
  };
  institution: {
    id: string;
    name: string;
    acronym: string | null;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
    regional_direction: string | null;
    postal_address: string | null;
    status: string | null;
    head_name: string | null;
    head_title: string | null;
    country_name: string | null;
    country_motto: string | null;
    ministry_name: string | null;
    code: string | null;
  };
  staff: {
    head_teacher: ProfileMini | null;
    educators: ProfileMini[];
  };
  students: StudentRow[];
  totals: {
    students: number;
    girls: number;
    boys: number;
  };
};

function formatDateFR(value: string | null | undefined) {
  if (!value) return "";
  const raw = String(value).slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function sexShort(value: string | null | undefined) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m") || v.startsWith("h")) return "M";
  return v.slice(0, 1).toUpperCase();
}

function nationalityShort(value: string | null | undefined) {
  const v = String(value || "").trim();
  if (!v) return "";
  const n = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (n.includes("ivoir")) return "IV";
  if (["ci", "civ", "iv"].includes(n)) return "IV";
  return v.length <= 4 ? v.toUpperCase() : v.slice(0, 3).toUpperCase();
}

function personLabel(person: ProfileMini | null | undefined) {
  if (!person) return "À renseigner";
  return String(person.display_name || person.email || person.phone || "À renseigner").trim() || "À renseigner";
}

function buildAcademicYearLabel(data: ClassListPayload | null) {
  if (!data) return "—";
  return (
    String(data.academic_year?.label || "").trim() ||
    String(data.academic_year?.code || "").trim() ||
    String(data.class?.academic_year || "").trim() ||
    "—"
  );
}

function todayLabel() {
  return new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function ClassListPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const classId = String(params?.id || "").trim();

  const [data, setData] = useState<ClassListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [educatorName, setEducatorName] = useState("");
  const [customEducatorName, setCustomEducatorName] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!classId) return;
      setLoading(true);
      setError(null);

      try {
        const sp = new URLSearchParams(window.location.search);
        const academicYear = String(sp.get("academic_year") || "").trim();
        const qs = academicYear ? `?academic_year=${encodeURIComponent(academicYear)}` : "";
        const res = await fetch(`/api/admin/classes/${encodeURIComponent(classId)}/roster${qs}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));

        if (res.status === 401) {
          throw new Error("Session expirée. Reconnectez-vous puis réessayez.");
        }
        if (!res.ok) {
          throw new Error(json?.error || "Impossible de charger la liste de classe.");
        }
        if (!alive) return;

        setData(json as ClassListPayload);
        const educators = Array.isArray(json?.staff?.educators) ? json.staff.educators : [];
        if (educators.length === 1) {
          setEducatorName(personLabel(educators[0]));
        } else {
          setEducatorName("");
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Erreur de chargement.");
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [classId]);

  const selectedEducator = useMemo(() => {
    const custom = customEducatorName.trim();
    if (custom) return custom;
    return educatorName.trim() || "À renseigner";
  }, [customEducatorName, educatorName]);

  const academicYearLabel = buildAcademicYearLabel(data);
  const headTeacherLabel = personLabel(data?.staff?.head_teacher);
  const students = data?.students || [];

  function printPdf() {
    setTimeout(() => window.print(), 60);
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-950 print:bg-white print:p-0">
      <style jsx global>{`
        @page {
          size: A4 landscape;
          margin: 7mm;
        }

        .class-list-sheet {
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
          background: white;
          color: #111827;
          border: 1px solid #cbd5e1;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
          padding: 18px 20px 22px;
          font-family: Arial, Helvetica, sans-serif;
        }

        .official-header {
          display: grid;
          grid-template-columns: 34% 32% 34%;
          gap: 12px;
          align-items: start;
          margin-bottom: 12px;
        }

        .school-block {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          min-width: 0;
        }

        .school-logo {
          width: 54px;
          height: 54px;
          object-fit: contain;
          flex: 0 0 auto;
        }

        .school-name {
          font-size: 15px;
          font-weight: 800;
          line-height: 1.15;
          text-transform: none;
        }

        .school-meta,
        .right-meta,
        .staff-meta {
          font-size: 10.5px;
          line-height: 1.35;
        }

        .list-title {
          display: inline-flex;
          min-width: 260px;
          justify-content: center;
          border: 4px solid #111827;
          padding: 8px 14px;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }

        .right-meta {
          text-align: right;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
        }

        .staff-line {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
          margin: 8px 0 10px;
          border: 1px solid #94a3b8;
          background: #f8fafc;
          padding: 6px 8px;
          font-size: 11px;
        }

        .staff-line strong {
          font-weight: 800;
        }

        .roster-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 11px;
        }

        .roster-table th,
        .roster-table td {
          border: 1px solid #475569;
          padding: 4px 5px;
          vertical-align: middle;
          line-height: 1.15;
        }

        .roster-table thead th {
          background: #e5e7eb;
          text-align: center;
          font-weight: 800;
        }

        .roster-table tbody tr:nth-child(even) td {
          background: #f8fafc;
        }

        .col-no { width: 38px; text-align: center; }
        .col-matricule { width: 105px; }
        .col-name { width: auto; font-weight: 700; }
        .col-date { width: 86px; text-align: center; }
        .col-sex { width: 42px; text-align: center; }
        .col-red { width: 42px; text-align: center; }
        .col-lv2 { width: 48px; text-align: center; }
        .col-nat { width: 50px; text-align: center; }
        .col-class { width: 62px; text-align: center; font-weight: 700; }
        .col-ins { width: 92px; text-align: center; }

        .sheet-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 10px;
          font-size: 10px;
          color: #334155;
        }

        @media print {
          html,
          body {
            background: white !important;
          }

          body * {
            visibility: hidden !important;
          }

          .class-list-print-root,
          .class-list-print-root * {
            visibility: visible !important;
          }

          .class-list-print-root {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }

          .screen-toolbar,
          .screen-toolbar * {
            display: none !important;
            visibility: hidden !important;
          }

          .class-list-sheet {
            max-width: none !important;
            width: 100% !important;
            border: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
          }

          .roster-table {
            font-size: 9.8px !important;
          }

          .roster-table th,
          .roster-table td {
            padding: 3px 4px !important;
          }

          .roster-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .school-logo {
            width: 48px !important;
            height: 48px !important;
          }

          .list-title {
            font-size: 18px !important;
            padding: 7px 12px !important;
          }
        }
      `}</style>

      <div className="screen-toolbar mx-auto mb-4 flex max-w-6xl flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-lg font-semibold">Liste de classe imprimable</div>
          <div className="text-sm text-slate-600">
            Vérifiez l’éducateur de niveau puis cliquez sur « Exporter PDF ».
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 md:min-w-[520px]">
          <label className="text-xs font-medium text-slate-600">
            Éducateur de niveau
            <select
              value={educatorName}
              onChange={(e) => {
                setEducatorName(e.target.value);
                setCustomEducatorName("");
              }}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">À renseigner</option>
              {(data?.staff?.educators || []).map((educator) => {
                const label = personLabel(educator);
                return (
                  <option key={educator.id} value={label}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Saisie manuelle si besoin
            <input
              value={customEducatorName}
              onChange={(e) => setCustomEducatorName(e.target.value)}
              placeholder="Nom de l’éducateur"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Retour
          </button>
          <button
            type="button"
            onClick={printPdf}
            disabled={loading || !!error || !data}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Exporter PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mx-auto max-w-6xl rounded-2xl border bg-white p-6 text-sm text-slate-600 shadow-sm">
          Chargement de la liste…
        </div>
      ) : error ? (
        <div className="mx-auto max-w-6xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : data ? (
        <section className="class-list-print-root">
          <article className="class-list-sheet">
            <header className="official-header">
              <div className="school-block">
                {data.institution.logo_url ? (
                  <img
                    src={data.institution.logo_url}
                    alt="Logo de l’établissement"
                    className="school-logo"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <div>
                  <div className="school-name">{data.institution.name}</div>
                  <div className="school-meta">
                    {data.institution.code ? <div>Code : {data.institution.code}</div> : null}
                    {data.institution.phone ? <div>Tél : {data.institution.phone}</div> : null}
                    {data.institution.email ? <div>E-mail : {data.institution.email}</div> : null}
                    {data.institution.regional_direction ? <div>{data.institution.regional_direction}</div> : null}
                  </div>
                </div>
              </div>

              <div className="text-center">
                <div className="list-title">LISTE FONDUE {data.class.label}</div>
              </div>

              <div className="right-meta">
                <div>
                  {data.totals.students} Élève{data.totals.students > 1 ? "s" : ""}
                </div>
                <div>Année scolaire&nbsp;&nbsp;{academicYearLabel}</div>
                <div className="mt-1 text-[10px] font-normal">Classe : {data.class.label}</div>
              </div>
            </header>

            <div className="staff-line">
              <div>
                <strong>Professeur principal :</strong> {headTeacherLabel}
              </div>
              <div>
                <strong>Éducateur de niveau :</strong> {selectedEducator}
              </div>
              <div>
                <strong>Chef d’établissement :</strong> {data.institution.head_name || "À renseigner"}
              </div>
            </div>

            <table className="roster-table">
              <thead>
                <tr>
                  <th className="col-no">N°</th>
                  <th className="col-matricule">Matricule</th>
                  <th className="col-name">Nom &amp; prénoms</th>
                  <th className="col-date">Né(e) le</th>
                  <th className="col-sex">Sexe</th>
                  <th className="col-red">Red</th>
                  <th className="col-lv2">LV2</th>
                  <th className="col-nat">Nat</th>
                  <th className="col-class">Classe</th>
                  <th className="col-ins">Date inscrit°</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500">
                      Aucun élève inscrit dans cette classe.
                    </td>
                  </tr>
                ) : (
                  students.map((student, index) => (
                    <tr key={student.id}>
                      <td className="col-no">{index + 1}</td>
                      <td className="col-matricule">{student.matricule || ""}</td>
                      <td className="col-name">{student.full_name}</td>
                      <td className="col-date">{formatDateFR(student.birthdate)}</td>
                      <td className="col-sex">{sexShort(student.gender)}</td>
                      <td className="col-red">{student.is_repeater ? "R" : ""}</td>
                      <td className="col-lv2" />
                      <td className="col-nat">{nationalityShort(student.nationality)}</td>
                      <td className="col-class">{data.class.label}</td>
                      <td className="col-ins">{formatDateFR(student.enrollment_start_date)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <footer className="sheet-footer">
              <div>
                Filles : {data.totals.girls} &nbsp;|&nbsp; Garçons : {data.totals.boys}
              </div>
              <div>Document généré le {todayLabel()} via Mon Cahier</div>
            </footer>
          </article>
        </section>
      ) : null}
    </main>
  );
}
