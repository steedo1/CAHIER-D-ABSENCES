import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

const DEFAULT_NAME = "(sans nom)";

function sanitizeText(s: unknown): string {
  const raw = String(s ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, "") // supprime caractères de contrôle
    .replace(/\s+/g, " ")
    .trim();
  return raw;
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const from     = searchParams.get("from")      || "";
  const to       = searchParams.get("to")        || "";
  const level    = sanitizeText(searchParams.get("level") || "");
  const class_id = searchParams.get("class_id")  || "";

  // Établissement
  const { data: me } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  const institution_id = me?.institution_id as string | null;
  if (!institution_id) return NextResponse.json({ items: [] });

  // Marques sur la période
  let mq = srv
    .from("v_mark_minutes")
    .select("class_id, subject_id, started_at")
    .eq("institution_id", institution_id)
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  if (class_id) mq = mq.eq("class_id", class_id);

  const { data: rawMarks, error } = await mq;
  if (error) return NextResponse.json({ items: [], error: error.message }, { status: 400 });
  let marks = (rawMarks || []) as Array<{ class_id: string | null; subject_id: string | null }>;

  // Filtre par niveau si pas de class_id
  if (!class_id && level) {
    const classIds = Array.from(new Set(marks.map(m => m.class_id).filter(Boolean))) as string[];
    if (classIds.length) {
      const { data: classes } = await srv
        .from("classes").select("id, level")
        .in("id", classIds);
      const lvlMap = new Map<string, string>(
        (classes || []).map(c => [c.id as string, sanitizeText((c as any).level)])
      );
      marks = marks.filter(m => sanitizeText(lvlMap.get(m.class_id as string)) === level);
    } else {
      marks = [];
    }
  }

  // IDs de matière (peuvent être des institution_subjects.id OU des subjects.id)
  const subjIds = Array.from(
    new Set(marks.map(m => m.subject_id).filter(Boolean).map(String))
  );

  const nameMap = new Map<string, string>();
  if (subjIds.length) {
    // 1) institution_subjects par id
    const { data: isById } = await srv
      .from("institution_subjects")
      .select("id, subject_id, custom_name, subjects:subject_id(name)")
      .in("id", subjIds);
    for (const r of isById || []) {
      const id     = r.id as string;
      const subjId = (r as any).subject_id as string | null;
      const custom = sanitizeText((r as any).custom_name);
      const std    = sanitizeText((r as any).subjects?.name);
      if (custom) nameMap.set(id, custom);
      else if (std) nameMap.set(id, std);
      if (subjId && (custom || std) && !nameMap.has(subjId)) {
        nameMap.set(subjId, custom || std);
      }
    }

    // 2) institution_subjects par subject_id
    const { data: isBySubject } = await srv
      .from("institution_subjects")
      .select("id, subject_id, custom_name, subjects:subject_id(name)")
      .in("subject_id", subjIds);
    for (const r of isBySubject || []) {
      const id     = r.id as string;
      const subjId = (r as any).subject_id as string | null;
      const custom = sanitizeText((r as any).custom_name);
      const std    = sanitizeText((r as any).subjects?.name);
      if (subjId && (custom || std)) nameMap.set(subjId, custom || std);
      if (!nameMap.has(id) && (custom || std)) nameMap.set(id, custom || std);
    }

    // 3) fallback direct sur la table subjects (pour les IDs restants)
    const missing = subjIds.filter(id => !nameMap.has(id));
    if (missing.length) {
      const { data: plain } = await srv
        .from("subjects")
        .select("id, name")
        .in("id", missing);
      for (const s of plain || []) {
        nameMap.set(s.id as string, sanitizeText((s as any).name) || DEFAULT_NAME);
      }
    }
  }

  // Agrégat par matière
  const agg = new Map<string, number>();
  for (const m of marks) {
    if (!m.subject_id) continue;
    const sid = String(m.subject_id);
    agg.set(sid, (agg.get(sid) || 0) + 1);
  }

  const items = Array.from(agg.entries())
    .map(([id, abs]) => ({
      name: nameMap.get(id) || DEFAULT_NAME,
      absents: abs,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  return NextResponse.json({ items });
}
