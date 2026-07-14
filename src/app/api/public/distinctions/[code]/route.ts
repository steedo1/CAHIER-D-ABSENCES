import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeLogo(value: unknown) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url) || url.length > 5000) return null;
  return url;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = String(rawCode || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24,64}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 400 });
  }

  const srv = getSupabaseServiceClient();
  const { data: verification, error } = await srv
    .from("distinction_verifications")
    .select(
      "public_code,institution_id,publication_id,recipient_type,recipient_name,class_label,award_title,summary,created_at",
    )
    .eq("public_code", code)
    .maybeSingle();

  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) {
      return NextResponse.json({ ok: false, error: "verification_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (!verification) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const [{ data: publication }, { data: institution }] = await Promise.all([
    srv
      .from("distinction_publications")
      .select("title,category,academic_year,period_code,date_from,date_to,created_at")
      .eq("id", (verification as any).publication_id)
      .maybeSingle(),
    srv
      .from("institutions")
      .select("name,logo_url,code,code_unique,head_name,head_title")
      .eq("id", (verification as any).institution_id)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true,
    valid: true,
    code: (verification as any).public_code,
    recipient: {
      type: (verification as any).recipient_type,
      name: (verification as any).recipient_name,
      class_label: (verification as any).class_label || null,
    },
    distinction: {
      title: (verification as any).award_title,
      summary: (verification as any).summary || {},
    },
    publication: publication || null,
    institution: {
      name: (institution as any)?.name || "Établissement",
      logo_url: safeLogo((institution as any)?.logo_url),
      code: (institution as any)?.code || (institution as any)?.code_unique || null,
      head_name: (institution as any)?.head_name || null,
      head_title: (institution as any)?.head_title || null,
    },
    verified_at: new Date().toISOString(),
  });
}
