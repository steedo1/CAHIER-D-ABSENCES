"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontagePublicationPage() {
  return (
    <MontageSectionShell
      title="Publication"
      description="Publier uniquement après validation du vrai résultat HoraClasse et sauvegarde de l’ancien emploi du temps officiel."
      status="Sécurité Mon Cahier"
      note="La publication ne doit pas se déclencher tant que le moteur réel, les diagnostics et l’aperçu officiel ne sont pas validés."
      cards={[
        {
          title: "Validation obligatoire",
          description: "Aucun conflit classe/professeur/salle et aucun champ obligatoire manquant.",
        },
        {
          title: "Sauvegarde automatique",
          description: "L’ancien teacher_timetables est sauvegardé avant remplacement.",
        },
        {
          title: "Écriture officielle",
          description: "Seule la publication écrit dans teacher_timetables et alimente les appels.",
        },
      ]}
    />
  );
}
