// src/app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!; // requis

/* ---------- helpers ---------- */
function extractTokens(jar: Awaited<ReturnType<typeof cookies>>) {
  let access  = jar.get("sb-access-token")?.value || null;
  let refresh = jar.get("sb-refresh-token")?.value || null;
  try {
    if (!access || !refresh) {
      const ref  = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1];
      const name = ref ? `sb-${ref}-auth-token` : null;
      const raw  = name ? jar.get(name)?.value : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        access  = access  || parsed?.currentSession?.access_token  || null;
        refresh = refresh || parsed?.currentSession?.refresh_token || null;
      }
    }
  } catch {}
  return { access, refresh };
}
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
/** ne garde que les chiffres */
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

/** priorit� d�"affichage si plusieurs r�les */
const ROLE_ORDER = ["super_admin", "admin", "teacher", "educator", "parent", "user"] as const;
function pickRole(roles: string[]) {
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return roles[0] ?? null;
}

/* ---------- handler ---------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw  = (searchParams.get("q") || "").trim();
    const qText = lc(qRaw);
    const qNum  = digits(qRaw);               // <= on cherche sur les CHIFFRES uniquement

    // 1) Auth appelant (cookies du SDK navigateur)
    const jar = await cookies();
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: { get: (n) => jar.get(n)?.value, set() {}, remove() {} },
    });
    const { access, refresh } = extractTokens(jar);
    if (access && refresh) {
      try { await supabase.auth.setSession({ access_token: access, refresh_token: refresh }); } catch {}
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non authentifi�." }, { status: 401 });

    // 2) V�rif admin & scope �tablissement via user_roles (service role)
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: myRoles, error: rolesErr } = await svc
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);
    if (rolesErr) return NextResponse.json({ error: rolesErr.message }, { status: 400 });

    const myRoleList = (myRoles || []).map((r) => String(r.role));
    const isSuper    = myRoleList.includes("super_admin");
    const isAdmin    = isSuper || myRoleList.includes("admin");
    if (!isAdmin) return NextResponse.json({ error: "Acc�s refus� (admin requis)." }, { status: 403 });

    const adminScopes = (myRoles || [])
      .filter((r) => r.institution_id && (r.role === "admin" || r.role === "super_admin"))
      .map((r) => r.institution_id as string);

    // 3) Population visible = profils reli�s � user_roles dans ton/tes �tablissements
    let roleQuery = svc.from("user_roles").select("profile_id, role, institution_id");
    if (!isSuper && adminScopes.length > 0) roleQuery = roleQuery.in("institution_id", adminScopes);

    const { data: visibleRoles, error: visErr } = await roleQuery.limit(5000);
    if (visErr) return NextResponse.json({ error: visErr.message }, { status: 400 });
    if (!visibleRoles || visibleRoles.length === 0) return NextResponse.json({ items: [] });

    // R�les par profil
    const rolesByProfile = new Map<string, string[]>();
    const profileIds: string[] = [];
    for (const r of visibleRoles) {
      const pid = r.profile_id as string;
      profileIds.push(pid);
      const list = rolesByProfile.get(pid) || [];
      list.push(String(r.role));
      rolesByProfile.set(pid, list);
    }

    // 4) Charge les profils concern�s
    const ids = Array.from(new Set(profileIds));
    const { data: profs, error: pErr } = await svc
      .from("profiles")
      .select("id, display_name, email, phone")
      .in("id", ids)
      .limit(1000);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

    // 5) Filtre c�t� serveur
    const filtered = (profs || []).filter((p) => {
      if (!qRaw) return true; // sans filtre �  tout visible

      // match texte (nom/email)
      const matchText = lc(p.display_name).includes(qText) || lc(p.email).includes(qText);

      // match t�l�phone : on fabrique des candidats c�t� serveur pour couvrir tous les cas
      const phoneDigits = digits(p.phone); // ex: "+2250202020202" -> "2250202020202"
      const cands = new Set<string>();
      if (qNum) {
        cands.add(qNum);                                // "0202020202"
        cands.add(qNum.replace(/^0+/, ""));             // "202020202" (au cas o�)
        cands.add("225" + qNum);                        // "2250202020202"
        cands.add("225" + qNum.replace(/^0+/, ""));     // "225202020202"
      }

      const matchPhone =
        qNum.length >= 4 &&
        Array.from(cands).some((c) => c && phoneDigits.includes(c));

      return matchText || matchPhone;
    });

    const items = filtered.slice(0, 50).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      email: p.email,
      phone: p.phone,
      role: pickRole(rolesByProfile.get(p.id) || []),
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur serveur." }, { status: 500 });
  }
}


