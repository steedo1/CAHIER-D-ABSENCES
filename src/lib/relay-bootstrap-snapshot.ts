// Snapshot Cloud complet et transactionnel pour le relais local.
// Ce module ne fait aucune authentification HTTP : les routes appelantes
// doivent d'abord résoudre et autoriser l'établissement.

const RELAY_ROLES = new Set(["admin", "teacher", "class_device", "correspondent", "staff"]);
const ACADEMIC_REQUIRED_COLLECTIONS = [
  "academic_years", "profiles", "user_roles", "classes", "subjects",
  "teacher_subjects", "class_teachers", "educator_class_assignments", "students",
  "class_enrollments", "grade_periods", "institution_level_subjects",
  "institution_subject_coeffs", "institution_subject_grade_policies",
  "grade_subject_components", "grade_evaluations", "student_grades",
  "grade_published_scores", "grade_publication_events", "grade_adjustments",
  "grade_evaluation_locks", "institution_grade_publication_settings",
  "bulletin_subject_groups", "bulletin_subject_group_items", "bulletin_nc_overrides",
  "core_subject_weights", "institution_conduct_policies", "conduct_settings",
  "conduct_events", "conduct_penalties", "conduct_average_overrides",
  "student_penalties", "conduct_rubric_overrides", "teacher_signatures",
] as const;
const SCHEDULE_REQUIRED_COLLECTIONS = [
  "academic_years", "profiles", "user_roles", "classes", "subjects",
  "teacher_subjects", "class_teachers", "educator_class_assignments", "students",
  "class_enrollments", "institution_periods", "teacher_timetables",
  "teacher_absence_requests", "teacher_sessions", "attendance_marks",
] as const;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function entityId(...parts: unknown[]) {
  return parts.map(text).filter(Boolean).join(":");
}

function withMeta<T extends Record<string, any>>(row: T, generatedAt: string) {
  return {
    ...row,
    server_version: Number(row.server_version || 0),
    updated_at: text(row.updated_at) || generatedAt,
  };
}

type BootstrapSkip = {
  collection: string;
  entity_id: string;
  field: string;
  reference_id: string;
};

function indexSubjects(rows: any[]) {
  const result = new Map<string, string>();
  for (const row of rows) {
    const localId = text(row.id);
    if (!localId) continue;
    result.set(localId, localId);
    const baseId = text(row.subject_id);
    if (baseId && !result.has(baseId)) result.set(baseId, localId);
  }
  return result;
}

function uniqueById(rows: any[]) {
  const result = new Map<string, any>();
  for (const row of rows) {
    const id = text(row.id);
    if (id) result.set(id, row);
  }
  return Array.from(result.values());
}


function relayRole(value: unknown) {
  const role = text(value);
  if (RELAY_ROLES.has(role)) return role;
  if (role === "super_admin" || role === "founder") return "admin";
  if (role === "educator" || role === "infirmier" || role === "finance_manager") return "staff";
  return null;
}

function relayUserRoles(rows: any[], institutionId: string, generatedAt: string) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const row of rows) {
    const role = relayRole(row.role);
    const profileId = text(row.profile_id);
    if (!role || !profileId) continue;
    const id = entityId(institutionId, profileId, role);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(withMeta({
      id,
      institution_id: institutionId,
      profile_id: profileId,
      role,
    }, generatedAt));
  }
  return result;
}

