import { NextRequest, NextResponse } from "next/server";
import { cleanUuid, requireTextbookManager } from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId } = auth.ctx;

  const { data, error } = await srv
    .from("textbook_progression_class_assignments")
    .select("id,progression_id,class_id,teacher_id,is_active,created_at,classes:class_id(id,label,level)")
    .eq("institution_id", institutionId)
    .eq("progression_id", id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, items: data || [] });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const rawClassIds = Array.isArray(body.class_ids) ? body.class_ids : [body.class_id];
  const classIds = Array.from(new Set(rawClassIds.map(cleanUuid).filter(Boolean))) as string[];
  const teacherId = cleanUuid(body.teacher_id);

  if (!classIds.length) {
    return NextResponse.json({ ok: false, error: "class_id_required" }, { status: 400 });
  }

  const { data: progression, error: progressionErr } = await srv
    .from("textbook_progression_templates")
    .select("id,subject_id,institution_subject_id,subject_name,scope")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .eq("scope", "school")
    .maybeSingle();

  if (progressionErr) return NextResponse.json({ ok: false, error: progressionErr.message }, { status: 400 });
  if (!progression) return NextResponse.json({ ok: false, error: "progression_not_found" }, { status: 404 });

  const { data: classes, error: classErr } = await srv
    .from("classes")
    .select("id")
    .eq("institution_id", institutionId)
    .in("id", classIds);

  if (classErr) return NextResponse.json({ ok: false, error: classErr.message }, { status: 400 });

  const validClassIds = new Set((classes || []).map((c: any) => String(c.id)));
  const rows = classIds
    .filter((classId) => validClassIds.has(classId))
    .map((classId) => ({
      institution_id: institutionId,
      progression_id: id,
      class_id: classId,
      teacher_id: teacherId,
      subject_id: (progression as any).subject_id || null,
      institution_subject_id: (progression as any).institution_subject_id || null,
      is_active: true,
      created_by: userId,
      updated_by: userId,
    }));

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "no_valid_class" }, { status: 400 });
  }

  const { data, error } = await srv
    .from("textbook_progression_class_assignments")
    .upsert(rows, {
      onConflict: "progression_id,class_id,teacher_id_key",
      ignoreDuplicates: false,
    })
    .select("*");

  if (error) {
    // Fallback si la base ne permet pas encore l'index d'expression comme cible upsert.
    const inserted: any[] = [];
    for (const row of rows) {
      let existingQuery = srv
        .from("textbook_progression_class_assignments")
        .select("id")
        .eq("progression_id", row.progression_id)
        .eq("class_id", row.class_id);

      existingQuery = row.teacher_id
        ? existingQuery.eq("teacher_id", row.teacher_id)
        : existingQuery.is("teacher_id", null);

      const { data: existing } = await existingQuery.maybeSingle();

      if ((existing as any)?.id) {
        const { data: updated, error: updateErr } = await srv
          .from("textbook_progression_class_assignments")
          .update({ is_active: true, updated_by: userId, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id)
          .select("*")
          .maybeSingle();
        if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 400 });
        inserted.push(updated);
      } else {
        const { data: created, error: insertErr } = await srv
          .from("textbook_progression_class_assignments")
          .insert(row)
          .select("*")
          .maybeSingle();
        if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 400 });
        inserted.push(created);
      }
    }
    return NextResponse.json({ ok: true, items: inserted, count: inserted.length }, { status: 201 });
  }

  return NextResponse.json({ ok: true, items: data || [], count: (data || []).length }, { status: 201 });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const assignmentId = cleanUuid(body.assignment_id);
  if (!assignmentId) {
    return NextResponse.json({ ok: false, error: "assignment_id_required" }, { status: 400 });
  }

  const { data, error } = await srv
    .from("textbook_progression_class_assignments")
    .update({
      is_active: body.is_active !== false,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .eq("progression_id", id)
    .eq("institution_id", institutionId)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data });
}
