// src/app/api/super/founders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

type FounderPayload = {
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  institution_ids?: string[];
  country?: string | null;
};

async function guardSuperAdmin() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, status: 401, error: "unauthorized" };

  const { data: roles, error } = await service
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (error) return { ok: false as const, status: 400, error: error.message };

  const isSuper = (roles ?? []).some((row: any) => row.role === "super_admin");
  if (!isSuper) return { ok: false as const, status: 403, error: "super_admin_required" };

  return { ok: true as const, userId: user.id };
}

async function findExistingUserId(opts: { phone: string | null; email: string | null }) {
  const service = getSupabaseServiceClient();

  if (opts.phone) {
    const { data } = await service
      .from("profiles")
      .select("id")
      .eq("phone", opts.phone)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  if (opts.email) {
    const { data } = await service
      .from("profiles")
      .select("id")
      .eq("email", opts.email)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  return null;
}

export async function GET() {
  const guard = await guardSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const service = getSupabaseServiceClient();

  const [{ data: institutions, error: instErr }, { data: founders, error: foundersErr }] =
    await Promise.all([
      service
        .from("institutions")
        .select("id,name,code_unique")
        .order("name", { ascending: true }),
      service
        .from("user_roles")
        .select(
          `
          profile_id,
          institution_id,
          role,
          profiles:profile_id ( id, display_name, email, phone ),
          institutions:institution_id ( id, name, code_unique )
        `,
        )
        .eq("role", "founder")
        .order("profile_id", { ascending: true }),
    ]);

  if (instErr) return NextResponse.json({ error: instErr.message }, { status: 400 });
  if (foundersErr) return NextResponse.json({ error: foundersErr.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    institutions: institutions ?? [],
    items: founders ?? [],
  });
}

export async function POST(req: NextRequest) {
  const guard = await guardSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const service = getSupabaseServiceClient();
  const body = (await req.json().catch(() => ({}))) as FounderPayload;

  const displayName = String(body.display_name || "").trim() || null;
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const phone =
    normalizePhone(body.phone ?? null, {
      defaultCountryAlpha2: body.country || "CI",
    }) || null;
  const password = String(body.password || "").trim() || DEFAULT_TEMP_PASSWORD;
  const institutionIds = Array.from(
    new Set(
      (Array.isArray(body.institution_ids) ? body.institution_ids : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );

  if (!phone && !email) {
    return NextResponse.json({ error: "email_or_phone_required" }, { status: 400 });
  }

  if (!institutionIds.length) {
    return NextResponse.json({ error: "institution_required" }, { status: 400 });
  }

  const { data: validInstitutions, error: validErr } = await service
    .from("institutions")
    .select("id")
    .in("id", institutionIds);

  if (validErr) return NextResponse.json({ error: validErr.message }, { status: 400 });

  const validIds = new Set((validInstitutions ?? []).map((row: any) => String(row.id)));
  const unknownIds = institutionIds.filter((id) => !validIds.has(id));
  if (unknownIds.length) {
    return NextResponse.json({ error: "invalid_institution", unknownIds }, { status: 400 });
  }

  let uid = await findExistingUserId({ phone, email });

  if (uid) {
    try {
      await service.auth.admin.updateUserById(uid, {
        password,
        email: email || undefined,
        phone: phone || undefined,
        email_confirm: !!email,
        phone_confirm: !!phone,
        user_metadata: { display_name: displayName, phone, email },
      });
    } catch (e) {
      console.warn("[super/founders] update auth skipped", (e as any)?.message || e);
    }
  } else {
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: email || undefined,
      phone: phone || undefined,
      password,
      email_confirm: !!email,
      phone_confirm: !!phone,
      user_metadata: { display_name: displayName, phone, email },
    });

    if (created?.user?.id) {
      uid = String(created.user.id);
    } else {
      uid = await findExistingUserId({ phone, email });
      if (!uid) {
        return NextResponse.json(
          { error: createErr?.message || "create_founder_failed" },
          { status: 400 },
        );
      }
    }
  }

  const firstInstitutionId = institutionIds[0];

  const { data: existingProfile, error: profileLookupErr } = await service
    .from("profiles")
    .select("id,institution_id,display_name,email,phone")
    .eq("id", uid)
    .maybeSingle();

  if (profileLookupErr) {
    return NextResponse.json({ error: profileLookupErr.message }, { status: 400 });
  }

  if (!existingProfile) {
    const { error: insertProfileErr } = await service.from("profiles").insert({
      id: uid,
      institution_id: firstInstitutionId,
      display_name: displayName,
      email,
      phone,
    });

    if (insertProfileErr) {
      return NextResponse.json({ error: insertProfileErr.message }, { status: 400 });
    }
  } else {
    const { error: updateProfileErr } = await service
      .from("profiles")
      .update({
        institution_id: existingProfile.institution_id || firstInstitutionId,
        display_name: displayName ?? existingProfile.display_name ?? null,
        email: email ?? existingProfile.email ?? null,
        phone: phone ?? existingProfile.phone ?? null,
      })
      .eq("id", uid);

    if (updateProfileErr) {
      return NextResponse.json({ error: updateProfileErr.message }, { status: 400 });
    }
  }

  // On remplace uniquement les rattachements founder de ce profil.
  // Cela évite de dépendre d’une contrainte unique spécifique pour un upsert.
  const { error: deleteRoleErr } = await service
    .from("user_roles")
    .delete()
    .eq("profile_id", uid)
    .eq("role", "founder");

  if (deleteRoleErr) {
    return NextResponse.json({ error: deleteRoleErr.message }, { status: 400 });
  }

  const roleRows = institutionIds.map((institutionId) => ({
    profile_id: uid,
    institution_id: institutionId,
    role: "founder",
  }));

  const { error: roleErr } = await service.from("user_roles").insert(roleRows);

  if (roleErr) {
    return NextResponse.json({ error: roleErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, profile_id: uid, attached: institutionIds.length });
}
