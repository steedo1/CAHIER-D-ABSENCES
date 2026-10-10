// Synthetic records only. Exercise the real page without contacting any API/database.
import React from "react";
import { createRoot } from "react-dom/client";
import GeneralStatisticsPage from "../src/app/admin/finance/statistiques-generales/page";

const params = new URLSearchParams(location.search);
const classes = [
  { class_id: "c1", class_label: "1A", level: "1re A" },
  { class_id: "c2", class_label: "1A2", level: "1re A" },
  { class_id: "c3", class_label: "3e1", level: "3e" },
];
const items = classes.flatMap((classroom) => ["M", "F"].flatMap((gender) =>
  [true, false].flatMap((is_boarder) => [true, false].map((is_affecte) => ({
    ...classroom, gender, is_boarder, is_affecte, is_scholarship: !is_affecte,
    birthdate: "2011-01-01", lv2: is_boarder ? "Espagnol" : "Allemand",
  }))),
)).flatMap((student, index) => Array.from({ length: params.has("long") ? 14 : 1 }, (_, copy) => ({
  ...student, id: `${index}-${copy}`, matricule: `TEST${String(index * 14 + copy).padStart(4, "0")}`,
  full_name: `ÉLÈVE ${String(index * 14 + copy).padStart(4, "0")} Prénoms de démonstration`,
  first_name: "Prénoms de démonstration", last_name: "ÉLÈVE", regime: null,
})));
if (params.has("unknown")) Object.assign(items.at(-1)!, { class_id: null, class_label: null });
if (params.has("single")) items.splice(8);
const institution = {
  institution_name: "ÉTABLISSEMENT DE DÉMONSTRATION", institution_code: "000000",
  institution_phone: "00 00 00 00 00", institution_email: "demo@example.invalid",
  institution_postal_address: "BP 000 — Ville de démonstration",
  country_name: "République de Côte d’Ivoire", country_motto: "Union - Discipline - Travail",
  ministry_name: params.has("general")
    ? "MINISTÈRE DE L’ÉDUCATION NATIONALE DE L’ALPHABÉTISATION"
    : "MINISTÈRE DE L’ÉDUCATION NATIONALE DE L’ALPHABÉTISATION ET DE L’ENSEIGNEMENT TECHNIQUE",
  institution_logo_url: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#047857"/><text x="30" y="36" text-anchor="middle" fill="white" font-size="12">TEST</text></svg>'),
};
window.fetch = async (input) => {
  const url = String(input);
  if (url === "/api/admin/statistiques-generales") return Response.json({ items, academic_year: "2026-2027" });
  if (url === "/api/admin/institution/settings") return Response.json(institution);
  throw new Error(`Unexpected fixture request: ${url}`);
};
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <div className="grid min-h-screen grid-cols-[180px_1fr] bg-slate-50">
    <aside className="sticky top-0 h-screen">Navigation à masquer à l’impression</aside>
    <main className="mx-auto max-w-7xl px-4 py-6 pb-20"><GeneralStatisticsPage /></main>
  </div>
</React.StrictMode>);
