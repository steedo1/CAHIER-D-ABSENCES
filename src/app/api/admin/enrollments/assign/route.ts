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
const STUDENT_CREATE_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "finance",
]);

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function requiredBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeStudentIdentityName(lastName: unknown, firstName: unknown) {
  return `${String(lastName ?? "").trim()} ${String(firstName ?? "").trim()}`
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("fr");
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
    !Array.from(roles).some((role) => STUDENT_CREATE_ROLES.has(String(role)))
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

        // Cas transition d'année déjà partiellement saisie :
        // la classe cible peut contenir une fiche 2026-2027 sans matricule
        // pour le même enfant. Cette fiche courante reste la référence :
        // on lui transfère uniquement le matricule de la fiche historique.
        const historicalNameKey = normalizeStudentIdentityName(
          studentLast,
          studentFirst,
        );
        const { data: targetRoster, error: targetRosterErr } = await srv
          .from("class_enrollments")
          .select(
            "student_id,students:student_id(id,first_name,last_name,matricule,is_affecte,is_boarder)",
          )
          .eq("institution_id", inst)
          .eq("class_id", class_id)
          .is("end_date", null);

        if (targetRosterErr) {
          return NextResponse.json(
            { error: targetRosterErr.message },
            { status: 400 },
          );
        }

        const currentCandidates = (targetRoster ?? []).filter((row: any) => {
          const student = Array.isArray(row?.students)
            ? row.students[0]
            : row?.students;
          if (!student?.id || String(student.id) === studentId) return false;
          if (String(student.matricule || "").trim()) return false;
          return (
            normalizeStudentIdentityName(
              student.last_name,
              student.first_name,
            ) === historicalNameKey
          );
        });

        if (currentCandidates.length > 1) {
          return NextResponse.json(
            {
              error:
                "Plusieurs fiches sans matricule portent exactement ce nom dans la classe. Réconciliation manuelle requise.",
              code: "ambiguous_duplicate_student",
            },
            { status: 409 },
          );
        }

        if (currentCandidates.length === 1) {
          const currentStudent = Array.isArray(
            (currentCandidates[0] as any)?.students,
          )
            ? (currentCandidates[0] as any).students[0]
            : (currentCandidates[0] as any)?.students;
          const currentStudentId = String(currentStudent?.id || "").trim();

          const { data: reconciliationData, error: reconciliationError } =
            await srv.rpc("promote_current_student_over_historical", {
              p_institution_id: inst,
              p_historical_student_id: studentId,
              p_current_student_id: currentStudentId,
              p_actor_id: user.id,
              p_academic_year:
                String((cls as any).academic_year || "").trim() || null,
            });

          if (reconciliationError) {
            const message = String(reconciliationError.message || "");
            const missingRpc =
              message.toLowerCase().includes(
                "promote_current_student_over_historical",
              ) && message.toLowerCase().includes("function");
            return NextResponse.json(
              {
                error: missingRpc
                  ? "La migration de réconciliation des élèves doit être appliquée avant cette inscription."
                  : message,
                code: missingRpc
                  ? "student_reconciliation_migration_required"
                  : "student_reconciliation_failed",
              },
              { status: 409 },
            );
          }

          const patch: any = {};
          if (typeof isAffecte === "boolean") patch.is_affecte = isAffecte;
          if (typeof isBoarder === "boolean") patch.is_boarder = isBoarder;
          if (first_name) patch.first_name = first_name;
          if (last_name) patch.last_name = last_name;

          if (Object.keys(patch).length > 0) {
            const { error: currentUpdateError } = await srv
              .from("students")
              .update(patch)
              .eq("id", currentStudentId)
              .eq("institution_id", inst);
            if (currentUpdateError) {
              return NextResponse.json(
                {
                  error: currentUpdateError.message,
                  code: "reconciled_student_update_failed",
                },
                { status: 409 },
              );
            }
          }

          const targetAcademicYear = String(
            (cls as any).academic_year || "",
          ).trim();
          if (targetAcademicYear) {
            const { data: ay, error: ayError } = await srv
              .from("academic_years")
              .select("id")
              .eq("institution_id", inst)
              .eq("code", targetAcademicYear)
              .maybeSingle();
            if (ayError) {
              return NextResponse.json(
                { error: ayError.message },
                { status: 409 },
              );
            }

            if (ay?.id) {
              const finalAffecte =
                typeof isAffecte === "boolean"
                  ? isAffecte
                  : typeof currentStudent?.is_affecte === "boolean"
                    ? currentStudent.is_affecte
                    : null;
              const finalBoarder =
                typeof isBoarder === "boolean"
                  ? isBoarder
                  : typeof currentStudent?.is_boarder === "boolean"
                    ? currentStudent.is_boarder
                    : null;

              const { error: profileError } = await srv
                .from("student_year_profiles")
                .upsert(
                  {
                    institution_id: inst,
                    academic_year_id: String(ay.id),
                    academic_year: targetAcademicYear,
                    student_id: currentStudentId,
                    class_id,
                    level: String(
                      (cls as any).level || (cls as any).label || "unknown",
                    ),
                    is_boarder: finalBoarder === true,
                    boarding_status_raw:
                      finalBoarder === null
                        ? "unknown"
                        : finalBoarder
                          ? "interne"
                          : "externe",
                    affectation_status:
                      finalAffecte === null
                        ? "unknown"
                        : finalAffecte
                          ? "affecte"
                          : "non_affecte",
                    affectation_status_raw:
                      finalAffecte === null
                        ? "unknown"
                        : finalAffecte
                          ? "affecte"
                          : "non_affecte",
                    billing_affectation_group:
                      finalAffecte === null
                        ? "unknown"
                        : finalAffecte
                          ? "affecte"
                          : "non_affecte",
                    scholarship_status: "unknown",
                    source: "enrollment_reconciliation",
                    source_payload: {
                      class_id,
                      historical_student_id: studentId,
                    },
                    updated_at: new Date().toISOString(),
                  },
                  {
                    onConflict:
                      "institution_id,academic_year_id,student_id",
                  },
                );
              if (profileError) {
                return NextResponse.json(
                  { error: profileError.message },
                  { status: 409 },
                );
              }
            }
          }

          return NextResponse.json({
            ok: true,
            student: {
              id: currentStudentId,
              first_name: first_name || currentStudent?.first_name || studentFirst,
              last_name: last_name || currentStudent?.last_name || studentLast,
              matricule,
            },
            reconciled_existing_current_student: true,
            reconciliation: reconciliationData,
            closed_old_enrollments: Number(
              (reconciliationData as any)?.closed_historical_enrollments || 0,
            ),
            reactivated_in_target: 0,
            inserted_in_target: 0,
            finance_transfer: null,
            finance_sync: null,
          });
        }

        const patch: any = {};
        if (first_name && first_name !== (studentFirst ?? ""))
          patch.first_name = first_name;
        if (last_name && last_name !== (studentLast ?? ""))
          patch.last_name = last_name;
        if (typeof isAffecte === "boolean") patch.is_affecte = isAffecte;
        if (typeof isBoarder === "boolean") patch.is_boarder = isBoarder;

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
  let targetAcademicYearId: string | null = null;
  let targetAcademicYearStartDate: string | null = null;
  const academicYearEndByCode = new Map<string, string>();
  const targetAcademicYear = String((cls as any).academic_year || "").trim();

  if (targetAcademicYear) {
    const [sameYearResult, academicYearsResult] = await Promise.all([
      srv
        .from("classes")
        .select("id")
        .eq("institution_id", inst)
        .eq("academic_year", targetAcademicYear),
      srv
        .from("academic_years")
        .select("id,code,start_date,end_date")
        .eq("institution_id", inst),
    ]);

    if (sameYearResult.error) {
      await rollbackPreparedStudent();
      return NextResponse.json(
        { error: sameYearResult.error.message },
        { status: 400 },
      );
    }
    if (academicYearsResult.error) {
      await rollbackPreparedStudent();
      return NextResponse.json(
        { error: academicYearsResult.error.message },
        { status: 400 },
      );
    }

    sameYearClassIds = (sameYearResult.data ?? [])
      .map((row: any) => String(row.id))
      .filter(Boolean);

    for (const row of academicYearsResult.data ?? []) {
      const code = String((row as any).code || "").trim();
      const endDate = String((row as any).end_date || "").trim();
      if (code && endDate) academicYearEndByCode.set(code, endDate);
      if (code === targetAcademicYear) {
        targetAcademicYearId = String((row as any).id || "").trim() || null;
        targetAcademicYearStartDate =
          String((row as any).start_date || "").trim() || null;
      }
    }
  }

  // Une fiche élève est stable entre les années scolaires. Pour l'inscription,
  // il faut donc clôturer TOUTE ancienne inscription encore active, y compris
  // celle de l'année précédente. En revanche, la finance ne se transfère que
  // lors d'un changement de classe dans la même année scolaire.
  const { data: sourceEnrollments, error: sourceEnrollmentErr } = await srv
    .from("class_enrollments")
    .select("id,class_id,start_date,end_date,classes:class_id(academic_year)")
    .eq("institution_id", inst)
    .eq("student_id", studentId)
    .neq("class_id", class_id)
    .is("end_date", null);

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
        .filter((row: any) => {
          const relation = (row as any).classes;
          const sourceYear = String(
            (Array.isArray(relation) ? relation[0] : relation)?.academic_year ||
              "",
          ).trim();
          return sourceYear === targetAcademicYear;
        })
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
    (row: any) => {
      const relation = (row as any).classes;
      const sourceAcademicYear = String(
        (Array.isArray(relation) ? relation[0] : relation)?.academic_year || "",
      ).trim();
      const priorYearEndDate =
        sourceAcademicYear && sourceAcademicYear !== targetAcademicYear
          ? academicYearEndByCode.get(sourceAcademicYear) || null
          : null;

      return {
        id: String(row.id),
        end_date: row.end_date ?? null,
        close_end_date: priorYearEndDate || today,
      };
    },
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
      const groupedByCloseDate = new Map<string, string[]>();
      for (const snapshot of sourceEnrollmentSnapshots) {
        const closeDate = snapshot.close_end_date || today;
        groupedByCloseDate.set(closeDate, [
          ...(groupedByCloseDate.get(closeDate) ?? []),
          snapshot.id,
        ]);
      }

      for (const [closeDate, enrollmentIds] of groupedByCloseDate) {
        const { data: oldClosed, error: oldErr } = await srv
          .from("class_enrollments")
          .update({ end_date: closeDate })
          .eq("institution_id", inst)
          .in("id", enrollmentIds)
          .select("id");

        if (oldErr) throw new Error(oldErr.message);
        closedCount += (oldClosed ?? []).length;
      }
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
            start_date: targetAcademicYearStartDate || today,
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


  if (targetAcademicYearId) {
    const { data: finalStudent, error: finalStudentError } = await srv
      .from("students")
      .select("id,is_affecte,is_boarder")
      .eq("institution_id", inst)
      .eq("id", studentId)
      .maybeSingle();

    if (finalStudentError) {
      await Promise.allSettled([
        rollbackEnrollment(),
        financeTransfer.rollback(),
        rollbackPreparedStudent(),
      ]);
      return NextResponse.json(
        {
          error: finalStudentError.message,
          code: "student_year_profile_prepare_failed",
        },
        { status: 409 },
      );
    }

    if (finalStudent) {
      const affecte =
        typeof (finalStudent as any).is_affecte === "boolean"
          ? (finalStudent as any).is_affecte
          : null;
      const boarder =
        typeof (finalStudent as any).is_boarder === "boolean"
          ? (finalStudent as any).is_boarder
          : null;

      const { error: yearProfileError } = await srv
        .from("student_year_profiles")
        .upsert(
          {
            institution_id: inst,
            academic_year_id: targetAcademicYearId,
            academic_year: targetAcademicYear,
            student_id: studentId,
            class_id,
            level: String((cls as any).level || (cls as any).label || "unknown"),
            is_boarder: boarder === true,
            boarding_status_raw:
              boarder === null ? "unknown" : boarder ? "interne" : "externe",
            affectation_status:
              affecte === null ? "unknown" : affecte ? "affecte" : "non_affecte",
            affectation_status_raw:
              affecte === null ? "unknown" : affecte ? "affecte" : "non_affecte",
            billing_affectation_group:
              affecte === null ? "unknown" : affecte ? "affecte" : "non_affecte",
            scholarship_status: "unknown",
            source: "enrollment_assign",
            source_payload: { class_id },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "institution_id,academic_year_id,student_id" },
        );

      if (yearProfileError) {
        await Promise.allSettled([
          rollbackEnrollment(),
          financeTransfer.rollback(),
          rollbackPreparedStudent(),
        ]);
        return NextResponse.json(
          {
            error: yearProfileError.message,
            code: "student_year_profile_write_failed",
          },
          { status: 409 },
        );
      }
    }
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
