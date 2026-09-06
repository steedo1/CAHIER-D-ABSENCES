import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeDate(value: string | null) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function nextUtcDay(ymd: string) {
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meError } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meError) return NextResponse.json({ error: meError.message }, { status: 400 });
  const institutionId = String(me?.institution_id || "").trim();
  if (!institutionId) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const date = normalizeDate(new URL(req.url).searchParams.get("date"));
  if (!date) return NextResponse.json({ error: "bad_date" }, { status: 400 });

  const { start, end } = nextUtcDay(date);
  const { data: sessions, error: sessionsError } = await srv
    .from("teacher_sessions")
    .select("id,class_id,subject_id,teacher_id,started_at,ended_at")
    .eq("institution_id", institutionId)
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString());

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 400 });
  }

  const teacherIds = Array.from(
    new Set((sessions || []).map((row: any) => String(row.teacher_id || "")).filter(Boolean)),
  );
  const subjectIds = Array.from(
    new Set((sessions || []).map((row: any) => String(row.subject_id || "")).filter(Boolean)),
  );

  const [{ data: teachers }, { data: institutionSubjects }] = await Promise.all([
    teacherIds.length
      ? srv.from("profiles").select("id,display_name,email,phone").in("id", teacherIds)
      : Promise.resolve({ data: [] as any[] }),
    subjectIds.length
      ? srv
          .from("institution_subjects")
          .select("id,custom_name,subjects:subject_id(id,name)")
          .eq("institution_id", institutionId)
          .in("id", subjectIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const teacherNames = new Map<string, string>();
  for (const row of teachers || []) {
    const name =
      String((row as any).display_name || "").trim() ||
      String((row as any).email || "").trim() ||
      String((row as any).phone || "").trim() ||
      "Enseignant";
    teacherNames.set(String((row as any).id), name);
  }

  const subjectNames = new Map<string, string>();
  for (const row of institutionSubjects || []) {
    const relation = Array.isArray((row as any).subjects)
      ? (row as any).subjects[0]
      : (row as any).subjects;
    const name =
      String((row as any).custom_name || "").trim() ||
      String(relation?.name || "").trim() ||
      "Discipline";
    subjectNames.set(String((row as any).id), name);
  }

  return NextResponse.json({
    institution_id: institutionId,
    date,
    rows: (sessions || []).map((row: any) => ({
      id: String(row.id),
      class_id: String(row.class_id || "") || null,
      subject_id: String(row.subject_id || "") || null,
      teacher_id: String(row.teacher_id || "") || null,
      teacher_name: teacherNames.get(String(row.teacher_id || "")) || "Enseignant",
      subject_name: subjectNames.get(String(row.subject_id || "")) || "Discipline",
      started_at: row.started_at || null,
      ended_at: row.ended_at || null,
    })),
  });
}
