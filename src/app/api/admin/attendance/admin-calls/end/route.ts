import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AllowedRole = "admin" | "super_admin" | "educator";

async function requireActor() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  const institution_id = String(me?.institution_id || "");
  if (!institution_id) {
    return {
      error: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = String(roleRow?.role || "") as AllowedRole | "";
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour cette vue." },
        { status: 403 }
      ),
    };
  }

  return { supa, srv, institution_id, user_id: user.id, role };
}

export async function PATCH(req: NextRequest) {
  const auth = await requireActor();
  if ("error" in auth) return auth.error;

  const { srv, institution_id } = auth;

  const body = await req.json().catch(() => ({}));
  const session_id = String(body?.session_id || "").trim();

  if (!session_id) {
    return NextResponse.json(
      { error: "invalid_payload", message: "session_id requis." },
      { status: 400 }
    );
  }

  const { data: updated, error: uErr } = await srv
    .from("admin_student_calls")
    .update({ ended_at: new Date().toISOString() })
    .eq("institution_id", institution_id)
    .eq("id", session_id)
    .select("id,class_id,period_id,call_date,started_at,actual_call_at,ended_at")
    .maybeSingle();

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 400 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "session_not_found", message: "Séance administrative introuvable." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    item: updated,
  });
}