// src/app/api/admin/rapport-f/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

type RapportFSettings = Record<string, string>;

const DEFAULT_RAPPORT_F_SETTINGS: RapportFSettings = {
  drenaet: "",
  ddenaet: "",
  locality: "",
  report_author_name: "",
  report_author_phone: "",
  opening_meeting_date: "",
  opening_meeting_organizer: "",
  opening_meeting_location: "",
  opening_meeting_observation: "",
  textbook_exists: "OUI",
  gradebook_exists: "OUI",
  attendance_register_exists: "OUI",
  pedagogical_documents_observation: "Bien",
  pedagogical_documents_comment: "",
  up_comment: "",
  teaching_council_comment: "",
  class_visit_comment: "",
  discipline_comment: "",
  internal_council_comment: "",
  extracurricular_comment: "",
  general_observation: "",
};

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient,
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" };

  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;
  let roleProfile = String(me?.role || "");
  let roleFromUR: string | null = null;

  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((row) =>
      ["admin", "super_admin"].includes(String(row.role || "")),
    );

    if (adminRow) {
      roleFromUR = String(adminRow.role || "");
      if (!instId && adminRow.institution_id) instId = String(adminRow.institution_id);
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

function academicYearFromRequest(req: NextRequest) {
  return String(new URL(req.url).searchParams.get("academic_year") || "").trim();
}

function normalizeSettings(input: unknown): RapportFSettings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: RapportFSettings = { ...DEFAULT_RAPPORT_F_SETTINGS };

  for (const key of Object.keys(DEFAULT_RAPPORT_F_SETTINGS)) {
    const value = source[key];
    if (typeof value === "string") out[key] = value;
    else if (value !== null && value !== undefined) out[key] = String(value);
  }

  return out;
}

function readRapportFByYear(settingsJson: unknown) {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return {} as Record<string, RapportFSettings>;
  }

  const source = settingsJson as Record<string, unknown>;
  const raw = source.rapport_f_by_year;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {} as Record<string, RapportFSettings>;
  }

  const byYear: Record<string, RapportFSettings> = {};
  for (const [year, value] of Object.entries(raw as Record<string, unknown>)) {
    byYear[year] = normalizeSettings(value);
  }

  return byYear;
}

export async function GET(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);

  if ("error" in g) return NextResponse.json({ ok: false, error: g.error }, { status: 403 });

  const academicYear = academicYearFromRequest(req);
  if (!academicYear) {
    return NextResponse.json({ ok: false, error: "MISSING_ACADEMIC_YEAR" }, { status: 400 });
  }

  const { data, error } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", g.instId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  const byYear = readRapportFByYear((data as any)?.settings_json);
  const settings = { ...DEFAULT_RAPPORT_F_SETTINGS, ...(byYear[academicYear] || {}) };

  return NextResponse.json({ ok: true, academic_year: academicYear, settings });
}

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);

  if ("error" in g) return NextResponse.json({ ok: false, error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const academicYear = String(body?.academic_year || "").trim();

  if (!academicYear) {
    return NextResponse.json({ ok: false, error: "MISSING_ACADEMIC_YEAR" }, { status: 400 });
  }

  const nextSettings = normalizeSettings(body?.settings);

  const { data, error: readError } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", g.instId)
    .maybeSingle();

  if (readError) return NextResponse.json({ ok: false, error: readError.message }, { status: 400 });

  const currentJson =
    (data as any)?.settings_json && typeof (data as any).settings_json === "object"
      ? { ...(data as any).settings_json }
      : {};

  const byYear = readRapportFByYear(currentJson);
  byYear[academicYear] = nextSettings;

  const updatePayload = {
    ...currentJson,
    rapport_f_by_year: byYear,
  };

  const { error } = await srv
    .from("institutions")
    .update({ settings_json: updatePayload })
    .eq("id", g.instId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, academic_year: academicYear, settings: nextSettings });
}
