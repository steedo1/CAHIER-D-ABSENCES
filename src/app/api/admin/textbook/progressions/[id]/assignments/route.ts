import { NextRequest, NextResponse } from "next/server";
import { cleanUuid, requireTextbookManager } from "@/lib/textbook/context";
import { resolveTextbookSubjectForInstitution } from "@/lib/textbook/subject-matching";
import {
  decorateTextbookClassEducation,
  validateTextbookSubjectForClass,
} from "@/lib/textbook/education-context";
import {
  decorateTextbookProgressionEducation,
  textbookProgressionContextMismatchMessage,
} from "@/lib/textbook/progression-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId } = auth.ctx;

  const { data: institution } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();

  const { data, error } = await srv
    .from("textbook_progression_class_assignments")
    .select(
      "id,progression_id,class_id,teacher_id,is_active,created_at,classes:class_id(id,label,level,academic_year,institution_id,education_type,formation_code,formation_level_code)",
    )
    .eq("institution_id", institutionId)
    .eq("progression_id", id)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  const items = ((data || []) as any[]).map((row) => ({
    ...row,
    classes: decorateTextbookClassEducation(
      row?.classes,
      (institution as any)?.settings_json,
    ),
  }));
  return NextResponse.json({ ok: true, items });
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
  const rawClassIds = Array.isArray(body.class_ids)
    ? body.class_ids
    : [body.class_id];
  const classIds = Array.from(
    new Set(rawClassIds.map(cleanUuid).filter(Boolean)),
  ) as string[];
  const teacherId = cleanUuid(body.teacher_id);

  if (!classIds.length) {
    return NextResponse.json(
      { ok: false, error: "class_id_required" },
      { status: 400 },
    );
  }

  const { data: institution } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();

  const { data: progression, error: progressionErr } = await srv
    .from("textbook_progression_templates")
    .select("id,subject_id,institution_subject_id,subject_name,scope,academic_year,level,education_type,formation_code,formation_label,formation_level_code,formation_level_label")
    .eq("id", id)
    .eq("institution_id", institutionId)
    .eq("scope", "school")
    .maybeSingle();

  if (progressionErr)
    return NextResponse.json(
      { ok: false, error: progressionErr.message },
      { status: 400 },
    );
  if (!progression)
    return NextResponse.json(
      { ok: false, error: "progression_not_found" },
      { status: 404 },
    );

  let resolvedSubject;
  try {
    resolvedSubject = await resolveTextbookSubjectForInstitution(
      srv,
      institutionId,
      progression as any,
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "subject_resolution_failed" },
      { status: 400 },
    );
  }

  await srv
    .from("textbook_progression_templates")
    .update({
      subject_id: resolvedSubject.subject_id || null,
      institution_subject_id: resolvedSubject.institution_subject_id || null,
      subject_name:
        resolvedSubject.subject_name ||
        (progression as any).subject_name ||
        null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("institution_id", institutionId);

  const { data: classes, error: classErr } = await srv
    .from("classes")
    .select("id,label,level,academic_year,institution_id,education_type,formation_code,formation_level_code")
    .eq("institution_id", institutionId)
    .in("id", classIds);

  if (classErr)
    return NextResponse.json(
      { ok: false, error: classErr.message },
      { status: 400 },
    );

  const decoratedProgression = decorateTextbookProgressionEducation(
    progression,
    (institution as any)?.settings_json,
  );

  for (const classRow of (classes || []) as any[]) {
    const contextMismatch = textbookProgressionContextMismatchMessage(
      decoratedProgression,
      classRow,
    );
    if (contextMismatch) {
      return NextResponse.json(
        {
          ok: false,
          error: contextMismatch.error,
          message: contextMismatch.message,
          class_id: classRow.id,
          class_label: classRow.label || "Classe",
        },
        { status: contextMismatch.status },
      );
    }

    if (
      decoratedProgression.education_type !== "general_secondary" &&
      decoratedProgression.academic_year &&
      classRow.academic_year &&
      String(decoratedProgression.academic_year) !== String(classRow.academic_year)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "progression_class_academic_year_mismatch",
          message:
            "Cette progression et cette classe n’appartiennent pas à la même année scolaire.",
          class_id: classRow.id,
          class_label: classRow.label || "Classe",
        },
        { status: 409 },
      );
    }

    const validation = await validateTextbookSubjectForClass({
      srv,
      institutionId,
      classRow,
      subjectId: resolvedSubject.subject_id || null,
    });
    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: validation.error,
          message: validation.message,
          class_id: classRow.id,
          class_label: classRow.label || "Classe",
        },
        { status: validation.status },
      );
    }
  }

  const validClassIds = new Set((classes || []).map((c: any) => String(c.id)));
  const rows = classIds
    .filter((classId) => validClassIds.has(classId))
    .map((classId) => ({
      institution_id: institutionId,
      progression_id: id,
      class_id: classId,
      teacher_id: teacherId,
      subject_id: resolvedSubject.subject_id || null,
      institution_subject_id: resolvedSubject.institution_subject_id || null,
      is_active: true,
      created_by: userId,
      updated_by: userId,
    }));

  if (!rows.length) {
    return NextResponse.json(
      { ok: false, error: "no_valid_class" },
      { status: 400 },
    );
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
          .update({
            is_active: true,
            subject_id: row.subject_id,
            institution_subject_id: row.institution_subject_id,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (existing as any).id)
          .select("*")
          .maybeSingle();
        if (updateErr)
          return NextResponse.json(
            { ok: false, error: updateErr.message },
            { status: 400 },
          );
        inserted.push(updated);
      } else {
        const { data: created, error: insertErr } = await srv
          .from("textbook_progression_class_assignments")
          .insert(row)
          .select("*")
          .maybeSingle();
        if (insertErr)
          return NextResponse.json(
            { ok: false, error: insertErr.message },
            { status: 400 },
          );
        inserted.push(created);
      }
    }
    return NextResponse.json(
      { ok: true, items: inserted, count: inserted.length },
      { status: 201 },
    );
  }

  return NextResponse.json(
    { ok: true, items: data || [], count: (data || []).length },
    { status: 201 },
  );
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const assignmentId = cleanUuid(body.assignment_id);
  if (!assignmentId) {
    return NextResponse.json(
      { ok: false, error: "assignment_id_required" },
      { status: 400 },
    );
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

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  return NextResponse.json({ ok: true, item: data });
}
