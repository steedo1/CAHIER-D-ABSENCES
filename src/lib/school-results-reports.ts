/**
 * Exports institutionnels en lecture seule. Les bulletins restent la source des
 * moyennes et rangs ; les listes de classes restent la source des identites.
 * Aucune ecriture Supabase, aucun QR, aucune moyenne de bulletin recalculee.
 */
export type ReportTrack = "french" | "arabic";
export type AffectationFilter = "all" | "affected" | "unaffected";
export type SchoolReportKind = "statistics" | "nominal";

export type SchoolReportStudent = {
  id: string;
  matricule: string;
  name: string;
  gender: "F" | "G" | "?";
  birthdate: string;
  nationality: string;
  repeater: boolean | null;
  isAffected: boolean | null;
  average: number | null;
  denominator: number;
  rank: number | null;
  observation: string;
  decisionNumber: string;
};

export type SchoolReportClass = {
  id: string;
  label: string;
  level: string;
  institutionName: string;
  regionalDirection: string;
  headTeacher: string;
  educator: string;
  students: SchoolReportStudent[];
};

export type ReportGroup = {
  name: string;
  effectif: number;
  classed: number;
  unclassed: number;
  above10: number;
  between850: number;
  below850: number;
  average20: number | null;
};

export type ReportStatRow = {
  level: string;
  className: string;
  gender: "F" | "G" | "T";
  total: ReportGroup;
};

export type ReportStatsSection = {
  label: string;
  classRows: ReportStatRow[];
  levelRows: ReportStatRow[];
  schoolRows: ReportStatRow[];
};

type PlainStudent = {
  id?: string;
  matricule?: string | null;
  full_name?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  nationality?: string | null;
  is_repeater?: boolean | null;
  is_affecte?: boolean | null;
};

type PlainBulletinStudent = {
  student_id: string;
  general_avg?: number | null;
  rank?: number | null;
  admin_forced_nc?: boolean | null;
};

type SpecializedDocument = {
  studentId: string;
  programReadiness?: Partial<Record<ReportTrack, boolean>>;
  document?: Partial<Record<ReportTrack, {
    generalAverage: number | null;
    denominator: number;
    rank?: number | null;
  }>>;
};

export type ReportRosterResponse = {
  class?: { id?: string; label?: string; level?: string } | null;
  institution?: { name?: string | null; regional_direction?: string | null } | null;
  staff?: {
    head_teacher?: { display_name?: string | null } | null;
    educators?: Array<{ display_name?: string | null }> | null;
  } | null;
  students?: PlainStudent[];
};

