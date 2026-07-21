import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, GraduationCap, Search, School2 } from "lucide-react";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  getFinanceAccessForCurrentUser,
  getFinanceInstitutionIdForCurrentUser,
} from "@/lib/finance-access";
import { fetchFinanceChargeBalancesByClasses } from "@/lib/finance/charge-balances";
import {
  AcademicYearSelector,
  financeYearHref,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";
import {
  getAdminStudentsServer,
  type AdminStudentRow,
} from "@/lib/admin-students-server";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
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
  institution_code?: string | null;
};

type ChargeBalanceRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  student_id: string;
  class_id: string | null;
  fee_schedule_id: string | null;
  fee_category_id: string;
  label: string;
  base_amount: number | string;
  adjustment_total: number | string;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
  due_date: string | null;
  charge_date: string;
  computed_status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
  created_at: string;
  updated_at: string;
};

type StudentNoticeGroup = {
  student: AdminStudentRow | undefined;
  classRow: ClassRow | undefined;
  studentId: string;
  expected: number;
  paid: number;
  due: number;
  charges: ChargeBalanceRow[];
};

type NoticeCategorySummary = {
  label: string;
  expected: number;
  paid: number;
  due: number;
};

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

function fullName(student: AdminStudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  return student.full_name || student.matricule || "Élève sans nom";
}

function StudentPortrait({
  student,
  compact = false,
}: {
  student: AdminStudentRow | undefined;
  compact?: boolean;
}) {
  const size = compact ? "h-12 w-10" : "h-36 w-28";

  return student?.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={student.photo_url}
      alt={`Photo de ${fullName(student)}`}
      className={`parent-notice-student-photo ${size} shrink-0 rounded-2xl border-4 border-white object-cover shadow-lg ring-1 ring-slate-300`}
    />
  ) : (
    <div
      className={`parent-notice-student-photo ${size} grid shrink-0 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-slate-100 to-slate-200 shadow-lg ring-1 ring-slate-300`}
      aria-label={`Photo non disponible pour ${fullName(student)}`}
    >
      <GraduationCap
        className={
          compact ? "h-5 w-5 text-slate-400" : "h-12 w-12 text-slate-400"
        }
      />
    </div>
  );
}

