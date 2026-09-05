// src/app/api/admin/timetables/manual/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  classMatchesEducationScope,
  getEducationScopeWriteError,
  readEducationScopeFromRecord,
  readEducationScopeFromSearchParams,
  type EducationScopeValue,
  type EducationScopedClass,
} from "@/lib/education-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualItem = {
  weekday: number;
  period_id: string;
  class_ids: string[];
};

type ClearSlot = {
  weekday: number;
  period_id: string;
  class_id: string;
};

type ManualBody = {
  subject_id?: string;
  teacher_id?: string;
  items?: ManualItem[];
  clear_slots?: ClearSlot[];
  education_type?: unknown;
  formation_code?: unknown;
  formation_level_code?: unknown;
  level_code?: unknown;
  class_id?: unknown;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function asIntWeekday(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(6, Math.floor(n)));
}

function toScopedClass(row: any): EducationScopedClass & { label: string } {
  return {
    id: String(row.id),
    label: String(row.label || ""),
    level: row.level ? String(row.level) : null,
    education_type: row.education_type ?? null,
    formation_code: row.formation_code ?? null,
    formation_level_code: row.formation_level_code ?? null,
  };
}

async function guard(_req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    console.warn("[timetables/manual] auth_getUser_err", {
      error: userErr.message,
    });
  }
  if (!user) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: meErr.message }, { status: 400 }),
    };
  }

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
        { status: 400 },
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  if (roleErr) {
    console.error("[timetables/manual] role_err", {
      error: roleErr.message,
    });
  }

  const role = (roleRow?.role as string | undefined) || "";
  if (!["admin", "super_admin", "file_correspondent"].includes(role)) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id as string,
    institution_id,
  };
}

async function loadScopedClasses(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  scope: EducationScopeValue,
) {
  const { data: currentYear, error: currentYearError } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentYearError) {
    return { rows: [], activeRows: [], academicYear: null, error: currentYearError };
  }

  let academicYear = currentYear?.code ? String(currentYear.code) : "";
  if (!academicYear) {
    const { data: latestYear, error: latestYearError } = await srv
      .from("academic_years")
      .select("code")
      .eq("institution_id", institutionId)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestYearError) {
      return { rows: [], activeRows: [], academicYear: null, error: latestYearError };
    }
    academicYear = latestYear?.code ? String(latestYear.code) : "";
  }

  if (!academicYear) {
    throw new Error("Année scolaire active introuvable pour cet établissement.");
  }

  const { data, error } = await srv
    .from("classes")
    .select(
      "id,label,level,education_type,formation_code,formation_level_code",
    )
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear);

  if (error) return { rows: [], activeRows: [], academicYear, error };

  const activeRows = (data || []).map(toScopedClass);
  const rows = activeRows.filter((row) =>
    classMatchesEducationScope(row, scope),
  );

  return { rows, activeRows, academicYear, error: null };
}

