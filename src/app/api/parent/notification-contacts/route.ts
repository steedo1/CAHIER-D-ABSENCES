// src/app/api/parent/notification-contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Types
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type ResolvedParent = {
  profile_id: string;
  institution_ids: string[];
  preferred_institution_id: string | null;
  source: "parent_jwt" | "supabase_auth" | "parent_device";
};

type ContactRow = {
  id: string;
  institution_id: string | null;
  profile_id: string;
  phone_e164: string;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  is_primary: boolean;
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type ChannelSettingRow = {
  institution_id: string;
  push_enabled: boolean;
  sms_premium_enabled: boolean;
  sms_provider: string | null;
  sms_sender_name: string | null;
  sms_absence_enabled: boolean;
  sms_late_enabled: boolean;
  sms_notes_digest_enabled: boolean;
  sms_notes_digest_weekday: number | null;
  sms_notes_digest_hour: number | null;
  whatsapp_premium_enabled: boolean;
};

type PostBody = {
  phone?: string;
  phone_e164?: string;
  institution_id?: string | null;
  sms_enabled?: boolean;
  whatsapp_enabled?: boolean;
  is_primary?: boolean;
  verified?: boolean;
};

type PatchBody = {
  id?: string;
  phone?: string;
  phone_e164?: string;
  institution_id?: string | null;
  sms_enabled?: boolean;
  whatsapp_enabled?: boolean;
  is_primary?: boolean;
  verified?: boolean;
};

type DeleteBody = {
  id?: string;
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Helpers
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function shortId(v: unknown, n = 16) {
  const x = s(v);
  if (!x) return x;
  return x.length <= n ? x : `${x.slice(0, Math.max(4, Math.floor(n / 2)))}â€¦${x.slice(-Math.max(4, Math.floor(n / 2)))}`;
}

function toBool(v: unknown, fallback: boolean) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const x = v.trim().toLowerCase();
    if (["true", "1", "yes", "oui", "on"].includes(x)) return true;
    if (["false", "0", "no", "non", "off"].includes(x)) return false;
  }
  return fallback;
}

function normalizePhoneE164(raw: string): string {
  let input = s(raw);
  if (!input) {
    const err: any = new Error("PHONE_REQUIRED");
    err.status = 400;
    throw err;
  }

  // nettoyage soft
  input = input.replace(/[()\-.]/g, " ").replace(/\s+/g, "");
  if (input.startsWith("00")) input = `+${input.slice(2)}`;

  // dÃ©jÃ  en +E164
  if (input.startsWith("+")) {
    const digits = input.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      const err: any = new Error("PHONE_INVALID_E164");
      err.status = 400;
      throw err;
    }
    return `+${digits}`;
  }

  const digits = input.replace(/\D/g, "");

  // Cas CÃ´te dâ€™Ivoire
  // - local 8 ou 10 chiffres -> +225...
  if (digits.length === 8 || digits.length === 10) {
    return `+225${digits}`;
  }

  // - dÃ©jÃ  avec 225 sans +
  if (digits.startsWith("225") && digits.length >= 11 && digits.length <= 13) {
    return `+${digits}`;
  }

  const err: any = new Error("PHONE_INVALID");
  err.status = 400;
  throw err;
}

