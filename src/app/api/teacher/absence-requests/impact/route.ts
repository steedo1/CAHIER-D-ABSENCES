import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { buildTeacherAbsenceImpact } from "@/lib/teacher-absence-impact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const url = new URL(req.url);

  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");

  if (!start_date || !end_date) {
    return NextResponse.json(
      { ok: false, error: "Veuillez renseigner la date de début et la date de fin." },
      { status: 400 }
    );
  }

  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json(
      { ok: false, error: "Non authentifié." },
      { status: 401 }
    );
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr || !me?.institution_id) {
    return NextResponse.json(
      { ok: false, error: "Institution introuvable." },
      { status: 400 }
    );
  }

  try {
    const impact = await buildTeacherAbsenceImpact({
      institution_id: String(me.institution_id),
      teacher_id: String(me.id),
      start_date,
      end_date,
    });

    return NextResponse.json({ ok: true, impact });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Erreur lors du calcul d’impact.",
      },
      { status: 400 }
    );
  }
}