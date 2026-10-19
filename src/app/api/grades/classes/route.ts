// src/app/api/grades/classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  EDUCATION_ORGANIZATION_SETTINGS_KEY,
  EDUCATION_TYPE_OPTIONS,
  getCatalogFormation,
  isEducationType,
  type EducationType,
} from "@/lib/education-organization";
import { resolveClassDeviceClassIds } from "@/lib/class-device-identity";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass, type SchoolCycle, type TeachingTrack } from "@/lib/school-cycles";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import { getConfiguredScoringScale, parseFrancoArabicReportsSettings } from "@/lib/franco-arabic-reporting";
import { resolvePrimaryTeachingTrack } from "@/lib/grades/primary-evaluation-kind";
import { primarySubjectScale, primarySubjectTeachingTrack, primarySubjectTeachingTracks } from "@/lib/grades/primary-subject-scale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "teacher" | "class_device" | "other";

type TeachClass = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
  education_type: EducationType;
  education_label: string;
  formation_code: string | null;
  formation_label: string | null;
  formation_level_code: string | null;
  school_cycle: SchoolCycle | null;
  teaching_track: TeachingTrack | null;
  configured_scale: number | null;
  academic_year: string;
};


function educationLabel(type: EducationType) {
  return EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || "Secondaire général";
}

async function buildFormationLabelMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
) {
  const map = new Map<string, string>();
  const { data } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();

  const settings = (data as any)?.settings_json;
  const organization = settings?.[EDUCATION_ORGANIZATION_SETTINGS_KEY];

  for (const id of Array.isArray(organization?.selectedCatalogFormationIds)
    ? organization.selectedCatalogFormationIds
    : []) {
    const item = getCatalogFormation(String(id));
    if (item) map.set(`catalog:${item.id}`, `${item.diplomaLabel} — ${item.name}`);
  }

  for (const item of Array.isArray(organization?.customFormations)
    ? organization.customFormations
    : []) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const diploma = String(item?.diplomaLabel || item?.diplomaCode || "Formation").trim();
    const name = String(item?.name || "").trim();
    map.set(`custom:${id}`, name ? `${diploma} — ${name}` : diploma);
  }

  return { map, settings };
}

function classContext(
  cls: any,
  formationLabels: Map<string, string>,
  classId: string,
  year: string,
  subjectId: string | null,
  school: ReturnType<typeof parseSchoolCyclesSettings>,
  programs: ReturnType<typeof readStudentProgramSettings>,
  reports: ReturnType<typeof parseFrancoArabicReportsSettings>,
): Pick<
  TeachClass,
  | "education_type"
  | "education_label"
  | "formation_code"
  | "formation_label"
  | "formation_level_code"
  | "school_cycle"
  | "teaching_track"
  | "configured_scale"
