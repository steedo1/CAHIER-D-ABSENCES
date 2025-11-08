//src/app/api/class/roster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}
function buildPhoneVariants(raw: string) {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
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
  ]);

  return { variants, likePatterns };
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const class_id = String(url.searchParams.get("class_id") || "").trim();
  if (!class_id) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  // téléphone du compte courant
  let phone = String(user.phone || "").trim();
  if (!phone) {
    const { data: au } = await srv.schema("auth").from("users").select("phone").eq("id", user.id).maybeSingle();
    phone = String(au?.phone || "").trim();
  }
  const { variants, likePatterns } = buildPhoneVariants(phone);

  // vérif: ce téléphone = téléphone de la classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("class_phone_e164")
    .eq("id", class_id)
    .maybeSingle();

  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

  let allowed = false;
  const stored = String(cls.class_phone_e164 || "");
  if (stored && variants.includes(stored)) allowed = true;
  if (!allowed && likePatterns.length) {
    allowed = likePatterns.some((p) => {
      const pat = p.replace(/%/g, ".*");
      try { return new RegExp(pat).test(stored); } catch { return false; }
    });
  }
  if (!allowed) return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });

  // ⬇️ roster avec le **client service** (pas de RLS) une fois le contrôle passé
  const { data, error } = await srv
    .from("class_enrollments")
    .select(`student_id, students:student_id ( id, first_name, last_name, matricule )`)
    .eq("class_id", class_id)
    .is("end_date", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const items = (data ?? [])
    .map((row: any) => {
      const s = row.students || {};
      const full = [s.last_name, s.first_name].filter(Boolean).join(" ").trim() || "";
      return { id: s.id as string, full_name: full, matricule: s.matricule || null };
    })
    .sort((a: any, b: any) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" })
    );

  return NextResponse.json({ items });
}
