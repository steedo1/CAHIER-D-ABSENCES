import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { defaultLevels, defaultSubjectHours, defaultSubjects } from "@/modules/montage-emploi-du-temps/catalog";
import {
  buildCatalogCoverage,
  buildHoraclasseServiceAssignments,
} from "@/modules/montage-emploi-du-temps/adapters/buildHoraclasseServices";
import {
  clean,
  inferCatalogSubjectId,
  inferLevelCode,
  inferSeriesCode,
  levelCodeFromOfficialTrack,
  normalizeOfficialTrackCode,
  seriesCodeFromOfficialTrack,
  normalizeText,
} from "@/modules/montage-emploi-du-temps/adapters/horaclasseModelHelpers";
import {
  fetchClassTeacherRows,
  filterClassRowsByAcademicYear,
} from "@/modules/montage-emploi-du-temps/adapters/loadMonCahierAffectations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = {
  ok: true;
  srv: ReturnType<typeof getSupabaseServiceClient>;
  userId: string;
  institutionId: string;
};

type GuardResult =
  | GuardOk
  | {
      ok: false;
      response: NextResponse;
    };

async function guardAdmin(): Promise<GuardResult> {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "auth_failed", message: userErr.message },
        { status: 401 },
      ),
    };
  }

  if (!user) {
    return {
      ok: false,
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
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 },
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." },
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
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 },
      ),
    };
  }

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "forbidden", message: "Droits insuffisants." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, srv, userId: user.id, institutionId };
}

function makeClassPayload(item: any) {
  const label = clean(item.label, "Classe");
  const officialTrackCode = normalizeOfficialTrackCode(item.official_track_code);
  const levelCode = levelCodeFromOfficialTrack(officialTrackCode) || clean(item.level) || inferLevelCode(label);
  return {
    id: String(item.id),
    label,
    level_code: levelCode,
    series_code: seriesCodeFromOfficialTrack(officialTrackCode) || inferSeriesCode(levelCode),
    official_track_code: officialTrackCode,
  };
}

function makeSubjectPayload(item: any) {
  const base = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
  const label = clean(item.custom_name || base?.name || "Matière");
  const code = base?.code ? clean(base.code) : null;
  return {
    id: String(item.id),
    label,
    code,
    catalog_subject_id: inferCatalogSubjectId({ code, label, fallbackId: "" }),
  };
}

function makeAffectationPayload(row: any) {
  const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
  const cls = Array.isArray(row.class) ? row.class[0] : row.class;
  const instsub = Array.isArray(row.instsub) ? row.instsub[0] : row.instsub;
  const subj = Array.isArray(instsub?.subj) ? instsub.subj[0] : instsub?.subj;
  const classLabel = clean(cls?.label, "Classe");
  const officialTrackCode = normalizeOfficialTrackCode(cls?.official_track_code);
  const levelCode = levelCodeFromOfficialTrack(officialTrackCode) || clean(cls?.level) || inferLevelCode(classLabel);
  const subjectLabel = clean(instsub?.custom_name || subj?.name, "Matière");
  const subjectCode = subj?.code ? clean(subj.code) : null;

  return {
    teacher_id: String(row.teacher_id || teacher?.id || ""),
    teacher_name: clean(teacher?.display_name, "Enseignant"),
    subject_id: row.subject_id ? String(row.subject_id) : instsub?.id ? String(instsub.id) : "",
    subject_label: subjectLabel,
    subject_code: subjectCode,
    catalog_subject_id: inferCatalogSubjectId({ code: subjectCode, label: subjectLabel, fallbackId: "" }),
    class_id: String(row.class_id || cls?.id || ""),
    class_label: classLabel,
    level_code: levelCode,
    series_code: seriesCodeFromOfficialTrack(officialTrackCode) || inferSeriesCode(levelCode),
    official_track_code: officialTrackCode,
  };
}

