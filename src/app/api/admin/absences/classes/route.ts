import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from")  || "";
  const to    = searchParams.get("to")    || "";
  const level = searchParams.get("level") || "";

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const institution_id = me?.institution_id as string | null;
  if (!institution_id) return NextResponse.json({ items: [] });

  // Marques (absences/retards) sur la pÃ©riode
  const { data: marks, error } = await srv
    .from("v_mark_minutes")
    .select("class_id, minutes, started_at")
    .eq("institution_id", institution_id)
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  if (error) {
    return NextResponse.json({ items: [], error: error.message }, { status: 400 });
  }

  // âš ï¸ classes.label (et pas name)
  const classIds = Array.from(new Set((marks || []).map(m => m.class_id).filter(Boolean)));
  const { data: classes } = await srv
    .from("classes")
    .select("id, label, level")
    .in("id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"]);

  const meta = new Map<string, { label: string; level: string }>(
    (classes || []).map(c => [c.id as string, { label: String((c as any).label ?? "â€”"), level: String((c as any).level ?? "") }])
  );

  // AgrÃ©gat par classe
  const agg = new Map<string, { absents: number; minutes: number }>();
  for (const m of marks || []) {
    const cm = meta.get(m.class_id!);
    if (!cm) continue;
    if (level && cm.level !== level) continue;

    const a = agg.get(m.class_id!) || { absents: 0, minutes: 0 };
    a.absents += 1;                // 1 Ã©vÃ©nement = 1 ligne (absence ou retard)
    a.minutes += (m as any).minutes || 0;
    agg.set(m.class_id!, a);
  }

  const items = Array.from(agg.entries()).map(([class_id, v]) => ({
    class_id,
    class_label: meta.get(class_id)?.label || "â€”",
    absents: v.absents,
    minutes: v.minutes,
  }));

  return NextResponse.json({ items });
}