function normalize(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getNoticeMainCategory(label: string) {
  const normalized = normalize(label);

  if (normalized.includes("internat") || normalized.includes("pension")) {
    return "Internat";
  }

  if (normalized.includes("renforcement")) {
    return "Cours de renforcement";
  }

  if (
    normalized.includes("kit") ||
    normalized.includes("livre") ||
    normalized.includes("cahier")
  ) {
    return "Kit livre";
  }

  if (
    normalized.includes("scolar") ||
    normalized.includes("ecolage") ||
    normalized.includes("inscription") ||
    normalized.includes("frais generaux")
  ) {
    return "Scolarité";
  }

  return "Autres frais";
}

function summarizeNoticeCharges(charges: ChargeBalanceRow[]) {
  const map = new Map<string, NoticeCategorySummary>();

  for (const charge of charges) {
    const label = getNoticeMainCategory(charge.label);
    const current = map.get(label) ?? {
      label,
      expected: 0,
      paid: 0,
      due: 0,
    };

    current.expected += Number(charge.net_amount || 0);
    current.paid += Number(charge.paid_amount || 0);
    current.due += Number(charge.balance_due || 0);
    map.set(label, current);
  }

  const order = [
    "Scolarité",
    "Internat",
    "Kit livre",
    "Cours de renforcement",
    "Autres frais",
  ];

  return Array.from(map.values()).sort((a, b) => {
    const ia = order.indexOf(a.label);
    const ib = order.indexOf(b.label);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.label.localeCompare(b.label, "fr");
  });
}

function pickInstitutionName(row: any): string {
  const direct = String(row?.name || "").trim();
  if (direct) return direct;

  const settings = row?.settings_json;
  if (settings && typeof settings === "object") {
    const fallback =
      settings.institution_name ||
      settings.school_name ||
      settings.header_title ||
      settings.name ||
      settings.label;
    return String(fallback || "").trim();
  }

  return "";
}

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

async function fetchInstitutionSettingsServer(
  admin: ServiceClient,
  institutionId: string,
): Promise<InstitutionSettings> {
  try {
    const { data, error } = await admin
      .from("institutions")
      .select(
        [
          "name",
          "logo_url",
          "phone",
          "email",
          "regional_direction",
          "postal_address",
          "status",
          "head_name",
          "head_title",
          "code",
          "settings_json",
        ].join(","),
      )
      .eq("id", institutionId)
      .maybeSingle();

    if (error || !data) return {};

    const institutionName = pickInstitutionName(data);

    return {
      institution_name: institutionName,
      institution_label: institutionName,
      name: institutionName,
      institution_logo_url: (data as any)?.logo_url ?? "",
      institution_phone: (data as any)?.phone ?? "",
      institution_email: (data as any)?.email ?? "",
      institution_region: (data as any)?.regional_direction ?? "",
      institution_postal_address: (data as any)?.postal_address ?? "",
      institution_status: (data as any)?.status ?? "",
      institution_head_name: (data as any)?.head_name ?? "",
      institution_head_title: (data as any)?.head_title ?? "",
      institution_code: (data as any)?.code ?? "",
    };
  } catch {
    return {};
  }
}

function NoticeDocument({
  group,
  schoolName,
  institutionSettings,
  selectedAcademicYearCode,
  generatedAt,
}: {
  group: StudentNoticeGroup;
  schoolName: string;
  institutionSettings: InstitutionSettings;
  selectedAcademicYearCode: string;
  generatedAt: Date;
}) {
  const student = group.student;
  const cls = group.classRow;
  const logoUrl = String(institutionSettings.institution_logo_url || "").trim();
  const classLabel = student?.class_label || cls?.label || "—";
  const summarizedCharges = summarizeNoticeCharges(group.charges);

  return (
    <article className="parent-notice-card relative overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="parent-notice-watermark pointer-events-none absolute left-1/2 top-1/2 z-0 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.045]"
        />
      ) : null}

      <div className="relative z-10 flex min-h-[270mm] flex-col px-7 py-7">
        <header className="parent-notice-header flex flex-col gap-5 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={schoolName}
                className="parent-notice-logo h-16 w-16 rounded-2xl border border-slate-200 object-contain p-2"
              />
            ) : (
              <div className="parent-notice-logo grid h-16 w-16 place-items-center rounded-2xl border border-slate-200 bg-emerald-50 text-emerald-700">
                <School2 className="h-8 w-8" />
              </div>
            )}

            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                Mon Cahier — Gestion financière
              </div>
              <h2 className="parent-notice-school mt-2 text-2xl font-black tracking-tight text-slate-900">
                {schoolName}
              </h2>
              <div className="parent-notice-meta mt-2 space-y-1 text-sm text-slate-600">
                {institutionSettings.institution_postal_address ? (
                  <div>{institutionSettings.institution_postal_address}</div>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {institutionSettings.institution_phone ? (
                    <span>Tél. : {institutionSettings.institution_phone}</span>
                  ) : null}
                  {institutionSettings.institution_email ? (
                    <span>Email : {institutionSettings.institution_email}</span>
                  ) : null}
                  {institutionSettings.institution_region ? (
                    <span>{institutionSettings.institution_region}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="parent-notice-side rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700 sm:min-w-[245px]">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Document
            </div>
            <div className="mt-2 text-xl font-black text-slate-900">
              Avis aux parents
            </div>
            <div className="mt-3 space-y-1">
              <div>
                <span className="font-semibold text-slate-900">Date :</span>{" "}
                {generatedAt.toLocaleDateString("fr-FR", {
                  dateStyle: "medium",
                })}
              </div>
              <div>
                <span className="font-semibold text-slate-900">Année :</span>{" "}
                {selectedAcademicYearCode || "—"}
              </div>
            </div>
          </div>
        </header>

        <main className="parent-notice-body flex-1 py-7">
          <h1 className="text-center text-2xl font-black uppercase tracking-[0.2em] text-slate-900">
            Avis aux parents
          </h1>

          <div className="parent-notice-intro mt-8 space-y-5 text-[15px] leading-7 text-slate-800">
            <p>Madame, Monsieur,</p>

            <p>
              Nous vous informons que la situation financière de votre enfant
              présente un solde restant dû.
            </p>
          </div>

          <section className="parent-notice-identity mt-7 rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <StudentPortrait student={student} />

              <div className="grid flex-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                    Élève
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    {fullName(student)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                    Classe
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    {classLabel}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                    Matricule
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    {student?.matricule || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                    Année scolaire
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-900">
                    {selectedAcademicYearCode || student?.academic_year || "—"}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="parent-notice-amounts mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 text-center">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                Montant attendu
              </div>
              <div className="mt-2 text-xl font-black text-slate-900">
                {formatMoney(group.expected)}
              </div>
            </div>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-4 text-center">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                Montant payé
              </div>
              <div className="mt-2 text-xl font-black text-emerald-800">
                {formatMoney(group.paid)}
              </div>
            </div>
            <div className="rounded-3xl border border-rose-200 bg-rose-50/60 p-4 text-center">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">
                Reste à payer
              </div>
              <div className="mt-2 text-xl font-black text-rose-800">
                {formatMoney(group.due)}
              </div>
            </div>
          </section>

          <section className="parent-notice-category-table mt-6 overflow-hidden rounded-3xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-100 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-700">
              Situation par grande catégorie
            </div>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-white text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3 text-right">Attendu</th>
                  <th className="px-4 py-3 text-right">Payé</th>
                  <th className="px-4 py-3 text-right">Reste</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {summarizedCharges.map((category) => (
                  <tr key={category.label}>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {category.label}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatMoney(category.expected)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatMoney(category.paid)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-rose-700">
                      {formatMoney(category.due)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="parent-notice-message mt-8 space-y-5 text-[15px] leading-7 text-slate-800">
            <p>
              Nous vous prions de bien vouloir vous rapprocher du service
              comptabilité pour régularisation.
            </p>
          </div>

          <div className="parent-notice-signature mt-12 flex justify-end">
            <div className="w-56 text-center text-sm font-black text-slate-900">
              <div>La Comptabilité</div>
              <div className="parent-notice-signature-line mt-12 border-t border-slate-400 pt-2 text-xs font-semibold text-slate-500">
                Signature / Cachet
              </div>
            </div>
          </div>
        </main>

        <footer className="parent-notice-footer border-t border-slate-200 pt-4 text-center text-[11px] font-semibold text-slate-500">
          www.mon-cahier.com — La plateforme idéale pour une école connectée,
          l’école du futur.
        </footer>
      </div>
    </article>
  );
}

export default async function FinanceParentNoticesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    class_id?: string;
    academic_year?: string;
  }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const q = String(params?.q || "").trim();
  const classIdFilter = String(params?.class_id || "").trim();
  const requestedAcademicYear = String(params?.academic_year || "").trim();

  const institutionId = await getFinanceInstitutionIdForCurrentUser();
  const admin = getSupabaseServiceClient();
  const institutionSettings = await fetchInstitutionSettingsServer(
    admin,
    institutionId,
  );
  const schoolName =
    institutionSettings.institution_name ||
    institutionSettings.name ||
    "Établissement";

  const academicYearCtx = await getFinanceAcademicYearContext(
    institutionId,
    requestedAcademicYear,
  );
  const { academicYears, selectedAcademicYearCode } = academicYearCtx;

  const adminStudents = await getAdminStudentsServer(
    selectedAcademicYearCode || undefined,
  );

  let classesQuery = admin
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId);

  if (selectedAcademicYearCode) {
    classesQuery = classesQuery.eq("academic_year", selectedAcademicYearCode);
  }

  const { data: classes, error: clsErr } = await classesQuery
    .order("level", { ascending: true })
    .order("label", { ascending: true });

  if (clsErr) throw new Error(clsErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const classIds = classIdFilter
    ? [classIdFilter]
    : classRows.map((row) => row.id);

  const balanceRows = classIds.length
    ? ((await fetchFinanceChargeBalancesByClasses({
        institutionIds: [institutionId],
        classIds,
        onlyOpen: true,
        orderByDueDate: true,
      })) as ChargeBalanceRow[])
    : [];

  const relevantStudentIds = new Set(balanceRows.map((b) => b.student_id));
  const classIdSet = new Set(classRows.map((row) => row.id));
  const studentRows = adminStudents.filter(
    (s) =>
      relevantStudentIds.has(s.id) &&
      (!s.class_id || classIdSet.has(s.class_id)),
  );
  const studentMap = new Map(studentRows.map((s) => [s.id, s]));
  const qn = normalize(q);

  const filteredRows = balanceRows.filter((row) => {
    const student = studentMap.get(row.student_id);
    const cls = row.class_id
      ? classMap.get(row.class_id)
      : student?.class_id
        ? classMap.get(student.class_id)
        : null;

    if (!qn) return true;

    const haystack = normalize(
      [
        fullName(student),
        student?.matricule || "",
        student?.class_label || "",
        cls?.label || "",
        cls?.level || "",
        cls?.academic_year || "",
        row.label || "",
      ].join(" "),
    );

    return haystack.includes(qn);
  });

  const groupedByStudent = filteredRows.reduce<
    Record<string, StudentNoticeGroup>
  >((acc, row) => {
    const student = studentMap.get(row.student_id);
    const classRow = row.class_id
      ? classMap.get(row.class_id)
      : student?.class_id
        ? classMap.get(student.class_id)
        : undefined;

    if (!acc[row.student_id]) {
      acc[row.student_id] = {
        student,
        classRow,
        studentId: row.student_id,
        expected: 0,
        paid: 0,
        due: 0,
        charges: [],
      };
    }

    acc[row.student_id].expected += Number(row.net_amount || 0);
    acc[row.student_id].paid += Number(row.paid_amount || 0);
    acc[row.student_id].due += Number(row.balance_due || 0);
    acc[row.student_id].charges.push(row);

    return acc;
  }, {});

  const studentGroups = Object.values(groupedByStudent).sort((a, b) => {
    const classA = a.student?.class_label || a.classRow?.label || "";
    const classB = b.student?.class_label || b.classRow?.label || "";
    if (classA !== classB) return classA.localeCompare(classB, "fr");
    return fullName(a.student).localeCompare(fullName(b.student), "fr");
  });

  const generatedAt = new Date();

  return (
    <div className="parent-notices-page space-y-6">
      <style>{`
        .parent-notices-print-area {
          display: none;
        }

        @media print {
          @page {
            size: A4;
            margin: 6mm;
          }

          html,
          body {
            background: #ffffff !important;
          }

          body * {
            visibility: hidden !important;
          }

          .parent-notices-print-area,
          .parent-notices-print-area * {
            visibility: visible !important;
          }

          .parent-notices-page {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          .no-print {
            display: none !important;
          }

          .parent-notices-print-area {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          .parent-notice-card {
            display: block !important;
            width: 100% !important;
            max-width: 198mm !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 auto !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            border: 1px solid #cbd5e1 !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
            font-family: Arial, Helvetica, sans-serif !important;
          }

          .parent-notice-card > div {
            min-height: 0 !important;
            padding: 5mm 8mm 4mm !important;
          }

          .parent-notice-card:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }

          .parent-notice-watermark {
            display: block !important;
            position: absolute !important;
            left: 50% !important;
            top: 52% !important;
            width: 92mm !important;
            height: 92mm !important;
            transform: translate(-50%, -50%) !important;
            object-fit: contain !important;
            opacity: 0.04 !important;
            z-index: 0 !important;
          }

          .parent-notice-header,
          .parent-notice-body,
          .parent-notice-footer {
            position: relative !important;
            z-index: 1 !important;
          }

          .parent-notice-header {
            padding-bottom: 3mm !important;
            gap: 4mm !important;
          }

          .parent-notice-logo {
            width: 14mm !important;
            height: 14mm !important;
            border-radius: 10px !important;
            padding: 1.5mm !important;
          }

          .parent-notice-school {
            margin-top: 1mm !important;
            font-size: 16pt !important;
            line-height: 1.15 !important;
          }

          .parent-notice-meta {
            margin-top: 1mm !important;
            font-size: 8.5pt !important;
            line-height: 1.35 !important;
          }

          .parent-notice-side {
            min-width: 42mm !important;
            padding: 3mm !important;
            border-radius: 12px !important;
            font-size: 9pt !important;
          }

          .parent-notice-body {
            flex: none !important;
            padding: 4mm 0 3mm !important;
          }

          .parent-notice-body h1 {
            margin: 0 !important;
            font-size: 16pt !important;
            letter-spacing: 0.12em !important;
          }

          .parent-notice-intro,
          .parent-notice-message {
            margin-top: 4mm !important;
            font-size: 10pt !important;
            line-height: 1.45 !important;
          }

          .parent-notice-identity {
            margin-top: 4mm !important;
            padding: 3.5mm !important;
            border-radius: 12px !important;
          }

          .parent-notice-identity .grid {
            gap: 2mm !important;
          }

          .parent-notice-student-photo {
            width: 26mm !important;
            height: 34mm !important;
            border-radius: 10px !important;
            border-width: 1.2mm !important;
          }

          .parent-notice-amounts {
            margin-top: 3mm !important;
            gap: 3mm !important;
          }

          .parent-notice-amounts > div {
            padding: 3mm !important;
            border-radius: 12px !important;
          }

          .parent-notice-category-table {
            margin-top: 4mm !important;
            border-radius: 12px !important;
          }

          .parent-notice-category-table > div {
            padding: 2mm 3mm !important;
            font-size: 9.5pt !important;
          }

          .parent-notice-category-table table {
            font-size: 9pt !important;
          }

          .parent-notice-category-table th,
          .parent-notice-category-table td {
            padding: 2mm 3mm !important;
          }

          .parent-notice-signature {
            margin-top: 6mm !important;
          }

          .parent-notice-signature-line {
            margin-top: 8mm !important;
          }

          .parent-notice-footer {
            padding-top: 3mm !important;
            font-size: 8.5pt !important;
          }
        }
      `}</style>

      <section className="no-print overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <FileText className="h-3.5 w-3.5" />
              Gestion financière
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Avis aux parents
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Générer une note simple de situation financière à remettre aux
              parents. Ce document ne crée aucun paiement et ne modifie aucune
              dette.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              Avis affichés
            </div>
            <div className="mt-2 text-3xl font-black text-white">
              {studentGroups.length}
            </div>
            <div className="mt-1 text-sm text-slate-200">
              Classe :{" "}
              {classIdFilter
                ? classMap.get(classIdFilter)?.label || "sélectionnée"
                : "toutes"}
            </div>
          </div>
        </div>
      </section>

      <div className="no-print">
        <AcademicYearSelector
          academicYears={academicYears}
          selectedAcademicYearCode={selectedAcademicYearCode}
          currentPath="/admin/finance/avis-parents"
          hiddenParams={{ q, class_id: classIdFilter }}
        />
      </div>

      <section className="no-print rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <form
          method="GET"
          className="grid gap-3 lg:grid-cols-[1fr_280px_auto_auto]"
        >
          <input
            type="hidden"
            name="academic_year"
            value={selectedAcademicYearCode}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Rechercher un élève, un matricule ou un frais"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <select
            name="class_id"
            defaultValue={classIdFilter}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
          >
            <option value="">Toutes les classes</option>
            {classRows.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.label}
                {cls.level ? ` — ${cls.level}` : ""}
                {cls.academic_year ? ` — ${cls.academic_year}` : ""}
              </option>
            ))}
          </select>

          <button className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800">
            Filtrer
          </button>

          <PrintButton />
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 ring-1 ring-slate-200">
            Aucun numéro de reçu
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 ring-1 ring-slate-200">
            Aucun paiement créé
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 ring-1 ring-slate-200">
            Dettes inchangées
          </span>
        </div>
      </section>

      {studentGroups.length === 0 ? (
        <section className="no-print rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-600">
          Aucun avis à afficher pour ce filtre.
        </section>
      ) : (
        <section className="no-print rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">
                Aperçu des avis à imprimer
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Les avis ci-dessous seront imprimés, un document par élève.
              </p>
            </div>
            <PrintButton label="Imprimer" />
          </div>

          <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Élève</th>
                  <th className="px-4 py-3">Classe</th>
                  <th className="px-4 py-3 text-right">Attendu</th>
                  <th className="px-4 py-3 text-right">Payé</th>
                  <th className="px-4 py-3 text-right">Reste</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {studentGroups.map((group) => (
                  <tr key={group.studentId} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <StudentPortrait student={group.student} compact />
                        <div>
                          <div className="font-black text-slate-900">
                            {fullName(group.student)}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {group.student?.matricule || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {group.student?.class_label ||
                        group.classRow?.label ||
                        "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      {formatMoney(group.expected)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      {formatMoney(group.paid)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-rose-700">
                      {formatMoney(group.due)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="parent-notices-print-area space-y-6">
        {studentGroups.map((group) => (
          <NoticeDocument
            key={group.studentId}
            group={group}
            schoolName={schoolName}
            institutionSettings={institutionSettings}
            selectedAcademicYearCode={selectedAcademicYearCode}
            generatedAt={generatedAt}
          />
        ))}
      </section>

      <div className="no-print flex justify-start">
        <Link
          href={financeYearHref("/admin/finance", selectedAcademicYearCode)}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          Retour au tableau financier
        </Link>
      </div>
    </div>
  );
}
