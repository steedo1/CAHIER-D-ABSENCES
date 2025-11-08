// src/app/api/admin/institution/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(supa: ReturnType<typeof getSupabaseServerClient>) {
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" as const };
  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.institution_id) return { error: "no_institution" as const };
  if (!["super_admin","admin"].includes(String(me.role || ""))) return { error: "forbidden" as const };
  return { user, instId: me.institution_id as string };
}

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const g = await guard(supa);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const { data, error } = await srv
    .from("institutions")
    .select("tz, auto_lateness, default_session_minutes")
    .eq("id", g.instId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    tz: data?.tz ?? "Africa/Abidjan",
    auto_lateness: Boolean(data?.auto_lateness ?? true),
    default_session_minutes: Number(data?.default_session_minutes ?? 60),
  });
}

export async function PUT(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const g = await guard(supa);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const tz = (body?.tz || "Africa/Abidjan").trim();
  const auto = !!body?.auto_lateness;
  const defMinRaw = Number(body?.default_session_minutes);
  const defMin = Number.isFinite(defMinRaw) && defMinRaw > 0 ? Math.floor(defMinRaw) : 60;

  const { error } = await srv
    .from("institutions")
    .update({ tz, auto_lateness: auto, default_session_minutes: defMin })
    .eq("id", g.instId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
