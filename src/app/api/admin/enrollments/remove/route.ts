import { NextRequest, NextResponse } from "next/server";
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
      { status: 400 },
    );
  }

  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id,academic_year")
    .eq("id", class_id)
    .maybeSingle();

  if (clsErr) {
    return NextResponse.json({ error: clsErr.message }, { status: 400 });
  }
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  const { data: student, error: studentErr } = await srv
    .from("students")
    .select("id,institution_id,first_name,last_name,matricule,student_person_id")
    .eq("institution_id", inst)
    .eq("id", student_id)
    .maybeSingle();

  if (studentErr) {
    return NextResponse.json({ error: studentErr.message }, { status: 400 });
  }
  if (!student) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }

  // The button belongs to a class row, so a stale class selection must not
  // affect another student. The update below only closes this enrollment.
  const { data: activeEnrollment, error: enrollmentErr } = await srv
    .from("class_enrollments")
    .select("id")
    .eq("institution_id", inst)
    .eq("class_id", class_id)
    .eq("student_id", student_id)
    .is("end_date", null)
    .maybeSingle();

  if (enrollmentErr) {
    return NextResponse.json({ error: enrollmentErr.message }, { status: 400 });
  }
  if (!activeEnrollment) {
    return NextResponse.json({ error: "not_found_in_class" }, { status: 404 });
  }

  // A withdrawal from a class must NEVER delete the student dossier,
  // grades, attendance, school history, finance receipts or guardians.
  const today = new Date().toISOString().slice(0, 10);
  const { data: closed, error: removalErr } = await srv
    .from("class_enrollments")
    .update({ end_date: today })
    .eq("id", activeEnrollment.id)
    .eq("institution_id", inst)
    .eq("class_id", class_id)
    .eq("student_id", student_id)
    .is("end_date", null)
    .select("id");

  if (removalErr) {
    return NextResponse.json(
      { error: removalErr.message, code: "student_class_withdrawal_failed" },
      { status: 409 },
    );
  }
  if (closed?.length !== 1) {
    return NextResponse.json(
      { error: "student_class_withdrawal_not_applied" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, closed: 1, deleted: false, student_id });
}
