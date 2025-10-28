import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

const DEFAULT_LEVEL = "(inconnu)";

function sanitizeLevel(s: unknown): string {
  const raw = String(s ?? "")
    .normalize("NFC")                   // normalise les accents
    .replace(/[\u0000-\u001F\u007F]/g, "") // retire les caractères de contrôle
    .replace(/\s+/g, " ")               // espaces multiples → simple
    .trim();
  return raw || DEFAULT_LEVEL;
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const institution_id = me?.institution_id as string | null;
  if (!institution_id) return NextResponse.json({ items: [] });

  const { data: marks, error } = await srv
    .from("v_mark_minutes")
    .select("class_id, minutes, started_at")
    .eq("institution_id", institution_id)
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  if (error) {
    return NextResponse.json({ items: [], error: error.message }, { status: 400 });
  }

  const classIds = Array.from(
    new Set((marks || []).map((m: any) => m.class_id).filter(Boolean))
  ) as string[];

  const { data: classes } = await srv
    .from("classes")
    .select("id, level")
    .in("id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"]);

  // id → level (nettoyé)
  const levelOf = new Map<string, string>(
    (classes || []).map((c: any) => [c.id as string, sanitizeLevel(c.level)])
  );

  // Agrégat par level
  const agg = new Map<string, { absents: number; minutes: number }>();
  for (const m of marks || []) {
    const classId = (m as any).class_id as string | undefined;
    if (!classId) continue;

    const lvl = levelOf.get(classId) ?? DEFAULT_LEVEL;
    const a = agg.get(lvl) || { absents: 0, minutes: 0 };
    a.absents += 1;
    a.minutes += Number((m as any).minutes) || 0;
    agg.set(lvl, a);
  }

  const items = Array.from(agg.entries())
    .map(([level, v]) => ({ level, absents: v.absents, minutes: v.minutes }))
    .sort((a, b) => a.level.localeCompare(b.level, "fr", { numeric: true, sensitivity: "base" }));

  return NextResponse.json({ items });
}
