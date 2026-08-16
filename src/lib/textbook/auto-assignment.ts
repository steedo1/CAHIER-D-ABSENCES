import {
  buildTextbookSubjectCatalog,
  resolveTextbookAssignmentSubject,
  textbookAssignmentMatchesClassTeacherRows,
} from "@/lib/textbook/subject-matching";
import { textbookProgressionMatchesClass } from "@/lib/textbook/progression-context";

type SyncInput = {
  srv: any;
  institutionId: string;
  userId: string;
  academicYear?: string | null;
};

type SyncResult = {
  matched: number;
  created: number;
  reactivated: number;
  deactivated: number;
  skipped: number;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeLevel(value: unknown) {
  const raw = normalize(value);
  const aliases: Record<string, string> = {
    sixieme: "6e",
    "6eme": "6e",
    cinquieme: "5e",
    "5eme": "5e",
    quatrieme: "4e",
    "4eme": "4e",
    troisieme: "3e",
    "3eme": "3e",
    seconde: "2nde",
    "2de": "2nde",
    "2eme": "2nde",
    premiere: "1ere",
    "1ere": "1ere",
    terminale: "tle",
  };
  return aliases[raw] || raw;
}

function generalLevelMatches(progression: any, classRow: any) {
  const progressionLevel = normalizeLevel(progression?.level);
  if (!progressionLevel) return true;

  const classLevel = normalizeLevel(classRow?.level);
  const classLabel = normalize(classRow?.label || classRow?.name);

  if (progressionLevel === classLevel) return true;

  // Certains référentiels portent un niveau groupé comme "2nde A-C".
  if (
    (progressionLevel.includes("2ndea") && progressionLevel.includes("c")) ||
    progressionLevel === "2ndeac"
  ) {
    return classLevel === "2ndea" || classLevel === "2ndec";
  }

  // Le libellé de classe peut contenir la division : "4e1", "4e 1", etc.
  return Boolean(
    classLabel &&
      (classLabel.startsWith(progressionLevel) ||
        classLabel.includes(progressionLevel)),
  );
}

function sameAcademicYear(progression: any, classRow: any, requested?: string | null) {
  const progressionYear = clean(progression?.academic_year);
  const classYear = clean(classRow?.academic_year);
  const target = clean(requested);

  if (target && progressionYear && progressionYear !== target) return false;
  if (target && classYear && classYear !== target) return false;
  if (progressionYear && classYear && progressionYear !== classYear) return false;
  return true;
}

function preferenceScore(progression: any) {
  let score = 0;
  if (progression?.is_customized === true) score += 10_000_000_000_000;
  if (progression?.source_national_template_id) score += 1_000_000_000_000;
  const updated = Date.parse(
    clean(progression?.updated_at) || clean(progression?.created_at) || "",
  );
  if (Number.isFinite(updated)) score += updated;
  return score;
}

function assignmentKey(progressionId: unknown, classId: unknown) {
  return `${clean(progressionId)}|${clean(classId)}`;
}

export async function syncTextbookAssignmentsFromTeaching(
  input: SyncInput,
): Promise<SyncResult> {
  const { srv, institutionId, userId } = input;
  const academicYear = clean(input.academicYear) || null;

  let progressionsQuery = srv
    .from("textbook_progression_templates")
    .select(
      "id,academic_year,subject_id,institution_subject_id,subject_name,level,series,education_type,formation_code,formation_level_code,status,scope,source_national_template_id,is_customized,created_at,updated_at",
    )
    .eq("institution_id", institutionId)
    .eq("scope", "school")
    .eq("status", "active");

  if (academicYear) {
    progressionsQuery = progressionsQuery.eq("academic_year", academicYear);
  }

  let classesQuery = srv
    .from("classes")
    .select(
      "id,label,level,academic_year,institution_id,education_type,formation_code,formation_level_code",
    )
    .eq("institution_id", institutionId);

  if (academicYear) {
    classesQuery = classesQuery.eq("academic_year", academicYear);
  }

  const [
    { data: progressionRows, error: progressionError },
    { data: classRows, error: classError },
    { data: teacherRows, error: teacherError },
  ] = await Promise.all([
    progressionsQuery,
    classesQuery,
    srv
      .from("class_teachers")
      .select("class_id,teacher_id,subject_id")
      .eq("institution_id", institutionId)
      .is("end_date", null),
  ]);

  if (progressionError) throw progressionError;
  if (classError) throw classError;
  if (teacherError) throw teacherError;

  const progressions = (progressionRows || []) as any[];
  const classes = (classRows || []) as any[];
  const classTeachers = (teacherRows || []) as any[];

  if (!progressions.length || !classes.length || !classTeachers.length) {
    return {
      matched: 0,
      created: 0,
      reactivated: 0,
      deactivated: 0,
      skipped: progressions.length,
    };
  }

  const teacherRowsByClass = new Map<string, any[]>();
  for (const row of classTeachers) {
    const classId = clean(row?.class_id);
    if (!classId) continue;
    if (!teacherRowsByClass.has(classId)) teacherRowsByClass.set(classId, []);
    teacherRowsByClass.get(classId)!.push(row);
  }

  const catalog = await buildTextbookSubjectCatalog(srv, institutionId, [
    ...progressions.flatMap((row) => [
      row?.subject_id,
      row?.institution_subject_id,
    ]),
    ...classTeachers.map((row) => row?.subject_id),
  ]);

  type Candidate = {
    classRow: any;
    progression: any;
    subject: ReturnType<typeof resolveTextbookAssignmentSubject>;
  };

  const preferred = new Map<string, Candidate>();
  let skipped = 0;

  for (const classRow of classes) {
    const classId = clean(classRow?.id);
    const teachingRows = teacherRowsByClass.get(classId) || [];
    if (!classId || !teachingRows.length) continue;

    for (const progression of progressions) {
      if (!sameAcademicYear(progression, classRow, academicYear)) {
        skipped += 1;
        continue;
      }
      if (!textbookProgressionMatchesClass(progression, classRow)) {
        skipped += 1;
        continue;
      }
      if (
        clean(progression?.education_type || "general_secondary") ===
          "general_secondary" &&
        !generalLevelMatches(progression, classRow)
      ) {
        skipped += 1;
        continue;
      }

      const virtualAssignment = {
        class_id: classId,
        subject_id: progression?.subject_id || null,
        institution_subject_id: progression?.institution_subject_id || null,
        progression,
      };

      if (
        !textbookAssignmentMatchesClassTeacherRows(
          virtualAssignment,
          teachingRows,
          catalog,
        )
      ) {
        skipped += 1;
        continue;
      }

      const subject = resolveTextbookAssignmentSubject(
        virtualAssignment,
        catalog,
      );
      if (!subject) {
        skipped += 1;
        continue;
      }

      const subjectIdentity =
        subject.globalSubjectId ||
        subject.institutionSubjectId ||
        normalize(subject.displayName || progression?.subject_name);
      if (!subjectIdentity) {
        skipped += 1;
        continue;
      }

      const key = `${classId}|${subjectIdentity}`;
      const candidate: Candidate = { classRow, progression, subject };
      const current = preferred.get(key);
      if (
        !current ||
        preferenceScore(progression) > preferenceScore(current.progression)
      ) {
        preferred.set(key, candidate);
      }
    }
  }

  const desired = Array.from(preferred.values()).map((candidate) => ({
    institution_id: institutionId,
    progression_id: clean(candidate.progression?.id),
    class_id: clean(candidate.classRow?.id),
    teacher_id: null,
    subject_id:
      candidate.subject?.globalSubjectId ||
      candidate.progression?.subject_id ||
      null,
    institution_subject_id:
      candidate.subject?.institutionSubjectId ||
      candidate.progression?.institution_subject_id ||
      null,
    is_active: true,
    created_by: userId,
    updated_by: userId,
  }));

  const progressionIds = new Set(progressions.map((row) => clean(row?.id)));
  const classIds = new Set(classes.map((row) => clean(row?.id)));
  const desiredKeys = new Set(
    desired.map((row) => assignmentKey(row.progression_id, row.class_id)),
  );

  const { data: existingRows, error: existingError } = await srv
    .from("textbook_progression_class_assignments")
    .select(
      "id,progression_id,class_id,teacher_id,subject_id,institution_subject_id,is_active",
    )
    .eq("institution_id", institutionId)
    .is("teacher_id", null);

  if (existingError) throw existingError;

  const existing = (existingRows || []) as any[];
  const existingByKey = new Map<string, any>();
  for (const row of existing) {
    existingByKey.set(assignmentKey(row?.progression_id, row?.class_id), row);
  }

  let created = 0;
  let reactivated = 0;
  let deactivated = 0;

  for (const row of desired) {
    const key = assignmentKey(row.progression_id, row.class_id);
    const current = existingByKey.get(key);
    if (current?.id) {
      const subjectChanged =
        clean(current.subject_id) !== clean(row.subject_id) ||
        clean(current.institution_subject_id) !==
          clean(row.institution_subject_id);
      if (current.is_active !== true || subjectChanged) {
        const { error } = await srv
          .from("textbook_progression_class_assignments")
          .update({
            is_active: true,
            subject_id: row.subject_id,
            institution_subject_id: row.institution_subject_id,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", current.id);
        if (error) throw error;
        reactivated += 1;
      }
      continue;
    }

    const { error } = await srv
      .from("textbook_progression_class_assignments")
      .insert(row);
    if (error) throw error;
    created += 1;
  }

  // Les associations génériques de progressions encore actives sont recalées
  // sur les affectations pédagogiques réelles. Une affectation explicite à un
  // enseignant (teacher_id non nul) n'est jamais touchée ici.
  for (const row of existing) {
    const progressionId = clean(row?.progression_id);
    const classId = clean(row?.class_id);
    if (
      row?.is_active !== true ||
      !progressionIds.has(progressionId) ||
      !classIds.has(classId)
    ) {
      continue;
    }
    const key = assignmentKey(progressionId, classId);
    if (desiredKeys.has(key)) continue;

    const { error } = await srv
      .from("textbook_progression_class_assignments")
      .update({
        is_active: false,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) throw error;
    deactivated += 1;
  }

  return {
    matched: desired.length,
    created,
    reactivated,
    deactivated,
    skipped,
  };
}
