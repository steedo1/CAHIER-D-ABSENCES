// src/app/api/public/bulletins/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { verifyBulletinQR } from "@/lib/bulletin-qr";
import { resolveBulletinByCode } from "@/lib/bulletin-qr-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("c") || "").trim();
  const token = (req.nextUrl.searchParams.get("t") || "").trim();

  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  // 1) Nouveau chemin: code court ?c=...
  if (code) {
    const resolved = await resolveBulletinByCode(srv, code);
    if (!resolved.ok) {
      return NextResponse.json(
        { ok: false, error: resolved.error },
        { status: 400 }
      );
    }

    const payload = resolved.payload as {
      instId: string;
      classId?: string;
      studentId?: string;
    };

    const [{ data: inst }, { data: cls }, { data: stu }] = await Promise.all([
      srv
        .from("institutions")
        .select("id, name, code")
        .eq("id", payload.instId)
        .maybeSingle(),
      payload.classId
        ? srv
            .from("classes")
            .select("id, label, name, level, academic_year")
            .eq("id", payload.classId)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      payload.studentId
        ? srv
            .from("students")
            .select(
              "id, full_name, matricule, gender, birthdate, birth_place"
            )
            .eq("id", payload.studentId)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    return NextResponse.json({
      ok: true,
      mode: "code",
      institution: inst ?? null,
      class: cls ?? null,
      student: stu ?? null,
    });
  }

  // 2) Ancien chemin: token signé ?t=...
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing_qr_param" },
      { status: 400 }
    );
  }

  const payload = verifyBulletinQR(token) as
    | {
        instId: string;
        classId: string;
        studentId: string;
      }
    | null;

  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "invalid_qr" },
      { status: 400 }
    );
  }

  const [{ data: inst }, { data: cls }, { data: stu }] = await Promise.all([
    srv
      .from("institutions")
      .select("id, name, code")
      .eq("id", payload.instId)
      .maybeSingle(),
    srv
      .from("classes")
      .select("id, label, name, level, academic_year")
      .eq("id", payload.classId)
      .maybeSingle(),
    srv
      .from("students")
      .select(
        "id, full_name, matricule, gender, birthdate, birth_place"
      )
      .eq("id", payload.studentId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true,
    mode: "token",
    institution: inst ?? null,
    class: cls ?? null,
    student: stu ?? null,
  });
}
