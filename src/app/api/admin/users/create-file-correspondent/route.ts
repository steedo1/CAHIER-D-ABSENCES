import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";
const FILE_CORRESPONDENT_ROLE = "file_correspondent";

function cleanEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email || null;
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: callerProfile, error: profileError } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const institutionId = String(callerProfile?.institution_id || "").trim();
  if (!institutionId) {
    return NextResponse.json({ error: "no_institution" }, { status: 400 });
  }

  const { data: callerRoles, error: rolesError } = await service
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (rolesError) {
    return NextResponse.json({ error: rolesError.message }, { status: 400 });
  }

  const allowed = (callerRoles ?? []).some((row: any) => {
    const role = String(row.role || "");
    if (role === "super_admin") return true;
    return role === "admin" && String(row.institution_id || "") === institutionId;
  });

  if (!allowed) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const displayName =
    typeof body?.display_name === "string" && body.display_name.trim()
      ? body.display_name.trim()
      : null;
  const email = cleanEmail(body?.email);
  const country =
    typeof body?.country === "string" && body.country.trim()
      ? body.country.trim()
      : undefined;
  const phone =
    normalizePhone(body?.phone ?? null, {
      defaultCountryAlpha2: country,
    }) || null;

  if (!phone) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }

  let profileId: string | null = null;
  let existingInstitutionId: string | null = null;

  const { data: byPhone, error: phoneLookupError } = await service
    .from("profiles")
    .select("id,institution_id")
    .eq("phone", phone)
    .maybeSingle();

  if (phoneLookupError) {
    return NextResponse.json({ error: phoneLookupError.message }, { status: 400 });
  }

  if (byPhone?.id) {
    profileId = String(byPhone.id);
    existingInstitutionId = byPhone.institution_id
      ? String(byPhone.institution_id)
      : null;
  }

  if (!profileId && email) {
    const { data: byEmail, error: emailLookupError } = await service
      .from("profiles")
      .select("id,institution_id")
      .eq("email", email)
      .maybeSingle();

    if (emailLookupError) {
      return NextResponse.json({ error: emailLookupError.message }, { status: 400 });
    }

    if (byEmail?.id) {
      profileId = String(byEmail.id);
      existingInstitutionId = byEmail.institution_id
        ? String(byEmail.institution_id)
        : null;
    }
  }

  if (
    profileId &&
    existingInstitutionId &&
    existingInstitutionId !== institutionId
  ) {
    return NextResponse.json(
      { error: "account_attached_to_another_institution" },
      { status: 409 },
    );
  }

  if (!profileId) {
    const { data: created, error: createError } =
      await service.auth.admin.createUser({
        email: email || undefined,
        phone,
        password: DEFAULT_TEMP_PASSWORD,
        email_confirm: Boolean(email),
        phone_confirm: true,
        user_metadata: {
          display_name: displayName,
          phone,
          email,
        },
      });

    if (createError || !created?.user?.id) {
      return NextResponse.json(
        { error: createError?.message || "create_user_failed" },
        { status: 400 },
      );
    }

    profileId = String(created.user.id);
  }

  const { error: profileUpsertError } = await service
    .from("profiles")
    .upsert(
      {
        id: profileId,
        institution_id: institutionId,
        display_name: displayName,
        phone,
        email,
      },
      { onConflict: "id" },
    );

  if (profileUpsertError) {
    return NextResponse.json({ error: profileUpsertError.message }, { status: 400 });
  }

  const { error: roleError } = await service
    .from("user_roles")
    .upsert(
      {
        profile_id: profileId,
        institution_id: institutionId,
        role: FILE_CORRESPONDENT_ROLE,
      },
      { onConflict: "profile_id,institution_id,role" },
    );

  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    user_id: profileId,
    role: FILE_CORRESPONDENT_ROLE,
  });
}
