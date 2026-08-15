import { createHash } from "node:crypto";

type ServiceClient = any;

export type ClassDeviceLoginResolution =
  | { status: "not_found" }
  | { status: "institution_not_found" }
  | { status: "ambiguous" }
  | { status: "unprovisioned" }
  | {
      status: "resolved";
      class_id: string;
      institution_id: string;
      auth_user_id: string;
      email: string | null;
      phone: string | null;
    };

export function cleanClassLoginIdentifier(value: unknown): string | null {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("class_identifier_bad_type");
  }
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  if (cleaned.length > 128 || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new Error("class_identifier_invalid");
  }
  return cleaned;
}

export function classLoginIdentifierKey(value: unknown): string | null {
  const cleaned = cleanClassLoginIdentifier(value);
  return cleaned
    ? cleaned.replace(/\s+/gu, " ").toLowerCase()
    : null;
}

export function sameClassLoginIdentifier(a: unknown, b: unknown) {
  return classLoginIdentifierKey(a) === classLoginIdentifierKey(b);
}

export function classDeviceTechnicalEmail(
  institutionId: string,
  classId: string,
  configuredDomain = process.env.MON_CAHIER_CLASS_DEVICE_AUTH_DOMAIN,
) {
  const requestedDomain = String(configuredDomain || "auth.mon-cahier.com")
    .trim()
    .toLowerCase();
  const domain = /^[a-z0-9.-]+\.[a-z]{2,}$/u.test(requestedDomain)
    ? requestedDomain
    : "auth.mon-cahier.com";
  const digest = createHash("sha256")
    .update(`${institutionId}:${classId}`, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `class-device.${digest}@${domain}`;
}

function uniq(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

export function legacyClassPhoneCandidates(raw: unknown) {
  const text = String(raw || "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) return text ? [text] : [];
  const ivoryCoastRest = digits.startsWith("225") ? digits.slice(3) : "";
  const ivoryCoastWithZero = ivoryCoastRest
    ? ivoryCoastRest.startsWith("0")
      ? ivoryCoastRest
      : `0${ivoryCoastRest}`
    : "";
  const ivoryCoastWithoutZero = ivoryCoastRest.replace(/^0+/u, "");
  const local10 = digits.slice(-10);
  const localNo0 = local10.replace(/^0/u, "");
  const cc = "225";
  return uniq([
    text,
    text.replace(/\s+/gu, ""),
    digits,
    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,
    `00${cc}${local10}`,
    `00${cc}${localNo0}`,
    `${cc}${local10}`,
    `${cc}${localNo0}`,
    ivoryCoastWithZero ? `+225${ivoryCoastWithZero}` : "",
    ivoryCoastWithoutZero ? `+225${ivoryCoastWithoutZero}` : "",
    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);
}

async function authPhoneForUser(
  service: ServiceClient,
  userId: string,
  suppliedPhone?: string | null,
) {
  const phones = uniq([suppliedPhone]);
  if (phones.length) return phones;

  try {
    const { data } = await service.auth.admin.getUserById(userId);
    if (data?.user?.phone) phones.push(String(data.user.phone).trim());
  } catch {
    // Le fallback profiles ci-dessous conserve les anciens comptes.
  }
  if (!phones.length) {
    const { data } = await service
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle();
    if (data?.phone) phones.push(String(data.phone).trim());
  }
  return uniq(phones);
}

export async function resolveClassDeviceClassIds(input: {
  service: ServiceClient;
  userId: string;
  userPhone?: string | null;
}) {
  const { data: roleRows, error: roleError } = await input.service
    .from("user_roles")
    .select("institution_id")
    .eq("profile_id", input.userId)
    .eq("role", "class_device");
  if (roleError) throw new Error("class_device_role_lookup_failed");

  const institutionIds = uniq(
    (roleRows || []).map((row: any) => row?.institution_id),
  );
  if (!institutionIds.length) return [];

  const ids = new Set<string>();
  const { data: linked, error: linkedError } = await input.service
    .from("classes")
    .select("id,institution_id")
    .eq("class_device_auth_user_id", input.userId)
    .in("institution_id", institutionIds);
  if (linkedError) throw new Error("class_device_identity_lookup_failed");
  for (const row of linked || []) {
    if (row?.id) ids.add(String(row.id));
  }

  // Une liaison canonique est autoritaire. Le téléphone du profil peut être
  // une SIM de contact et ne doit jamais élargir le périmètre de la classe.
  if (ids.size > 0) return Array.from(ids);

  const phones = await authPhoneForUser(
    input.service,
    input.userId,
    input.userPhone,
  );
  const candidates = uniq(phones.flatMap(legacyClassPhoneCandidates));
  if (candidates.length) {
    const { data: legacy, error: legacyError } = await input.service
      .from("classes")
      .select("id,institution_id")
      .in("institution_id", institutionIds)
      .in("class_phone_e164", candidates);
    if (legacyError) throw new Error("class_device_legacy_lookup_failed");
    for (const row of legacy || []) {
      if (row?.id) ids.add(String(row.id));
    }
  }
  return Array.from(ids);
}

export async function classDeviceMayAccessClass(input: {
  service: ServiceClient;
  userId: string;
  classId: string;
  userPhone?: string | null;
}) {
  const ids = await resolveClassDeviceClassIds(input);
  return ids.includes(input.classId);
}

async function institutionIdForCode(service: ServiceClient, rawCode: string) {
  const code = rawCode.trim();
  if (!code) return null;
  const candidates = uniq([code, code.toUpperCase(), code.toLowerCase()]);
  const { data: byCode, error: codeError } = await service
    .from("institutions")
    .select("id")
    .in("code", candidates)
    .limit(2);
  if (codeError) throw new Error("institution_lookup_failed");
  if (Array.isArray(byCode) && byCode.length === 1) return String(byCode[0].id);

  const { data: byUnique, error: uniqueError } = await service
    .from("institutions")
    .select("id")
    .in("code_unique", candidates)
    .limit(2);
  if (uniqueError) throw new Error("institution_lookup_failed");
  return Array.isArray(byUnique) && byUnique.length === 1
    ? String(byUnique[0].id)
    : null;
}

export async function resolveClassDeviceLogin(input: {
  service: ServiceClient;
  identifier: unknown;
  institutionCode?: string | null;
}): Promise<ClassDeviceLoginResolution> {
  const key = classLoginIdentifierKey(input.identifier);
  if (!key) return { status: "not_found" };

  let institutionId: string | null = null;
  if (String(input.institutionCode || "").trim()) {
    institutionId = await institutionIdForCode(
      input.service,
      String(input.institutionCode),
    );
    if (!institutionId) return { status: "institution_not_found" };
  }

  let query = input.service
    .from("classes")
    .select("id,institution_id,class_device_auth_user_id")
    .eq("class_login_identifier_key", key)
    .limit(2);
  if (institutionId) query = query.eq("institution_id", institutionId);
  const { data: rows, error } = await query;
  if (error) throw new Error("class_identifier_lookup_failed");
  if (!Array.isArray(rows) || rows.length === 0) return { status: "not_found" };
  if (rows.length !== 1) return { status: "ambiguous" };

  const row = rows[0];
  const authUserId = String(row?.class_device_auth_user_id || "").trim();
  if (!authUserId) return { status: "unprovisioned" };

  const { data: classRole, error: classRoleError } = await input.service
    .from("user_roles")
    .select("profile_id")
    .eq("profile_id", authUserId)
    .eq("institution_id", String(row.institution_id))
    .eq("role", "class_device")
    .maybeSingle();
  if (classRoleError) throw new Error("class_device_role_lookup_failed");
  if (!classRole) return { status: "unprovisioned" };

  const { data, error: authError } = await input.service.auth.admin.getUserById(authUserId);
  if (authError || !data?.user) throw new Error("class_device_auth_user_lookup_failed");
  const email = String(data.user.email || "").trim() || null;
  const phone = String(data.user.phone || "").trim() || null;
  if (!email && !phone) throw new Error("class_device_auth_login_missing");

  return {
    status: "resolved",
    class_id: String(row.id),
    institution_id: String(row.institution_id),
    auth_user_id: authUserId,
    email,
    phone,
  };
}
