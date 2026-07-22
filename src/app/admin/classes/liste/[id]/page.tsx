// src/app/admin/classes/liste/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  first_name?: string | null;
  last_name?: string | null;
  gender: string | null;
  birthdate: string | null;
  birth_place: string | null;
  nationality: string | null;
  is_repeater: boolean | null;
  lv2: string | null;
  is_affecte?: boolean | null;
  is_boarder?: boolean | null;
  official_track_code?: string | null;
  enrollment_start_date: string | null;
};

type ClassListPayload = {
  ok?: boolean;
  can_edit?: boolean;
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

type EditableStudent = Pick<
  StudentRow,
  | "id"
  | "first_name"
  | "last_name"
  | "matricule"
  | "gender"
  | "birthdate"
  | "birth_place"
  | "nationality"
  | "is_repeater"
  | "lv2"
  | "is_affecte"
  | "is_boarder"
  | "official_track_code"
>;

function formatDateFR(value: string | null | undefined) {
  if (!value) return "";
  const raw = String(value).slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function sexShort(value: string | null | undefined) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (!v) return "";
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m") || v.startsWith("h") || v.startsWith("g")) return "M";
  return v.slice(0, 1).toUpperCase();
}

function nationalityShort(value: string | null | undefined) {
  const v = String(value || "").trim();
  if (!v) return "";
  const n = v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (n.includes("ivoir")) return "IV";
  if (["ci", "civ", "iv"].includes(n)) return "IV";
  return v.length <= 4 ? v.toUpperCase() : v.slice(0, 3).toUpperCase();
}

function personLabel(person: ProfileMini | null | undefined) {
  if (!person) return "À renseigner";
  return (
    String(
      person.display_name || person.email || person.phone || "À renseigner",
    ).trim() || "À renseigner"
  );
}

function cleanNamePart(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveStudentNameParts(
  student: Pick<StudentRow, "full_name" | "first_name" | "last_name">,
) {
  const explicitFirstName = cleanNamePart(student.first_name);
  const explicitLastName = cleanNamePart(student.last_name);

  if (explicitFirstName || explicitLastName) {
    return {
      firstName: explicitFirstName || null,
      lastName: explicitLastName || null,
    };
  }

  const parts = cleanNamePart(student.full_name).split(/\s+/).filter(Boolean);
  return {
    firstName: parts.slice(1).join(" ") || null,
    lastName: parts[0] || null,
  };
}

function formatTraditionalStudentName(
  student: Pick<StudentRow, "full_name" | "first_name" | "last_name">,
) {
  const lastName = cleanNamePart(student.last_name).toUpperCase();
  const firstName = cleanNamePart(student.first_name);

  if (lastName && firstName) return `${lastName} ${firstName}`;
  if (lastName) return lastName;
  if (firstName) return firstName;

  return cleanNamePart(student.full_name) || "—";
}

function traditionalStudentSortKey(
  student: Pick<StudentRow, "full_name" | "first_name" | "last_name">,
) {
  const lastName = cleanNamePart(student.last_name).toUpperCase();
  const firstName = cleanNamePart(student.first_name);
  return `${lastName || cleanNamePart(student.full_name)} ${firstName}`.trim();
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

const MON_CAHIER_EXPORT_SITE = "www.mon-cahier.com";
const MON_CAHIER_EXPORT_SLOGAN =
  "La plateforme idéale pour une école connectée, l’école du futur.";

function normalizeLv2(value: string | null | undefined) {
  const v = String(value || "").trim();
  return v ? v.toUpperCase() : "";
}

const STUDENT_SERIES_OPTIONS = [
  { value: "", label: "—" },
  { value: "1ereA1", label: "1ère A1" },
  { value: "1ereA2", label: "1ère A2" },
  { value: "tleA1", label: "Tle A1" },
  { value: "tleA2", label: "Tle A2" },
  { value: "2ndeA", label: "2nde A" },
  { value: "2ndeC", label: "2nde C" },
  { value: "1ereC", label: "1ère C" },
  { value: "1ereD", label: "1ère D" },
  { value: "tleC", label: "Tle C" },
  { value: "tleD", label: "Tle D" },
];

function studentSeriesLabel(value: string | null | undefined) {
  const v = String(value || "").trim();
  return (
    STUDENT_SERIES_OPTIONS.find((option) => option.value === v)?.label || ""
  );
}

function affectationShort(value: boolean | null | undefined) {
  if (value === true) return "AFF";
  if (value === false) return "NA";
  return "";
}

function boardingShort(value: boolean | null | undefined) {
  // Convention demandée : externe = EXT ; interne = cellule vide.
  if (value === false) return "EXT";
  return "";
}

const EDITABLE_STUDENT_FIELDS: Array<keyof EditableStudent> = [
  "first_name",
  "last_name",
  "matricule",
  "gender",
  "birthdate",
  "birth_place",
  "nationality",
  "is_repeater",
  "lv2",
  "is_affecte",
  "is_boarder",
  "official_track_code",
];

function comparableEditableValue(value: unknown) {
  if (typeof value === "string")
    return value.replace(/\s+/g, " ").trim() || null;
  if (typeof value === "boolean") return value;
  return value ?? null;
}

function editableStudentChanged(
  current: EditableStudent,
  original: EditableStudent | undefined,
) {
  if (!original) return true;
  return EDITABLE_STUDENT_FIELDS.some(
    (field) =>
      comparableEditableValue(current[field]) !==
      comparableEditableValue(original[field]),
  );
}

function cloneEditable(
  students: StudentRow[],
): Record<string, EditableStudent> {
  const out: Record<string, EditableStudent> = {};
  for (const s of students) {
    const { firstName, lastName } = deriveStudentNameParts(s);
    out[s.id] = {
      id: s.id,
      first_name: firstName,
      last_name: lastName,
      matricule: s.matricule ?? null,
      gender: s.gender ?? null,
      birthdate: s.birthdate ? String(s.birthdate).slice(0, 10) : null,
      birth_place: s.birth_place ?? null,
      nationality: s.nationality ?? null,
      is_repeater: s.is_repeater ?? null,
      lv2: s.lv2 ?? null,
      is_affecte: s.is_affecte ?? null,
      is_boarder: s.is_boarder ?? null,
      official_track_code: s.official_track_code ?? null,
    };
  }
  return out;
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
  const [editable, setEditable] = useState<Record<string, EditableStudent>>({});
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showNewStudent, setShowNewStudent] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [newStudentMsg, setNewStudentMsg] = useState<string | null>(null);
  const [newStudentForm, setNewStudentForm] = useState({
    last_name: "",
    first_name: "",
    matricule: "",
    is_affecte: "",
    is_boarder: "",
  });

  async function load() {
    if (!classId) return;
    setLoading(true);
    setError(null);

    try {
      const sp = new URLSearchParams(window.location.search);
      const academicYear = String(sp.get("academic_year") || "").trim();
      const qs = academicYear
        ? `?academic_year=${encodeURIComponent(academicYear)}`
        : "";
      const res = await fetch(
        `/api/admin/classes/${encodeURIComponent(classId)}/roster${qs}`,
        {
          cache: "no-store",
        },
      );
      const json = await res.json().catch(() => ({}));

      if (res.status === 401)
        throw new Error("Session expirée. Reconnectez-vous puis réessayez.");
      if (!res.ok)
        throw new Error(
          json?.error || "Impossible de charger la liste de classe.",
        );

      setData(json as ClassListPayload);
      setEditable(
        cloneEditable(Array.isArray(json?.students) ? json.students : []),
      );
      const educators = Array.isArray(json?.staff?.educators)
        ? json.staff.educators
        : [];
      if (educators.length === 1) setEducatorName(personLabel(educators[0]));
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const selectedEducator = useMemo(() => {
    const custom = customEducatorName.trim();
    if (custom) return custom;
    return educatorName.trim() || "À renseigner";
  }, [customEducatorName, educatorName]);

  const academicYearLabel = buildAcademicYearLabel(data);
  const headTeacherLabel = personLabel(data?.staff?.head_teacher);
  const students = data?.students || [];
  const canEdit = data?.can_edit !== false;

  const printedStudents = useMemo(
    () =>
      students
        .map((student) => ({
          ...student,
          ...(editable[student.id] || {}),
        }))
        .sort((a, b) =>
          traditionalStudentSortKey(a).localeCompare(
            traditionalStudentSortKey(b),
            "fr",
            {
              sensitivity: "base",
              numeric: true,
            },
          ),
        ),
    [students, editable],
  );

  function updateStudent(id: string, patch: Partial<EditableStudent>) {
    setEditable((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { id }),
        id,
        ...patch,
      },
    }));
  }

  async function createMinimalStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canEdit) return;

    const lastName = newStudentForm.last_name.replace(/\s+/g, " ").trim();
    const firstName = newStudentForm.first_name.replace(/\s+/g, " ").trim();
    const matricule = newStudentForm.matricule.replace(/\s+/g, " ").trim();
    const affectationValue = String(newStudentForm.is_affecte || "").trim();
    const boardingValue = String(newStudentForm.is_boarder || "").trim();

    if (!lastName || !firstName) {
      setNewStudentMsg("Le nom et le prénom sont obligatoires.");
      return;
    }
    if (!affectationValue || !boardingValue) {
      setNewStudentMsg(
        "Choisis aussi Affecté/Non affecté et Interne/Externe avant d’inscrire l’élève.",
      );
      return;
    }

    setCreatingStudent(true);
    setNewStudentMsg(null);
    try {
      const res = await fetch(
        `/api/admin/classes/${encodeURIComponent(classId)}/roster`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            last_name: lastName,
            first_name: firstName,
            matricule: matricule || null,
            is_affecte: affectationValue === "true",
            is_boarder: boardingValue === "true",
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(json?.error || "Impossible d’inscrire l’élève.");

      setNewStudentForm({
        last_name: "",
        first_name: "",
        matricule: "",
        is_affecte: "",
        is_boarder: "",
      });
      setShowNewStudent(false);
      const chargesCreated = Number(json?.charges_created || 0);
      const financeWarning = json?.finance_warning
        ? ` Alerte finance : ${json.finance_warning}`
        : "";
      setNewStudentMsg(
        `Élève inscrit dans la classe. ${chargesCreated} dette(s) générée(s). La liste est à jour.${financeWarning}`,
      );
      await load();
    } catch (e: any) {
      setNewStudentMsg(e?.message || "Erreur pendant l’inscription.");
    } finally {
      setCreatingStudent(false);
    }
  }

  async function saveCorrections() {
    if (!data || !canEdit) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const originalEditable = cloneEditable(
        Array.isArray(data.students) ? data.students : [],
      );
      const updates = (Object.values(editable) as EditableStudent[])
        .filter((row) => editableStudentChanged(row, originalEditable[row.id]))
        .map((row) => ({
          student_id: row.id,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          matricule: row.matricule || null,
          gender: row.gender || null,
          birthdate: row.birthdate || null,
          birth_place: row.birth_place || null,
          nationality: row.nationality || null,
          is_repeater: row.is_repeater,
          lv2: row.lv2 || null,
          is_affecte: row.is_affecte,
          is_boarder: row.is_boarder,
          official_track_code: row.official_track_code || null,
        }));

      const forceFinanceSync = updates.length === 0;
      const res = await fetch(
        `/api/admin/classes/${encodeURIComponent(classId)}/roster`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates,
            force_finance_sync: forceFinanceSync,
            student_ids: forceFinanceSync
              ? students.map((student) => student.id)
              : undefined,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          json?.error || "Impossible d’enregistrer les corrections.",
        );

      const financeSync = json?.finance_sync || {};
      const classMoves = Number(json?.class_moves || 0);
      const financeChanges =
        classMoves +
        Number(financeSync.inserted || 0) +
        Number(financeSync.reactivated || 0) +
        Number(financeSync.cancelled || 0) +
        Number(financeSync.settledPaid || 0) +
        Number(financeSync.updatedAmount || 0) +
        Number(financeSync.retargeted || 0);
      const warnings = Array.isArray(json?.finance_warnings)
        ? json.finance_warnings
        : [];

      setSaveMsg(
        [
          updates.length > 0
            ? `Corrections enregistrées (${updates.length} élève(s)). La liste PDF est à jour.`
            : "Aucune modification d’identité détectée. La finance de la classe a été resynchronisée.",
          classMoves > 0
            ? `${classMoves} élève(s) transféré(s) vers la classe correspondant à la nouvelle série ; les encaissements et reçus existants ont été conservés.`
            : null,
          financeChanges > 0
            ? `Finance synchronisée : ${Number(financeSync.inserted || 0)} dette(s) créée(s), ${Number(financeSync.retargeted || 0)} dette(s) adaptée(s) au nouveau statut, ${Number(financeSync.reactivated || 0)} réactivée(s), ${Number(financeSync.updatedAmount || 0)} montant(s) restauré(s), ${Number(financeSync.cancelled || 0)} annulée(s), ${Number(financeSync.settledPaid || 0)} dette(s) soldée(s) automatiquement.`
            : "Finance vérifiée : aucune dette à ajuster.",
          Number(financeSync.skippedPaid || 0) > 0
            ? `${Number(financeSync.skippedPaid || 0)} dette(s) déjà encaissée(s) conservée(s).`
            : null,
          warnings.length > 0 ? `Alerte finance : ${warnings[0]}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      await load();
    } catch (e: any) {
      setSaveMsg(e?.message || "Erreur d’enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  function printPdf() {
    setTimeout(() => window.print(), 60);
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-950 print:bg-white print:p-0">
      <style jsx global>{`
        @page {
          size: A4 landscape;
          margin: 6mm;
        }

        .class-list-sheet {
          width: 100%;
          max-width: 1088px;
          margin: 0 auto;
          background: white;
          color: #111827;
          border: 1px solid #cbd5e1;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
          padding: 14px 18px 18px;
          font-family: Arial, Helvetica, sans-serif;
          overflow: hidden;
        }

        .official-header {
          display: grid;
          grid-template-columns: minmax(0, 39%) minmax(250px, 30%) minmax(
              0,
              31%
            );
          gap: 10px;
          align-items: start;
          margin-bottom: 10px;
        }

        .school-block {
          display: flex;
          gap: 9px;
          align-items: flex-start;
          min-width: 0;
        }

        .school-logo {
          width: 52px;
          height: 52px;
          object-fit: contain;
          flex: 0 0 auto;
        }

        .school-name {
          max-width: 100%;
          font-size: 14px;
          font-weight: 900;
          line-height: 1.1;
          text-transform: uppercase;
          overflow-wrap: anywhere;
        }

        .school-meta,
        .right-meta,
        .staff-meta {
          font-size: 9.8px;
          line-height: 1.25;
        }

        .list-title {
          display: inline-flex;
          width: 100%;
          max-width: 290px;
          justify-content: center;
          border: 4px solid #111827;
          padding: 7px 10px;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .right-meta {
          text-align: right;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.28;
        }

        .right-meta .year-line,
        .right-meta .class-line {
          display: block;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .staff-line {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
          margin: 8px 0 9px;
          border: 1px solid #94a3b8;
          background: #f8fafc;
          padding: 5px 7px;
          font-size: 10.4px;
        }

        .staff-line strong {
          font-weight: 900;
        }

        .roster-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 10.5px;
        }

        .roster-table th,
        .roster-table td {
          border: 1px solid #475569;
          padding: 3.5px 5px;
          vertical-align: middle;
          line-height: 1.12;
        }

        .roster-table thead th {
          background: #e5e7eb;
          text-align: center;
          font-weight: 900;
        }

        .roster-table tbody tr:nth-child(even) td {
          background: #f8fafc;
        }

        .col-no {
          width: 38px;
          text-align: center;
        }
        .col-matricule {
          width: 98px;
        }
        .col-name {
          width: auto;
          font-weight: 800;
        }
        .col-series {
          width: 62px;
          text-align: center;
        }
        .col-affect {
          width: 54px;
          text-align: center;
        }
        .col-board {
          width: 50px;
          text-align: center;
        }
        .col-date {
          width: 82px;
          text-align: center;
        }
        .col-sex {
          width: 38px;
          text-align: center;
        }
        .col-red {
          width: 38px;
          text-align: center;
        }
        .col-lv2 {
          width: 46px;
          text-align: center;
        }
        .col-nat {
          width: 44px;
          text-align: center;
        }

        .sheet-footer {
          display: grid;
          grid-template-columns: 1fr 1.45fr 1fr;
          align-items: end;
          gap: 12px;
          margin-top: 9px;
          padding-top: 5px;
          border-top: 1px solid #cbd5e1;
          font-size: 9.6px;
          color: #334155;
        }

        .export-brand-footer {
          text-align: center;
          line-height: 1.25;
        }

        .export-brand-site {
          font-size: 10.4px;
          font-weight: 900;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #0f172a;
        }

        .export-brand-slogan {
          margin-top: 1px;
          font-size: 9.3px;
          font-weight: 700;
          color: #475569;
        }

        .footer-right {
          text-align: right;
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
            font-size: 9.7px !important;
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
            width: 46px !important;
            height: 46px !important;
          }

          .school-name {
            font-size: 12.8px !important;
          }

          .list-title {
            font-size: 17px !important;
            padding: 6px 10px !important;
          }

          .right-meta {
            font-size: 10.4px !important;
          }
        }
      `}</style>

      <div className="screen-toolbar mx-auto mb-4 flex max-w-6xl flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-lg font-semibold">
            Liste de classe imprimable
          </div>
          <div className="text-sm text-slate-600">
            Vérifiez l’éducateur, corrigez au besoin Nom / Prénoms / Matricule /
            Série / Affecté / Interne-Externe / Sexe / Red / LV2 / Nat, puis
            exportez en PDF.
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[520px]">
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

        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setShowNewStudent((v) => !v)}
              disabled={loading || !!error || !data}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Inscrire un élève
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setShowCorrections((v) => !v)}
              disabled={loading || !!error || !data}
              className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Corriger les champs
            </button>
          ) : null}
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

      {newStudentMsg ? (
        <div className="screen-toolbar mx-auto mb-4 max-w-6xl rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900 shadow-sm">
          {newStudentMsg}
        </div>
      ) : null}

      {showNewStudent && data && canEdit ? (
        <form
          onSubmit={createMinimalStudent}
          className="screen-toolbar mx-auto mb-4 max-w-6xl rounded-2xl border bg-white p-4 shadow-sm"
        >
          <div className="mb-3">
            <div className="font-semibold">
              Inscription rapide dans cette classe
            </div>
            <div className="text-sm text-slate-600">
              Saisissez l’identité et le profil financier. Sans Affecté/Non
              affecté et Interne/Externe, les dettes ne peuvent pas être
              générées correctement.
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_0.8fr_0.75fr_0.75fr_auto] md:items-end">
            <label className="text-sm font-medium text-slate-700">
              Nom
              <input
                value={newStudentForm.last_name}
                onChange={(e) =>
                  setNewStudentForm((prev) => ({
                    ...prev,
                    last_name: e.target.value,
                  }))
                }
                required
                placeholder="Ex. KOUADIO"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm uppercase"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Prénom(s)
              <input
                value={newStudentForm.first_name}
                onChange={(e) =>
                  setNewStudentForm((prev) => ({
                    ...prev,
                    first_name: e.target.value,
                  }))
                }
                required
                placeholder="Ex. Ange Aristide"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Matricule
              <input
                value={newStudentForm.matricule}
                onChange={(e) =>
                  setNewStudentForm((prev) => ({
                    ...prev,
                    matricule: e.target.value,
                  }))
                }
                placeholder="Facultatif"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Affecté
              <select
                value={newStudentForm.is_affecte}
                onChange={(e) =>
                  setNewStudentForm((prev) => ({
                    ...prev,
                    is_affecte: e.target.value,
                  }))
                }
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="">Choisir</option>
                <option value="true">Affecté</option>
                <option value="false">Non affecté</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Internat
              <select
                value={newStudentForm.is_boarder}
                onChange={(e) =>
                  setNewStudentForm((prev) => ({
                    ...prev,
                    is_boarder: e.target.value,
                  }))
                }
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              >
                <option value="">Choisir</option>
                <option value="true">Interne</option>
                <option value="false">EXT</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={creatingStudent}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingStudent ? "Inscription…" : "Inscrire"}
            </button>
          </div>
        </form>
      ) : null}

      {showCorrections && data && canEdit ? (
        <div className="screen-toolbar mx-auto mb-4 max-w-6xl rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold">
                Corrections rapides de la liste
              </div>
              <div className="text-sm text-slate-600">
                Ces corrections mettent à jour directement l’identité de l’élève
                et les informations utiles à la liste PDF. La série sert aux
                classes communes A1/A2 ; affectation et internat alimentent
                aussi le profil financier de l’élève.
              </div>
            </div>
            <button
              type="button"
              onClick={saveCorrections}
              disabled={saving}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Enregistrement…" : "Enregistrer les corrections"}
            </button>
          </div>
          {saveMsg ? (
            <div className="mb-3 text-sm text-slate-700">{saveMsg}</div>
          ) : null}
          <div className="max-h-[420px] overflow-auto rounded-xl border">
            <table className="min-w-[1320px] text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Prénom(s)</th>
                  <th className="px-3 py-2 text-left">Matricule</th>
                  <th className="px-3 py-2 text-left">Série</th>
                  <th className="px-3 py-2 text-left">Affecté</th>
                  <th className="px-3 py-2 text-left">Internat</th>
                  <th className="px-3 py-2 text-left">Né(e) le</th>
                  <th className="px-3 py-2 text-left">Sexe</th>
                  <th className="px-3 py-2 text-left">Red</th>
                  <th className="px-3 py-2 text-left">LV2</th>
                  <th className="px-3 py-2 text-left">Nat</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const row = editable[student.id] || { id: student.id };
                  return (
                    <tr key={student.id} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          value={row.last_name || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              last_name: e.target.value.toUpperCase() || null,
                            })
                          }
                          placeholder="Nom"
                          className="w-[170px] rounded-lg border px-2 py-1 font-medium uppercase"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.first_name || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              first_name: e.target.value || null,
                            })
                          }
                          placeholder="Prénom(s)"
                          className="w-[210px] rounded-lg border px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.matricule || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              matricule: e.target.value.toUpperCase() || null,
                            })
                          }
                          placeholder="Matricule"
                          className="w-[125px] rounded-lg border px-2 py-1 uppercase"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.official_track_code || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              official_track_code: e.target.value || null,
                            })
                          }
                          className="w-[110px] rounded-lg border px-2 py-1"
                        >
                          {STUDENT_SERIES_OPTIONS.map((option) => (
                            <option
                              key={option.value || "empty"}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={
                            row.is_affecte === true
                              ? "true"
                              : row.is_affecte === false
                                ? "false"
                                : ""
                          }
                          onChange={(e) =>
                            updateStudent(student.id, {
                              is_affecte:
                                e.target.value === "true"
                                  ? true
                                  : e.target.value === "false"
                                    ? false
                                    : null,
                            })
                          }
                          className="w-[118px] rounded-lg border px-2 py-1"
                        >
                          <option value="">—</option>
                          <option value="true">Affecté</option>
                          <option value="false">Non affecté</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={
                            row.is_boarder === true
                              ? "true"
                              : row.is_boarder === false
                                ? "false"
                                : ""
                          }
                          onChange={(e) =>
                            updateStudent(student.id, {
                              is_boarder:
                                e.target.value === "true"
                                  ? true
                                  : e.target.value === "false"
                                    ? false
                                    : null,
                            })
                          }
                          className="w-[100px] rounded-lg border px-2 py-1"
                        >
                          <option value="">—</option>
                          <option value="true">Interne</option>
                          <option value="false">EXT</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={String(row.birthdate || "").slice(0, 10)}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              birthdate: e.target.value || null,
                            })
                          }
                          className="w-[145px] rounded-lg border px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.gender || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              gender: e.target.value || null,
                            })
                          }
                          className="w-[82px] rounded-lg border px-2 py-1"
                        >
                          <option value="">—</option>
                          <option value="M">M</option>
                          <option value="F">F</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={
                            row.is_repeater === true
                              ? "true"
                              : row.is_repeater === false
                                ? "false"
                                : ""
                          }
                          onChange={(e) =>
                            updateStudent(student.id, {
                              is_repeater:
                                e.target.value === "true"
                                  ? true
                                  : e.target.value === "false"
                                    ? false
                                    : null,
                            })
                          }
                          className="w-[92px] rounded-lg border px-2 py-1"
                        >
                          <option value="">—</option>
                          <option value="true">Oui</option>
                          <option value="false">Non</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.lv2 || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              lv2: e.target.value.toUpperCase() || null,
                            })
                          }
                          placeholder="ESP / ALL"
                          className="w-[96px] rounded-lg border px-2 py-1 uppercase"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.nationality || ""}
                          onChange={(e) =>
                            updateStudent(student.id, {
                              nationality: e.target.value || null,
                            })
                          }
                          placeholder="Ivoirienne"
                          className="w-[130px] rounded-lg border px-2 py-1"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
                    {data.institution.code ? (
                      <div>Code : {data.institution.code}</div>
                    ) : null}
                    {data.institution.phone ? (
                      <div>Tél : {data.institution.phone}</div>
                    ) : null}
                    {data.institution.email ? (
                      <div>E-mail : {data.institution.email}</div>
                    ) : null}
                    {data.institution.regional_direction ? (
                      <div>{data.institution.regional_direction}</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="text-center">
                <div className="list-title">
                  LISTE DE CLASSE {data.class.label}
                </div>
              </div>

              <div className="right-meta">
                <div>
                  {data.totals.students} Élève
                  {data.totals.students > 1 ? "s" : ""}
                </div>
                <span className="year-line">
                  Année scolaire&nbsp;: {academicYearLabel}
                </span>
                <span className="class-line">
                  Classe&nbsp;: {data.class.label}
                </span>
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
                <strong>Chef d’établissement :</strong>{" "}
                {data.institution.head_name || "À renseigner"}
              </div>
            </div>

            <table className="roster-table">
              <thead>
                <tr>
                  <th className="col-no">N°</th>
                  <th className="col-matricule">Matricule</th>
                  <th className="col-name">Nom et prénoms</th>
                  <th className="col-series">Série</th>
                  <th className="col-affect">Aff.</th>
                  <th className="col-board">Ext.</th>
                  <th className="col-date">Né(e) le</th>
                  <th className="col-sex">Sexe</th>
                  <th className="col-red">Red</th>
                  <th className="col-lv2">LV2</th>
                  <th className="col-nat">Nat</th>
                </tr>
              </thead>
              <tbody>
                {printedStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="py-8 text-center text-slate-500"
                    >
                      Aucun élève inscrit dans cette classe.
                    </td>
                  </tr>
                ) : (
                  printedStudents.map((student, index) => (
                    <tr key={student.id}>
                      <td className="col-no">{index + 1}</td>
                      <td className="col-matricule">
                        {student.matricule || ""}
                      </td>
                      <td className="col-name">
                        {formatTraditionalStudentName(student)}
                      </td>
                      <td className="col-series">
                        {studentSeriesLabel(student.official_track_code)}
                      </td>
                      <td className="col-affect">
                        {affectationShort(student.is_affecte)}
                      </td>
                      <td className="col-board">
                        {boardingShort(student.is_boarder)}
                      </td>
                      <td className="col-date">
                        {formatDateFR(student.birthdate)}
                      </td>
                      <td className="col-sex">{sexShort(student.gender)}</td>
                      <td className="col-red">
                        {student.is_repeater ? "R" : ""}
                      </td>
                      <td className="col-lv2">{normalizeLv2(student.lv2)}</td>
                      <td className="col-nat">
                        {nationalityShort(student.nationality)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <footer className="sheet-footer">
              <div>
                Filles : {data.totals.girls} &nbsp;|&nbsp; Garçons :{" "}
                {data.totals.boys}
              </div>
              <div className="export-brand-footer">
                <div className="export-brand-site">
                  {MON_CAHIER_EXPORT_SITE}
                </div>
                <div className="export-brand-slogan">
                  {MON_CAHIER_EXPORT_SLOGAN}
                </div>
              </div>
              <div className="footer-right">
                Document généré le {todayLabel()} via Mon Cahier
              </div>
            </footer>
          </article>
        </section>
      ) : null}
    </main>
  );
}
