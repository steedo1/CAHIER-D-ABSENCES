import { NextRequest, NextResponse } from "next/server";
import { cleanText, requireTextbookManager } from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cloneItem(raw: any, newProgressionId: string, schoolInstitutionId: string, idMap: Map<string, string>) {
  const newId = crypto.randomUUID();
  const oldId = String(raw.id || "");
  if (oldId) idMap.set(oldId, newId);

  return {
    id: newId,
    institution_id: schoolInstitutionId,
    progression_id: newProgressionId,
    parent_id: raw.parent_id ? idMap.get(String(raw.parent_id)) || null : null,
    item_type: raw.item_type || "lesson",
    title: raw.title,
    description: raw.description || null,
    rubric: raw.rubric || null,
    theme: raw.theme || null,
    competency: raw.competency || null,
    trimester: raw.trimester || null,
    month_label: raw.month_label || null,
    week_label: raw.week_label || null,
    planned_duration_minutes: raw.planned_duration_minutes || null,
    planned_sessions_count: raw.planned_sessions_count || null,
    sort_order: raw.sort_order || 0,
    indent_level: raw.indent_level || 0,
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
    source_national_item_id: oldId || null,
    is_customized: false,
  };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;
  const body = await req.json().catch(() => ({}));
  const titleOverride = cleanText(body.title, 180);

  const { data: national, error: nationalErr } = await srv
    .from("textbook_progression_templates")
    .select(
      `
      id,
      institution_id,
      academic_year,
      document_id,
      subject_id,
      institution_subject_id,
      subject_name,
      level,
      series,
      title,
      description,
      status,
      scope,
      source_metadata
    `,
    )
    .eq("id", id)
    .eq("scope", "national")
    .maybeSingle();

  if (nationalErr) return NextResponse.json({ ok: false, error: nationalErr.message }, { status: 400 });
  if (!national) return NextResponse.json({ ok: false, error: "national_progression_not_found" }, { status: 404 });
  if ((national as any).status !== "active") {
    return NextResponse.json({ ok: false, error: "national_progression_not_published" }, { status: 400 });
  }

  const { data: existing } = await srv
    .from("textbook_progression_templates")
    .select("id,title,academic_year,subject_name,level,series,status,source_national_template_id")
    .eq("institution_id", institutionId)
    .eq("scope", "school")
    .eq("source_national_template_id", id)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();

  if ((existing as any)?.id) {
    return NextResponse.json({ ok: true, item: existing, already_exists: true, copied_items: 0 });
  }

  let schoolInstitutionSubjectId: string | null = null;
  if ((national as any).subject_id) {
    const { data: instSubject } = await srv
      .from("institution_subjects")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("subject_id", (national as any).subject_id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    schoolInstitutionSubjectId = (instSubject as any)?.id || null;
  }

  const newProgressionId = crypto.randomUUID();
  const { data: created, error: createErr } = await srv
    .from("textbook_progression_templates")
    .insert({
      id: newProgressionId,
      institution_id: institutionId,
      academic_year: (national as any).academic_year,
      document_id: (national as any).document_id || null,
      subject_id: (national as any).subject_id || null,
      institution_subject_id: schoolInstitutionSubjectId,
      subject_name: (national as any).subject_name || null,
      level: (national as any).level,
      series: (national as any).series || null,
      title: titleOverride || (national as any).title,
      description: (national as any).description || null,
      status: "active",
      scope: "school",
      source_national_template_id: id,
      is_customized: false,
      source_metadata: {
        copied_from_title: (national as any).title,
        copied_at: new Date().toISOString(),
      },
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .maybeSingle();

  if (createErr) return NextResponse.json({ ok: false, error: createErr.message }, { status: 400 });

  const { data: nationalItems, error: itemsErr } = await srv
    .from("textbook_progression_items")
    .select("*")
    .eq("progression_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 400 });

  const idMap = new Map<string, string>();
  const rows = ((nationalItems || []) as any[]).map((item) =>
    cloneItem(item, newProgressionId, institutionId, idMap),
  );

  if (rows.length) {
    // Deuxième passe pour rattacher les parents dont le parent apparaît après l'enfant.
    for (const index in rows) {
      const source = (nationalItems || [])[Number(index)] as any;
      if (source?.parent_id) rows[index].parent_id = idMap.get(String(source.parent_id)) || null;
    }

    const { error: insertItemsErr } = await srv.from("textbook_progression_items").insert(rows);
    if (insertItemsErr) {
      await srv.from("textbook_progression_templates").delete().eq("id", newProgressionId);
      return NextResponse.json({ ok: false, error: insertItemsErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, item: created, already_exists: false, copied_items: rows.length }, { status: 201 });
}
