import { componentStorageLevel, selectProgramComponents, type SubjectComponent } from "@/lib/school-subject-components";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { isPrimaryComposition } from "@/lib/grades/primary-evaluation-kind";
import { readPrimaryEventsCatalog, primaryEventTitle, parsePrimaryEventTitle, primaryPassageAverage, type PrimaryEvent } from "@/lib/grades/primary-evaluation-events";
import { buildProgramBulletinDraft, type OfficialEvaluationScore } from "@/lib/franco-arabic-bulletin-calculation";
import { normalizePedagogicalLevel, resolveEvaluationTeachingTrack, resolvePedagogicalEngine, resolveProgramCoefficients, type InstitutionCoefficient } from "@/lib/pedagogical-engine";
import { buildProtectedStudentPhotoUrl } from "@/lib/studentPhotoAccess";
import { primarySubjectScale } from "@/lib/grades/primary-subject-scale";
import type { BulletinSchool, BulletinDocument, BulletinProgram } from "@/components/bulletins/FrancoArabicBulletin";
import { SCHOOL_CYCLE_OPTIONS, type SchoolCycle, type TeachingTrack } from "@/lib/school-cycles";
import { buildPedagogicalRanks } from "@/lib/pedagogical-ranking";
import { isBilingualSchool, programsForStudent, readStudentProgramSettings } from "@/lib/school-student-programs";
import { sameSchoolLevel } from "@/lib/school-levels";
import { selectedBulletinFormat } from "@/lib/franco-arabic-reporting";
import { inferSchoolCycleFromLevel } from "@/lib/school-cycles";
import { classSubjectIds, hasCiPrimaryFrenchReference } from "@/lib/school-class-subjects";
import { ciPrimaryFrenchEntryForName, ciPrimaryFrenchDenominator, ciPrimaryFrenchBulletinRows } from "@/lib/primary-french-reference-ci";
import { readSchoolTeachingSignatories } from "@/lib/school-teaching-signatories";
import { adaptHistoricalFrenchSecondaryBulletins, type HistoricalSecondaryFrenchResponse } from "@/lib/server/historical-french-secondary-adapter";

