import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { primaryEventsForClass, parsePrimaryEventTitle } from "@/lib/grades/primary-evaluation-events";
import { primarySubjectTeachingTrack } from "@/lib/grades/primary-subject-scale";
import { buildPedagogicalRanks } from "@/lib/pedagogical-ranking";
import { specializedGradeStudentsAllowed } from "@/lib/server/school-linked-class-roster";

/** Subject results for ONE dated event. The historical /20 UI contract is kept;
 * annual and full bulletin calculations remain in the primary bulletin engine. */
export async function primarySubjectEventAverages(input: {
  service: SupabaseClient; actorId: string; settings: unknown;
  classroom: { id: string; level?: string | null; institution_id?: string | null; academic_year?: string | null };
  params: URLSearchParams;
}) {
  const { service, actorId, settings, classroom, params } = input;
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  const fail = (error: string, status = 400) => json({ ok: false, error }, status);
  const institutionId = classroom.institution_id, year = classroom.academic_year || "";
  if (!institutionId || !year || (params.has("academic_year") && params.get("academic_year") !== year)) return fail("Contexte de classe invalide.");
  const rawSubject = params.get("subject_id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSubject)) return fail("Matière invalide.");
  const [profile, subject, roles] = await Promise.all([
    service.from("profiles").select("institution_id").eq("id", actorId).maybeSingle(),
    service.from("institution_subjects").select("id,subject_id").eq("institution_id", institutionId).eq("is_active", true)
      .or(`id.eq.${rawSubject},subject_id.eq.${rawSubject}`).limit(2),
    service.from("user_roles").select("role").eq("profile_id", actorId).eq("institution_id", institutionId),
  ]);
  if (profile.error || profile.data?.institution_id !== institutionId) return fail("FORBIDDEN", 403);
  if (subject.error || !subject.data?.length || roles.error) return fail("Matière indisponible.", 409);
  const subjectId = subject.data[0].subject_id;
  const privileged = roles.data?.some(row => ["admin", "super_admin", "educator"].includes(row.role));
  if (!privileged) {
    const assignment = await service.from("class_teachers").select("id").eq("institution_id", institutionId)
      .eq("class_id", classroom.id).eq("teacher_id", actorId).in("subject_id", [rawSubject, subjectId, subject.data[0].id])
      .is("end_date", null).limit(1);
    if (assignment.error || !assignment.data?.length) return fail("FORBIDDEN", 403);
  }
  const track = primarySubjectTeachingTrack(settings, year, classroom.id, subjectId, params.get("teaching_track"));
  if (!track) return fail("Enseignement non configuré pour cette matière.", 409);
  const event = primaryEventsForClass(settings, year, classroom.level || "", track)
    .find(row => row.code === params.get("primary_event_code"));
  if (!event) return fail("Choisissez une évaluation programmée pour consulter ses résultats.");
  const { data: evaluations, error } = await service.from("grade_evaluations")
    .select("id,title,publication_version,publication_status,is_published,scale").eq("class_id", classroom.id)
    .eq("subject_id", subjectId).eq("eval_date", event.date)
    .like("title", "MCPE:%").limit(2001);
  if (error || !evaluations) return fail("Résultats indisponibles.", 503);
  const selected = evaluations.filter(row => {
    const marker = parsePrimaryEventTitle(row.title);
    return marker?.code === event.code && marker.kind === event.kind && primarySubjectTeachingTrack(settings, year, classroom.id, subjectId,
    marker.track) === track;
  });
  if (selected.length > 1) return fail("Cette évaluation contient plusieurs colonnes pour la même matière.", 409);
  const evaluation = selected[0];
  let items: Array<{ student_id: string; average: number; average_raw: number; average_rounded: number; bonus: number; rank: number | null; count_evals: number; total_evals: number; has_average: boolean; is_complete: boolean; status: string }> = [];
  if (evaluation?.is_published && evaluation.publication_status === "published") {
    const scores = await service.from("grade_published_scores").select("student_id,score,scale,publication_version")
      .eq("institution_id", institutionId).eq("class_id", classroom.id).eq("evaluation_id", evaluation.id)
      .eq("is_current", true).limit(1501);
    if (scores.error || !scores.data || scores.data.length >= 1501) return fail("Résultats indisponibles.", 503);
    const rows = scores.data.filter(row => row.score !== null && Number.isFinite(row.score) && row.score >= 0 &&
      row.scale > 0 && row.score <= row.scale && row.publication_version === evaluation.publication_version);
    if (new Set(rows.map(row => row.student_id)).size !== rows.length) return fail("Publication incohérente.", 409);
    if (!await specializedGradeStudentsAllowed(service, actorId, classroom.id, rows.map(row => row.student_id), undefined, track))
      return fail("Résultats hors du groupe autorisé.", 409);
    const ranks = buildPedagogicalRanks(rows.map(row => ({ studentId: row.student_id, average: row.score / row.scale * 20, complete: true })));
    items = rows.map(row => {
      const average = Math.round(row.score / row.scale * 2000) / 100;
      return { student_id: row.student_id, average, average_raw: average, average_rounded: average,
        bonus: 0, rank: ranks.get(row.student_id) ?? null, count_evals: 1, total_evals: 1,
        has_average: true, is_complete: true, status: "complete" };
    });
  }
  return json({ ok: true, params: { class_id: classroom.id, subject_id: subjectId, academic_year: year,
    primary_event_code: event.code, teaching_track: track, published_only: true }, items,
    meta: { evaluations: evaluation ? 1 : 0, official_scores_used: true, grades_source: "grade_published_scores", event_label: event.label } });
}
