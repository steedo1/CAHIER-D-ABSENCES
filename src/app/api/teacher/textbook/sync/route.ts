import { NextRequest, NextResponse } from "next/server";
import {
  cleanText,
  getCurrentAcademicYearCode,
  requireTeacherTextbook,
} from "@/lib/textbook/context";
import { syncTextbookAssignmentsFromTeaching } from "@/lib/textbook/auto-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uniqYears(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));
}

export async function POST(req: NextRequest) {
  const auth = await requireTeacherTextbook();
  if (!auth.ok) return auth.response;

  const { srv, institutionId, userId } = auth.ctx;
  const body = await req.json().catch(() => ({}));
  const requestedAcademicYear = cleanText(body.academic_year, 30);
  const currentAcademicYear = await getCurrentAcademicYearCode(
    srv,
    institutionId,
  );
  const academicYear = requestedAcademicYear || currentAcademicYear;

  try {
    const result = await syncTextbookAssignmentsFromTeaching({
      srv,
      institutionId,
      userId,
      academicYear,
    });

    const [{ data: progressionYears }, { data: classYears }] =
      await Promise.all([
        srv
          .from("textbook_progression_templates")
          .select("academic_year")
          .eq("institution_id", institutionId)
          .eq("scope", "school")
          .eq("status", "active"),
        srv
          .from("classes")
          .select("academic_year")
          .eq("institution_id", institutionId),
      ]);

    const academicYears = uniqYears([
      academicYear,
      ...((progressionYears || []) as any[]).map((row) => row?.academic_year),
      ...((classYears || []) as any[]).map((row) => row?.academic_year),
    ]);

    return NextResponse.json({
      ok: true,
      academic_year: academicYear,
      academic_years: academicYears,
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
