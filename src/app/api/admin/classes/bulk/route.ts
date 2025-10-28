// app/api/admin/classes/bulk/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Body = {
  level: string;
  format: "none" | "numeric" | "alpha";   // �& supporte aussi "none"
  count: number;
  academic_year?: string | null;
  codePrefix?: string | null; // ex: "LYC-ABJ" �  LYC-ABJ-6e1
};

// slugify simple et d�terministe
function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Ann�e scolaire par d�faut avec pivot en ao�t
function computeAcademicYear(d = new Date()) {
  const m = d.getUTCMonth() + 1; // 1..12
  const y = d.getUTCFullYear();
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;

  const level = (body.level ?? "").trim();
  const format = body.format;
  const count = Number(body.count ?? 0);
  const academic_year = (body.academic_year ?? computeAcademicYear()) as string; // jamais null
  const codePrefix = body.codePrefix ?? null;

  // Validation robuste : "none" autoris� et on forcera count=1
  const formatOk = format === "none" || format === "numeric" || format === "alpha";
  const countOk = Number.isFinite(count) && (format === "none" ? true : count >= 1 && count <= 30);

  if (!level || !formatOk || !countOk) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  // 1) institution du user connect�
  const supabaseAuth = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.institution_id) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const institution_id = me.institution_id as string;

  // 2) labels : pour "none", on cr�e exactement le niveau (ex: "CM2")
  const effectiveCount = format === "none" ? 1 : count;
  let labels: string[] = [];

  if (format === "none") {
    labels = [level];
  } else if (format === "numeric") {
    labels = Array.from({ length: effectiveCount }, (_, i) => `${level}${i + 1}`);
  } else {
    labels = Array.from({ length: effectiveCount }, (_, i) => `${level}${String.fromCharCode(65 + i)}`); // 65='A'
  }

  // 3) payload avec code toujours non-null + academic_year toujours renseign�
  const rows = labels.map((label) => {
    const base = slug(label); // ex: "cm2", "6e1", "6ea"
    const code = codePrefix ? `${codePrefix}-${base}` : base;
    return {
      institution_id,
      label,
      level,
      code,           // jamais null
      academic_year,  // jamais null
    };
  });

  // 4) UPSERT
  const supabaseAdmin = getSupabaseServiceClient();
  const { data, error } = await supabaseAdmin
    .from("classes")
    .upsert(rows, { onConflict: "institution_id,label" }) // n�cessite unique (institution_id,label)
    .select("id,label,level,code,academic_year");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ inserted: data?.length ?? 0, items: data ?? [] });
}


