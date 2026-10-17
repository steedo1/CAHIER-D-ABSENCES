import { filterParentConnectStudentIds } from "@/lib/parent-connect/server";
// src/app/api/parent/grading-periods/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  schoolPeriodFormationCode,
  schoolPeriodProgramForClass,
} from "@/lib/school-grading-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function computeAcademicYear(d = new Date()): string {
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function isTrimester(row: any) {
  const raw = [row?.kind, row?.code, row?.label, row?.short_label]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return /trim|trimestre|t[1-3]\b/.test(raw);
}

export async function GET() {
  const srv = getSupabaseServiceClient();

  try {
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    if (!deviceId) return NextResponse.json({ ok: true, items: [] });

    const { data: links, error: linksErr } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId);

    if (linksErr) return NextResponse.json({ ok: false, error: linksErr.message }, { status: 400 });

    const linkedStudentIds = Array.from(
      new Set((links || []).map((row: any) => String(row.student_id || "").trim()).filter(Boolean)),
    );

    const studentIds = await filterParentConnectStudentIds(srv, linkedStudentIds);
    if (!studentIds.length) return NextResponse.json({ ok: true, items: [] });

    const { data: enrollments, error: enrollErr } = await srv
      .from("class_enrollments")
      .select("student_id, class_id, institution_id, classes:class_id(id, institution_id, academic_year, level)")
      .in("student_id", studentIds)
      .is("end_date", null);

    if (enrollErr) return NextResponse.json({ ok: false, error: enrollErr.message }, { status: 400 });

    const computedYear = computeAcademicYear();
    const institutionIds = new Set<string>();
    const yearsByInstitution = new Map<string, Set<string>>();

    for (const row of enrollments || []) {
      const cls = (row as any).classes || null;
      const institutionId = String(cls?.institution_id || (row as any).institution_id || "").trim();
      if (!institutionId) continue;
      const academicYear = String(cls?.academic_year || computedYear).trim() || computedYear;
      institutionIds.add(institutionId);
      if (!yearsByInstitution.has(institutionId)) yearsByInstitution.set(institutionId, new Set<string>());
      yearsByInstitution.get(institutionId)!.add(academicYear);
    }

    const ids = Array.from(institutionIds);
    if (!ids.length) return NextResponse.json({ ok: true, items: [] });

    // A parent's device may cover several schools and programs. Only expose
    // periods of the children's actual, explicitly mapped classes.
    const { data: settingsRows, error: settingsErr } = await srv.from("institutions")
      .select("id,settings_json").in("id", ids);
    if (settingsErr) return NextResponse.json({ ok: false, error: settingsErr.message }, { status: 400 });
    const settingsByInstitution = new Map((settingsRows || []).map(row => [String(row.id), row.settings_json]));
    const allowedPrograms = new Map<string, Set<string>>();
    for (const row of enrollments || []) {
      const cls = (row as any).classes;
      const institutionId = String(cls?.institution_id || (row as any).institution_id || "").trim();
      const academicYear = String(cls?.academic_year || computedYear).trim();
      if (!institutionId || !cls?.id) continue;
      const program = schoolPeriodProgramForClass(
        settingsByInstitution.get(institutionId), academicYear,
        { id: String(cls.id), level: cls.level },
      );
      if (!program) continue;
      const key = `${institutionId}|${academicYear}`;
      if (!allowedPrograms.has(key)) allowedPrograms.set(key, new Set());
      allowedPrograms.get(key)!.add(schoolPeriodFormationCode(program.cycle, program.track));
    }

    const { data: periods, error: periodsErr } = await srv
      .from("grade_periods")
      .select("id, institution_id, academic_year, code, display_code, label, short_label, kind, start_date, end_date, order_index, is_active, coeff, scope_type, formation_code")
      .in("institution_id", ids)
      .eq("is_active", true)
      .order("institution_id", { ascending: true })
      .order("academic_year", { ascending: false })
      .order("order_index", { ascending: true });

    if (periodsErr) return NextResponse.json({ ok: false, error: periodsErr.message }, { status: 400 });

    const items = (periods || [])
      .filter((row: any) => {
        const institutionId = String(row.institution_id || "");
        const year = String(row.academic_year || "");
        const allowedYears = yearsByInstitution.get(institutionId);
        if (allowedYears?.size && !allowedYears.has(year)) return false;
        if (row.scope_type === "formation" &&
            String(row.formation_code || "").startsWith("SCHOOL_PROGRAM_")) {
          return allowedPrograms.get(`${institutionId}|${year}`)?.has(row.formation_code) ?? false;
        }
        return isTrimester(row);
      })
      .map((row: any) => ({
        id: String(row.id),
        institution_id: String(row.institution_id || ""),
        academic_year: String(row.academic_year || ""),
        code: row.display_code || row.code || null,
        label: row.label || row.short_label || row.code || "Trimestre",
        short_label: row.short_label || row.label || row.code || "Trimestre",
        kind: row.kind || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        order_index: Number(row.order_index || 0),
        coeff: row.coeff == null ? null : Number(row.coeff),
      }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
