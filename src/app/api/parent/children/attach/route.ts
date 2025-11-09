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
function randPwd(n = 24) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map((b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charAt(b % 62))
    .join("");
}

/* ───────── helpers ───────── */
/** Crée (si besoin) un vrai user Auth et un profile, puis renvoie son id. */
async function ensureAuthBackedParentId(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  deviceId: string,
  institutionId?: string
): Promise<string | null> {
  // 1) Lire l’entrée device
  const dev = await srv
    .from("parent_devices")
    .select("device_id,parent_profile_id")
    .eq("device_id", deviceId)
    .maybeSingle();

  let parentId = dev.data?.parent_profile_id ?? null;

  // 2) Si on a déjà un parentId, vérifier qu’il existe dans profiles
  if (parentId) {
    const prof = await srv.from("profiles").select("id").eq("id", parentId).maybeSingle();
    if (prof.data?.id) {
      return parentId; // tout est bon
    }
  }

  // 3) Créer un vrai user Auth (email factice unique) → id garanti
  const email = `parent+${deviceId}@parents.local`;
  const pass = randPwd();
  const created = await srv.auth.admin.createUser({
    email,
    password: pass,
    email_confirm: true,
    user_metadata: { origin: "parent_device", device_id: deviceId },
  });
  if (created.error || !created.data?.user?.id) {
    console.warn("[parent.attach] auth_admin_createUser_err", { err: created.error?.message });
    return null;
  }
  parentId = created.data.user.id;

  // 4) Aligner parent_devices
  if (!dev.data) {
    const ins = await srv
      .from("parent_devices")
      .insert({ device_id: deviceId, parent_profile_id: parentId })
      .select("parent_profile_id")
      .maybeSingle();
    if (ins.error) {
      console.warn("[parent.attach] parent_devices_insert_err", { err: ins.error.message });
    }
  } else {
    const up = await srv
      .from("parent_devices")
      .update({ parent_profile_id: parentId })
      .eq("device_id", deviceId);
    if (up.error) {
      console.warn("[parent.attach] parent_devices_update_err", { err: up.error.message });
    }
  }

  // 5) Assurer profiles(id = auth.users.id)
  const payload: any = { id: parentId };
  if (institutionId) payload.institution_id = institutionId;
  const profIns = await srv.from("profiles").insert(payload);
  if (profIns.error?.message?.includes("violates foreign key constraint")) {
    // S’il y a encore un FK, c’est que l’admin user n’a pas pris → on abandonne proprement
    console.warn("[parent.attach] ensureProfile FK_err", { err: profIns.error.message, payload });
    return null;
  }
  if (profIns.error) {
    // Already exists ou autre → pas bloquant
    console.info("[parent.attach] ensureProfile warn_or_exists", { err: profIns.error.message });
  } else {
    console.info("[parent.attach] ensureProfile insert_ok", { parentId });
  }

  // 6) (Optionnel) Rôle parent si table présente
  if (institutionId) {
    const exists = await srv
      .from("user_roles")
      .select("profile_id")
      .eq("profile_id", parentId)
      .eq("institution_id", institutionId)
      .maybeSingle();
    if (!exists.data?.profile_id) {
      const ur = await srv
        .from("user_roles")
        .insert({ profile_id: parentId, institution_id: institutionId, role: "parent" as any });
      if (ur.error) console.warn("[parent.attach] user_roles_insert_err", { err: ur.error.message });
      else console.info("[parent.attach] user_roles_insert_ok", { parentId, institutionId });
    }
  }

  return parentId;
}

/** Crée (au minimum) la ligne guardian idempotente. */
async function ensureGuardianLink(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  studentId: string,
  parentId: string
) {
  // On évite ON CONFLICT si l’index n’existe pas, en simulant l’idempotence
  const got = await srv
    .from("student_guardians")
    .select("student_id,parent_id")
    .eq("student_id", studentId)
    .eq("parent_id", parentId)
    .maybeSingle();
  if (got.data?.student_id) return;

  const ins = await srv
    .from("student_guardians")
    .insert({ institution_id: institutionId, student_id: studentId, parent_id: parentId } as any);
  if (ins.error) {
    console.warn("[parent.attach] guardian_insert_err", { err: ins.error.message });
  } else {
    console.info("[parent.attach] guardian_insert_ok", { studentId, parentId });
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
      return NextResponse.json({ error: "MATRICULE_REQUIRED" }, { status: 400 });
    }

    // Élève + institution
    const { data: rows, error: sErr } = await srv
      .from("students")
      .select("id, matricule, institution_id")
      .ilike("matricule", matricule)
      .order("created_at", { ascending: false })
      .limit(1);

    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
    const student = (rows ?? [])[0];
    if (!student) return NextResponse.json({ error: "MATRICULE_NOT_FOUND" }, { status: 404 });
    if (!student.institution_id)
      return NextResponse.json({ error: "STUDENT_MISSING_INSTITUTION" }, { status: 400 });

    // Cookie device
    const jar = await cookies();
    let deviceId = jar.get("parent_device")?.value || "";
    let mustSet = false;
    if (!deviceId) {
      deviceId = newDeviceId();
      mustSet = true;
    }
    console.info(`[parent.attach:${id}] device`, { deviceId, mustSet });

    // Lier device ↔ enfant (idempotent)
    const link = {
      device_id: deviceId,
      student_id: student.id,
      institution_id: student.institution_id,
    };
    const up = await srv.from("parent_device_children").upsert(link, { onConflict: "device_id,student_id" });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 });

    // Assurer un vrai user Auth + profile pour ce device, puis guardian
    const parentId = await ensureAuthBackedParentId(srv, deviceId, student.institution_id);
    if (parentId) {
      await ensureGuardianLink(srv, student.institution_id, student.id, parentId);
      console.info(`[parent.attach:${id}] guardian_ok`, { parentId });
    } else {
      console.warn(`[parent.attach:${id}] parent_profile_unresolved`);
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
        secure: process.env.NODE_ENV === "production",
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
