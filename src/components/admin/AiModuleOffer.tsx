import { AI_ACTIVATION_CONTACT } from "@/lib/mon-cahier-ai/product";

export default function AiModuleOffer() {
  return <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 text-slate-800">
    <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Module optionnel payant</p>
    <h2 className="mt-2 text-xl font-black text-slate-950">Activez Mon Cahier IA</h2>
    <p className="mt-3 text-sm leading-6">Un assistant pédagogique pour exploiter les données de votre établissement et préparer vos actions.</p>
    <ul className="mt-4 space-y-2 text-sm">
      <li>Analyse des résultats et des matières à renforcer</li>
      <li>Repérage des élèves à accompagner</li>
      <li>Plans de remédiation et préparation des conseils de classe</li>
    </ul>
    <p className="mt-4 text-sm leading-6">L’activation de ce module est accordée par Nexa Digital, séparément de votre abonnement Mon Cahier.</p>
    <a href={AI_ACTIVATION_CONTACT} target="_blank" rel="noopener noreferrer"
      className="mt-4 inline-flex rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800">Demander l’activation</a>
    <p className="mt-3 text-xs text-slate-500">Vos décisions pédagogiques restent soumises à votre validation.</p>
  </section>;
}
