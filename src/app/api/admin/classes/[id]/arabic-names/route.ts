import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import { loadLinkedClassEnrollments } from "@/lib/server/school-linked-class-roster";
import { isValidWrittenArabicName } from "@/lib/class-list-arabic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const answer = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

/** Update spelling only; never touch French identities, enrollments, notes or finance. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: classId } = await context.params;
  if (!UUID.test(classId)) return answer({ error: "invalid_class_id" }, 400);
  if (request.headers.get("origin") &&
      request.headers.get("origin") !== request.nextUrl.origin) {
    return answer({ error: "invalid_origin" }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return answer({ error: "expected_json" }, 415);
  }
  const service = getSupabaseServiceClient();
  const client = await getSupabaseServerClient();
  const auth = await requireInstitutionRole(client, service, [
    "admin", "super_admin", "founder", "file_correspondent", "finance_manager", "finance",
  ]);
  if ("error" in auth) {
    return answer({ error: auth.error }, auth.error === "unauthorized" ? 401 : 403);
  }

  const [classResult, institutionResult] = await Promise.all([
    service.from("classes").select("id,institution_id,level,academic_year")
      .eq("id", classId).eq("institution_id", auth.instId).maybeSingle(),
    service.from("institutions").select("settings_json").eq("id", auth.instId).maybeSingle(),
  ]);
  if (classResult.error || institutionResult.error || !classResult.data || !institutionResult.data) {
    return answer({ error: "school_or_class_unavailable" }, 404);
  }
  const cls = classResult.data;
  const settings = institutionResult.data.settings_json;
  const tracks = readStudentProgramSettings(settings).years[cls.academic_year]?.classes[classId]?.tracks || [];
  if (tracks.length !== 1 || tracks[0] !== "arabic") {
    return answer({ error: "arabic_class_required" }, 403);
  }

  const body = await request.json().catch(() => null);
  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length > 100) {
    return answer({ error: "invalid_updates" }, 400);
  }
  const changes: Array<{ studentId: string; name: string | null }> = [];
  const seen = new Set<string>();
  for (const row of updates) {
    const studentId = String(row?.student_id ?? "").trim();
    const name = row?.full_name_ar;
    if (!UUID.test(studentId) || seen.has(studentId) ||
        (name !== null && !isValidWrittenArabicName(name))) {
      return answer({ error: "invalid_arabic_name" }, 400);
    }
    seen.add(studentId);
    changes.push({ studentId, name: typeof name === "string" ? name.trim() || null : null });
  }
  if (!changes.length) return answer({ ok: true, updated: 0 });

  let linked;
  try {
    linked = await loadLinkedClassEnrollments(service, auth.instId, cls, settings);
  } catch {
    return answer({ error: "STUDENT_PROGRAM_LINK_STALE" }, 409);
  }
  const { data: direct, error: directError } = await service.from("class_enrollments")
    .select("student_id").eq("institution_id", auth.instId).eq("class_id", classId)
    .is("end_date", null).limit(701);
  if (directError || !direct) return answer({ error: "student_scope_unavailable" }, 503);
  const permitted = new Set([...linked.map(row => row.student_id), ...direct.map(row => row.student_id)]);
  if (changes.some(row => !permitted.has(row.studentId))) {
    return answer({ error: "student_outside_arabic_class" }, 403);
  }

  let updated = 0;
  for (const row of changes) {
    const { data, error } = await service.from("students")
      .update({ full_name_ar: row.name })
      .eq("id", row.studentId).eq("institution_id", auth.instId)
      .select("id").maybeSingle();
    if (error || !data) return answer({ error: error?.message || "arabic_name_save_failed", updated }, 409);
    updated++;
  }
  return answer({ ok: true, updated });
}
