// src/app/api/admin/users/create/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone"; // âœ… source unique

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(req: Request) {
  const supaSrv = getSupabaseServiceClient();     // service (no RLS)
  const supa    = await getSupabaseServerClient(); // user-scoped (RLS)

  // Qui appelle ?
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Ã‰tablissement courant de lâ€™admin
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = (me?.institution_id as string) || null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // Payload
  const body = await req.json().catch(() => ({}));
  const role = body?.role as "teacher" | "parent";
  const emailRaw = (body?.email ?? null) as string | null;
  const display_name = (body?.display_name ?? null) as string | null;
  const subjectName = (body?.subject ?? null) as string | null; // optionnel (enseignant)
  const country = typeof body?.country === "string" && body.country.trim() ? String(body.country).trim() : undefined;

  const phone = normalizePhone(body?.phone ?? null, { defaultCountryAlpha2: country }) || null;
  const email = (emailRaw || "").trim().toLowerCase() || null;

  if (!role) return NextResponse.json({ error: "role_required" }, { status: 400 });
  // On garde la rÃ¨gle produit : le parent doit avoir un tÃ©lÃ©phone
  if (role === "parent" && !phone) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 1) RÃ©soudre / crÃ©er lâ€™utilisateur (idempotent)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let uid: string | null = null;

  // a) profiles â†’ id
  if (phone) {
    const { data } = await supaSrv.from("profiles").select("id").eq("phone", phone).maybeSingle();
    if (data?.id) uid = String(data.id);
  }
  if (!uid && email) {
    const { data } = await supaSrv.from("profiles").select("id").eq("email", email).maybeSingle();
    if (data?.id) uid = String(data.id);
  }

  // helper : auth.users lookup
  const findInAuth = async () => {
    if (phone) {
      const { data } = await supaSrv.from("auth.users").select("id").eq("phone", phone).maybeSingle();
      if (data?.id) return String(data.id);
    }
    if (email) {
      const { data } = await supaSrv.from("auth.users").select("id").eq("email", email).maybeSingle();
      if (data?.id) return String(data.id);
    }
    return null;
  };

  // b) auth.users â†’ id
  if (!uid) {
    uid = await findInAuth();
  }

  // c) crÃ©er si toujours introuvable (avec fallback course/doublon)
  if (!uid) {
    const { data: created, error: cErr } = await supaSrv.auth.admin.createUser({
      email: email || undefined,
      phone: phone || undefined,
      password: DEFAULT_TEMP_PASSWORD,
      email_confirm: !!email,
      phone_confirm: !!phone,
      user_metadata: { display_name, phone, email },
    });
    if (created?.user?.id) {
      uid = created.user.id as string;
    } else {
      uid = await findInAuth();
      if (!uid) {
        return NextResponse.json({ error: cErr?.message ?? "createUser_failed" }, { status: 400 });
      }
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 2) Upsert profil SANS Ã©craser institution_id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: existingProfile } = await supaSrv
    .from("profiles")
    .select("id,institution_id,display_name,email,phone")
    .eq("id", uid)
    .maybeSingle();

  if (!existingProfile) {
    // premiÃ¨re insertion â†’ on dÃ©finit institution_id
    const { error: pInsErr } = await supaSrv.from("profiles").insert({
      id: uid,
      institution_id: inst,
      display_name: display_name || null,
      email: email ?? null,
      phone: phone ?? null,
    });
    if (pInsErr) return NextResponse.json({ error: pInsErr.message }, { status: 400 });
  } else {
    // update sans toucher institution_id
    const { error: pUpdErr } = await supaSrv
      .from("profiles")
      .update({
        display_name: display_name ?? existingProfile.display_name ?? null,
        email: email ?? existingProfile.email ?? null,
        phone: phone ?? existingProfile.phone ?? null,
      })
      .eq("id", uid);
    if (pUpdErr) return NextResponse.json({ error: pUpdErr.message }, { status: 400 });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 3) Upsert du rÃ´le (idempotent)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { error: rErr } = await supaSrv
    .from("user_roles")
    .upsert({ profile_id: uid, institution_id: inst, role }, { onConflict: "profile_id,institution_id,role" });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 4) MatiÃ¨re optionnelle (enseignant)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (role === "teacher" && subjectName) {
    const code = slug(subjectName).slice(0, 12).toUpperCase();
    const { data: subj1 } = await supaSrv
      .from("subjects")
      .select("id")
      .ilike("name", subjectName)
      .maybeSingle();

    let subject_id = subj1?.id as string | undefined;

    if (!subject_id) {
      const { data: createdSubj, error: sErr } = await supaSrv
        .from("subjects")
        .insert({ code, name: subjectName })
        .select("id")
        .maybeSingle();
      if (!sErr) subject_id = createdSubj?.id;
      else console.warn("subjects insert failed:", sErr.message);
    }

    if (subject_id) {
      await supaSrv
        .from("institution_subjects")
        .upsert(
          { institution_id: inst, subject_id, custom_name: null, is_active: true },
          { onConflict: "institution_id,subject_id" }
        );

      try {
        await supaSrv
          .from("teacher_subjects")
          .upsert(
            { profile_id: uid, subject_id, institution_id: inst },
            { onConflict: "profile_id,subject_id,institution_id" }
          );
      } catch (e) {
        console.warn("teacher_subjects upsert skipped:", (e as any)?.message);
      }
    }
  }

  return NextResponse.json({ ok: true, user_id: uid });
}


