"use client";

import MontageSectionShell from "./MontageSectionShell";

export default function MontageVolumesPage() {
  return (
    <MontageSectionShell
      title="Volumes horaires"
      description="Configurer les volumes hebdomadaires et les découpages nécessaires au vrai moteur de montage."
      cards={[
        { title: "Volume hebdomadaire", description: "Définir le nombre d’heures par classe, matière et enseignant." },
    { title: "Découpage", description: "Préparer les formats 1h, 2h, 2+1, 2+2 ou autres selon les réalités de l’établissement." },
    { title: "Sécurité moteur", description: "Le moteur ne doit pas inventer un volume horaire manquant." }
      ]}
    />
  );
}
