// src/app/api/admin/absences/by-class/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

export async function GET(req: Request) {
  // ✅ ICI: on attend le client, sinon 'supa' est une Promise
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const from     = searchParams.get("from")     || "";
  const to       = searchParams.get("to")       || "";
  const class_id = searchParams.get("class_id") || "";

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const institution_id = me?.institution_id as string | null;
  if (!institution_id || !class_id) return NextResponse.json({ items: [] });

  const { data: marks, error } = await srv
    .from("v_mark_minutes")
    .select("student_id, minutes, started_at")
    .eq("institution_id", institution_id)
    .eq("class_id", class_id)
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  if (error) {
    return NextResponse.json({ items: [], error: error.message }, { status: 400 });
  }

  const stuIds = Array.from(new Set((marks || []).map(m => m.student_id).filter(Boolean)));
  const { data: students } = await srv
    .from("students")
    .select("id, first_name, last_name")
    .in("id", stuIds.length ? stuIds : ["00000000-0000-0000-0000-000000000000"]);

  const nameOf = new Map<string, string>(
    (students || []).map(s => [s.id as string, [s.last_name, s.first_name].filter(Boolean).join(" ")])
  );

  const agg = new Map<string, number>();
  for (const m of marks || []) {
    agg.set(m.student_id!, (agg.get(m.student_id!) || 0) + ((m as any).minutes || 0));
  }

  const items = Array.from(agg.entries())
    .map(([student_id, minutes]) => ({
      student_id,
      full_name: nameOf.get(student_id) || "—",
      minutes,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  return NextResponse.json({ items });
}
