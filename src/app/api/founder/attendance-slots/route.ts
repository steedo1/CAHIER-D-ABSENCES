import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { loadFounderAttendancePayload } from "@/lib/founder-attendance-slots-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await loadFounderAttendancePayload(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    const message = String(error?.message || "attendance_slots_failed");
    return NextResponse.json(
      { error: message },
      { status: message === "no_institution" ? 403 : 400 },
    );
  }
}
