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
const td = (value: unknown, tag = "td"): string => "<" + tag + ">" + e(value) + "</" + tag + ">";
const htmlValue = (n: number, total: number): string => total === 0 ? "NEANT" : String(n);

function statRow(row: ReportStatRow, highlight = false): string {
  const x = row.total;
  const value = (n: number) => htmlValue(n, x.effectif);
  return '<tr' + (highlight ? ' class="total-row"' : "") + ">" +
    td(row.className) + td(row.gender) +
    td(value(x.effectif)) + td(value(x.classed)) + td(value(x.unclassed)) +
    td(value(x.above10)) + td(x.classed ? pct(x.above10, x.classed) : "NEANT") +
    td(value(x.between850)) + td(x.classed ? pct(x.between850, x.classed) : "NEANT") +
    td(value(x.below850)) + td(x.classed ? pct(x.below850, x.classed) : "NEANT") +
    td(x.average20 === null ? "NEANT" : number(x.average20)) + "</tr>";
}

/** Preserve the exact 12-column, two-tier layout supplied in RAPPORT1.docx. */
function statsTable(rows: ReportStatRow[], firstLabel: "Classe" | "Niveau"): string {
  const meanLabel = firstLabel === "Classe" ? "Moy. de la classe" : "Moy. du niveau";
  return '<table class="statistics"><thead><tr>' +
    '<th rowspan="2" class="first-col">' + firstLabel + '</th>' +
    '<th rowspan="2">S</th><th rowspan="2">Effectif</th>' +
    '<th rowspan="2">Classé</th><th rowspan="2">Non Classé</th>' +
    '<th colspan="2">Moy. sup. ou = 10</th>' +
    '<th colspan="2">Moy. entre 8,5 et 9,99</th>' +
    '<th colspan="2">Moy. inf. à 08,50</th>' +
    '<th rowspan="2">' + meanLabel + '</th></tr>' +
    '<tr><th>Nbre</th><th>%</th><th>Nbre</th><th>%</th><th>Nbre</th><th>%</th></tr>' +
    '</thead><tbody>' + rows.map(row => statRow(row, row.gender === "T")).join("") + '</tbody></table>';
}

function affectedSectionTitle(kind: "affected" | "unaffected"): string {
  const phrasing = kind === "affected" ? "des élèves affectés" : "des élèves non affectés";
  return 'Tableau des résultats <span class="accent">' + phrasing + '</span> par classe et par niveau';
}
function recapTitle(kind: "affected" | "unaffected" | "all"): string {
  const phrasing = kind === "all" ? "des élèves affectés et non affectés"
    : kind === "affected" ? "des élèves affectés" : "des élèves non affectés";
  return 'Récapitulatif des résultats <span class="accent">' + phrasing + '</span> par niveau';
}

