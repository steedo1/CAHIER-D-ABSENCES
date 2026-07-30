import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function subjectName(row: any): string {
  const relation = Array.isArray(row?.subjects) ? row.subjects[0] : row?.subjects;
  return String(row?.custom_name || relation?.name || "Matière").trim() || "Matière";
}

function timeValue(value: unknown): string {
  return String(value || "").slice(0, 5);
}

async function resolveAccess(req: NextRequest, studentId: string) {
  const srv = getSupabaseServiceClient();
  const jar = await cookies();
  const deviceId = jar.get("parent_device")?.value || "";

  if (deviceId) {
    const { data: link } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId)
      .eq("student_id", studentId)
      .limit(1);

    if (!link?.length) return { ok: false as const, status: 403, srv };
    return { ok: true as const, srv };
  }

  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));

  if (!user) return { ok: false as const, status: 401, srv };

  const { data: guardian } = await srv
    .from("student_guardians")
    .select("student_id")
    .eq("student_id", studentId)
    .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
    .limit(1);

  if (!guardian?.length) return { ok: false as const, status: 403, srv };
  return { ok: true as const, srv };
}

export async function GET(req: NextRequest) {
  try {
    const studentId = new URL(req.url).searchParams.get("student_id") || "";
    if (!studentId) {
      return NextResponse.json(
        { ok: false, error: "student_id_required" },
        { status: 400 },
      );
    }

    const access = await resolveAccess(req, studentId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.status === 401 ? "unauthorized" : "forbidden" },
        { status: access.status },
      );
    }

    const { srv } = access;
    let { data: enrollment, error: enrollmentError } = await srv
      .from("class_enrollments")
      .select("class_id,institution_id,classes:class_id(label,institution_id,academic_year)")
      .eq("student_id", studentId)
      .is("end_date", null)
      .limit(1)
      .maybeSingle();

    if (enrollmentError) {
      return NextResponse.json(
        { ok: false, error: enrollmentError.message },
        { status: 400 },
      );
    }

    if (!enrollment) {
      const fallback = await srv
        .from("class_enrollments")
        .select("class_id,institution_id,classes:class_id(label,institution_id,academic_year),start_date")
        .eq("student_id", studentId)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      enrollment = fallback.data as any;
      enrollmentError = fallback.error;
    }

    if (enrollmentError) {
      return NextResponse.json(
        { ok: false, error: enrollmentError.message },
        { status: 400 },
      );
    }

    const classId = String((enrollment as any)?.class_id || "");
    const relation = Array.isArray((enrollment as any)?.classes)
      ? (enrollment as any).classes[0]
      : (enrollment as any)?.classes;
    const institutionId = String(
      relation?.institution_id || (enrollment as any)?.institution_id || "",
    );

    if (!classId || !institutionId) {
      return NextResponse.json({ ok: true, items: [], periods: [] });
    }

    const [{ data: timetableRows, error: timetableError }, { data: periodRows, error: periodsError }] =
      await Promise.all([
        srv
          .from("teacher_timetables")
          .select("id,weekday,period_id,subject_id,teacher_id")
          .eq("institution_id", institutionId)
          .eq("class_id", classId),
        srv
          .from("institution_periods")
          .select("id,weekday,period_no,label,start_time,end_time,duration_min")
          .eq("institution_id", institutionId)
          .gte("weekday", 1)
          .lte("weekday", 6)
          .order("weekday", { ascending: true })
          .order("period_no", { ascending: true }),
      ]);

    if (timetableError) {
      return NextResponse.json(
        { ok: false, error: timetableError.message },
        { status: 400 },
      );
    }
    if (periodsError) {
      return NextResponse.json(
        { ok: false, error: periodsError.message },
        { status: 400 },
      );
    }

    const timetable = asArray<any>(timetableRows);
    const periods = asArray<any>(periodRows);
    const periodById = new Map(periods.map((row) => [String(row.id), row]));

    const subjectIds = Array.from(
      new Set(timetable.map((row) => String(row.subject_id || "")).filter(Boolean)),
    );
    const teacherIds = Array.from(
      new Set(timetable.map((row) => String(row.teacher_id || "")).filter(Boolean)),
    );

    const [{ data: subjects }, { data: teachers }] = await Promise.all([
      subjectIds.length
        ? srv
            .from("institution_subjects")
            .select("id,custom_name,subjects:subject_id(name)")
            .in("id", subjectIds)
        : Promise.resolve({ data: [] as any[] }),
      teacherIds.length
        ? srv.from("profiles").select("id,display_name").in("id", teacherIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const subjectById = new Map(
      asArray<any>(subjects).map((row) => [String(row.id), subjectName(row)]),
    );
    const teacherById = new Map(
      asArray<any>(teachers).map((row) => [
        String(row.id),
        String(row.display_name || "Enseignant").trim() || "Enseignant",
      ]),
    );

    const gridPeriods = Array.from(
      new Map(
        periods
          .map((row) => {
            const start = timeValue(row.start_time);
            const end = timeValue(row.end_time);
            if (!start || !end) return null;
            const key = `${start}|${end}`;
            return [
              key,
              {
                key,
                start_time: start,
                end_time: end,
                label: String(row.label || "").trim() || `${start} - ${end}`,
                period_no: Number(row.period_no || 0),
              },
            ] as const;
          })
          .filter(Boolean) as Array<readonly [string, any]>,
      ).values(),
    ).sort((a, b) => a.start_time.localeCompare(b.start_time));

    const items = timetable
      .map((row) => {
        const period = periodById.get(String(row.period_id));
        if (!period) return null;
        const start = timeValue(period.start_time);
        const end = timeValue(period.end_time);
        if (!start || !end) return null;
        const weekday = Number(row.weekday || period.weekday || 0);
        return {
          id: String(row.id),
          weekday,
          period_id: String(row.period_id),
          period_key: `${start}|${end}`,
          start_time: start,
          end_time: end,
          subject_name: subjectById.get(String(row.subject_id)) || "Matière",
          teacher_name: teacherById.get(String(row.teacher_id)) || "Enseignant",
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) =>
        a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
      );

    return NextResponse.json({
      ok: true,
      student_id: studentId,
      class_id: classId,
      class_label: relation?.label || null,
      academic_year: relation?.academic_year || null,
      days: [1, 2, 3, 4, 5, 6],
      periods: gridPeriods,
      items,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
