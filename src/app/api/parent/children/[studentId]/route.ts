import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;

  const srv = getSupabaseServiceClient();
  const jar = await cookies();
  const deviceId = jar.get("parent_device")?.value || "";

  if (!deviceId) return NextResponse.json({ error: "DEVICE_ID_REQUIRED" }, { status: 400 });
  if (!studentId) return NextResponse.json({ error: "STUDENT_ID_REQUIRED" }, { status: 400 });

  const { error } = await srv
    .from("parent_device_children")
    .delete()
    .eq("device_id", deviceId)
    .eq("student_id", studentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
