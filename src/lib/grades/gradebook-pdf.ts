/**
 * Impression PDF du cahier de notes, à partir des données déjà chargées à l'écran.
 * Aucune requête, aucun calcul de moyenne, aucune écriture en base.
 */
export type GradebookPdfStudent = {
  id: string;
  full_name: string;
  matricule: string | null;
};

export type GradebookPdfEvaluation = {
  id: string;
  label: string;
  eval_date: string;
  scale: number;
  component_label?: string | null;
};

export type GradebookPdfData = {
  institution: string | null;
  academicYear: string | null;
  classLabel: string;
  subjectLabel: string | null;
  teachingLabel?: string | null;
  periodLabel?: string | null;
  students: GradebookPdfStudent[];
  evaluations: GradebookPdfEvaluation[];
  /** Notes déjà enregistrées et chargées dans le cahier, jamais les brouillons locaux. */
  grades: Record<string, Record<string, number | null>>;
};

function html(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formattedDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function formattedGrade(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

const EVALUATIONS_PER_SHEET = 4;

export function buildGradebookPdfHtml(data: GradebookPdfData): string {
  const students = [...data.students].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, "fr", { sensitivity: "base", numeric: true })
  );
  const evaluationGroups: GradebookPdfEvaluation[][] = [];
  for (let offset = 0; offset < data.evaluations.length; offset += EVALUATIONS_PER_SHEET) {
    evaluationGroups.push(data.evaluations.slice(offset, offset + EVALUATIONS_PER_SHEET));
  }
  if (evaluationGroups.length === 0) evaluationGroups.push([]);

  const generatedAt = new Date().toLocaleDateString("fr-FR");
  const pages = evaluationGroups.map((group, groupIndex) => {
    const columnCount = 3 + group.length;
    const first = groupIndex * EVALUATIONS_PER_SHEET + 1;
    const last = first + group.length - 1;
    const evalInfo = group.length
      ? `Évaluations ${first} à ${last} sur ${data.evaluations.length}`
      : "Aucune évaluation enregistrée";

    const columns = group.map((evaluation) => {
      const component = evaluation.component_label ? `<span class="component" dir="auto">${html(evaluation.component_label)}</span>` : "";
      return `<th class="grade-head"><span dir="auto">${html(evaluation.label)}</span>${component}<small>${html(formattedDate(evaluation.eval_date))} · /${html(evaluation.scale)}</small></th>`;
    }).join("");

    const rows = students.map((student, index) => {
      const notes = group.map((evaluation) => {
        const value = data.grades[evaluation.id]?.[student.id];
        return `<td class="grade">${html(formattedGrade(value))}</td>`;
      }).join("");
      return `<tr><td class="index">${index + 1}</td><td class="matricule">${html(student.matricule || "—")}</td><td class="student" dir="auto">${html(student.full_name)}</td>${notes}</tr>`;
    }).join("");

    return `<section class="sheet">
      <table>
        <colgroup><col class="col-index"><col class="col-matricule"><col class="col-student">${group.map(() => '<col class="col-grade">').join("")}</colgroup>
        <thead>
          <tr class="title-row"><th colspan="${columnCount}">
            <div class="institution" dir="auto">${html(data.institution || "Établissement scolaire")}</div>
            <div class="title">CAHIER DE NOTES — LISTE DES ÉLÈVES ET NOTES</div>
            <div class="details">
              <span>Classe : <strong dir="auto">${html(data.classLabel)}</strong></span>
              <span>Matière : <strong dir="auto">${html(data.subjectLabel || "—")}</strong></span>
              ${data.teachingLabel ? `<span>${html(data.teachingLabel)}</span>` : ""}
              ${data.periodLabel ? `<span>Période : ${html(data.periodLabel)}</span>` : ""}
              ${data.academicYear ? `<span>Année scolaire : ${html(data.academicYear)}</span>` : ""}
            </div>
            <div class="details secondary"><span>${html(evalInfo)}</span><span>Effectif : ${students.length}</span><span>Édité le ${html(generatedAt)}</span></div>
          </th></tr>
          <tr class="column-head"><th>N°</th><th>Matricule</th><th>Nom et prénoms</th>${columns}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cahier de notes — ${html(data.classLabel)} — ${html(data.subjectLabel || "")}</title>
<style>
  @page { size: A4 landscape; margin: 11mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: white; color: #111; font-family: Arial, "Noto Naskh Arabic", sans-serif; font-size: 10.5pt; }
  .sheet { page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  col.col-index { width: 6%; }
  col.col-matricule { width: 17%; }
  col.col-student { width: 37%; }
  col.col-grade { width: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 0.6pt solid #444; padding: 5pt 5pt; vertical-align: middle; }
  .title-row th { border: 0; padding: 0 0 9pt; text-align: center; }
  .institution { font-size: 12pt; font-weight: bold; margin-bottom: 3pt; }
  .title { font-size: 13pt; font-weight: bold; margin-bottom: 6pt; }
  .details { display: flex; flex-wrap: wrap; justify-content: center; gap: 4pt 14pt; font-size: 10pt; font-weight: normal; margin-bottom: 4pt; }
  .details.secondary { font-size: 9.5pt; margin: 3pt 0 0; }
  .column-head { background: #f4f4f4; }
  .column-head th { font-size: 9.5pt; text-align: center; font-weight: bold; }
  .column-head th:nth-child(3) { text-align: left; }
  .grade-head small, .grade-head .component { display: block; font-size: 9pt; font-weight: normal; margin-top: 2pt; overflow-wrap: anywhere; }
  td.index, td.grade { text-align: center; font-variant-numeric: tabular-nums; }
  td.matricule { font-size: 10pt; white-space: nowrap; }
  td.student { font-weight: 500; white-space: nowrap; font-size: 10pt; letter-spacing: -0.1pt; }
  @media screen { body { padding: 10mm; } .sheet { margin-bottom: 20mm; } }
</style>
</head>
<body>${pages}</body>
</html>`;
}

/** Ouvre l'impression native, qui permet « Enregistrer au format PDF » sur mobile et PC. */
export function openGradebookPdf(data: GradebookPdfData): boolean {
  if (typeof window === "undefined") return false;
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.open();
  popup.document.write(buildGradebookPdfHtml(data));
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 300);
  return true;
}
