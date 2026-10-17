//src/app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { mergeGeneralSchoolSettings, writeSchoolSettings } from "@/lib/school-settings-write";

export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

async function context() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) return { error: reply({ error: access.error }, access.error === "unauthorized" ? 401 : 403) };
  const school = await service.from("institutions").select("settings_json")
    .eq("id", access.instId).maybeSingle();
  if (school.error) return { error: reply({ error: "settings_load_failed" }, 503) };
  if (!school.data) return { error: reply({ error: "institution_not_found" }, 404) };
  return { service, institutionId: access.instId, previous: school.data.settings_json };
}

export async function GET() {
  const auth = await context();
  if ("error" in auth) return auth.error;
  return reply({ settings: auth.previous || {} });
}

export async function POST(req: NextRequest) {
  const auth = await context();
  if ("error" in auth) return auth.error;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return reply({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return reply({ error: "expected_json" }, 415);
  const body = await req.json().catch(() => null);
  const next = mergeGeneralSchoolSettings(auth.previous, body?.settings_json);
  if (!next) return reply({ error: "invalid_or_reserved_settings" }, 400);
  const result = await writeSchoolSettings(auth.service, auth.institutionId, auth.previous, next);
  if ("error" in result) return reply({ error: result.error }, result.status);
  return reply({ ok: true });
}


