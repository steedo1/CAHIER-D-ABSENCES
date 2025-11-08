//src/app/api/parent/children/attach/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── utils ───────── */
function rid() {
  return Math.random().toString(36).slice(2, 8);
}
function newDeviceId() {
  return "pd_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
function normMatricule(s: string) {
  return String(s || "").normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

/* ───────── handler ───────── */
export async function POST(req: NextRequest) {
  const id = rid();
  const srv = getSupabaseServiceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const matricule = normMatricule(String(body?.matricule ?? ""));
    console.info(`[parent.attach:${id}] payload`, { matriculeRaw: body?.matricule, matricule });

    if (!matricule) {
      console.warn(`[parent.attach:${id}] MATRICULE_REQUIRED`);
      return NextResponse.json({ error: "MATRICULE_REQUIRED" }, { status: 400 });
    }

    // On récupère aussi l'institution_id pour respecter le NOT NULL
    const { data: rows, error: sErr } = await srv
      .from("students")
      .select("id, matricule, institution_id")
      .ilike("matricule", matricule)
      .order("created_at", { ascending: false })
      .limit(1);

    if (sErr) {
      console.error(`[parent.attach:${id}] select students error`, sErr);
      return NextResponse.json({ error: sErr.message }, { status: 400 });
    }
    const student = (rows ?? [])[0];
    if (!student) {
      console.warn(`[parent.attach:${id}] MATRICULE_NOT_FOUND`);
      return NextResponse.json({ error: "MATRICULE_NOT_FOUND" }, { status: 404 });
    }
    if (!student.institution_id) {
      console.error(`[parent.attach:${id}] student has NULL institution_id`, { student_id: student.id });
      return NextResponse.json({ error: "STUDENT_MISSING_INSTITUTION" }, { status: 400 });
    }

    // Cookie device (Next 15 → cookies() est async et on SET sur la réponse)
    const jar = await cookies();
    let deviceId = jar.get("parent_device")?.value || "";
    let mustSet = false;
    if (!deviceId) {
      deviceId = newDeviceId();
      mustSet = true;
    }
    console.info(`[parent.attach:${id}] device`, { deviceId, mustSet });

    // Upsert idempotent AVEC institution_id
    const payload = {
      device_id: deviceId,
      student_id: student.id,
      institution_id: student.institution_id, // ← FIX
    };

    const { error: upErr } = await srv
      .from("parent_device_children")
      .upsert(payload, { onConflict: "device_id,student_id" });

    if (upErr) {
      console.error(`[parent.attach:${id}] upsert error`, upErr);
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    const res = NextResponse.json({
      ok: true,
      device_id: deviceId,
      student_id: student.id,
      institution_id: student.institution_id,
    });

    if (mustSet) {
      res.cookies.set("parent_device", deviceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      console.info(`[parent.attach:${id}] cookie set`, { deviceId });
    }

    console.info(`[parent.attach:${id}] success`);
    return res;
  } catch (e: any) {
    console.error(`[parent.attach:${id}] fatal`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
