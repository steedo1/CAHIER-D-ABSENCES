import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { prepareSchoolTeachingImport, type TeachingImportCatalog, type TeachingImportRow } from "@/lib/school-teaching-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

async function pages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; from < 20000; from += 500) {
    const page = await read(from, from + 499);
    if (page.error || !page.data) throw new Error("catalog_load_failed");
    result.push(...page.data);
    if (page.data.length < 500) return result;
  }
  throw new Error("catalog_too_large");
}

/** Simulation only. There is deliberately no apply endpoint or database write. */
export async function POST(req: NextRequest) {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) return reply({ error: access.error }, access.error === "unauthorized" ? 401 : 403);
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return reply({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return reply({ error: "expected_json" }, 415);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) return reply({ error: "import_too_large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "invalid_import" }, 400);
  const rows = (body as Record<string, unknown>).rows;
  const allowedKeys = new Set(["teacherId", "teacherName", "subjectId", "subjectName", "classId", "classLabel", "track"]);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || rows.some(row =>
    !row || typeof row !== "object" || Array.isArray(row) || Object.entries(row).some(([key, value]) =>
      !allowedKeys.has(key) || typeof value !== "string" || value.length > 200))) {
    return reply({ error: "invalid_import_rows" }, 400);
  }
  const institutionId = access.instId;
  const school = await service.from("institutions").select("settings_json").eq("id", institutionId).maybeSingle();
  if (school.error || !school.data) return reply({ error: "school_load_failed" }, 503);
  const settings = parseSchoolCyclesSettings(school.data.settings_json);
  if (!settings.enabled) return reply({ error: "school_cycles_not_enabled" }, 409);
  const year = await service.from("academic_years").select("code").eq("institution_id", institutionId)
    .eq("is_current", true).order("start_date", { ascending: false }).limit(1).maybeSingle();
  if (year.error) return reply({ error: "academic_year_load_failed" }, 503);
  if (!year.data?.code) return reply({ error: "academic_year_required" }, 409);
  const academicYear = year.data.code;
  try {
    const [classes, subjects, teacherRoles] = await Promise.all([
      pages<TeachingImportCatalog["classes"][number]>((from, to) => service.from("classes").select("id,label,level")
        .eq("institution_id", institutionId).eq("academic_year", academicYear).order("id").range(from, to)),
      pages<{ id: string; subject_id: string; custom_name: string | null }>((from, to) => service.from("institution_subjects")
        .select("id,subject_id,custom_name").eq("institution_id", institutionId).eq("is_active", true).order("id").range(from, to)),
      pages<{ profile_id: string }>((from, to) => service.from("user_roles").select("profile_id")
        .eq("institution_id", institutionId).eq("role", "teacher").order("profile_id").range(from, to)),
    ]);
    const teacherIds = [...new Set(teacherRoles.map(row => row.profile_id))];
    const teachers: TeachingImportCatalog["teachers"] = [];
    for (let offset = 0; offset < teacherIds.length; offset += 40) {
      const result = await service.from("profiles").select("id,display_name").eq("institution_id", institutionId)
        .in("id", teacherIds.slice(offset, offset + 40)).limit(40);
      if (result.error) throw new Error("catalog_load_failed");
      teachers.push(...(result.data || []).map(row => ({ id: row.id, name: row.display_name || "" })));
    }
    const names = new Map<string, string>();
    const subjectIds = [...new Set(subjects.map(row => row.subject_id))];
    for (let offset = 0; offset < subjectIds.length; offset += 40) {
      const result = await service.from("subjects").select("id,name").in("id", subjectIds.slice(offset, offset + 40)).limit(40);
      if (result.error) throw new Error("catalog_load_failed");
      for (const row of result.data || []) names.set(row.id, row.name);
    }
    const assignments: TeachingImportCatalog["assignments"] = [];
    for (let offset = 0; offset < classes.length; offset += 40) {
      const classIds = classes.slice(offset, offset + 40).map(row => row.id);
      assignments.push(...await pages<TeachingImportCatalog["assignments"][number]>((from, to) => service.from("class_teachers")
        .select("class_id,teacher_id,subject_id").eq("institution_id", institutionId).in("class_id", classIds)
        .is("end_date", null).order("id").range(from, to)));
    }
    const plan = prepareSchoolTeachingImport(rows as TeachingImportRow[], settings, {
      classes, teachers, assignments,
      subjects: subjects.map(row => ({ id: row.subject_id, institutionSubjectId: row.id, name: row.custom_name || names.get(row.subject_id) || "" })),
    });
    return reply({ ok: true, academicYear, ...plan });
  } catch {
    return reply({ error: "import_catalog_unavailable" }, 503);
  }
}
