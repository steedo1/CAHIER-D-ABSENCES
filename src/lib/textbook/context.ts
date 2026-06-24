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