export type ReportBulletinResponse = {
  ok?: boolean;
  items?: PlainBulletinStudent[];
  specialized?: {
    engine?: string;
    documents?: SpecializedDocument[];
    programs?: ReportTrack[];
  } | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sex(value: unknown): "F" | "G" | "?" {
  const s = clean(value).toLocaleLowerCase("fr-FR");
  if (s === "f" || s.startsWith("fém") || s.startsWith("fem")) return "F";
  if (s === "m" || s === "g" || s.startsWith("mas") || s.startsWith("gar")) return "G";
  return "?";
}

export function selectAffectation(
  students: SchoolReportStudent[], filter: AffectationFilter,
): SchoolReportStudent[] {
  if (filter === "affected") return students.filter(row => row.isAffected === true);
  if (filter === "unaffected") return students.filter(row => row.isAffected === false);
  return students;
}

export function buildSchoolReportClass(input: {
  id: string;
  label: string;
  level: string;
  roster: ReportRosterResponse;
  bulletin: ReportBulletinResponse;
  track: ReportTrack;
}): SchoolReportClass {
  const { roster, bulletin, track } = input;
  if (!Array.isArray(roster.students) || bulletin.ok !== true) {
    throw new Error("Liste de classe ou bulletin officiel indisponible.");
  }
  const ordinary = new Map((bulletin.items || []).map(row => [row.student_id, row]));
  const specialized = new Map((bulletin.specialized?.documents || []).map(row => [row.studentId, row]));
  const specializedMode = bulletin.specialized?.engine === "specialized";
  if (track === "arabic" && !specializedMode) {
    throw new Error("Enseignement arabe indisponible dans cette classe.");
  }
  if (specializedMode && !bulletin.specialized?.programs?.includes(track)) {
    throw new Error("Cet enseignement n’est pas configuré pour la classe " + input.label + ".");
  }
  return {
    id: input.id,
    label: clean(roster.class?.label) || input.label,
    level: clean(roster.class?.level) || input.level,
    institutionName: clean(roster.institution?.name) || "Établissement",
    regionalDirection: clean(roster.institution?.regional_direction),
    headTeacher: clean(roster.staff?.head_teacher?.display_name),
    educator: (roster.staff?.educators || []).map(row => clean(row.display_name)).filter(Boolean).join(", "),
    students: roster.students.filter(row => !!row.id).map(row => {
      const basic = ordinary.get(row.id || "");
      const specific = specialized.get(row.id || "");
      const program = specific?.document?.[track];
      const validProgram = specific?.programReadiness?.[track] === true;
      const nativeDenominator = specializedMode ? score(program?.denominator) : 20;
      const denominator = nativeDenominator && nativeDenominator > 0 ? nativeDenominator : 20;
      const avg = specializedMode
        ? (validProgram ? score(program?.generalAverage) : null)
        : (basic?.admin_forced_nc === true ? null : score(basic?.general_avg));
      const rank = specializedMode ? (validProgram ? score(program?.rank) : null)
        : (basic?.admin_forced_nc === true ? null : score(basic?.rank));
      const name = clean(row.full_name) || [clean(row.last_name), clean(row.first_name)].filter(Boolean).join(" ");
      return {
        id: row.id || "",
        matricule: clean(row.matricule),
        name: name || "Élève sans nom",
        gender: sex(row.gender),
        birthdate: clean(row.birthdate),
        nationality: clean(row.nationality),
        repeater: typeof row.is_repeater === "boolean" ? row.is_repeater : null,
        isAffected: typeof row.is_affecte === "boolean" ? row.is_affecte : null,
        average: avg,
        denominator,
        rank,
        // Ces champs ne sont pas exposes par les sources identifiees.
        // Ne jamais les inventer a partir d'une remarque pedagogique.
        observation: "",
        decisionNumber: "",
      } satisfies SchoolReportStudent;
    }).sort((a, b) => a.name.localeCompare(b.name, "fr")),
  };
}

function normalized20(student: SchoolReportStudent): number | null {
  if (student.average === null || student.denominator <= 0) return null;
  return student.average * 20 / student.denominator;
}

function summarize(name: string, list: SchoolReportStudent[]): ReportGroup {
  const classed = list.map(normalized20).filter((v): v is number => v !== null);
  return {
    name,
    effectif: list.length,
    classed: classed.length,
    unclassed: list.length - classed.length,
    above10: classed.filter(v => v >= 10).length,
    between850: classed.filter(v => v >= 8.5 && v < 10).length,
    below850: classed.filter(v => v < 8.5).length,
    average20: classed.length ? classed.reduce((a, b) => a + b, 0) / classed.length : null,
  };
}

function genderRows(level: string, className: string, students: SchoolReportStudent[]): ReportStatRow[] {
  return (["F", "G", "T"] as const).map(gender => ({
    level, className, gender,
    total: summarize(className, gender === "T" ? students : students.filter(s => s.gender === gender)),
  }));
}

export function buildStatisticsSections(
  classes: SchoolReportClass[], filter: AffectationFilter,
): ReportStatsSection[] {
  const sections: Array<{ label: string; filter: AffectationFilter }> =
    filter === "all"
      ? [
          { label: "Élèves affectés", filter: "affected" },
          { label: "Élèves non affectés", filter: "unaffected" },
          { label: "Tous les élèves", filter: "all" },
        ]
      : [{ label: filter === "affected" ? "Élèves affectés" : "Élèves non affectés", filter }];
  return sections.map(section => {
    const perClass = classes.map(cls => ({
      ...cls,
      students: selectAffectation(cls.students, section.filter),
    }));
    const levels = Array.from(new Set(classes.map(cls => cls.level))).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
    return {
      label: section.label,
      classRows: perClass.flatMap(cls => genderRows(cls.level, cls.label, cls.students)),
      levelRows: levels.flatMap(level =>
        genderRows(level, "Total " + level,
          perClass.filter(cls => cls.level === level).flatMap(cls => cls.students))),
      schoolRows: genderRows("", "TOTAL ÉTABLISSEMENT", perClass.flatMap(cls => cls.students)),
    };
  });
}

export function pct(count: number, denominator: number): string {
  return denominator ? (count * 100 / denominator).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %" : "—";
}

export function number(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function csvCell(value: string | number | null): string {
  let cell = value === null ? "" : String(value);
  // Neutraliser les formules injectees dans les noms/matricules au tableur.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
}

export function buildSchoolCsv(
  classes: SchoolReportClass[], kind: SchoolReportKind, filter: AffectationFilter,
): string {
  const rows: Array<Array<string | number | null>> = [];
  if (kind === "nominal") {
    rows.push(["Affectation", "Niveau", "Classe", "N°", "Matricule", "Nom et prénoms", "Sexe", "Naissance", "Nationalité", "Redoublant", "Statut", "N° décision d'affectation", "Moyenne", "Barème", "Rang", "Observation"]);
    for (const cls of classes) {
      const selected = selectAffectation(cls.students, filter);
      selected.forEach((s, i) => rows.push([
        s.isAffected === true ? "Affecté" : s.isAffected === false ? "Non affecté" : "Non renseigné",
        cls.level, cls.label, i + 1, s.matricule, s.name, s.gender, s.birthdate,
        s.nationality, s.repeater === null ? "" : s.repeater ? "OUI" : "NON",
        s.isAffected === true ? "AFF" : s.isAffected === false ? "NAF" : "",
        s.decisionNumber, s.average, s.denominator, s.rank, s.observation,
      ]));
    }
  } else {
    rows.push(["Section", "Niveau", "Classe", "Sexe", "Effectif", "Classés", "Non classés", "Moyenne ≥ 10", "Taux ≥ 10", "8,50 ≤ Moyenne < 10", "Taux 8,50–9,99", "Moyenne < 8,50", "Taux < 8,50", "Moyenne /20 normalisée"]);
    for (const section of buildStatisticsSections(classes, filter)) {
      for (const row of [...section.classRows, ...section.levelRows, ...section.schoolRows]) {
        const x = row.total;
        rows.push([section.label, row.level, row.className, row.gender, x.effectif, x.classed,
          x.unclassed, x.above10, pct(x.above10, x.classed), x.between850, pct(x.between850, x.classed),
          x.below850, pct(x.below850, x.classed), x.average20 === null ? "" : Number(x.average20.toFixed(2))]);
      }
    }
  }
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
}
