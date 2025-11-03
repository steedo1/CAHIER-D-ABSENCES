// app/api/admin/classes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

/** Mot de passe par défaut pour tout compte “classe” */
const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

/** Récupère l'établissement du user courant (RLS) */
async function getMyInstitutionId() {
  const supabaseAuth = await getSupabaseServerClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  if (!me?.institution_id) return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };

  return { institution_id: me.institution_id as string };
}

/**
 * Assure un utilisateur Auth pour ce téléphone, en gérant les variantes CI:
 *   +2250…… (avec 0) ET +225…… (sans 0)
 * Ordre préféré: **avec 0** d'abord (si +225), puis sans 0, puis la valeur d’entrée.
 * Retourne { uid, phoneUsed } et remet le mot de passe.
 */
async function ensureAuthUserWithPasswordFlexible(phoneE164: string): Promise<{ uid: string; phoneUsed: string }> {
  const srv = getSupabaseServiceClient();

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => { if (!seen.has(v)) { seen.add(v); candidates.push(v); } };

  if (phoneE164.startsWith("+225")) {
    const rest = phoneE164.slice(4);
    const with0 = rest.startsWith("0") ? rest : "0" + rest.replace(/^0+/, "");
    const no0   = rest.replace(/^0+/, "");
    // Préférer la variante AVEC 0 pour la CI
    add("+225" + with0);
    add("+225" + no0);
    add(phoneE164);
  } else {
    add(phoneE164);
  }

  // 1) lookup
  for (const p of candidates) {
    const { data } = await srv.from("auth.users").select("id").eq("phone", p).maybeSingle();
    if (data?.id) {
      const uid = String(data.id);
      try { await srv.auth.admin.updateUserById(uid, { password: DEFAULT_TEMP_PASSWORD }); } catch {}
      return { uid, phoneUsed: p };
    }
  }

  // 2) create (première qui passe)
  for (const p of candidates) {
    const { data: created } = await srv.auth.admin.createUser({
      phone: p,
      phone_confirm: true,
      password: DEFAULT_TEMP_PASSWORD,
    });
    if (created?.user?.id) {
      return { uid: String(created.user.id), phoneUsed: p };
    }
  }

  // 3) re-lookup (concurrence)
  for (const p of candidates) {
    const { data } = await srv.from("auth.users").select("id").eq("phone", p).maybeSingle();
    if (data?.id) {
      const uid = String(data.id);
      try { await srv.auth.admin.updateUserById(uid, { password: DEFAULT_TEMP_PASSWORD }); } catch {}
      return { uid, phoneUsed: p };
    }
  }

  throw new Error("auth_user_create_failed");
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 15
) {
  const { id } = await context.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));

  const row: Record<string, any> = {};
  if (typeof body.label === "string") row.label = body.label.trim();
  if (typeof body.level === "string") row.level = body.level.trim();
  if (typeof body.code === "string" || body.code === null) row.code = body.code ?? null;
  if (typeof body.academic_year === "string" || body.academic_year === null)
    row.academic_year = body.academic_year ?? null;

  // ——— Normalisation EXACTEMENT comme /api/admin/users/create ———
  const country =
    typeof body?.country === "string" && body.country.trim()
      ? String(body.country).trim()
      : undefined;

  let newClassPhoneE164: string | null | undefined = undefined; // undefined = non fourni
  if (Object.prototype.hasOwnProperty.call(body, "class_phone")) {
    if (body.class_phone === null || body.class_phone === "") {
      newClassPhoneE164 = null; // effacer
    } else if (typeof body.class_phone === "string" || typeof body.class_phone === "number") {
      const normalized = normalizePhone(String(body.class_phone), { defaultCountryAlpha2: country }) || null;
      if (!normalized) {
        // UI attend 400 pour afficher "Numéro invalide"
        return NextResponse.json({ error: "class_phone_invalid" }, { status: 400 });
      }
      newClassPhoneE164 = normalized;
    } else {
      return NextResponse.json({ error: "class_phone_bad_type" }, { status: 400 });
    }
  }

  if (Object.keys(row).length === 0 && typeof newClassPhoneE164 === "undefined") {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const srv = getSupabaseServiceClient();

  // ——— Si on fixe un téléphone, créer/assurer le compte + profil + rôle class_device ———
  try {
    if (typeof newClassPhoneE164 === "string" && newClassPhoneE164) {
      const { uid, phoneUsed } = await ensureAuthUserWithPasswordFlexible(newClassPhoneE164);

      // On enregistre EXACTEMENT le phone qui marche côté Auth (préférence CI = avec 0)
      row.class_phone_e164 = phoneUsed;

      // profil (idempotent, ne touche pas l'institution si déjà posé)
      const { data: existingProfile } = await srv
        .from("profiles")
        .select("id,display_name,phone")
        .eq("id", uid)
        .maybeSingle();

      if (!existingProfile) {
        await srv.from("profiles").insert({
          id: uid,
          institution_id,
          display_name: row.label ?? null,
          email: null,
          phone: phoneUsed,
        });
      } else {
        await srv
          .from("profiles")
          .update({
            phone: phoneUsed,
            display_name: existingProfile.display_name ?? (row.label ?? null),
          })
          .eq("id", uid);
      }

      // rôle class_device (idempotent)
      await srv
        .from("user_roles")
        .upsert(
          { profile_id: uid, institution_id, role: "class_device" },
          { onConflict: "profile_id,institution_id,role" }
        );
    } else if (newClassPhoneE164 === null) {
      row.class_phone_e164 = null; // suppression simple
    }
  } catch (e: any) {
    // UI mappe 400 -> “Numéro invalide” : on reste en 400
    return NextResponse.json(
      { error: "class_phone_auth_failed", details: e?.message ?? null },
      { status: 400 }
    );
  }

  // ——— Mise à jour de la classe ———
  const { data, error: dbErr } = await srv
    .from("classes")
    .update(row)
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id,label,level,code,academic_year,class_phone_e164")
    .maybeSingle();

  if (dbErr) {
    const isUnique = (dbErr as any).code === "23505";
    return NextResponse.json({ error: dbErr.message }, { status: isUnique ? 409 : 400 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("classes")
    .delete()
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id")
    .maybeSingle();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
