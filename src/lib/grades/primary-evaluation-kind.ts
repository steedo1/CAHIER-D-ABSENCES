/**
 * Compatibility adapter for PRIMARY Franco-Arabic compositions.
 *
 * The existing Postgres eval_kind enum has no "composition" member. Keep
 * the existing teacher evaluation table and use its existing `title` field
 * as a distinct, exact marker: an old "interro_ecrite" can NEVER turn into
 * an official composition by accident.
 *
 * No schema migration, no changes to secondary evaluation behaviour.
 */
export const PRIMARY_COMPOSITION_TITLE = "Composition";
export type PrimaryEvaluationKind = "devoir" | "composition";
export type StoredEvaluationKind = "devoir" | "interro_ecrite" | "interro_orale";

export function isPrimaryComposition(row: {
  eval_kind?: string | null;
  title?: string | null;
}): boolean {
  return row.eval_kind === "interro_ecrite" &&
    row.title === PRIMARY_COMPOSITION_TITLE;
}

export function encodePrimaryEvaluation(kind: PrimaryEvaluationKind): {
  eval_kind: StoredEvaluationKind;
  title: string;
} {
  return kind === "composition"
    ? { eval_kind: "interro_ecrite", title: PRIMARY_COMPOSITION_TITLE }
    : { eval_kind: "devoir", title: "Devoir" };
}

export function displayPrimaryEvaluationKind(row: {
  eval_kind?: string | null;
  title?: string | null;
}): PrimaryEvaluationKind | null {
  if (isPrimaryComposition(row)) return "composition";
  if (row.eval_kind === "devoir") return "devoir";
  // Older interrogations stay classified as older evaluations, not compositions.
  return null;
}

/**
 * A primary class may offer BOTH French and Arabic. Its single class-level
 * track therefore cannot identify the teacher's assigned subject.
 * Resolve only explicit, allowed subject mappings; never guess from names.
 */
export function resolvePrimaryTeachingTrack(input: {
  offeredTracks: readonly ("french" | "arabic")[];
  subjectTracks: readonly ("french" | "arabic")[] | undefined;
  classTracks: readonly ("french" | "arabic")[];
}): "french" | "arabic" | null {
  const offered = new Set(input.offeredTracks);
  const permitted = input.classTracks.filter(track => offered.has(track));
  const mapped = input.subjectTracks?.filter(track => permitted.includes(track));
  if (mapped?.length) return mapped.length === 1 ? mapped[0] : null;
  // When an explicit subject mapping exists but does not match the class,
  // never fall back to a different teaching track.
  if (input.subjectTracks?.length) return null;
  return permitted.length === 1 ? permitted[0] : null;
}
