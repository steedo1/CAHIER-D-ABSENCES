import { isTrustedAppOrigin } from "@/lib/request-origin";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import {
  isSchoolCycle, isTeachingTrack, parseSchoolCyclesSettings,
  type SchoolCycle, type TeachingTrack,
} from "@/lib/school-cycles";
import {
  normalizedSchoolPeriodCode,
  schoolPeriodFormationCode,
  schoolPeriodStoredCode,
} from "@/lib/school-grading-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

type PeriodPayload = {
  id?: string | null;
  code?: string;
  label?: string;
  short_label?: string;
  kind?: string | null;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
  coeff?: number;
};
type Existing = { id: string; code: string; display_code: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^[0-9]{4}-[0-9]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function scope() {
  const browser = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(browser, service, ["admin"]);
  if ("error" in access) return { error: json({ ok: false, error: access.error }, access.error === "unauthorized" ? 401 : 403) } as const;
  const { data, error } = await service.from("institutions").select("settings_json")
    .eq("id", access.instId).maybeSingle();
  if (error || !data) return { error: json({ ok: false, error: "institution_load_failed" }, 503) } as const;
  const school = parseSchoolCyclesSettings(data.settings_json);
  if (!school.enabled) return { error: json({ ok: false, error: "school_programs_not_enabled" }, 404) } as const;
  return { service, school, institutionId: access.instId } as const;
}

function resolvePair(school: ReturnType<typeof parseSchoolCyclesSettings>, cycle: unknown, track: unknown) {
  if (!isSchoolCycle(cycle) || !isTeachingTrack(track) ||
      !school.enabledCycles.includes(cycle) ||
      !school.teachingTracksByCycle[cycle]?.includes(track)) return null;
  return { cycle, track, formationCode: schoolPeriodFormationCode(cycle, track) };
}

async function getRows(
  service: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  year: string,
  formationCode: string,
) {
  return service.from("grade_periods")
    .select("id,code,display_code,label,short_label,kind,start_date,end_date,order_index,is_active,coeff")
    .eq("institution_id", institutionId)
    .eq("academic_year", year)
    .eq("scope_type", "formation")
    .eq("education_type", "general_secondary")
    .eq("formation_code", formationCode)
    .order("order_index", { ascending: true });
}

export async function GET(req: NextRequest) {
  const access = await scope();
  if ("error" in access) return access.error;
  const year = req.nextUrl.searchParams.get("academic_year") || "";
  const pair = resolvePair(access.school, req.nextUrl.searchParams.get("cycle"),
    req.nextUrl.searchParams.get("track"));
  if (!pair || !YEAR.test(year)) return json({ ok: false, error: "invalid_school_period_scope" }, 400);
  const { data, error } = await getRows(access.service, access.institutionId, year, pair.formationCode);
  if (error) return json({ ok: false, error: "periods_load_failed" }, 503);
  return json({ ok: true, academic_year: year, cycle: pair.cycle, track: pair.track,
    items: (data || []).map(row => ({ ...row, code: row.display_code || row.code })) });
}

export async function PUT(req: NextRequest) {
  const access = await scope();
  if ("error" in access) return access.error;
  if (!isTrustedAppOrigin(req)) return json({ ok: false, error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return json({ ok: false, error: "expected_json" }, 415);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  const year = String(body.academic_year || "");
  const pair = resolvePair(access.school, body.cycle, body.track);
  if (!pair || !YEAR.test(year) || !Array.isArray(body.periods) || body.periods.length > 24) {
    return json({ ok: false, error: "invalid_school_period_scope" }, 400);
  }
  const { data: existing, error: existingError } = await getRows(
    access.service, access.institutionId, year, pair.formationCode);
  if (existingError) return json({ ok: false, error: "periods_load_failed" }, 503);
  const known = new Map((existing || []).map(row => [row.id, row]));
  const byCode = new Map((existing || []).map(row =>
    [String(row.display_code || row.code).toUpperCase(), row]));
  const usedIds = new Set<string>();
  const usedCodes = new Set<string>();
  const normalized: Array<{
    keepId: string | null; code: string; display_code: string; label: string;
    short_label: string; kind: string | null; start_date: string; end_date: string;
    order_index: number; is_active: boolean; coeff: number;
  }> = [];
  for (const [idx, raw] of (body.periods as PeriodPayload[]).entries()) {
    if (!raw || typeof raw !== "object") return json({ ok: false, error: "invalid_period" }, 400);
    const displayCode = normalizedSchoolPeriodCode(raw.code);
    const label = String(raw.label || "").trim();
    const shortLabel = String(raw.short_label || "").trim() || label;
    const start = String(raw.start_date || "");
    const end = String(raw.end_date || "");
    if (!displayCode || usedCodes.has(displayCode) || !label || label.length > 120 ||
        !shortLabel || shortLabel.length > 80 ||
        !ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) {
      return json({ ok: false, error: "invalid_period_fields", row: idx + 1 }, 400);
    }
    const incomingId = typeof raw.id === "string" && UUID.test(raw.id) ? raw.id : null;
    if (incomingId && !known.has(incomingId)) {
      return json({ ok: false, error: "foreign_period_id" }, 403);
    }
    const keepId = incomingId || byCode.get(displayCode)?.id || null;
    if (keepId && usedIds.has(keepId)) {
      return json({ ok: false, error: "duplicate_period" }, 400);
    }
    const value = Number(raw.coeff ?? 1);
    if (!Number.isFinite(value) || value < 0 || value > 99) {
      return json({ ok: false, error: "invalid_period_coefficient", row: idx + 1 }, 400);
    }
    usedCodes.add(displayCode);
    if (keepId) usedIds.add(keepId);
    normalized.push({
      keepId,
      code: schoolPeriodStoredCode(pair.cycle, pair.track, displayCode),
      display_code: displayCode,
      label, short_label: shortLabel, kind: String(raw.kind || "").trim().slice(0, 40) || null,
      start_date: start, end_date: end, order_index: idx + 1,
      is_active: raw.is_active !== false,
      coeff: pair.cycle === "secondary" ? value : 1,
    });
  }

  const removed = (existing || []).filter(row => !usedIds.has(row.id));
  if (removed.length) {
    const { count, error } = await access.service.from("grade_evaluations")
      .select("id", { head: true, count: "exact" })
      .in("grading_period_id", removed.map(row => row.id));
    if (error) return json({ ok: false, error: "period_link_check_failed" }, 503);
    if ((count || 0) > 0) return json({ ok: false, error: "period_used_by_evaluations" }, 409);
  }

  // Scope is repeated on every mutation, so IDs from another school/program
  // cannot be changed or deleted. Existing evaluation links retain their IDs.
  for (const row of normalized.filter(row => row.keepId)) {
    const { error } = await access.service.from("grade_periods").update({
      code: row.code, display_code: row.display_code, label: row.label,
      short_label: row.short_label, kind: row.kind, start_date: row.start_date,
      end_date: row.end_date, order_index: row.order_index,
      is_active: row.is_active, coeff: row.coeff,
    }).eq("id", row.keepId!).eq("institution_id", access.institutionId)
      .eq("academic_year", year).eq("scope_type", "formation")
      .eq("formation_code", pair.formationCode);
    if (error) return json({ ok: false, error: "period_update_failed" }, 503);
  }
  const insert = normalized.filter(row => !row.keepId).map(row => ({
    institution_id: access.institutionId, academic_year: year,
    scope_type: "formation", education_type: "general_secondary",
    formation_code: pair.formationCode, profile_period_key: null,
    code: row.code, display_code: row.display_code, label: row.label,
    short_label: row.short_label, kind: row.kind, start_date: row.start_date,
    end_date: row.end_date, order_index: row.order_index,
    is_active: row.is_active, coeff: row.coeff,
  }));
  if (insert.length) {
    const { error } = await access.service.from("grade_periods").insert(insert);
    if (error) return json({ ok: false, error: "period_insert_failed" }, 503);
  }
  if (removed.length) {
    const { error } = await access.service.from("grade_periods").delete()
      .in("id", removed.map(row => row.id))
      .eq("institution_id", access.institutionId)
      .eq("academic_year", year).eq("scope_type", "formation")
      .eq("formation_code", pair.formationCode);
    if (error) return json({ ok: false, error: "period_delete_failed" }, 503);
  }
  const { data: saved, error: finalError } = await getRows(
    access.service, access.institutionId, year, pair.formationCode);
  if (finalError) return json({ ok: false, error: "periods_reload_failed" }, 503);
  return json({ ok: true, items: (saved || []).map(row =>
    ({ ...row, code: row.display_code || row.code })) });
}
