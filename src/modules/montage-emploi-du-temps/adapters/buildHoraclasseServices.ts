import {
  defaultLevels,
  defaultSubjectHours,
  defaultSubjects,
} from "../catalog/defaultCatalog";
import type { DefaultSubjectHour, SubjectDefinition } from "../catalog/types";
import {
  clean,
  inferCatalogSubjectId,
  normalizeText,
  getCatalogSubject,
  findDefaultSubjectHour,
  buildClassAcademicProfile,
  type HoraclasseServiceMeta,
  type OfficialTrackCode,
} from "./horaclasseModelHelpers";

export type MonCahierClassLike = {
  id: string;
  label?: string | null;
  level?: string | null;
  level_code?: string | null;
  series_code?: string | null;
  official_track_code?: string | null;
  officialTrackCode?: string | null;
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
  level?: string | null;
  level_code?: string | null;
  series_code?: string | null;
  official_track_code?: string | null;
  officialTrackCode?: string | null;
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

export type SubjectHourRow = {
  key: string;
  level_code: string;
  level_label: string;
  subject_id: string;
  subject_label: string;
  subject_code: string | null;
  catalog_subject_id: string;
  catalog_subject_label: string;
  weekly_units: number | null;
  split_pattern: string | null;
  room_type_required: string | null;
  source: "default_catalog" | "override" | "manual_missing_catalog";
  is_ready: boolean;
  has_mixed_values: boolean;
  services_count: number;
  classes_count: number;
  teachers_count: number;
  class_labels: string[];
  missing_reason: string | null;
};

export type HoraclasseServicesBuildResult = {
  service_assignments: HoraclasseServiceMeta[];
  subject_hour_rows: SubjectHourRow[];
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
    subject_hour_rows: number;
    subject_hour_rows_ready: number;
    subject_hour_rows_missing: number;
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

function makeFallbackHour(levelCode: string, catalogSubjectId: string): DefaultSubjectHour | null {
  const fallbackBySubject: Partial<
    Record<string, Pick<DefaultSubjectHour, "weeklyUnits" | "splitPattern" | "roomTypeRequired" | "notes">>
  > = {
    edhc: { weeklyUnits: 1, splitPattern: "1", notes: "Base HoraClasse : matière transversale, volume ajustable par l’admin." },
    ap: { weeklyUnits: 1, splitPattern: "1", notes: "Base HoraClasse : volume ajustable par l’admin." },
    musique: { weeklyUnits: 1, splitPattern: "1", notes: "Base HoraClasse : volume ajustable par l’admin." },
    informatique: { weeklyUnits: 1, splitPattern: "1", roomTypeRequired: "computer_lab", notes: "Base HoraClasse : volume ajustable par l’admin." },
    entrepreneuriat: { weeklyUnits: 1, splitPattern: "1", notes: "Base HoraClasse : volume ajustable par l’admin." },
  };

  const fallback = fallbackBySubject[catalogSubjectId];
  if (!fallback) return null;

  return {
    levelCode,
    subjectId: catalogSubjectId,
    weeklyUnits: fallback.weeklyUnits,
    splitPattern: fallback.splitPattern,
    roomTypeRequired: fallback.roomTypeRequired ?? null,
    notes: fallback.notes,
  };
}

function adjustHourForOfficialTrack(
  hour: DefaultSubjectHour,
  officialTrackCode: OfficialTrackCode | null,
  catalogSubjectId: string,
): DefaultSubjectHour {
  // Verrou officiel A1/A2 : la classe garde le niveau générique 1A/TleA,
  // mais le référentiel horaire change pour les séries A2.
  // Cela évite qu'une 1reA2 ou TleA2 récupère par erreur les heures d'une A1.
  if (catalogSubjectId === "maths" && officialTrackCode === "1ereA2") {
    return {
      ...hour,
      weeklyUnits: 3,
      splitPattern: "2+1",
      notes: "Référentiel officiel Mon Cahier : 1re A2 = 3h de mathématiques.",
    };
  }

  if (catalogSubjectId === "maths" && officialTrackCode === "tleA2") {
    return {
      ...hour,
      weeklyUnits: 4,
      splitPattern: "2+1+1",
      notes: "Référentiel officiel Mon Cahier : Tle A2 = 4h de mathématiques.",
    };
  }

  return hour;
}

function findHourForLevel(
  levelCode: string,
  catalogSubjectId: string,
  officialTrackCode: OfficialTrackCode | null,
): DefaultSubjectHour | null {
  const exact = findDefaultSubjectHour(levelCode, catalogSubjectId);
  if (exact) return adjustHourForOfficialTrack(exact, officialTrackCode, catalogSubjectId);

  const candidates = defaultSubjectHours.filter((item) => item.subjectId === catalogSubjectId);
  let found: DefaultSubjectHour | null = null;

  if (levelCode === "2A" || levelCode === "2C") {
    found = candidates.find((item) => item.levelCode === levelCode) || candidates.find((item) => item.levelCode === "2A") || null;
  } else if (levelCode === "1A" || levelCode === "1C" || levelCode === "1D") {
    found = candidates.find((item) => item.levelCode === levelCode) || candidates.find((item) => item.levelCode === "1A") || null;
  } else if (levelCode === "TleA" || levelCode === "TleC" || levelCode === "TleD") {
    found = candidates.find((item) => item.levelCode === levelCode) || candidates.find((item) => item.levelCode === "TleA") || null;
  }

  if (found) return adjustHourForOfficialTrack(found, officialTrackCode, catalogSubjectId);
  const fallback = makeFallbackHour(levelCode, catalogSubjectId);
  return fallback ? adjustHourForOfficialTrack(fallback, officialTrackCode, catalogSubjectId) : null;
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

  // Mapping strict : on évite les correspondances floues qui provoquent EPS -> P.C.
  return Boolean(
    (code && code === catalogCode) ||
      (label && (label === catalogName || label === catalogShortName)),
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

function valuesDiffer<T>(values: T[]): boolean {
  const cleaned = values.map((value) => String(value ?? ""));
  return new Set(cleaned).size > 1;
}

export function buildSubjectHourRows(serviceAssignments: HoraclasseServiceMeta[]): SubjectHourRow[] {
  const levelLabelByCode = new Map(defaultLevels.map((item) => [item.code, item.label]));
  const groups = new Map<string, HoraclasseServiceMeta[]>();

  for (const item of serviceAssignments) {
    const key = `${item.level_code}::${item.subject_id || item.catalog_subject_id}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }

  return Array.from(groups.values())
    .map((rows) => {
      const first = rows[0];
      const weeklyValues = rows.map((row) => row.weekly_units ?? null);
      const splitValues = rows.map((row) => row.split_pattern ?? "");
      const roomValues = rows.map((row) => row.room_type_required ?? "");
      const sourceValues = rows.map((row) => row.source);
      const classLabels = Array.from(new Set(rows.map((row) => row.class_label).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr"));
      const teacherIds = Array.from(new Set(rows.map((row) => row.teacher_id).filter(Boolean)));

      const hasMixedValues = valuesDiffer(weeklyValues) || valuesDiffer(splitValues) || valuesDiffer(roomValues);
      const isReady = rows.every((row) => row.is_ready);
      const hasOverride = sourceValues.includes("override");
      const hasMissing = sourceValues.includes("manual_missing_catalog") || !isReady;

      return {
        key: `${first.level_code}:${first.subject_id || first.catalog_subject_id}`,
        level_code: first.level_code,
        level_label: levelLabelByCode.get(first.level_code) || first.level_code || "Niveau",
        subject_id: first.subject_id,
        subject_label: first.subject_label,
        subject_code: first.subject_code,
        catalog_subject_id: first.catalog_subject_id,
        catalog_subject_label: first.catalog_subject_label,
        weekly_units: first.weekly_units,
        split_pattern: first.split_pattern,
        room_type_required: first.room_type_required,
        source: hasOverride ? "override" : hasMissing ? "manual_missing_catalog" : "default_catalog",
        is_ready: isReady,
        has_mixed_values: hasMixedValues,
        services_count: rows.length,
        classes_count: classLabels.length,
        teachers_count: teacherIds.length,
        class_labels: classLabels,
        missing_reason: !isReady
          ? `${rows.filter((row) => !row.is_ready).length} service(s) à compléter pour ${first.subject_label} en ${levelLabelByCode.get(first.level_code) || first.level_code}.`
          : hasMixedValues
            ? "Des valeurs différentes existent déjà selon les classes/services. Une sauvegarde ici uniformise ce niveau et cette matière."
            : null,
      } satisfies SubjectHourRow;
    })
    .sort((a, b) => {
      const levelA = defaultLevels.find((level) => level.code === a.level_code)?.displayOrder ?? 999;
      const levelB = defaultLevels.find((level) => level.code === b.level_code)?.displayOrder ?? 999;
      if (levelA !== levelB) return levelA - levelB;
      return a.subject_label.localeCompare(b.subject_label, "fr");
    });
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
    const classProfile = buildClassAcademicProfile({
      label: classLabel,
      level: row.level || classRow?.level,
      level_code: row.level_code || classRow?.level_code,
      series_code: row.series_code || classRow?.series_code,
      official_track_code: row.official_track_code || row.officialTrackCode || classRow?.official_track_code || classRow?.officialTrackCode,
    });
    const levelCode = classProfile.level_code;
    const seriesCode = classProfile.series_code;
    const officialTrackCode = classProfile.official_track_code;

    const subjectLabel = clean(row.subject_label || subjectRow?.label, "Matière");
    const subjectCode = row.subject_code || subjectRow?.code || null;
    const catalogSubjectId = clean(row.catalog_subject_id || subjectRow?.catalog_subject_id) ||
      inferCatalogSubjectId({
        code: subjectCode,
        label: subjectLabel,
        fallbackId: "",
      });

    const defaultHour = catalogSubjectId ? findHourForLevel(levelCode, catalogSubjectId, officialTrackCode) : null;
    const subject = catalogSubjectId ? getCatalogSubject(catalogSubjectId) : null;
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
      official_track_code: officialTrackCode,
      official_track_source: classProfile.official_track_source,
      teacher_id: teacherId,
      teacher_name: clean(row.teacher_name, "Enseignant"),
      subject_id: subjectId,
      subject_label: subjectLabel,
      subject_code: subjectCode ? clean(subjectCode) : null,
      catalog_subject_id: catalogSubjectId || subjectId,
      catalog_subject_label: subject?.shortName || subject?.name || subjectLabel,
      weekly_units: weeklyUnits,
      split_pattern: splitPattern,
      room_type_required: roomTypeRequired,
      source: override ? "override" : defaultHour ? "default_catalog" : "manual_missing_catalog",
      is_ready: Boolean(weeklyUnits && splitPattern),
      missing_reason: missingReason,
    } satisfies HoraclasseServiceMeta;
  });

  const subject_hour_rows = buildSubjectHourRows(service_assignments);
  const catalog_coverage = buildCatalogCoverage(subjects);
  const missing_catalog_subjects = catalog_coverage.filter((item) => !item.exists_in_mon_cahier);

  const missingServices = service_assignments.filter((item) => !item.is_ready).length;
  const customized = service_assignments.filter((item) => item.source === "override").length;
  const missingSubjectRows = subject_hour_rows.filter((item) => !item.is_ready).length;

  const unlockedServices = service_assignments.filter((item) => item.official_track_source !== "official").length;

  if (classes.length === 0) warnings.push("Aucune classe Mon Cahier détectée.");
  if (subjects.length === 0) warnings.push("Aucune matière Mon Cahier détectée.");
  if (affectations.length === 0) warnings.push("Aucune affectation active enseignant-matière-classe détectée.");
  if (unlockedServices > 0) warnings.push(`${unlockedServices} service(s) utilisent encore un niveau/série déduit. Renseigne la série officielle dans Classes pour verrouiller le référentiel.`);
  if (missingServices > 0) warnings.push(`${missingServices} service(s) ont besoin d’un volume manuel.`);
  if (missing_catalog_subjects.length > 0) {
    warnings.push(`${missing_catalog_subjects.length} matière(s) du référentiel HoraClasse ne sont pas encore activées dans Mon Cahier.`);
  }

  return {
    service_assignments,
    subject_hour_rows,
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
      subject_hour_rows: subject_hour_rows.length,
      subject_hour_rows_ready: subject_hour_rows.length - missingSubjectRows,
      subject_hour_rows_missing: missingSubjectRows,
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
