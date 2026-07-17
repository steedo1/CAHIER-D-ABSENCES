import { NextRequest, NextResponse } from "next/server";
import { cleanText, requireTextbookManager } from "@/lib/textbook/context";
import { resolveTextbookSubjectForInstitution } from "@/lib/textbook/subject-matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeLabel(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isManualAssignmentSubject(subjectName: unknown) {
  const normalized = normalizeLabel(subjectName);
  return (
    normalized.includes("lv2") ||
    normalized.includes("espagnol") ||
    normalized.includes("allemand") ||
    normalized.includes("musique") ||
    normalized.includes("education musicale") ||
    normalized.includes("art plastique") ||
    normalized.includes("arts plastique")
  );
}

function levelAliases(level: unknown) {
  const normalized = normalizeLabel(level);
  const aliases = new Set<string>();
  if (normalized) aliases.add(normalized);

  const secondAorC =
    normalized.match(/^(2nde|seconde)\s+a\s*c$/) ||
    normalized.match(/^(2nde|seconde)\s+a\s+c$/) ||
    normalized.match(/^(2nde|seconde)\s+a\s*[-/]\s*c$/);
  if (secondAorC) {
    aliases.add(`${secondAorC[1]} a`);
    aliases.add(`${secondAorC[1]} c`);
  }

  return Array.from(aliases).filter(Boolean);
}

function classMatchesLevel(row: any, level: unknown) {
  const aliases = levelAliases(level);
  if (!aliases.length) return false;
  const classLevel = normalizeLabel(row?.level);
  const classLabel = normalizeLabel(row?.label || row?.name);
  return aliases.some(
    (alias) => classLevel === alias || classLabel.includes(alias),
  );
}

