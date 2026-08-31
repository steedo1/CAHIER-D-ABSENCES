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
      { status: 400 },
    );
  }

  // Vérifier que la classe appartient bien à l'établissement et récupérer
  // l'année : le retrait ne doit agir que sur l'année de cette classe.
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id,academic_year")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr)
    return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  const academicYear = String((cls as any).academic_year || "").trim();

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
      return NextResponse.json({ error: "not_found_in_class" }, { status: 404 });
    }

    if (checkPair[0].end_date !== null) {
      return NextResponse.json({ error: "already_closed" }, { status: 409 });
    }

    return NextResponse.json({ error: "no_active_row_closed" }, { status: 409 });
  }

  const today = new Date().toISOString().slice(0, 10);
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
    return NextResponse.json({ error: "no_active_row_closed" }, { status: 409 });
  }

  const rollbackEnrollment = async () => {
    await srv
      .from("class_enrollments")
      .update({ end_date: null })
      .eq("institution_id", inst)
      .eq("id", activeEnrollment.id);
  };

  // S'il existe encore une inscription ouverte dans une autre classe de la
  // même année, on vient seulement de fermer une ligne concurrente/transférée :
  // l'élève reste actif et sa finance ne doit pas être annulée.
  const { data: remainingEnrollments, error: remainingError } = await srv
    .from("class_enrollments")
    .select("class_id")
    .eq("institution_id", inst)
    .eq("student_id", student_id)
    .is("end_date", null);

  if (remainingError) {
    await rollbackEnrollment();
    return NextResponse.json(
      { error: remainingError.message, code: "remove_verification_failed" },
      { status: 409 },
    );
  }

  const remainingClassIds = Array.from(
    new Set(
      (remainingEnrollments ?? [])
        .map((row: any) => String(row.class_id || "").trim())
        .filter(Boolean),
    ),
  );

  let stillActiveInSameYear = false;
  if (academicYear && remainingClassIds.length > 0) {
    const { data: sameYearRows, error: sameYearError } = await srv
      .from("classes")
      .select("id")
      .eq("institution_id", inst)
      .eq("academic_year", academicYear)
      .in("id", remainingClassIds)
      .limit(1);

    if (sameYearError) {
      await rollbackEnrollment();
      return NextResponse.json(
        { error: sameYearError.message, code: "remove_verification_failed" },
        { status: 409 },
      );
    }
    stillActiveInSameYear = (sameYearRows ?? []).length > 0;
  }

  if (stillActiveInSameYear) {
    return NextResponse.json({
      closed: 1,
      end_date: endDate,
      withdrawn_from_year: false,
      finance_cancelled: 0,
    });
  }

  // À partir d'ici, « Retirer » signifie réellement sortir l'élève du périmètre
  // actif de l'année. On conserve toutefois les reçus et les dettes déjà soldées.
  const { data: studentBefore, error: studentReadError } = await srv
    .from("students")
    .select("lifecycle_status,exit_date,exit_reason")
    .eq("institution_id", inst)
    .eq("id", student_id)
    .maybeSingle();

  if (studentReadError || !studentBefore) {
    await rollbackEnrollment();
    return NextResponse.json(
      {
        error: studentReadError?.message || "student_not_found",
        code: "student_withdrawal_prepare_failed",
      },
      { status: 409 },
    );
  }

  const rollbackStudent = async () => {
    await srv
      .from("students")
      .update({
        lifecycle_status: (studentBefore as any).lifecycle_status,
        exit_date: (studentBefore as any).exit_date,
        exit_reason: (studentBefore as any).exit_reason,
      })
      .eq("institution_id", inst)
      .eq("id", student_id);
  };

  const { error: studentUpdateError } = await srv
    .from("students")
    .update({
      lifecycle_status: "exited",
      exit_date: (studentBefore as any).exit_date || today,
      exit_reason:
        String((studentBefore as any).exit_reason || "").trim() ||
        `Retiré de l’année ${academicYear || "courante"}`,
    })
    .eq("institution_id", inst)
    .eq("id", student_id);

  if (studentUpdateError) {
    await rollbackEnrollment();
    return NextResponse.json(
      { error: studentUpdateError.message, code: "student_withdrawal_failed" },
      { status: 409 },
    );
  }

  let financeCancelled = 0;

  if (academicYear) {
    const { data: yearRow, error: yearError } = await srv
      .from("academic_years")
      .select("id")
      .eq("institution_id", inst)
      .eq("code", academicYear)
      .maybeSingle();

    if (yearError || !yearRow?.id) {
      await Promise.allSettled([rollbackStudent(), rollbackEnrollment()]);
      return NextResponse.json(
        {
          error: yearError?.message || "academic_year_not_found",
          code: "finance_withdrawal_prepare_failed",
        },
        { status: 409 },
      );
    }

    const { data: balances, error: balanceError } = await srv
      .schema("finance")
      .from("v_charge_balances")
      .select("id")
      .eq("school_id", inst)
      .eq("academic_year_id", String(yearRow.id))
      .eq("student_id", student_id)
      .in("computed_status", ["pending", "partial"]);

    if (balanceError) {
      await Promise.allSettled([rollbackStudent(), rollbackEnrollment()]);
      return NextResponse.json(
        { error: balanceError.message, code: "finance_withdrawal_prepare_failed" },
        { status: 409 },
      );
    }

    const chargeIds = Array.from(
      new Set(
        (balances ?? [])
          .map((row: any) => String(row.id || "").trim())
          .filter(Boolean),
      ),
    );

    if (chargeIds.length > 0) {
      const { data: cancelledRows, error: cancelError } = await srv
        .schema("finance")
        .from("student_charges")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("school_id", inst)
        .eq("student_id", student_id)
        .in("id", chargeIds)
        .select("id");

      if (cancelError) {
        await Promise.allSettled([rollbackStudent(), rollbackEnrollment()]);
        return NextResponse.json(
          { error: cancelError.message, code: "finance_withdrawal_failed" },
          { status: 409 },
        );
      }
      financeCancelled = (cancelledRows ?? []).length;
    }
  }

  return NextResponse.json({
    closed: 1,
    end_date: endDate,
    withdrawn_from_year: true,
    lifecycle_status: "exited",
    finance_cancelled: financeCancelled,
    receipts_preserved: true,
  });
}
