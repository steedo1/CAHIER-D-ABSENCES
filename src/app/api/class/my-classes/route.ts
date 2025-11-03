// src/app/api/class/my-classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ─────────────────────────────────────────
   Helpers
────────────────────────────────────────── */
function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

type PhoneVariants = {
  variants: string[];
  likePatterns: string[];
  debug: { raw: string; digits: string; local10: string; localNo0: string };
};

/** Toujours retourner un objet typé (jamais un tableau nu) */
function buildPhoneVariants(raw: string): PhoneVariants {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");

  // Valeurs par défaut “vides” mais typées
  let local10 = "";
  let localNo0 = "";

  if (digits) {
    // Local 10 chiffres (CI)
    local10 = digits.slice(-10);
    localNo0 = local10.replace(/^0/, "");
  }

  const cc = "225";

  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),

    digits,

    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,

    `00${cc}${local10}`,
    `00${cc}${localNo0}`,

    `${cc}${local10}`,
    `${cc}${localNo0}`,

    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
    localNo0 ? `%${cc}${localNo0}%` : "",
    localNo0 ? `%+${cc}${localNo0}%` : "",
    localNo0 ? `%00${cc}${localNo0}%` : "",
  ]);

  return { variants, likePatterns, debug: { raw: t, digits, local10, localNo0 } };
}

/* ─────────────────────────────────────────
   Handler
────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const srv = getSupabaseServiceClient();

  // 1) Téléphone depuis l’auth
  let phone = String(user.phone || "").trim();

  // 2) Fallback robuste: auth.users (schéma auth)
  if (!phone) {
    const { data: au, error: auErr } = await srv
      .schema("auth")
      .from("users")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();
    if (auErr) return NextResponse.json({ error: auErr.message }, { status: 400 });
    phone = String(au?.phone || "").trim();
  }

  if (!phone) return NextResponse.json({ items: [], hint: "no_phone_on_auth" });

  const { variants, likePatterns, debug } = buildPhoneVariants(phone);

  // 3) Match exact sur un set de variantes
  let items: any[] = [];
  {
    const { data, error } = await srv
      .from("classes")
      .select("id,label,level,institution_id,class_phone_e164")
      .in("class_phone_e164", variants.length ? variants : ["__no_match__"]); // évite .in([])

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    items = data || [];
  }

  // 4) Fallback flou si rien trouvé (espaces/traits dans la colonne)
  if (items.length === 0 && likePatterns.length) {
    const orExpr = likePatterns.map((p: string) => `class_phone_e164.ilike.${p}`).join(",");
    if (orExpr) {
      const { data, error } = await srv
        .from("classes")
        .select("id,label,level,institution_id,class_phone_e164")
        .or(orExpr);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      items = data || [];
    }
  }

  // Debug optionnel
  const wantDebug = (new URL(req.url).searchParams.get("debug") || "") === "1";
  return NextResponse.json(
    wantDebug ? { items, debug: { phone, ...debug, variants, likePatterns } } : { items }
  );
}
