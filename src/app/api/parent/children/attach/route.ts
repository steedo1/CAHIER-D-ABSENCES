// src/app/api/parent/children/attach/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { randomUUID } from "node:crypto";

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

/** Garantit un parent_profile_id stable pour un device. 
 * 1) essaie RPC ensure_parent_profile(p_device text) -> uuid
 * 2) fallback table parent_devices (select → sinon insert)
 */
async function ensureParentProfileForDevice(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  deviceId: string
): Promise<string | null> {
  // 1) RPC (si présent côté DB)
  try {
    const { data } = await (srv as any)
      .rpc("ensure_parent_profile", { p_device: deviceId })
      .single();
    const got =
      data?.ensure_parent_profile ||
      data?.parent_profile_id ||
      data?.parent_id ||
      data;
    if (got) return String(got);
  } catch {
    // ignore — on tente le fallback table
  }

  // 2a) Lire parent_devices si la table existe
  try {
    const { data: row } = await srv
      .from("parent_devices")
      .select("parent_profile_id")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (row?.parent_profile_id) return String(row.parent_profile_id);
  } catch {
    // table absente ou autre → on essaiera l'insert juste après
  }

  // 2b) Créer une ligne si absente
  try {
    const parentId = randomUUID();
    const { data: ins } = await srv
      .from("parent_devices")
      .insert({ device_id: deviceId, parent_profile_id: parentId })
      .select("parent_profile_id")
      .maybeSingle();
    return String(ins?.parent_profile_id || parentId);
  } catch {
    // parent_devices non disponible → pas bloquant pour l’attache,
    // mais pas de notifications sans guardian.
    return null;
  }
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

    // Récupère élève + institution (NOT NULL)
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

    // Cookie device
    const jar = await cookies();
    let deviceId = jar.get("parent_device")?.value || "";
    let mustSet = false;
    if (!deviceId) {
      deviceId = newDeviceId();
      mustSet = true;
    }
    console.info(`[parent.attach:${id}] device`, { deviceId, mustSet });

    // Attache (idempotent) à parent_device_children
    const payload = {
      device_id: deviceId,
      student_id: student.id,
      institution_id: student.institution_id,
    };
    const { error: upErr } = await srv
      .from("parent_device_children")
      .upsert(payload, { onConflict: "device_id,student_id" });

    if (upErr) {
      console.error(`[parent.attach:${id}] upsert error`, upErr);
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    // S’assurer d’un parent_profile_id et créer le lien guardian (idempotent)
    try {
      const parentId = await ensureParentProfileForDevice(srv, deviceId);
      if (parentId) {
        const now = new Date().toISOString();
        await srv
          .from("student_guardians")
          .upsert(
            {
              student_id: student.id,
              parent_id: parentId,
              notifications_enabled: true,
              updated_at: now,
              // created_at sera rempli par défaut si présent côté DB
            } as any,
            { onConflict: "student_id,parent_id", ignoreDuplicates: false }
          );
      } else {
        console.warn(`[parent.attach:${id}] parent_profile_id_missing (no parent_devices / no rpc)`);
      }
    } catch (e: any) {
      console.warn(`[parent.attach:${id}] guardian_link_warn`, { err: String(e?.message || e) });
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
