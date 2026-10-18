import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { classComponentContext, isProgramComponentLevel, type SubjectComponent } from "@/lib/school-subject-components";
import { sameSchoolLevel } from "@/lib/school-levels";
import { schoolSettingsRevision } from "@/lib/school-settings-write";
import { readFrancoArabicReportsForEditing } from "@/lib/franco-arabic-reporting";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stableId(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

/** Null delegates ordinary schools to their unchanged historical handler. */
export async function scopedSubjectComponents(req: NextRequest, service: SupabaseClient,
  institutionId: string, body?: Record<string, unknown>): Promise<NextResponse | null> {
  const school = await service.from("institutions").select("settings_json").eq("id", institutionId).maybeSingle();
  if (school.error || !school.data) return json({ error: "school_unavailable" }, 503);
  const settings = school.data.settings_json;
  if (!parseSchoolCyclesSettings(settings).enabled) return null;
  const read = req.method === "GET";
  const values = read ? Object.fromEntries(req.nextUrl.searchParams) : body || {};
  const classId = String(values.class_id || ""), subjectId = String(values.subject_id || "");
  // Unscoped read remains available for the legacy settings bootstrap only.
  if (read && !classId) return null;
  if (!UUID.test(classId) || !UUID.test(subjectId)) return json({ error: "class_and_subject_required" }, 400);
  const cls = await service.from("classes").select("id,level,academic_year")
    .eq("id", classId).eq("institution_id", institutionId).maybeSingle();
  if (cls.error) return json({ error: "class_unavailable" }, 503);
  if (!cls.data) return json({ error: "class_not_found" }, 404);
  const context = classComponentContext(settings, cls.data, subjectId);
  if (typeof context === "string" || context.cycle !== "secondary") return json({ error: "class_subject_program_invalid" }, 409);
  if (values.cycle !== context.cycle || values.track !== context.track ||
      !sameSchoolLevel(String(values.level || ""), context.level, context.cycle))
    return json({ error: "class_context_changed_reload_required" }, 409);
  const activeSubject = await service.from("institution_subjects").select("subject_id")
    .eq("institution_id", institutionId).eq("subject_id", subjectId).eq("is_active", true).maybeSingle();
  if (activeSubject.error || !activeSubject.data) return json({ error: "subject_outside_institution" }, 403);
  const rows = await service.from("grade_subject_components")
    .select("id,subject_id,level,code,label,short_label,coeff_in_subject,order_index,is_active")
    .eq("institution_id", institutionId).eq("subject_id", subjectId).order("id").limit(2001);
  if (rows.error || !rows.data || rows.data.length > 2000) return json({ error: "components_unavailable" }, 503);
  // French secondary keeps its exact historical records, including level aliases.
  const current = (rows.data as SubjectComponent[]).filter(row => context.cycle === "secondary" && context.track === "french"
    ? !isProgramComponentLevel(row.level) && !!row.level && sameSchoolLevel(row.level, context.level, context.cycle)
    : row.level === context.storageLevel);
  const revision = schoolSettingsRevision({ settings, rows: current });
  if (read) return json({ ok: true, revision, items: current.filter(row => row.is_active !== false)
    .sort((a,b) => a.order_index - b.order_index).map(row => ({ ...row, level: context.level })) });
  if (values.revision !== revision) return json({ error: "components_changed_reload_required" }, 409);
  const raw = values.items;
  if (!Array.isArray(raw) || raw.length > 50) return json({ error: "invalid_components" }, 400);
  const codes = new Set<string>(), ids = new Set<string>();
  const payload: Array<SubjectComponent & { institution_id: string }> = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.code !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.code) || codes.has(item.code) ||
        typeof item.label !== "string" || !item.label.trim() || item.label.length > 160 ||
        typeof item.coeff_in_subject !== "number" || !Number.isFinite(item.coeff_in_subject) ||
        item.coeff_in_subject <= 0 || item.coeff_in_subject > 100) return json({ error: "invalid_component" }, 400);
    codes.add(item.code);
    const found = item.id ? current.find(row => row.id === item.id) : current.find(row => row.code === item.code);
    if (item.id && !found) return json({ error: "component_outside_program" }, 403);
    const id = found?.id || stableId([institutionId,subjectId,context.storageLevel,item.code].join("|"));
    if (ids.has(id)) return json({ error: "duplicate_component" }, 400);
    ids.add(id);
    payload.push({ id, institution_id: institutionId, subject_id: subjectId,
      level: found?.level || context.storageLevel, code: item.code, label: item.label.trim(),
      short_label: item.label.trim(), coeff_in_subject: item.coeff_in_subject,
      order_index: index + 1, is_active: true });
  }
  if (context.cycle === "secondary" && payload.length) {
    let parent: number | undefined;
    if (context.track === "french") {
      const coefficients = await service.from("institution_subject_coeffs").select("level,coeff")
        .eq("institution_id", institutionId).eq("subject_id", subjectId);
      if (coefficients.error) return json({ error: "coefficients_unavailable" }, 503);
      parent = (coefficients.data || []).find(row => sameSchoolLevel(row.level, context.level, context.cycle))?.coeff;
    } else parent = readFrancoArabicReportsForEditing(settings).coefficients.find(row => row.cycle === context.cycle &&
      row.track === context.track && row.subjectId === subjectId && sameSchoolLevel(row.level, context.level, context.cycle))?.coefficient;
    if (!Number.isFinite(Number(parent)) || Math.abs(payload.reduce((sum,row) => sum + row.coeff_in_subject, 0) - Number(parent)) > .001)
      return json({ error: "Enregistrez le coefficient de la discipline ; la somme des sous-matières doit lui être égale." }, 400);
  }
  // One atomic upsert, preserving IDs/FKs of marked evaluations. Retired rows
  // remain for grade history; never delete another teaching's components.
  const retired = current.filter(row => !ids.has(row.id)).map(row => ({ ...row, institution_id: institutionId, is_active: false }));
  const writes = [...payload, ...retired];
  if (writes.length) {
    const save = await service.from("grade_subject_components").upsert(writes, { onConflict: "id" });
    if (save.error) return json({ error: "components_save_failed" }, 503);
  }
  return json({ ok: true, inserted: payload.length });
}
