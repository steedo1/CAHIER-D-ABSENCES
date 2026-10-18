import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { isTeachingTrack, parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { isBilingualSchool } from "@/lib/school-student-programs";
import { readSchoolTeachingSignatories, setSchoolTeachingSignatory, validSignatoryName } from "@/lib/school-teaching-signatories";
import { schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function scope() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  // The general director already uses the institution administrator account.
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) return { error: json({ ok: false, error: access.error },
    access.error === "unauthorized" ? 401 : 403) } as const;
  const school = await service.from("institutions").select("settings_json")
    .eq("id", access.instId).maybeSingle();
  if (school.error || !school.data) return { error: json({ ok: false, error: "school_unavailable" }, 503) } as const;
  if (!isBilingualSchool(parseSchoolCyclesSettings(school.data.settings_json))) {
    return { error: json({ ok: false, error: "not_franco_arabic_school" }, 404) } as const;
  }
  return { service, instId: access.instId, settings: school.data.settings_json } as const;
}

/** Display existing school teachers as nomination choices, without changing their accounts. */
async function candidates(service: ReturnType<typeof getSupabaseServiceClient>, instId: string) {
  const roles = await service.from("user_roles").select("profile_id")
    .eq("institution_id", instId).eq("role", "teacher").limit(500);
  if (roles.error) throw roles.error;
  const ids = [...new Set((roles.data || []).map(row => row.profile_id))];
  if (!ids.length) return [];
  const profiles = await service.from("profiles").select("id,display_name")
    .eq("institution_id", instId).in("id", ids).limit(500);
  if (profiles.error) throw profiles.error;
  return (profiles.data || []).filter(row => validSignatoryName(row.display_name))
    .map(row => ({ id: row.id, name: String(row.display_name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function GET() {
  const scoped = await scope();
  if ("error" in scoped) return scoped.error;
  try {
    return json({ ok: true, directors: readSchoolTeachingSignatories(scoped.settings),
      revision: schoolSettingsRevision(scoped.settings),
      candidates: await candidates(scoped.service, scoped.instId) });
  } catch {
    return json({ ok: false, error: "teacher_directory_unavailable" }, 503);
  }
}

export async function PUT(request: NextRequest) {
  const scoped = await scope();
  if ("error" in scoped) return scoped.error;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return json({ ok: false, error: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ ok: false, error: "expected_json" }, 415);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !isTeachingTrack(body.track) || body.revision !== schoolSettingsRevision(scoped.settings)) {
    return json({ ok: false, error: "invalid_or_stale_nomination" }, 409);
  }
  let name: unknown = body.name;
  if (body.candidate_profile_id !== undefined) {
    const profileId = body.candidate_profile_id;
    if (typeof profileId !== "string" || !UUID.test(profileId)) {
      return json({ ok: false, error: "invalid_teacher_choice" }, 400);
    }
    const [teacherRole, profile] = await Promise.all([
      scoped.service.from("user_roles").select("profile_id").eq("institution_id", scoped.instId)
        .eq("profile_id", profileId).eq("role", "teacher").maybeSingle(),
      scoped.service.from("profiles").select("display_name").eq("institution_id", scoped.instId)
        .eq("id", profileId).maybeSingle(),
    ]);
    if (teacherRole.error || profile.error) return json({ ok: false, error: "teacher_lookup_unavailable" }, 503);
    if (!teacherRole.data || !profile.data || !validSignatoryName(profile.data.display_name)) {
      return json({ ok: false, error: "teacher_not_in_school" }, 403);
    }
    name = profile.data.display_name;
  }
  // A blank name vacates a signatory position. It does not delete an account.
  if (name !== "" && !validSignatoryName(name)) {
    return json({ ok: false, error: "invalid_signatory_name" }, 400);
  }
  const next = setSchoolTeachingSignatory(scoped.settings, body.track, name as string);
  const write = await writeSchoolSettings(scoped.service, scoped.instId, scoped.settings, next);
  if ("error" in write) return json({ ok: false, error: write.error }, write.status);
  return json({ ok: true, directors: readSchoolTeachingSignatories(next), revision: write.revision });
}
