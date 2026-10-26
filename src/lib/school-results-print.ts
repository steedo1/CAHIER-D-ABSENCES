import {
  type AffectationFilter,
  type SchoolReportClass,
  type SchoolReportKind,
  type ReportStatRow,
  buildStatisticsSections,
  number,
  pct,
  selectAffectation,
} from "./school-results-reports";

export function escapeReportHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeReportHtml;

function tableRow(row: ReportStatRow): string {
  const t = row.total;
  const cell = (value: unknown) => "<td>" + e(value) + "</td>";
  return "<tr>" +
    cell(row.level) + cell(row.className) + cell(row.gender) +
    cell(t.effectif) + cell(t.classed) + cell(t.unclassed) +
    cell(t.above10) + cell(pct(t.above10, t.classed)) +
    cell(t.between850) + cell(pct(t.between850, t.classed)) +
    cell(t.below850) + cell(pct(t.below850, t.classed)) +
    cell(number(t.average20)) + "</tr>";
}

function statisticsTable(rows: ReportStatRow[], label: string): string {
  return '<h3>' + e(label) + '</h3><table class="statistics"><thead><tr>' +
    '<th>Niveau</th><th>Classe</th><th>S</th><th>Effectif</th><th>Classés</th><th>NC</th>' +
    '<th>≥ 10</th><th>%</th><th>8,50–9,99</th><th>%</th><th>&lt; 8,50</th><th>%</th><th>Moy. /20</th>' +
    '</tr></thead><tbody>' + rows.map(tableRow).join("") + '</tbody></table>';
}

function statisticsBody(classes: SchoolReportClass[], filter: AffectationFilter): string {
  return buildStatisticsSections(classes, filter).map(section =>
    '<section class="report-section"><h2>' + e(section.label) + '</h2>' +
    statisticsTable(section.classRows, "Résultats par classe") +
    statisticsTable(section.levelRows, "Récapitulatif par niveau") +
    statisticsTable(section.schoolRows, "Récapitulatif de l'établissement") +
    '</section>'
  ).join("");
}

function nominalBody(classes: SchoolReportClass[], filter: AffectationFilter): string {
  const groups = filter === "all"
    ? [{ label: "Élèves affectés", affected: true }, { label: "Élèves non affectés", affected: false }, { label: "Affectation non renseignée", affected: null }]
    : [{ label: filter === "affected" ? "Élèves affectés" : "Élèves non affectés", affected: filter === "affected" }];
  return groups.map(group => {
    const contents = classes.map(cls => {
      const students = selectAffectation(cls.students, filter)
        .filter(student => filter !== "all" || student.isAffected === group.affected);
      const rows = students.map((s, index) => {
        const values: unknown[] = [
          index + 1, s.matricule || "—", s.name, s.gender, s.birthdate || "—",
          s.nationality || "—", s.repeater === null ? "—" : s.repeater ? "R" : "—",
          s.isAffected === true ? "AFF" : s.isAffected === false ? "NAF" : "—",
          s.decisionNumber || "—", s.average === null ? "NC" : number(s.average),
          s.rank ?? "—", s.observation || "—",
        ];
        return "<tr>" + values.map(value => "<td>" + e(value) + "</td>").join("") + "</tr>";
      }).join("");
      return '<section class="class-section"><h3>' + e(cls.label) + " · " + e(cls.level) + '</h3>' +
        '<p class="staff">Professeur principal : ' + e(cls.headTeacher || "Non renseigné") +
        ' &nbsp; | &nbsp; Éducateur : ' + e(cls.educator || "Non renseigné") + '</p>' +
        '<table class="nominal"><thead><tr>' +
        '<th>N°</th><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Naissance</th>' +
        '<th>Nationalité</th><th>R</th><th>Statut</th><th>N° déc. aff.</th><th>Moy.</th><th>Rang</th><th>Observation</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="12">Aucun élève</td></tr>') + '</tbody></table></section>';
    }).join("");
    return '<section class="report-section"><h2>' + e(group.label) + '</h2>' + contents + '</section>';
  }).join("");
}

/** HTML imprime en local par le navigateur : aucun PDF stocke ni envoye au serveur. */
export function buildSchoolReportHtml(input: {
  classes: SchoolReportClass[];
  kind: SchoolReportKind;
  filter: AffectationFilter;
  academicYear: string;
  periodLabel: string;
  track: "french" | "arabic";
}): string {
  const first = input.classes[0];
  const title = input.kind === "statistics" ? "Synthèse statistique des résultats" : "Liste nominative des résultats";
  const subtitle = "Année scolaire " + input.academicYear + " · " + input.periodLabel +
    (input.track === "arabic" ? " · Enseignement arabe" : "");
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + e(title) + '</title>' +
    '<style>' +
    '@page { size: A4 landscape; margin: 9mm; }' +
    'html,body{font:10px Arial,Helvetica,sans-serif;color:#111;background:white}' +
    'h1{text-align:center;font-size:19px;margin:5px 0 4px}' +
    'h2{font-size:13px;border-bottom:1px solid #666;padding-bottom:5px;margin:20px 0 10px}' +
    'h3{font-size:11px;margin:13px 0 6px}p{margin:3px 0}' +
    '.header{text-align:center;border-bottom:2px solid #222;padding-bottom:10px}' +
    '.header .school{font-size:15px;font-weight:bold}.muted{color:#333}' +
    '.note{font-size:9px;color:#333;margin:7px 0}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:12px}' +
    'th,td{border:1px solid #555;padding:4px 3px;vertical-align:middle;word-wrap:break-word}' +
    'th{background:#f0f0f0;font-size:9px}td{text-align:center}' +
    '.nominal th:nth-child(3),.nominal td:nth-child(3){width:17%;text-align:left}' +
    '.staff{font-size:9px;margin-bottom:5px}' +
    '.report-section{break-before:page}.report-section:first-of-type{break-before:auto}' +
    '.class-section h3{break-after:avoid}.class-section .staff{break-after:avoid}' +
    'thead{display:table-header-group}tr{break-inside:avoid}table{break-inside:auto}' +
    '</style></head><body><header class="header">' +
    '<div class="muted">' + e(first?.regionalDirection || "Direction régionale non renseignée") + '</div>' +
    '<div class="school">' + e(first?.institutionName || "Établissement") + '</div>' +
    '<h1>' + e(title) + '</h1><div>' + e(subtitle) + '</div></header>' +
    (input.kind === "statistics"
      ? '<p class="note">Les seuils sont comparés sur une échelle normalisée /20 pour les barèmes différents. ' +
        'Moyennes officielles et rangs non recalculés. Pourcentages calculés sur les élèves classés.</p>'
      : '<p class="note">Moyennes affichées dans leur barème officiel ; "NC" signifie non classé. ' +
        'Les décisions d’affectation et observations non disponibles ne sont pas inventées.</p>') +
    (input.kind === "statistics"
      ? statisticsBody(input.classes, input.filter)
      : nominalBody(input.classes, input.filter)) +
    '</body></html>';
}
