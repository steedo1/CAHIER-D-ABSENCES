import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Copy,
  FileSpreadsheet,
  FileText,
  Filter,
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
  level?: string;
  class_id?: string;
  period?: string;
};

type IssueRow = {
  id: string;
  document_type: "receipt" | "bulletin";
  source_id: string;
  official_number: string;
  beneficiary_name: string | null;
  academic_year: string | null;
  class_id: string | null;
  class_label: string | null;
  period_key: string | null;
  period_label: string | null;
  issued_at: string | null;
};

type ClassRow = {
  id: string;
  name: string | null;
  label: string | null;
  level: string | null;
  academic_year: string | null;
};

type BulletinIssueRow = IssueRow & {
  class_key: string;
  display_class: string;
  display_level: string;
  display_period: string;
  filter_period: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
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
        "id,document_type,source_id,official_number,beneficiary_name,academic_year,class_id,class_label,period_key,period_label,issued_at",
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
      "id,document_type,source_id,official_number,beneficiary_name,academic_year,class_id,class_label,period_key,period_label,issued_at",
    )
    .eq("institution_id", access.institutionId)
    .eq("document_type", "bulletin")
    .order("beneficiary_name", { ascending: true })
    .limit(5000);

  if (issuesError) throw new Error(issuesError.message);
  const bulletinIssues = (rawIssues ?? []) as IssueRow[];

  const classIds = Array.from(
    new Set(bulletinIssues.map((row) => clean(row.class_id)).filter(Boolean)),
  );
  const classById = new Map<string, ClassRow>();

  if (classIds.length) {
    const { data: classRows, error: classesError } = await admin
      .from("classes")
      .select("id,name,label,level,academic_year")
      .eq("institution_id", access.institutionId)
      .in("id", classIds);

    if (classesError) throw new Error(classesError.message);
    for (const row of (classRows ?? []) as ClassRow[]) {
      classById.set(row.id, row);
    }
  }

  const enriched: BulletinIssueRow[] = bulletinIssues.map((issue) => {
    const classId = clean(issue.class_id);
    const classRow = classId ? classById.get(classId) : null;
    const displayClass =
      clean(issue.class_label) || clean(classRow?.name) || clean(classRow?.label) || "Classe";
    const displayLevel = clean(classRow?.level) || "Non renseigné";
    const displayPeriod = clean(issue.period_label) || "Période non renseignée";
    const filterPeriod = clean(issue.period_key) || displayPeriod;

    return {
      ...issue,
      class_key: classId || `label:${displayClass}`,
      display_class: displayClass,
      display_level: displayLevel,
      display_period: displayPeriod,
      filter_period: filterPeriod,
    };
  });

  const years = uniqueSorted(
    enriched.map((row) => clean(row.academic_year)),
    "desc",
  );
  const requestedYear = clean(requested.year);
  const selectedYear = years.includes(requestedYear) ? requestedYear : years[0] || "";

  const levels = uniqueSorted(
    enriched
      .filter((row) => !selectedYear || clean(row.academic_year) === selectedYear)
      .map((row) => row.display_level),
  );
  const requestedLevel = clean(requested.level);
  const selectedLevel = levels.includes(requestedLevel)
    ? requestedLevel
    : levels[0] || "";

  const classOptions = Array.from(
    enriched
      .filter(
        (row) =>
          (!selectedYear || clean(row.academic_year) === selectedYear) &&
          (!selectedLevel || row.display_level === selectedLevel),
      )
      .reduce<Map<string, { key: string; label: string }>>((map, row) => {
        if (!map.has(row.class_key)) {
          map.set(row.class_key, { key: row.class_key, label: row.display_class });
        }
        return map;
      }, new Map())
      .values(),
  ).sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));

  const requestedClass = clean(requested.class_id);
  const selectedClass = classOptions.some((row) => row.key === requestedClass)
    ? requestedClass
    : classOptions[0]?.key || "";

  const periodOptions = Array.from(
    enriched
      .filter(
        (row) =>
          (!selectedYear || clean(row.academic_year) === selectedYear) &&
          (!selectedLevel || row.display_level === selectedLevel) &&
          (!selectedClass || row.class_key === selectedClass),
      )
      .reduce<Map<string, { key: string; label: string }>>((map, row) => {
        if (!map.has(row.filter_period)) {
          map.set(row.filter_period, {
            key: row.filter_period,
            label: row.display_period,
          });
        }
        return map;
      }, new Map())
      .values(),
  ).sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));

  const requestedPeriod = clean(requested.period);
  const selectedPeriod = periodOptions.some((row) => row.key === requestedPeriod)
    ? requestedPeriod
    : periodOptions[0]?.key || "";

  const filteredIssues = enriched.filter(
    (row) =>
      (!selectedYear || clean(row.academic_year) === selectedYear) &&
      (!selectedLevel || row.display_level === selectedLevel) &&
      (!selectedClass || row.class_key === selectedClass) &&
      (!selectedPeriod || row.filter_period === selectedPeriod),
  );

  const counts = await duplicateCounts(filteredIssues.map((row) => row.id));
  const totalDuplicates = Array.from(counts.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Bulletins"
        originals={filteredIssues.length}
        duplicates={totalDuplicates}
      />

      <form className="grid gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto]">
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
            Niveau
          </span>
          <select
            name="level"
            defaultValue={selectedLevel}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
          >
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
            Classe
          </span>
          <select
            name="class_id"
            defaultValue={selectedClass}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
          >
            {classOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
            Période
          </span>
          <select
            name="period"
            defaultValue={selectedPeriod}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
          >
            {periodOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <button className="mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800">
          <Filter className="h-4 w-4" />
          Afficher
        </button>
      </form>

      <DocumentsTable
        issues={filteredIssues}
        duplicateCountByIssue={counts}
        documentType="bulletin"
      />
    </div>
  );
}
