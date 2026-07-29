// src/app/api/admin/enrollments/assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "../../_helpers/institutionAccess";
import {
  synchronizeStudentFinance,
  type AppliedStudentFinanceSynchronization,
} from "@/lib/finance/student-finance-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "create_and_assign" | "assign";

const ENROLLMENT_MANAGE_ROLES = [
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "finance",
] as const;
const STUDENT_CREATE_ROLES = new Set(["admin", "super_admin", "founder"]);

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function requiredBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function POST(req: NextRequest) {
  const access = await requireInstitutionAccess({
    allowedRoles: ENROLLMENT_MANAGE_ROLES,
  });
  if ("error" in access) return access.error;

  const { srv, user, roles } = access;
  const inst = access.institutionId;
  const body = await req.json().catch(() => ({}));
  const action: Action = (body?.action || "").trim();
  const class_id: string = String(body?.class_id || "");

  if (!action || (action !== "create_and_assign" && action !== "assign")) {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }
  if (
    action === "create_and_assign" &&
    !Array.from(roles).some((role) => STUDENT_CREATE_ROLES.has(role))
  ) {
    return NextResponse.json(
      { error: "forbidden_create_student" },
      { status: 403 },
    );
  }
  if (!class_id)
    return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  // Classe valide ?
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id,academic_year,label,code,level,official_track_code")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr)
    return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  let studentId: string | null = null;
  let studentFirst: string | null = null;
  let studentLast: string | null = null;
  let studentMatricule: string | null = null;
  let createdStudent = false;
  let studentPreparationSnapshot: Record<string, unknown> | null = null;

  if (action === "create_and_assign") {
    const first_name: string | null =
      body?.first_name ?? null ? String(body.first_name).trim() : null;
    const last_name: string | null =
      body?.last_name ?? null ? String(body.last_name).trim() : null;
    const matricule: string | null =
      body?.matricule ?? null ? String(body.matricule).trim() : null;
    const isAffecte = requiredBoolean(body?.is_affecte);
    const isBoarder = requiredBoolean(body?.is_boarder);

    if (isAffecte === null || isBoarder === null) {
      return NextResponse.json(
        {
          error:
            "Affecte/Non affecte et Interne/Externe sont obligatoires avant l'inscription.",
        },
        { status: 400 },
      );
    }

    if (matricule) {
      const { data: exist, error: exErr } = await srv
        .from("students")
        .select("id,first_name,last_name,matricule,is_affecte,is_boarder")
        .eq("institution_id", inst)
        .eq("matricule", matricule)
        .maybeSingle();
      if (exErr)
        return NextResponse.json({ error: exErr.message }, { status: 400 });

      if (exist) {
        studentPreparationSnapshot = {
          first_name: (exist as any).first_name ?? null,
          last_name: (exist as any).last_name ?? null,
          is_affecte: (exist as any).is_affecte ?? null,
          is_boarder: (exist as any).is_boarder ?? null,
        };
        studentId = (exist as any).id;
        studentFirst = (exist as any).first_name ?? null;
        studentLast = (exist as any).last_name ?? null;
        studentMatricule = (exist as any).matricule ?? null;

        const patch: any = {};
        if (first_name && first_name !== (studentFirst ?? ""))
          patch.first_name = first_name;
        if (last_name && last_name !== (studentLast ?? ""))
          patch.last_name = last_name;
        patch.is_affecte = isAffecte;
        patch.is_boarder = isBoarder;

        if (Object.keys(patch).length > 0) {
          const { error: upErr } = await srv
            .from("students")
            .update(patch)
            .eq("id", studentId);
          if (upErr)
            return NextResponse.json({ error: upErr.message }, { status: 400 });
          studentFirst = patch.first_name ?? studentFirst;
          studentLast = patch.last_name ?? studentLast;
        }
      } else {
        const { data: created, error: cErr } = await srv
          .from("students")
          .insert([
            {
              institution_id: inst,
              first_name,
              last_name,
              matricule,
              is_affecte: isAffecte,
              is_boarder: isBoarder,
            },
          ])
          .select("id,first_name,last_name,matricule")
          .maybeSingle();
        if (cErr)
          return NextResponse.json({ error: cErr.message }, { status: 400 });

        studentId = (created as any).id;
        studentFirst = (created as any).first_name ?? null;
        studentLast = (created as any).last_name ?? null;
        studentMatricule = (created as any).matricule ?? null;
        createdStudent = true;
      }
    } else {
      const { data: created, error: cErr } = await srv
        .from("students")
        .insert([
          {
            institution_id: inst,
            first_name,
            last_name,
            matricule: null,
            is_affecte: isAffecte,
            is_boarder: isBoarder,
          },
        ])
        .select("id,first_name,last_name,matricule")
        .maybeSingle();
      if (cErr)
        return NextResponse.json({ error: cErr.message }, { status: 400 });

      studentId = (created as any).id;
      studentFirst = (created as any).first_name ?? null;
      studentLast = (created as any).last_name ?? null;
      studentMatricule = (created as any).matricule ?? null;
      createdStudent = true;
    }
  } else {
    // assign (par matricule OU par student_id)
    const matricule: string = String(body?.matricule || "").trim();
    const byId: string = String(body?.student_id || "").trim();

    if (!matricule && !byId) {
      return NextResponse.json(
        { error: "matricule_or_student_id_required" },
        { status: 400 },
      );
    }

    if (byId) {
      const { data: exist, error: exErr } = await srv
        .from("students")
        .select("id,first_name,last_name,matricule,institution_id")
        .eq("id", byId)
        .maybeSingle();
      if (exErr)
        return NextResponse.json({ error: exErr.message }, { status: 400 });
      if (!exist)
        return NextResponse.json(
          { error: "student_not_found" },
          { status: 404 },
        );
      if ((exist as any).institution_id !== inst) {
        return NextResponse.json(
          { error: "student_wrong_institution" },
          { status: 403 },
        );
      }
      studentId = (exist as any).id;
      studentFirst = (exist as any).first_name ?? null;
      studentLast = (exist as any).last_name ?? null;
      studentMatricule = (exist as any).matricule ?? null;
    } else {
      const { data: exist, error: exErr } = await srv
        .from("students")
        .select("id,first_name,last_name,matricule")
        .eq("institution_id", inst)
        .eq("matricule", matricule)
        .maybeSingle();
      if (exErr)
        return NextResponse.json({ error: exErr.message }, { status: 400 });
      if (!exist)
        return NextResponse.json(
          { error: "student_not_found" },
          { status: 404 },
        );

      studentId = (exist as any).id;
      studentFirst = (exist as any).first_name ?? null;
      studentLast = (exist as any).last_name ?? null;
      studentMatricule = (exist as any).matricule ?? null;
    }
  }

  if (!studentId)
    return NextResponse.json(
      { error: "student_resolve_failed" },
      { status: 400 },
    );

  const rollbackPreparedStudent = async () => {
    if (!studentId) return;
    if (createdStudent) {
      await srv
        .from("students")
        .delete()
        .eq("id", studentId)
        .eq("institution_id", inst);
      return;
    }
    if (studentPreparationSnapshot) {
      await srv
        .from("students")
        .update(studentPreparationSnapshot as any)
        .eq("id", studentId)
        .eq("institution_id", inst);
    }
  };

  const today = isoToday();

  // Le transfert de classe et le transfert financier doivent être préparés
  // avant de fermer l'ancienne inscription. En cas d'anomalie (barème cible
  // manquant, doublons déjà encaissés, profil financier incomplet), aucune
  // inscription n'est modifiée.
  let sameYearClassIds: string[] = [];
  const targetAcademicYear = String((cls as any).academic_year || "").trim();

  if (targetAcademicYear) {
    const { data: sameYearClasses, error: sameYearErr } = await srv
      .from("classes")
      .select("id")
      .eq("institution_id", inst)
      .eq("academic_year", targetAcademicYear);

    if (sameYearErr) {
      await rollbackPreparedStudent();
      return NextResponse.json({ error: sameYearErr.message }, { status: 400 });
    }

    sameYearClassIds = (sameYearClasses ?? [])
      .map((row: any) => String(row.id))
      .filter(Boolean);
  }

  const sourceEnrollmentQuery = srv
    .from("class_enrollments")
    .select("id,class_id,start_date,end_date")
    .eq("institution_id", inst)
    .eq("student_id", studentId)
    .neq("class_id", class_id)
    .is("end_date", null);

  const { data: sourceEnrollments, error: sourceEnrollmentErr } =
    targetAcademicYear
      ? sameYearClassIds.length
        ? await sourceEnrollmentQuery.in("class_id", sameYearClassIds)
        : { data: [], error: null as any }
      : { data: [], error: null as any };

  if (sourceEnrollmentErr) {
    await rollbackPreparedStudent();
    return NextResponse.json(
      { error: sourceEnrollmentErr.message },
      { status: 400 },
    );
  }

  const { data: targetEnrollmentBefore, error: targetEnrollmentErr } = await srv
    .from("class_enrollments")
    .select("id,class_id,start_date,end_date")
    .eq("institution_id", inst)
    .eq("student_id", studentId)
    .eq("class_id", class_id)
    .maybeSingle();

  if (targetEnrollmentErr) {
    await rollbackPreparedStudent();
    return NextResponse.json(
      { error: targetEnrollmentErr.message },
      { status: 400 },
    );
  }

  const sourceClassIds = Array.from(
    new Set(
      (sourceEnrollments ?? [])
        .map((row: any) => String(row.class_id || "").trim())
        .filter(Boolean),
    ),
  );

  let financeTransfer: AppliedStudentFinanceSynchronization;

  try {
    financeTransfer = await synchronizeStudentFinance({
      srv,
      institutionId: inst,
      userId: user.id,
      studentId,
      sourceClassIds,
      targetClass: {
        id: String((cls as any).id),
        label: (cls as any).label ?? null,
        code: (cls as any).code ?? null,
        level: (cls as any).level ?? null,
        academic_year: (cls as any).academic_year ?? null,
        official_track_code: (cls as any).official_track_code ?? null,
        institution_id: inst,
      },
    });
  } catch (financeError) {
    await rollbackPreparedStudent();
    return NextResponse.json(
      {
        error:
          financeError instanceof Error
            ? financeError.message
            : "Le transfert financier de l'élève a échoué.",
        code: "finance_class_transfer_failed",
      },
      { status: 409 },
    );
  }

  const sourceEnrollmentSnapshots = (sourceEnrollments ?? []).map(
    (row: any) => ({
      id: String(row.id),
      end_date: row.end_date ?? null,
    }),
  );

  let targetEnrollmentInserted = false;

  const rollbackEnrollment = async () => {
    for (const snapshot of sourceEnrollmentSnapshots) {
      await srv
        .from("class_enrollments")
        .update({ end_date: snapshot.end_date })
        .eq("id", snapshot.id)
        .eq("institution_id", inst);
    }

    if (targetEnrollmentBefore?.id) {
      await srv
        .from("class_enrollments")
        .update({
          start_date: (targetEnrollmentBefore as any).start_date ?? today,
          end_date: (targetEnrollmentBefore as any).end_date ?? null,
        })
        .eq("id", (targetEnrollmentBefore as any).id)
        .eq("institution_id", inst);
    } else if (targetEnrollmentInserted) {
      await srv
        .from("class_enrollments")
        .delete()
        .eq("institution_id", inst)
        .eq("student_id", studentId)
        .eq("class_id", class_id);
    }
  };

  let closedCount = 0;
  let reactivatedCount = 0;
  let insertedCount = 0;

  try {
    const sourceEnrollmentIds = sourceEnrollmentSnapshots.map((row) => row.id);

    if (sourceEnrollmentIds.length > 0) {
      const { data: oldClosed, error: oldErr } = await srv
        .from("class_enrollments")
        .update({ end_date: today })
        .eq("institution_id", inst)
        .in("id", sourceEnrollmentIds)
        .select("id");

      if (oldErr) throw new Error(oldErr.message);
      closedCount = (oldClosed ?? []).length;
    }

    if (targetEnrollmentBefore?.id) {
      const wasClosed = Boolean((targetEnrollmentBefore as any).end_date);
      const { data: reactivated, error: reacErr } = await srv
        .from("class_enrollments")
        .update({ end_date: null })
        .eq("id", (targetEnrollmentBefore as any).id)
        .eq("institution_id", inst)
        .select("id");

      if (reacErr) throw new Error(reacErr.message);
      reactivatedCount = wasClosed ? (reactivated ?? []).length : 0;
    } else {
      const { data: inserted, error: insErr } = await srv
        .from("class_enrollments")
        .insert([
          {
            class_id,
            student_id: studentId,
            institution_id: inst,
            start_date: today,
            end_date: null,
          },
        ])
        .select("id");

      if (insErr) throw new Error(insErr.message);
      targetEnrollmentInserted = true;
      insertedCount = (inserted ?? []).length;
    }
  } catch (enrollmentError) {
    const rollbackResults = await Promise.allSettled([
      rollbackEnrollment(),
      financeTransfer.rollback(),
    ]);
    const studentRollbackResult = await Promise.allSettled([
      rollbackPreparedStudent(),
    ]);
    const rollbackFailed = rollbackResults.some(
      (result) => result.status === "rejected",
    ) || studentRollbackResult.some((result) => result.status === "rejected");

    return NextResponse.json(
      {
        error:
          enrollmentError instanceof Error
            ? enrollmentError.message
            : "Le transfert de classe a échoué.",
        code: rollbackFailed
          ? "class_transfer_rollback_incomplete"
          : "class_transfer_rolled_back",
      },
      { status: 409 },
    );
  }


  return NextResponse.json({
    ok: true,
    student: {
      id: studentId,
      first_name: studentFirst,
      last_name: studentLast,
      matricule: studentMatricule,
    },
    closed_old_enrollments: closedCount,
    reactivated_in_target: reactivatedCount,
    inserted_in_target: insertedCount,
    finance_transfer: financeTransfer.transfer,
    finance_sync: financeTransfer.reconciliation,
  });
}
