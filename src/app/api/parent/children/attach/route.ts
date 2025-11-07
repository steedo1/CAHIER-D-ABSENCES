import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newDeviceId() {
  return "pd_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
function normMatricule(s: string) {
  return String(s || "").normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const srv = getSupabaseServiceClient();
    const body = await req.json().catch(() => ({}));
    const matricule = normMatricule(String(body?.matricule ?? ""));

    if (!matricule) {
      return NextResponse.json({ error: "MATRICULE_REQUIRED" }, { status: 400 });
    }

    // ✅ Robustesse: on prend 1 ligne max (si doublons existent ailleurs)
    const { data: rows, error: sErr } = await srv
      .from("students")
      .select("id, matricule")
      .ilike("matricule", matricule)
      .order("created_at", { ascending: false })
      .limit(1);

    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
    const student = (rows ?? [])[0];
    if (!student) return NextResponse.json({ error: "MATRICULE_NOT_FOUND" }, { status: 404 });

    // 🔐 Cookie device (Next 15 → set sur la réponse)
    const jar = await cookies();
    let deviceId = jar.get("parent_device")?.value || "";
    let mustSet = false;
    if (!deviceId) {
      deviceId = newDeviceId();
      mustSet = true;
    }

    // Idempotent: lie l’appareil au student
    const { error: upErr } = await srv
      .from("parent_device_children")
      .upsert({ device_id: deviceId, student_id: student.id }, { onConflict: "device_id,student_id" });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

    const res = NextResponse.json({ ok: true, device_id: deviceId, student_id: student.id });
    if (mustSet) {
      res.cookies.set("parent_device", deviceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
