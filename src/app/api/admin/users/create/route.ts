//src/app/api/admin/users/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";
import { isEducationType, type EducationType } from "@/lib/education-organization";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isUuid(v: string | null | undefined): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    String(v || "")
  );
}

function normalizeSubjectText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const SUBJECT_ALIAS_TO_CANONICAL: Record<string, string> = {
  math: "mathematiques",
  maths: "mathematiques",
  mathematique: "mathematiques",
  mathematiques: "mathematiques",

  francais: "francais",
  fr: "francais",
  french: "francais",

  anglais: "anglais",
  ang: "anglais",
  english: "anglais",

  allemand: "allemand",
  all: "allemand",
  allemandlv2: "allemand",

  espagnol: "espagnol",
  esp: "espagnol",
  espagnollv2: "espagnol",

  histoiregeographie: "histoiregeographie",
  histoiregeo: "histoiregeographie",
  histgeo: "histoiregeographie",
  hg: "histoiregeographie",
  hgeo: "histoiregeographie",
  histoire: "histoiregeographie",
  geographie: "histoiregeographie",

  physiquechimie: "physiquechimie",
  physique: "physiquechimie",
  chimie: "physiquechimie",
  pc: "physiquechimie",
  pch: "physiquechimie",

  svt: "svt",
  sciencenaturelle: "svt",
  sciencesnaturelles: "svt",
  sciencesdelavieetdelaterre: "svt",
  sciencesvieetterre: "svt",
  sciencevieetterre: "svt",

  eps: "eps",
  sport: "eps",
  educationphysique: "eps",
  educationphysiqueetsportive: "eps",

  edhc: "edhc",
  edh: "edhc",
  educationcivique: "edhc",
  educationauxdroitshumainsetalacitoyennete: "edhc",

  philosophie: "philosophie",
  philo: "philosophie",

  // ✅ Musique reste une discipline séparée.
  musique: "musique",
  music: "musique",
  educationmusicale: "musique",
  edmusicale: "musique",
  chant: "musique",

  // ✅ Arts plastiques / Dessin restent une discipline séparée de Musique.
  art: "artsplastiques",
  arts: "artsplastiques",
  artplastique: "artsplastiques",
  artplastiques: "artsplastiques",
  artsplastique: "artsplastiques",
  artsplastiques: "artsplastiques",
  dessin: "artsplastiques",
  dessins: "artsplastiques",
  educationartistique: "artsplastiques",
  artsvisuels: "artsplastiques",
};

function canonicalSubjectKey(value: string | null | undefined) {
  const raw = normalizeSubjectText(value);
  return SUBJECT_ALIAS_TO_CANONICAL[raw] || raw;
}

type BodyRole = "teacher" | "parent" | "admin" | "educator" | "finance_manager" | "infirmier";

type SubjectLite = {
  id: string;
  name: string | null;
  code: string | null;
};

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

type EducatorClassRow = {
  id: string;
  level: string | null;
  academic_year: string | null;
  education_type: EducationType | null;
  formation_code: string | null;
  formation_level_code: string | null;
};

function normalizedClassEducationType(row: EducatorClassRow): EducationType {
  return isEducationType(row.education_type)
    ? row.education_type
    : "general_secondary";
}

function educatorClassMatchesContext(
  row: EducatorClassRow,
  opts: {
    educationType: EducationType;
    formationCode: string | null;
    level: string;
  },
) {
  if (normalizedClassEducationType(row) !== opts.educationType) return false;

  if (opts.educationType === "general_secondary") {
    return (
      !String(row.formation_code || "").trim() &&
      String(row.level || "").trim() === opts.level
    );
  }

  return (
    String(row.formation_code || "").trim() ===
      String(opts.formationCode || "").trim() &&
    String(row.formation_level_code || row.level || "").trim() === opts.level
  );
}

async function getCurrentAcademicYear(institutionId: string) {
  const supaSrv = getSupabaseServiceClient();
  const { data } = await supaSrv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.code ? String(data.code) : null;
}

