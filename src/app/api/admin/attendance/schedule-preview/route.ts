import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  classMatchesEducationScope,
  readEducationScopeFromSearchParams,
} from "@/lib/education-scope";
import { isEducationType } from "@/lib/education-organization";
import { schedulePreviewRows, weekdayCodeForDate } from "@/lib/attendance-schedule-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This is only a read-only timetable preview. It NEVER infers whether an
// attendance session has started or whether its receipt reached the cloud.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = String(url.searchParams.get("date") || "");
  const requestedType = String(url.searchParams.get("education_type") || "").trim();
  if (requestedType && requestedType !== "all" && !isEducationType(requestedType)) {
    return NextResponse.json({ error: "bad_education_type" }, { status: 400 });
  }
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + "T12:00:00Z")) ||
      new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile, error: profileError } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.institution_id) {
    return NextResponse.json({ error: "no_institution" }, { status: 403 });
  }
  const institutionId = String(profile.institution_id);
  const { data: roleRows, error: roleError } = await srv
    .from("user_roles").select("role")
    .eq("profile_id", user.id).eq("institution_id", institutionId).limit(10);
  if (roleError || !(roleRows || []).some((r) =>
    r.role === "admin" || r.role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: periods, error: periodsError } = await srv
    .from("institution_periods").select("id,weekday,label,start_time,end_time")
    .eq("institution_id", institutionId).order("start_time").limit(200);
  if (periodsError) {
    return NextResponse.json({ error: "schedule_unavailable" }, { status: 503 });
  }
  const weekday = weekdayCodeForDate(date, periods || []);
  const todaysPeriods = (periods || []).filter((period: any) =>
    Number(period.weekday) === weekday);
  if (todaysPeriods.length === 0) {
    return NextResponse.json({ rows: [], date, monitor_verified: false },
      { headers: { "Cache-Control": "no-store" } });
  }
  const periodIds = todaysPeriods.map((p: any) => String(p.id));
  const [ttResult, classResult, teacherResult, subjectResult, yearResult] = await Promise.all([
    srv.from("teacher_timetables")
      .select("id,class_id,subject_id,teacher_id,period_id")
      .eq("institution_id", institutionId).in("period_id", periodIds).limit(5000),
    srv.from("classes")
      .select("id,label,level,academic_year,education_type,formation_code,formation_level_code")
      .eq("institution_id", institutionId).limit(2500),
    srv.from("profiles")
      .select("id,display_name,email,phone")
      .eq("institution_id", institutionId).limit(2500),
    srv.from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(id,name)")
      .eq("institution_id", institutionId).limit(2500),
    srv.from("academic_years")
      .select("code").eq("institution_id", institutionId).eq("is_current", true).limit(1),
  ]);
  if (ttResult.error || classResult.error || teacherResult.error ||
      subjectResult.error || yearResult.error) {
    return NextResponse.json({ error: "schedule_unavailable" }, { status: 503 });
  }

  const scope = readEducationScopeFromSearchParams(url.searchParams);
  const currentYear = String(yearResult.data?.[0]?.code || "");
  const matchingClasses = (classResult.data || []).filter((row: any) =>
    (!currentYear || String(row.academic_year || "") === currentYear) &&
    classMatchesEducationScope(row, scope));
  const rows = schedulePreviewRows({
    date,
    periods: todaysPeriods,
    timetables: ttResult.data || [],
    classes: matchingClasses,
    teachers: teacherResult.data || [],
    subjects: subjectResult.data || [],
  });
  return NextResponse.json({ rows, date, monitor_verified: false }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
