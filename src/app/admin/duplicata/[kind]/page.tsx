import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Copy,
  FileSpreadsheet,
  FileText,
  Printer,
  Search,
} from "lucide-react";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  computeOfficialBulletinSourceId,
  getOfficialDocumentAccess,
} from "@/lib/official-documents";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  year?: string;
  student_id?: string;
  class_id?: string;
  period_id?: string;
};

type IssueRow = {
  id: string;
  document_type: "receipt" | "bulletin";
  source_id: string;
  official_number: string;
  beneficiary_id: string | null;
  beneficiary_name: string | null;
  academic_year: string | null;
  class_id: string | null;
  class_label: string | null;
  period_key: string | null;
  period_label: string | null;
  issued_at: string | null;
};

type StudentRow = {
  id: string;
  matricule: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
};

type AcademicYearRow = {
  code: string;
  label: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean | null;
};

type ClassRow = {
  id: string;
  label: string | null;
  level: string | null;
  academic_year: string | null;
};

type EnrollmentRow = {
  student_id: string;
  class_id: string;
  start_date: string | null;
  end_date: string | null;
};

type PeriodRow = {
  id: string;
  academic_year: string;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number | null;
  is_active: boolean | null;
};

type StudentSearchResult = {
  key: string;
  student: StudentRow;
  classRow: ClassRow;
  enrollment: EnrollmentRow;
  periods: PeriodRow[];
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSearch(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function studentDisplayName(student: StudentRow | undefined, fallback: string | null) {
  const fullName = clean(student?.full_name);
  if (fullName) return fullName;

  const joined = [clean(student?.last_name), clean(student?.first_name)]
    .filter(Boolean)
    .join(" ");
  return joined || clean(fallback) || "Élève";
}

async function duplicateCounts(issueIds: string[]) {
  const result = new Map<string, number>();
  if (!issueIds.length) return result;

  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .from("official_document_print_events")
    .select("issue_id")
    .in("issue_id", issueIds)
    .eq("print_kind", "duplicate");

  if (error) throw new Error(error.message);
  for (const event of data ?? []) {
    const issueId = clean((event as any).issue_id);
    if (!issueId) continue;
    result.set(issueId, (result.get(issueId) || 0) + 1);
  }
  return result;
}

function SummaryCards({ originals, duplicates }: { originals: number; duplicates: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-center sm:min-w-[320px]">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="text-2xl font-black text-slate-950">{originals}</div>
        <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
          Originaux
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="text-2xl font-black text-slate-950">{duplicates}</div>
        <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
          Duplicatas
        </div>
      </div>
    </div>
  );
}

function PageHeader({
  title,
  originals,
  duplicates,
}: {
  title: string;
  originals: number;
  duplicates: number;
}) {
  return (
    <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-[0.15em] text-slate-700">
            <Copy className="h-4 w-4" />
            Duplicata
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            {title}
          </h1>
        </div>
        <SummaryCards originals={originals} duplicates={duplicates} />
      </div>
    </div>
  );
}

function DocumentsTable({
  issues,
  duplicateCountByIssue,
  documentType,
}: {
  issues: IssueRow[];
  duplicateCountByIssue: Map<string, number>;
  documentType: "receipt" | "bulletin";
}) {
  const singularLabel = documentType === "receipt" ? "reçu" : "bulletin";

  return (
    <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-5 py-4">Numéro original</th>
              <th className="px-5 py-4">Bénéficiaire</th>
              <th className="px-5 py-4">Émission</th>
              <th className="px-5 py-4">Duplicatas</th>
              <th className="px-5 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((row) => {
              const count = duplicateCountByIssue.get(row.id) || 0;
              const href =
                documentType === "receipt"
                  ? `/admin/finance/receipts/${encodeURIComponent(row.source_id)}?autoprint=1&duplicata=${encodeURIComponent(row.id)}`
                  : `/admin/bulletins?duplicata=${encodeURIComponent(row.id)}`;

              return (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-5 py-4">
                    <div className="inline-flex items-center gap-2 font-mono text-xs font-black text-slate-900">
                      {documentType === "receipt" ? (
                        <FileText className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4 text-sky-600" />
                      )}
                      {row.official_number}
                    </div>
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-800">
                    {row.beneficiary_name || "—"}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {formatDateTime(row.issued_at)}
                  </td>
                  <td className="px-5 py-4 font-black text-slate-900">{count}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800"
                    >
                      <Printer className="h-4 w-4" />
                      Imprimer le duplicata
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issues.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <Copy className="mx-auto h-10 w-10 text-slate-300" />
          <div className="mt-4 text-lg font-black text-slate-800">
            Aucun {singularLabel} enregistré
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default async function DuplicataKindPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { kind: rawKind } = await params;
  const kind = rawKind === "recus" || rawKind === "bulletins" ? rawKind : null;
  if (!kind) redirect("/admin/duplicata");

  const access = await getOfficialDocumentAccess();
  if (!access.userId) redirect("/login");
  if (!access.ok || !access.institutionId) redirect("/admin");

  const financeAccess =
    kind === "recus"
      ? await getFinanceAccessForCurrentUser("full").catch(() => null)
      : null;

  const canReceipts = Boolean(
    access.canReadReceipts &&
      financeAccess?.ok &&
      financeAccess.institutionId === access.institutionId,
  );
  const canBulletins = access.canReadBulletins;

  if (kind === "recus" && !canReceipts) {
    if (canBulletins) redirect("/admin/duplicata/bulletins");
    redirect("/admin");
  }
  if (kind === "bulletins" && !canBulletins) {
    if (canReceipts) redirect("/admin/duplicata/recus");
    redirect("/admin");
  }

  const requested: SearchParams = searchParams ? await searchParams : {};
  const admin = getSupabaseServiceClient();

  if (kind === "recus") {
    const queryText = clean(requested.q);
    let query = admin
      .from("official_document_issues")
      .select(
        "id,document_type,source_id,official_number,beneficiary_id,beneficiary_name,academic_year,class_id,class_label,period_key,period_label,issued_at",
      )
      .eq("institution_id", access.institutionId)
      .eq("document_type", "receipt")
      .order("issued_at", { ascending: false })
      .limit(500);

    if (queryText) {
      const safe = queryText.replace(/[,%()]/g, " ").trim();
      if (safe) {
        query = query.or(
          `official_number.ilike.%${safe}%,beneficiary_name.ilike.%${safe}%,class_label.ilike.%${safe}%`,
        );
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const issues = (data ?? []) as IssueRow[];
    const counts = await duplicateCounts(issues.map((row) => row.id));
    const totalDuplicates = Array.from(counts.values()).reduce(
      (sum, value) => sum + value,
      0,
    );

    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <PageHeader
          title="Reçus"
          originals={issues.length}
          duplicates={totalDuplicates}
        />

        <form className="grid gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={queryText}
              placeholder="Numéro, bénéficiaire ou classe…"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none focus:border-slate-400"
            />
          </label>
          <button className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800">
            Rechercher
          </button>
        </form>

        <DocumentsTable
          issues={issues}
          duplicateCountByIssue={counts}
          documentType="receipt"
        />
      </div>
    );
  }

  const [academicYearsResult, classYearsResult, periodYearsResult] = await Promise.all([
    admin
      .from("academic_years")
      .select("code,label,start_date,end_date,is_current")
      .eq("institution_id", access.institutionId)
      .order("start_date", { ascending: false }),
    admin
      .from("classes")
      .select("academic_year")
      .eq("institution_id", access.institutionId),
    admin
      .from("grade_periods")
      .select("academic_year")
      .eq("institution_id", access.institutionId),
  ]);

  if (academicYearsResult.error) throw new Error(academicYearsResult.error.message);
  if (classYearsResult.error) throw new Error(classYearsResult.error.message);
  if (periodYearsResult.error) throw new Error(periodYearsResult.error.message);

  const academicYearByCode = new Map<string, AcademicYearRow>();
  for (const row of (academicYearsResult.data ?? []) as AcademicYearRow[]) {
    const code = clean(row.code);
    if (!code) continue;
    academicYearByCode.set(code, { ...row, code });
  }
  for (const row of [
    ...(classYearsResult.data ?? []),
    ...(periodYearsResult.data ?? []),
  ] as Array<{ academic_year?: string | null }>) {
    const code = clean(row.academic_year);
    if (!code || academicYearByCode.has(code)) continue;
    academicYearByCode.set(code, {
      code,
      label: null,
      start_date: null,
      end_date: null,
      is_current: false,
    });
  }

  const academicYears = Array.from(academicYearByCode.values()).sort((a, b) =>
    b.code.localeCompare(a.code, "fr", { numeric: true }),
  );
  const requestedYear = clean(requested.year);
  const currentYear = academicYears.find((row) => row.is_current === true)?.code || "";
  const selectedYear = academicYears.some((row) => row.code === requestedYear)
    ? requestedYear
    : currentYear || academicYears[0]?.code || "";
  const queryText = clean(requested.q);
  const normalizedTokens = normalizeSearch(queryText).split(/\s+/).filter(Boolean);

  let issueQuery = admin
    .from("official_document_issues")
    .select(
      "id,document_type,source_id,official_number,beneficiary_id,beneficiary_name,academic_year,class_id,class_label,period_key,period_label,issued_at",
    )
    .eq("institution_id", access.institutionId)
    .eq("document_type", "bulletin")
    .order("issued_at", { ascending: false })
    .limit(10000);

  if (selectedYear) issueQuery = issueQuery.eq("academic_year", selectedYear);

  const { data: rawIssues, error: issuesError } = await issueQuery;
  if (issuesError) throw new Error(issuesError.message);
  const bulletinIssues = (rawIssues ?? []) as IssueRow[];
  const issueBySourceId = new Map(
    bulletinIssues.map((issue) => [clean(issue.source_id), issue] as const),
  );
  const issueSearchByStudent = new Map<string, string[]>();
  for (const issue of bulletinIssues) {
    const studentId = clean(issue.beneficiary_id);
    if (!studentId) continue;
    const values = issueSearchByStudent.get(studentId) || [];
    values.push(clean(issue.official_number));
    issueSearchByStudent.set(studentId, values);
  }

  const counts = await duplicateCounts(bulletinIssues.map((row) => row.id));
  const totalDuplicates = Array.from(counts.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  let results: StudentSearchResult[] = [];
  const periodsByClass = new Map<string, PeriodRow[]>();

  if (queryText && selectedYear) {
    const [{ data: classRows, error: classesError }, { data: studentRows, error: studentsError }] =
      await Promise.all([
        admin
          .from("classes")
          .select("id,label,level,academic_year")
          .eq("institution_id", access.institutionId)
          .eq("academic_year", selectedYear)
          .order("level", { ascending: true })
          .order("label", { ascending: true }),
        admin
          .from("students")
          .select("id,matricule,first_name,last_name,full_name")
          .eq("institution_id", access.institutionId)
          .limit(10000),
      ]);

    if (classesError) throw new Error(classesError.message);
    if (studentsError) throw new Error(studentsError.message);

    const classes = (classRows ?? []) as ClassRow[];
    const classById = new Map(classes.map((row) => [row.id, row] as const));
    const classIds = classes.map((row) => row.id);

    const candidates = ((studentRows ?? []) as StudentRow[])
      .filter((student) => {
        const searchable = normalizeSearch(
          [
            student.matricule,
            student.full_name,
            student.last_name,
            student.first_name,
            ...(issueSearchByStudent.get(student.id) || []),
          ]
            .filter(Boolean)
            .join(" "),
        );
        return normalizedTokens.every((token) => searchable.includes(token));
      })
      .sort((a, b) =>
        studentDisplayName(a, null).localeCompare(studentDisplayName(b, null), "fr"),
      )
      .slice(0, 80);

    const candidateIds = candidates.map((student) => student.id);
    const studentById = new Map(candidates.map((student) => [student.id, student] as const));

    if (candidateIds.length && classIds.length) {
      const { data: enrollmentRows, error: enrollmentsError } = await admin
        .from("class_enrollments")
        .select("student_id,class_id,start_date,end_date")
        .eq("institution_id", access.institutionId)
        .in("student_id", candidateIds)
        .in("class_id", classIds)
        .order("start_date", { ascending: false });

      if (enrollmentsError) throw new Error(enrollmentsError.message);

      const enrollments = (enrollmentRows ?? []) as EnrollmentRow[];
      const distinctClassIds = Array.from(
        new Set(enrollments.map((row) => clean(row.class_id)).filter(Boolean)),
      );

      await Promise.all(
        distinctClassIds.map(async (classId) => {
          const resolved = await listApplicableGradePeriods(
            admin,
            access.institutionId as string,
            selectedYear,
            classId,
          );
          periodsByClass.set(
            classId,
            (resolved.items || [])
              .filter((period: PeriodRow) => period.is_active !== false)
              .map((period: PeriodRow): PeriodRow => ({
                id: period.id,
                academic_year: period.academic_year,
                code: period.code,
                label: period.label,
                short_label: period.short_label,
                start_date: period.start_date,
                end_date: period.end_date,
                order_index: period.order_index,
                is_active: period.is_active,
              }))
              .sort((a: PeriodRow, b: PeriodRow) =>
                Number(a.order_index || 0) - Number(b.order_index || 0),
              ),
          );
        }),
      );

      const seen = new Set<string>();
      results = enrollments
        .map((enrollment) => {
          const student = studentById.get(enrollment.student_id);
          const classRow = classById.get(enrollment.class_id);
          if (!student || !classRow) return null;
          const key = `${student.id}|${classRow.id}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            key,
            student,
            classRow,
            enrollment,
            periods: periodsByClass.get(classRow.id) || [],
          } satisfies StudentSearchResult;
        })
        .filter((row): row is StudentSearchResult => Boolean(row))
        .sort((a, b) => {
          const nameCompare = studentDisplayName(a.student, null).localeCompare(
            studentDisplayName(b.student, null),
            "fr",
          );
          if (nameCompare !== 0) return nameCompare;
          return clean(a.classRow.label).localeCompare(clean(b.classRow.label), "fr");
        });
    }
  }

  const selectedStudentId = clean(requested.student_id);
  const selectedClassId = clean(requested.class_id);
  const selectedPeriodId = clean(requested.period_id);
  const selectedResult = results.find(
    (row) => row.student.id === selectedStudentId && row.classRow.id === selectedClassId,
  );
  const selectedPeriod = selectedResult?.periods.find(
    (period) => period.id === selectedPeriodId,
  );

  let selectedIssue: IssueRow | null = null;
  let liveDuplicateHref = "";

  if (selectedResult && selectedPeriod) {
    const periodLabel =
      clean(selectedPeriod.short_label) ||
      clean(selectedPeriod.label) ||
      clean(selectedPeriod.code) ||
      null;
    const sourceId = computeOfficialBulletinSourceId({
      institutionId: access.institutionId,
      classId: selectedResult.classRow.id,
      studentId: selectedResult.student.id,
      academicYear: selectedYear || null,
      periodFrom: clean(selectedPeriod.start_date) || null,
      periodTo: clean(selectedPeriod.end_date) || null,
      periodLabel,
    });
    selectedIssue = issueBySourceId.get(sourceId) || null;

    const liveParams = new URLSearchParams({
      duplicata_live: "1",
      student_id: selectedResult.student.id,
      class_id: selectedResult.classRow.id,
      academic_year: selectedYear,
      period_id: selectedPeriod.id,
    });
    liveDuplicateHref = `/admin/bulletins?${liveParams.toString()}`;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Bulletins"
        originals={bulletinIssues.length}
        duplicates={totalDuplicates}
      />

      <form className="grid gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[240px_1fr_auto]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
            Année scolaire
          </span>
          <select
            name="year"
            defaultValue={selectedYear}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
          >
            {academicYears.length === 0 ? (
              <option value="">Aucune année scolaire configurée</option>
            ) : null}
            {academicYears.map((year) => (
              <option key={year.code} value={year.code}>
                {year.code}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
            Élève
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={queryText}
              placeholder="Matricule, nom ou prénom…"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none focus:border-slate-400"
            />
          </div>
        </label>

        <button className="mt-auto inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800">
          Rechercher
        </button>
      </form>

      {selectedResult && selectedPeriod ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Duplicata sélectionné
              </div>
              <div className="mt-2 text-xl font-black text-slate-950">
                {studentDisplayName(selectedResult.student, null)}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                {[
                  clean(selectedResult.student.matricule)
                    ? `Matricule ${clean(selectedResult.student.matricule)}`
                    : null,
                  clean(selectedResult.classRow.label),
                  clean(selectedPeriod.short_label) ||
                    clean(selectedPeriod.label) ||
                    clean(selectedPeriod.code),
                  selectedYear,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>

            <Link
              href={
                selectedIssue
                  ? `/admin/bulletins?duplicata=${encodeURIComponent(selectedIssue.id)}`
                  : liveDuplicateHref
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800"
            >
              <Printer className="h-4 w-4" />
              Imprimer le duplicata
            </Link>
          </div>
        </div>
      ) : null}

      {queryText ? (
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Matricule</th>
                  <th className="px-5 py-4">Élève</th>
                  <th className="px-5 py-4">Classe</th>
                  <th className="px-5 py-4">Trimestre / période</th>
                  <th className="px-5 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.key} className="border-t border-slate-100 align-middle">
                    <td className="px-5 py-4 font-mono text-xs font-black text-slate-700">
                      {clean(result.student.matricule) || "—"}
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-900">
                      {studentDisplayName(result.student, null)}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-600">
                      {clean(result.classRow.label) || "—"}
                    </td>
                    <td className="px-5 py-4" colSpan={2}>
                      <form className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <input type="hidden" name="year" value={selectedYear} />
                        <input type="hidden" name="q" value={queryText} />
                        <input type="hidden" name="student_id" value={result.student.id} />
                        <input type="hidden" name="class_id" value={result.classRow.id} />
                        <select
                          name="period_id"
                          defaultValue={
                            selectedResult?.key === result.key ? selectedPeriodId : ""
                          }
                          required
                          className="h-11 min-w-[230px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
                        >
                          <option value="">Choisir le trimestre…</option>
                          {result.periods.map((period) => (
                            <option key={period.id} value={period.id}>
                              {clean(period.short_label) ||
                                clean(period.label) ||
                                clean(period.code) ||
                                `${clean(period.start_date)} → ${clean(period.end_date)}`}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={result.periods.length === 0}
                          className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Choisir
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {results.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Search className="mx-auto h-10 w-10 text-slate-300" />
              <div className="mt-4 text-lg font-black text-slate-800">
                Aucun élève trouvé pour cette année scolaire
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <Search className="mx-auto h-10 w-10 text-slate-300" />
          <div className="mt-4 text-lg font-black text-slate-800">
            Rechercher un élève
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Sélectionnez l’année scolaire, puis saisissez le matricule, le nom ou le prénom.
          </p>
        </div>
      )}
    </div>
  );
}
