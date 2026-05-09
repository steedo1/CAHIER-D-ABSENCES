import { defaultSubjectHours, defaultSubjects } from "../catalog/defaultCatalog";
import type { DefaultSubjectHour, SubjectDefinition } from "../catalog/types";
import {
  clean,
  findDefaultSubjectHour,
  getCatalogSubject,
  inferCatalogSubjectId,
  inferLevelCode,
  inferSeriesCode,
  normalizeText,
  type HoraclasseServiceMeta,
} from "./horaclasseModelHelpers";

export type MonCahierClassLike = {
  id: string;
  label?: string | null;
  level_code?: string | null;
  series_code?: string | null;
};

export type MonCahierSubjectLike = {
  id: string;
  label?: string | null;
  code?: string | null;
  catalog_subject_id?: string | null;
};

export type MonCahierAffectationLike = {
  teacher_id: string;
  teacher_name?: string | null;
  subject_id: string | null;
  subject_label?: string | null;
  subject_code?: string | null;
  catalog_subject_id?: string | null;
  class_id: string;
  class_label?: string | null;
  level_code?: string | null;
  series_code?: string | null;
};

export type MonCahierVolumeOverrideLike = {
  id?: string | null;
  class_id?: string | null;
  subject_id?: string | null;
  teacher_id?: string | null;
  weekly_units?: number | string | null;
  split_pattern?: string | null;
  room_type_required?: string | null;
};

export type CatalogCoverageSubject = {
  catalog_subject_id: string;
  code: string;
  name: string;
  short_name: string;
  exists_in_mon_cahier: boolean;
  institution_subject_id: string | null;
  institution_subject_label: string | null;
  institution_subject_code: string | null;
};

export type HoraclasseServicesBuildResult = {
  service_assignments: HoraclasseServiceMeta[];
  catalog_coverage: CatalogCoverageSubject[];
  missing_catalog_subjects: CatalogCoverageSubject[];
  totals: {
    services: number;
    ready: number;
    missing: number;
    customized: number;
    mon_cahier_subjects: number;
    catalog_subjects: number;
    catalog_subjects_missing_in_mon_cahier: number;
  };
  warnings: string[];
};

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function makeExactOverrideKey(classId: string, subjectId: string | null, teacherId: string): string {
  return `${clean(classId)}:${clean(subjectId)}:${clean(teacherId)}`;
}

function makeClassSubjectOverrideKey(classId: string, subjectId: string | null): string {
  return `${clean(classId)}:${clean(subjectId)}:*`;
}

function makeSubjectLevelKey(levelCode: string, catalogSubjectId: string): string {
  return `${clean(levelCode)}:${clean(catalogSubjectId)}`;
}

function findHourForLevel(levelCode: string, catalogSubjectId: string): DefaultSubjectHour | null {
  const exact = findDefaultSubjectHour(levelCode, catalogSubjectId);
  if (exact) return exact;

  // Mon Cahier stocke souvent seulement "seconde", "première", "terminale".
  // Si la série n’est pas connue, on prend une valeur raisonnable dans le même cycle
  // au lieu de bloquer inutilement l’admin.
  const candidates = defaultSubjectHours.filter((item) => item.subjectId === catalogSubjectId);
  if (levelCode === "2A" || levelCode === "2C") {
    return candidates.find((item) => item.levelCode === "2A") || candidates.find((item) => item.levelCode === "2C") || null;
  }
  if (levelCode === "1A" || levelCode === "1C" || levelCode === "1D") {
    return candidates.find((item) => item.levelCode === levelCode) || candidates.find((item) => item.levelCode === "1A") || null;
  }
  if (levelCode === "TleA" || levelCode === "TleC" || levelCode === "TleD") {
    return candidates.find((item) => item.levelCode === levelCode) || candidates.find((item) => item.levelCode === "TleA") || null;
  }

  return null;
}

function subjectMatchesCatalog(subject: MonCahierSubjectLike, catalogSubject: SubjectDefinition): boolean {
  const inferred = clean(subject.catalog_subject_id) || inferCatalogSubjectId({
    code: subject.code,
    label: subject.label,
    fallbackId: "",
  });

  if (inferred === catalogSubject.id) return true;

  const code = normalizeText(subject.code);
  const label = normalizeText(subject.label);
  const catalogCode = normalizeText(catalogSubject.code);
  const catalogName = normalizeText(catalogSubject.name);
  const catalogShortName = normalizeText(catalogSubject.shortName);

  return Boolean(
    (code && code === catalogCode) ||
      (label && (label === catalogName || label === catalogShortName)) ||
      (catalogShortName && label.includes(catalogShortName)) ||
      (catalogName && label.includes(catalogName)),
  );
}

