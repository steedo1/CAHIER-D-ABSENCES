import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { parseSchoolCyclesSettings, type TeachingTrack } from "@/lib/school-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function generalDirector() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const auth = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in auth) return { error: respond({ ok: false, error: auth.error }, auth.error === "unauthorized" ? 401 : 403) } as const;
  const { data, error } = await service.from("institutions").select("settings_json")
    .eq("id", auth.instId).maybeSingle();
  if (error || !data) return { error: respond({ ok: false, error: "school_unavailable" }, 503) } as const;
  const school = parseSchoolCyclesSettings(data.settings_json);
  if (!school.enabled || !school.enabledCycles.some(cycle =>
      school.teachingTracksByCycle[cycle]?.includes("arabic") &&
      school.teachingTracksByCycle[cycle]?.includes("french"))) {
    return { error: respond({ ok: false, error: "not_franco_arabic_school" }, 403) } as const;
  }
  return { service, instId: auth.instId, school } as const;
}

function validateOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin;
}
function isTrack(track: unknown): track is TeachingTrack {
  return track === "french" || track === "arabic";
}
function allowedTrack(school: { enabledCycles: Array<"preschool" | "primary" | "secondary">;
  teachingTracksByCycle: Partial<Record<"preschool" | "primary" | "secondary", TeachingTrack[]>> }, track: TeachingTrack) {
  return school.enabledCycles.some(cycle => school.teachingTracksByCycle[cycle]?.includes(track));
}

export async function GET() {
  const access = await generalDirector();
  if ("error" in access) return access.error;
  const { data, error } = await access.service.from("school_teaching_directors")
    .select("teaching_track,profile_id,is_active,updated_at")
    .eq("institution_id", access.instId);
  if (error) return respond({ ok: false, error: "director_data_unavailable" }, 503);
  const ids = (data || []).map(row => row.profile_id);
  const profiles = ids.length ? await access.service.from("profiles")
    .select("id,display_name,email,phone").in("id", ids) : { data: [], error: null };
  if (profiles.error) return respond({ ok: false, error: "director_profiles_unavailable" }, 503);
  const byId = new Map((profiles.data || []).map(row => [row.id, row]));
  return respond({ ok: true, directors: (data || []).map(row => ({
    track: row.teaching_track, active: row.is_active,
    updated_at: row.updated_at, profile: byId.get(row.profile_id) || null,
  })) });
}

export async function POST(req: NextRequest) {
  const access = await generalDirector();
  if ("error" in access) return access.error;
  if (!validateOrigin(req)) return respond({ ok: false, error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return respond({ ok: false, error: "expected_json" }, 415);
  }
  const body = await req.json().catch(() => null);
  const track = body?.track;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!isTrack(track) || !allowedTrack(access.school, track) ||
      name.length < 3 || name.length > 120 ||
      !((email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        (phone && /^\+225\d{10}$/.test(phone))) ||
      email.length > 254 || (phone && !/^\+225\d{10}$/.test(phone))) {
    return respond({ ok: false, error: "invalid_director_details" }, 400);
  }
  // Never reset a password or add this role to an existing unreviewed account.
  if (email || phone) {
    const duplicates = await Promise.all([
      email ? access.service.from("profiles").select("id").eq("email", email).limit(1) : Promise.resolve({ data: [] }),
      phone ? access.service.from("profiles").select("id").eq("phone", phone).limit(1) : Promise.resolve({ data: [] }),
    ]);
    if (duplicates.some(row => (row.data || []).length)) {
      return respond({ ok: false, error: "account_already_exists_use_separate_nomination" }, 409);
    }
  }
  const { data: slot, error: slotError } = await access.service.from("school_teaching_directors")
    .select("profile_id,is_active").eq("institution_id", access.instId)
    .eq("teaching_track", track).maybeSingle();
  if (slotError) return respond({ ok: false, error: "director_slot_unavailable" }, 503);
  if (slot?.is_active) return respond({ ok: false, error: "director_already_assigned" }, 409);
  const password = randomBytes(18).toString("base64url");
  const { data: created, error: createError } = await access.service.auth.admin.createUser({
    ...(email ? { email, email_confirm: true } : {}),
    ...(phone ? { phone, phone_confirm: true } : {}),
    password,
    user_metadata: { display_name: name },
  });
  if (createError || !created?.user) {
    return respond({ ok: false, error: "director_auth_create_failed" }, 409);
  }
  const uid = created.user.id;
  try {
    const profile = await access.service.from("profiles").insert({
      id: uid, institution_id: access.instId, display_name: name,
      email: email || null, phone: phone || null,
    });
    if (profile.error) throw profile.error;
    const role = await access.service.from("user_roles").insert({
      profile_id: uid, institution_id: access.instId, role: "teaching_director",
    });
    if (role.error) throw role.error;
    // Upsert only a previously inactive slot. A second concurrent creation is
    // guarded by the row uniqueness and rejected rather than merging identities.
    const assigned = slot
      ? await access.service.from("school_teaching_directors").update({
          profile_id: uid, is_active: true, updated_at: new Date().toISOString(),
        }).eq("institution_id", access.instId).eq("teaching_track", track)
        .eq("is_active", false).select("profile_id")
      : await access.service.from("school_teaching_directors").insert({
          profile_id: uid, institution_id: access.instId, teaching_track: track,
          is_active: true,
        }).select("profile_id");
    if (assigned.error || assigned.data?.length !== 1) throw assigned.error || new Error("slot_taken");
    return respond({
      ok: true, director: { track, name, email: email || null, phone: phone || null },
      temporary_password: password,
      warning: "Mot de passe transmis une seule fois. Le directeur doit le changer à sa première connexion.",
    }, 201);
  } catch {
    // Compensate only the newly created account. Never edit another user's roles.
    await access.service.from("user_roles").delete().eq("profile_id", uid)
      .eq("institution_id", access.instId).eq("role", "teaching_director");
    await access.service.from("profiles").delete().eq("id", uid).eq("institution_id", access.instId);
    await access.service.auth.admin.deleteUser(uid);
    return respond({ ok: false, error: "director_setup_failed" }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await generalDirector();
  if ("error" in access) return access.error;
  if (!validateOrigin(req)) return respond({ ok: false, error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return respond({ ok: false, error: "expected_json" }, 415);
  }
  const body = await req.json().catch(() => null);
  if (!isTrack(body?.track)) return respond({ ok: false, error: "invalid_teaching_track" }, 400);
  const { data: current, error: lookupError } = await access.service.from("school_teaching_directors")
    .select("profile_id,is_active").eq("institution_id", access.instId)
    .eq("teaching_track", body.track).maybeSingle();
  if (lookupError) return respond({ ok: false, error: "director_slot_unavailable" }, 503);
  if (!current?.is_active) return respond({ ok: false, error: "director_not_assigned" }, 404);
  // Revoke the scope first; if a secondary role cleanup fails, access is
  // still denied by the independently verified assignment.
  const disabled = await access.service.from("school_teaching_directors")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("institution_id", access.instId).eq("teaching_track", body.track)
    .eq("profile_id", current.profile_id).eq("is_active", true).select("profile_id");
  if (disabled.error || disabled.data?.length !== 1) {
    return respond({ ok: false, error: "director_revoke_failed" }, 503);
  }
  const role = await access.service.from("user_roles").delete()
    .eq("profile_id", current.profile_id).eq("institution_id", access.instId)
    .eq("role", "teaching_director");
  return respond({ ok: !role.error, error: role.error ? "director_role_cleanup_required" : undefined });
}
