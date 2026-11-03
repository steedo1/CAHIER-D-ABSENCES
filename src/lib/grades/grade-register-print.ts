/**
 * Export d'un cahier de notes à partir des données déjà chargées dans l'interface.
 * Aucune nouvelle requête réseau, aucun recalcul ni écriture en base.
 */
export type GradeRegisterStudent = {
  id: string;
  full_name: string;
  matricule?: string | null;
};

export type GradeRegisterEvaluation = {
  id: string;
  label: string;
  scale: number;
  eval_date?: string | null;
  coeff?: number | null;
  component?: string | null;
};

export type GradeRegisterPrintInput = {
  institutionName?: string | null;
  academicYear?: string | null;
  className: string;
  subjectName?: string | null;
  periodName?: string | null;
  teachingName?: string | null;
  students: GradeRegisterStudent[];
  evaluations: GradeRegisterEvaluation[];
  grades: Record<string, Record<string, number | null>>;
};

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formattedGrade(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function formattedDate(iso?: string | null): string {
  if (!iso) return "";
  const parts = iso.slice(0, 10).split("-");
  return parts.length === 3 ? parts.reverse().join("/") : iso;
}

export function buildGradeRegisterPrintHtml(input: GradeRegisterPrintInput): string {
  const withMatricule = input.students.some((student) => Boolean(student.matricule));
  const students = [...input.students].sort((a, b) =>
    (a.full_name || "").localeCompare(b.full_name || "", "fr", { sensitivity: "base" }),
  );
  // Quatre colonnes par tableau pour conserver une police lisible sur A4 paysage.
  const pages: GradeRegisterEvaluation[][] = [];
  for (let i = 0; i < input.evaluations.length; i += 4) {
    pages.push(input.evaluations.slice(i, i + 4));
  }
  if (!pages.length) pages.push([]);

  const school = htmlEscape(input.institutionName || "Établissement scolaire");
  const className = htmlEscape(input.className);
  const info = [
    input.academicYear ? "Année scolaire : " + input.academicYear : "",
    "Classe : " + input.className,
    input.subjectName ? "Matière : " + input.subjectName : "",
    input.teachingName ? input.teachingName : "",
    input.periodName ? "Période : " + input.periodName : "",
  ].filter(Boolean).map(htmlEscape).join(" &nbsp; • &nbsp; ");

  const sheets = pages.map((evaluations, sheetIndex) => {
    const head = evaluations.map((ev) => {
      const desc = [
        "/" + ev.scale,
        ev.component || "",
        formattedDate(ev.eval_date),
        ev.coeff != null ? "Coeff. " + ev.coeff : "",
      ].filter(Boolean).map(htmlEscape).join(" · ");
      return '<th class="note-col">' + htmlEscape(ev.label) +
        '<span class="detail">' + desc + "</span></th>";
    }).join("");

    const rows = students.map((student, index) => {
      const noteCells = evaluations.map((ev) =>
        '<td class="score">' + htmlEscape(formattedGrade(input.grades[ev.id]?.[student.id])) + "</td>",
      ).join("");
      return '<tr><td class="order">' + (index + 1) + '</td>' +
        (withMatricule ? '<td class="matricule">' + htmlEscape(student.matricule || "") + '</td>' : '') +
        '<td class="name" dir="auto">' + htmlEscape(student.full_name) + '</td>' +
        noteCells + "</tr>";
    }).join("");

    return '<section class="sheet">' +
      '<header><div class="school">' + school + '</div>' +
      '<h1>CAHIER DE NOTES</h1>' +
      '<div class="meta">' + info + '</div>' +
      (pages.length > 1 ? '<div class="columns">Évaluations ' + (sheetIndex * 4 + 1) +
        ' à ' + (sheetIndex * 4 + evaluations.length) + ' sur ' + input.evaluations.length + '</div>' : '') +
      '</header>' +
      '<table><colgroup><col style="width:5%">' +
      (withMatricule ? '<col style="width:13%"><col style="width:42%">' : '<col style="width:55%">') +
      evaluations.map(() => '<col style="width:' + (withMatricule ? 40 / Math.max(1, evaluations.length) : 40 / Math.max(1, evaluations.length)) + '%">').join('') +
      '</colgroup><thead><tr><th>N°</th>' +
      (withMatricule ? '<th>Matricule</th>' : '') +
      '<th class="name-head">Nom et prénoms</th>' + head + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }).join("");

  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Cahier de notes - ' + className + '</title>' +
    '<style>' +
    '@page{size:A4 landscape;margin:12mm 11mm}' +
    '*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Arabic",sans-serif;color:#111;margin:0}' +
    '.print-action{display:block;margin:12px auto;padding:10px 16px;font-size:14px;background:#fff;color:#111;border:1px solid #333;border-radius:6px;cursor:pointer}' +
    '.sheet{padding:4mm 0}.sheet+.sheet{break-before:page;page-break-before:always}' +
    'header{text-align:center;margin-bottom:6mm}.school{font-size:12pt;font-weight:bold}' +
    'h1{font-size:15pt;letter-spacing:.4px;margin:3mm 0}.meta{font-size:10pt;line-height:1.5}' +
    '.columns{font-size:10pt;margin-top:2mm}table{width:100%;table-layout:fixed;border-collapse:collapse}' +
    'thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}' +
    'th,td{border:1px solid #333;padding:6px 5px;font-size:10pt;line-height:1.35}' +
    'th{font-weight:700;text-align:center;vertical-align:middle}' +
    'td.order,td.score{text-align:center;font-variant-numeric:tabular-nums}' +
    'td.matricule{white-space:nowrap;font-size:9.5pt}' +
    'td.name{font-weight:500;white-space:nowrap;text-align:start}' +
    '.name-head{text-align:start}.detail{display:block;font-size:9pt;font-weight:400;margin-top:3px}' +
    '@media print{.print-action{display:none}.sheet{padding:0}body{margin:0}}' +
    '</style></head><body>' +
    '<button type="button" id="print-cahier-notes" class="print-action">Imprimer / Enregistrer en PDF</button>' +
    sheets + '</body></html>';
}

/**
 * Ouvre la prévisualisation PDF via l'impression native du navigateur.
 * Retourne false si le navigateur bloque l'ouverture du document.
 */
export function openGradeRegisterPdf(input: GradeRegisterPrintInput): boolean {
  if (typeof window === "undefined") return false;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(buildGradeRegisterPrintHtml(input));
  printWindow.document.close();
  printWindow.document.getElementById("print-cahier-notes")?.addEventListener("click", () => printWindow.print());
  printWindow.focus();
  // Le bouton visible permet également d'imprimer si un navigateur bloque l'ouverture automatique.
  printWindow.addEventListener("load", () => printWindow.print(), { once: true });
  return true;
}
