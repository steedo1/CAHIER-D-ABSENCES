//src/app/api/public/bulletins/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { verifyBulletinQR } from "@/lib/bulletin-qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") || "";
  const payload = verifyBulletinQR(token);

  if (!payload) {
    return NextResponse.json({ ok: false, error: "invalid_qr" }, { status: 400 });
  }

  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  // On renvoie MINIMUM (anti-fuite)
  const [{ data: inst }, { data: cls }, { data: stu }] = await Promise.all([
    srv.from("institutions").select("id, name, code").eq("id", payload.instId).maybeSingle(),
    srv.from("classes").select("id, name, level").eq("id", payload.classId).maybeSingle(),
    srv.from("students").select("id, full_name, matricule").eq("id", payload.studentId).maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      institution: inst ? { id: inst.id, name: inst.name, code: (inst as any).code ?? null } : null,
      class: cls ? { id: cls.id, name: (cls as any).name ?? null, level: (cls as any).level ?? null } : null,
      student: stu ? { id: stu.id, full_name: (stu as any).full_name ?? null, matricule: (stu as any).matricule ?? null } : null,
      academic_year: payload.academicYear ?? null,
      term_label: payload.termLabel ?? null,
      issued_at: payload.iat,
    },
  });
}
