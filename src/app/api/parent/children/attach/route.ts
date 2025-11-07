import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newDeviceId() {
  // petit id lisible et stable pour lier l’appareil parent
  return "pd_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
function normMatricule(s: string) {
  return String(s || "").normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const srv = getSupabaseServiceClient();
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.matricule ?? "");
    const matricule = normMatricule(raw);

    if (!matricule) {
      return NextResponse.json({ error: "MATRICULE_REQUIRED" }, { status: 400 });
    }

    // 1) Trouver l’élève par matricule
    const { data: student, error: sErr } = await srv
      .from("students")
      .select("id, matricule")
      .ilike("matricule", matricule) // tolère casse/espaces
      .maybeSingle();

    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
    if (!student) {
      return NextResponse.json({ error: "MATRICULE_NOT_FOUND" }, { status: 404 });
    }

    // 2) Lire/poser le cookie device
    const jar = await cookies();
    let deviceId = jar.get("parent_device")?.value || "";
    let mustSet = false;
    if (!deviceId) {
      deviceId = newDeviceId();
      mustSet = true;
    }

    // 3) Lier (idempotent) device ↔ élève
    const { error: upErr } = await srv
      .from("parent_device_children")
      .upsert(
        { device_id: deviceId, student_id: student.id },
        { onConflict: "device_id,student_id" }
      );

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    // 4) Déposer le cookie si nouvel appareil
    if (mustSet) {
      jar.set("parent_device", deviceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 an
      });
    }

    return NextResponse.json({
      ok: true,
      device_id: deviceId,
      student_id: student.id,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
