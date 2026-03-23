import Link from "next/link";
import { AlertTriangle, Crown, Lock, School2 } from "lucide-react";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

export default async function FinanceLockedPage() {
  const access = await getFinanceAccessForCurrentUser();

  const title =
    access.reason === "subscription_expired"
      ? "Abonnement expiré"
      : access.reason === "finance_not_enabled"
      ? "Module Finance non activé"
      : access.reason === "no_institution"
      ? "Aucun établissement associé"
      : "Accès non disponible";

  const message =
    access.reason === "subscription_expired"
      ? "L’abonnement de votre établissement a expiré. Le module Gestion financière est momentanément indisponible."
      : access.reason === "finance_not_enabled"
      ? "Le module Gestion financière Premium n’a pas encore été accordé à votre établissement par le super administrateur."
      : access.reason === "no_institution"
      ? "Votre compte n’est rattaché à aucun établissement. Merci de contacter l’administrateur."
      : "Vous devez être connecté avec un compte valide pour accéder à cette section.";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <Crown className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              {title}
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              {message}
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <School2 className="h-4 w-4" />
              Statut du module
            </div>

            <div className="mt-3 space-y-2 text-sm text-slate-200">
              <div>
                Premium activé :{" "}
                <span className="font-bold">
                  {access.premiumEnabled ? "Oui" : "Non"}
                </span>
              </div>
              <div>
                Abonnement valide :{" "}
                <span className="font-bold">
                  {access.subscriptionValid ? "Oui" : "Non"}
                </span>
              </div>
              <div>
                Expiration :{" "}
                <span className="font-bold">{access.expiresAt || "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Lock className="h-4 w-4 text-emerald-600" />
            Ce module comprend
          </div>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li>• Frais scolaires</li>
            <li>• Encaissements</li>
            <li>• Reçus</li>
            <li>• Impayés</li>
            <li>• Dépenses</li>
            <li>• Rapports financiers</li>
          </ul>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Condition d’accès
          </div>
          <div className="mt-4 text-sm leading-6 text-slate-600">
            L’établissement doit avoir :
            <div className="mt-3 space-y-2">
              <div>• un abonnement encore valide</div>
              <div>• le module Finance Premium accordé</div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            Navigation
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
            >
              Retour au tableau de bord
            </Link>

            <Link
              href="/admin/parametres"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Ouvrir les paramètres
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}