async function saveEducatorAssignments(opts: {
  profileId: string;
  institutionId: string;
  educationType: EducationType;
  formationCode: string | null;
  formationLevelCode: string | null;
  level: string | null;
  classIds: string[];
}) {
  const supaSrv = getSupabaseServiceClient();
  const level = String(opts.level || "").trim();
  const formationCode = String(opts.formationCode || "").trim() || null;
  const formationLevelCode =
    String(opts.formationLevelCode || "").trim() || null;

  if (!level) {
    return { ok: false as const, error: "educator_level_required" };
  }

  if (
    opts.educationType !== "general_secondary" &&
    (!formationCode || !formationLevelCode)
  ) {
    return { ok: false as const, error: "educator_education_context_required" };
  }

  if (
    opts.educationType !== "general_secondary" &&
    formationLevelCode !== level
  ) {
    return { ok: false as const, error: "educator_level_context_mismatch" };
  }

  const requestedClassIds = Array.from(
    new Set(opts.classIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
  const validUuidClassIds = requestedClassIds.filter(isUuid);

  if (validUuidClassIds.length !== requestedClassIds.length) {
    return { ok: false as const, error: "educator_classes_invalid" };
  }

  // La table historique educator_class_assignments ne porte pas encore le
  // type d'enseignement ni la formation. Pour un enseignement non général,
  // une affectation « tout le niveau » serait donc ambiguë. On impose des
  // classes explicites afin de préserver plusieurs contextes sur le même compte.
  if (
    opts.educationType !== "general_secondary" &&
    validUuidClassIds.length === 0
  ) {
    return {
      ok: false as const,
      error: "educator_classes_required_for_non_general",
    };
  }

  let selectedClasses: EducatorClassRow[] = [];
  if (validUuidClassIds.length > 0) {
    const { data: classes, error: classErr } = await supaSrv
      .from("classes")
      .select(
        "id,level,academic_year,education_type,formation_code,formation_level_code",
      )
      .eq("institution_id", opts.institutionId)
      .in("id", validUuidClassIds);

    if (classErr) {
      return { ok: false as const, error: classErr.message };
    }

    selectedClasses = (Array.isArray(classes) ? classes : []) as EducatorClassRow[];
    if (selectedClasses.length !== validUuidClassIds.length) {
      return { ok: false as const, error: "educator_classes_invalid" };
    }

    const invalid = selectedClasses.filter(
      (row) =>
        !educatorClassMatchesContext(row, {
          educationType: opts.educationType,
          formationCode,
          level,
        }),
    );

    if (invalid.length > 0) {
      return { ok: false as const, error: "educator_classes_out_of_context" };
    }
  }

  const selectedYears = Array.from(
    new Set(
      selectedClasses
        .map((row) => String(row.academic_year || "").trim())
        .filter(Boolean),
    ),
  );
  if (selectedYears.length > 1) {
    return { ok: false as const, error: "educator_classes_multiple_years" };
  }

  const academicYear =
    selectedYears[0] || (await getCurrentAcademicYear(opts.institutionId));

  // On remplace uniquement le périmètre pédagogique courant. Les autres
  // affectations de l'éducateur sont conservées intactes.
  if (academicYear) {
    const { data: yearClasses, error: yearClassesError } = await supaSrv
      .from("classes")
      .select(
        "id,level,academic_year,education_type,formation_code,formation_level_code",
      )
      .eq("institution_id", opts.institutionId)
      .eq("academic_year", academicYear);

    if (yearClassesError) {
      return { ok: false as const, error: yearClassesError.message };
    }

    const contextClassIds = ((yearClasses || []) as EducatorClassRow[])
      .filter((row) =>
        educatorClassMatchesContext(row, {
          educationType: opts.educationType,
          formationCode,
          level,
        }),
      )
      .map((row) => row.id);

    if (contextClassIds.length > 0) {
      const { error: scopedDeleteError } = await supaSrv
        .from("educator_class_assignments")
        .delete()
        .eq("institution_id", opts.institutionId)
        .eq("profile_id", opts.profileId)
        .in("class_id", contextClassIds);

      if (scopedDeleteError) {
        return { ok: false as const, error: scopedDeleteError.message };
      }
    }
  }

  if (opts.educationType === "general_secondary") {
    const { error: generalLevelDeleteError } = await supaSrv
      .from("educator_class_assignments")
      .delete()
      .eq("institution_id", opts.institutionId)
      .eq("profile_id", opts.profileId)
      .eq("level", level)
      .is("class_id", null);

    if (generalLevelDeleteError) {
      return { ok: false as const, error: generalLevelDeleteError.message };
    }
  }

  const rows =
    validUuidClassIds.length > 0
      ? validUuidClassIds.map((classId) => ({
          institution_id: opts.institutionId,
          profile_id: opts.profileId,
          level,
          class_id: classId,
        }))
      : [
          {
            institution_id: opts.institutionId,
            profile_id: opts.profileId,
            level,
            class_id: null,
          },
        ];

  const { error: insErr } = await supaSrv
    .from("educator_class_assignments")
    // La colonne est nullable depuis l'affectation par niveau, mais le type
    // Supabase livré avec ce dossier décrit encore class_id comme obligatoire.
    .insert(rows as any);

  if (insErr) {
    return { ok: false as const, error: insErr.message };
  }

  return {
    ok: true as const,
    education_type: opts.educationType,
    formation_code: formationCode,
    formation_level_code: formationLevelCode,
    academic_year: academicYear,
    level,
    class_ids: validUuidClassIds,
    scope: validUuidClassIds.length > 0 ? "classes" : "level",
  };
}

export async function POST(req: NextRequest) {
  const supaSrv = getSupabaseServiceClient(); // service (no RLS)
  const supa = await getSupabaseServerClient(); // user-scoped (RLS)

  // Qui appelle ?
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Etablissement courant de l'admin
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  const inst = (me?.institution_id as string) || null;

  if (!inst) {
    return NextResponse.json({ error: "no_institution" }, { status: 400 });
  }

  const { data: callerRoles, error: callerRolesErr } = await supaSrv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (callerRolesErr) {
    return NextResponse.json({ error: callerRolesErr.message }, { status: 400 });
  }

  const isSuperAdmin = (callerRoles ?? []).some(
    (r) => String(r.role) === "super_admin"
  );
  const isInstitutionAdmin = (callerRoles ?? []).some(
    (r) => String(r.role) === "admin" && String(r.institution_id) === inst
  );

  if (!isSuperAdmin && !isInstitutionAdmin) {
    return NextResponse.json(
      { error: "admin_required" },
      { status: 403 }
    );
  }

  // Payload
  const body = await req.json().catch(() => ({} as any));
  const role = body?.role as BodyRole;
  const emailRaw = (body?.email ?? null) as string | null;
  const display_name = (body?.display_name ?? null) as string | null;

  // ✅ subject_id canonique optionnel.
  // Si présent, il est prioritaire pour éviter les doublons.
  const subjectIdRaw =
    typeof body?.subject_id === "string" && body.subject_id.trim()
      ? String(body.subject_id).trim()
      : null;

  const subjectName = (body?.subject ?? null) as string | null;

  const educationType: EducationType = isEducationType(body?.education_type)
    ? body.education_type
    : "general_secondary";
  const formationCode =
    typeof body?.formation_code === "string" && body.formation_code.trim()
      ? body.formation_code.trim()
      : null;
  const formationLevelCode =
    typeof body?.formation_level_code === "string" &&
    body.formation_level_code.trim()
      ? body.formation_level_code.trim()
      : null;

  const educatorLevel =
    typeof body?.educator_level === "string" && body.educator_level.trim()
      ? String(body.educator_level).trim()
      : null;
  const educatorClassIds = uniqueStrings(body?.educator_class_ids);

  const country =
    typeof body?.country === "string" && body.country.trim()
      ? String(body.country).trim()
      : undefined;

  const phone =
    normalizePhone(body?.phone ?? null, {
      defaultCountryAlpha2: country,
    }) || null;

  const email = emailRaw ? emailRaw.trim().toLowerCase() : null;

  if (!role) {
    return NextResponse.json({ error: "role_required" }, { status: 400 });
  }

  const allowedRoles: BodyRole[] = [
    "teacher",
    "parent",
    "admin",
    "educator",
    "finance_manager",
    "infirmier",
  ];

  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: "role_not_allowed" }, { status: 403 });
  }

  // Le rôle founder est volontairement absent ici :
  // il doit être créé uniquement depuis l'espace Super Admin.

  // Règle produit : le parent doit avoir un téléphone
  if (role === "parent" && !phone) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }

  // 🔒 Discipline OBLIGATOIRE pour les enseignants :
  // soit subject_id, soit nom de discipline.
  if (
    role === "teacher" &&
    !(
      (subjectIdRaw && isUuid(subjectIdRaw)) ||
      (subjectName && subjectName.trim())
    )
  ) {
    return NextResponse.json({ error: "subject_required" }, { status: 400 });
  }

  if (
    role === "teacher" &&
    educationType !== "general_secondary" &&
    (!formationCode || !formationLevelCode)
  ) {
    return NextResponse.json(
      { error: "teacher_education_context_required" },
      { status: 400 },
    );
  }

  if (role === "educator" && !educatorLevel) {
    return NextResponse.json(
      { error: "educator_level_required" },
      { status: 400 }
    );
  }

  if (
    role === "educator" &&
    educationType !== "general_secondary" &&
    (!formationCode || !formationLevelCode)
  ) {
    return NextResponse.json(
      { error: "educator_education_context_required" },
      { status: 400 },
    );
  }

  if (
    role === "educator" &&
    educationType !== "general_secondary" &&
    educatorClassIds.length === 0
  ) {
    return NextResponse.json(
      { error: "educator_classes_required_for_non_general" },
      { status: 400 },
    );
  }

  // 1) Résoudre / créer l'utilisateur (idempotent)
  let uid: string | null = null;

  // a) profiles -> id
  if (phone) {
    const { data } = await supaSrv
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (data?.id) {
      uid = String(data.id);
      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  if (!uid && email) {
    const { data } = await supaSrv
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (data?.id) {
      uid = String(data.id);
      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  // helper : auth.users lookup
  const findInAuth = async () => {
    if (phone) {
      const { data } = await supaSrv
        .from("auth.users")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();

      if (data?.id) return String(data.id);
    }

    if (email) {
      const { data } = await supaSrv
        .from("auth.users")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (data?.id) return String(data.id);
    }

    return null;
  };

  // b) auth.users -> id (si pas trouvé via profiles)
  if (!uid) {
    uid = await findInAuth();

    if (uid) {
      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  // c) créer si toujours introuvable (avec fallback)
  if (!uid) {
    const { data: created, error: cErr } = await supaSrv.auth.admin.createUser({
      email: email || undefined,
      phone: phone || undefined,
      password: DEFAULT_TEMP_PASSWORD, // mdp initial
      email_confirm: !!email,
      phone_confirm: !!phone,
      user_metadata: { display_name, phone, email },
    });

    if (created?.user?.id) {
      uid = String(created.user.id);
    } else {
      // fallback : re-lookup
      uid = await findInAuth();

      if (!uid) {
        return NextResponse.json(
          { error: cErr?.message ?? "createUser_failed" },
          { status: 400 }
        );
      }

      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  // 2) Upsert profil SANS écraser institution_id
  const { data: existingProfile } = await supaSrv
    .from("profiles")
    .select("id,institution_id,display_name,email,phone")
    .eq("id", uid)
    .maybeSingle();

  if (!existingProfile) {
    const { error: pInsErr } = await supaSrv.from("profiles").insert({
      id: uid,
      institution_id: inst,
      display_name: display_name || null,
      email: email ?? null,
      phone: phone ?? null,
    });

    if (pInsErr) {
      return NextResponse.json({ error: pInsErr.message }, { status: 400 });
    }
  } else {
    const { error: pUpdErr } = await supaSrv
      .from("profiles")
      .update({
        display_name: display_name ?? existingProfile.display_name ?? null,
        email: email ?? existingProfile.email ?? null,
        phone: phone ?? existingProfile.phone ?? null,
      })
      .eq("id", uid);

    if (pUpdErr) {
      return NextResponse.json({ error: pUpdErr.message }, { status: 400 });
    }
  }

  // 3) Upsert du rôle (idempotent)
  const { error: rErr } = await supaSrv
    .from("user_roles")
    .upsert(
      { profile_id: uid, institution_id: inst, role },
      { onConflict: "profile_id,institution_id,role" }
    );

  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 400 });
  }

  if (role === "educator") {
    const saved = await saveEducatorAssignments({
      profileId: uid,
      institutionId: inst,
      educationType,
      formationCode,
      formationLevelCode,
      level: educatorLevel,
      classIds: educatorClassIds,
    });

    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      user_id: uid,
      educator_assignment: {
        education_type: saved.education_type,
        formation_code: saved.formation_code,
        formation_level_code: saved.formation_level_code,
        academic_year: saved.academic_year,
        level: saved.level,
        class_ids: saved.class_ids,
        scope: saved.scope,
      },
    });
  }

  // 4) Matière REQUISE (enseignant)
  if (role === "teacher") {
    const rawName = String(subjectName || "").trim();

    let subject_id: string | undefined;
    let canonicalSubjectName = rawName;
    let canonicalSubjectCode: string | null = null;

    // ✅ Priorité 1 : subject_id envoyé par le front.
    if (subjectIdRaw && isUuid(subjectIdRaw)) {
      const { data: subjById, error: subjByIdErr } = await supaSrv
        .from("subjects")
        .select("id,name,code")
        .eq("id", subjectIdRaw)
        .maybeSingle();

      if (subjByIdErr) {
        return NextResponse.json(
          { error: subjByIdErr.message },
          { status: 400 }
        );
      }

      if (!subjById?.id) {
        return NextResponse.json(
          { error: "subject_not_found" },
          { status: 400 }
        );
      }

      subject_id = String(subjById.id);
      canonicalSubjectName = String(subjById.name || rawName || "Discipline");
      canonicalSubjectCode = subjById.code ? String(subjById.code) : null;
    }

    // ✅ Priorité 2 : résolution intelligente par nom / alias.
    if (!subject_id && rawName) {
      const wantedCanonical = canonicalSubjectKey(rawName);
      const wantedRaw = normalizeSubjectText(rawName);

      const { data: allSubjects } = await supaSrv
        .from("subjects")
        .select("id,name,code")
        .limit(1000);

      const rows = (Array.isArray(allSubjects)
        ? allSubjects
        : []) as SubjectLite[];

      const found =
        rows.find((s) => canonicalSubjectKey(s.name) === wantedCanonical) ||
        rows.find((s) => normalizeSubjectText(s.name) === wantedRaw) ||
        rows.find((s) => normalizeSubjectText(s.code) === wantedRaw) ||
        null;

      if (found?.id) {
        subject_id = String(found.id);
        canonicalSubjectName = String(found.name || rawName);
        canonicalSubjectCode = found.code ? String(found.code) : null;
      }
    }

    // ✅ Priorité 3 : fallback historique exact ilike.
    if (!subject_id && rawName) {
      const { data: subj1 } = await supaSrv
        .from("subjects")
        .select("id,name,code")
        .ilike("name", rawName)
        .maybeSingle();

      if (subj1?.id) {
        subject_id = String(subj1.id);
        canonicalSubjectName = String(subj1.name || rawName);
        canonicalSubjectCode = subj1.code ? String(subj1.code) : null;
      }
    }

    // ✅ Priorité 4 : création uniquement si la discipline n’existe vraiment pas.
    if (!subject_id && rawName) {
      const name = rawName;
      const code = slug(name).slice(0, 12).toUpperCase();

      const { data: createdSubj } = await supaSrv
        .from("subjects")
        .insert({ code, name })
        .select("id,name,code")
        .maybeSingle();

      subject_id = (createdSubj?.id as string) || undefined;
      canonicalSubjectName = String(createdSubj?.name || name);
      canonicalSubjectCode = createdSubj?.code ? String(createdSubj.code) : code;

      if (!subject_id) {
        // Dernière tentative : collision sur code
        const { data: subjByCode } = await supaSrv
          .from("subjects")
          .select("id,name,code")
          .eq("code", code)
          .maybeSingle();

        subject_id = (subjByCode?.id as string) || undefined;
        canonicalSubjectName = String(subjByCode?.name || name);
        canonicalSubjectCode = subjByCode?.code
          ? String(subjByCode.code)
          : code;
      }
    }

    if (!subject_id) {
      return NextResponse.json(
        { error: "subject_create_failed" },
        { status: 400 }
      );
    }

    await supaSrv
      .from("institution_subjects")
      .upsert(
        {
          institution_id: inst,
          subject_id,
          custom_name: null,
          is_active: true,
        },
        { onConflict: "institution_id,subject_id" }
      );

    if (
      educationType !== "general_secondary" &&
      formationCode &&
      formationLevelCode
    ) {
      const { error: levelSubjectError } = await supaSrv
        .from("institution_level_subjects")
        .upsert(
          {
            institution_id: inst,
            education_type: educationType,
            formation_code: formationCode,
            level_code: formationLevelCode,
            subject_id,
            is_active: true,
          },
          {
            onConflict:
              "institution_id,education_type,formation_code,level_code,subject_id",
          },
        );

      if (levelSubjectError) {
        return NextResponse.json(
          { error: levelSubjectError.message },
          { status: 400 },
        );
      }
    }

    try {
      await supaSrv
        .from("teacher_subjects")
        .upsert(
          {
            profile_id: uid,
            subject_id,
            institution_id: inst,
            teacher_name: display_name ?? null, // dénormalisé si colonnes dispo
            subject_name: canonicalSubjectName,
          },
          { onConflict: "profile_id,subject_id,institution_id" }
        );
    } catch (e) {
      // ne bloque pas la création
      console.warn("teacher_subjects upsert skipped:", (e as any)?.message);
    }

    return NextResponse.json({
      ok: true,
      user_id: uid,
      subject_id,
      subject_name: canonicalSubjectName,
      subject_code: canonicalSubjectCode,
    });
  }

  return NextResponse.json({ ok: true, user_id: uid });
}
