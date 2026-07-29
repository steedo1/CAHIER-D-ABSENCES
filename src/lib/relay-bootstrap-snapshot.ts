// Snapshot Cloud complet et transactionnel pour le relais local.
// Ce module ne fait aucune authentification HTTP : les routes appelantes
// doivent d'abord résoudre et autoriser l'établissement.

const RELAY_ROLES = new Set(["admin", "teacher", "class_device", "correspondent", "staff"]);

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
  const { data, error } = await query.limit(50000);
  if (error) throw new Error(`${label}:${error.message}`);
  return (data || []) as any[];
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
) {
    const generatedAt = new Date().toISOString();
    const revisionBefore = await attendanceScheduleRevision(srv, institutionId);
    const [institution, academicYears, profiles, userRoles, classes, subjectRows, teacherSubjects, classTeachers,
      students, enrollments, periods, timetables, absenceRequests, sessions,
      attendancePolicy, attendanceZones] = await Promise.all([
      srv.from("institutions").select("id,name,code,code_unique,tz,settings_json").eq("id", institutionId).maybeSingle(),
      selectRows(srv.from("academic_years").select("id,institution_id,code,label,start_date,end_date,is_current").eq("institution_id", institutionId), "academic_years"),
      selectRows(srv.from("profiles").select("id,institution_id,display_name,email,phone").eq("institution_id", institutionId), "profiles"),
      selectRows(srv.from("user_roles").select("profile_id,institution_id,role").eq("institution_id", institutionId), "user_roles"),
      selectRows(srv.from("classes").select("id,institution_id,academic_year,label,level").eq("institution_id", institutionId), "classes"),
      selectRows(srv.from("institution_subjects").select("id,institution_id,subject_id,custom_name,subjects:subject_id(name,code)").eq("institution_id", institutionId), "institution_subjects"),
      selectRows(srv.from("teacher_subjects").select("profile_id,subject_id,institution_id").eq("institution_id", institutionId), "teacher_subjects"),
      selectRows(srv.from("class_teachers").select("institution_id,class_id,teacher_id,subject_id,start_date,end_date").eq("institution_id", institutionId), "class_teachers"),
      selectRows(srv.from("students").select("id,institution_id,matricule,first_name,last_name,full_name,gender").eq("institution_id", institutionId), "students"),
      selectRows(srv.from("class_enrollments").select("institution_id,class_id,student_id,start_date,end_date").eq("institution_id", institutionId), "class_enrollments"),
      selectRows(srv.from("institution_periods").select("id,institution_id,weekday,label,start_time,end_time").eq("institution_id", institutionId), "institution_periods"),
      selectRows(srv.from("teacher_timetables").select("id,institution_id,class_id,subject_id,teacher_id,period_id,weekday").eq("institution_id", institutionId), "teacher_timetables"),
      selectRows(srv.from("teacher_absence_requests").select("id,institution_id,teacher_profile_id,start_date,end_date,reason_label,status,admin_comment").eq("institution_id", institutionId), "teacher_absence_requests"),
      selectRows(srv.from("teacher_sessions").select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,ended_at,origin").eq("institution_id", institutionId), "teacher_sessions"),
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

    // Un profil peut être rattaché à l'établissement par une table pédagogique
    // tout en gardant un autre institution_id principal. Le relais exige que
    // chaque référence enseignante arrive avec son profil dans le même
    // bootstrap : on complète donc toute la fermeture des dépendances profils.
    const knownProfileIds = new Set(profiles.map((row) => text(row.id)).filter(Boolean));
    const referencedProfileIds = new Set([
      ...userRoles.map((row) => text(row.profile_id)),
      ...teacherSubjects.map((row) => text(row.profile_id)),
      ...classTeachers.map((row) => text(row.teacher_id)),
      ...timetables.map((row) => text(row.teacher_id)),
      ...absenceRequests.map((row) => text(row.teacher_profile_id)),
      ...sessions.map((row) => text(row.teacher_id)),
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
    const revisionAfter = await attendanceScheduleRevision(srv, institutionId);
    const snapshotComplete =
      skipped.length === 0 &&
      revisionBefore.revision === revisionAfter.revision;

    const snapshot = {
      protocol_version: 1,
      snapshot_id: `cloud-${institutionId}-${Date.now()}`,
      institution_id: institutionId,
      snapshot_revision: revisionAfter.revision,
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
        students: students.map((row) => withMeta({
          id: row.id,
          institution_id: institutionId,
          registration_number: row.matricule || null,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          display_name: text(row.full_name) || [row.last_name, row.first_name].filter(Boolean).join(" ").trim(),
          gender: row.gender || null,
          is_active: true,
        }, generatedAt)),
        class_enrollments: normalizedEnrollments.map((row) => withMeta({
          id: entityId(institutionId, row.class_id, row.student_id, row.start_date || "active"),
          institution_id: institutionId,
          class_id: row.class_id,
          student_id: row.student_id,
          start_date: row.start_date || null,
          end_date: row.end_date || null,
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
          period_id: null,
          origin:
            row.origin === "class_device" || row.origin === "admin"
              ? row.origin
              : "teacher",
        }, generatedAt)),
        attendance_marks: [],
        grade_periods: [],
        grade_evaluations: [],
        student_grades: [],
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
          revisionBefore.revision !== revisionAfter.revision,
      },
    };


    return snapshot;
}
