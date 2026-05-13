// src/app/api/admin/classes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

const OFFICIAL_TRACK_CODES = new Set<string>([
  "6eme",
  "5eme",
  "4eme",
  "3eme",
  "2ndeA",
  "2ndeC",
  "1ereA1",
  "1ereA2",
  "1ereC",
  "1ereD",
  "tleA1",
  "tleA2",
  "tleC",
  "tleD",
]);

async function getMyInstitutionId() {
  const supabaseAuth = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  if (!me?.institution_id) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  return { institution_id: me.institution_id as string };
}

function cleanOfficialTrackCode(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("bad_official_track_code");

  const cleaned = value.trim();
  if (!OFFICIAL_TRACK_CODES.has(cleaned)) {
    throw new Error("bad_official_track_code");
  }

  return cleaned;
}

async function ensureAuthUserWithPasswordFlexible(phoneE164: string): Promise<{ uid: string; phoneUsed: string }> {
  const srv = getSupabaseServiceClient();

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => {
    if (!seen.has(v)) {
      seen.add(v);
      candidates.push(v);
    }
  };

  if (phoneE164.startsWith("+225")) {
    const rest = phoneE164.slice(4);
    const with0 = rest.startsWith("0") ? rest : "0" + rest.replace(/^0+/, "");
    const no0 = rest.replace(/^0+/, "");
    add("+225" + with0);
    add("+225" + no0);
    add(phoneE164);
  } else {
    add(phoneE164);
  }

  for (const p of candidates) {
    const { data } = await srv.from("auth.users").select("id").eq("phone", p).maybeSingle();
    if (data?.id) {
      const uid = String(data.id);
      try {
        await srv.auth.admin.updateUserById(uid, { password: DEFAULT_TEMP_PASSWORD });
      } catch {}
      return { uid, phoneUsed: p };
    }
  }

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

  for (const p of candidates) {
    const { data } = await srv.from("auth.users").select("id").eq("phone", p).maybeSingle();
    if (data?.id) {
      const uid = String(data.id);
      try {
        await srv.auth.admin.updateUserById(uid, { password: DEFAULT_TEMP_PASSWORD });
      } catch {}
      return { uid, phoneUsed: p };
    }
  }

  throw new Error("auth_user_create_failed");
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const srv = getSupabaseServiceClient();

  const { data: current, error: currentErr } = await srv
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,class_phone_e164")
    .eq("id", id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  if (currentErr) {
    return NextResponse.json({ error: currentErr.message }, { status: 400 });
  }

  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row: Record<string, any> = {};

  if (typeof body.label === "string") row.label = body.label.trim();
  if (typeof body.level === "string") row.level = body.level.trim();
  if (typeof body.code === "string" || body.code === null) row.code = body.code ?? null;
  if (typeof body.academic_year === "string" || body.academic_year === null) {
    row.academic_year = body.academic_year ?? null;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "official_track_code") ||
    Object.prototype.hasOwnProperty.call(body, "officialTrackCode")
  ) {
    try {
      row.official_track_code = cleanOfficialTrackCode(body.official_track_code ?? body.officialTrackCode ?? null);
    } catch {
      return NextResponse.json({ error: "bad_official_track_code" }, { status: 400 });
    }
  }

  const country =
    typeof body?.country === "string" && body.country.trim() ? String(body.country).trim() : undefined;

  let newClassPhoneE164: string | null | undefined = undefined;
  if (Object.prototype.hasOwnProperty.call(body, "class_phone")) {
    if (body.class_phone === null || body.class_phone === "") {
      newClassPhoneE164 = null;
    } else if (typeof body.class_phone === "string" || typeof body.class_phone === "number") {
      const normalized = normalizePhone(String(body.class_phone), { defaultCountryAlpha2: country }) || null;
      if (!normalized) {
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

  const nextLabel = typeof row.label === "string" ? row.label : current.label;
  const nextAcademicYear = Object.prototype.hasOwnProperty.call(row, "academic_year")
    ? row.academic_year
    : current.academic_year;

  if (
    nextLabel &&
    (nextLabel !== current.label || nextAcademicYear !== current.academic_year)
  ) {
    let duplicateQuery = srv
      .from("classes")
      .select("id")
      .eq("institution_id", institution_id)
      .eq("label", nextLabel)
      .neq("id", id)
      .limit(1);

    duplicateQuery = nextAcademicYear
      ? duplicateQuery.eq("academic_year", nextAcademicYear)
      : duplicateQuery.is("academic_year", null);

    const { data: duplicate, error: duplicateErr } = await duplicateQuery.maybeSingle();

    if (duplicateErr) {
      return NextResponse.json({ error: duplicateErr.message }, { status: 400 });
    }

    if (duplicate?.id) {
      return NextResponse.json({ error: "class_already_exists_for_academic_year" }, { status: 409 });
    }
  }

  try {
    if (typeof newClassPhoneE164 === "string" && newClassPhoneE164) {
      const { uid, phoneUsed } = await ensureAuthUserWithPasswordFlexible(newClassPhoneE164);
      row.class_phone_e164 = phoneUsed;

      const { data: existingProfile } = await srv
        .from("profiles")
        .select("id,display_name,phone")
        .eq("id", uid)
        .maybeSingle();

      if (!existingProfile) {
        await srv.from("profiles").insert({
          id: uid,
          institution_id,
          display_name: row.label ?? current.label ?? null,
          email: null,
          phone: phoneUsed,
        });
      } else {
        await srv
          .from("profiles")
          .update({
            phone: phoneUsed,
            display_name: existingProfile.display_name ?? (row.label ?? current.label ?? null),
          })
          .eq("id", uid);
      }

      await srv
        .from("user_roles")
        .upsert(
          { profile_id: uid, institution_id, role: "class_device" },
          { onConflict: "profile_id,institution_id,role" }
        );
    } else if (newClassPhoneE164 === null) {
      row.class_phone_e164 = null;
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: "class_phone_auth_failed", details: e?.message ?? null },
      { status: 400 }
    );
  }

  const { data, error: dbErr } = await srv
    .from("classes")
    .update(row)
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id,label,level,code,academic_year,official_track_code,class_phone_e164")
    .maybeSingle();

  if (dbErr) {
    const isUnique = (dbErr as any).code === "23505";
    return NextResponse.json({ error: dbErr.message }, { status: isUnique ? 409 : 400 });
  }

  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
