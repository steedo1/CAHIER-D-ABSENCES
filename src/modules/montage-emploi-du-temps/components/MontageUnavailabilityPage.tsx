"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageUnavailabilityPage() {
  return (
    <MontageSectionShell
      title="Indisponibilités"
      description="Préparer la gestion des indisponibilités strictes et préférences des enseignants."
      cards={[
        { title: "Indisponibilité stricte", description: "Empêcher le moteur de placer un professeur sur un créneau interdit." },
    { title: "Préférence", description: "Permettre une contrainte souple qui influence le score sans bloquer totalement." },
    { title: "Récurrence", description: "Préparer les cas matin, après-midi, jour complet ou période donnée." }
      ]}
    />
  );
}