export function buildCatalogCoverage(subjects: MonCahierSubjectLike[]): CatalogCoverageSubject[] {
  return defaultSubjects
    .map((catalogSubject) => {
      const found = subjects.find((subject) => subjectMatchesCatalog(subject, catalogSubject));

      return {
        catalog_subject_id: catalogSubject.id,
        code: catalogSubject.code,
        name: catalogSubject.name,
        short_name: catalogSubject.shortName,
        exists_in_mon_cahier: Boolean(found),
        institution_subject_id: found?.id ? String(found.id) : null,
        institution_subject_label: found?.label ? String(found.label) : null,
        institution_subject_code: found?.code ? String(found.code) : null,
      } satisfies CatalogCoverageSubject;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function buildHoraclasseServiceAssignments(input: {
  classes?: MonCahierClassLike[];
  subjects?: MonCahierSubjectLike[];
  affectations?: MonCahierAffectationLike[];
  volumeOverrides?: MonCahierVolumeOverrideLike[];
}): HoraclasseServicesBuildResult {
  const classes = input.classes || [];
  const subjects = input.subjects || [];
  const affectations = input.affectations || [];
  const volumeOverrides = input.volumeOverrides || [];
  const warnings: string[] = [];

  const classById = new Map(classes.map((item) => [clean(item.id), item]));
  const subjectById = new Map(subjects.map((item) => [clean(item.id), item]));

  const exactOverrideMap = new Map<string, MonCahierVolumeOverrideLike>();
  const classSubjectOverrideMap = new Map<string, MonCahierVolumeOverrideLike>();

  for (const item of volumeOverrides) {
    const classId = clean(item.class_id);
    const subjectId = clean(item.subject_id);
    const teacherId = clean(item.teacher_id);
    if (!classId || !subjectId) continue;

    if (teacherId) {
      exactOverrideMap.set(makeExactOverrideKey(classId, subjectId, teacherId), item);
    } else {
      classSubjectOverrideMap.set(makeClassSubjectOverrideKey(classId, subjectId), item);
    }
  }

  const service_assignments = affectations.map((row) => {
    const classId = clean(row.class_id);
    const subjectId = clean(row.subject_id);
    const teacherId = clean(row.teacher_id);

    const classRow = classById.get(classId);
    const subjectRow = subjectById.get(subjectId);

    const classLabel = clean(row.class_label || classRow?.label, "Classe");
    const levelCode = clean(row.level_code || classRow?.level_code) || inferLevelCode(classLabel);
    const seriesCode = clean(row.series_code || classRow?.series_code) || inferSeriesCode(levelCode);

    const subjectLabel = clean(row.subject_label || subjectRow?.label, "Matière");
    const subjectCode = row.subject_code || subjectRow?.code || null;
    const catalogSubjectId = clean(row.catalog_subject_id || subjectRow?.catalog_subject_id) ||
      inferCatalogSubjectId({
        code: subjectCode,
        label: subjectLabel,
        fallbackId: subjectId,
      });

    const defaultHour = findHourForLevel(levelCode, catalogSubjectId);
    const subject = getCatalogSubject(catalogSubjectId);
    const override = exactOverrideMap.get(makeExactOverrideKey(classId, subjectId, teacherId)) ||
      classSubjectOverrideMap.get(makeClassSubjectOverrideKey(classId, subjectId));

    const weeklyUnits = asNumberOrNull(override?.weekly_units) ?? defaultHour?.weeklyUnits ?? null;
    const splitPattern = clean(override?.split_pattern) || defaultHour?.splitPattern || null;
    const roomTypeRequired = clean(override?.room_type_required) ||
      defaultHour?.roomTypeRequired ||
      subject?.defaultRoomType ||
      null;

    const missingReason = !weeklyUnits || !splitPattern
      ? `Volume à compléter : ${classLabel} / ${subjectLabel}. Mon Cahier garde la matière officielle, mais HoraClasse ne trouve pas encore de volume automatique.`
      : null;

    return {
      class_id: classId,
      class_label: classLabel,
      level_code: levelCode,
      series_code: seriesCode,
      teacher_id: teacherId,
      teacher_name: clean(row.teacher_name, "Enseignant"),
      subject_id: subjectId,
      subject_label: subjectLabel,
      subject_code: subjectCode ? clean(subjectCode) : null,
      catalog_subject_id: catalogSubjectId,
      catalog_subject_label: subject?.shortName || subject?.name || subjectLabel || catalogSubjectId,
      weekly_units: weeklyUnits,
      split_pattern: splitPattern,
      room_type_required: roomTypeRequired,
      source: override ? "override" : defaultHour ? "default_catalog" : "manual_missing_catalog",
      is_ready: Boolean(weeklyUnits && splitPattern),
      missing_reason: missingReason,
    } satisfies HoraclasseServiceMeta;
  });

  const catalog_coverage = buildCatalogCoverage(subjects);
  const missing_catalog_subjects = catalog_coverage.filter((item) => !item.exists_in_mon_cahier);

  const missingServices = service_assignments.filter((item) => !item.is_ready).length;
  const customized = service_assignments.filter((item) => item.source === "override").length;

  if (classes.length === 0) warnings.push("Aucune classe Mon Cahier détectée.");
  if (subjects.length === 0) warnings.push("Aucune matière Mon Cahier détectée.");
  if (affectations.length === 0) warnings.push("Aucune affectation active enseignant-matière-classe détectée.");
  if (missingServices > 0) warnings.push(`${missingServices} service(s) ont besoin d’un volume manuel.`);
  if (missing_catalog_subjects.length > 0) {
    warnings.push(`${missing_catalog_subjects.length} matière(s) du référentiel HoraClasse ne sont pas encore activées dans Mon Cahier.`);
  }

  return {
    service_assignments,
    catalog_coverage,
    missing_catalog_subjects,
    totals: {
      services: service_assignments.length,
      ready: service_assignments.length - missingServices,
      missing: missingServices,
      customized,
      mon_cahier_subjects: subjects.length,
      catalog_subjects: defaultSubjects.length,
      catalog_subjects_missing_in_mon_cahier: missing_catalog_subjects.length,
    },
    warnings,
  };
}

export function getCatalogHourIndex() {
  const map = new Map<string, DefaultSubjectHour>();
  for (const hour of defaultSubjectHours) {
    map.set(makeSubjectLevelKey(hour.levelCode, hour.subjectId), hour);
  }
  return map;
}
