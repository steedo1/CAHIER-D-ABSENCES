"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageUnavailabilityPage() {
  return (
    <MontageSectionShell
      title="Indisponibilités"
      description="Préparer l’intégration du modèle HoraClasse des indisponibilités enseignants : contrainte stricte ou préférence."
      status="Modèle HoraClasse"
      note="Les indisponibilités doivent alimenter teacherUnavailability dans SchedulerContext. Une contrainte stricte bloque le placement ; une préférence oriente le score."
      cards={[
        {
          title: "Contraintes strictes",
          description: "Le professeur ne peut jamais être placé sur ce jour, demi-journée ou créneau.",
        },
        {
          title: "Préférences",
          description: "Le moteur peut éviter ces périodes sans bloquer totalement la génération.",
        },
        {
          title: "Données moteur",
          description: "Chaque indisponibilité devient teacherId, dayIndex, periodIndex ou halfDay, constraintType et reason.",
        },
      ]}
    />
  );
}
