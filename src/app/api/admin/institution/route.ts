// src/app/api/admin/institution/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── helpers ───────── */
function isValidCodeUnique(s: unknown) {
  const v = String(s || "");
  // Validation stricte : AAA-000000 (3 lettres majuscules + tiret + 6 chiffres)
  return /^[A-Z]{3}-\d{6}$/.test(v);
}
function cleanAcronym(s: unknown) {
  // On n'impose rien : si fourni, on nettoie juste un minimum
  const v = String(s || "").trim();
  if (!v) return null as string | null;
  return v.toUpperCase().slice(0, 16); // limite raisonnable
}

type ServerSupaPromise = ReturnType<typeof getSupabaseServerClient>;

async function guard(supaP: ServerSupaPromise) {
  const supa = await supaP; // ← résoudre UNE seule fois

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();
  if (userErr) return { error: String(userErr.message) };
  if (!user) return { error: "unauthorized" };

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: String(meErr.message) };
  if (!me?.institution_id) return { error: "no_institution" };

  const role = String(me.role || "");
  const isAdmin = role === "admin" || role === "super_admin";
  if (!isAdmin) return { error: "forbidden" };

  return { user, instId: String(me.institution_id) };
}

/* 
  GET  /api/admin/institution
  → récupère les infos de base de l’établissement courant (de l’admin connecté)
*/
export async function GET(_req: NextRequest) {
  const supaP = getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const g = await guard(supaP);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const { data, error } = await srv
    .from("institutions")
    .select(
      "id, name, code_unique, acronym, tz, auto_lateness, default_session_minutes"
    )
    .eq("id", g.instId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    id: data?.id,
    name: data?.name ?? null,
    code_unique: data?.code_unique ?? null,
    acronym: data?.acronym ?? null,
    tz: data?.tz ?? "Africa/Abidjan",
    auto_lateness: Boolean(data?.auto_lateness ?? true),
    default_session_minutes: Number(data?.default_session_minutes ?? 60),
  });
}

/* 
  PUT  /api/admin/institution
  Body JSON (tous optionnels, on n’update que ce qui est fourni) :
  {
    "name": "Collège Sainte-Kizito",
    "acronym": "CSK",
    "code_unique": "CSK-000657"   // validation stricte, pas de padding auto
  }
*/
export async function PUT(req: NextRequest) {
  const supaP = getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const g = await guard(supaP);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));

  const updates: Record<string, any> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length === 0) {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    }
    updates.name = name;
  }

  if (typeof body.acronym !== "undefined") {
    const ac = cleanAcronym(body.acronym);
    // on autorise null pour effacer
    updates.acronym = ac;
  }

  if (typeof body.code_unique !== "undefined") {
    const code = String(body.code_unique || "");
    if (!isValidCodeUnique(code)) {
      return NextResponse.json({ error: "invalid_code_unique_format" }, { status: 400 });
    }
    // Unicité stricte cross-institutions
    const { data: exists, error: exErr } = await srv
      .from("institutions")
      .select("id")
      .eq("code_unique", code)
      .neq("id", g.instId)
      .maybeSingle();

    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });
    if (exists) {
      return NextResponse.json({ error: "code_unique_taken" }, { status: 409 });
    }
    updates.code_unique = code;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const { error } = await srv
    .from("institutions")
    .update(updates)
    .eq("id", g.instId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, updated: Object.keys(updates) });
}
