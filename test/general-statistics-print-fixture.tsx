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
  nationality: index % 4 === 0 ? "IVOIRIENNE" : index % 4 === 1 ? "MALIENNE" : index % 4 === 2 ? "BURKINABE" : null,
  full_name: `ÉLÈVE ${String(index * 14 + copy).padStart(4, "0")} Prénoms de démonstration`,
  first_name: "Prénoms de démonstration", last_name: "ÉLÈVE", regime: null,
})));
if (params.has("bilingual")) for (const item of items) Object.assign(item, {
  school_cycle: "secondary", teaching_tracks: ["french", "arabic"],
  program_class_ids: { french: item.class_id, arabic: "ar-" + item.class_id },
  program_class_labels: { french: item.class_label + " — Français", arabic: item.class_label + " — Arabe" },
});
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
const academicRequests: string[] = [];
const academicState = { fail: params.has("academic-failure") };
Object.assign(window, { __statisticsBulletinRequests: academicRequests, __statisticsAcademicState: academicState });
const periods = [1, 2, 3].map((term) => ({ id: `t${term}`, label: `Trimestre ${term}`, coeff: term === 1 ? 1 : 2,
  start_date: [`2026-09-01`, `2027-01-01`, `2027-04-01`][term - 1],
  end_date: [`2026-12-31`, `2027-03-31`, `2027-07-31`][term - 1], class_ids: classes.map((row) => row.class_id) }));
window.fetch = async (input, init) => {
  const url = String(input);
  if (url === "/api/admin/statistiques-generales") return Response.json({ items, academic_year: "2026-2027",
    can_filter_averages: true, academic_periods: periods,
    ...(params.has("bilingual") ? { school_configuration: { enabled: true, enabled_cycles: ["secondary"],
      teaching_tracks_by_cycle: { secondary: ["french", "arabic"] } } } : {}) });
  if (url === "/api/admin/institution/settings") return Response.json(institution);
  if (url.startsWith("/api/admin/grades/bulletin?")) {
    academicRequests.push(url);
    if (academicState.fail) return Response.json({ ok: false }, { status: 503 });
    const query = new URL(url, location.origin).searchParams;
    const period = periods.find((row) => row.start_date === query.get("from"))!;
    if (!period || query.get("export_light") !== "1" || init?.method && init.method !== "GET") throw new Error("Invalid academic fixture request");
    if (params.has("slow")) await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 100);
      init?.signal?.addEventListener("abort", () => { clearTimeout(timeout); reject(new DOMException("aborted", "AbortError")); }, { once: true });
    });
    const general = [[0, 10, 12.5, 15, 20, null], [5, 11, 13, 16, 18, null], [8, 12, 14, 17, 16, null]];
    const math = [[18, 16, 14, 12, 0, null], [16, 14, 12, 10, 0, null], [14, 12, 10, 8, 0, null]];
    const term = periods.indexOf(period);
    return Response.json({ ok: true, class: { id: query.get("class_id"), academic_year: "2026-2027" },
      period: { from: period.start_date, to: period.end_date },
      subjects: [{ subject_id: "math", subject_name: "Mathématiques" }, { subject_id: "fr", subject_name: "Français" }],
      items: items.filter((student) => student.class_id === query.get("class_id")).map((student) => {
        const index = Number(student.id.split("-")[0]) % 6;
        return { student_id: student.id, general_avg: general[term][index],
          // The first official annual value includes a council adjustment.
          annual_avg: [10, 11.2, 13.3, 16.2, 17.6, null][index],
          coverage: { is_complete: true }, annual_coverage: { is_complete: true },
          per_subject: [{ subject_id: "math", avg20: math[term][index] }, { subject_id: "fr", avg20: general[term][index] }] };
      }) });
  }
  throw new Error(`Unexpected fixture request: ${url}`);
};
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <div className="grid min-h-screen md:grid-cols-[180px_1fr] bg-slate-50">
    <aside className="sticky top-0 hidden h-screen md:block">Navigation à masquer à l’impression</aside>
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6 pb-20"><GeneralStatisticsPage /></main>
  </div>
</React.StrictMode>);
