// Synthetic data only: render the real class-list page and its print buttons.
import React from "react";
import { createRoot } from "react-dom/client";
import { CI_PRIMARY_FRENCH_REFERENCE, ciPrimaryFrenchDenominator } from "../src/lib/primary-french-reference-ci";
import { classListSubjectShortName } from "../src/lib/class-list-subjects";
import ClassListPage from "../src/app/admin/classes/liste/[id]/page";
import ClassListPrintEnhancer from "../src/components/ClassListPrintEnhancer";
const params = new URLSearchParams(location.search);
const count = Number(params.get("count") || 6);
const students = Array.from({ length: count }, (_, index) => ({
  id: `s-${index}`, matricule: `1234567${String(index).padStart(2, "0")}A`,
  full_name: `ÉLÈVE${String(index).padStart(3, "0")} ${params.has("long")
    ? "Prénoms particulièrement longs Marie Angélique Désirée Christelle Emmanuelle Jacqueline Amandine Élisabeth"
    : "Marie Angélique Désirée Christelle"}`,
  gender: index % 2 ? "F" : "M", birthdate: "2011-12-06",
  nationality: "Ivoirienne", is_repeater: index % 3 === 0,
  is_affecte: index % 2 === 0, parent_names: null, parent_contact: null,
  birth_place: null, lv2: null, enrollment_start_date: null,
}));
const logo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><circle cx="90" cy="90" r="82" fill="none" stroke="#0f766e" stroke-width="8"/><path d="M40 55h40l10 12 10-12h40v65h-40l-10 12-10-12H40z" fill="#b91c1c"/><text x="90" y="155" text-anchor="middle" fill="#0f766e" font-size="18">ÉCOLE TEST</text></svg>');
window.fetch = async (input) => {
  if (String(input).startsWith("/api/admin/classes/fixture/roster")) return Response.json({
    ...(params.has("primary") ? { school_cycle: "primary", mark_subjects: CI_PRIMARY_FRENCH_REFERENCE.map(row => ({
      id: row.code, name: row.label, shortName: classListSubjectShortName(row.label),
      denominator: ciPrimaryFrenchDenominator(params.get("level") || "CP1", row.code),
    })) } : {}),
    class: { id: "fixture", label: params.has("primary") ? (params.get("level") || "CP1") + " Français" : "3e1", level: params.has("primary") ? params.get("level") || "CP1" : "3e", academic_year: "2026-2027", education_type: "general_secondary" },
    academic_year: { label: "2026-2027" }, can_edit: true,
    institution: { name: "COLLÈGE PRIVÉ DE DÉMONSTRATION DE YAMOUSSOUKRO", code: "000000",
      logo_url: params.has("noLogo") ? null : logo, email: "college.demonstration@example.invalid",
      regional_direction: "DRENA YAMOUSSOUKRO", status: "private", head_name: "KESSIE DÉSIRÉ OLIVIER" },
    staff: { head_teacher: { id: "teacher", display_name: "KOFFI CHIMÈNE" }, educators: [] },
    students, totals: { students: count, girls: Math.floor(count / 2), boys: Math.ceil(count / 2) },
  });
  throw new Error(`Unexpected fixture request: ${input}`);
};
(window as any).__printCalls = 0;
window.print = () => { (window as any).__printCalls += 1; };
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: "2200px" }}>
    <aside style={{ height: "2500px" }}>Navigation à masquer</aside>
    <div style={{ minHeight: "2200px" }}><ClassListPage /></div>
  </div>
  <ClassListPrintEnhancer />
</React.StrictMode>);
