import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentStaffAcademicYear,
  getEditableStaffTarget,
  getStaffScope,
} from "@/lib/server/staff-access";
import {
  normalizeStaffPhone,
  normalizedStaffEmail,
  normalizedStaffName,
  samePhone,
} from "@/lib/staff-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const access = await getStaffScope(req);
  if (!access.ok) return access.response;
  const target = await getEditableStaffTarget(access.scope, id);
  if (!target.ok) return target.response;
  const { service, institutionId } = access.scope;
  const profile = { ...target.profile, role: target.role };

  if (target.role !== "educator") {
    return NextResponse.json({ ok: true, profile, classes: [], assigned_class_ids: [], whole_levels: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const year = await getCurrentStaffAcademicYear(service, institutionId);
  if (!year) return NextResponse.json({ error: "Année scolaire active introuvable." }, { status: 409 });
  const { data: classes, error: classError } = await service
    .from("classes")
    .select("id,code,label,level,academic_year")
    .eq("institution_id", institutionId)
    .eq("academic_year", year)
    .order("code");
  if (classError) return NextResponse.json({ error: "Chargement des classes impossible." }, { status: 500 });
  const { data: assignments, error: assignmentError } = await service
    .from("educator_class_assignments")
    .select("class_id,level")
    .eq("institution_id", institutionId)
    .eq("profile_id", id);
  if (assignmentError) return NextResponse.json({ error: "Chargement des affectations impossible." }, { status: 500 });

  const classIds = new Set((classes || []).map((item) => item.id));
  const assigned = (assignments || [])
    .filter((item) => item.class_id && classIds.has(item.class_id))
    .map((item) => String(item.class_id));
  const wholeLevels = (assignments || [])
    .filter((item) => !item.class_id)
    .map((item) => String(item.level));
  return NextResponse.json({
    ok: true,
    profile,
    academic_year: year,
    classes: classes || [],
    assigned_class_ids: assigned,
    whole_levels: wholeLevels,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Données invalides." }, { status: 400 });
  }
  const access = await getStaffScope(req, body.institution_id);
  if (!access.ok) return access.response;
  const target = await getEditableStaffTarget(access.scope, id);
  if (!target.ok) return target.response;

  const { service, institutionId } = access.scope;
  const before = target.profile;
  if (
    typeof body.display_name !== "string" ||
    typeof body.phone !== "string" ||
    typeof body.email !== "string"
  ) {
    return NextResponse.json({ error: "Nom, téléphone et e-mail attendus." }, { status: 400 });
  }

  const name = normalizedStaffName(body.display_name);
  if (!name) return NextResponse.json({ error: "Nom invalide (2 à 160 caractères)." }, { status: 400 });

  const submittedPhone = body.phone.trim();
  // Legacy imported profiles can contain short (+225 + 9 digits) numbers.
  // Allow changing the name without rewriting an unchanged legacy phone.
  const phoneUnchanged = samePhone(submittedPhone, before.phone);
  const phone = phoneUnchanged ? before.phone : submittedPhone ? normalizeStaffPhone(submittedPhone) : null;
  if (submittedPhone && !phone) {
    return NextResponse.json({
      error: "Téléphone invalide. Pour la Côte d'Ivoire : 10 chiffres commençant par 0 (ex. 0701020304).",
    }, { status: 400 });
  }
  if (!submittedPhone && before.phone) {
    return NextResponse.json({ error: "Le téléphone existant ne peut pas être supprimé ici." }, { status: 400 });
  }
  const inputEmail = body.email.trim();
  const email = inputEmail ? normalizedStaffEmail(inputEmail) : null;
  if (inputEmail && !email) return NextResponse.json({ error: "Adresse e-mail invalide." }, { status: 400 });
  if (!inputEmail && before.email) {
    return NextResponse.json({ error: "Pour retirer un e-mail déjà enregistré, contactez le Super Admin." }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json({ error: "Au moins un identifiant de connexion est requis." }, { status: 400 });
  }

  // The Auth identity must be updated too: changing profiles.phone alone breaks login.
  const { data: authData, error: authReadError } = await service.auth.admin.getUserById(id);
  if (authReadError || !authData?.user) {
    return NextResponse.json({ error: "Compte d'authentification introuvable." }, { status: 409 });
  }
  const authUser = authData.user;
  const phoneChanged = !phoneUnchanged && !!phone && !samePhone(phone, authUser.phone);
  const emailChanged = !!email && email !== String(authUser.email || "").toLowerCase();
  const nameChanged = name !== String(before.display_name || "");
  const profileChanged =
    nameChanged ||
    (phone !== null && !samePhone(phone, before.phone)) ||
    (email !== null && email !== String(before.email || "").toLowerCase());

  if (!profileChanged && !phoneChanged && !emailChanged) {
    return NextResponse.json({ ok: true, unchanged: true, profile: before });
  }

  if (phoneChanged && phone) {
    const alt = phone.startsWith("+2250") ? "+225" + phone.slice(5) : phone;
    const { data: duplicate, error: dupError } = await service
      .from("profiles")
      .select("id")
      .in("phone", Array.from(new Set([phone, alt])))
      .neq("id", id)
      .limit(1);
    if (dupError) return NextResponse.json({ error: "Contrôle des doublons impossible." }, { status: 500 });
    if (duplicate?.length) {
      return NextResponse.json({ error: "Numéro déjà utilisé par un autre compte." }, { status: 409 });
    }
  }

  // First persist the profile. If Auth refuses a duplicate login, restore it.
  const previousProfile = {
    display_name: before.display_name,
    phone: before.phone,
    email: before.email,
  };
  const nextProfile = {
    display_name: name,
    phone: phone || before.phone,
    email: email || before.email,
  };
  const { error: profileError } = await service
    .from("profiles")
    .update(nextProfile)
    .eq("id", id)
    .eq("institution_id", institutionId);
  if (profileError) {
    return NextResponse.json({ error: "Mise à jour du profil impossible." }, { status: 500 });
  }

  const meta = {
    ...(authUser.user_metadata || {}),
    display_name: name,
    phone: phone || before.phone || null,
    email: email || before.email || null,
  };
  const authPatch: {
    user_metadata: Record<string, unknown>;
    phone?: string;
    phone_confirm?: boolean;
    email?: string;
    email_confirm?: boolean;
  } = { user_metadata: meta };
  if (phoneChanged && phone) {
    authPatch.phone = phone;
    authPatch.phone_confirm = true;
  }
  if (emailChanged && email) {
    authPatch.email = email;
    authPatch.email_confirm = true;
  }
  const { error: authUpdateError } = await service.auth.admin.updateUserById(id, authPatch);
  if (authUpdateError) {
    const { error: rollbackError } = await service
      .from("profiles")
      .update(previousProfile)
      .eq("id", id)
      .eq("institution_id", institutionId);
    return NextResponse.json({
      error: rollbackError
        ? "Mise à jour de connexion refusée et restauration du profil impossible : contactez le support."
        : /already|unique|duplicate|registered|exists/i.test(authUpdateError.message)
          ? "Ce téléphone ou cet e-mail appartient déjà à un compte."
          : "Supabase Auth a refusé la modification ; le profil initial a été restauré.",
    }, { status: rollbackError ? 500 : 409 });
  }

  // Denormalized teacher labels are kept in sync; never alter assignments/history IDs.
  if (nameChanged && target.role === "teacher") {
    await service
      .from("teacher_subjects")
      .update({ teacher_name: name })
      .eq("institution_id", institutionId)
      .eq("profile_id", id);
  }
  return NextResponse.json({
    ok: true,
    profile: { id, institution_id: institutionId, ...nextProfile, role: target.role },
  }, { headers: { "Cache-Control": "no-store" } });
}
