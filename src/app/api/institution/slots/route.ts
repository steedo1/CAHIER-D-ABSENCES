// src/app/api/institution/slots/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const class_id = String(url.searchParams.get("class_id") || "");
    if (!class_id) {
      return NextResponse.json({ items: [], error: "missing_class_id" }, { status: 400 });
    }
    const srv = getSupabaseServiceClient();

    const { data: cls, error: cErr } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", class_id)
      .maybeSingle();
    if (cErr) return NextResponse.json({ items: [], error: cErr.message }, { status: 400 });
    if (!cls?.institution_id) return NextResponse.json({ items: [] });

    const { data: slots, error: sErr } = await srv
      .from("institution_session_slots")
      .select("id,label,start_hm,duration_minutes,active,order_index")
      .eq("institution_id", cls.institution_id)
      .eq("active", true)
      .order("start_hm", { ascending: true })
      .order("order_index", { ascending: true });

    if (sErr) return NextResponse.json({ items: [], error: sErr.message }, { status: 400 });

    return NextResponse.json({
      items: (slots || []).map((s) => ({
        id: s.id,
        label: s.label,
        start_hm: s.start_hm,
        duration_minutes: s.duration_minutes,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ items: [], error: e?.message || "error" }, { status: 500 });
  }
}
