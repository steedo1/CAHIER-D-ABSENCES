//src/app/api/class/roster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const class_id = String(url.searchParams.get("class_id") || "").trim();
  if (!class_id) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const allowed = await classDeviceMayAccessClass({
    service: srv,
    userId: user.id,
    userPhone: user.phone,
    classId: class_id,
  });
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
