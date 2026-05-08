"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageGenerationPage() {
  return (
    <MontageSectionShell
      title="Services & génération"
      description="Respecter le flux HoraClasse : référentiel → services → affectation professeurs → génération → diagnostics."
      status="Flux HoraClasse"
      note="La génération doit appeler le vrai scheduler HoraClasse, pas le moteur provisoire. Le résultat attendu contient placements, unplacedBlocks, warnings et globalScore."
      cards={[
        {
          title: "Services",
          description: "Les volumes par défaut deviennent des services à affecter à des professeurs.",
        },
        {
          title: "Affectation",
          description: "Les professeurs sont associés aux services selon leurs matières et charges disponibles.",
        },
        {
          title: "Diagnostics",
          description: "Le moteur retourne les placements, blocs non placés, alertes et score global.",
        },
      ]}
    />
  );
}
