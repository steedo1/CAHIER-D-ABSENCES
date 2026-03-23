import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  FileText,
  Receipt,
  Wallet,
} from "lucide-react";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

function FeatureCard({
  icon,
  title,
  description,
  href = "#",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            {icon}
          </div>
          <h3 className="mt-4 text-lg font-black text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <ArrowRight className="mt-1 h-5 w-5 text-slate-400" />
      </div>
    </Link>
  );
}

export default async function AdminFinancePage() {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Tableau de bord financier
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Le module est actif pour votre établissement. Cette page sert
              d’entrée vers les frais scolaires, les encaissements, les reçus,
              les impayés, les dépenses et les rapports financiers.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              Statut
            </div>
            <div className="mt-2 text-lg font-black text-white">
              Premium actif
            </div>
            <div className="mt-1 text-sm text-slate-200">
              Expiration : {access.expiresAt || "—"}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FeatureCard
          icon={<Wallet className="h-5 w-5" />}
          title="Frais scolaires"
          description="Configurer les catégories de frais, les montants, les échéances et les dettes par élève."
          href="/admin/finance/fees"
        />

        <FeatureCard
          icon={<CreditCard className="h-5 w-5" />}
          title="Encaissements"
          description="Enregistrer les paiements, gérer les montants reçus et suivre les règlements."
          href="/admin/finance/payments"
        />

        <FeatureCard
          icon={<Receipt className="h-5 w-5" />}
          title="Reçus"
          description="Consulter les reçus générés, réimprimer et suivre l’historique d’encaissement."
          href="/admin/finance/receipts"
        />

        <FeatureCard
          icon={<FileText className="h-5 w-5" />}
          title="Impayés"
          description="Identifier les soldes restants, les échéances dépassées et les dossiers à relancer."
          href="/admin/finance/arrears"
        />

        <FeatureCard
          icon={<Wallet className="h-5 w-5" />}
          title="Dépenses"
          description="Suivre les dépenses de l’établissement par catégorie, date et justificatif."
          href="/admin/finance/expenses"
        />

        <FeatureCard
          icon={<BarChart3 className="h-5 w-5" />}
          title="Rapports"
          description="Préparer les synthèses financières, exports et indicateurs de pilotage."
          href="/admin/finance/reports"
        />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          Étape suivante
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Le Premium Finance est maintenant branché côté accès. La prochaine
          étape consiste à construire les vraies pages métiers :
          <span className="font-semibold text-slate-800">
            {" "}
            frais, paiements, reçus, impayés, dépenses et rapports.
          </span>
        </p>
      </section>
    </div>
  );
}