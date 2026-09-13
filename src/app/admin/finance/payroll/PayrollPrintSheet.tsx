import PayrollPrintDocument from "./PayrollPrintDocument";
import { payrollPayable } from "@/lib/finance/payroll-values";

type Props = {
  autoPrint: boolean;
  institutionCfg: {
    institution_name?: string | null; institution_label?: string | null; name?: string | null;
    institution_logo_url?: string | null; institution_head_name?: string | null; institution_head_title?: string | null;
  };
  selectedRun: { period_month: string; period_start: string; period_end: string; academic_year?: string | null; status: string };
  lines: Array<{ id: string; teacher_name_snapshot: string | null; actual_sessions: number; expected_sessions: number;
    gross_amount: number | string; lost_amount?: number | string | null; adjusted_amount?: number | string | null }>;
  totals: { actualSessions: number; gross: number; retained: number; payable: number };
  effectiveReferenceMinutes: number;
  effectiveLateTolerance: number;
  effectiveEarlyTolerance: number;
};
function formatMoney(value: number | string | null | undefined) {
  return `${Number(value ?? 0).toLocaleString("fr-FR")} F`;
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("fr-FR", { dateStyle: "medium", timeZone: "Africa/Abidjan" });
}
function formatMonthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "Africa/Abidjan" });
}
export default function PayrollPrintSheet({
  autoPrint, institutionCfg, selectedRun, lines, totals,
  effectiveReferenceMinutes, effectiveLateTolerance, effectiveEarlyTolerance,
}: Props) {
const institutionName = (institutionCfg.institution_name || institutionCfg.institution_label || institutionCfg.name || "Etablissement scolaire").trim();
    const headName = String(institutionCfg.institution_head_name || "").trim() || "Le responsable";
    const headTitle = String(institutionCfg.institution_head_title || "").trim() || "Chef d’établissement";
    return (
      <PayrollPrintDocument autoPrint={autoPrint}>
        <div className="mx-auto max-w-5xl">
          <div className="border-b-2 border-slate-900 pb-4 text-center">
            {institutionCfg.institution_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={institutionCfg.institution_logo_url} alt={`Logo de ${institutionName}`} width={80} height={80} loading="eager" className="mx-auto mb-3 h-20 w-20 object-contain" />
            ) : null}
            <div className="text-xl font-black uppercase">{institutionName}</div>
            <div className="mt-2 text-2xl font-black">État de paie des vacataires — {formatMonthLabel(selectedRun.period_month.slice(0, 7))}</div>
            <div className="mt-2 text-sm">Année scolaire : {selectedRun.academic_year || "Non renseignée"} · Du {formatDate(selectedRun.period_start)} au {formatDate(selectedRun.period_end)} · {selectedRun.status === "validated" ? "Validée" : selectedRun.status === "cancelled" ? "Annulée" : "Brouillon — à vérifier avant paiement"}</div>
            <div className="mt-2 text-sm">Séance de référence : {effectiveReferenceMinutes} min · Retard toléré : {effectiveLateTolerance} min · Sortie anticipée tolérée : {effectiveEarlyTolerance} min</div>
          </div>
          <table className="mt-6 w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 p-2 text-left">Enseignant</th>
                <th className="border border-slate-300 p-2 text-right">Séances</th>
                <th className="border border-slate-300 p-2 text-right">Brut</th>
                <th className="border border-slate-300 p-2 text-right">Retenue</th>
                <th className="border border-slate-300 p-2 text-right">À payer</th>
                <th className="w-[22%] border border-slate-300 p-2 text-center">Émargement</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr key={row.id}>
                  <td className="border border-slate-300 p-2 font-semibold">{row.teacher_name_snapshot || "Enseignant"}</td>
                  <td className="border border-slate-300 p-2 text-right">{row.actual_sessions} / {row.expected_sessions}</td>
                  <td className="border border-slate-300 p-2 text-right">{formatMoney(row.gross_amount)}</td>
                  <td className="border border-slate-300 p-2 text-right">{formatMoney(row.lost_amount)}</td>
                  <td className="border border-slate-300 p-2 text-right font-black">{formatMoney(payrollPayable(row))}</td>
                  <td className="h-14 border border-slate-300 p-2" aria-label={`Signature de ${row.teacher_name_snapshot || "l’enseignant"}`} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-black">
                <td className="border border-slate-300 p-2">TOTAL</td>
                <td className="border border-slate-300 p-2 text-right">{totals.actualSessions}</td>
                <td className="border border-slate-300 p-2 text-right">{formatMoney(totals.gross)}</td>
                <td className="border border-slate-300 p-2 text-right">{formatMoney(totals.retained)}</td>
                <td className="border border-slate-300 p-2 text-right">{formatMoney(totals.payable)}</td>
                <td className="border border-slate-300 p-2" />
              </tr>
            </tfoot>
          </table>
          <div className="payroll-signature mt-12 flex justify-end">
            <div className="min-w-64 text-center">
              <div className="font-bold">{headTitle}</div>
              <div className="mt-16 font-semibold">{headName}</div>
            </div>
          </div>
        </div>
      </PayrollPrintDocument>
    );
}

