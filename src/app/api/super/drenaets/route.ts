// src/app/api/super/drenaets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScopeRow = {
  profile_id: string;
  regional_direction: string;
  can_export: boolean;
  can_view_grades: boolean;
  can_view_teacher_presence: boolean;
};

type RoleRow = {
  profile_id: string;
  role: string;
  profiles?:
    | {
        display_name?: string | null;
        email?: string | null;
        phone?: string | null;
      }
    | {
        display_name?: string | null;
        email?: string | null;
        phone?: string | null;
      }[]
    | null;
};

function genTempPass(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function normalizeDirections(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item))
        .filter((item) => item.length > 0)
    )
  );
}

function profileOf(row: RoleRow) {
  if (Array.isArray(row.profiles)) return row.profiles[0] ?? null;
  return row.profiles ?? null;
}

async function requireSuperAdmin() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (error || !(roles ?? []).some((role) => role.role === "super_admin")) {
    return { ok: false as const, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true as const, userId: user.id };
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseServiceClient>, email: string) {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(error.message || "Impossible de rechercher l’utilisateur Auth.");
    }

    const users = data?.users ?? [];
    const found = users.find((user) => (user.email ?? "").trim().toLowerCase() === target);

    if (found?.id) return found.id;
    if (users.length < perPage) break;
  }

  return null;
}

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

  const supabase = getSupabaseServiceClient();

  const { data: directionsRows, error: directionsError } = await supabase
    .from("institutions")
    .select("regional_direction")
    .not("regional_direction", "is", null)
    .order("regional_direction", { ascending: true });

  if (directionsError) {
    return NextResponse.json({ error: directionsError.message }, { status: 400 });
  }

  const regionalDirections = Array.from(
    new Set(
      (directionsRows ?? [])
        .map((row: any) => cleanText(row.regional_direction))
        .filter((direction: string) => direction.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, "fr"));

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select(`
      profile_id,
      role,
      profiles:profiles!user_roles_profile_id_fkey ( display_name, email, phone )
    `)
    .eq("role", "drenaet_admin")
    .order("profile_id", { ascending: true });

  if (rolesError) {
    return NextResponse.json({ error: rolesError.message }, { status: 400 });
  }

  const uniqueRoles: RoleRow[] = [];
  const seen = new Set<string>();

  for (const row of (roleRows ?? []) as RoleRow[]) {
    if (!seen.has(row.profile_id)) {
      seen.add(row.profile_id);
      uniqueRoles.push(row);
    }
  }

  const profileIds = uniqueRoles.map((row) => row.profile_id);
  let scopes: ScopeRow[] = [];

  if (profileIds.length > 0) {
    const { data: scopeRows, error: scopesError } = await supabase
      .from("drenaet_user_scopes")
      .select("profile_id, regional_direction, can_export, can_view_grades, can_view_teacher_presence")
      .in("profile_id", profileIds)
      .order("regional_direction", { ascending: true });

    if (scopesError) {
      return NextResponse.json({ error: scopesError.message }, { status: 400 });
    }

    scopes = (scopeRows ?? []) as ScopeRow[];
  }

  const items = uniqueRoles.map((row) => {
    const profile = profileOf(row);
    const rowScopes = scopes.filter((scope) => scope.profile_id === row.profile_id);

    return {
      profile_id: row.profile_id,
      email: profile?.email ?? null,
      display_name: profile?.display_name ?? null,
      phone: profile?.phone ?? null,
      scopes: rowScopes.map((scope) => ({
        regional_direction: scope.regional_direction,
        can_export: scope.can_export,
        can_view_grades: scope.can_view_grades,
        can_view_teacher_presence: scope.can_view_teacher_presence,
      })),
    };
  });

  const filtered = q
    ? items.filter((item) => {
        const haystack = [
          item.email,
          item.display_name,
          item.phone,
          ...item.scopes.map((scope) => scope.regional_direction),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
    : items;

  return NextResponse.json({
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    regional_directions: regionalDirections,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const fullName = cleanText(body.full_name);
  const phone = cleanText(body.phone);
  const regionalDirections = normalizeDirections(body.regional_directions);
  const canExport = body.can_export !== false;
  const canViewGrades = body.can_view_grades !== false;
  const canViewTeacherPresence = body.can_view_teacher_presence !== false;

  if (!email) {
    return NextResponse.json({ error: "Email requis." }, { status: 400 });
  }

  if (regionalDirections.length === 0) {
    return NextResponse.json({ error: "Sélectionne au moins une zone DRENAET." }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  let profileId: string | null = null;
  let createdNewAuthUser = false;
  let temporaryPassword: string | null = null;

  const { data: existingProfile, error: profileLookupError } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (profileLookupError) {
    return NextResponse.json({ error: profileLookupError.message }, { status: 400 });
  }

  if (existingProfile?.id) {
    profileId = existingProfile.id;
  } else {
    try {
      profileId = await findAuthUserIdByEmail(supabase, email);
    } catch (error: any) {
      return NextResponse.json(
        { error: error?.message || "Impossible de rechercher l’utilisateur Auth." },
        { status: 400 }
      );
    }
  }

  if (!profileId) {
    const configuredPassword = process.env.DEFAULT_TEMP_PASSWORD;
    const password = configuredPassword || genTempPass(12);

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: fullName || null,
        phone: phone || null,
      },
    });

    if (createError || !created?.user) {
      return NextResponse.json(
        { error: createError?.message || "Impossible de créer l’utilisateur Auth." },
        { status: 409 }
      );
    }

    profileId = created.user.id;
    createdNewAuthUser = true;
    temporaryPassword = configuredPassword ? null : password;
  }

  const { data: currentRoles, error: currentRolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileId);

  if (currentRolesError) {
    return NextResponse.json({ error: currentRolesError.message }, { status: 400 });
  }

  const otherRoles = (currentRoles ?? [])
    .map((row: any) => String(row.role))
    .filter((role: string) => role !== "drenaet_admin");

  if (otherRoles.length > 0) {
    return NextResponse.json(
      {
        error:
          "Ce compte possède déjà un autre rôle (" +
          otherRoles.join(", ") +
          "). Utilise un email dédié pour éviter toute confusion de redirection.",
      },
      { status: 409 }
    );
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: profileId,
      email,
      display_name: fullName || email,
      phone: phone || null,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const hasDrenaetRole = (currentRoles ?? []).some((row: any) => row.role === "drenaet_admin");

  if (!hasDrenaetRole) {
    const { error: roleError } = await supabase.from("user_roles").insert({
      profile_id: profileId,
      institution_id: null,
      role: "drenaet_admin",
    });

    if (roleError) {
      return NextResponse.json({ error: roleError.message }, { status: 400 });
    }
  }

  const { error: deleteScopesError } = await supabase
    .from("drenaet_user_scopes")
    .delete()
    .eq("profile_id", profileId);

  if (deleteScopesError) {
    return NextResponse.json({ error: deleteScopesError.message }, { status: 400 });
  }

  const scopeRows = regionalDirections.map((regionalDirection) => ({
    profile_id: profileId,
    regional_direction: regionalDirection,
    can_export: canExport,
    can_view_grades: canViewGrades,
    can_view_teacher_presence: canViewTeacherPresence,
    created_by: guard.userId,
  }));

  const { error: scopesInsertError } = await supabase.from("drenaet_user_scopes").insert(scopeRows);

  if (scopesInsertError) {
    return NextResponse.json({ error: scopesInsertError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    created_new_auth_user: createdNewAuthUser,
    temporary_password: temporaryPassword,
    user: {
      id: profileId,
      email,
      display_name: fullName || email,
    },
  });
}
