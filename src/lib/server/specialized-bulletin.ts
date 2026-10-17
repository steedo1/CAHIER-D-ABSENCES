import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { buildProgramBulletinDraft, type OfficialEvaluationScore } from "@/lib/franco-arabic-bulletin-calculation";
import { normalizePedagogicalLevel, resolveEvaluationTeachingTrack, resolvePedagogicalEngine, resolveProgramCoefficients, type InstitutionCoefficient } from "@/lib/pedagogical-engine";
import type { BulletinDocument, BulletinProgram } from "@/components/bulletins/FrancoArabicBulletin";
import { SCHOOL_CYCLE_OPTIONS, type SchoolCycle, type TeachingTrack } from "@/lib/school-cycles";

export type SpecializedBulletinPayload = {
  engine: "specialized"; cycle: SchoolCycle; format: "separate" | "combined" | "both";
  coefficientSource: "institution" | "program"; programs: TeachingTrack[];
  documents: Array<{ studentId: string; document: BulletinDocument; ready: boolean; problems: string[] }>;
};
type SchoolClass = { id: string; institution_id?: string | null; level?: string | null; label?: string | null; academic_year?: string | null; education_type?: string | null; formation_code?: string | null };
type Student = { id: string; institution_id: string; full_name: string | null; first_name: string | null; last_name: string | null; matricule: string | null; birthdate: string | null };
type PublishedScore = { id: string; student_id: string; evaluation_id: string; subject_id: string | null; score: number | null; scale: number; coeff: number; publication_version: number };
type Evaluation = { id: string; subject_id: string | null; is_published: boolean; publication_status: string | null; publication_version: number | null; grading_period_id: string | null };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const result = await query(offset, offset + 499);
    if (result.error || !result.data) throw new Error("SPECIALIZED_DATA_UNAVAILABLE");
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
  throw new Error("SPECIALIZED_DATA_LIMIT");
}

/** Called by the EXISTING bulletin endpoint after authentication and class scope.
 * Returns null before any query unless the server configuration opts in.
 * No writes, no duplicate marks, no student_grades fallback, no per-student SQL. */