/**
 * GET = métadonnées pour l'édition manuelle d'un emploi du temps.
 * Le périmètre pédagogique est obligatoire afin qu'une matière, un professeur
 * ou une classe d'une autre formation ne soit jamais mélangé au tableau actif.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guard(req);
    if (!g.ok) return g.res;
    const { srv, institution_id } = g;

    const url = new URL(req.url);
    const subject_id = (url.searchParams.get("subject_id") || "").trim();
    const teacher_id = (url.searchParams.get("teacher_id") || "").trim();
    const scope = readEducationScopeFromSearchParams(url.searchParams);
    const scopeError = getEducationScopeWriteError(scope);

    if (scopeError) {
      return NextResponse.json(
        { error: "invalid_education_scope", message: scopeError },
        { status: 400 },
      );
    }

    if (!subject_id) {
      return NextResponse.json(
        { error: "missing_subject", message: "subject_id manquant." },
        { status: 400 },
      );
    }

    const scoped = await loadScopedClasses(srv, institution_id, scope);
    if (scoped.error) {
      return NextResponse.json(
        { error: "classes_failed", message: scoped.error.message },
        { status: 400 },
      );
    }

    const classIds = scoped.rows.map((row) => row.id);
    const classesById = new Map(
      scoped.rows.map((row) => [row.id, String(row.label || "")]),
    );

    if (classIds.length === 0) {
      return NextResponse.json({
        subject_id,
        teachers: [],
        teacherClasses: [],
        existing: [],
        occupancy: [],
        teacherOccupancy: [],
        scope,
      });
    }

    const { data: ctRows, error: ctErr } = await srv
      .from("class_teachers")
      .select("teacher_id,class_id,end_date")
      .eq("institution_id", institution_id)
      .eq("subject_id", subject_id)
      .in("class_id", classIds)
      .is("end_date", null);

    if (ctErr) {
      return NextResponse.json(
        { error: "class_teachers_failed", message: ctErr.message },
        { status: 400 },
      );
    }

    const teacherIds = uniq(
      (ctRows || []).map((row: any) => String(row.teacher_id)),
    );

    let teachers: {
      id: string;
      display_name: string;
      phone: string | null;
    }[] = [];

    if (teacherIds.length > 0) {
      const { data: teacherProfiles, error: tpErr } = await srv
        .from("profiles")
        .select("id,display_name,phone")
        .in("id", teacherIds);

      if (tpErr) {
        return NextResponse.json(
          { error: "teachers_failed", message: tpErr.message },
          { status: 400 },
        );
      }

      teachers = (teacherProfiles || [])
        .map((row: any) => ({
          id: String(row.id),
          display_name: String(row.display_name || "(Sans nom)"),
          phone: row.phone ? String(row.phone) : null,
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name, "fr"));
    }

    const seenTC = new Set<string>();
    const teacherClasses = (ctRows || [])
      .map((row: any) => ({
        teacher_id: String(row.teacher_id),
        class_id: String(row.class_id),
        class_label: classesById.get(String(row.class_id)) || "",
      }))
      .filter((row) => {
        const key = `${row.teacher_id}::${row.class_id}`;
        if (seenTC.has(key)) return false;
        seenTC.add(key);
        return true;
      });

    const { data: scopedTimetableRows, error: occupancyErr } = await srv
      .from("teacher_timetables")
      .select("weekday,period_id,class_id,teacher_id,subject_id")
      .eq("institution_id", institution_id)
      .in("class_id", classIds);

    if (occupancyErr) {
      return NextResponse.json(
        { error: "occupancy_failed", message: occupancyErr.message },
        { status: 400 },
      );
    }

    const occupancy = (scopedTimetableRows || []).map((row: any) => ({
      weekday: Number(row.weekday),
      period_id: String(row.period_id),
      class_id: String(row.class_id),
      class_label: classesById.get(String(row.class_id)) || "",
      teacher_id: String(row.teacher_id),
      subject_id: String(row.subject_id),
    }));

    const existing = teacher_id
      ? occupancy.filter(
          (row) =>
            row.teacher_id === teacher_id && row.subject_id === subject_id,
        )
      : [];

    let teacherOccupancy: Array<{
      weekday: number;
      period_id: string;
      class_id: string;
      class_label: string;
      teacher_id: string;
      subject_id: string;
    }> = [];

    if (teacher_id) {
      const { data: teacherTimetableRows, error: teacherTimetableErr } =
        await srv
          .from("teacher_timetables")
          .select("weekday,period_id,class_id,teacher_id,subject_id")
          .eq("institution_id", institution_id)
          .eq("teacher_id", teacher_id)
          .in(
            "class_id",
            scoped.activeRows.map((row) => row.id),
          );

      if (teacherTimetableErr) {
        return NextResponse.json(
          {
            error: "teacher_occupancy_failed",
            message: teacherTimetableErr.message,
          },
          { status: 400 },
        );
      }

      const teacherClassesById = new Map(classesById);
      const missingClassIds = uniq(
        (teacherTimetableRows || [])
          .map((row: any) => String(row.class_id || ""))
          .filter((classId) => classId && !teacherClassesById.has(classId)),
      );

      if (missingClassIds.length > 0) {
        const { data: otherClasses, error: otherClassesErr } = await srv
          .from("classes")
          .select("id,label")
          .eq("institution_id", institution_id)
          .in("id", missingClassIds);

        if (otherClassesErr) {
          return NextResponse.json(
            {
              error: "teacher_occupancy_classes_failed",
              message: otherClassesErr.message,
            },
            { status: 400 },
          );
        }

        for (const row of otherClasses || []) {
          teacherClassesById.set(String(row.id), String(row.label || ""));
        }
      }

      teacherOccupancy = (teacherTimetableRows || []).map((row: any) => ({
        weekday: Number(row.weekday),
        period_id: String(row.period_id),
        class_id: String(row.class_id),
        class_label:
          teacherClassesById.get(String(row.class_id)) || "Autre classe",
        teacher_id: String(row.teacher_id),
        subject_id: String(row.subject_id),
      }));
    }

    return NextResponse.json({
      subject_id,
      teachers,
      teacherClasses,
      existing,
      occupancy,
      teacherOccupancy,
      scope,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "manual_meta_failed" },
      { status: 500 },
    );
  }
}

/**
 * POST = enregistrement de l'emploi du temps d'un professeur et d'une matière
 * dans le seul périmètre pédagogique sélectionné.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await guard(req);
    if (!g.ok) return g.res;
    const { srv, userId, institution_id } = g;

    const body = (await req.json().catch(() => null)) as ManualBody | null;
    if (!body) {
      return NextResponse.json(
        { error: "invalid_body", message: "JSON invalide." },
        { status: 400 },
      );
    }

    const subject_id = String(body.subject_id || "").trim();
    const teacher_id = String(body.teacher_id || "").trim();
    const items = (body.items || []) as ManualItem[];
    const clear_slots = (body.clear_slots || []) as ClearSlot[];
    const scope = readEducationScopeFromRecord(body as Record<string, unknown>);
    const scopeError = getEducationScopeWriteError(scope);

    if (scopeError) {
      return NextResponse.json(
        { error: "invalid_education_scope", message: scopeError },
        { status: 400 },
      );
    }

    if (!subject_id || !teacher_id) {
      return NextResponse.json(
        {
          error: "missing_ids",
          message: "subject_id et teacher_id sont obligatoires.",
        },
        { status: 400 },
      );
    }

    const scoped = await loadScopedClasses(srv, institution_id, scope);
    if (scoped.error) {
      return NextResponse.json(
        { error: "classes_failed", message: scoped.error.message },
        { status: 400 },
      );
    }

    const scopeClassIds = scoped.rows.map((row) => row.id);
    const scopeClassIdSet = new Set(scopeClassIds);

    if (scopeClassIds.length === 0) {
      return NextResponse.json(
        {
          error: "empty_education_scope",
          message: "Aucune classe ne correspond au périmètre sélectionné.",
        },
        { status: 400 },
      );
    }

    const requestedClassIds = uniq([
      ...items.flatMap((item) =>
        (item.class_ids || []).map((value) => String(value || "")).filter(Boolean),
      ),
      ...clear_slots
        .map((slot) => String(slot.class_id || ""))
        .filter(Boolean),
    ]);

    const outsideScope = requestedClassIds.filter(
      (classId) => !scopeClassIdSet.has(classId),
    );
    if (outsideScope.length > 0) {
      return NextResponse.json(
        {
          error: "classes_outside_education_scope",
          message:
            "Certaines classes ne correspondent plus au périmètre pédagogique sélectionné.",
          class_ids: outsideScope.slice(0, 20),
        },
        { status: 400 },
      );
    }

    const insertedClassIds = uniq(
      items.flatMap((item) =>
        (item.class_ids || []).map((value) => String(value || "")).filter(Boolean),
      ),
    );

    if (insertedClassIds.length > 0) {
      const { data: assignments, error: assignmentErr } = await srv
        .from("class_teachers")
        .select("class_id")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id)
        .eq("teacher_id", teacher_id)
        .in("class_id", insertedClassIds)
        .is("end_date", null);

      if (assignmentErr) {
        return NextResponse.json(
          {
            error: "assignment_check_failed",
            message: assignmentErr.message,
          },
          { status: 400 },
        );
      }

      const assignedClassIds = new Set(
        (assignments || []).map((row: any) => String(row.class_id)),
      );
      const notAssigned = insertedClassIds.filter(
        (classId) => !assignedClassIds.has(classId),
      );

      if (notAssigned.length > 0) {
        return NextResponse.json(
          {
            error: "teacher_not_assigned_in_scope",
            message:
              "L'enseignant n'est pas affecté à cette matière dans certaines classes sélectionnées.",
            class_ids: notAssigned.slice(0, 20),
          },
          { status: 400 },
        );
      }
    }

    for (const slot of clear_slots) {
      const class_id = String(slot.class_id || "");
      const period_id = String(slot.period_id || "");
      if (!class_id || !period_id) continue;

      const { error: delSlotErr } = await srv
        .from("teacher_timetables")
        .delete()
        .match({
          institution_id,
          subject_id,
          teacher_id,
          class_id,
          period_id,
        });

      if (delSlotErr) {
        return NextResponse.json(
          {
            error: "clear_slot_failed",
            message: delSlotErr.message,
            slot: { class_id, period_id },
          },
          { status: 400 },
        );
      }
    }

    const periodIds = uniq(
      items
        .map((item) => String(item.period_id || ""))
        .filter((value) => value.length > 0),
    );
    const periodWeekdayById = new Map<string, number>();

    if (periodIds.length > 0) {
      const { data: periods, error: perErr } = await srv
        .from("institution_periods")
        .select("id,weekday")
        .eq("institution_id", institution_id)
        .in("id", periodIds);

      if (perErr) {
        return NextResponse.json(
          { error: "periods_fetch_failed", message: perErr.message },
          { status: 400 },
        );
      }

      (periods || []).forEach((row: any) => {
        const periodId = String(row.id);
        const weekday = asIntWeekday(row.weekday);
        if (weekday !== null) periodWeekdayById.set(periodId, weekday);
      });

      const missing = periodIds.filter(
        (periodId) => !periodWeekdayById.has(periodId),
      );
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: "unknown_periods",
            message:
              "Certains period_id ne correspondent à aucun créneau de cet établissement.",
            period_ids: missing.slice(0, 20),
          },
          { status: 400 },
        );
      }
    }

    // Le nettoyage est volontairement limité aux classes du périmètre actif.
    // Un professeur intervenant dans plusieurs formations conserve donc les
    // emplois du temps enregistrés dans ses autres contextes pédagogiques.
    const { error: delErr } = await srv
      .from("teacher_timetables")
      .delete()
      .match({ institution_id, subject_id, teacher_id })
      .in("class_id", scopeClassIds);

    if (delErr) {
      return NextResponse.json(
        { error: "delete_failed", message: delErr.message },
        { status: 400 },
      );
    }

    const rowsToInsert: any[] = [];
    for (const item of items) {
      if (!item.period_id) continue;

      const weekday =
        periodWeekdayById.get(String(item.period_id)) ??
        asIntWeekday(item.weekday) ??
        0;

      const classIds = uniq(
        (item.class_ids || []).map((value) => String(value || "")),
      );

      for (const class_id of classIds) {
        rowsToInsert.push({
          institution_id,
          teacher_id,
          subject_id,
          class_id,
          period_id: item.period_id,
          weekday,
          updated_by: userId,
        });
      }
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await srv
        .from("teacher_timetables")
        .insert(rowsToInsert);

      if (insErr) {
        return NextResponse.json(
          { error: "insert_failed", message: insErr.message },
          { status: 400 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Emploi du temps enregistré avec succès.",
      inserted: rowsToInsert.length,
      cleared: clear_slots.length,
      scope,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "manual_save_failed" },
      { status: 500 },
    );
  }
}
