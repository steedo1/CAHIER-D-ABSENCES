import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { defaultSubjectHours, defaultSubjects } from "@/modules/montage-emploi-du-temps/catalog/defaultCatalog";
import {
  clean,
  findDefaultSubjectHour,
  getCatalogSubject,
  inferCatalogSubjectId,
  inferLevelCode,
  inferSeriesCode,
  type HoraclasseServiceMeta,
} from "@/modules/montage-emploi-du-temps/adapters/horaclasseModelHelpers";
import { DEFAULT_TERRAIN_RULES } from "@/modules/montage-emploi-du-temps/scheduler/terrainRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hhmm(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "auth_failed", message: userErr.message },
        { status: 401 },
      ),
    };
  }

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 },
      ),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 },
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";

  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 },
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 },
      ),
    };
  }

  const role = String(roleRow?.role || "");

  if (!["admin", "super_admin"].includes(role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "forbidden",
          message: "Droits insuffisants pour accéder au montage emploi du temps.",
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id,
    institutionId,
  };
}

function buildServiceAssignments(input: {
  affectations: any[];
  volumeOverrides: any[];
}): HoraclasseServiceMeta[] {
  const volumeMap = new Map<string, any>();
  for (const item of input.volumeOverrides || []) {
    volumeMap.set(`${item.class_id}:${item.subject_id}:${item.teacher_id}`, item);
  }

  return input.affectations.map((row) => {
    const classId = clean(row.class_id);
    const classLabel = clean(row.class_label, "Classe");
    const levelCode = clean(row.level_code) || inferLevelCode(classLabel);
    const seriesCode = clean(row.series_code) || inferSeriesCode(levelCode);
    const catalogSubjectId = clean(row.catalog_subject_id) || inferCatalogSubjectId({
      code: row.subject_code,
      label: row.subject_label,
      fallbackId: row.subject_id,
    });
    const defaultHour = findDefaultSubjectHour(levelCode, catalogSubjectId);
    const subject = getCatalogSubject(catalogSubjectId);
    const override = volumeMap.get(`${classId}:${row.subject_id}:${row.teacher_id}`);

    const weeklyUnits = override?.weekly_units ?? defaultHour?.weeklyUnits ?? null;
    const splitPattern = override?.split_pattern ?? defaultHour?.splitPattern ?? null;
    const roomTypeRequired =
      override?.room_type_required ?? defaultHour?.roomTypeRequired ?? subject?.defaultRoomType ?? null;

    const missingReason = !weeklyUnits || !splitPattern
      ? `Référentiel HoraClasse introuvable pour ${classLabel} / ${clean(row.subject_label, "Matière")}.`
      : null;

    return {
      class_id: classId,
      class_label: classLabel,
      level_code: levelCode,
      series_code: seriesCode,
      teacher_id: clean(row.teacher_id),
      teacher_name: clean(row.teacher_name, "Enseignant"),
      subject_id: clean(row.subject_id),
      subject_label: clean(row.subject_label, "Matière"),
      subject_code: row.subject_code ? clean(row.subject_code) : null,
      catalog_subject_id: catalogSubjectId,
      catalog_subject_label: subject?.shortName || subject?.name || catalogSubjectId,
      weekly_units: weeklyUnits === null ? null : Number(weeklyUnits),
      split_pattern: splitPattern,
      room_type_required: roomTypeRequired,
      source: override ? "override" : defaultHour ? "default_catalog" : "manual_missing_catalog",
      is_ready: Boolean(weeklyUnits && splitPattern),
      missing_reason: missingReason,
    } satisfies HoraclasseServiceMeta;
  });
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { srv, institutionId } = guard;

    const [institutionRes, classesRes, subjectsRes, periodsRes, affectationsRes] =
      await Promise.all([
        srv
          .from("institutions")
          .select("id,name,code_unique,code,tz,default_session_minutes")
          .eq("id", institutionId)
          .maybeSingle(),

        srv
          .from("classes")
          .select("id,label")
          .eq("institution_id", institutionId)
          .order("label", { ascending: true }),

        srv
          .from("institution_subjects")
          .select("id,custom_name,subjects:subject_id(name,code)")
          .eq("institution_id", institutionId)
          .order("custom_name", { ascending: true }),

        srv
          .from("institution_periods")
          .select("id,weekday,period_no,label,start_time,end_time,duration_min")
          .eq("institution_id", institutionId)
          .order("weekday", { ascending: true })
          .order("period_no", { ascending: true }),

        srv
          .from("class_teachers")
          .select(
            `
            teacher_id,
            class_id,
            subject_id,
            end_date,
            teacher:profiles(id,display_name,email,phone),
            class:classes(id,label),
            instsub:institution_subjects(
              id,
              custom_name,
              subj:subjects(id,name,code)
            )
          `,
          )
          .eq("institution_id", institutionId)
          .is("end_date", null)
          .limit(10000),
      ]);

    const firstError =
      institutionRes.error ||
      classesRes.error ||
      subjectsRes.error ||
      periodsRes.error ||
      affectationsRes.error;

    if (firstError) {
      return NextResponse.json(
        { ok: false, error: "bootstrap_failed", message: firstError.message },
        { status: 400 },
      );
    }

    const institution = institutionRes.data;

    const classes = (classesRes.data || []).map((item: any) => {
      const label = clean(item.label, "Classe");
      const levelCode = inferLevelCode(label);
      return {
        id: String(item.id),
        label,
        level_code: levelCode,
        series_code: inferSeriesCode(levelCode),
      };
    });

    const subjects = (subjectsRes.data || []).map((item: any) => {
      const base = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
      const label = clean(item.custom_name || base?.name || "Matière");
      const code = base?.code ? clean(base.code) : null;
      return {
        id: String(item.id),
        label,
        code,
        catalog_subject_id: inferCatalogSubjectId({ code, label, fallbackId: item.id }),
      };
    });

    const affectations = (affectationsRes.data || []).map((row: any) => {
      const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
      const cls = Array.isArray(row.class) ? row.class[0] : row.class;
      const instsub = Array.isArray(row.instsub) ? row.instsub[0] : row.instsub;
      const subj = Array.isArray(instsub?.subj) ? instsub.subj[0] : instsub?.subj;
      const classLabel = clean(cls?.label || "Classe");
      const levelCode = inferLevelCode(classLabel);
      const subjectLabel = clean(instsub?.custom_name || subj?.name || "Matière");
      const subjectCode = subj?.code ? clean(subj.code) : null;

      return {
        teacher_id: String(row.teacher_id || teacher?.id || ""),
        teacher_name: clean(teacher?.display_name || "Enseignant"),
        subject_id: row.subject_id ? String(row.subject_id) : instsub?.id ? String(instsub.id) : "",
        subject_label: subjectLabel,
        subject_code: subjectCode,
        catalog_subject_id: inferCatalogSubjectId({ code: subjectCode, label: subjectLabel, fallbackId: row.subject_id }),
        class_id: String(row.class_id || cls?.id || ""),
        class_label: classLabel,
        level_code: levelCode,
        series_code: inferSeriesCode(levelCode),
      };
    });

    const [volumesRes, rulesRes, roomsRes, unavRes] = await Promise.all([
      srv
        .from("montage_timetable_subject_hours")
        .select("*")
        .eq("institution_id", institutionId),
      srv
        .from("montage_timetable_terrain_rules")
        .select("rules")
        .eq("institution_id", institutionId)
        .maybeSingle(),
      srv
        .from("montage_timetable_resources")
        .select("*")
        .eq("institution_id", institutionId),
      srv
        .from("montage_timetable_teacher_unavailability")
        .select("*")
        .eq("institution_id", institutionId),
    ]);

    const serviceAssignments = buildServiceAssignments({
      affectations,
      volumeOverrides: volumesRes.data || [],
    });

    const teacherMap = new Map<string, { id: string; display_name: string; email: string | null; phone: string | null }>();
    for (const row of affectationsRes.data || []) {
      const teacher = Array.isArray((row as any).teacher) ? (row as any).teacher[0] : (row as any).teacher;
      const id = String((row as any).teacher_id || teacher?.id || "");
      if (!id || teacherMap.has(id)) continue;
      teacherMap.set(id, {
        id,
        display_name: clean(teacher?.display_name || "Enseignant"),
        email: teacher?.email ? String(teacher.email) : null,
        phone: teacher?.phone ? String(teacher.phone) : null,
      });
    }

    const periods = (periodsRes.data || []).map((item: any) => ({
      id: String(item.id),
      weekday: Number(item.weekday ?? 0),
      period_no: Number(item.period_no ?? 0),
      label: clean(item.label || `Séance ${item.period_no ?? ""}`),
      start_time: hhmm(item.start_time),
      end_time: hhmm(item.end_time),
      duration_min: Number(item.duration_min ?? institution?.default_session_minutes ?? 60),
    }));

    const warnings: string[] = [];
    if (classes.length === 0) warnings.push("Aucune classe détectée.");
    if (subjects.length === 0) warnings.push("Aucune matière détectée.");
    if (periods.length === 0) warnings.push("Aucun créneau horaire détecté.");
    if (affectations.length === 0) warnings.push("Aucune affectation active enseignant-matière-classe détectée.");
    const missingServices = serviceAssignments.filter((item) => !item.is_ready).length;
    if (missingServices > 0) warnings.push(`${missingServices} service(s) sans correspondance complète dans le référentiel HoraClasse.`);

    return NextResponse.json({
      ok: true,
      institution: {
        id: institution?.id ? String(institution.id) : institutionId,
        name: institution?.name ?? null,
        acronym: institution?.code_unique ?? institution?.code ?? null,
        tz: institution?.tz ?? "Africa/Abidjan",
        default_session_minutes: Number(institution?.default_session_minutes ?? 60),
      },
      classes,
      subjects,
      teachers: Array.from(teacherMap.values()).sort((a, b) => a.display_name.localeCompare(b.display_name)),
      periods,
      affectations,
      service_assignments: serviceAssignments,
      terrain_rules: rulesRes.data?.rules || DEFAULT_TERRAIN_RULES,
      rooms: roomsRes.data || [],
      teacher_unavailability: unavRes.data || [],
      catalog: {
        default_subjects_count: defaultSubjects.length,
        default_subject_hours_count: defaultSubjectHours.length,
      },
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Erreur serveur pendant le chargement du montage emploi du temps.",
      },
      { status: 500 },
    );
  }
}
