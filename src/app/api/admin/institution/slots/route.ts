// src/app/api/institution/slots/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServerSupa = Awaited<ReturnType<typeof getSupabaseServerClient>>;

async function guardAnyRole(supa: ServerSupa) {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!me?.institution_id) return { error: "no_institution" as const };
  // Prof/Classe/Admin/Super -> tous OK pour lire
  return { user, instId: me.institution_id as string };
}

function hhmm(hms: string | null | undefined) {
  const s = String(hms || "");
  return s.slice(0, 5); // "HH:MM:SS" -> "HH:MM"
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const g = await guardAnyRole(supa);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  // (optionnel) on lit ?class_id=... sans s’en servir pour l’instant
  // const classId = req.nextUrl.searchParams.get("class_id");

  const { data, error } = await srv
    .from("institution_periods")
    .select("id, weekday, period_no, label, start_time, duration_min")
    .eq("institution_id", g.instId)
    .order("weekday", { ascending: true })
    .order("period_no", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const items =
    (data || []).map((p) => ({
      id: p.id,
      label: p.label ?? `Séance ${p.period_no}`,
      start_hm: hhmm(p.start_time),
      duration_minutes: p["duration_min"] ?? 60,
      weekday: p.weekday,
      period_no: p.period_no,
    })) ?? [];

  return NextResponse.json({ items });
}