async function selectRows(query: any, label: string) {
  const result: any[] = [];
  // 1 000 correspond à la limite PostgREST/Supabase habituelle. Chaque collection
  // est donc lue par pages bornées avant que la révision soit relue et validée.
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${label}:${error.message}`);
    const page = (data || []) as any[];
    result.push(...page);
    if (page.length < pageSize) return result;
    if (offset + pageSize >= 1_000_000) {
      throw new Error(`${label}:snapshot_collection_too_large`);
    }
  }
}

async function selectRowsByIds(
  srv: any,
  table: string,
  columns: string,
  field: string,
  ids: string[],
  label: string,
) {
  const result: any[] = [];
  for (let index = 0; index < ids.length; index += 300) {
    const batch = ids.slice(index, index + 300);
    if (!batch.length) continue;
    result.push(...await selectRows(
      srv.from(table).select(columns).in(field, batch),
      label,
    ));
  }
  return result;
}

async function selectProfilesByIds(srv: any, ids: string[]) {
  const result: any[] = [];
  for (let index = 0; index < ids.length; index += 500) {
    const batch = ids.slice(index, index + 500);
    if (!batch.length) continue;
    result.push(...await selectRows(
      srv
        .from("profiles")
        .select("id,institution_id,display_name,email,phone")
        .in("id", batch),
      "profiles_by_role",
    ));
  }
  return result;
}

async function selectAttendanceMarksBySessionIds(srv: any, sessionIds: string[]) {
  const result: any[] = [];
  for (let index = 0; index < sessionIds.length; index += 500) {
    const batch = sessionIds.slice(index, index + 500);
    if (!batch.length) continue;
    result.push(...await selectRows(
      srv
        .from("attendance_marks")
        .select("session_id,student_id,status,minutes_late,reason")
        .in("session_id", batch),
      "attendance_marks",
    ));
  }
  return result;
}

async function academicRevision(srv: any, institutionId: string) {
  const { data, error } = await srv
    .from("academic_revisions")
    .select("revision,updated_at")
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throw new Error(`academic_revision:${error.message}`);
  const revision = Number(data?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("academic_revision_invalid");
  }
  return {
    revision,
    updated_at: text(data?.updated_at) || null,
  };
}

async function attendanceScheduleRevision(srv: any, institutionId: string) {
  const { data, error } = await srv
    .from("attendance_schedule_revisions")
    .select("revision,updated_at")
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throw new Error(`attendance_schedule_revision:${error.message}`);
  const revision = Number(data?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("attendance_schedule_revision_invalid");
  }
  return {
    revision,
    updated_at: text(data?.updated_at) || null,
  };
}


export async function buildRelayBootstrapSnapshot(
  srv: any,
  institutionId: string,
  options: { includeAcademic?: boolean; includeSchedule?: boolean } = {},
) {
    const includeAcademic = options.includeAcademic !== false;
    const includeSchedule = options.includeSchedule !== false;
    const generatedAt = new Date().toISOString();
    const revisionBefore = await academicRevision(srv, institutionId);
    const scheduleRevisionBefore = await attendanceScheduleRevision(srv, institutionId);
    const [institution, academicYears, profiles, userRoles, classes, subjectRows, teacherSubjects, classTeachers,
      educatorAssignments, students, enrollments, periods, timetables, absenceRequests, sessions,
      gradePeriods, levelSubjects, subjectCoeffs, subjectPolicies, subjectComponents,
      publishedScores, evaluationLocks, publicationSettings, bulletinGroups, ncOverrides,
      coreSubjectWeights, conductPolicies, conductSettings, conductEvents, conductPenalties,
      conductAverageOverrides, conductRubricOverrides, teacherSignatures,
      studentPenalties,
      attendancePolicy, attendanceZones] = await Promise.all([
      srv.from("institutions").select("id,name,code,code_unique,tz,settings_json,logo_url,phone,email,regional_direction,postal_address,status,head_name,head_title,country_name,country_motto,ministry_name,bulletin_signatures_enabled,country_emblem_url,acronym").eq("id", institutionId).maybeSingle(),
      selectRows(srv.from("academic_years").select("id,institution_id,code,label,start_date,end_date,is_current").eq("institution_id", institutionId), "academic_years"),
      selectRows(srv.from("profiles").select("id,institution_id,display_name,email,phone").eq("institution_id", institutionId), "profiles"),
      selectRows(srv.from("user_roles").select("profile_id,institution_id,role").eq("institution_id", institutionId), "user_roles"),
      selectRows(srv.from("classes").select("id,institution_id,code,academic_year,label,level,head_teacher_id,official_track_code,education_type,formation_code,formation_level_code").eq("institution_id", institutionId), "classes"),
      selectRows(srv.from("institution_subjects").select("id,institution_id,subject_id,custom_name,subjects:subject_id(name,code)").eq("institution_id", institutionId), "institution_subjects"),
      selectRows(srv.from("teacher_subjects").select("profile_id,subject_id,institution_id").eq("institution_id", institutionId), "teacher_subjects"),
      selectRows(srv.from("class_teachers").select("id,institution_id,class_id,teacher_id,subject_id,start_date,end_date").eq("institution_id", institutionId), "class_teachers"),
      selectRows(srv.from("educator_class_assignments").select("id,institution_id,profile_id,level,class_id,updated_at").eq("institution_id", institutionId), "educator_class_assignments"),
      selectRows(srv.from("students").select("id,institution_id,matricule,first_name,last_name,full_name,gender,birthdate,birth_place,nationality,regime,is_repeater,is_boarder,is_affecte,lv2,lifecycle_status").eq("institution_id", institutionId), "students"),
      selectRows(srv.from("class_enrollments").select("id,institution_id,class_id,student_id,start_date,end_date,official_track_code").eq("institution_id", institutionId), "class_enrollments"),
      includeSchedule ? selectRows(srv.from("institution_periods").select("id,institution_id,weekday,label,start_time,end_time").eq("institution_id", institutionId), "institution_periods") : [],
      includeSchedule ? selectRows(srv.from("teacher_timetables").select("id,institution_id,class_id,subject_id,teacher_id,period_id,weekday").eq("institution_id", institutionId), "teacher_timetables") : [],
      includeSchedule ? selectRows(srv.from("teacher_absence_requests").select("id,institution_id,teacher_profile_id,start_date,end_date,reason_label,status,admin_comment").eq("institution_id", institutionId), "teacher_absence_requests") : [],
      includeSchedule ? selectRows(srv.from("teacher_sessions").select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,ended_at,origin").eq("institution_id", institutionId), "teacher_sessions") : [],
      includeAcademic ? selectRows(srv.from("grade_periods").select("id,institution_id,academic_year,code,label,short_label,start_date,end_date,order_index,is_active,kind,academic_year_id,coeff,scope_type,education_type,formation_code,display_code,profile_period_key,updated_at").eq("institution_id", institutionId), "grade_periods") : [],
      includeAcademic ? selectRows(srv.from("institution_level_subjects").select("id,institution_id,education_type,formation_code,level_code,subject_id,order_index,is_active,updated_at").eq("institution_id", institutionId), "institution_level_subjects") : [],
      includeAcademic ? selectRows(srv.from("institution_subject_coeffs").select("id,institution_id,level,subject_id,coeff,include_in_average,updated_at").eq("institution_id", institutionId), "institution_subject_coeffs") : [],
      includeAcademic ? selectRows(srv.from("institution_subject_grade_policies").select("id,institution_id,subject_id,include_in_general_average,include_in_conduct_average,conduct_weight,is_active,updated_at").eq("institution_id", institutionId), "institution_subject_grade_policies") : [],
      includeAcademic ? selectRows(srv.from("grade_subject_components").select("id,institution_id,subject_id,code,label,short_label,coeff_in_subject,order_index,is_active,level,created_at").eq("institution_id", institutionId), "grade_subject_components") : [],
      includeAcademic ? selectRows(srv.from("grade_published_scores").select("id,institution_id,class_id,evaluation_id,student_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,score,scale,coeff,publication_version,is_current,published_at,published_by,created_at").eq("institution_id", institutionId), "grade_published_scores") : [],
      includeAcademic ? selectRows(srv.from("grade_evaluation_locks").select("evaluation_id,institution_id,class_id,subject_id,teacher_id,is_locked,locked_by,locked_at,updated_at").eq("institution_id", institutionId), "grade_evaluation_locks") : [],
      includeAcademic ? selectRows(srv.from("institution_grade_publication_settings").select("institution_id,require_admin_validation,auto_push_on_publish,sms_digest_mode,updated_at").eq("institution_id", institutionId), "institution_grade_publication_settings") : [],
      includeAcademic ? selectRows(srv.from("bulletin_subject_groups").select("id,institution_id,level,code,label,short_label,order_index,annual_coeff,is_active,updated_at").eq("institution_id", institutionId), "bulletin_subject_groups") : [],
      includeAcademic ? selectRows(srv.from("bulletin_nc_overrides").select("id,institution_id,class_id,student_id,academic_year,period_from,period_to,scope,is_nc,reason,missing_subjects_snapshot,updated_at").eq("institution_id", institutionId), "bulletin_nc_overrides") : [],
      includeAcademic ? selectRows(srv.from("core_subject_weights").select("id,institution_id,level,subject_id,weight,is_exam_core,created_at").or(`institution_id.eq.${institutionId},institution_id.is.null`), "core_subject_weights") : [],
      includeAcademic ? selectRows(srv.from("institution_conduct_policies").select("id,institution_id,mode,classic_conduct_weight,missing_subject_strategy,is_active,updated_at").eq("institution_id", institutionId), "institution_conduct_policies") : [],
      includeAcademic ? selectRows(srv.from("conduct_settings").select("institution_id,assiduite_max,tenue_max,moralite_max,discipline_max,points_per_absent_hour,absent_hours_zero_threshold,absent_hours_note_after_threshold,lateness_mode,lateness_minutes_per_absent_hour,lateness_points_per_late,updated_at").eq("institution_id", institutionId), "conduct_settings") : [],
      includeAcademic ? selectRows(srv.from("conduct_events").select("id,institution_id,class_id,student_id,rubric,event_type,occurred_at,note,created_by,created_at").eq("institution_id", institutionId), "conduct_events") : [],
      includeAcademic ? selectRows(srv.from("conduct_penalties").select("id,institution_id,class_id,subject_id,student_id,rubric,points,points_removed,reason,author_id,author_profile_id,author_role_label,author_subject_name,period_id,occurred_at,client_action_id,created_at").eq("institution_id", institutionId), "conduct_penalties") : [],
      includeAcademic ? selectRows(srv.from("conduct_average_overrides").select("id,institution_id,class_id,student_id,academic_year,period_code,from_date,to_date,calculated_total,override_total,reason,edited_by,updated_at").eq("institution_id", institutionId), "conduct_average_overrides") : [],
      includeAcademic ? selectRows(srv.from("conduct_rubric_overrides").select("id,institution_id,class_id,student_id,academic_year,period_code,rubric_key,from_date,to_date,calculated_value,override_value,edited_by,updated_at").eq("institution_id", institutionId), "conduct_rubric_overrides") : [],
      includeAcademic ? selectRows(srv.from("teacher_signatures").select("id,institution_id,teacher_id,storage_path,sha256,updated_at").eq("institution_id", institutionId), "teacher_signatures") : [],
      includeAcademic ? selectRows(srv.from("student_penalties").select("id,institution_id,class_id,subject_id,teacher_id,student_id,rubric,points,reason,issued_at,meta,created_at").eq("institution_id", institutionId), "student_penalties") : [],
      srv.from("institution_attendance_policies")
        .select("enabled,allow_local_relay,relay_presence_secret,relay_proof_ttl_seconds")
        .eq("institution_id", institutionId)
        .maybeSingle(),
      srv.from("institution_attendance_zones")
        .select("id,name,latitude,longitude,radius_m,is_active")
        .eq("institution_id", institutionId)
        .eq("is_active", true),
    ]);

    if (institution.error || !institution.data) {
      throw new Error(`institution:${institution.error?.message || "not_found"}`);
    }

    const cloudClassIds = classes.map((row) => text(row.id)).filter(Boolean);
    const gradeEvaluations = includeAcademic ? await selectRowsByIds(
      srv,
      "grade_evaluations",
      "id,class_id,subject_id,teacher_id,eval_date,eval_kind,title,scale,coeff,academic_year,is_published,published_at,updated_at,academic_year_id,subject_component_id,grading_period_id,publication_status,submitted_at,submitted_by,reviewed_at,reviewed_by,review_comment,publication_version",
      "class_id",
      cloudClassIds,
      "grade_evaluations",
    ) : [];
    const evaluationIds = gradeEvaluations.map((row) => text(row.id)).filter(Boolean);
    const [studentGrades, publicationEvents, gradeAdjustments, bulletinGroupItems] =
      includeAcademic ? await Promise.all([
        selectRowsByIds(
          srv,
          "student_grades",
          "id,evaluation_id,student_id,score,comment,updated_by,updated_at",
          "evaluation_id",
          evaluationIds,
          "student_grades",
        ),
        selectRowsByIds(
          srv,
          "grade_publication_events",
          "id,evaluation_id,actor_profile_id,action,comment,created_at",
          "evaluation_id",
          evaluationIds,
          "grade_publication_events",
        ),
        selectRowsByIds(
          srv,
          "grade_adjustments",
          "id,class_id,subject_id,student_id,academic_year,grading_period_id,bonus,reason,created_by,created_at",
          "class_id",
          cloudClassIds,
          "grade_adjustments",
        ),
        selectRowsByIds(
          srv,
          "bulletin_subject_group_items",
          "id,group_id,subject_id,institution_subject_id,order_index,subject_coeff_override,is_optional,updated_at",
          "group_id",
          bulletinGroups.map((row) => text(row.id)).filter(Boolean),
          "bulletin_subject_group_items",
        ),
      ]) : [[], [], [], []];

    // Un profil peut être rattaché à l'établissement par une table pédagogique
    // tout en gardant un autre institution_id principal. Le relais exige que
    // chaque référence enseignante arrive avec son profil dans le même
    // bootstrap : on complète donc toute la fermeture des dépendances profils.
    const knownProfileIds = new Set(profiles.map((row) => text(row.id)).filter(Boolean));
    const referencedProfileIds = new Set([
      ...userRoles.map((row) => text(row.profile_id)),
      ...teacherSubjects.map((row) => text(row.profile_id)),
      ...classTeachers.map((row) => text(row.teacher_id)),
      ...educatorAssignments.map((row) => text(row.profile_id)),
      ...timetables.map((row) => text(row.teacher_id)),
      ...absenceRequests.map((row) => text(row.teacher_profile_id)),
      ...sessions.map((row) => text(row.teacher_id)),
      ...gradeEvaluations.map((row) => text(row.teacher_id)),
      ...teacherSignatures.map((row) => text(row.teacher_id)),
      ...studentPenalties.map((row) => text(row.teacher_id)),
    ].filter(Boolean));
    const missingProfileIds = Array.from(referencedProfileIds)
      .filter((profileId) => !knownProfileIds.has(profileId));
    const referencedProfiles = await selectProfilesByIds(srv, missingProfileIds);
    const relayProfiles = uniqueById([...profiles, ...referencedProfiles]).map((row) => ({
      ...row,
      institution_id: institutionId,
    }));
    const profileIds = new Set(relayProfiles.map((row) => text(row.id)).filter(Boolean));
    const classIds = new Set(classes.map((row) => text(row.id)).filter(Boolean));
    const studentIds = new Set(students.map((row) => text(row.id)).filter(Boolean));
    const periodIds = new Set(periods.map((row) => text(row.id)).filter(Boolean));
    const subjectIdMap = indexSubjects(subjectRows);
    const skipped: BootstrapSkip[] = [];
    const missing = (collection: string, row: any, field: string, reference: unknown) => {
      skipped.push({
        collection,
        entity_id:
          text(row.id) ||
          entityId(collection, row.class_id, row.teacher_id, row.profile_id, row.student_id),
        field,
        reference_id: text(reference) || "null",
      });
    };

    const normalizedUserRoles = userRoles.filter((row) => {
      if (profileIds.has(text(row.profile_id))) return true;
      missing("user_roles", row, "profile_id", row.profile_id);
      return false;
    });
    const normalizedTeacherSubjects = teacherSubjects.flatMap((row) => {
      const teacherId = text(row.profile_id);
      const localSubjectId = subjectIdMap.get(text(row.subject_id));
      if (!profileIds.has(teacherId)) {
        missing("teacher_subjects", row, "teacher_id", teacherId);
        return [];
      }
      if (!localSubjectId) {
        missing("teacher_subjects", row, "subject_id", row.subject_id);
        return [];
      }
      return [{ ...row, teacher_id: teacherId, subject_id: localSubjectId }];
    });
    const normalizedClassTeachers = classTeachers.flatMap((row) => {
      const teacherId = text(row.teacher_id);
      const classId = text(row.class_id);
      const rawSubjectId = text(row.subject_id);
      const localSubjectId = rawSubjectId
        ? subjectIdMap.get(rawSubjectId)
        : null;
      if (!profileIds.has(teacherId)) {
        missing("class_teachers", row, "teacher_id", teacherId);
        return [];
      }
      if (!classIds.has(classId)) {
        missing("class_teachers", row, "class_id", classId);
        return [];
      }
      if (rawSubjectId && !localSubjectId) {
        missing("class_teachers", row, "subject_id", rawSubjectId);
        return [];
      }
      return [{
        ...row,
        teacher_id: teacherId,
        class_id: classId,
        subject_id: localSubjectId,
      }];
    });
    const normalizedEnrollments = enrollments.flatMap((row) => {
      if (!classIds.has(text(row.class_id))) {
        missing("class_enrollments", row, "class_id", row.class_id);
        return [];
      }
      if (!studentIds.has(text(row.student_id))) {
        missing("class_enrollments", row, "student_id", row.student_id);
        return [];
      }
      return [row];
    });
    const normalizedTimetables = timetables.flatMap((row) => {
      const localSubjectId = subjectIdMap.get(text(row.subject_id));
      if (!classIds.has(text(row.class_id))) {
        missing("teacher_timetables", row, "class_id", row.class_id);
        return [];
      }
      if (!localSubjectId) {
        missing("teacher_timetables", row, "subject_id", row.subject_id);
        return [];
      }
      if (!profileIds.has(text(row.teacher_id))) {
        missing("teacher_timetables", row, "teacher_id", row.teacher_id);
        return [];
      }
      if (!periodIds.has(text(row.period_id))) {
        missing("teacher_timetables", row, "period_id", row.period_id);
        return [];
      }
      return [{ ...row, subject_id: localSubjectId }];
    });
    const normalizedAbsenceRequests = absenceRequests.flatMap((row) => {
      const teacherId = text(row.teacher_profile_id);
      if (!profileIds.has(teacherId)) {
        missing("teacher_absence_requests", row, "teacher_id", teacherId);
        return [];
      }
      if (!["pending", "approved", "rejected", "cancelled"].includes(text(row.status))) {
        missing("teacher_absence_requests", row, "status", row.status);
        return [];
      }
      return [{ ...row, teacher_id: teacherId }];
    });
    const normalizedSessions = sessions.flatMap((row) => {
      const localSubjectId = subjectIdMap.get(text(row.subject_id));
      if (!classIds.has(text(row.class_id))) {
        missing("teacher_sessions", row, "class_id", row.class_id);
        return [];
      }
      if (!localSubjectId) {
        missing("teacher_sessions", row, "subject_id", row.subject_id);
        return [];
      }
      if (!profileIds.has(text(row.teacher_id))) {
        missing("teacher_sessions", row, "teacher_id", row.teacher_id);
        return [];
      }
      return [{ ...row, subject_id: localSubjectId }];
    });
    const normalizedSessionIds = new Set(
      normalizedSessions.map((row) => text(row.id)).filter(Boolean),
    );
    const attendanceMarks = await selectAttendanceMarksBySessionIds(
      srv,
      Array.from(normalizedSessionIds),
    );
    const normalizedAttendanceMarks = attendanceMarks.flatMap((row) => {
      if (!normalizedSessionIds.has(text(row.session_id))) {
        missing("attendance_marks", row, "session_id", row.session_id);
        return [];
      }
      if (!studentIds.has(text(row.student_id))) {
        missing("attendance_marks", row, "student_id", row.student_id);
        return [];
      }
      return [row];
    });

    const mapSubjects = (collection: string, rows: any[], optional = false) =>
      rows.flatMap((row) => {
        const rawSubjectId = text(row.subject_id);
        if (!rawSubjectId && optional) return [{ ...row, subject_id: null }];
        const localSubjectId = subjectIdMap.get(rawSubjectId);
        if (!localSubjectId) {
          missing(collection, row, "subject_id", rawSubjectId);
          return [];
        }
        return [{ ...row, subject_id: localSubjectId }];
      });
    const normalizedEducatorAssignments = educatorAssignments.filter((row) => {
      if (!profileIds.has(text(row.profile_id))) {
        missing("educator_class_assignments", row, "profile_id", row.profile_id);
        return false;
      }
      if (row.class_id && !classIds.has(text(row.class_id))) {
        missing("educator_class_assignments", row, "class_id", row.class_id);
        return false;
      }
      return true;
    });
    const normalizedLevelSubjects = mapSubjects("institution_level_subjects", levelSubjects);
    const normalizedSubjectCoeffs = mapSubjects("institution_subject_coeffs", subjectCoeffs);
    const normalizedSubjectPolicies = mapSubjects(
      "institution_subject_grade_policies",
      subjectPolicies,
    );
    const normalizedSubjectComponents = mapSubjects(
      "grade_subject_components",
      subjectComponents,
    );
    const subjectComponentIds = new Set(
      normalizedSubjectComponents.map((row) => text(row.id)).filter(Boolean),
    );
    const gradePeriodIds = new Set(gradePeriods.map((row) => text(row.id)).filter(Boolean));
    const normalizedGradeEvaluations = gradeEvaluations.flatMap((row) => {
      const localSubjectId = subjectIdMap.get(text(row.subject_id));
      if (!classIds.has(text(row.class_id))) {
        missing("grade_evaluations", row, "class_id", row.class_id);
        return [];
      }
      if (!localSubjectId) {
        missing("grade_evaluations", row, "subject_id", row.subject_id);
        return [];
      }
      if (row.teacher_id && !profileIds.has(text(row.teacher_id))) {
        missing("grade_evaluations", row, "teacher_id", row.teacher_id);
        return [];
      }
      if (row.grading_period_id && !gradePeriodIds.has(text(row.grading_period_id))) {
        missing("grade_evaluations", row, "grading_period_id", row.grading_period_id);
        return [];
      }
      if (row.subject_component_id && !subjectComponentIds.has(text(row.subject_component_id))) {
        missing("grade_evaluations", row, "subject_component_id", row.subject_component_id);
        return [];
      }
      return [{ ...row, subject_id: localSubjectId }];
    });
    const normalizedEvaluationIds = new Set(
      normalizedGradeEvaluations.map((row) => text(row.id)).filter(Boolean),
    );
    const normalizedStudentGrades = studentGrades.filter((row) => {
      if (!normalizedEvaluationIds.has(text(row.evaluation_id))) {
        missing("student_grades", row, "evaluation_id", row.evaluation_id);
        return false;
      }
      if (!studentIds.has(text(row.student_id))) {
        missing("student_grades", row, "student_id", row.student_id);
        return false;
      }
      return true;
    });
    const normalizedPublishedScores = mapSubjects(
      "grade_published_scores",
      publishedScores,
      true,
    ).filter((row) => {
      for (const [field, values] of [
        ["class_id", classIds],
        ["evaluation_id", normalizedEvaluationIds],
        ["student_id", studentIds],
      ] as const) {
        if (!values.has(text(row[field]))) {
          missing("grade_published_scores", row, field, row[field]);
          return false;
        }
      }
      return true;
    });
    const normalizedPublicationEvents = publicationEvents.filter((row) => {
      if (normalizedEvaluationIds.has(text(row.evaluation_id))) return true;
      missing("grade_publication_events", row, "evaluation_id", row.evaluation_id);
      return false;
    });
    const normalizedGradeAdjustments = mapSubjects(
      "grade_adjustments",
      gradeAdjustments,
      true,
    ).filter((row) => {
      if (!classIds.has(text(row.class_id))) {
        missing("grade_adjustments", row, "class_id", row.class_id);
        return false;
      }
      if (!studentIds.has(text(row.student_id))) {
        missing("grade_adjustments", row, "student_id", row.student_id);
        return false;
      }
      return true;
    });
    const normalizedEvaluationLocks = mapSubjects(
      "grade_evaluation_locks",
      evaluationLocks,
      true,
    ).filter((row) => {
      if (!normalizedEvaluationIds.has(text(row.evaluation_id))) {
        missing("grade_evaluation_locks", row, "evaluation_id", row.evaluation_id);
        return false;
      }
      if (!classIds.has(text(row.class_id))) {
        missing("grade_evaluation_locks", row, "class_id", row.class_id);
        return false;
      }
      return true;
    });
    const evaluationLocksById = new Map(
      normalizedEvaluationLocks.map((row) => [text(row.evaluation_id), row]),
    );
    const bulletinGroupIds = new Set(bulletinGroups.map((row) => text(row.id)).filter(Boolean));
    const normalizedBulletinGroupItems = mapSubjects(
      "bulletin_subject_group_items",
      bulletinGroupItems,
      true,
    ).filter((row) => {
      if (bulletinGroupIds.has(text(row.group_id))) return true;
      missing("bulletin_subject_group_items", row, "group_id", row.group_id);
      return false;
    });
    const normalizedNcOverrides = ncOverrides.filter((row) => {
      if (!classIds.has(text(row.class_id))) {
        missing("bulletin_nc_overrides", row, "class_id", row.class_id);
        return false;
      }
      if (!studentIds.has(text(row.student_id))) {
        missing("bulletin_nc_overrides", row, "student_id", row.student_id);
        return false;
      }
      return true;
    });
    const normalizedCoreWeights = mapSubjects("core_subject_weights", coreSubjectWeights);
    const normalizeConductRows = (collection: string, rows: any[], subjectOptional = false) => {
      const mapped = subjectOptional ? mapSubjects(collection, rows, true) : rows;
      return mapped.filter((row) => {
        if (!classIds.has(text(row.class_id))) {
          missing(collection, row, "class_id", row.class_id);
          return false;
        }
        if (!studentIds.has(text(row.student_id))) {
          missing(collection, row, "student_id", row.student_id);
          return false;
        }
        return true;
      });
    };
    const normalizedConductEvents = normalizeConductRows("conduct_events", conductEvents);
    const normalizedConductPenalties = normalizeConductRows(
      "conduct_penalties",
      conductPenalties,
      true,
    );
    const normalizedStudentPenalties = mapSubjects(
      "student_penalties",
      studentPenalties,
      true,
    ).filter((row) => {
      if (!classIds.has(text(row.class_id))) {
        missing("student_penalties", row, "class_id", row.class_id);
        return false;
      }
      if (!studentIds.has(text(row.student_id))) {
        missing("student_penalties", row, "student_id", row.student_id);
        return false;
      }
      if (!profileIds.has(text(row.teacher_id))) {
        missing("student_penalties", row, "teacher_id", row.teacher_id);
        return false;
      }
      return true;
    });
    const normalizedConductAverageOverrides = normalizeConductRows(
      "conduct_average_overrides",
      conductAverageOverrides,
    );
    const normalizedConductRubricOverrides = normalizeConductRows(
      "conduct_rubric_overrides",
      conductRubricOverrides,
    );
    const normalizedTeacherSignatures = teacherSignatures.filter((row) => {
      if (profileIds.has(text(row.teacher_id))) return true;
      missing("teacher_signatures", row, "teacher_id", row.teacher_id);
      return false;
    });

    const optionalMigrationMissing =
      (attendancePolicy.error as any)?.code === "42P01" ||
      (attendanceZones.error as any)?.code === "42P01";
    if (!optionalMigrationMissing && (attendancePolicy.error || attendanceZones.error)) {
      throw new Error(
        `attendance_presence:${attendancePolicy.error?.message || attendanceZones.error?.message}`,
      );
    }
    const cloudSettings =
      (institution.data as any).settings_json &&
      typeof (institution.data as any).settings_json === "object"
        ? (institution.data as any).settings_json
        : {};
    const relayPresenceSettings = optionalMigrationMissing
      ? { enabled: false }
      : {
          enabled: attendancePolicy.data?.enabled === true,
          allow_local_relay: attendancePolicy.data?.allow_local_relay !== false,
          relay_presence_secret: attendancePolicy.data?.relay_presence_secret || null,
          relay_proof_ttl_seconds: Number(attendancePolicy.data?.relay_proof_ttl_seconds || 180),
          zones: attendanceZones.data || [],
        };
    const scheduleRevisionAfter = await attendanceScheduleRevision(srv, institutionId);
    const revisionAfter = await academicRevision(srv, institutionId);
    const snapshotComplete =
      skipped.length === 0 &&
      revisionBefore.revision === revisionAfter.revision &&
      scheduleRevisionBefore.revision === scheduleRevisionAfter.revision;

    const snapshot = {
      protocol_version: 1,
      snapshot_id: `cloud-${institutionId}-${Date.now()}`,
      institution_id: institutionId,
      snapshot_revision: scheduleRevisionAfter.revision,
      snapshot_completeness: snapshotComplete ? "complete" : "partial",
      generated_at: generatedAt,
      cursor: generatedAt,
      schedule_manifest: {
        class_teachers: normalizedClassTeachers.map((row) => ({
          institution_id: institutionId,
          class_id: text(row.class_id),
          teacher_id: text(row.teacher_id),
          subject_id: text(row.subject_id) || null,
          start_date: text(row.start_date) || null,
          end_date: text(row.end_date) || null,
        })),
      },
      institution: withMeta({
        id: institutionId,
        name: text((institution.data as any).name) || "Établissement",
        code: text((institution.data as any).code_unique) || text((institution.data as any).code) || null,
        timezone: text((institution.data as any).tz) || "Africa/Abidjan",
        settings_json: {
          ...cloudSettings,
          attendance_presence: relayPresenceSettings,
          academic_bulletin: {
            logo_url: (institution.data as any).logo_url || null,
            phone: (institution.data as any).phone || null,
            email: (institution.data as any).email || null,
            regional_direction: (institution.data as any).regional_direction || null,
            postal_address: (institution.data as any).postal_address || null,
            status: (institution.data as any).status || null,
            head_name: (institution.data as any).head_name || null,
            head_title: (institution.data as any).head_title || null,
            country_name: (institution.data as any).country_name || null,
            country_motto: (institution.data as any).country_motto || null,
            ministry_name: (institution.data as any).ministry_name || null,
            bulletin_signatures_enabled:
              (institution.data as any).bulletin_signatures_enabled === true,
            country_emblem_url: (institution.data as any).country_emblem_url || null,
            acronym: (institution.data as any).acronym || null,
          },
        },
      }, generatedAt),
      entities: {
        academic_years: academicYears.map((row) => withMeta(row, generatedAt)),
        profiles: relayProfiles.map((row) => withMeta({ ...row, is_active: true }, generatedAt)),
        user_roles: relayUserRoles(normalizedUserRoles, institutionId, generatedAt),
        classes: classes.map((row) => withMeta(row, generatedAt)),
        subjects: subjectRows.map((row) => {
          const linked = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
          return withMeta({
            id: row.id,
            institution_id: institutionId,
            base_subject_id: row.subject_id || null,
            name: text(row.custom_name) || text(linked?.name) || "Matière",
            short_name: text(linked?.code) || null,
          }, generatedAt);
        }),
        teacher_subjects: normalizedTeacherSubjects.map((row) =>
          withMeta({
            id: entityId(institutionId, row.teacher_id, row.subject_id),
            institution_id: institutionId,
            teacher_id: row.teacher_id,
            subject_id: row.subject_id,
          }, generatedAt)
        ),
        class_teachers: normalizedClassTeachers.map((row) => withMeta({
          ...row,
          id: text(row.id) || entityId(row.class_id, row.teacher_id, row.subject_id, row.start_date),
          institution_id: institutionId,
        }, generatedAt)),
        educator_class_assignments: normalizedEducatorAssignments.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        students: students.map((row) => withMeta({
          id: row.id,
          institution_id: institutionId,
          registration_number: row.matricule || null,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          display_name: text(row.full_name) || [row.last_name, row.first_name].filter(Boolean).join(" ").trim(),
          gender: row.gender || null,
          is_active: true,
          birthdate: row.birthdate || null,
          birth_place: row.birth_place || null,
          nationality: row.nationality || null,
          regime: row.regime || null,
          is_repeater: row.is_repeater === true,
          is_boarder: row.is_boarder === true,
          is_affecte: row.is_affecte === true,
          lv2: row.lv2 || null,
          lifecycle_status: row.lifecycle_status || null,
        }, generatedAt)),
        class_enrollments: normalizedEnrollments.map((row) => withMeta({
          id: text(row.id) || entityId(institutionId, row.class_id, row.student_id, row.start_date || "active"),
          institution_id: institutionId,
          class_id: row.class_id,
          student_id: row.student_id,
          start_date: row.start_date || null,
          end_date: row.end_date || null,
          official_track_code: row.official_track_code || null,
        }, generatedAt)),
        institution_periods: periods.map((row) => withMeta(row, generatedAt)),
        teacher_timetables: normalizedTimetables.map((row) =>
          withMeta({ ...row, academic_year: null }, generatedAt)
        ),
        teacher_absence_requests: normalizedAbsenceRequests.map((row) =>
          withMeta(row, generatedAt)
        ),
        teacher_sessions: normalizedSessions.map((row) => withMeta({
          ...row,
          client_session_id: row.id,
          origin:
            row.origin === "class_device" || row.origin === "admin"
              ? row.origin
              : "teacher",
        }, generatedAt)),
        attendance_marks: normalizedAttendanceMarks.map((row) => withMeta({
          id: entityId(row.session_id, row.student_id),
          institution_id: institutionId,
          session_id: row.session_id,
          student_id: row.student_id,
          status: row.status,
          late_minutes: Number(row.minutes_late || 0),
          comment: row.reason || null,
          source: "cloud",
          local_dirty: false,
        }, generatedAt)),
        grade_periods: gradePeriods.map((row) => withMeta({ ...row, is_locked: false }, generatedAt)),
        institution_level_subjects: normalizedLevelSubjects.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        institution_subject_coeffs: normalizedSubjectCoeffs.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        institution_subject_grade_policies: normalizedSubjectPolicies.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        grade_subject_components: normalizedSubjectComponents.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        grade_evaluations: normalizedGradeEvaluations.map((row) => withMeta({
          id: row.id,
          institution_id: institutionId,
          class_id: row.class_id,
          subject_id: row.subject_id,
          teacher_id: row.teacher_id || null,
          grade_period_id: row.grading_period_id || null,
          grading_period_id: row.grading_period_id || null,
          title: text(row.title) || text(row.eval_kind) || "Evaluation",
          evaluation_date: row.eval_date || null,
          eval_kind: row.eval_kind || null,
          max_score: Number(row.scale || 20),
          coefficient: Number(row.coeff || 1),
          academic_year: row.academic_year || null,
          academic_year_id: row.academic_year_id || null,
          subject_component_id: row.subject_component_id || null,
          is_published: row.is_published === true,
          is_locked: evaluationLocksById.get(text(row.id))?.is_locked === true,
          publication_status: row.publication_status || null,
          publication_version: Number(row.publication_version || 0),
          published_at: row.published_at || null,
          submitted_at: row.submitted_at || null,
          submitted_by: row.submitted_by || null,
          reviewed_at: row.reviewed_at || null,
          reviewed_by: row.reviewed_by || null,
          review_comment: row.review_comment || null,
          updated_at: row.updated_at,
        }, generatedAt)),
        student_grades: normalizedStudentGrades.map((row) => withMeta({
          ...row,
          id: text(row.id) || entityId(row.evaluation_id, row.student_id),
          institution_id: institutionId,
        }, generatedAt)),
        grade_published_scores: normalizedPublishedScores.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        grade_publication_events: normalizedPublicationEvents.map((row) =>
          withMeta({ ...row, institution_id: institutionId, updated_at: row.created_at }, generatedAt)
        ),
        grade_adjustments: normalizedGradeAdjustments.map((row) =>
          withMeta({ ...row, institution_id: institutionId, updated_at: row.created_at }, generatedAt)
        ),
        grade_evaluation_locks: normalizedEvaluationLocks.map((row) => withMeta({
          ...row,
          id: text(row.evaluation_id),
          institution_id: institutionId,
        }, generatedAt)),
        institution_grade_publication_settings: publicationSettings.map((row) => withMeta({
          ...row,
          id: institutionId,
          institution_id: institutionId,
        }, generatedAt)),
        bulletin_subject_groups: bulletinGroups.map((row) => withMeta(row, generatedAt)),
        bulletin_subject_group_items: normalizedBulletinGroupItems.map((row) =>
          withMeta({ ...row, institution_id: institutionId }, generatedAt)
        ),
        bulletin_nc_overrides: normalizedNcOverrides.map((row) => withMeta(row, generatedAt)),
        core_subject_weights: normalizedCoreWeights.map((row) => withMeta({
          ...row,
          institution_id: institutionId,
          updated_at: row.created_at,
        }, generatedAt)),
        institution_conduct_policies: conductPolicies.map((row) => withMeta(row, generatedAt)),
        conduct_settings: conductSettings.map((row) => withMeta({
          ...row,
          id: institutionId,
          institution_id: institutionId,
        }, generatedAt)),
        conduct_events: normalizedConductEvents.map((row) =>
          withMeta({ ...row, updated_at: row.created_at }, generatedAt)
        ),
        conduct_penalties: normalizedConductPenalties.map((row) =>
          withMeta({ ...row, updated_at: row.created_at }, generatedAt)
        ),
        student_penalties: normalizedStudentPenalties.map((row) =>
          withMeta({ ...row, updated_at: row.created_at }, generatedAt)
        ),
        conduct_average_overrides: normalizedConductAverageOverrides.map((row) =>
          withMeta(row, generatedAt)
        ),
        conduct_rubric_overrides: normalizedConductRubricOverrides.map((row) =>
          withMeta(row, generatedAt)
        ),
        teacher_signatures: normalizedTeacherSignatures.map((row) => withMeta(row, generatedAt)),
        textbook_assignments: [],
        textbook_items: [],
        textbook_sessions: [],
        textbook_completions: [],
        offline_documents: [],
      },
      diagnostics: {
        skipped_count: skipped.length,
        skipped,
        missing_profiles_requested: missingProfileIds.length,
        missing_profiles_found: referencedProfiles.length,
        revision_changed_during_generation:
          revisionBefore.revision !== revisionAfter.revision ||
          scheduleRevisionBefore.revision !== scheduleRevisionAfter.revision,
      },
    };

    const academicCollectionCounts: Record<string, number> = {};
    for (const collection of ACADEMIC_REQUIRED_COLLECTIONS) {
      const rows = snapshot.entities[collection as keyof typeof snapshot.entities];
      if (!Array.isArray(rows)) {
        throw new Error(`academic_snapshot_collection_not_built:${collection}`);
      }
      academicCollectionCounts[collection] = rows.length;
    }

    return {
      ...snapshot,
      academic_revision: revisionAfter.revision,
      academic_manifest: {
        required_collections: [...ACADEMIC_REQUIRED_COLLECTIONS],
        collection_counts: academicCollectionCounts,
      },
    };
}

export async function buildRelayScheduleSnapshot(srv: any, institutionId: string) {
  const snapshot = await buildRelayBootstrapSnapshot(srv, institutionId, {
    includeAcademic: false,
    includeSchedule: true,
  });
  return {
    ...snapshot,
    snapshot_id: `cloud-schedule-${institutionId}-${Date.now()}`,
    academic_revision: undefined,
    academic_manifest: undefined,
    entities: Object.fromEntries(
      SCHEDULE_REQUIRED_COLLECTIONS.map((collection) => [
        collection,
        snapshot.entities[collection as keyof typeof snapshot.entities],
      ]),
    ),
    diagnostics: {
      ...snapshot.diagnostics,
      snapshot_scope: "attendance_schedule",
    },
  };
}
