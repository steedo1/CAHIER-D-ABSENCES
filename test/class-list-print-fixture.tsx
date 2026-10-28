// Synthetic data only: render the real class-list page and its print buttons.
import React from "react";
import { createRoot } from "react-dom/client";
import { CI_PRIMARY_FRENCH_REFERENCE, ciPrimaryFrenchDenominator } from "../src/lib/primary-french-reference-ci";
import { classListSubjectShortName } from "../src/lib/class-list-subjects";
import { resolveTeachingDocumentSignatories } from "../src/lib/franco-arabic-document-signatories";
import ClassListPage from "../src/app/admin/classes/liste/[id]/page";
import ClassListPrintEnhancer from "../src/components/ClassListPrintEnhancer";
const params = new URLSearchParams(location.search);
const count = Number(params.get("count") || 6);
const teaching = params.get("teaching");
const arabicRoster = params.has("arabic");
const signatureClassId = "33333333-3333-4333-8333-333333333333";
const signatureSettings = {
  school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
    teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french", "arabic"] } },
  school_teaching_signatories_v1: { version: 1,
    french: { name: "Responsable Français Démonstration" }, arabic: { name: "Responsable Arabe Démonstration" } },
  school_student_programs_v1: { version: 1, years: { "2026-2027": { classes: {
    [signatureClassId]: { tracks: teaching === "mixed" ? ["french", "arabic"] : [teaching], students: {} },
  } } } },
};
const students = Array.from({ length: count }, (_, index) => ({
  id: `s-${index}`, matricule: `1234567${String(index).padStart(2, "0")}A`,
  full_name_ar: arabicRoster && index < 2 ? (index === 0 ? "محمد تراوري" : "فاطمة كوني") : null,
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
    ...(params.has("primary") ? { school_cycle: "primary", mark_subjects: (arabicRoster ? [
      { code:"ar-lecture", label:"Lecture", value:10 },
      { code:"ar-coran", label:"Coran", value:10 },
    ] : CI_PRIMARY_FRENCH_REFERENCE).map((row: any) => ({
      id: row.code, name: row.label, shortName: classListSubjectShortName(row.label),
      denominator: arabicRoster ? 10 : ciPrimaryFrenchDenominator(params.get("level") || "CP1", row.code),
    })) } : {}),
    class: { id: "fixture", label: arabicRoster ? (params.has("primary") ? "CP1 — Arabe" : "6ème — Arabe")
      : params.has("primary") ? (params.get("level") || "CP1") + " Français" : "3e1",
      teaching_track: arabicRoster ? "arabic" : "french",
      level: arabicRoster ? params.has("primary") ? "CP1" : "6ème" : params.has("primary") ? params.get("level") || "CP1" : "3e",
      academic_year: "2026-2027", education_type: "general_secondary" },
    academic_year: { label: "2026-2027" }, can_edit: !arabicRoster,
    can_edit_arabic_names: arabicRoster,
    institution: { name: "COLLÈGE PRIVÉ DE DÉMONSTRATION DE YAMOUSSOUKRO", code: "000000",
      logo_url: params.has("noLogo") ? null : logo, email: "college.demonstration@example.invalid",
      regional_direction: "DRENA YAMOUSSOUKRO", status: "private", head_name: "KESSIE DÉSIRÉ OLIVIER",
      ...(teaching ? { document_signatories: resolveTeachingDocumentSignatories(signatureSettings, {
        academicYear: "2026-2027", classIds: [signatureClassId],
        institutionHeadName: "Administration Générale Démonstration", institutionHeadTitle: "Titre général configuré",
      }) } : {}) },
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
