// src/app/api/teacher/grades/adjustments/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { computeAcademicYear } from "@/lib/academicYear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function toNullishSubjectId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null") return null;
  return s;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type Item = {
  student_id: string;
  bonus?: number | string | null;
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    // Auth
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    // Payload
    const body = (await req.json().catch(() => ({}))) as {
      class_id?: string;
      subject_id?: string | null;
      academic_year?: string;
      items?: Item[];
    };

    const class_id = String(body.class_id || "").trim();
    const subject_id = toNullishSubjectId(body.subject_id);
    const academic_year =
      String(body.academic_year || "").trim() || computeAcademicYear(new Date());
    const items = Array.isArray(body.items) ? body.items : [];

    if (!class_id) return bad("class_id requis");
    if (!items.length) return bad("items vide");

    // Upsert un par un pour respecter la RLS et garder un feedback simple
    let upserted = 0;

    for (const it of items) {
      const student_id = String(it?.student_id || "").trim();
      if (!student_id) continue;

      const rawBonus = it?.bonus;
      const n =
        rawBonus === "" || rawBonus === null || rawBonus === undefined
          ? 0
          : Number(rawBonus);

      if (!Number.isFinite(n)) {
        return bad("bonus invalide", 422, { student_id, bonus: rawBonus });
      }

      const bonus = round2(n);

      const { error } = await supabase
        .from("grade_adjustments")
        .upsert(
          {
            class_id,
            subject_id, // peut être null
            student_id,
            academic_year,
            bonus,
          },
          {
            onConflict: "class_id,subject_id,student_id,academic_year",
          }
        );

      if (error) {
        // 403 si RLS bloque, 400 sinon (on renvoie 400 ici pour rester simple)
        return bad(error.message || "UPSERT_FAILED", 400, { student_id });
      }

      upserted += 1;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (e: any) {
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
