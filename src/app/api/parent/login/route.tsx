//src/app/api/parent/login/route.tsx
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  signParentJWT,
  buildParentSessionCookie,
} from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

/* Normalisation tolérante du matricule saisi */
function normalizeMatricule(raw: string) {
  const s = String(raw || "").trim();
  // garde tirets, supprime espaces, uppercase
  return s.replace(/\s+/g, "").toUpperCase();
}

/* Construit un email synthétique stable pour le “parent fantôme” */
function syntheticEmailFor(matricule: string) {
  const slug = matricule.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `parent+${slug}@example.invalid`; // domaine réservé, jamais associé à une boîte réelle
}

/* 1) Résout l’élève par matricule (tolérant) */
async function findStudentByMatricule(srv: any, matriculeRaw: string) {
  const norm = normalizeMatricule(matriculeRaw);

  // Tentative 1 : ILIKE exact (insensible à la casse)
  let { data: st, error: e1 } = await srv
    .from("students")
    .select("id, matricule, institution_id, full_name, parent_activation_code")
    .ilike("matricule", norm)
    .maybeSingle();

  // Fallback : si l’école stocke avec tiret/espaces différents, on tente la variante sans tiret
  if (!st) {
    const noDash = norm.replace(/-/g, "");
    const { data: st2 } = await srv
      .from("students")
      .select("id, matricule, institution_id, full_name, parent_activation_code")
      .or(`matricule.ilike.${norm},matricule.ilike.${noDash}`)
      .limit(1)
      .maybeSingle();
    st = st2 || null;
  }

  if (!st) {
    const err: any = new Error("Matricule introuvable.");
    err.status = 404;
    throw err;
  }
  return st as {
    id: string;
    matricule: string;
    institution_id: string | null;
    full_name: string | null;
    parent_activation_code: string | null;
  };
}

/* 2) Crée ou résout le “parent fantôme” à partir du matricule élève */
async function resolveOrCreateShadowParent(srv: any, matricule: string, displayName?: string | null) {
  const email = syntheticEmailFor(matricule);

  // a) Déjà dans auth.users ?
  const { data: u1 } = await srv
    .from("auth.users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let uid: string | null = u1?.id ?? null;

  // b) Si absent → créer via admin
  if (!uid) {
    const created = await srv.auth.admin.createUser({
      email,
      password: DEFAULT_TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        kind: "parent_shadow",
        matricule,
        source: "parents_login_matricule",
      },
    });

    if (created.error) {
      // Collision possible si créé en parallèle → relookup
      const { data: u2 } = await srv
        .from("auth.users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      uid = u2?.id ?? null;
      if (!uid) {
        const err: any = new Error(created.error.message || "create_shadow_parent_failed");
        err.status = 400;
        throw err;
      }
    } else {
      uid = created.user?.id as string;
    }
  }

  // c) Profil minimal
  await srv.from("profiles").upsert(
    {
      id: uid,
      email,
      display_name: displayName ? `Parent de ${displayName}` : null,
    },
    { onConflict: "id" }
  );

  return uid!;
}

/* 3) Lie le parent à l’élève (student_guardians) + rôle parent */
async function linkParentToStudent(srv: any, parentId: string, studentId: string, instId: string | null) {
  if (instId) {
    await srv.from("user_roles").upsert(
      { profile_id: parentId, institution_id: instId, role: "parent" },
      { onConflict: "profile_id,institution_id,role" }
    );
  }

  // Upsert lien + notifs activées par défaut
  // onConflict sur (parent_id, student_id)
  const up = await srv
    .from("student_guardians")
    .upsert(
      {
        parent_id: parentId,
        student_id: studentId,
        institution_id: instId,
        notifications_enabled: true,
      } as any,
      { onConflict: "parent_id,student_id" }
    );

  if (up.error) {
    // Fallback sans institution_id si contrainte gênante
    const up2 = await srv
      .from("student_guardians")
      .upsert(
        { parent_id: parentId, student_id: studentId, notifications_enabled: true } as any,
        { onConflict: "parent_id,student_id" }
      );
    if (up2.error) {
      const err: any = new Error(up2.error.message);
      err.status = 400;
      throw err;
    }
  }
}

/* ───────────────────────────── Route ───────────────────────────── */
export async function POST(req: NextRequest) {
  const srv = getSupabaseServiceClient();

  let body: { matricule?: string; pin?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const matriculeRaw = String(body.matricule || "").trim();
  const pin = (body.pin ?? null) ? String(body.pin).trim() : null;

  if (!matriculeRaw) {
    return NextResponse.json({ error: "missing_matricule" }, { status: 400 });
  }

  try {
    // 1) Trouver l’élève
    const st = await findStudentByMatricule(srv, matriculeRaw);

    // 2) Si un PIN est configuré sur l’élève, il doit matcher
    if (st.parent_activation_code && (pin || "") !== st.parent_activation_code) {
      return NextResponse.json({ error: "pin_invalid" }, { status: 401 });
    }

    // 3) Résoudre / créer le “parent fantôme”
    const uid = await resolveOrCreateShadowParent(srv, st.matricule || normalizeMatricule(matriculeRaw), st.full_name);

    // 4) Lier parent ↔ élève et activer notifs (DB)
    await linkParentToStudent(srv, uid, st.id, st.institution_id);

    // 5) Émettre le cookie de session parent (JWT HMAC)
    const token = signParentJWT({ uid, sid: st.id, m: st.matricule || normalizeMatricule(matriculeRaw) });
    const setCookie = buildParentSessionCookie(token);

    return new NextResponse(
      JSON.stringify({
        ok: true,
        student_id: st.id,
        user_id: uid,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": setCookie,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e: any) {
    const status = Number(e?.status) || 400;
    const msg = String(e?.message || "login_failed");
    return NextResponse.json({ error: msg }, { status });
  }
}
