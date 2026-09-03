// src/app/api/admin/enrollments/remove/route.ts
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

const PUBLIC_STUDENT_RESIDUAL_TABLES = [
  "ai_training_samples",
  "class_student_general_avgs",
  "class_student_subject_avgs",
  "conduct_student_periods",
  "grade_flat_marks",
  "ml_student_features_history",
  "ml_training_labels",
  "whatsapp_outbox",
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

  // Securite : le bouton Retirer est affiche sur une ligne de classe.
  // On confirme donc que l'eleve appartient encore activement a cette classe
  // avant de supprimer definitivement sa fiche.
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

  // "Retirer" signifie desormais SUPPRIMER DEFINITIVEMENT la fiche eleve.
  // Les tables liees a students avec ON DELETE CASCADE sont nettoyees par
  // PostgreSQL. On traite explicitement ci-dessous les donnees finance et les
  // anciennes tables techniques qui ne disposent pas toutes d'une FK cascade.

  const { data: receipts, error: receiptsReadErr } = await srv
    .schema("finance")
    .from("receipts")
    .select("id")
    .eq("school_id", inst)
    .eq("student_id", student_id);

  if (receiptsReadErr) {
    return NextResponse.json(
      { error: receiptsReadErr.message, code: "student_delete_prepare_failed" },
      { status: 409 },
    );
  }

  const receiptIds = (receipts ?? [])
    .map((row: any) => String(row.id || "").trim())
    .filter(Boolean);

  const { data: charges, error: chargesReadErr } = await srv
    .schema("finance")
    .from("student_charges")
    .select("id")
    .eq("school_id", inst)
    .eq("student_id", student_id);

  if (chargesReadErr) {
    return NextResponse.json(
      { error: chargesReadErr.message, code: "student_delete_prepare_failed" },
      { status: 409 },
    );
  }

  const chargeIds = (charges ?? [])
    .map((row: any) => String(row.id || "").trim())
    .filter(Boolean);

  const { error: intentsDeleteErr } = await srv
    .schema("finance")
    .from("online_payment_intents")
    .delete()
    .eq("student_id", student_id);

  if (intentsDeleteErr) {
    return NextResponse.json(
      { error: intentsDeleteErr.message, code: "student_finance_delete_failed" },
      { status: 409 },
    );
  }

  if (receiptIds.length > 0) {
    const { error } = await srv
      .schema("finance")
      .from("receipt_allocations")
      .delete()
      .in("receipt_id", receiptIds);

    if (error) {
      return NextResponse.json(
        { error: error.message, code: "student_finance_delete_failed" },
        { status: 409 },
      );
    }
  }

  if (chargeIds.length > 0) {
    const { error } = await srv
      .schema("finance")
      .from("receipt_allocations")
      .delete()
      .in("student_charge_id", chargeIds);

    if (error) {
      return NextResponse.json(
        { error: error.message, code: "student_finance_delete_failed" },
        { status: 409 },
      );
    }
  }

  const { error: remindersDeleteErr } = await srv
    .schema("finance")
    .from("reminder_logs")
    .delete()
    .eq("student_id", student_id);

  if (remindersDeleteErr) {
    return NextResponse.json(
      { error: remindersDeleteErr.message, code: "student_finance_delete_failed" },
      { status: 409 },
    );
  }

  const { error: receiptsDeleteErr } = await srv
    .schema("finance")
    .from("receipts")
    .delete()
    .eq("school_id", inst)
    .eq("student_id", student_id);

  if (receiptsDeleteErr) {
    return NextResponse.json(
      { error: receiptsDeleteErr.message, code: "student_finance_delete_failed" },
      { status: 409 },
    );
  }

  const { error: chargesDeleteErr } = await srv
    .schema("finance")
    .from("student_charges")
    .delete()
    .eq("school_id", inst)
    .eq("student_id", student_id);

  if (chargesDeleteErr) {
    return NextResponse.json(
      { error: chargesDeleteErr.message, code: "student_finance_delete_failed" },
      { status: 409 },
    );
  }

  for (const table of PUBLIC_STUDENT_RESIDUAL_TABLES) {
    const { error } = await srv
      .from(table)
      .delete()
      .eq("student_id", student_id);

    if (error && error.code !== "42P01") {
      return NextResponse.json(
        {
          error: error.message,
          code: "student_technical_delete_failed",
          table,
        },
        { status: 409 },
      );
    }
  }

  const { data: deleted, error: deleteErr } = await srv
    .from("students")
    .delete()
    .eq("institution_id", inst)
    .eq("id", student_id)
    .select("id")
    .maybeSingle();

  if (deleteErr) {
    return NextResponse.json(
      { error: deleteErr.message, code: "student_delete_failed" },
      { status: 409 },
    );
  }

  if (!deleted) {
    return NextResponse.json({ error: "student_delete_not_applied" }, { status: 409 });
  }

  // La fiche longitudinale student_persons ne doit pas rester comme donnée
  // fantôme lorsque la dernière fiche student qui l'utilise vient d'être supprimée.
  // On ne la supprime jamais si une autre fiche student y est encore rattachée.
  const studentPersonId = String((student as any)?.student_person_id || "").trim();
  let studentPersonDeleted = false;
  let studentPersonCleanupWarning: string | null = null;

  if (studentPersonId) {
    const { count: remainingStudentLinks, error: remainingLinksErr } = await srv
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("student_person_id", studentPersonId);

    if (remainingLinksErr) {
      studentPersonCleanupWarning = remainingLinksErr.message;
    } else if ((remainingStudentLinks ?? 0) === 0) {
      const { error: personDeleteErr } = await srv
        .from("student_persons")
        .delete()
        .eq("id", studentPersonId);

      if (personDeleteErr) {
        studentPersonCleanupWarning = personDeleteErr.message;
      } else {
        studentPersonDeleted = true;
      }
    }
  }

  return NextResponse.json({
    deleted: true,
    student_id,
    student_person_deleted: studentPersonDeleted,
    student_person_cleanup_warning: studentPersonCleanupWarning,
    receipts_deleted: receiptIds.length,
    charges_deleted: chargeIds.length,
  });
}
