import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export type TextbookRole =
  | "super_admin"
  | "founder"
  | "drenaet_admin"
  | "admin"
  | "educator"
  | "inspector"
  | "teacher"
  | "class_device"
  | string;

export type TextbookContext = {
  supa: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  srv: ReturnType<typeof getSupabaseServiceClient>;
  userId: string;
  institutionId: string;
  roles: Set<TextbookRole>;
};

const ADMIN_ROLES = new Set<TextbookRole>([
  "super_admin",
  "founder",
  "drenaet_admin",
  "admin",
  "educator",
  "inspector",
]);

const TEACHER_ROLES = new Set<TextbookRole>([
  "teacher",
  "class_device",
  "admin",
  "educator",
  "super_admin",
  "founder",
  "inspector",
]);

export function hasAnyRole(roles: Set<TextbookRole>, allowed: Set<TextbookRole>) {
  for (const role of roles) {
    if (allowed.has(role)) return true;
  }
  return false;
}

export function canManageTextbook(roles: Set<TextbookRole>) {
  return hasAnyRole(roles, ADMIN_ROLES);
}

export function canManageNationalTextbook(roles: Set<TextbookRole>) {
  // La bibliothèque nationale Nexa est une donnée globale de la plateforme.
  // Elle ne doit pas être alimentée par les fondateurs/administrateurs d'école.
  return roles.has("super_admin");
}

export function canUseTeacherTextbook(roles: Set<TextbookRole>) {
  return hasAnyRole(roles, TEACHER_ROLES);
}

export async function getTextbookContext(): Promise<
  | { ok: true; ctx: TextbookContext }
  | { ok: false; response: NextResponse }
> {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "profile_error", details: profileErr.message },
        { status: 400 }
      ),
    };
  }

  const institutionId = String((profile as any)?.institution_id || "").trim();
  if (!institutionId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "no_institution" }, { status: 403 }),
    };
  }

  const roles = new Set<TextbookRole>();
  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (!roleErr && Array.isArray(roleRows)) {
    for (const row of roleRows as any[]) {
      const role = String(row?.role || "").trim();
      const roleInstitutionId = String(row?.institution_id || "").trim();
      if (!role) continue;
      if (role === "super_admin" || !roleInstitutionId || roleInstitutionId === institutionId) {
        roles.add(role);
      }
    }
  }

  return {
    ok: true,
    ctx: {
      supa,
      srv,
      userId: user.id,
      institutionId,
      roles,
    },
  };
}

export async function requireNationalTextbookManager(): Promise<
  | { ok: true; ctx: TextbookContext }
  | { ok: false; response: NextResponse }
> {
  const base = await getTextbookContext();
  if (!base.ok) return base;

  if (!canManageNationalTextbook(base.ctx.roles)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden_national_library" }, { status: 403 }),
    };
  }

  return base;
}

export async function requireTextbookManager(): Promise<
  | { ok: true; ctx: TextbookContext }
  | { ok: false; response: NextResponse }
> {
  const base = await getTextbookContext();
  if (!base.ok) return base;

  if (!canManageTextbook(base.ctx.roles)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }

  return base;
}

export async function requireTeacherTextbook(): Promise<
  | { ok: true; ctx: TextbookContext }
  | { ok: false; response: NextResponse }
> {
  const base = await getTextbookContext();
  if (!base.ok) return base;

  if (!canUseTeacherTextbook(base.ctx.roles)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }

  return base;
}

export async function getCurrentAcademicYearCode(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
): Promise<string | null> {
  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((current as any)?.code) return String((current as any).code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest as any)?.code ? String((latest as any).code) : null;
}


export function uniqText(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((v) => String(v || "").trim()).filter(Boolean)),
  );
}

export function buildPhoneVariants(raw: unknown) {
  const value = String(raw || "").trim();
  const compact = value.replace(/\s+/g, "");
  const digits = compact.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";

  return uniqText([
    value,
    compact,
    digits,
    digits ? `+${digits}` : "",
    local10,
    localNo0 ? `0${localNo0}` : "",
    localNo0,
    local10 ? `${cc}${local10}` : "",
    localNo0 ? `${cc}${localNo0}` : "",
    local10 ? `+${cc}${local10}` : "",
    localNo0 ? `+${cc}${localNo0}` : "",
    local10 ? `00${cc}${local10}` : "",
    localNo0 ? `00${cc}${localNo0}` : "",
  ]);
}

function normalizePhoneComparable(raw: unknown) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const local10 = digits.slice(-10);
  return local10 || digits;
}

async function getAuthPhoneCandidates(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
) {
  const phones: string[] = [];

  const fromSchema = await srv
    .schema("auth")
    .from("users")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  if (!fromSchema.error && fromSchema.data?.phone) {
    phones.push(String(fromSchema.data.phone || "").trim());
  }

  const fromQualified = await srv
    .from("auth.users")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  if (!fromQualified.error && fromQualified.data?.phone) {
    phones.push(String(fromQualified.data.phone || "").trim());
  }

  const fromProfile = await srv
    .from("profiles")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  if (!fromProfile.error && fromProfile.data?.phone) {
    phones.push(String(fromProfile.data.phone || "").trim());
  }

  return uniqText(phones);
}

export async function findTextbookClassDevice(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
  institutionId: string,
) {
  const phones = await getAuthPhoneCandidates(srv, userId);
  const variants = uniqText(phones.flatMap((phone) => buildPhoneVariants(phone)));
  if (!variants.length) return null;

  const { data: directRows } = await srv
    .from("classes")
    .select("id,label,level,institution_id,class_phone_e164")
    .eq("institution_id", institutionId)
    .in("class_phone_e164", variants)
    .limit(2);

  if (Array.isArray(directRows) && directRows.length === 1) return directRows[0];

  const candidateKeys = new Set(variants.map(normalizePhoneComparable).filter(Boolean));
  const { data: allClasses } = await srv
    .from("classes")
    .select("id,label,level,institution_id,class_phone_e164")
    .eq("institution_id", institutionId)
    .not("class_phone_e164", "is", null)
    .limit(1000);

  const matches = ((allClasses || []) as any[]).filter((cls) => {
    const stored = String(cls.class_phone_e164 || "").trim();
    if (!stored) return false;
    if (variants.includes(stored) || variants.includes(stored.replace(/\s+/g, ""))) {
      return true;
    }
    const storedKey = normalizePhoneComparable(stored);
    return Boolean(storedKey && candidateKeys.has(storedKey));
  });

  return matches.length === 1 ? matches[0] : null;
}

export function cleanText(value: unknown, max = 500) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return "";
  return s.slice(0, max);
}

export function cleanUuid(value: unknown) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}

export function toPositiveInt(value: unknown, fallback: number | null = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}
