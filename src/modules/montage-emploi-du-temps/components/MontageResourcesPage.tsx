"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageResourcesPage() {
  return (
    <MontageSectionShell
      title="Salles & ressources"
      description="Préparer le modèle HoraClasse des salles : salles ordinaires, laboratoires, terrain EPS et salle informatique."
      status="Ressources HoraClasse"
      note="Les ressources alimentent rooms et roomPreferences dans SchedulerContext. Les matières peuvent demander un roomTypeRequired : pc_lab, svt_lab, sports_field, computer_lab ou ordinary."
      cards={[
        {
          title: "Salles ordinaires",
          description: "Salle principale de classe ou salle autorisée selon les préférences de la classe.",
        },
        {
          title: "Salles spécialisées",
          description: "Laboratoire P.C, laboratoire SVT, salle informatique et autres ressources spécialisées.",
        },
        {
          title: "Terrain EPS",
          description: "Gestion comme ressource partagée avec capacité simultanée selon les règles terrain.",
        },
      ]}
    />
  );
}
