import {
  attendanceClassContextIsComplete,
  isNonGeneralAttendanceEducation,
  resolveAttendanceEducationContext,
} from "@/lib/education-attendance";

export type TextbookClassEducationContext = {
  education_type: string;
  education_label: string;
  education_short_label: string;
  formation_code: string | null;
  formation_label: string | null;
  formation_level_code: string | null;
  formation_level_label: string | null;
  education_context_key: string;
  education_context_label: string;
  education_context_complete: boolean;
};

export function decorateTextbookClassEducation(
  classRow: any,
  settingsJson?: unknown,
) {
  if (!classRow) return classRow;

  const context = resolveAttendanceEducationContext({
    educationType: classRow.education_type,
    formationCode: classRow.formation_code,
    formationLevelCode: classRow.formation_level_code,
    classLevel: classRow.level,
    settingsJson,
  });

  return {
    ...classRow,
    education_type: context.education_type,
    education_label: context.education_label,
    education_short_label: context.education_short_label,
    formation_code: context.formation_code,
    formation_label: context.formation_label,
    formation_level_code: context.formation_level_code,
    formation_level_label: context.formation_level_label,
    education_context_key: context.context_key,
    education_context_label: context.context_label,
    education_context_complete: attendanceClassContextIsComplete({
      educationType: context.education_type,
      formationCode: context.formation_code,
      formationLevelCode: context.formation_level_code,
    }),
  };
}

export function textbookClassEducationValidationError(classRow: any) {
  if (!classRow) {
    return {
      error: "class_not_found",
      message: "La classe liée à cette progression est introuvable.",
      status: 404,
    };
  }

  if (
    !attendanceClassContextIsComplete({
      educationType: classRow.education_type,
      formationCode: classRow.formation_code,
      formationLevelCode: classRow.formation_level_code,
    })
  ) {
    return {
      error: "class_education_context_incomplete",
      message:
        "Cette classe doit être rattachée à une formation et à une année de formation avant d'utiliser le cahier de textes.",
      status: 409,
    };
  }

  return null;
}

export async function validateTextbookSubjectForClass(input: {
  srv: any;
  institutionId: string;
  classRow: any;
  subjectId?: string | null;
}) {
  const classError = textbookClassEducationValidationError(input.classRow);
  if (classError) return { ok: false as const, ...classError };

  if (!isNonGeneralAttendanceEducation(input.classRow?.education_type)) {
    return { ok: true as const };
  }

  const subjectId = String(input.subjectId || "").trim();
  if (!subjectId) {
    return {
      ok: false as const,
      error: "subject_not_resolved_for_assignment",
      message:
        "La matière de cette progression ne peut pas être reliée au référentiel de la formation.",
      status: 409,
    };
  }

  const { data, error } = await input.srv
    .from("institution_level_subjects")
    .select("id")
    .eq("institution_id", input.institutionId)
    .eq(
      "education_type",
      String(input.classRow.education_type || "general_secondary"),
    )
    .eq("formation_code", String(input.classRow.formation_code || ""))
    .eq(
      "level_code",
      String(input.classRow.formation_level_code || ""),
    )
    .eq("subject_id", subjectId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      error: error.message,
      message: error.message,
      status: 400,
    };
  }

  if (!data) {
    return {
      ok: false as const,
      error: "subject_not_configured_for_formation_level",
      message:
        "Cette matière n’est pas configurée pour la formation et l’année de cette classe.",
      status: 409,
    };
  }

  return { ok: true as const };
}