async function loadVolumeContext(guard: GuardOk) {
  const { srv, institutionId } = guard;

  const [institutionRes, classesRes, subjectsRes, affectationsFetch, volumesRes] = await Promise.all([
    srv
      .from("institutions")
      .select("id,name,code_unique,code,tz,default_session_minutes")
      .eq("id", institutionId)
      .maybeSingle(),
    srv
      .from("classes")
      .select("id,label,level,official_track_code,academic_year")
      .eq("institution_id", institutionId)
      .order("label", { ascending: true }),
    srv
      .from("institution_subjects")
      .select("id,custom_name,is_active,subjects:subject_id(id,name,code)")
      .eq("institution_id", institutionId)
      .eq("is_active", true)
      .order("custom_name", { ascending: true }),
    fetchClassTeacherRows(
      srv,
      institutionId,
      `
        teacher_id,
        class_id,
        subject_id,
        end_date,
        teacher:profiles(id,display_name,email,phone),
        class:classes(id,label,level,official_track_code,academic_year),
        instsub:institution_subjects(
          id,
          custom_name,
          subj:subjects(id,name,code)
        )
      `,
    ),
    srv
      .from("montage_timetable_subject_hours")
      .select("*")
      .eq("institution_id", institutionId),
  ]);

  const firstError = institutionRes.error || classesRes.error || subjectsRes.error || volumesRes.error;
  if (firstError) throw new Error(firstError.message);

  const institution = institutionRes.data;
  const classRows = filterClassRowsByAcademicYear(classesRes.data || [], affectationsFetch.academicYear);
  const classes = classRows.map(makeClassPayload);
  const subjects = (subjectsRes.data || []).map(makeSubjectPayload);
  const affectations = (affectationsFetch.rows || []).map(makeAffectationPayload);
  const serviceBuild = buildHoraclasseServiceAssignments({
    classes,
    subjects,
    affectations,
    volumeOverrides: volumesRes.data || [],
  });

  return {
    institution: {
      id: institution?.id ? String(institution.id) : institutionId,
      name: institution?.name ?? null,
      acronym: institution?.code_unique ?? institution?.code ?? null,
      tz: institution?.tz ?? "Africa/Abidjan",
      default_session_minutes: Number(institution?.default_session_minutes ?? 60),
    },
    classes,
    subjects,
    affectations,
    overrides: volumesRes.data || [],
    affectationWarnings: affectationsFetch.warnings || [],
    serviceBuild,
  };
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (guard.ok !== true) return guard.response;

    const context = await loadVolumeContext(guard);

    return NextResponse.json({
      ok: true,
      source: "mon_cahier_official_plus_horaclasse_catalog",
      message:
        "Mon Cahier reste la source officielle. HoraClasse complète automatiquement les volumes, découpages et règles métier quand la matière est reconnue.",
      institution: context.institution,
      classes: context.classes,
      subjects: context.subjects,
      affectations: context.affectations,
      service_assignments: context.serviceBuild.service_assignments,
      subject_hour_rows: context.serviceBuild.subject_hour_rows,
      overrides: context.overrides,
      levels: defaultLevels,
      catalog_subjects: defaultSubjects,
      subjectHours: defaultSubjectHours,
      catalog_coverage: context.serviceBuild.catalog_coverage,
      missing_catalog_subjects: context.serviceBuild.missing_catalog_subjects,
      totals: context.serviceBuild.totals,
      warnings: Array.from(new Set([...(context.affectationWarnings || []), ...context.serviceBuild.warnings])),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "volumes_fetch_failed",
        message: error instanceof Error ? error.message : "Impossible de charger les volumes.",
      },
      { status: 400 },
    );
  }
}

async function findOrCreateSubject(input: { srv: GuardOk["srv"]; name: string; code: string }) {
  const { srv, name, code } = input;
  const { data: allSubjects, error: listErr } = await srv
    .from("subjects")
    .select("id,name,code")
    .limit(2000);

  if (listErr) throw new Error(listErr.message);

  const wantedCode = normalizeText(code);
  const wantedName = normalizeText(name);
  const found = (allSubjects || []).find((item: any) => {
    return normalizeText(item.code) === wantedCode || normalizeText(item.name) === wantedName;
  });

  if (found?.id) {
    return { id: String(found.id), name: clean(found.name, name), code: found.code ? clean(found.code) : code, created: false };
  }

  const { data: created, error: createErr } = await srv
    .from("subjects")
    .insert({ name, code })
    .select("id,name,code")
    .single();

  if (createErr) throw new Error(createErr.message);

  return {
    id: String(created.id),
    name: clean(created.name, name),
    code: created.code ? clean(created.code) : code,
    created: true,
  };
}

