// src/app/api/admin/institution/bulletin-signatures/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | string;

/* ───────── helper : récup user_roles + institution ───────── */
async function getAdminAndInstitution(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "UNAUTHENTICATED" as const };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { error: "PROFILE_NOT_FOUND" as const };
  }

  const role = roleRow.role as Role;
  if (!["super_admin", "admin"].includes(role)) {
    return { error: "FORBIDDEN" as const };
  }

  const institutionId = roleRow.institution_id;
  if (!institutionId) {
    return { error: "NO_INSTITUTION" as const };
  }

  return { user, institutionId, role };
}

/* ───────── status HTTP en fonction du code erreur ───────── */
function statusFromError(error?: string): number {
  if (error === "UNAUTHENTICATED") return 401;
  if (error === "FORBIDDEN") return 403;
  if (error === "PROFILE_NOT_FOUND" || error === "NO_INSTITUTION") return 403;
  return 400;
}

/* ───────── GET: lire l’état des signatures électroniques ───────── */
export async function GET(_req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const srv = await getSupabaseServiceClient();

  const ctx = await getAdminAndInstitution(supabase);
  if ("error" in ctx) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: statusFromError(ctx.error) }
    );
  }

  const { institutionId } = ctx;

  const { data, error } = await srv
    .from("institutions")
    .select("bulletin_signatures_enabled, settings_json")
    .eq("id", institutionId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "INSTITUTION_NOT_FOUND" },
      { status: 500 }
    );
  }

  const enabled =
    typeof (data as any).bulletin_signatures_enabled === "boolean"
      ? (data as any).bulletin_signatures_enabled
      : Boolean(
          (data as any).settings_json?.bulletin_signatures_enabled ?? false
        );

  return NextResponse.json({ ok: true, enabled });
}

/* ───────── POST: activer / désactiver ───────── */
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const srv = await getSupabaseServiceClient();

  const ctx = await getAdminAndInstitution(supabase);
  if ("error" in ctx) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: statusFromError(ctx.error) }
    );
  }

  const { institutionId } = ctx;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "MISSING_ENABLED_BOOLEAN" },
      { status: 400 }
    );
  }

  const enabled: boolean = body.enabled;

  const { data, error } = await srv
    .from("institutions")
    .update({ bulletin_signatures_enabled: enabled })
    .eq("id", institutionId)
    .select("bulletin_signatures_enabled")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "UPDATE_FAILED" },
      { status: 500 }
    );
  }

  const finalEnabled = !!(data as any).bulletin_signatures_enabled;

  return NextResponse.json({ ok: true, enabled: finalEnabled });
}
