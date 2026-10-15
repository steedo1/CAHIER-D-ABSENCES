import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentStaffAcademicYear,
  getEditableStaffTarget,
  getStaffScope,
} from "@/lib/server/staff-access";
import { editableEducatorClassDiff, isValidUuid } from "@/lib/staff-edit";
import { canonicalEducatorLevel } from "@/lib/educator-level";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Replace only the active-year, explicit class assignments for one educator. */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.class_ids)) {
    return NextResponse.json({ error: "Liste de classes invalide." }, { status: 400 });
  }
  const access = await getStaffScope(req, body.institution_id);
  if (!access.ok) return access.response;
  const target = await getEditableStaffTarget(access.scope, id);
  if (!target.ok) return target.response;
  const { service, institutionId, actorId } = access.scope;

  if (!target.links.some((link) => link.institution_id === institutionId && link.role === "educator")) {
    return NextResponse.json({ error: "Les affectations sont réservées aux éducateurs." }, { status: 403 });
  }
  const requested: string[] = Array.from(new Set(body.class_ids.map((v: unknown) => String(v || ""))));
  if (requested.length > 200 || requested.some((value) => !isValidUuid(value))) {
    return NextResponse.json({ error: "Identifiants de classes incorrects." }, { status: 400 });
  }

  const academicYear = await getCurrentStaffAcademicYear(service, institutionId);
  if (!academicYear || academicYear !== body.academic_year) {
    return NextResponse.json({ error: "Année scolaire modifiée : actualisez les affectations." }, { status: 409 });
  }
  const { data: classes, error: classError } = await service
    .from("classes")
    .select("id,level,academic_year")
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear);
  if (classError || !classes) {
    return NextResponse.json({ error: "Vérification des classes impossible." }, { status: 500 });
  }
  const classById = new Map(classes.map((row) => [String(row.id), String(row.level || "")]));
  if (requested.some((classId) => !classById.has(classId))) {
    return NextResponse.json({ error: "Une classe est hors établissement ou hors année active." }, { status: 403 });
  }
  const { data: allAssignments, error: assignmentError } = await service
    .from("educator_class_assignments")
    .select("class_id,level")
    .eq("institution_id", institutionId)
    .eq("profile_id", id);
  if (assignmentError) return NextResponse.json({ error: "Lecture des affectations impossible." }, { status: 500 });

  const currentLevels = new Set(
    classes.map((row) => canonicalEducatorLevel(String(row.level || ""), "general_secondary")),
  );
  const hasWholeLevel = (allAssignments || []).some(
    (row) => !row.class_id &&
      currentLevels.has(canonicalEducatorLevel(String(row.level || ""), "general_secondary")),
  );
  if (hasWholeLevel) {
    // A whole-level row has no academic_year; deleting it could change historical permissions.
    return NextResponse.json({
      error: "Cet éducateur suit actuellement un niveau entier. Ses affectations historiques doivent être vérifiées avant une modification par classes.",
    }, { status: 409 });
  }
  const existing = (allAssignments || [])
    .filter((row) => row.class_id && classById.has(String(row.class_id)))
    .map((row) => String(row.class_id));
  const { added, removed } = editableEducatorClassDiff(existing, requested);
  if (!added.length && !removed.length) {
    return NextResponse.json({ ok: true, unchanged: true, assigned_class_ids: existing });
  }

  if (added.length) {
    const rows = added.map((classId) => ({
      institution_id: institutionId,
      profile_id: id,
      class_id: classId,
      level: classById.get(classId) || "",
    }));
    const { error: addError } = await service.from("educator_class_assignments").insert(rows);
    if (addError) return NextResponse.json({ error: "Ajout des affectations impossible ; aucune suppression effectuée." }, { status: 500 });
  }
  if (removed.length) {
    const { error: removeError } = await service
      .from("educator_class_assignments")
      .delete()
      .eq("institution_id", institutionId)
      .eq("profile_id", id)
      .in("class_id", removed);
    if (removeError) {
      if (added.length) {
        await service
          .from("educator_class_assignments")
          .delete()
          .eq("institution_id", institutionId)
          .eq("profile_id", id)
          .in("class_id", added);
      }
      return NextResponse.json({
        error: "Retrait des anciennes affectations refusé. Rechargez la page avant de recommencer.",
      }, { status: 500 });
    }
  }

  console.info("[staff] educator assignments updated", {
    actorId, institutionId, profileId: id, added: added.length, removed: removed.length,
  });
  return NextResponse.json({
    ok: true,
    added: added.length,
    removed: removed.length,
    assigned_class_ids: requested,
  }, { headers: { "Cache-Control": "no-store" } });
}