async function syncMissingCatalogSubjects(guard: GuardOk) {
  const { srv, institutionId } = guard;
  const { data: institutionSubjects, error } = await srv
    .from("institution_subjects")
    .select("id,custom_name,is_active,subjects:subject_id(id,name,code)")
    .eq("institution_id", institutionId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  const existingSubjects = (institutionSubjects || []).map(makeSubjectPayload);
  const coverage = buildCatalogCoverage(existingSubjects);
  const missing = coverage.filter((item) => !item.exists_in_mon_cahier);
  const added: Array<{ catalog_subject_id: string; institution_subject_id: string; name: string; code: string }> = [];

  for (const item of missing) {
    const catalogSubject = defaultSubjects.find((subject) => subject.id === item.catalog_subject_id);
    if (!catalogSubject) continue;

    const subject = await findOrCreateSubject({ srv, name: catalogSubject.name, code: catalogSubject.code });

    const { data: instSub, error: upErr } = await srv
      .from("institution_subjects")
      .upsert(
        {
          institution_id: institutionId,
          subject_id: subject.id,
          custom_name: null,
          is_active: true,
        },
        { onConflict: "institution_id,subject_id" },
      )
      .select("id")
      .single();

    if (upErr) throw new Error(upErr.message);

    added.push({
      catalog_subject_id: catalogSubject.id,
      institution_subject_id: String(instSub.id),
      name: subject.name,
      code: subject.code,
    });
  }

  return added;
}

function normalizeVolumeFields(body: Record<string, any>) {
  const weekly_units = Number(String(body.weekly_units ?? "").replace(",", "."));
  const split_pattern = clean(body.split_pattern);
  const room_type_required = clean(body.room_type_required) || null;

  if (!Number.isFinite(weekly_units) || weekly_units <= 0) {
    throw new Error("Le volume horaire doit être un nombre positif.");
  }

  if (!split_pattern) {
    throw new Error("Le découpage est obligatoire. Exemple : 1+1+1 ou 2+1.");
  }

  return { weekly_units, split_pattern, room_type_required };
}

function normalizeServiceOverrideBody(body: Record<string, any>) {
  const class_id = clean(body.class_id);
  const subject_id = clean(body.subject_id);
  const teacher_id = clean(body.teacher_id);

  if (!class_id || !subject_id || !teacher_id) {
    throw new Error("Classe, matière et enseignant sont obligatoires.");
  }

  return { class_id, subject_id, teacher_id, ...normalizeVolumeFields(body) };
}

async function saveSubjectLevelVolume(guard: GuardOk, body: Record<string, any>) {
  const context = await loadVolumeContext(guard);
  const level_code = clean(body.level_code);
  const subject_id = clean(body.subject_id);
  const catalog_subject_id = clean(body.catalog_subject_id);
  const fields = normalizeVolumeFields(body);

  if (!level_code || (!subject_id && !catalog_subject_id)) {
    throw new Error("Niveau et matière sont obligatoires.");
  }

  const services = context.serviceBuild.service_assignments.filter((service) => {
    const sameLevel = service.level_code === level_code;
    const sameSubject = subject_id ? service.subject_id === subject_id : service.catalog_subject_id === catalog_subject_id;
    return sameLevel && sameSubject && service.class_id && service.subject_id && service.teacher_id;
  });

  if (services.length === 0) {
    throw new Error("Aucun service Mon Cahier correspondant à ce niveau et cette matière.");
  }

  for (const service of services) {
    const { error: delErr } = await guard.srv
      .from("montage_timetable_subject_hours")
      .delete()
      .eq("institution_id", guard.institutionId)
      .eq("class_id", service.class_id)
      .eq("subject_id", service.subject_id)
      .eq("teacher_id", service.teacher_id);

    if (delErr) throw new Error(delErr.message);
  }

  const rows = services.map((service) => ({
    institution_id: guard.institutionId,
    class_id: service.class_id,
    subject_id: service.subject_id,
    teacher_id: service.teacher_id,
    weekly_units: fields.weekly_units,
    split_pattern: fields.split_pattern,
    room_type_required: fields.room_type_required,
    created_by: guard.userId,
    updated_by: guard.userId,
  }));

  const { error: insErr } = await guard.srv
    .from("montage_timetable_subject_hours")
    .insert(rows);

  if (insErr) throw new Error(insErr.message);

  return services.length;
}

async function resetSubjectLevelVolume(guard: GuardOk, body: Record<string, any>) {
  const context = await loadVolumeContext(guard);
  const level_code = clean(body.level_code);
  const subject_id = clean(body.subject_id);
  const catalog_subject_id = clean(body.catalog_subject_id);

  if (!level_code || (!subject_id && !catalog_subject_id)) {
    throw new Error("Niveau et matière sont obligatoires.");
  }

  const services = context.serviceBuild.service_assignments.filter((service) => {
    const sameLevel = service.level_code === level_code;
    const sameSubject = subject_id ? service.subject_id === subject_id : service.catalog_subject_id === catalog_subject_id;
    return sameLevel && sameSubject && service.class_id && service.subject_id && service.teacher_id;
  });

  for (const service of services) {
    const { error } = await guard.srv
      .from("montage_timetable_subject_hours")
      .delete()
      .eq("institution_id", guard.institutionId)
      .eq("class_id", service.class_id)
      .eq("subject_id", service.subject_id)
      .eq("teacher_id", service.teacher_id);

    if (error) throw new Error(error.message);
  }

  return services.length;
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (guard.ok !== true) return guard.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const action = clean(body.action, "save_subject_level_volume");

    if (action === "sync_missing_subjects") {
      const added = await syncMissingCatalogSubjects(guard);
      const context = await loadVolumeContext(guard);
      return NextResponse.json({
        ok: true,
        action,
        added,
        added_count: added.length,
        service_assignments: context.serviceBuild.service_assignments,
        subject_hour_rows: context.serviceBuild.subject_hour_rows,
        catalog_coverage: context.serviceBuild.catalog_coverage,
        missing_catalog_subjects: context.serviceBuild.missing_catalog_subjects,
        totals: context.serviceBuild.totals,
        message: added.length
          ? `${added.length} matière(s) HoraClasse ajoutée(s) dans les matières Mon Cahier.`
          : "Aucune matière à ajouter : Mon Cahier est déjà aligné avec HoraClasse.",
      });
    }

    if (action === "save_subject_level_volume") {
      const affected = await saveSubjectLevelVolume(guard, body);
      const context = await loadVolumeContext(guard);
      return NextResponse.json({
        ok: true,
        action,
        affected_count: affected,
        subject_hour_rows: context.serviceBuild.subject_hour_rows,
        service_assignments: context.serviceBuild.service_assignments,
        totals: context.serviceBuild.totals,
        message: `Volume appliqué à ${affected} service(s) Mon Cahier pour ce niveau et cette matière.`,
      });
    }

    if (action === "reset_subject_level_volume") {
      const affected = await resetSubjectLevelVolume(guard, body);
      const context = await loadVolumeContext(guard);
      return NextResponse.json({
        ok: true,
        action,
        affected_count: affected,
        subject_hour_rows: context.serviceBuild.subject_hour_rows,
        service_assignments: context.serviceBuild.service_assignments,
        totals: context.serviceBuild.totals,
        message: `Personnalisation retirée pour ${affected} service(s). Le référentiel HoraClasse reprend la main.`,
      });
    }

    if (action === "delete_override") {
      const class_id = clean(body.class_id);
      const subject_id = clean(body.subject_id);
      const teacher_id = clean(body.teacher_id);
      if (!class_id || !subject_id || !teacher_id) {
        return NextResponse.json(
          { ok: false, error: "invalid_payload", message: "Classe, matière et enseignant sont obligatoires." },
          { status: 400 },
        );
      }

      const { error } = await guard.srv
        .from("montage_timetable_subject_hours")
        .delete()
        .eq("institution_id", guard.institutionId)
        .eq("class_id", class_id)
        .eq("subject_id", subject_id)
        .eq("teacher_id", teacher_id);

      if (error) throw new Error(error.message);
      const context = await loadVolumeContext(guard);
      return NextResponse.json({
        ok: true,
        action,
        service_assignments: context.serviceBuild.service_assignments,
        subject_hour_rows: context.serviceBuild.subject_hour_rows,
        totals: context.serviceBuild.totals,
        message: "Personnalisation supprimée. Le référentiel HoraClasse reprend la main.",
      });
    }

    if (action === "save_override") {
      const payload = normalizeServiceOverrideBody(body);

      const { error: delErr } = await guard.srv
        .from("montage_timetable_subject_hours")
        .delete()
        .eq("institution_id", guard.institutionId)
        .eq("class_id", payload.class_id)
        .eq("subject_id", payload.subject_id)
        .eq("teacher_id", payload.teacher_id);

      if (delErr) throw new Error(delErr.message);

      const { error: insErr } = await guard.srv
        .from("montage_timetable_subject_hours")
        .insert({
          institution_id: guard.institutionId,
          ...payload,
          created_by: guard.userId,
          updated_by: guard.userId,
        });

      if (insErr) throw new Error(insErr.message);

      const context = await loadVolumeContext(guard);
      return NextResponse.json({
        ok: true,
        action,
        service_assignments: context.serviceBuild.service_assignments,
        subject_hour_rows: context.serviceBuild.subject_hour_rows,
        totals: context.serviceBuild.totals,
        message: "Volume personnalisé enregistré pour ce service Mon Cahier.",
      });
    }

    return NextResponse.json(
      { ok: false, error: "unknown_action", message: "Action volumes inconnue." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "volumes_save_failed",
        message: error instanceof Error ? error.message : "Impossible d’enregistrer les volumes.",
      },
      { status: 400 },
    );
  }
}
