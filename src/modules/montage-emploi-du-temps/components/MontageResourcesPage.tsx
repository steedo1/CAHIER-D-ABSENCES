"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageResourcesPage() {
  return (
    <MontageSectionShell
      title="Salles & ressources"
      description="Préparer les salles ordinaires, laboratoires, salle informatique et terrain EPS."
      cards={[
        { title: "Salles principales", description: "Associer une salle principale à chaque classe si l’établissement le souhaite." },
    { title: "Salles spécialisées", description: "Préparer PC, SVT, informatique et autres ressources limitées." },
    { title: "Terrain EPS", description: "Gérer le nombre de cours EPS simultanés autorisés selon les terrains disponibles." }
      ]}
    />
  );
}