export async function loadSpecializedBulletin(input: {
  service: SupabaseClient; institutionId: string; schoolClass: SchoolClass;
  settingsJson: unknown; institutionName: string | null; institutionCode: string | null;
  searchParams: URLSearchParams; role: string;
}): Promise<NextResponse | null> {
  const selected = resolvePedagogicalEngine(input.settingsJson, input.schoolClass);
  if (selected.engine === "legacy") return null;
  if (input.schoolClass.institution_id !== input.institutionId) return json({ ok: false, error: "CLASS_FORBIDDEN" }, 403);
  // Restricted directors are not provisioned until every grade route is scoped.
  if (input.role !== "admin") return json({ ok: false, error: "FORBIDDEN" }, 403);
  const { cycle, school, reports } = selected;
  if (cycle === "preschool") return json({ ok: false, error: "PRESCHOOL_QUALITATIVE_STORAGE_REQUIRED",
    message: "Le livret de compétences nécessite un catalogue et des observations validés. Aucun calcul de moyenne n’est appliqué au préscolaire." }, 409);
  const { service, institutionId, schoolClass, searchParams } = input;
  const year = schoolClass.academic_year;
  const level = String(schoolClass.level || "").trim();
  if (!year || !level || (searchParams.has("academic_year") && searchParams.get("academic_year") !== year)) {
    return json({ ok: false, error: "CLASS_ACADEMIC_CONTEXT_REQUIRED" }, 400);
  }
  try {
    const periods = await listApplicableGradePeriods(service, institutionId, year, schoolClass.id);
    const period = periods.items.find(row => row.is_active !== false &&
      (searchParams.get("period_id") ? row.id === searchParams.get("period_id") :
        row.start_date === searchParams.get("from") && row.end_date === searchParams.get("to")));
    if (!period) return json({ ok: false, error: "PERIOD_NOT_APPLICABLE_TO_CLASS" }, 400);
    const [enrollments, activeSubjects, coefficientRows, curriculum, evaluations, published] = await Promise.all([
      pages<{ student_id: string; students: Student | Student[] | null }>((from, to) => service.from("class_enrollments")
        .select("student_id,students(id,institution_id,full_name,first_name,last_name,matricule,birthdate)")
        .eq("class_id", schoolClass.id).is("end_date", null).order("student_id").range(from, to)),
      pages<{ subject_id: string; custom_name: string | null; subjects: { name: string } | { name: string }[] | null }>((from, to) => service.from("institution_subjects")
        .select("subject_id,custom_name,subjects(name)").eq("institution_id", institutionId).eq("is_active", true).order("id").range(from, to)),
      reports.coefficientSource === "program" ? Promise.resolve([] as InstitutionCoefficient[]) :
        pages<InstitutionCoefficient>((from, to) => service.from("institution_subject_coeffs")
          .select("level,subject_id,coeff,include_in_average").eq("institution_id", institutionId).order("subject_id").order("level").range(from, to)),
      reports.coefficientSource === "program" ? Promise.resolve([] as Array<{ subject_id: string; level_code: string }>) :
        pages<{ subject_id: string; level_code: string }>((from, to) => {
          let query = service.from("institution_level_subjects").select("subject_id,level_code")
            .eq("institution_id", institutionId).eq("is_active", true).eq("education_type", schoolClass.education_type || "general_secondary");
          query = schoolClass.formation_code ? query.eq("formation_code", schoolClass.formation_code) : query.is("formation_code", null);
          return query.order("id").range(from, to);
        }),
      pages<Evaluation>((from, to) => service.from("grade_evaluations")
        .select("id,subject_id,is_published,publication_status,publication_version,grading_period_id")
        .eq("class_id", schoolClass.id).gte("eval_date", period.start_date).lte("eval_date", period.end_date).order("id").range(from, to)),
      pages<PublishedScore>((from, to) => service.from("grade_published_scores")
        .select("id,student_id,evaluation_id,subject_id,score,scale,coeff,publication_version")
        .eq("institution_id", institutionId).eq("class_id", schoolClass.id).eq("is_current", true)
        .gte("eval_date", period.start_date).lte("eval_date", period.end_date).order("id").range(from, to)),
    ]);
    const students = new Map<string, Student>();
    for (const row of enrollments) {
      const student = Array.isArray(row.students) ? row.students[0] : row.students;
      if (!student || student.id !== row.student_id || student.institution_id !== institutionId) {
        return json({ ok: false, error: "STUDENT_SCOPE_INVALID" }, 409);
      }
      students.set(student.id, student);
    }
    const evaluationById = new Map(evaluations.map(row => [row.id, row]));
    const officialScores: OfficialEvaluationScore[] = [];
    const publicationProblems: string[] = [];
    for (const row of published) {
      if (!students.has(row.student_id)) continue;
      const evaluation = evaluationById.get(row.evaluation_id);
      if (!evaluation || !evaluation.is_published || (evaluation.publication_status && evaluation.publication_status !== "published")) continue;
      if (evaluation.grading_period_id && evaluation.grading_period_id !== period.id) continue;
      if (evaluation.subject_id !== row.subject_id || row.publication_version !== evaluation.publication_version) {
        publicationProblems.push("official_publication_version_mismatch"); continue;
      }
      // Null means absent, never a numerical zero.
      if (row.score === null || !row.subject_id) continue;
      officialScores.push({ studentId: row.student_id, evaluationId: row.evaluation_id, subjectId: row.subject_id,
        score: row.score, scale: row.scale, evaluationCoefficient: row.coeff, isCurrentPublished: true,
        teachingTrack: resolveEvaluationTeachingTrack(input.settingsJson, cycle, row.subject_id) });
    }
    const programs = school.teachingTracksByCycle[cycle] || [];
    const resolved = programs.map(track => ({ track, ...resolveProgramCoefficients({
      cycle, level, track, settingsJson: input.settingsJson,
      activeSubjectIds: activeSubjects.map(row => row.subject_id),
      levelSubjectIds: curriculum.filter(row => normalizePedagogicalLevel(row.level_code) === normalizePedagogicalLevel(level)).map(row => row.subject_id),
      institutionCoefficients: coefficientRows,
    }) }));
    const results = [...students.values()].map(student => ({ student, drafts: resolved.map(policy => buildProgramBulletinDraft({
      studentId: student.id, cycle, level, track: policy.track, school, reports, officialScores,
      resolvedPolicies: policy.policies, configurationProblems: [...policy.problems, ...publicationProblems],
    })) }));
    const subjectNames = new Map(activeSubjects.map(row => {
      const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
      return [row.subject_id, row.custom_name || subject?.name || row.subject_id];
    }));
    const documents: SpecializedBulletinPayload["documents"] = results.map(({ student, drafts }) => {
      const document: BulletinDocument = {
        school: { name: input.institutionName || "", code: input.institutionCode },
        student: { id: student.id, firstName: student.first_name || "", lastName: student.last_name || student.full_name || "",
          matricule: student.matricule, birthDate: student.birthdate },
      };
      for (const draft of drafts) {
        const other = results.map(row => row.drafts.find(item => item.track === draft.track)).filter(item => item?.status === "ready");
        const rank = draft.generalAverage === null ? null : 1 + other.filter(item => (item?.generalAverage ?? -Infinity) > draft.generalAverage!).length;
        const program: BulletinProgram = { track: draft.track, cycle: SCHOOL_CYCLE_OPTIONS.find(option => option.id === cycle)?.label || cycle, level, className: schoolClass.label || level,
          year, period: period.label || period.code || "", denominator: draft.maximumScore || 0,
          subjects: draft.subjects.map(subject => ({ id: subject.subjectId, name: subjectNames.get(subject.subjectId) || subject.subjectId,
            coefficient: subject.coefficient, average: subject.average, includeInAverage: subject.includeInAverage })),
          generalAverage: draft.generalAverage, rank, classSize: students.size,
          appreciation: draft.status === "ready" ? null : "Résultats incomplets — configuration ou notes à vérifier.",
        };
        document[draft.track] = program;
      }
      return { studentId: student.id, document, ready: drafts.length > 0 && drafts.every(row => row.status === "ready"),
        problems: [...new Set(drafts.flatMap(row => row.problems))] };
    });
    return json({ ok: true, class: { ...schoolClass, label: schoolClass.label || level },
      period: { from: period.start_date, to: period.end_date, label: period.label, academic_year: year },
      subjects: [], items: [], specialized: { engine: "specialized", cycle, format: reports.format,
        coefficientSource: reports.coefficientSource === "program" ? "program" : "institution", programs, documents },
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "SPECIALIZED_DATA_UNAVAILABLE" }, 503);
  }
}
