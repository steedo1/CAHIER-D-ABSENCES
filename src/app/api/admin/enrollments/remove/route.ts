// src/app/api/admin/enrollments/remove/route.ts
import { NextRequest, NextResponse } from "next/server";
import { safeEnrollmentEndDate } from "@/lib/student-class-membership";
import { requireInstitutionAccess } from "../../_helpers/institutionAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENROLLMENT_REMOVE_ROLES = [
  "admin",
  "super_admin",
  "founder",
  "file_correspondent",
  "finance_manager",
  "finance",
] as const;

export async function POST(req: NextRequest) {
  const access = await requireInstitutionAccess({
    allowedRoles: ENROLLMENT_REMOVE_ROLES,
  });
  if ("error" in access) return access.error;

  const srv = access.srv;
  const inst = access.institutionId;

  const { class_id, student_id } = await req.json().catch(() => ({}));
  if (!class_id || !student_id) {
    return NextResponse.json(
      { error: "class_id_and_student_id_required" },
      { status: 400 }
    );
  }

  // Vérifier que la classe appartient bien à mon établissement
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  const { data: activeEnrollment, error: activeEnrollmentError } = await srv
    .from("class_enrollments")
    .select("id,start_date")
    .eq("institution_id", inst)
    .eq("class_id", class_id)
    .eq("student_id", student_id)
    .is("end_date", null)
    .maybeSingle();

  if (activeEnrollmentError) {
    return NextResponse.json(
      { error: activeEnrollmentError.message },
      { status: 400 },
    );
  }

  if (!activeEnrollment) {
    // Diagnostique utile si rien n'a été fermé
    const { data: checkPair, error: checkErr } = await srv
      .from("class_enrollments")
      .select("id,end_date")
      .eq("institution_id", inst)
      .eq("class_id", class_id)
      .eq("student_id", student_id)
      .limit(1);

    if (checkErr) {
      return NextResponse.json({ error: checkErr.message }, { status: 400 });
    }

    if (!checkPair?.length) {
      // Aucune ligne pour cette paire (classe, élève)
      return NextResponse.json({ error: "not_found_in_class" }, { status: 404 });
    }

    if (checkPair[0].end_date !== null) {
      // Déjà fermé
      return NextResponse.json({ error: "already_closed" }, { status: 409 });
    }

    return NextResponse.json({ error: "no_active_row_closed" }, { status: 409 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Une inscription de la prochaine rentrée ne peut pas être fermée avant son
  // début. On conserve l'élève et toute sa finance : seule l'inscription est close.
  const endDate = safeEnrollmentEndDate(activeEnrollment.start_date, today);

  const { data: closedEnrollment, error: closeError } = await srv
    .from("class_enrollments")
    .update({ end_date: endDate })
    .eq("institution_id", inst)
    .eq("id", activeEnrollment.id)
    .is("end_date", null)
    .select("id")
    .maybeSingle();

  if (closeError) {
    return NextResponse.json({ error: closeError.message }, { status: 400 });
  }

  if (!closedEnrollment) {
    // La ligne a pu être fermée en parallèle entre la lecture et l'update.
    return NextResponse.json({ error: "no_active_row_closed" }, { status: 409 });
  }

  return NextResponse.json({ closed: 1, end_date: endDate });
}
