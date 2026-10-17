export type ActiveSchoolSubject = { id: string; subject_id: string };

/** Both historical assignment representations resolve through the same active,
 * institution-scoped catalog. An ambiguous alias is never silently accepted. */
export function createSchoolSubjectResolver(subjects: readonly ActiveSchoolSubject[]) {
  const aliases = new Map<string, Set<string>>();
  for (const row of subjects) for (const alias of [row.id, row.subject_id]) {
    const ids = aliases.get(alias) || new Set<string>();
    ids.add(row.subject_id); aliases.set(alias, ids);
  }
  return (id: string | null | undefined): string | null => {
    const ids = id ? aliases.get(id) : undefined;
    return ids?.size === 1 ? [...ids][0] : null;
  };
}
