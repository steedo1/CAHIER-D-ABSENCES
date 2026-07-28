import Link from "next/link";
import { redirect } from "next/navigation";
import { Copy, FileSpreadsheet, FileText, Printer, Search } from "lucide-react";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getOfficialDocumentAccess } from "@/lib/official-documents";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

  const paramsSearch: SearchParams = searchParams ? await searchParams : {};
  const queryText = String(paramsSearch.q || "").trim();
  const documentType = kind === "recus" ? "receipt" : "bulletin";
  const singularLabel = kind === "recus" ? "reçu" : "bulletin";
  const title = kind === "recus" ? "Reçus" : "Bulletins";

  const admin = getSupabaseServiceClient();
  let query = admin
    .from("official_document_issues")
    .select(
      "id,document_type,source_id,official_number,beneficiary_name,academic_year,class_label,period_label,issued_at",
    )
    .eq("institution_id", access.institutionId)
    .eq("document_type", documentType)
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

  const { data: issues, error } = await query;
  if (error) throw new Error(error.message);

  const issueIds = (issues ?? []).map((row: any) => row.id);
  const duplicateCountByIssue = new Map<string, number>();

  if (issueIds.length > 0) {
    const { data: events, error: eventsError } = await admin
      .from("official_document_print_events")
      .select("issue_id")
      .in("issue_id", issueIds)
      .eq("print_kind", "duplicate");

    if (eventsError) throw new Error(eventsError.message);
    for (const event of events ?? []) {
      const issueId = String((event as any).issue_id || "");
      duplicateCountByIssue.set(
        issueId,
        (duplicateCountByIssue.get(issueId) || 0) + 1,
      );
    }
  }

  const totalDuplicates = Array.from(duplicateCountByIssue.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
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

          <div className="grid grid-cols-2 gap-3 text-center sm:min-w-[320px]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-2xl font-black text-slate-950">
                {issues?.length || 0}
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                Originaux
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-2xl font-black text-slate-950">
                {totalDuplicates}
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                Duplicatas
              </div>
            </div>
          </div>
        </div>
      </div>

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
              {(issues ?? []).map((row: any) => {
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
                      {documentType === "bulletin" ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {[row.class_label, row.period_label, row.academic_year]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {row.beneficiary_name || "—"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatDateTime(row.issued_at)}
                    </td>
                    <td className="px-5 py-4 font-black text-slate-900">
                      {count}
                    </td>
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

        {(issues ?? []).length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Copy className="mx-auto h-10 w-10 text-slate-300" />
            <div className="mt-4 text-lg font-black text-slate-800">
              Aucun {singularLabel} enregistré
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Les {title.toLowerCase()} apparaissent ici après leur première impression.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