async function resolveInstitutionIdsForParent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileId: string,
  studentId?: string | null,
  deviceId?: string | null,
): Promise<{ institution_ids: string[]; preferred_institution_id: string | null }> {
  const set = new Set<string>();

  // 1) profile.institution_id
  try {
    const { data: prof } = await srv
      .from("profiles")
      .select("institution_id")
      .eq("id", profileId)
      .maybeSingle();

    if (prof?.institution_id) set.add(String(prof.institution_id));
  } catch {}

  // 2) student_guardians.parent_id -> institution_id
  try {
    const { data: links } = await srv
      .from("student_guardians")
      .select("institution_id")
      .eq("parent_id", profileId);

    for (const row of links || []) {
      if ((row as any)?.institution_id) set.add(String((row as any).institution_id));
    }
  } catch {}

  // 3) Ã©tudiant de la session parent JWT
  if (studentId) {
    try {
      const { data: st } = await srv
        .from("students")
        .select("institution_id")
        .eq("id", studentId)
        .maybeSingle();

      if (st?.institution_id) set.add(String(st.institution_id));
    } catch {}
  }

  // 4) fallback parent_device_children
  if (deviceId) {
    try {
      const { data: rows } = await srv
        .from("parent_device_children")
        .select("institution_id")
        .eq("device_id", deviceId);

      for (const row of rows || []) {
        if ((row as any)?.institution_id) set.add(String((row as any).institution_id));
      }
    } catch {}
  }

  const institution_ids = Array.from(set);
  const preferred_institution_id = institution_ids.length === 1 ? institution_ids[0] : null;

  return { institution_ids, preferred_institution_id };
}

async function resolveActiveParent(req: NextRequest): Promise<ResolvedParent | null> {
  const srv = getSupabaseServiceClient();

  // 1) parent JWT
  try {
    const claims = readParentSessionFromReq(req);
    if (claims?.uid) {
      const resolved = await resolveInstitutionIdsForParent(
        srv,
        String(claims.uid),
        claims.sid ? String(claims.sid) : null,
        null,
      );

      return {
        profile_id: String(claims.uid),
        institution_ids: resolved.institution_ids,
        preferred_institution_id: resolved.preferred_institution_id,
        source: "parent_jwt",
      };
    }
  } catch {}

  // 2) supabase auth
  try {
    const supa = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (user?.id) {
      const resolved = await resolveInstitutionIdsForParent(
        srv,
        String(user.id),
        null,
        null,
      );

      return {
        profile_id: String(user.id),
        institution_ids: resolved.institution_ids,
        preferred_institution_id: resolved.preferred_institution_id,
        source: "supabase_auth",
      };
    }
  } catch {}

  // 3) fallback device
  try {
    const deviceId = req.cookies.get("parent_device")?.value || "";
    if (deviceId) {
      const { data: dev } = await srv
        .from("parent_devices")
        .select("parent_profile_id")
        .eq("device_id", deviceId)
        .maybeSingle();

      const pid = s(dev?.parent_profile_id);
      if (pid) {
        const resolved = await resolveInstitutionIdsForParent(
          srv,
          pid,
          null,
          deviceId,
        );

        return {
          profile_id: pid,
          institution_ids: resolved.institution_ids,
          preferred_institution_id: resolved.preferred_institution_id,
          source: "parent_device",
        };
      }
    }
  } catch {}

  return null;
}

function coerceInstitutionId(
  requested: unknown,
  allowedInstitutionIds: string[],
  preferredInstitutionId: string | null,
): string | null {
  const x = s(requested);

  if (!x || x.toLowerCase() === "global" || x.toLowerCase() === "null") {
    return preferredInstitutionId || null;
  }

  if (!allowedInstitutionIds.includes(x)) {
    const err: any = new Error("FORBIDDEN_INSTITUTION");
    err.status = 403;
    throw err;
  }

  return x;
}

