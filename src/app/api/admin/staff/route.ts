import { NextRequest, NextResponse } from "next/server";
import { getStaffScope } from "@/lib/server/staff-access";
import { STAFF_ROLES } from "@/lib/staff-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Search staff in the current school only; students and parents are excluded. */
export async function GET(req: NextRequest) {
  const access = await getStaffScope(req);
  if (!access.ok) return access.response;
  const { service, institutionId, institutionName, institutionCode, isSuperAdmin } = access.scope;
  const q = String(req.nextUrl.searchParams.get("q") || "").trim().toLocaleLowerCase("fr");
  if (q.length > 120) return NextResponse.json({ error: "Recherche trop longue." }, { status: 400 });

  const { data: roleRows, error: roleError } = await service
    .from("user_roles")
    .select("profile_id,role")
    .eq("institution_id", institutionId)
    .in("role", [...STAFF_ROLES])
    .limit(4000);
  if (roleError) return NextResponse.json({ error: "Chargement des personnels impossible." }, { status: 500 });

  const roleByProfile = new Map<string, string[]>();
  for (const row of roleRows || []) {
    const id = String(row.profile_id);
    const roles = roleByProfile.get(id) || [];
    roles.push(String(row.role));
    roleByProfile.set(id, roles);
  }

  const ids = Array.from(roleByProfile.keys()).slice(0, 3000);
  if (!ids.length) {
    return NextResponse.json({
      ok: true,
      institution: { id: institutionId, name: institutionName, code: institutionCode },
      items: [],
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const profiles: Array<{
    id: string;
    display_name: string | null;
    phone: string | null;
    email: string | null;
  }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await service
      .from("profiles")
      .select("id,display_name,phone,email")
      .eq("institution_id", institutionId)
      .in("id", ids.slice(i, i + 200));
    if (error) return NextResponse.json({ error: "Lecture des profils impossible." }, { status: 500 });
    profiles.push(...(data || []));
  }

  const items = profiles
    .filter((profile) => {
      if (!q) return true;
      return [
        profile.display_name,
        profile.phone,
        profile.email,
      ].some((value) => String(value || "").toLocaleLowerCase("fr").includes(q));
    })
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || ""), "fr"))
    .slice(0, 100)
    .map((profile) => {
      const roles = roleByProfile.get(profile.id) || [];
      const role = STAFF_ROLES.find((r) => roles.includes(r)) || "teacher";
      const elevated = roles.includes("admin") || roles.includes("finance_manager");
      return {
        ...profile,
        role,
        editable: isSuperAdmin || !elevated,
      };
    });

  return NextResponse.json({
    ok: true,
    institution: { id: institutionId, name: institutionName, code: institutionCode },
    items,
  }, { headers: { "Cache-Control": "no-store" } });
}
