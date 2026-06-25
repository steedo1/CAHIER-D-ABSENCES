import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | string;

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferLevelFromClassLabel(label: unknown, fallbackLevel: unknown) {
  const labelText = normalizeText(label);
  const fallbackText = String(fallbackLevel || "").trim();

  // La classe est plus fiable pour le périmètre immédiat que le niveau stocké :
  // si une classe s'appelle "Tle D1" mais que son niveau est mal renseigné, l'IA
  // doit raisonner sur Terminale/BAC et non sur 1ère.
  if (/\b(tle|terminale|terminal)\b/.test(labelText)) return "Terminale";
  if (/\b(3e|3eme|troisieme)\b/.test(labelText)) return "3e";
  if (/\b(2nde|2de|seconde)\b/.test(labelText)) return "2nde";
  if (/\b(1ere|1re|premiere)\b/.test(labelText)) return "1ère";
  if (/\b(6e|6eme|sixieme)\b/.test(labelText)) return "6e";
  if (/\b(5e|5eme|cinquieme)\b/.test(labelText)) return "5e";
  if (/\b(4e|4eme|quatrieme)\b/.test(labelText)) return "4e";

  return fallbackText || null;
}

async function getAdminContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: meErr.message, status: 400 as const };

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) return { error: "no_institution", status: 400 as const };

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = ((roleRow?.role as Role | undefined) || "") as Role;
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return { error: "forbidden", status: 403 as const };
  }

  return { supa, srv, user, institution_id, role };
}

export async function GET() {
  try {
    const ctx = await getAdminContext();
    if ("error" in ctx) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const [{ data: classes, error: classesErr }, { data: years, error: yearsErr }] = await Promise.all([
      ctx.srv
        .from("classes")
        .select("id,label,level,academic_year")
        .eq("institution_id", ctx.institution_id)
        .order("academic_year", { ascending: false })
        .order("level", { ascending: true })
        .order("label", { ascending: true }),
      ctx.srv
        .from("academic_years")
        .select("id,code,label,start_date,end_date,is_current")
        .eq("institution_id", ctx.institution_id)
        .order("start_date", { ascending: false }),
    ]);

    if (classesErr) {
      return NextResponse.json({ ok: false, error: classesErr.message }, { status: 400 });
    }

    if (yearsErr) {
      return NextResponse.json({ ok: false, error: yearsErr.message }, { status: 400 });
    }

    const currentYear = (years || []).find((y: any) => Boolean(y.is_current)) || (years || [])[0] || null;

    return NextResponse.json({
      ok: true,
      model: {
        key: "mon_cahier_ai_pedagogy",
        version: "2.0.0",
        mode: "assistant+features+ml_ready",
      },
      current_academic_year: currentYear,
      academic_years: years || [],
      classes: (classes || []).map((cls: any) => ({
        ...cls,
        level: inferLevelFromClassLabel(cls?.label, cls?.level),
      })),
      presets: [
        "Quels élèves de 3e doivent être suivis avant le BEPC ?",
        "Quelle classe a le plus fort risque de baisse au deuxième trimestre ?",
        "Quelles matières bloquent les élèves de 2nde A ?",
        "Résume-moi la situation pédagogique de cette école.",
        "Prépare une note pour le conseil de classe.",
        "Propose un plan de remédiation.",
      ],
      ethics_notice:
        "Mon Cahier IA est une aide à la décision pédagogique. Les résultats doivent être validés par l’équipe éducative.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "mon_cahier_ai_bootstrap_failed" },
      { status: 500 },
    );
  }
}
