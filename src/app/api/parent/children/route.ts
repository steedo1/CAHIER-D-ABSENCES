// src/app/api/parent/children/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rid() { return Math.random().toString(36).slice(2, 8); }
function full(first?: string|null, last?: string|null) {
  const f = String(first || "").trim();
  const l = String(last || "").trim();
  return (f && l) ? `${l} ${f}` : (f || l || "—");
}

export async function GET(_req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    if (!deviceId) {
      console.warn(`[parent.children:${trace}] NO_DEVICE_ID`);
      return NextResponse.json({ items: [] });
    }

    // Liens appareil → élèves
    const { data: links, error: lErr } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId);

    if (lErr) {
      console.error(`[parent.children:${trace}] links error`, lErr);
      return NextResponse.json({ error: lErr.message }, { status: 400 });
    }
    const studentIds = Array.from(new Set((links ?? []).map(r => String(r.student_id)).filter(Boolean)));
    if (!studentIds.length) return NextResponse.json({ items: [] });

    // Élèves
    const { data: studs, error: sErr } = await srv
      .from("students")
      .select("id, first_name, last_name, matricule")
      .in("id", studentIds);

    if (sErr) {
      console.error(`[parent.children:${trace}] students error`, sErr);
      return NextResponse.json({ error: sErr.message }, { status: 400 });
    }

    // Classe (inscription active)
    const { data: enrolls, error: eErr } = await srv
      .from("class_enrollments")
      .select("student_id, classes:class_id(label)")
      .in("student_id", studentIds)
      .is("end_date", null);

    if (eErr) console.error(`[parent.children:${trace}] enrolls error`, eErr);
    const clsByStudent = new Map<string, string>();
    for (const e of enrolls || []) {
      clsByStudent.set(String((e as any).student_id), String((e as any).classes?.label ?? ""));
    }

    const items = (studs ?? []).map(s => ({
      id: String(s.id),
      full_name: full(s.first_name, s.last_name),
      class_label: clsByStudent.get(String(s.id)) || null,
      matricule: (s as any).matricule ?? null,
    }));

    console.info(`[parent.children:${trace}] ok`, { items: items.length });
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error(`[parent.children:${trace}] fatal`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
