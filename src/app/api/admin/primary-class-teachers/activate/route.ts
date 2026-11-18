import { NextRequest, NextResponse } from "next/server";
import { getStaffScope, getCurrentStaffAcademicYear } from "@/lib/server/staff-access";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "@/lib/school-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function ciPhone(raw: unknown): string | null {
  const value = String(raw || "").trim().replace(/[^+0-9]/g, "");
  // Attention : le 0 national fait partie du numéro ivoirien de dix chiffres.
  if (/^0[0-9]{9}$/.test(value)) return "+225" + value;
  if (/^2250[0-9]{9}$/.test(value)) return "+" + value;
  if (/^\+2250[0-9]{9}$/.test(value)) return value;
  return /^\+[1-9][0-9]{5,14}$/.test(value) ? value : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const requestedInstitutionId =
    typeof body.institution_id === "string" ? body.institution_id : null;
  const access = await getStaffScope(req, requestedInstitutionId);
  if (!access.ok) return access.response;
  const { service, institutionId } = access.scope;

  const classId = String(body.class_id || "").trim();
  if (!isUuid(classId)) {
    return NextResponse.json({ error: "Classe invalide." }, { status: 400 });
  }

  const { data: institution, error: institutionError } = await service.from("institutions")
    .select("settings_json").eq("id", institutionId).maybeSingle();
  if (institutionError || !institution) {
    return NextResponse.json({ error: "Établissement indisponible." }, { status: 503 });
  }
  const schoolSettings = parseSchoolCyclesSettings(institution.settings_json);
  if (!schoolSettings.enabled || !schoolSettings.enabledCycles.includes("primary")) {
    return NextResponse.json({ error: "Primaire non activé." }, { status: 403 });
  }
  const { data: classroom, error: classError } = await service.from("classes")
    .select("id,institution_id,level,academic_year,head_teacher_id")
    .eq("id", classId).eq("institution_id", institutionId).maybeSingle();
  if (classError || !classroom ||
      resolveSchoolCycleForClass(classroom, schoolSettings) !== "primary") {
    return NextResponse.json({ error: "Classe primaire introuvable." }, { status: 404 });
  }
  const currentYear = await getCurrentStaffAcademicYear(service, institutionId);
  if (!currentYear || currentYear !== classroom.academic_year) {
    return NextResponse.json({ error: "Sélectionnez une classe de l'année scolaire en cours." }, { status: 409 });
  }

  const { data: directory, error: directoryError } = await service.from("primary_class_teachers")
    .select("id,display_name,phone_e164,account_profile_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .maybeSingle();
  if (directoryError || !directory) {
    return NextResponse.json({ error: "Enregistrez d'abord le maître de cette classe." }, { status: 404 });
  }

  if (directory.account_profile_id) {
    return NextResponse.json({
      ok: true, already_active: true, account_linked: true, user_id: directory.account_profile_id,
    }, { headers: noStore });
  }

  const name = String(directory.display_name || "").normalize("NFC").trim();
  const phone = ciPhone(body.phone || directory.phone_e164);
  if (!phone || !name) {
    return NextResponse.json({ error: "Nom ou téléphone du maître manquant." }, { status: 400 });
  }
  if (body.phone && directory.phone_e164 && phone !== directory.phone_e164) {
    return NextResponse.json({
      error: "Le numéro saisi diffère de celui du répertoire. Modifiez d'abord la fiche.",
    }, { status: 409 });
  }

  const { data: existingProfile, error: existingError } = await service.from("profiles")
    .select("id,institution_id,display_name")
    .eq("phone", phone)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: "Impossible de vérifier le numéro." }, { status: 500 });
  }
  if (existingProfile && (
    existingProfile.institution_id !== institutionId ||
    String(existingProfile.display_name || "").normalize("NFC").trim().toLocaleLowerCase("fr") !== name.toLocaleLowerCase("fr")
  )) {
    return NextResponse.json({ error: "Ce numéro appartient à un autre compte." }, { status: 409 });
  }

  if (existingProfile?.id) {
    const { data: roles, error: rolesError } = await service.from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", existingProfile.id);
    if (rolesError || (roles || []).some((row) =>
      row.role !== "teacher" || row.institution_id !== institutionId
    )) {
      return NextResponse.json({ error: "Compte existant avec droits incompatibles." }, { status: 409 });
    }
  }

  let uid = existingProfile?.id ? String(existingProfile.id) : "";
  let initialPassword: string | null = null;

  if (!uid) {
    initialPassword = DEFAULT_TEMP_PASSWORD;
    const { data: created, error: authError } = await service.auth.admin.createUser({
      phone,
      password: initialPassword,
      phone_confirm: true,
      user_metadata: { display_name: name },
    });
    if (authError || !created.user?.id) {
      return NextResponse.json({
        error: authError?.message || "Création du compte impossible.",
      }, { status: 409 });
    }
    uid = created.user.id;
  }

  // Une création Auth peut déclencher automatiquement un profil : on le retrouve.
  const { data: profile, error: lookupError } = await service.from("profiles")
    .select("id,institution_id")
    .eq("id", uid)
    .maybeSingle();
  if (lookupError || (profile?.institution_id && profile.institution_id !== institutionId)) {
    return NextResponse.json({
      error: "Compte créé, mais profil à vérifier avant de continuer.",
    }, { status: 500 });
  }
  const profilePayload = { institution_id: institutionId, display_name: name, phone };
  const profileWrite = profile
    ? await service.from("profiles").update(profilePayload).eq("id", uid)
    : await service.from("profiles").insert({ id: uid, ...profilePayload });
  if (profileWrite.error) {
    return NextResponse.json({ error: "Compte créé : profil à finaliser." }, { status: 500 });
  }

  const { error: roleError } = await service.from("user_roles")
    .upsert({ profile_id: uid, institution_id: institutionId, role: "teacher" },
      { onConflict: "profile_id,institution_id,role" });
  if (roleError) {
    return NextResponse.json({ error: "Compte créé : rôle enseignant à finaliser." }, { status: 500 });
  }

  // Réutiliser les sous-matières DÉJÀ configurées pour ce CM1. Aucune
  // matière ni horaire n'est demandé au maître, ni ajouté à son planning.
  const oldTeacherId = String(classroom.head_teacher_id || "");
  const { data: oldAssignments, error: oldError } =
    oldTeacherId && oldTeacherId !== uid
      ? await service.from("class_teachers")
          .select("subject_id")
          .eq("institution_id", institutionId)
          .eq("class_id", classId)
          .eq("teacher_id", oldTeacherId)
          .is("end_date", null)
      : { data: [] as { subject_id: string }[], error: null };

  if (oldError) return NextResponse.json({ error: "Lecture des affectations impossible." }, { status: 500 });

  // Un maître remplacé peut avoir été désaffecté avant l'activation du nouveau.
  // Dans ce cas, reprendre les sous-matières archivées de la même classe,
  // sans réactiver l'ancien enseignant ni toucher à ses évaluations.
  let subjectSource = (oldAssignments || []) as Array<{ subject_id: string }>;
  if (!subjectSource.length) {
    const { data: historical, error: historicalError } = await service.from("class_teachers")
      .select("subject_id")
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .order("start_date", { ascending: false })
      .limit(200);
    if (historicalError) {
      return NextResponse.json({ error: "Historique des sous-matières indisponible." }, { status: 500 });
    }
    subjectSource = (historical || []) as Array<{ subject_id: string }>;
  }
  const subjectIds = Array.from(new Set(
    subjectSource.map((row) => String(row.subject_id || "")).filter(Boolean)
  ));
  if (!subjectIds.length) {
    return NextResponse.json({
      error: "Aucune sous-matière interne disponible pour cette classe. Configurez le programme avant l'activation.",
    }, { status: 409 });
  }
  const startDate = new Date().toISOString().slice(0, 10);
  if (subjectIds.length) {
    const { error: createLinksError } = await service.from("class_teachers")
      .upsert(subjectIds.map((subjectId) => ({
        institution_id: institutionId,
        class_id: classId,
        subject_id: subjectId,
        teacher_id: uid,
        start_date: startDate,
        end_date: null,
      })), { onConflict: "class_id,subject_id,teacher_id,start_date" });
    if (createLinksError) {
      return NextResponse.json({ error: "Compte créé : affectations des matières internes à finaliser." }, { status: 500 });
    }
  }

  const { error: linkedError } = await service.from("primary_class_teachers")
    .update({
      phone_e164: phone, account_profile_id: uid, updated_at: new Date().toISOString(),
    })
    .eq("id", directory.id)
    .eq("institution_id", institutionId);
  if (linkedError) {
    return NextResponse.json({ error: "Compte créé : lien maître-classe à finaliser." }, { status: 500 });
  }

  const { error: headError } = await service.from("classes")
    .update({ head_teacher_id: uid })
    .eq("id", classId)
    .eq("institution_id", institutionId);
  if (headError) return NextResponse.json({ error: "Compte créé : changement de titulaire à finaliser." }, { status: 500 });

  // Clôturer seulement les liens actifs de l'ancien titulaire. Aucun DELETE,
  // aucune modification des évaluations, notes ou bulletins existants.
  if (oldTeacherId && oldTeacherId !== uid && subjectIds.length) {
    const { error: closeError } = await service.from("class_teachers")
      .update({ end_date: startDate })
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .eq("teacher_id", oldTeacherId)
      .is("end_date", null);
    if (closeError) {
      return NextResponse.json({ error: "Nouveau maître activé ; clôture des anciens liens à contrôler." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    account_linked: true,
    user_id: uid,
    class_id: classId,
    display_name: name,
    phone_e164: phone,
    subject_links_transferred: subjectIds.length,
    initial_password: initialPassword,
  }, { headers: noStore });
}
