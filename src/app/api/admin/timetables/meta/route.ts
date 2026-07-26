// src/app/api/admin/timetables/meta/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  classMatchesEducationScope,
  readEducationScopeFromSearchParams,
  type EducationScopedClass,
} from "@/lib/education-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toClass(row: any): EducationScopedClass & { label: string } {
  return {
    id: String(row.id),
    label: String(row.label || "").trim(),
    level: row.level ? String(row.level) : null,
    education_type: row.education_type ?? null,
    formation_code: row.formation_code ?? null,
    formation_level_code: row.formation_level_code ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }

    const institution_id = me?.institution_id as string | null;
    if (!institution_id) {
      return NextResponse.json(
        {
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 },
      );
    }

    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as string | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "Droits insuffisants pour consulter ces données.",
        },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const scope = readEducationScopeFromSearchParams(url.searchParams);
    const hasExplicitScope = [
      "education_type",
      "formation_code",
      "formation_level_code",
      "level_code",
      "class_id",
      "classId",
    ].some((key) => url.searchParams.has(key));

    const [{ data: classRows, error: classErr }, { data: periods, error: periodErr }] =
      await Promise.all([
        srv
          .from("classes")
          .select(
            "id,label,level,education_type,formation_code,formation_level_code",
          )
          .eq("institution_id", institution_id)
          .order("label", { ascending: true }),
        srv
          .from("institution_periods")
          .select("id,weekday,period_no,start_time,end_time")
          .eq("institution_id", institution_id)
          .order("weekday", { ascending: true })
          .order("period_no", { ascending: true }),
      ]);

    if (classErr) {
      return NextResponse.json(
        { error: "classes_failed", message: classErr.message },
        { status: 400 },
      );
    }
    if (periodErr) {
      return NextResponse.json(
        { error: "periods_failed", message: periodErr.message },
        { status: 400 },
      );
    }

    const allClasses = (classRows || []).map(toClass);
    const scopedClasses = hasExplicitScope
      ? allClasses.filter((row) => classMatchesEducationScope(row, scope))
      : allClasses;
    const scopedClassIds = scopedClasses.map((row) => row.id);

    let subjectIds: string[] | null = null;
    let teacherIds: string[] | null = null;

    if (hasExplicitScope) {
      if (scopedClassIds.length === 0) {
        subjectIds = [];
        teacherIds = [];
      } else {
        const { data: assignments, error: assignmentErr } = await srv
          .from("class_teachers")
          .select("subject_id,teacher_id,class_id,end_date")
          .eq("institution_id", institution_id)
          .in("class_id", scopedClassIds)
          .is("end_date", null);

        if (assignmentErr) {
          return NextResponse.json(
            {
              error: "assignments_failed",
              message: assignmentErr.message,
            },
            { status: 400 },
          );
        }

        subjectIds = Array.from(
          new Set(
            (assignments || [])
              .map((row: any) => String(row.subject_id || ""))
              .filter(Boolean),
          ),
        );
        teacherIds = Array.from(
          new Set(
            (assignments || [])
              .map((row: any) => String(row.teacher_id || ""))
              .filter(Boolean),
          ),
        );
      }
    }

    let subjectQuery = srv
      .from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(name)")
      .eq("institution_id", institution_id)
      .order("custom_name", { ascending: true });

    if (subjectIds !== null) {
      if (subjectIds.length === 0) {
        subjectQuery = subjectQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
      } else {
        subjectQuery = subjectQuery.in("id", subjectIds);
      }
    }

    let teacherQuery = srv
      .from("profiles")
      .select("id,display_name,phone")
      .eq("institution_id", institution_id)
      .order("display_name", { ascending: true });

    if (teacherIds !== null) {
      if (teacherIds.length === 0) {
        teacherQuery = teacherQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
      } else {
        teacherQuery = teacherQuery.in("id", teacherIds);
      }
    }

    const [{ data: subjects, error: subjectErr }, { data: teachers, error: teacherErr }] =
      await Promise.all([subjectQuery, teacherQuery]);

    if (subjectErr) {
      return NextResponse.json(
        { error: "subjects_failed", message: subjectErr.message },
        { status: 400 },
      );
    }
    if (teacherErr) {
      return NextResponse.json(
        { error: "teachers_failed", message: teacherErr.message },
        { status: 400 },
      );
    }

    const outSubjects = (subjects || []).map((row: any) => {
      let baseName = "";
      if (Array.isArray(row.subjects)) {
        baseName = row.subjects[0]?.name || "";
      } else if (row.subjects && typeof row.subjects === "object") {
        baseName = row.subjects.name || "";
      }

      return {
        id: String(row.id),
        label: String(row.custom_name || baseName || "").trim(),
      };
    });

    const outTeachers = (teachers || []).map((row: any) => ({
      id: String(row.id),
      display_name: String(row.display_name || "").trim(),
      phone: row.phone ? String(row.phone) : null,
    }));

    const outPeriods = (periods || []).map((row: any) => ({
      id: String(row.id),
      weekday: typeof row.weekday === "number" ? row.weekday : 0,
      period_no: typeof row.period_no === "number" ? row.period_no : 0,
      start_time: row.start_time ? String(row.start_time) : null,
      end_time: row.end_time ? String(row.end_time) : null,
    }));

    return NextResponse.json({
      allClasses,
      classes: scopedClasses,
      subjects: outSubjects,
      teachers: outTeachers,
      periods: outPeriods,
      scope,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "meta_failed", message: e?.message || "Erreur serveur." },
      { status: 500 },
    );
  }
}
