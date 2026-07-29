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
import { getOfficialDocumentAccess } from "@/lib/official-documents";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  year?: string;
  issue_id?: string;
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

type StudentBulletinGroup = {
  key: string;
  studentId: string | null;
  matricule: string;
  beneficiaryName: string;
  classLabel: string;
  issues: IssueRow[];
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

function uniqueSorted(values: string[], direction: "asc" | "desc" = "asc") {
  const result = Array.from(new Set(values.filter(Boolean)));
  result.sort((a, b) =>
    direction === "desc"
      ? b.localeCompare(a, "fr", { numeric: true })
      : a.localeCompare(b, "fr", { numeric: true }),
  );
  return result;
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

function periodDisplay(issue: IssueRow) {
  return clean(issue.period_label) || clean(issue.period_key) || "Période";
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

  const { data: rawIssues, error: issuesError } = await admin
    .from("official_document_issues")
    .select(
      "id,document_type,source_id,official_number,beneficiary_id,beneficiary_name,academic_year,class_id,class_label,period_key,period_label,issued_at",
    )
    .eq("institution_id", access.institutionId)
    .eq("document_type", "bulletin")
    .order("issued_at", { ascending: false })
    .limit(10000);

  if (issuesError) throw new Error(issuesError.message);
  const bulletinIssues = (rawIssues ?? []) as IssueRow[];

  const years = uniqueSorted(
    bulletinIssues.map((row) => clean(row.academic_year)),
    "desc",
  );
  const requestedYear = clean(requested.year);
  const selectedYear = years.includes(requestedYear) ? requestedYear : years[0] || "";
  const queryText = clean(requested.q);
  const normalizedTokens = normalizeSearch(queryText).split(/\s+/).filter(Boolean);

  const yearIssues = bulletinIssues.filter(
    (issue) => !selectedYear || clean(issue.academic_year) === selectedYear,
  );

  const studentIds = Array.from(
    new Set(yearIssues.map((row) => clean(row.beneficiary_id)).filter(Boolean)),
  );
  const studentById = new Map<string, StudentRow>();

  if (studentIds.length) {
    const { data: students, error: studentsError } = await admin
      .from("students")
      .select("id,matricule,first_name,last_name,full_name")
      .eq("institution_id", access.institutionId)
      .in("id", studentIds);

    if (studentsError) throw new Error(studentsError.message);
    for (const student of (students ?? []) as StudentRow[]) {
      studentById.set(student.id, student);
    }
  }

  const matchingIssues = queryText
    ? yearIssues.filter((issue) => {
        const studentId = clean(issue.beneficiary_id);
        const student = studentId ? studentById.get(studentId) : undefined;
        const searchable = normalizeSearch(
          [
            issue.official_number,
            issue.beneficiary_name,
            issue.class_label,
            student?.matricule,
            student?.first_name,
            student?.last_name,
            student?.full_name,
          ]
            .filter(Boolean)
            .join(" "),
        );
        return normalizedTokens.every((token) => searchable.includes(token));
      })
    : [];

  const groupsByStudent = matchingIssues.reduce<Map<string, StudentBulletinGroup>>(
    (map, issue) => {
      const studentId = clean(issue.beneficiary_id) || null;
      const student = studentId ? studentById.get(studentId) : undefined;
      const beneficiaryName = studentDisplayName(student, issue.beneficiary_name);
      const matricule = clean(student?.matricule);
      const classLabel = clean(issue.class_label) || "—";
      const key = studentId || `${normalizeSearch(beneficiaryName)}|${normalizeSearch(classLabel)}`;
      const current = map.get(key);

      if (current) {
        current.issues.push(issue);
        if (!current.matricule && matricule) current.matricule = matricule;
        if (current.classLabel === "—" && classLabel !== "—") {
          current.classLabel = classLabel;
        }
      } else {
        map.set(key, {
          key,
          studentId,
          matricule,
          beneficiaryName,
          classLabel,
          issues: [issue],
        });
      }
      return map;
    },
    new Map(),
  );

  const groups = Array.from(groupsByStudent.values())
    .map((group) => ({
      ...group,
      issues: [...group.issues].sort((a, b) =>
        periodDisplay(a).localeCompare(periodDisplay(b), "fr", { numeric: true }),
      ),
    }))
    .sort((a, b) => a.beneficiaryName.localeCompare(b.beneficiaryName, "fr"));

  const requestedIssueId = clean(requested.issue_id);
  const selectedIssue = matchingIssues.find((issue) => issue.id === requestedIssueId) || null;
  const selectedStudent = selectedIssue?.beneficiary_id
    ? studentById.get(selectedIssue.beneficiary_id)
    : undefined;
  const counts = await duplicateCounts(matchingIssues.map((row) => row.id));
  const totalDuplicates = Array.from(counts.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Bulletins"
        originals={matchingIssues.length}
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
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
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
              placeholder="Matricule, nom, prénom, numéro de bulletin ou classe…"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none focus:border-slate-400"
            />
          </div>
        </label>

        <button className="mt-auto inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800">
          Rechercher
        </button>
      </form>

      {selectedIssue ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Bulletin sélectionné
              </div>
              <div className="mt-2 text-xl font-black text-slate-950">
                {studentDisplayName(selectedStudent, selectedIssue.beneficiary_name)}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                {[
                  clean(selectedStudent?.matricule)
                    ? `Matricule ${clean(selectedStudent?.matricule)}`
                    : null,
                  clean(selectedIssue.class_label),
                  periodDisplay(selectedIssue),
                  clean(selectedIssue.academic_year),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className="mt-2 font-mono text-xs font-black text-slate-700">
                {selectedIssue.official_number} · émis le {formatDateTime(selectedIssue.issued_at)}
              </div>
            </div>

            <Link
              href={`/admin/bulletins?duplicata=${encodeURIComponent(selectedIssue.id)}`}
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
                {groups.map((group) => (
                  <tr key={group.key} className="border-t border-slate-100 align-middle">
                    <td className="px-5 py-4 font-mono text-xs font-black text-slate-700">
                      {group.matricule || "—"}
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-900">
                      {group.beneficiaryName}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-600">
                      {group.classLabel}
                    </td>
                    <td className="px-5 py-4" colSpan={2}>
                      <form className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <input type="hidden" name="year" value={selectedYear} />
                        <input type="hidden" name="q" value={queryText} />
                        <select
                          name="issue_id"
                          defaultValue={
                            selectedIssue && group.issues.some((issue) => issue.id === selectedIssue.id)
                              ? selectedIssue.id
                              : group.issues[0]?.id || ""
                          }
                          className="h-11 min-w-[220px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
                        >
                          {group.issues.map((issue) => (
                            <option key={issue.id} value={issue.id}>
                              {periodDisplay(issue)}
                            </option>
                          ))}
                        </select>
                        <button className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-900 hover:bg-slate-50">
                          Choisir
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {groups.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Search className="mx-auto h-10 w-10 text-slate-300" />
              <div className="mt-4 text-lg font-black text-slate-800">
                Aucun bulletin trouvé
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
            Saisissez son matricule, son nom ou son prénom.
          </p>
        </div>
      )}
    </div>
  );
}
