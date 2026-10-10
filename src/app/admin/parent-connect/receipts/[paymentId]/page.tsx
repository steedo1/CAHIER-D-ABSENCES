import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireInstitutionAccess } from "@/app/api/admin/_helpers/institutionAccess";
import { PARENT_CONNECT_READ_ROLES, parentConnectEndLabel } from "@/lib/parent-connect/domain";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
const methods: Record<string, string> = { cash: "Espèces", wave: "Wave", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", bank_transfer: "Virement bancaire" };
const date = (value: string) => new Date(value).toLocaleDateString("fr-FR");

export default async function Receipt({ params }: { params: Promise<{ paymentId: string }> }) {
  const access = await requireInstitutionAccess({ allowedRoles: PARENT_CONNECT_READ_ROLES });
  if (access.error) redirect("/login");
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) notFound();
  const [payment, institution] = await Promise.all([
    access.srv.from("parent_connect_payments").select("academic_year,receipt_no,student_name,matricule,payer_name,sms_phone_e164,payment_method,payment_reference,amount,starts_at,ends_at,created_at").eq("id", paymentId).eq("institution_id", access.institutionId).maybeSingle(),
    access.srv.from("institutions").select("name").eq("id", access.institutionId).single(),
  ]);
  if (payment.error || !payment.data) notFound();
  const p = payment.data;
  return <div className="mx-auto max-w-3xl p-4 sm:p-8">
    <div className="mb-6 flex items-center justify-between print:hidden"><Link href="/admin/parent-connect" prefetch={false} className="text-sm font-semibold text-slate-600">Retour aux abonnements</Link><PrintButton /></div>
    <article id="parent-connect-receipt" className="rounded-2xl border bg-white p-8 text-slate-900">
      <header className="border-b pb-6"><p className="text-xl font-bold">{institution.data?.name || "Établissement"}</p><p className="mt-1 text-sm text-emerald-800">Mon Cahier · Parent Connect</p><h1 className="mt-6 text-2xl font-bold">Reçu d’abonnement Parent Connect</h1><p className="mt-2 break-all text-sm">N° {p.receipt_no}</p><p className="mt-1 text-sm">Émis le {date(p.created_at)}</p></header>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 text-sm"><dt>Élève</dt><dd className="font-semibold">{p.student_name}</dd><dt>Matricule</dt><dd>{p.matricule}</dd><dt>Payeur</dt><dd>{p.payer_name}</dd><dt>Numéro SMS</dt><dd>{p.sms_phone_e164}</dd><dt>Règlement</dt><dd>{methods[p.payment_method] || p.payment_method}</dd>{p.payment_reference ? <><dt>Référence</dt><dd className="break-all">{p.payment_reference}</dd></> : null}<dt>Abonnement</dt><dd>Année scolaire {p.academic_year} · du {date(p.starts_at)} au {parentConnectEndLabel(p.ends_at)} inclus</dd><dt>Montant reçu</dt><dd className="text-xl font-bold">{Number(p.amount).toLocaleString("fr-FR")} FCFA</dd></dl>
      <div className="mt-8 rounded-xl bg-slate-50 p-4 text-sm leading-6"><strong>Connexion par matricule</strong><p>Ouvrez www.mon-cahier.com/parents/login et saisissez le matricule de l’enfant. Cet abonnement couvre les parents qui suivent cet enfant.</p></div>
      <p className="mt-6 text-xs text-slate-500">Paiement Parent Connect distinct des frais de scolarité. Les SMS sont envoyés selon les autorisations activées par Nexa pour cet établissement.</p><footer className="mt-10 border-t pt-4 text-center text-xs text-slate-500">www.mon-cahier.com · Nexa Digital SARL</footer>
    </article>
    <style>{`@media print { body * { visibility: hidden; } #parent-connect-receipt, #parent-connect-receipt * { visibility: visible; } #parent-connect-receipt { position: absolute; left: 0; top: 0; width: 100%; border: 0; border-radius: 0; padding: 16mm; } @page { size: A4; margin: 0; } }`}</style>
  </div>;
}
