"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontagePublicationPage() {
  return (
    <MontageSectionShell
      title="Publication"
      description="Préparer la publication officielle vers les emplois du temps utilisés par les appels."
      cards={[
        { title: "Validation", description: "Publier seulement après vérification des conflits et volumes horaires." },
    { title: "Sauvegarde", description: "Créer un backup automatique avant remplacement de l’ancien EDT." },
    { title: "Sécurité", description: "Ne jamais toucher aux appels, notes ou absences pendant la génération brouillon." }
      ]}
    />
  );
}
