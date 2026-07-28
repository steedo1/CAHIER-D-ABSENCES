import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { MON_CAHIER_WEB_RELEASE } from "@/lib/offline-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const service = getSupabaseServiceClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return noStore({ error: "unauthorized" }, 401);

    const [{ data: profile }, { data: roleRows, error: rolesError }] =
      await Promise.all([
        service
          .from("profiles")
          .select("institution_id")
          .eq("id", user.id)
          .maybeSingle(),
        service
          .from("user_roles")
          .select("institution_id")
          .eq("profile_id", user.id),
      ]);
    if (rolesError) return noStore({ error: "role_lookup_failed" }, 503);

    const institutionId =
      String(profile?.institution_id || "").trim() ||
      String(roleRows?.find((row) => row.institution_id)?.institution_id || "").trim();
    if (!institutionId) return noStore({ error: "institution_missing" }, 403);

    const { data: revisionRow, error: revisionError } = await service
      .from("attendance_schedule_revisions")
      .select("revision,updated_at")
      .eq("institution_id", institutionId)
      .maybeSingle();
    if (revisionError) {
      return noStore({ error: "schedule_revision_unavailable" }, 503);
    }

    const revision = Number(revisionRow?.revision ?? 0);
    return noStore({
      ok: true,
      institution_id: institutionId,
      schedule_revision:
        Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      generated_at: String(revisionRow?.updated_at || new Date().toISOString()),
      web_release: MON_CAHIER_WEB_RELEASE,
    });
  } catch {
    return noStore({ error: "cloud_probe_failed" }, 503);
  }
}
