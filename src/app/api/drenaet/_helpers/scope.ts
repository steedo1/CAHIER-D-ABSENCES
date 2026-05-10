// src/app/api/drenaet/_helpers/scope.ts
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const DRENAET_ROLES = ["drenaet_admin", "super_admin"] as const;

type DrenaetRole = (typeof DRENAET_ROLES)[number];

export type ScopedInstitution = {
  id: string;
  name: string | null;
  code_unique: string | null;
  code: string | null;
  regional_direction: string | null;
  status: string | null;
  settings_json?: any;
};

export type DrenaetScopeOk = {
  userId: string;
  role: DrenaetRole;
  isSuper: boolean;
  canExport: boolean;
  canViewGrades: boolean;
  canViewTeacherPresence: boolean;
  regionalDirections: string[];
  institutions: ScopedInstitution[];
  institutionIds: string[];
  srv: SupabaseClient;
};

export type DrenaetScopeErr = {
  error: NextResponse;
};

export function normalizeDirection(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function todayRangeUTC() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const to = new Date(from.getTime());
  to.setUTCDate(to.getUTCDate() + 1);
  return { fromISO: from.toISOString(), toISO: to.toISOString(), today: from.toISOString().slice(0, 10) };
}

export function dayRangeFromSearchParams(searchParams: URLSearchParams) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const defaultFrom = new Date(today.getTime());
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 6);

  const fromYmd = searchParams.get("from") || defaultFrom.toISOString().slice(0, 10);
  const toYmd = searchParams.get("to") || today.toISOString().slice(0, 10);

  const from = ymdToDate(fromYmd) || defaultFrom;
  const toDay = ymdToDate(toYmd) || today;
  const toExclusive = new Date(toDay.getTime());
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  return {
    fromYmd: from.toISOString().slice(0, 10),
    toYmd: toDay.toISOString().slice(0, 10),
    fromISO: from.toISOString(),
    toISO: toExclusive.toISOString(),
  };
}

function ymdToDate(ymd: string | null) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function groupCount<T extends Record<string, any>>(rows: T[], key: keyof T) {
  const map = new Map<string, number>();
  for (const row of rows || []) {
    const k = String(row[key] || "");
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

async function getRoles(srv: SupabaseClient, userId: string) {
  const { data, error } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", userId);

  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => String(r.role || ""));
}

export async function guardDrenaetScope(): Promise<DrenaetScopeOk | DrenaetScopeErr> {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  let roles: string[] = [];
  try {
    roles = await getRoles(srv, user.id);
  } catch (e: any) {
    return { error: NextResponse.json({ error: e?.message || "roles_error" }, { status: 400 }) };
  }

  const isSuper = roles.includes("super_admin");
  const isDrenaet = roles.includes("drenaet_admin");

  if (!isSuper && !isDrenaet) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  let regionalDirections: string[] = [];
  let canExport = true;
  let canViewGrades = true;
  let canViewTeacherPresence = true;

  if (!isSuper) {
    const { data: scopes, error: scopesErr } = await srv
      .from("drenaet_user_scopes")
      .select("regional_direction, can_export, can_view_grades, can_view_teacher_presence")
      .eq("profile_id", user.id);

    if (scopesErr) {
      return {
        error: NextResponse.json(
          {
            error: "drenaet_scope_missing_or_invalid",
            message:
              "La table drenaet_user_scopes est absente ou inaccessible. Exécute d'abord la migration DRENAET.",
            details: scopesErr.message,
          },
          { status: 400 }
        ),
      };
    }

    regionalDirections = Array.from(
      new Set((scopes || []).map((s: any) => normalizeDirection(s.regional_direction)).filter(Boolean))
    );

    if (!regionalDirections.length) {
      return {
        error: NextResponse.json(
          {
            error: "no_drenaet_scope",
            message:
              "Ce compte a le rôle drenaet_admin, mais aucune direction régionale ne lui est encore rattachée.",
          },
          { status: 403 }
        ),
      };
    }

    canExport = (scopes || []).some((s: any) => Boolean(s.can_export));
    canViewGrades = (scopes || []).some((s: any) => Boolean(s.can_view_grades));
    canViewTeacherPresence = (scopes || []).some((s: any) => Boolean(s.can_view_teacher_presence));
  }

  const { data: rawInstitutions, error: instErr } = await srv
    .from("institutions")
    .select("id,name,code_unique,code,regional_direction,status,settings_json")
    .order("name", { ascending: true });

  if (instErr) {
    return { error: NextResponse.json({ error: instErr.message }, { status: 400 }) };
  }

  const allowedSet = new Set(regionalDirections.map(normalizeDirection));
  const institutions = ((rawInstitutions || []) as ScopedInstitution[]).filter((inst) => {
    if (isSuper) return true;
    return allowedSet.has(normalizeDirection(inst.regional_direction));
  });

  return {
    userId: user.id,
    role: isSuper ? "super_admin" : "drenaet_admin",
    isSuper,
    canExport,
    canViewGrades,
    canViewTeacherPresence,
    regionalDirections,
    institutions,
    institutionIds: institutions.map((i) => String(i.id)),
    srv,
  };
}
