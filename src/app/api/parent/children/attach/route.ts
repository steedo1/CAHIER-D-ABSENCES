import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalisation simple : trim + remove spaces + uppercase */
function normalizeMatricule(m: string) {
  return String(m || "").trim().replace(/\s+/g, "").toUpperCase();
}

function newDeviceId() {
  return "pd_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * POST /api/parent/children/attach
 * Body: { matricule: string }
 * Effet : lie le device parent (cookie "parent_device") à l'élève correspondant.
 */
export async function POST(req: Request) {
  const srv = getSupabaseServiceClient();
  const { matricule } = await req.json().catch(() => ({ matricule: "" }));

  const mat = normalizeMatricule(matricule);
  if (!mat) return NextResponse.json({ error: "MATRICULE_REQUIRED" }, { status: 400 });

  // 1) Résoudre l'élève par matricule (case-insensitive)
  //    On tente d'abord un match exact ILIKE, puis un fallback sur le matricule brut au cas où.
  let st = null as null | { id: string };
  {
    const { data, error } = await srv
      .from("students")
      .select("id")
      .ilike("matricule", mat)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    st = data;
  }
  if (!st) {
    const { data } = await srv
      .from("students")
      .select("id")
      .ilike("matricule", matricule)
      .maybeSingle();
    st = data ?? null;
  }
  if (!st) return NextResponse.json({ error: "MATRICULE_NOT_FOUND" }, { status: 404 });

  // 2) Obtenir / créer l'identifiant d'appareil parent (cookie)
  let deviceId = cookies().get("parent_device")?.value || "";
  let setCookie = false;
  if (!deviceId) {
    deviceId = newDeviceId();
    setCookie = true;
  }

  // 3) Lier device -> élève (idempotent)
  const { error: linkErr } = await srv
    .from("parent_device_children")
    .upsert({ device_id: deviceId, student_id: st.id }, { onConflict: "device_id,student_id" });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });

  // 4) Réponse + set-cookie si nouveau
  const res = NextResponse.json({ ok: true, student_id: st.id });
  if (setCookie) {
    res.cookies.set("parent_device", deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365, // 1 an
      path: "/",
    });
  }
  return res;
}
