import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "founder"]);
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

export async function GET(request: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const requestedInstitutionId = text(new URL(request.url).searchParams.get("institution_id"));
  const { data: profile } = await srv
    .from("profiles")
    .select("id,institution_id,role")
    .eq("id", user.id)
    .maybeSingle();
  const { data: roleRows, error: roleError } = await srv
    .from("user_roles")
    .select("profile_id,institution_id,role")
    .eq("profile_id", user.id);
  if (roleError) return NextResponse.json({ error: roleError.message }, { status: 400 });

  const allowedInstitutions = new Set<string>();
  if (ALLOWED_ROLES.has(text((profile as any)?.role)) && text((profile as any)?.institution_id)) {
    allowedInstitutions.add(text((profile as any).institution_id));
  }
  for (const row of roleRows || []) {
    if (ALLOWED_ROLES.has(text((row as any).role)) && text((row as any).institution_id)) {
      allowedInstitutions.add(text((row as any).institution_id));
    }
  }

  const institutionId = requestedInstitutionId || Array.from(allowedInstitutions)[0] || "";
  if (!institutionId) return NextResponse.json({ error: "no_institution" }, { status: 403 });
  if (!allowedInstitutions.has(institutionId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const generatedAt = new Date().toISOString();
    const [institution, academicYears, profiles, userRoles, classes, subjectRows, teacherSubjects,
      students, enrollments, periods, timetables, absenceRequests, sessions,
      attendancePolicy, attendanceZones] = await Promise.all([
      srv.from("institutions").select("id,name,code,code_unique,tz,settings_json").eq("id", institutionId).maybeSingle(),
      selectRows(srv.from("academic_years").select("id,institution_id,code,label,start_date,end_date,is_current").eq("institution_id", institutionId), "academic_years"),
      selectRows(srv.from("profiles").select("id,institution_id,display_name,email,phone").eq("institution_id", institutionId), "profiles"),
      selectRows(srv.from("user_roles").select("profile_id,institution_id,role").eq("institution_id", institutionId), "user_roles"),
      selectRows(srv.from("classes").select("id,institution_id,academic_year,label,level").eq("institution_id", institutionId), "classes"),
      selectRows(srv.from("institution_subjects").select("id,institution_id,subject_id,custom_name,subjects:subject_id(name,code)").eq("institution_id", institutionId), "institution_subjects"),
      selectRows(srv.from("teacher_subjects").select("profile_id,subject_id,institution_id").eq("institution_id", institutionId), "teacher_subjects"),
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

    // Un administrateur/fondateur peut intervenir dans l'établissement via
    // user_roles tout en gardant un autre institution_id principal sur son
    // profil. Le relais exige que chaque rôle arrive avec son profil dans le
    // même bootstrap : on complète donc explicitement les profils référencés.
    const knownProfileIds = new Set(profiles.map((row) => text(row.id)).filter(Boolean));
    const missingRoleProfileIds = Array.from(new Set(
      userRoles
        .map((row) => text(row.profile_id))
        .filter((profileId) => profileId && !knownProfileIds.has(profileId)),
    ));
    const roleProfiles = await selectProfilesByIds(srv, missingRoleProfileIds);
    const relayProfiles = Array.from(
      new Map(
        [...profiles, ...roleProfiles].map((row) => [text(row.id), {
          ...row,
          institution_id: institutionId,
        }]),
      ).values(),
    );

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

    const snapshot = {
      protocol_version: 1,
      snapshot_id: `cloud-${institutionId}-${Date.now()}`,
      institution_id: institutionId,
      generated_at: generatedAt,
      cursor: generatedAt,
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
        user_roles: relayUserRoles(userRoles, institutionId, generatedAt),
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
        teacher_subjects: teacherSubjects.flatMap((row) => {
          const subjectId = text(row.subject_id);
          const localSubject = subjectRows.find((subject) =>
            text(subject.id) === subjectId || text(subject.subject_id) === subjectId
          );
          if (!localSubject?.id || !row.profile_id) return [];
          return [withMeta({
            id: entityId(institutionId, row.profile_id, localSubject.id),
            institution_id: institutionId,
            teacher_id: row.profile_id,
            subject_id: localSubject.id,
          }, generatedAt)];
        }),
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
        class_enrollments: enrollments.map((row) => withMeta({
          id: entityId(institutionId, row.class_id, row.student_id, row.start_date || "active"),
          institution_id: institutionId,
          class_id: row.class_id,
          student_id: row.student_id,
          start_date: row.start_date || null,
          end_date: row.end_date || null,
        }, generatedAt)),
        institution_periods: periods.map((row) => withMeta(row, generatedAt)),
        teacher_timetables: timetables.map((row) => withMeta({ ...row, academic_year: null }, generatedAt)),
        teacher_absence_requests: absenceRequests.map((row) => withMeta({
          ...row,
          teacher_id: row.teacher_profile_id,
        }, generatedAt)),
        teacher_sessions: sessions.map((row) => withMeta({
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
    };

    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "relay_bootstrap_failed") },
      { status: 400 },
    );
  }
}
