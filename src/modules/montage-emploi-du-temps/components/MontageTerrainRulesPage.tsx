"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageTerrainRulesPage() {
  return (
    <MontageSectionShell
      title="Règles terrain"
      description="Centraliser les règles métier utilisées par le moteur HoraClasse intégré à Mon Cahier."
      cards={[
        { title: "Tandems PC/SVT", description: "Activer ou désactiver les tandems, avec mode parallèle ou rotation." },
    { title: "Qualité du montage", description: "Éviter les trous élèves, les trous enseignants et les retours inutiles." },
    { title: "Contraintes matières", description: "Gérer EPS, matières lourdes, demi-journées et salles spécialisées." }
      ]}
    />
  );
}
