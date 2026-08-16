import { NextResponse } from "next/server";
import {
  getCurrentAcademicYearCode,
  requireTeacherTextbook,
} from "@/lib/textbook/context";
import { syncTextbookAssignmentsFromTeaching } from "@/lib/textbook/auto-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireTeacherTextbook();
  if (!auth.ok) return auth.response;

  const { srv, institutionId, userId } = auth.ctx;
  const academicYear = await getCurrentAcademicYearCode(srv, institutionId);

  try {
    const result = await syncTextbookAssignmentsFromTeaching({
      srv,
      institutionId,
      userId,
      academicYear,
    });

    return NextResponse.json({
      ok: true,
      academic_year: academicYear,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "textbook_auto_assignment_failed",
      },
      { status: 400 },
    );
  }
}
