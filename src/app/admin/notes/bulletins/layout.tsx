import { redirect } from "next/navigation";

// Ancienne route conservée uniquement pour les favoris historiques.
// Toutes les impressions doivent passer par la page canonique, qui enregistre
// les originaux et les duplicatas.
export default function LegacyBulletinsLayout() {
  redirect("/admin/bulletins");
}