async function fetchContactsForProfile(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileId: string,
): Promise<ContactRow[]> {
  const { data, error } = await srv
    .from("parent_notification_contacts")
    .select(
      "id,institution_id,profile_id,phone_e164,sms_enabled,whatsapp_enabled,is_primary,verified_at,last_used_at,created_at,updated_at",
    )
    .eq("profile_id", profileId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as ContactRow[];
}

async function fetchInstitutionSettings(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionIds: string[],
): Promise<ChannelSettingRow[]> {
  if (!institutionIds.length) return [];

  try {
    const { data, error } = await srv
      .from("institution_notification_channel_settings")
      .select(
        "institution_id,push_enabled,sms_premium_enabled,sms_provider,sms_sender_name,sms_absence_enabled,sms_late_enabled,sms_notes_digest_enabled,sms_notes_digest_weekday,sms_notes_digest_hour,whatsapp_premium_enabled",
      )
      .in("institution_id", institutionIds);

    if (error) {
      console.warn("[parent.notification-contacts] institution settings warn", {
        error: error.message,
      });
      return [];
    }

    return (data || []) as ChannelSettingRow[];
  } catch (e: any) {
    console.warn("[parent.notification-contacts] institution settings exception", {
      error: String(e?.message || e),
    });
    return [];
  }
}

async function unsetOtherPrimaries(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileId: string,
  excludeId?: string,
) {
  let q = srv
    .from("parent_notification_contacts")
    .update({
      is_primary: false,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("profile_id", profileId)
    .eq("is_primary", true);

  if (excludeId) q = q.neq("id", excludeId);

  const { error } = await q;
  if (error) throw error;
}

async function ensureOnePrimaryIfNeeded(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileId: string,
) {
  const contacts = await fetchContactsForProfile(srv, profileId);
  if (!contacts.length) return;

  const hasPrimary = contacts.some((c) => c.is_primary);
  if (hasPrimary) return;

  const first = contacts[0];
  const { error } = await srv
    .from("parent_notification_contacts")
    .update({
      is_primary: true,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", first.id);

  if (error) throw error;
}

function okJson(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   GET
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export async function GET(req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const parent = await resolveActiveParent(req);
    if (!parent) {
      return okJson({ error: "unauthorized" }, 401);
    }

    const filterInstitutionId = s(req.nextUrl.searchParams.get("institution_id"));
    const contacts = await fetchContactsForProfile(srv, parent.profile_id);
    const settings = await fetchInstitutionSettings(srv, parent.institution_ids);

    const filteredContacts = filterInstitutionId
      ? contacts.filter(
          (c) =>
            s(c.institution_id) === filterInstitutionId ||
            (!s(c.institution_id) && parent.institution_ids.includes(filterInstitutionId)),
        )
      : contacts;

    const primary =
      filteredContacts.find((c) => c.is_primary) ||
      filteredContacts[0] ||
      null;

    console.info(`[parent.notification-contacts:${trace}] GET ok`, {
      profile_id: shortId(parent.profile_id),
      source: parent.source,
      contacts: filteredContacts.length,
      institutions: parent.institution_ids.length,
    });

    return okJson({
      ok: true,
      profile_id: parent.profile_id,
      source: parent.source,
      preferred_institution_id: parent.preferred_institution_id,
      institution_ids: parent.institution_ids,
      contacts: filteredContacts,
      primary_contact: primary,
      institution_settings: settings,
      sms_premium_any_enabled: settings.some((x) => x.sms_premium_enabled === true),
    });
  } catch (e: any) {
    console.error(`[parent.notification-contacts:${trace}] GET fatal`, e);
    return okJson({ error: String(e?.message || e) }, Number(e?.status) || 500);
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   POST
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export async function POST(req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const parent = await resolveActiveParent(req);
    if (!parent) {
      return okJson({ error: "unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body) {
      return okJson({ error: "invalid_json" }, 400);
    }

    const phone_e164 = normalizePhoneE164(body.phone_e164 || body.phone || "");
    const institution_id = coerceInstitutionId(
      body.institution_id,
      parent.institution_ids,
      parent.preferred_institution_id,
    );

    const existingContacts = await fetchContactsForProfile(srv, parent.profile_id);
    const existingSamePhone = existingContacts.find((c) => c.phone_e164 === phone_e164) || null;

    const is_primary =
      typeof body.is_primary === "boolean"
        ? body.is_primary
        : existingContacts.length === 0
          ? true
          : false;

    const sms_enabled = toBool(body.sms_enabled, true);
    const whatsapp_enabled = toBool(body.whatsapp_enabled, false);
    const verified_at = toBool(body.verified, false) ? new Date().toISOString() : null;
    const nowIso = new Date().toISOString();

    if (is_primary) {
      await unsetOtherPrimaries(srv, parent.profile_id, existingSamePhone?.id);
    }

    const row: any = {
      profile_id: parent.profile_id,
      institution_id,
      phone_e164,
      sms_enabled,
      whatsapp_enabled,
      is_primary,
      verified_at,
      updated_at: nowIso,
    };

    const up = await srv
      .from("parent_notification_contacts")
      .upsert(row, {
        onConflict: "profile_id,phone_e164",
        ignoreDuplicates: false,
      })
      .select(
        "id,institution_id,profile_id,phone_e164,sms_enabled,whatsapp_enabled,is_primary,verified_at,last_used_at,created_at,updated_at",
      );

    if (up.error) throw up.error;

    await ensureOnePrimaryIfNeeded(srv, parent.profile_id);

    const contacts = await fetchContactsForProfile(srv, parent.profile_id);
    const primary = contacts.find((c) => c.is_primary) || contacts[0] || null;

    console.info(`[parent.notification-contacts:${trace}] POST ok`, {
      profile_id: shortId(parent.profile_id),
      phone: shortId(phone_e164, 18),
      primary: is_primary,
    });

    return okJson({
      ok: true,
      mode: existingSamePhone ? "upsert_existing_phone" : "create",
      contact: (up.data || [])[0] || primary,
      primary_contact: primary,
      contacts,
    });
  } catch (e: any) {
    console.error(`[parent.notification-contacts:${trace}] POST fatal`, e);
    return okJson({ error: String(e?.message || e) }, Number(e?.status) || 500);
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   PATCH
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export async function PATCH(req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const parent = await resolveActiveParent(req);
    if (!parent) {
      return okJson({ error: "unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    if (!body) {
      return okJson({ error: "invalid_json" }, 400);
    }

    const currentContacts = await fetchContactsForProfile(srv, parent.profile_id);
    if (!currentContacts.length) {
      return okJson({ error: "contact_not_found" }, 404);
    }

    const target =
      (body.id ? currentContacts.find((c) => c.id === body.id) : null) ||
      currentContacts.find((c) => c.is_primary) ||
      currentContacts[0] ||
      null;

    if (!target) {
      return okJson({ error: "contact_not_found" }, 404);
    }

    const nextPhone = body.phone || body.phone_e164
      ? normalizePhoneE164(body.phone_e164 || body.phone || "")
      : target.phone_e164;

    const nextInstitutionId =
      body.institution_id !== undefined
        ? coerceInstitutionId(
            body.institution_id,
            parent.institution_ids,
            parent.preferred_institution_id,
          )
        : target.institution_id;

    const nextSmsEnabled =
      body.sms_enabled !== undefined ? toBool(body.sms_enabled, target.sms_enabled) : target.sms_enabled;

    const nextWhatsappEnabled =
      body.whatsapp_enabled !== undefined
        ? toBool(body.whatsapp_enabled, target.whatsapp_enabled)
        : target.whatsapp_enabled;

    let nextIsPrimary =
      body.is_primary !== undefined ? toBool(body.is_primary, target.is_primary) : target.is_primary;

    const nextVerifiedAt =
      body.verified === undefined
        ? target.verified_at
        : toBool(body.verified, !!target.verified_at)
          ? target.verified_at || new Date().toISOString()
          : null;

    const nowIso = new Date().toISOString();

    // Si on veut retirer le primaire alors quâ€™il est seul, on garde primaire
    if (body.is_primary === false) {
      const others = currentContacts.filter((c) => c.id !== target.id);
      const othersPrimary = others.some((c) => c.is_primary);
      if (!others.length || !othersPrimary) {
        nextIsPrimary = true;
      }
    }

    // Cas fusion si le nouveau tÃ©lÃ©phone existe dÃ©jÃ  chez ce profil
    const duplicateWithNextPhone =
      currentContacts.find((c) => c.phone_e164 === nextPhone && c.id !== target.id) || null;

    if (duplicateWithNextPhone) {
      if (nextIsPrimary) {
        await unsetOtherPrimaries(srv, parent.profile_id, duplicateWithNextPhone.id);
      }

      const { error: updExistingErr } = await srv
        .from("parent_notification_contacts")
        .update({
          institution_id: nextInstitutionId,
          sms_enabled: nextSmsEnabled,
          whatsapp_enabled: nextWhatsappEnabled,
          is_primary: nextIsPrimary,
          verified_at: nextVerifiedAt,
          updated_at: nowIso,
        } as any)
        .eq("id", duplicateWithNextPhone.id);

      if (updExistingErr) throw updExistingErr;

      const { error: delOldErr } = await srv
        .from("parent_notification_contacts")
        .delete()
        .eq("id", target.id);

      if (delOldErr) throw delOldErr;
    } else {
      if (nextIsPrimary) {
        await unsetOtherPrimaries(srv, parent.profile_id, target.id);
      }

      const { error: updErr } = await srv
        .from("parent_notification_contacts")
        .update({
          institution_id: nextInstitutionId,
          phone_e164: nextPhone,
          sms_enabled: nextSmsEnabled,
          whatsapp_enabled: nextWhatsappEnabled,
          is_primary: nextIsPrimary,
          verified_at: nextVerifiedAt,
          updated_at: nowIso,
        } as any)
        .eq("id", target.id);

      if (updErr) throw updErr;
    }

    await ensureOnePrimaryIfNeeded(srv, parent.profile_id);

    const contacts = await fetchContactsForProfile(srv, parent.profile_id);
    const primary = contacts.find((c) => c.is_primary) || contacts[0] || null;

    console.info(`[parent.notification-contacts:${trace}] PATCH ok`, {
      profile_id: shortId(parent.profile_id),
      target: shortId(target.id),
      primary: shortId(primary?.id),
    });

    return okJson({
      ok: true,
      primary_contact: primary,
      contacts,
    });
  } catch (e: any) {
    console.error(`[parent.notification-contacts:${trace}] PATCH fatal`, e);
    return okJson({ error: String(e?.message || e) }, Number(e?.status) || 500);
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   DELETE
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export async function DELETE(req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const parent = await resolveActiveParent(req);
    if (!parent) {
      return okJson({ error: "unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as DeleteBody;
    const contacts = await fetchContactsForProfile(srv, parent.profile_id);

    if (!contacts.length) {
      return okJson({ ok: true, deleted: 0, contacts: [] });
    }

    const target =
      (body.id ? contacts.find((c) => c.id === body.id) : null) ||
      contacts.find((c) => c.is_primary) ||
      contacts[0] ||
      null;

    if (!target) {
      return okJson({ error: "contact_not_found" }, 404);
    }

    const { error: delErr } = await srv
      .from("parent_notification_contacts")
      .delete()
      .eq("id", target.id);

    if (delErr) throw delErr;

    await ensureOnePrimaryIfNeeded(srv, parent.profile_id);

    const nextContacts = await fetchContactsForProfile(srv, parent.profile_id);
    const primary = nextContacts.find((c) => c.is_primary) || nextContacts[0] || null;

    console.info(`[parent.notification-contacts:${trace}] DELETE ok`, {
      profile_id: shortId(parent.profile_id),
      deleted: shortId(target.id),
      remaining: nextContacts.length,
    });

    return okJson({
      ok: true,
      deleted: 1,
      primary_contact: primary,
      contacts: nextContacts,
    });
  } catch (e: any) {
    console.error(`[parent.notification-contacts:${trace}] DELETE fatal`, e);
    return okJson({ error: String(e?.message || e) }, Number(e?.status) || 500);
  }
}