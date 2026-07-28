import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Copy,
  FileSpreadsheet,
  FileText,
  Printer,
  Search,
  ShieldCheck,
} from "lucide-react";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getOfficialDocumentAccess } from "@/lib/official-documents";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type SearchParams = {
  type?: string;
  q?: string;
  status?: string;
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

function documentLabel(type: string) {
  return type === "receipt" ? "Reçu" : "Bulletin";
}

function statusLabel(status: string) {
  if (status === "cancelled") return "Annulé";
  if (status === "revoked") return "Révoqué";
  return "Valide";
}

export default async function DuplicataPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const access = await getOfficialDocumentAccess();
  if (!access.userId) redirect("/login");
  if (!access.ok || !access.institutionId) redirect("/admin");

  const financeAccess = await getFinanceAccessForCurrentUser("full").catch(() => null);
  const canReceipts = Boolean(access.canReadReceipts && financeAccess?.ok);
  const canBulletins = access.canReadBulletins;
  const allowedTypes = [
    ...(canReceipts ? ["receipt"] : []),
    ...(canBulletins ? ["bulletin"] : []),
  ];

  if (allowedTypes.length === 0) redirect("/admin");

  const selectedType = allowedTypes.includes(String(params.type || ""))
    ? String(params.type)
    : "all";
  const selectedStatus = ["valid", "cancelled", "revoked"].includes(
    String(params.status || ""),
  )
    ? String(params.status)
    : "all";
  const queryText = String(params.q || "").trim();

  const admin = getSupabaseServiceClient();
  let query = admin
    .from("official_document_issues")
    .select(
      "id,document_type,source_id,source_version,official_number,beneficiary_name,academic_year,class_label,period_label,issued_at,status,revoked_at,revoke_reason",
    )
    .eq("institution_id", access.institutionId)
    .in("document_type", allowedTypes)
    .order("issued_at", { ascending: false })
    .limit(500);

  if (selectedType !== "all") query = query.eq("document_type", selectedType);
  if (selectedStatus !== "all") query = query.eq("status", selectedStatus);
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
  const lastDuplicateByIssue = new Map<string, string>();
  const lastDuplicateReasonByIssue = new Map<string, string>();

  if (issueIds.length > 0) {
    const { data: events, error: eventsError } = await admin
      .from("official_document_print_events")
      .select("issue_id,print_kind,duplicate_number,generated_at,reason")
      .in("issue_id", issueIds)
      .eq("print_kind", "duplicate")
      .order("generated_at", { ascending: false });

    if (eventsError) throw new Error(eventsError.message);
    for (const event of events ?? []) {
      const issueId = String((event as any).issue_id || "");
      duplicateCountByIssue.set(issueId, (duplicateCountByIssue.get(issueId) || 0) + 1);
      if (!lastDuplicateByIssue.has(issueId)) {
        lastDuplicateByIssue.set(issueId, String((event as any).generated_at || ""));
        lastDuplicateReasonByIssue.set(
          issueId,
          String((event as any).reason || "").trim(),
        );
      }
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-[0.15em] text-slate-700">
              <ShieldCheck className="h-4 w-4" />
              Registre officiel
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              Duplicata
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Retrouvez les reçus et bulletins déjà émis. Une réédition conserve
              le numéro original, ne recrée aucune opération et reste inscrite
              dans l’historique.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center sm:min-w-[320px]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-2xl font-black text-slate-950">{issues?.length || 0}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                Documents
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-2xl font-black text-slate-950">
                {Array.from(duplicateCountByIssue.values()).reduce((sum, value) => sum + value, 0)}
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                Duplicatas
              </div>
            </div>
          </div>
        </div>
      </div>

      <form className="grid gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_190px_190px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={queryText}
            placeholder="Numéro, élève ou classe…"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none focus:border-slate-400"
          />
        </label>

        <select
          name="type"
          defaultValue={selectedType}
          className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
        >
          <option value="all">Tous les documents</option>
          {canReceipts ? <option value="receipt">Reçus</option> : null}
          {canBulletins ? <option value="bulletin">Bulletins</option> : null}
        </select>

        <select
          name="status"
          defaultValue={selectedStatus}
          className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
        >
          <option value="all">Tous les statuts</option>
          <option value="valid">Valides</option>
          <option value="cancelled">Annulés</option>
          <option value="revoked">Révoqués</option>
        </select>

        <button className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-black text-white hover:bg-slate-800">
          Filtrer
        </button>
      </form>

      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-5 py-4">Document</th>
                <th className="px-5 py-4">Numéro original</th>
                <th className="px-5 py-4">Bénéficiaire</th>
                <th className="px-5 py-4">Émission</th>
                <th className="px-5 py-4">Duplicatas</th>
                <th className="px-5 py-4">Statut</th>
                <th className="px-5 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {(issues ?? []).map((row: any) => {
                const count = duplicateCountByIssue.get(row.id) || 0;
                const valid = row.status === "valid";
                const href =
                  row.document_type === "receipt"
                    ? `/admin/finance/receipts/${encodeURIComponent(row.source_id)}?autoprint=1`
                    : `/admin/bulletins?duplicata=${encodeURIComponent(row.id)}`;

                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="px-5 py-4">
                      <div className="inline-flex items-center gap-2 font-black text-slate-900">
                        {row.document_type === "receipt" ? (
                          <FileText className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <FileSpreadsheet className="h-4 w-4 text-sky-600" />
                        )}
                        {documentLabel(row.document_type)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[row.class_label, row.period_label, row.academic_year]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs font-bold text-slate-800">
                      {row.official_number}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {row.beneficiary_name || "—"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatDateTime(row.issued_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-black text-slate-900">{count}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {count > 0
                          ? `Dernier : ${formatDateTime(lastDuplicateByIssue.get(row.id))}`
                          : "Aucune réédition"}
                      </div>
                      {count > 0 && lastDuplicateReasonByIssue.get(row.id) ? (
                        <div className="mt-1 max-w-[280px] text-xs text-slate-500">
                          Motif : {lastDuplicateReasonByIssue.get(row.id)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={[
                          "inline-flex rounded-full px-3 py-1 text-xs font-black",
                          valid
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
                        ].join(" ")}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {valid ? (
                        <Link
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800"
                        >
                          <Printer className="h-4 w-4" />
                          Réimprimer
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-500">
                          <Copy className="h-4 w-4" />
                          Indisponible
                        </span>
                      )}
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
              Aucun document officiel trouvé
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Le registre se remplira lors de la première impression d’un reçu
              ou d’un bulletin.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