export type SpecializedBulletinPayload = {
  engine: "specialized"; cycle: SchoolCycle; format: "separate" | "combined" | "both";
  coefficientSource: "institution" | "program"; programs: TeachingTrack[];
  /** Shared once: an inline school logo can be several hundred kilobytes. */
  school?: BulletinSchool;
  documents: Array<{ studentId: string; document: BulletinDocument; ready: boolean;
    programReadiness: Partial<Record<TeachingTrack, boolean>>; problems: string[] }>;
};
type SchoolClass = { id: string; institution_id?: string | null; level?: string | null; label?: string | null; academic_year?: string | null; education_type?: string | null; formation_code?: string | null; head_teacher_id?: string | null };
type Student = { id: string; institution_id: string; full_name: string | null; first_name: string | null; last_name: string | null; matricule: string | null; birthdate: string | null; birth_place?: string | null; gender?: string | null; photo_path?: string | null; photo_updated_at?: string | null };
type PublishedScore = { id: string; student_id: string; evaluation_id: string; subject_id: string | null; score: number | null; scale: number; coeff: number; publication_version: number };
type Evaluation = { subject_component_id: string | null; id: string; subject_id: string | null; eval_kind: string; title: string | null; is_published: boolean; publication_status: string | null; publication_version: number | null; grading_period_id: string | null };

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
  institutionHeadName?: string | null; institutionHeadTitle?: string | null;
  schoolDetails?: Partial<BulletinSchool>;
  searchParams: URLSearchParams; role: string;
  /** SERVER-ONLY callback into the identical historical bulletin route. */
  loadHistoricalFrench: (period: { from: string; to: string; academicYear: string; verifiedLinkedStudentIds: string[] }) =>
    Promise<{ status: number; data: unknown }>;
}): Promise<NextResponse | null> {
  const selected = resolvePedagogicalEngine(input.settingsJson, input.schoolClass);
  if (selected.engine === "legacy") return null;
  if (selected.engine === "invalid") return json({ ok: false, error: "SPECIALIZED_CONFIGURATION_INVALID",
    message: "La configuration des bulletins spécialisés contient des valeurs contradictoires ou invalides. Vérifiez les niveaux, barèmes et coefficients avant l’édition." }, 409);
  if (input.schoolClass.institution_id !== input.institutionId) return json({ ok: false, error: "CLASS_FORBIDDEN" }, 403);
  // Le Correspondant Fichier consulte/imprime les bulletins de son établissement.
  // Il ne reçoit aucun accès aux mutations de notes ou aux paramètres de publication.
  // Les autres profils demeurent exclus de ce moteur spécialisé.
  if (input.role !== "admin" && input.role !== "file_correspondent") {
    return json({ ok: false, error: "FORBIDDEN" }, 403);
  }
  const { cycle, school, reports } = selected;
  if (cycle === "preschool") return json({ ok: false, error: "PRESCHOOL_QUALITATIVE_STORAGE_REQUIRED",
    message: "Le livret de compétences nécessite un catalogue et des observations validés. Aucun calcul de moyenne n’est appliqué au préscolaire." }, 409);
  const { service, institutionId, schoolClass, searchParams } = input;
  const year = schoolClass.academic_year;
  const level = String(schoolClass.level || "").trim();
  if (!year || !level || (searchParams.has("academic_year") && searchParams.get("academic_year") !== year)) {
    return json({ ok: false, error: "CLASS_ACADEMIC_CONTEXT_REQUIRED" }, 400);
  }
  const storedYear = readStudentProgramSettings(input.settingsJson).years[year];
  const classPolicy = storedYear?.classes[schoolClass.id];
  if (classPolicy && !classPolicy.tracks.length) {
    return json({ ok: false, error: "CLASS_TEACHING_NOT_CONFIGURED" }, 409);
  }
  try {
    const primaryCatalog = cycle === "primary"
      ? readPrimaryEventsCatalog(input.settingsJson).years[year]?.events || [] : [];
    const eventsMode = cycle === "primary" && primaryCatalog.length > 0;
    const eventCode = searchParams.get("primary_event_code");
    const primaryEvent = eventsMode ? primaryCatalog.find(event =>
      event.code === eventCode && event.levels.includes(level.replace(/[\s.-]/g, "").toUpperCase() as any)) : null;
    if (eventsMode && (!primaryEvent || (primaryEvent.kind === "internal" && !primaryEvent.printBulletin))) {
      return json({ ok: false, error: "PRIMARY_EVENT_NOT_APPLICABLE_TO_CLASS" }, 400);
    }
    const periods = eventsMode ? null : await listApplicableGradePeriods(service, institutionId, year, schoolClass.id);
    const period = primaryEvent ? {
      id: "MCPE:" + primaryEvent.code, start_date: primaryEvent.date, end_date: primaryEvent.date,
      label: primaryEvent.label, code: primaryEvent.code,
    } : periods?.items.find(row => row.is_active !== false &&
      (searchParams.get("period_id") ? row.id === searchParams.get("period_id") :
        row.start_date === searchParams.get("from") && row.end_date === searchParams.get("to")));
    if (!period) return json({ ok: false, error: "PERIOD_NOT_APPLICABLE_TO_CLASS" }, 400);
    const [enrollments, activeSubjects, coefficientRows, curriculum, evaluations, published, componentRows] = await Promise.all([
      pages<{ student_id: string; students: Student | Student[] | null }>((from, to) => service.from("class_enrollments")
        .select("student_id,students(id,institution_id,full_name,first_name,last_name,matricule,birthdate,birth_place,gender,photo_path,photo_updated_at)")
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
        .select("id,subject_id,subject_component_id,eval_kind,title,is_published,publication_status,publication_version,grading_period_id")
        .eq("class_id", schoolClass.id).gte("eval_date", period.start_date).lte("eval_date", period.end_date).order("id").range(from, to)),
      pages<PublishedScore>((from, to) => service.from("grade_published_scores")
        .select("id,student_id,evaluation_id,subject_id,score,scale,coeff,publication_version")
        .eq("institution_id", institutionId).eq("class_id", schoolClass.id).eq("is_current", true)
        .gte("eval_date", period.start_date).lte("eval_date", period.end_date).order("id").range(from, to)),
      cycle !== "secondary" ? Promise.resolve([] as SubjectComponent[]) : pages<SubjectComponent>((from, to) => service.from("grade_subject_components")
        .select("id,subject_id,level,code,label,short_label,coeff_in_subject,order_index,is_active")
        .eq("institution_id", institutionId).order("order_index").order("id").range(from, to)),
    ]);
    // A specialized teaching class may contain a pupil enrolled administratively
    // in its French/Arabic counterpart. Re-verify home enrollment and grade.
    // Historical bulletin flow above this function remains untouched.
    const links = classPolicy?.linkedStudentIds || [];
    if (links.length) {
      if (classPolicy?.tracks.length !== 1) {
        return json({ ok: false, error: "CLASS_TEACHING_LINK_INVALID" }, 409);
      }
      const homes = await pages<{ student_id: string; class_id: string }>((from, to) =>
        service.from("class_enrollments").select("student_id,class_id")
          .eq("institution_id", institutionId).is("end_date", null)
          .in("student_id", links).order("student_id").range(from, to));
      if (homes.length !== links.length) {
        return json({ ok: false, error: "STUDENT_PROGRAM_LINK_STALE" }, 409);
      }
      const homeIds = [...new Set(homes.map(row => row.class_id))];
      const sources = await pages<{ id: string; institution_id: string; academic_year: string; level: string | null }>((from, to) =>
        service.from("classes").select("id,institution_id,academic_year,level")
          .eq("institution_id", institutionId).eq("academic_year", year)
          .in("id", homeIds).order("id").range(from, to));
      const byStudent = new Map(homes.map(row => [row.student_id, row.class_id]));
      const byClass = new Map(sources.map(row => [row.id, row]));
      for (const studentId of links) {
        const source = byClass.get(byStudent.get(studentId) || "");
        const fromTrack = source && programsForStudent(storedYear?.classes[source.id], studentId,
          school.teachingTracksByCycle[cycle] || []);
        const fromCycle = source && (school.classCycleById[source.id] || inferSchoolCycleFromLevel(source.level));
        if (!source || source.institution_id !== institutionId || source.academic_year !== year ||
          fromCycle !== cycle || !sameSchoolLevel(source.level, level, cycle) ||
          fromTrack?.length !== 1 || fromTrack[0] === classPolicy.tracks[0]) {
          return json({ ok: false, error: "STUDENT_PROGRAM_LINK_STALE" }, 409);
        }
      }
      const profiles = await pages<Student>((from, to) => service.from("students")
        .select("id,institution_id,full_name,first_name,last_name,matricule,birthdate,birth_place,gender,photo_path,photo_updated_at")
        .eq("institution_id", institutionId).in("id", links).order("id").range(from, to));
      if (profiles.length !== links.length) {
        return json({ ok: false, error: "STUDENT_SCOPE_INVALID" }, 409);
      }
      for (const profile of profiles) enrollments.push({ student_id: profile.id, students: profile });
    }
    const students = new Map<string, Student>();
    for (const row of enrollments) {
      const student = Array.isArray(row.students) ? row.students[0] : row.students;
      if (!student || student.id !== row.student_id || student.institution_id !== institutionId) {
        return json({ ok: false, error: "STUDENT_SCOPE_INVALID" }, 409);
      }
      students.set(student.id, student);
    }
    const evaluationById = new Map(evaluations.map(row => [row.id, row]));
    const trackBySubject = new Map(activeSubjects.map(row => [row.subject_id,
      resolveEvaluationTeachingTrack(input.settingsJson, cycle, row.subject_id)]));
    const officialScores: OfficialEvaluationScore[] = [];
    const publicationProblems: string[] = [];
    for (const row of published) {
      if (!students.has(row.student_id)) continue;
      const evaluation = evaluationById.get(row.evaluation_id);
      if (!evaluation || !evaluation.is_published || (evaluation.publication_status && evaluation.publication_status !== "published")) continue;
      if (evaluation.grading_period_id && evaluation.grading_period_id !== period.id) continue;
      // Primaire avec calendrier : sélection exacte de l’événement, jamais un devoir
      // ni une évaluation interne dans un bulletin de composition officielle.
      if (cycle === "primary") {
        if (primaryEvent) {
          if (evaluation.title !== primaryEventTitle(primaryEvent)) continue;
        } else if (evaluation.grading_period_id !== period.id || !isPrimaryComposition(evaluation)) continue;
      }
      if (evaluation.subject_id !== row.subject_id || row.publication_version !== evaluation.publication_version) {
        publicationProblems.push("official_publication_version_mismatch"); continue;
      }
      // Null means absent, never a numerical zero.
      if (row.score === null || !row.subject_id) continue;
      const teachingTrack = classPolicy?.tracks.length === 1 &&
          school.subjectTracksByCycle[cycle]?.[row.subject_id]?.includes(classPolicy.tracks[0])
          ? classPolicy.tracks[0] : trackBySubject.get(row.subject_id) ?? null;
      if (cycle === "secondary" && evaluation.subject_component_id && teachingTrack) {
        const allowed = selectProgramComponents(componentRows.filter(component => component.subject_id === row.subject_id),
          { cycle, track: teachingTrack, level, storageLevel: componentStorageLevel(cycle, teachingTrack, level) });
        if (!allowed.some(component => component.id === evaluation.subject_component_id)) {
          publicationProblems.push("evaluation_component_outside_program"); continue;
        }
      }
      officialScores.push({ studentId: row.student_id, evaluationId: row.evaluation_id, subjectId: row.subject_id,
        score: row.score, scale: row.scale, evaluationCoefficient: row.coeff, isCurrentPublished: true,
        componentId: evaluation.subject_component_id, teachingTrack });
    }
    const allPrograms = school.teachingTracksByCycle[cycle] || [];
    const programs = (classPolicy
      ? allPrograms.filter(track => classPolicy.tracks.includes(track))
      : allPrograms).filter(track => !primaryEvent || primaryEvent.tracks.includes(track));
    if (!programs.length) return json({ ok: false, error: "PRIMARY_EVENT_TEACHING_NOT_APPLICABLE" }, 400);
    // The historical secondary-French route, not this specialized calculator,
    // owns ALL French general-secondary marks, coefficients, averages, ranking,
    // conduct (including institution-specific rules), bonuses and decisions.
    const useHistoricalFrench = cycle === "secondary" && programs.includes("french");
    const signatories = readSchoolTeachingSignatories(input.settingsJson);
    let historicalFrenchPrograms = new Map<string, BulletinProgram>();
    let historicalHeadTeacher: unknown = null;
    if (useHistoricalFrench) {
      const history = await input.loadHistoricalFrench({ from: String(period.start_date),
        to: String(period.end_date), academicYear: String(year), verifiedLinkedStudentIds: links });
      if (history.status !== 200) return json({
        ok: false, error: "SECONDARY_FRENCH_HISTORICAL_ENGINE_UNAVAILABLE",
        historicalStatus: history.status,
        historicalError: (history.data as { error?: string } | null)?.error || null,
      }, history.status >= 400 && history.status < 500 ? history.status : 503);
      historicalHeadTeacher = (history.data as { class?: { head_teacher?: unknown } }).class?.head_teacher || null;
      historicalFrenchPrograms = adaptHistoricalFrenchSecondaryBulletins(
        history.data as HistoricalSecondaryFrenchResponse,
        { level, className: schoolClass.label || level, year,
          period: period.label || period.code || "",
          directorName: signatories.french?.name || null },
      );
    }
    const resolved = programs.filter(track => !(useHistoricalFrench && track === "french"))
      .map(track => ({ track, ...resolveProgramCoefficients({
      cycle, level, track, settingsJson: input.settingsJson,
      activeSubjectIds: activeSubjects.map(row => row.subject_id),
      classSubjectIds: classSubjectIds(input.settingsJson, year, schoolClass.id),
      hasLevelCurriculumCatalog: curriculum.length > 0,
      levelSubjectIds: curriculum.filter(row => normalizePedagogicalLevel(row.level_code, cycle) === normalizePedagogicalLevel(level, cycle)).map(row => row.subject_id),
      institutionCoefficients: coefficientRows,
    }) }));
    const subjectNames = new Map(activeSubjects.map(row => {
      const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
      return [row.subject_id, row.custom_name || subject?.name || row.subject_id];
    }));
    const ciPrimaryFrench = cycle === "primary" &&
      hasCiPrimaryFrenchReference(input.settingsJson, year, schoolClass.id);
    const ciDenominators = Object.fromEntries(activeSubjects.map(row => {
      const entry = ciPrimaryFrenchEntryForName(subjectNames.get(row.subject_id) || "");
      return [row.subject_id, entry ? ciPrimaryFrenchDenominator(level, entry.code) : 10];
    }));
    const primaryDenominators = cycle === "primary" && reports.primarySubjectScales !== undefined
      ? Object.fromEntries(activeSubjects.map(row => [row.subject_id, primarySubjectScale(input.settingsJson, {
          year, classId: schoolClass.id, level, track: "arabic", subjectId: row.subject_id,
          subjectName: subjectNames.get(row.subject_id) || "",
        })])) : undefined;
    const { data: primaryAssignments } = cycle === "primary" && classPolicy?.tracks.length === 1 && !schoolClass.head_teacher_id
      ? await service.from("class_teachers").select("teacher_id").eq("institution_id", institutionId)
          .eq("class_id", schoolClass.id).is("end_date", null).limit(501) : { data: [] };
    const teacherIds = [...new Set((primaryAssignments || []).map(row => row.teacher_id))];
    const primaryTeacherId = schoolClass.head_teacher_id || (teacherIds.length === 1 ? teacherIds[0] : null);
    const { data: primaryTeacher } = cycle === "primary" && primaryTeacherId
      ? await service.from("profiles").select("display_name").eq("id", primaryTeacherId)
          .eq("institution_id", institutionId).maybeSingle()
      : { data: null };
    const scoresByStudent = new Map<string, OfficialEvaluationScore[]>();
    for (const score of officialScores) {
      const rows = scoresByStudent.get(score.studentId) || [];
      rows.push(score); scoresByStudent.set(score.studentId, rows);
    }
    // Récupération de la série officielle uniquement pour le bulletin de passage.
    // Aucun devoir, examen blanc ni évaluation interne ne peut alimenter la MGA.
    const passageMode = cycle === "primary" && primaryEvent?.kind === "passage";
    const applicableOrdinaryEvents = passageMode ? primaryCatalog.filter(event =>
      event.kind === "official" && event.levels.includes(level.replace(/[\s.-]/g, "").toUpperCase() as any)) : [];
    const [annualEvaluations, annualPublished] = passageMode
      ? await Promise.all([
        pages<Evaluation>((from, to) => service.from("grade_evaluations")
          .select("id,subject_id,subject_component_id,eval_kind,title,is_published,publication_status,publication_version,grading_period_id")
          .eq("class_id", schoolClass.id).gte("eval_date", year.slice(0,4) + "-09-01")
          .lte("eval_date", year.slice(5) + "-08-31").order("id").range(from,to)),
        pages<PublishedScore>((from,to) => service.from("grade_published_scores")
          .select("id,student_id,evaluation_id,subject_id,score,scale,coeff,publication_version")
          .eq("institution_id",institutionId).eq("class_id",schoolClass.id).eq("is_current",true)
          .gte("eval_date",year.slice(0,4) + "-09-01").lte("eval_date",year.slice(5) + "-08-31")
          .order("id").range(from,to)),
      ]) : [[], []] as [Evaluation[], PublishedScore[]];
    const annualEvaluationById = new Map(annualEvaluations.map(row => [row.id, row]));
    const annualScoresByEvent = new Map<string, OfficialEvaluationScore[]>();
    for (const score of annualPublished) {
      const evalRow = annualEvaluationById.get(score.evaluation_id);
      const marker = parsePrimaryEventTitle(evalRow?.title);
      if (!marker || (marker.kind !== "official" && marker.kind !== "passage") ||
          !evalRow?.is_published || (evalRow.publication_status && evalRow.publication_status !== "published") ||
          score.publication_version !== evalRow.publication_version || !score.subject_id ||
          evalRow.subject_id !== score.subject_id || score.score === null || !students.has(score.student_id)) continue;
      const configured = primaryCatalog.find(event => event.code === marker.code && event.kind === marker.kind);
      if (!configured || !configured.levels.includes(level.replace(/[\s.-]/g, "").toUpperCase() as any)) continue;
      const eventTrack = trackBySubject.get(score.subject_id) ?? null;
      const entry: OfficialEvaluationScore = {
        studentId: score.student_id, evaluationId: score.evaluation_id,
        subjectId: score.subject_id, score: score.score, scale: score.scale,
        evaluationCoefficient: score.coeff, isCurrentPublished: true,
        componentId: evalRow.subject_component_id, teachingTrack: eventTrack,
      };
      const list = annualScoresByEvent.get(configured.code) || [];
      list.push(entry); annualScoresByEvent.set(configured.code, list);
    }
    const results = [...students.values()].map(student => ({ student, drafts: resolved.map(policy => buildProgramBulletinDraft({
      studentId: student.id, cycle, level, track: policy.track, school, reports, officialScores: scoresByStudent.get(student.id) || [],
      subjectComponents: cycle !== "secondary" ? undefined : policy.policies.flatMap(subject => selectProgramComponents(
        componentRows.filter(component => component.subject_id === subject.subjectId),
        { cycle, track: policy.track, level, storageLevel: componentStorageLevel(cycle, policy.track, level) })),
      resolvedPolicies: policy.policies, configurationProblems: [...policy.problems, ...publicationProblems],
      ...(ciPrimaryFrench && policy.track === "french" ? { primaryCiDenominators: ciDenominators } : {}),
      ...(cycle === "primary" && policy.track === "arabic" && primaryDenominators
        ? { primarySubjectDenominators: primaryDenominators } : {}),
    })) }));
    const ranksByProgram = new Map(programs.map(track => [track, buildPedagogicalRanks(results.map(row => {
      const draft = row.drafts.find(item => item.track === track);
      return { studentId: row.student.id, average: draft?.generalAverage ?? null, complete: draft?.status === "ready" };
    }))]));

    const subjectTotals = new Map<string, { total: number; count: number }>();
    if (cycle === "primary") for (const result of results) for (const draft of result.drafts) {
      for (const subject of draft.subjects) if (subject.average !== null) {
        const key = `${draft.track}:${subject.subjectId}`;
        const tally = subjectTotals.get(key) || { total: 0, count: 0 };
        tally.total += subject.average; tally.count += 1; subjectTotals.set(key, tally);
      }
    }
    const documents: SpecializedBulletinPayload["documents"] = results.map(({ student, drafts }) => {
      const document: BulletinDocument = {
        school: { name: input.institutionName || "", code: input.institutionCode, isFrancoArabic: isBilingualSchool(school),
          generalDirectorName: input.institutionHeadName, generalDirectorTitle: input.institutionHeadTitle },
        student: { id: student.id, firstName: student.first_name || "", lastName: student.last_name || student.full_name || "",
          matricule: student.matricule, birthDate: student.birthdate, birthPlace: student.birth_place,
          gender: student.gender, photoUrl: buildProtectedStudentPhotoUrl(student) },
      };
      const historicalFrench = useHistoricalFrench ? historicalFrenchPrograms.get(student.id) : null;
      if (historicalFrench) document.french = historicalFrench;
      for (const draft of drafts) {
        const rank = ranksByProgram.get(draft.track)?.get(student.id) ?? null;
        const isCiPrimaryFrench = ciPrimaryFrench && draft.track === "french";
        // In specialized primary bulletins show ONLY subjects actually graded
        // for this student and this period. Keep a genuine zero, omit null.
        // The 11 configured subjects remain available in teacher/admin screens.
        const rawSubjectRows = draft.subjects
          .filter(subject => cycle !== "primary" || (typeof subject.average === "number" && Number.isFinite(subject.average)))
          .map(subject => ({ id: subject.subjectId,
            name: subjectNames.get(subject.subjectId) || subject.subjectId,
            coefficient: subject.coefficient, average: subject.average,
            classAverage: (() => { const tally = subjectTotals.get(`${draft.track}:${subject.subjectId}`);
              return tally?.count ? Math.round(tally.total / tally.count * 100) / 100 : null; })(),
            includeInAverage: subject.includeInAverage, denominator: subject.denominator, components: subject.components }));
        const bulletinSubjectRows = isCiPrimaryFrench
          ? ciPrimaryFrenchBulletinRows(level, rawSubjectRows) : rawSubjectRows;
        const annualOrdinary = passageMode ? applicableOrdinaryEvents.filter(event => event.tracks.includes(draft.track)).map(event => {
          const policy = resolved.find(item => item.track === draft.track);
          const row = policy && buildProgramBulletinDraft({
            studentId: student.id, cycle, level, track: draft.track, school, reports,
            officialScores: annualScoresByEvent.get(event.code) || [],
            resolvedPolicies: policy.policies, configurationProblems: policy.problems,
            ...(ciPrimaryFrench && draft.track === "french" ? { primaryCiDenominators: ciDenominators } : {}),
            ...(cycle === "primary" && draft.track === "arabic" && primaryDenominators
              ? { primarySubjectDenominators: primaryDenominators } : {}),
          });
          return { label: event.label, average: row?.status === "ready" ? row.generalAverage : null };
        }) : [];
        const annualComplete = passageMode && annualOrdinary.length > 0 &&
          annualOrdinary.every(item => item.average !== null) && draft.status === "ready";
        const annualAverage = annualComplete ? primaryPassageAverage(
          annualOrdinary.map(item => item.average as number), draft.generalAverage) : null;
        const annualDecision = annualAverage === null ? null :
          (annualAverage >= (draft.maximumScore || 10) / 2 ? "ADMIS" : "AVIS DU CONSEIL DES MAÎTRES REQUIS");
        const program: BulletinProgram = { track: draft.track, cycle: SCHOOL_CYCLE_OPTIONS.find(option => option.id === cycle)?.label || cycle, level, className: schoolClass.label || level,
          ciPrimaryFrench: isCiPrimaryFrench,
          primarySubjectScores: isCiPrimaryFrench || (cycle === "primary" && draft.track === "arabic" && primaryDenominators !== undefined),
          teacherName: cycle === "primary" ? primaryTeacher?.display_name || null : null,
          year, period: period.label || period.code || "", denominator: draft.maximumScore || 0,
          subjects: bulletinSubjectRows,
          generalAverage: draft.generalAverage, rank, classSize: students.size,
          ...(passageMode ? { primaryAnnual: { ordinary: annualOrdinary,
            ordinaryAverage: annualComplete ? Math.round((annualOrdinary.reduce((sum, item) => sum + (item.average as number), 0) / annualOrdinary.length) * 100) / 100 : null,
            passageAverage: draft.generalAverage, annualAverage, decision: annualDecision } } : {}),
          appreciation: draft.status === "ready" ? null : "Résultats incomplets — configuration ou notes à vérifier.",
          directorName: signatories[draft.track]?.name || (!isBilingualSchool(school) ? input.institutionHeadName : null) || null,
        };
        document[draft.track] = program;
      }
      const readiness: Partial<Record<TeachingTrack, boolean>> =
        Object.fromEntries(drafts.map(draft => {
          const program = document[draft.track];
          const annualReady = !passageMode || (program?.primaryAnnual?.annualAverage != null);
          return [draft.track, draft.status === "ready" && annualReady];
        }));
      if (useHistoricalFrench) readiness.french = historicalFrench != null;
      const errors = [...drafts.flatMap(row => row.problems)];
      if (passageMode && !programs.every(track => readiness[track])) errors.push("PRIMARY_ANNUAL_INCOMPLETE");
      if (useHistoricalFrench && !historicalFrench) errors.push("SECONDARY_FRENCH_STUDENT_MISSING_IN_HISTORICAL_RESULT");
      // Valid historical NC is preserved, never silently converted to 0.
      return { studentId: student.id, document,
        ready: programs.every(track => readiness[track] === true),
        programReadiness: readiness, problems: [...new Set(errors)] };
    });
    return json({ ok: true, class: { ...schoolClass, label: schoolClass.label || level, head_teacher: historicalHeadTeacher },
      period: { from: period.start_date, to: period.end_date, label: period.label, academic_year: year },
      subjects: [], items: [], specialized: { engine: "specialized", cycle, format: selectedBulletinFormat(reports, cycle),
        coefficientSource: reports.coefficientSource === "program" ? "program" : "institution", programs, documents,
        school: { ...input.schoolDetails, name: input.institutionName || "", code: input.institutionCode,
          isFrancoArabic: isBilingualSchool(school), generalDirectorName: input.institutionHeadName,
          generalDirectorTitle: input.institutionHeadTitle } },
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "SPECIALIZED_DATA_UNAVAILABLE" }, 503);
  }
}
