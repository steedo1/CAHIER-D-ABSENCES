import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { safeEnrollmentEndDate } from "@/lib/student-class-membership";
import {
  synchronizeStudentFinance,
  type AppliedStudentFinanceSynchronization,
} from "@/lib/finance/student-finance-sync";
import type { FinanceStudentProfileLike } from "@/lib/finance/charge-rules";

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

export type StudentSeriesTargetClass = {
  id: string;
  institution_id?: string | null;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
  official_track_code?: string | null;
};

type EnrollmentSnapshot = {
  id: string;
  institution_id: string;
  class_id: string;
  student_id: string;
  start_date: string | null;
  end_date: string | null;
  official_track_code: string | null;
};

export type AppliedStudentSeriesClassTransfer = {
  moved: true;
  finance: AppliedStudentFinanceSynchronization;
  rollback: () => Promise<void>;
};

function cleanId(value: unknown) {
  return String(value ?? "").trim();
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export async function transferStudentToSeriesClass({
  srv = getSupabaseServiceClient(),
  institutionId,
  userId,
  studentId,
  sourceClassId,
  targetClass,
  officialTrackCode,
  studentProfile,
}: {
  srv?: ServiceClient;
  institutionId: string;
  userId: string | null;
  studentId: string;
  sourceClassId: string;
  targetClass: StudentSeriesTargetClass;
  officialTrackCode: string | null;
  studentProfile?: FinanceStudentProfileLike | null;
}): Promise<AppliedStudentSeriesClassTransfer> {
  const sourceId = cleanId(sourceClassId);
  const targetId = cleanId(targetClass.id);

  if (!sourceId || !targetId || sourceId === targetId) {
    throw new Error("Le transfert de série exige deux classes distinctes.");
  }

  const [sourceResult, targetResult] = await Promise.all([
    srv
      .from("class_enrollments")
      .select(
        "id,institution_id,class_id,student_id,start_date,end_date,official_track_code",
      )
      .eq("institution_id", institutionId)
      .eq("student_id", studentId)
      .eq("class_id", sourceId)
      .is("end_date", null)
      .maybeSingle(),
    srv
      .from("class_enrollments")
      .select(
        "id,institution_id,class_id,student_id,start_date,end_date,official_track_code",
      )
      .eq("institution_id", institutionId)
      .eq("student_id", studentId)
      .eq("class_id", targetId)
      .maybeSingle(),
  ]);

  if (sourceResult.error) throw new Error(sourceResult.error.message);
  if (targetResult.error) throw new Error(targetResult.error.message);
  if (!sourceResult.data) {
    throw new Error(
      "L’inscription active de l’élève dans la classe source est introuvable.",
    );
  }

  const sourceSnapshot = sourceResult.data as EnrollmentSnapshot;
  const targetSnapshot =
    (targetResult.data as EnrollmentSnapshot | null) ?? null;
  const today = isoToday();
  const effectiveTransferDate = safeEnrollmentEndDate(
    sourceSnapshot.start_date,
    today,
  );
  let targetInserted = false;
  let finance: AppliedStudentFinanceSynchronization | null = null;
  let rolledBack = false;

  const rollbackEnrollments = async () => {
    if (targetSnapshot) {
      await srv
        .from("class_enrollments")
        .update({
          start_date: targetSnapshot.start_date,
          end_date: targetSnapshot.end_date,
          official_track_code: targetSnapshot.official_track_code,
        } as any)
        .eq("id", targetSnapshot.id)
        .eq("institution_id", institutionId);
    } else if (targetInserted) {
      await srv
        .from("class_enrollments")
        .delete()
        .eq("institution_id", institutionId)
        .eq("student_id", studentId)
        .eq("class_id", targetId);
    }

    await srv
      .from("class_enrollments")
      .update({
        start_date: sourceSnapshot.start_date,
        end_date: sourceSnapshot.end_date,
        official_track_code: sourceSnapshot.official_track_code,
      } as any)
      .eq("id", sourceSnapshot.id)
      .eq("institution_id", institutionId);
  };

  const rollback = async () => {
    if (rolledBack) return;
    await rollbackEnrollments();
    if (finance) await finance.rollback();
    rolledBack = true;
  };

  try {
    finance = await synchronizeStudentFinance({
      srv,
      institutionId,
      userId,
      studentId,
      sourceClassIds: [sourceId],
      targetClass: {
        ...targetClass,
        id: targetId,
        institution_id: institutionId,
      },
      studentProfile,
    });

    const { data: closedSource, error: closeError } = await srv
      .from("class_enrollments")
      .update({ end_date: effectiveTransferDate } as any)
      .eq("id", sourceSnapshot.id)
      .eq("institution_id", institutionId)
      .is("end_date", null)
      .select("id");

    if (closeError) throw new Error(closeError.message);
    if ((closedSource ?? []).length !== 1) {
      throw new Error("La classe source de l’élève n’a pas pu être clôturée.");
    }

    if (targetSnapshot) {
      const { data: reactivatedTarget, error: targetError } = await srv
        .from("class_enrollments")
        .update({
          end_date: null,
          official_track_code: officialTrackCode,
        } as any)
        .eq("id", targetSnapshot.id)
        .eq("institution_id", institutionId)
        .select("id");

      if (targetError) throw new Error(targetError.message);
      if ((reactivatedTarget ?? []).length !== 1) {
        throw new Error(
          "L’inscription dans la classe cible n’a pas pu être réactivée.",
        );
      }
    } else {
      const { data: insertedTarget, error: targetError } = await srv
        .from("class_enrollments")
        .insert({
          institution_id: institutionId,
          class_id: targetId,
          student_id: studentId,
          start_date: effectiveTransferDate,
          end_date: null,
          official_track_code: officialTrackCode,
        } as any)
        .select("id");

      if (targetError) throw new Error(targetError.message);
      targetInserted = (insertedTarget ?? []).length === 1;
      if (!targetInserted) {
        throw new Error(
          "L’inscription dans la classe cible n’a pas pu être créée.",
        );
      }
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  return {
    moved: true,
    finance: finance!,
    rollback,
  };
}