async function autoAssignCompatibleClasses(
  srv: any,
  institutionId: string,
  userId: string,
  progression: any,
  progressionId: string,
) {
  if (isManualAssignmentSubject(progression?.subject_name)) {
    return { count: 0, skipped: "manual_subject" };
  }

  async function fetchClasses(filterYear: boolean) {
    let query = srv
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId);

    if (filterYear && progression?.academic_year) {
      query = query.eq("academic_year", progression.academic_year);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  let classes = await fetchClasses(true);
  if (!classes.length) classes = await fetchClasses(false);

  const classIds = classes
    .filter((row: any) => classMatchesLevel(row, progression?.level))
    .map((row: any) => String(row.id))
    .filter(Boolean);

  if (!classIds.length) return { count: 0, skipped: "no_matching_class" };

  const rows = Array.from(new Set(classIds)).map((classId) => ({
    institution_id: institutionId,
    progression_id: progressionId,
    class_id: classId,
    teacher_id: null,
    subject_id: progression?.subject_id || null,
    institution_subject_id: progression?.institution_subject_id || null,
    is_active: true,
    created_by: userId,
    updated_by: userId,
  }));

  const { data, error } = await srv
    .from("textbook_progression_class_assignments")
    .upsert(rows, {
      onConflict: "progression_id,class_id,teacher_id_key",
      ignoreDuplicates: false,
    })
    .select("id");

  if (!error) return { count: (data || []).length, skipped: null };

  const touched: any[] = [];
  for (const row of rows) {
    const { data: existing } = await srv
      .from("textbook_progression_class_assignments")
      .select("id")
      .eq("progression_id", row.progression_id)
      .eq("class_id", row.class_id)
      .is("teacher_id", null)
      .maybeSingle();

    if ((existing as any)?.id) {
      const { data: updated, error: updateErr } = await srv
        .from("textbook_progression_class_assignments")
        .update({
          is_active: true,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", (existing as any).id)
        .select("id")
        .maybeSingle();
      if (updateErr) throw updateErr;
      touched.push(updated);
    } else {
      const { data: created, error: insertErr } = await srv
        .from("textbook_progression_class_assignments")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (insertErr) throw insertErr;
      touched.push(created);
    }
  }

  return { count: touched.length, skipped: null };
}

function cloneItem(
  raw: any,
  newProgressionId: string,
  schoolInstitutionId: string,
  idMap: Map<string, string>,
) {
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
    metadata:
      raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
    source_national_item_id: oldId || null,
    is_customized: false,
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;
  const body = await req.json().catch(() => ({}));
  const titleOverride = cleanText(body.title, 180);
  const shouldAutoAssign = body.auto_assign === true;

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

  if (nationalErr)
    return NextResponse.json(
      { ok: false, error: nationalErr.message },
      { status: 400 },
    );
  if (!national)
    return NextResponse.json(
      { ok: false, error: "national_progression_not_found" },
      { status: 404 },
    );
  if ((national as any).status !== "active") {
    return NextResponse.json(
      { ok: false, error: "national_progression_not_published" },
      { status: 400 },
    );
  }

  let resolvedSubject;
  try {
    resolvedSubject = await resolveTextbookSubjectForInstitution(
      srv,
      institutionId,
      {
        subject_id: (national as any).subject_id,
        institution_subject_id: (national as any).institution_subject_id,
        subject_name: (national as any).subject_name,
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "subject_resolution_failed" },
      { status: 400 },
    );
  }

  const effectiveNational = {
    ...(national as any),
    subject_id: resolvedSubject.subject_id,
    institution_subject_id: resolvedSubject.institution_subject_id,
    subject_name:
      resolvedSubject.subject_name || (national as any).subject_name,
  };

  const { data: existing } = await srv
    .from("textbook_progression_templates")
    .select(
      "id,title,academic_year,subject_id,institution_subject_id,subject_name,level,series,status,source_national_template_id",
    )
    .eq("institution_id", institutionId)
    .eq("scope", "school")
    .eq("source_national_template_id", id)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();

  if ((existing as any)?.id) {
    const repairPayload = {
      subject_id: effectiveNational.subject_id || null,
      institution_subject_id: effectiveNational.institution_subject_id || null,
      subject_name: effectiveNational.subject_name || null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    await srv
      .from("textbook_progression_templates")
      .update(repairPayload)
      .eq("id", (existing as any).id)
      .eq("institution_id", institutionId);

    await srv
      .from("textbook_progression_class_assignments")
      .update({
        subject_id: repairPayload.subject_id,
        institution_subject_id: repairPayload.institution_subject_id,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("progression_id", (existing as any).id)
      .eq("institution_id", institutionId);

    let autoAssigned = { count: 0, skipped: null as string | null };
    if (shouldAutoAssign) {
      try {
        autoAssigned = await autoAssignCompatibleClasses(
          srv,
          institutionId,
          userId,
          effectiveNational,
          (existing as any).id,
        );
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: e?.message || "auto_assign_failed" },
          { status: 400 },
        );
      }
    }
    return NextResponse.json({
      ok: true,
      item: existing,
      already_exists: true,
      copied_items: 0,
      auto_assigned_classes: autoAssigned.count,
      auto_assign_skipped: autoAssigned.skipped,
    });
  }

  const newProgressionId = crypto.randomUUID();
  const { data: created, error: createErr } = await srv
    .from("textbook_progression_templates")
    .insert({
      id: newProgressionId,
      institution_id: institutionId,
      academic_year: (national as any).academic_year,
      document_id: (national as any).document_id || null,
      subject_id: effectiveNational.subject_id || null,
      institution_subject_id: effectiveNational.institution_subject_id || null,
      subject_name: effectiveNational.subject_name || null,
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

  if (createErr)
    return NextResponse.json(
      { ok: false, error: createErr.message },
      { status: 400 },
    );

  const { data: nationalItems, error: itemsErr } = await srv
    .from("textbook_progression_items")
    .select("*")
    .eq("progression_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsErr)
    return NextResponse.json(
      { ok: false, error: itemsErr.message },
      { status: 400 },
    );

  const idMap = new Map<string, string>();
  const rows = ((nationalItems || []) as any[]).map((item) =>
    cloneItem(item, newProgressionId, institutionId, idMap),
  );

  if (rows.length) {
    // Deuxième passe pour rattacher les parents dont le parent apparaît après l'enfant.
    for (const index in rows) {
      const source = (nationalItems || [])[Number(index)] as any;
      if (source?.parent_id)
        rows[index].parent_id = idMap.get(String(source.parent_id)) || null;
    }

    const { error: insertItemsErr } = await srv
      .from("textbook_progression_items")
      .insert(rows);
    if (insertItemsErr) {
      await srv
        .from("textbook_progression_templates")
        .delete()
        .eq("id", newProgressionId);
      return NextResponse.json(
        { ok: false, error: insertItemsErr.message },
        { status: 400 },
      );
    }
  }

  let autoAssigned = { count: 0, skipped: null as string | null };
  if (shouldAutoAssign) {
    try {
      autoAssigned = await autoAssignCompatibleClasses(
        srv,
        institutionId,
        userId,
        effectiveNational,
        newProgressionId,
      );
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || "auto_assign_failed" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: true,
      item: created,
      already_exists: false,
      copied_items: rows.length,
      auto_assigned_classes: autoAssigned.count,
      auto_assign_skipped: autoAssigned.skipped,
    },
    { status: 201 },
  );
}