function statisticsBody(classes: SchoolReportClass[], filter: AffectationFilter): string {
  const levels = [...new Set(classes.map(c => c.level))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const sections = buildStatisticsSections(classes, filter);
  return sections.map((section, index) => {
    const type = section.label === "Élèves affectés" ? "affected" :
      section.label === "Élèves non affectés" ? "unaffected" : "all";
    const detail = type === "all" ? "" :
      '<h2 class="document-title">' + affectedSectionTitle(type) + '</h2>' +
      '<p class="all-levels">(POUR TOUT LES NIVEAUX)</p>' +
      levels.map(level => {
        const classRows = section.classRows.filter(row => row.level === level);
        const total = section.levelRows.filter(row => row.level === level && row.gender === "T")
          .map(row => ({ ...row, className: "Total " + level }));
        return '<div class="level-block"><h3 class="level-title">Niveau ' + e(level) + '</h3>' +
          statsTable([...classRows, ...total], "Classe") + '</div>';
      }).join("");
    const recapRows = section.levelRows.map(row => ({ ...row,
      className: row.gender === "T" ? "Total " + row.level : row.level }));
    const schoolTotals = section.schoolRows.map(row => ({
      ...row, className: row.gender === "T" ? "TOTAL ÉTABLISSEMENT" : "Établissement",
    }));
    return '<section class="report-section">' +
      detail + '<div class="recap-block"><h2 class="recap-title">' + recapTitle(type) + '</h2>' +
      statsTable([...recapRows, ...schoolTotals], "Niveau") + '</div></section>';
  }).join("");
}

function periodAverageHeading(label: string): string {
  const low = label.toLocaleLowerCase("fr-FR");
  if (/\b(1er|1ère|premier|première|t1|trimestre 1|trimestre 01)\b/.test(low)) return "MOY T1";
  if (/\b(2e|2ème|deuxième|t2|trimestre 2|trimestre 02)\b/.test(low)) return "MOY T2";
  if (/\b(3e|3ème|troisième|t3|trimestre 3|trimestre 03)\b/.test(low)) return "MOY T3";
  return "MOY";
}

function nominalTable(cls: SchoolReportClass, group: boolean | null, filter: AffectationFilter, averageHeader: string): string {
  const students = selectAffectation(cls.students, filter).filter(s => filter !== "all" || s.isAffected === group);
  const rows = students.map((s, index) => {
    const cols: unknown[] = [
      index + 1, s.matricule || "NEANT", s.name, s.gender === "G" ? "M" : s.gender,
      s.birthdate || "NEANT", s.nationality || "NEANT",
      s.repeater === null ? "NEANT" : s.repeater ? "R" : "",
      s.isAffected === true ? "AFF" : s.isAffected === false ? "NAF" : "NEANT",
      s.decisionNumber || "NEANT", s.average === null ? "NC" : number(s.average),
      s.rank ?? "NEANT", s.observation || "",
    ];
    return '<tr>' + cols.map(value => td(value)).join("") + '</tr>';
  }).join("");
  const empty = '<tr><td colspan="12" class="empty">NEANT</td></tr>';
  return '<section class="class-section">' +
    '<div class="class-heading"><strong>' + e(cls.label.toUpperCase()) + '</strong>' +
    '<span><strong>Professeur Principal :</strong> ' + e(cls.headTeacher || "NEANT") + '</span>' +
    '<span><strong>Educateur :</strong> ' + e(cls.educator || "NEANT") + '</span></div>' +
    '<table class="nominal"><thead><tr>' +
    '<th>N°</th><th>MATRICULE</th><th>NOM ET PRENOMS</th><th>Sexe</th>' +
    '<th>AN</th><th>NAT</th><th>R</th><th>STATUT</th><th>N° DEC AFF</th>' +
    '<th class="avg-head">' + e(averageHeader) + '</th><th>RANG</th><th>OBSERVATION</th>' +
    '</tr></thead><tbody>' + (rows || empty) + '</tbody></table></section>';
}

function nominalBody(classes: SchoolReportClass[], filter: AffectationFilter, periodLabel: string): string {
  const groups: Array<{ label: string; value: boolean | null; letter: string }> = filter === "all"
    ? [{ label: "Liste des élèves affectés par classe", value: true, letter: "a)" },
      { label: "Liste des élèves non affectés par classe", value: false, letter: "b)" },
      { label: "Liste des élèves à affectation non renseignée par classe", value: null, letter: "c)" }]
    : [{ label: filter === "affected" ? "Liste des élèves affectés par classe" : "Liste des élèves non affectés par classe",
        value: filter === "affected", letter: filter === "affected" ? "a)" : "b)" }];
  return '<h2 class="nominal-main">1- &nbsp; Liste nominative des élèves</h2>' +
    groups.filter(group => classes.some(c => c.students.some(s => s.isAffected === group.value))).map(group => {
      // Les classes sans élève dans ce groupe n'ont pas de tableau à imprimer.
      const printable = classes.filter(c => c.students.some(s => s.isAffected === group.value));
      return '<section class="report-section">' +
        '<h3 class="nominal-group">' + e(group.letter) +
        ' &nbsp; Liste <span class="accent">' + e(group.label.slice("Liste ".length).replace(" par classe", "")) +
        '</span> par classe</h3>' +
        printable.map(c => nominalTable(c, group.value, filter, periodAverageHeading(periodLabel))).join("") +
        '</section>';
    }).join("");
}

/** HTML printed locally by the browser; no QR, persistent PDF or Supabase write. */
export function buildSchoolReportHtml(input: {
  classes: SchoolReportClass[];
  kind: SchoolReportKind;
  filter: AffectationFilter;
  academicYear: string;
  periodLabel: string;
  track: "french" | "arabic";
}): string {
  const first = input.classes[0];
  const isStatistics = input.kind === "statistics";
  const reportName = isStatistics ? "Synthèse statistique des résultats" : "Liste nominative des résultats";
  const isTrimester = /\btrimestre\b|\bt[123]\b/i.test(input.periodLabel);
  const subtitle = "Année scolaire " + input.academicYear + " · " + input.periodLabel +
    (input.track === "arabic" ? " · Enseignement arabe" : "");
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + e(reportName) + '</title>' +
    '<style>' +
    '@page{size:A4 portrait;margin:12mm 8mm 14mm}' +
    'html,body{font:10px Arial,Helvetica,sans-serif;color:#111;background:#fff}body{margin:0}' +
    'h1{font-size:20px;margin:10px 0 12px}h2{font-size:12px}h3{font-size:11px}' +
    '.header{text-align:center;border-bottom:1px solid #777;padding-bottom:8px;margin-bottom:15px}' +
    '.header .school{font-size:12px;font-weight:bold}.header .meta{font-size:9px;color:#444}' +
    '.document-title{text-align:center;font-size:13px;font-weight:700;margin:20px 0 13px}' +
    '.recap-title{text-align:center;font-style:italic;margin:22px 0 14px}' +
    '.accent{color:#c11;font-style:italic}.all-levels{text-align:center;color:#c11;margin:7px 0 22px;font-size:11px}' +
    '.level-title{margin:14px 0 9px 20px;font-weight:700}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:13px}' +
    'th,td{border:1px solid #555;padding:4px 2px;vertical-align:middle;overflow-wrap:anywhere}' +
    'th{font-size:8px;font-weight:700}td{text-align:center;font-size:8.7px}' +
    '.statistics .first-col{width:17%}.statistics th:nth-child(2){width:3%}' +
    '.statistics th:nth-child(3),.statistics th:nth-child(4),.statistics th:nth-child(5){width:6%}' +
    '.total-row{background:#dedede;font-weight:bold}.statistics tbody tr.total-row td{font-weight:bold}' +
    '.report-section{margin-top:18px}.report-section:first-child{margin-top:0}.level-block,.recap-block{break-inside:avoid-page;page-break-inside:avoid}.document-title,.recap-title,.level-title,.nominal-group{break-after:avoid-page;page-break-after:avoid}' +
    '.class-section{margin:8px 0 17px}.class-heading{display:grid;grid-template-columns:27% 43% 30%;gap:3px;margin:12px 0 5px;font-size:9px;break-after:avoid-page;page-break-after:avoid}' +
    '.class-heading strong{font-weight:700}.nominal th{font-size:8px;padding:4px 1px}' +
    '.nominal th:nth-child(1){width:4%}.nominal th:nth-child(2){width:12%}' +
    '.nominal th:nth-child(3){width:19%}.nominal th:nth-child(4){width:5%}' +
    '.nominal th:nth-child(5){width:9%}.nominal th:nth-child(6){width:9%}' +
    '.nominal th:nth-child(7){width:4%}.nominal th:nth-child(8){width:6%}' +
    '.nominal th:nth-child(9){width:7%}.nominal th:nth-child(10){width:7%}' +
    '.nominal th:nth-child(11){width:6%}.nominal th:nth-child(12){width:12%}' +
    '.nominal td:nth-child(3){text-align:left}.nominal .avg-head{color:#c11}' +
    '.nominal-main{font-size:13px;margin:14px 0}.nominal-group{font-size:11px;font-style:italic;margin:12px 0}' +
    '.empty{padding:10px;text-align:center}.note{font-size:8px;color:#555;margin:7px 0 12px}' +
    '.footer{display:block;position:static;clear:both;margin:18px 0 0;border-top:1px solid #bbb;padding:7px 0 0;text-align:center;color:#666;font-size:9px;letter-spacing:.03em;break-inside:avoid-page;page-break-inside:avoid}' +
    '.footer strong{color:#333;font-weight:700}' +
    'thead{display:table-header-group}tr{break-inside:avoid}table{break-inside:auto}' +
    '@media screen {.footer{display:block}}' +
    '</style></head><body>' +
    '<header class="header"><div class="meta">' + e(first?.regionalDirection || "") + '</div>' +
    '<div class="school">' + e(first?.institutionName || "Établissement") + '</div>' +
    '<div class="meta">' + e(subtitle) + '</div></header>' +
    (isStatistics ? '' : '<h1><u>' + (isTrimester ? 'RAPPORT 2 (PAR TRIMESTRE)' : 'RAPPORT 2 — ' + e(input.periodLabel)) + '</u></h1>') +
    (isStatistics
      ? statisticsBody(input.classes, input.filter)
      : nominalBody(input.classes, input.filter, input.periodLabel)) +
    '<footer class="footer">Document édité avec <strong>Mon Cahier</strong> &bull; www.mon-cahier.com</footer>' +
    '</body></html>';
}
