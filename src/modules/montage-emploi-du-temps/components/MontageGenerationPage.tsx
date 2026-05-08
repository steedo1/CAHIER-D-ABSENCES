"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageGenerationPage() {
  return (
    <MontageSectionShell
      title="Brouillons & génération"
      description="Créer, générer, régénérer et contrôler les brouillons d’emploi du temps."
      cards={[
        { title: "Brouillon", description: "Sauvegarder une copie des données Mon Cahier avant génération." },
    { title: "Génération", description: "Appeler le vrai moteur métier quand les volumes et règles sont prêts." },
    { title: "Diagnostics", description: "Afficher les cours non placés, avertissements et erreurs bloquantes." }
      ]}
    />
  );
}