> {
  const educationType: EducationType = isEducationType(cls?.education_type)
    ? cls.education_type
    : "general_secondary";
  const formationCode = String(cls?.formation_code || "").trim() || null;
  const cycle = school.enabled ? resolveSchoolCycleForClass({ id: classId, level: cls?.level }, school) : null;
  const tracks = cycle ? programs.years[year]?.classes[classId]?.tracks || [] : [];
  const track = cycle === "primary"
    ? resolvePrimaryTeachingTrack({
        offeredTracks: school.teachingTracksByCycle.primary || [],
        classTracks: tracks,
        subjectTracks: subjectId ? school.subjectTracksByCycle.primary?.[subjectId] : undefined,
      })
    : cycle && tracks.length === 1 && school.teachingTracksByCycle[cycle]?.includes(tracks[0])
      ? tracks[0] : null;
  return {
    education_type: educationType,
    education_label: educationLabel(educationType),
    school_cycle: cycle,
    teaching_track: track,
    configured_scale: cycle && track ? getConfiguredScoringScale(reports, cycle, String(cls?.level || ""), track) : null,
    formation_code: formationCode,
    formation_label: formationCode
      ? formationLabels.get(formationCode) || formationCode
      : null,
    formation_level_code:
      String(cls?.formation_level_code || "").trim() || null,
  };
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ mode: null, items: [] as TeachClass[] });
    }

    // 1) Profil + établissement
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("id,institution_id,phone")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      console.error("[grades/classes] profile error", profErr);
      return NextResponse.json({ mode: null, items: [] as TeachClass[] });
    }
    if (!profile?.institution_id) {
      return NextResponse.json({ mode: null, items: [] as TeachClass[] });
    }

    // 2) Rôles
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", profile.id)
      .eq("institution_id", profile.institution_id);

    if (rolesErr) {
      console.error("[grades/classes] roles error", rolesErr);
    }

    const roleSet = new Set<string>((roles ?? []).map((r: any) => r.role as string));
    const isTeacher = roleSet.has("teacher");
    const isClassDevice = roleSet.has("class_device");

    const srv = getSupabaseServiceClient();
    const teacherInstitutionId = profile.institution_id;
    const institutionContext = await buildFormationLabelMap(
      srv,
      profile.institution_id,
    );
    const formationLabels = institutionContext.map;
    const school = parseSchoolCyclesSettings(institutionContext.settings);
    const programs = readStudentProgramSettings(institutionContext.settings);
    const reports = parseFrancoArabicReportsSettings(institutionContext.settings);

    const items: TeachClass[] = [];
    const seen = new Set<string>();

    const pushUnique = (tc: TeachClass) => {
      const key = `${tc.class_id}|${tc.subject_id ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(tc);
    };

    // 3) Helper : résolution des noms de matières
    async function hydrateSubjects(list: TeachClass[]) {
      const ids = Array.from(
        new Set(list.map((it) => it.subject_id).filter(Boolean) as string[])
      );
      if (!ids.length) return list;

      const nameById = new Map<string, string>();
      const canonicalById = new Map<string, string>();

      for (const sid of ids) {
        const { data: isub, error: subErr } = await srv
          .from("institution_subjects")
          .select("id, subject_id, custom_name, subjects:subject_id(name)")
          .eq("institution_id", teacherInstitutionId)
          .or(`id.eq.${sid},subject_id.eq.${sid}`)
          .limit(1)
          .maybeSingle();

        if (subErr) {
          console.error("[grades/classes] subject lookup error", subErr);
          continue;
        }
        if (!isub) continue;

        const nm =
          (isub as any)?.custom_name ??
          (isub as any)?.subjects?.name ??
          null;

        if (!nm) continue;

        const instId = String((isub as any).id);
        const subjId = String((isub as any).subject_id);
        nameById.set(instId, nm);
        nameById.set(subjId, nm);
        canonicalById.set(instId, subjId);
        canonicalById.set(subjId, subjId);
      }

      return list.flatMap((it) => {
        const subjectName = it.subject_id ? nameById.get(it.subject_id) ?? it.subject_name : it.subject_name;
        const subjectId = it.subject_id ? canonicalById.get(it.subject_id) : null;
        const primary = it.school_cycle === "primary";
        const tracks = primary && subjectId
          ? primarySubjectTeachingTracks(institutionContext.settings, it.academic_year, it.class_id, subjectId) : [];
        return (tracks.length ? tracks : [it.teaching_track]).map(track => ({ ...it, subject_name: subjectName, teaching_track: track,
          configured_scale: primary ? (track && subjectId ? primarySubjectScale(institutionContext.settings, {
            year: it.academic_year, classId: it.class_id, level: it.level, track,
            subjectId, subjectName: subjectName || "",
          }) : null) : it.configured_scale }));

      });
    }

    /* ───────── Mode PROF ───────── */
    if (isTeacher) {
      const { data: rows, error } = await supabase
        .from("class_teachers")
        .select("class_id,subject_id,classes:class_id(label,level,academic_year,education_type,formation_code,formation_level_code)")
        .eq("teacher_id", profile.id)
        .eq("institution_id", profile.institution_id)
        .is("end_date", null);

      if (error) {
        console.error("[grades/classes] teacher class_teachers error", error);
      } else {
        (rows ?? []).forEach((row: any) => {
          const cls = row.classes || {};
          if (!row.class_id || !cls) return;
          pushUnique({
            class_id: row.class_id,
            class_label: String(cls.label ?? "—"),
            level: String(cls.level ?? "—"),
            subject_id: row.subject_id || null,
            subject_name: null,
              academic_year: String(cls.academic_year || ""),
            ...classContext(cls, formationLabels, String(row.class_id), String(cls.academic_year || ""), row.subject_id || null, school, programs, reports),
          });
        });
      }
    }

    /* ───────── Mode COMPTE CLASSE ───────── */
    if (!isTeacher && isClassDevice) {
      const authorizedClassIds = await resolveClassDeviceClassIds({
        service: srv,
        userId: profile.id,
        userPhone: (profile as any).phone,
      });
      const { data: clsListRaw, error: classError } = authorizedClassIds.length
        ? await srv
            .from("classes")
            .select(
              "id,label,level,academic_year,institution_id,class_phone_e164,device_phone_e164,education_type,formation_code,formation_level_code",
            )
            .eq("institution_id", profile.institution_id)
            .in("id", authorizedClassIds)
        : { data: [], error: null };
      if (classError) {
        console.error("[grades/classes] class-device identity error", classError);
      }

      const classById = new Map<string, any>();
      const classIds: string[] = [];
      for (const c of clsListRaw || []) {
        if (!c.id) continue;
        if (!classById.has(c.id)) {
          classById.set(c.id, c);
          classIds.push(c.id);
        }
      }

      if (classIds.length) {
        const { data: ctRows, error: ctErr } = await srv
          .from("class_teachers")
          .select("class_id,subject_id")
          .in("class_id", classIds)
          .eq("institution_id", profile.institution_id)
          .is("end_date", null);

        if (ctErr) {
          console.error("[grades/classes] class_device class_teachers error", ctErr);
        } else {
          (ctRows ?? []).forEach((row: any) => {
            const cls = classById.get(row.class_id);
            if (!cls) return;
            pushUnique({
              class_id: row.class_id,
              class_label: String(cls.label ?? "—"),
              level: String(cls.level ?? "—"),
              subject_id: row.subject_id || null,
              subject_name: null,
              academic_year: String(cls.academic_year || ""),
              ...classContext(cls, formationLabels, String(row.class_id), String(cls.academic_year || ""), row.subject_id || null, school, programs, reports),
            });
          });
        }
      }

      const hydrated = await hydrateSubjects(items);
      return NextResponse.json({ mode: "class_device", items: hydrated });
    }

    // ───────── Mode par défaut (autres rôles) ─────────
    const mode: Mode =
      isTeacher ? "teacher" : isClassDevice ? "class_device" : "other";

    const hydrated = await hydrateSubjects(items);
    return NextResponse.json({ mode, items: hydrated });
  } catch (e: any) {
    console.error("[grades/classes] unexpected", e);
    return NextResponse.json({ mode: null, items: [] as TeachClass[] }, { status: 500 });
  }
}
