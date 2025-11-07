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
  const id = rid();
  const srv = getSupabaseServiceClient();
  try {
    // 1) Lire le cookie (Next 15 : cookies() est async)
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    console.info(`[parent.children:${id}] cookie`, { deviceId });

    if (!deviceId) {
      console.warn(`[parent.children:${id}] NO_DEVICE_ID`);
      return NextResponse.json({ items: [] });
    }

    // 2) Récupérer les associations device → student
    const { data: links, error: lErr } = await srv
      .from("parent_device_children")
      .select("student_id,institution_id")
      .eq("device_id", deviceId);

    if (lErr) {
      console.error(`[parent.children:${id}] select links error`, lErr);
      return NextResponse.json({ error: lErr.message }, { status: 400 });
    }
    const studentIds = (links ?? []).map(r => r.student_id).filter(Boolean);
    console.info(`[parent.children:${id}] links`, { count: studentIds.length });

    if (studentIds.length === 0) return NextResponse.json({ items: [] });

    // 3) Charger les élèves
    const { data: studs, error: sErr } = await srv
      .from("students")
      .select("id, first_name, last_name, matricule")
      .in("id", studentIds);

    if (sErr) {
      console.error(`[parent.children:${id}] select students error`, sErr);
      return NextResponse.json({ error: sErr.message }, { status: 400 });
    }

    // 4) Formater pour le dashboard parent
    const items = (studs ?? []).map(s => ({
      id: s.id,
      full_name: full(s.first_name, s.last_name),
      class_label: null as string | null, // (facultatif) si tu veux, on branchera plus tard
      matricule: s.matricule ?? null,
    }));

    console.info(`[parent.children:${id}] ok`, { items: items.length });
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error(`[parent.children:${id}] fatal`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
