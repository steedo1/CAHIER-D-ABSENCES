import type { SupabaseClient } from "@supabase/supabase-js";
import { studentFullIdentityKey } from "./student-class-membership";

type IdentityCandidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  matricule: string | null;
};

export const STUDENT_IDENTITY_CONFLICT_MESSAGE =
  "Une fiche avec ce nom et ces prénoms existe déjà. Utilisez « Transférer » pour sélectionner l’élève existant. S’il s’agit d’un homonyme, renseignez son matricule distinct.";

// Ne pas filtrer par ILIKE ou full_name_key en base : ces filtres perdent les
// variantes avec accents, apostrophes ou traits d'union avant la comparaison.
export async function findStudentIdentityCandidates(
  srv: SupabaseClient,
  institutionId: string,
  fullNames: string[],
): Promise<IdentityCandidate[]> {
  const keys = new Set(fullNames.map(studentFullIdentityKey).filter(Boolean));
  if (!keys.size) return [];
  const matches: IdentityCandidate[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await srv.from("students")
      .select("id,first_name,last_name,full_name,matricule")
      .eq("institution_id", institutionId)
      .or("lifecycle_status.is.null,lifecycle_status.neq.duplicate_merged")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as IdentityCandidate[];
    matches.push(...rows.filter((row) => keys.has(studentFullIdentityKey(
      [row.last_name, row.first_name].filter(Boolean).join(" ") || row.full_name,
    ))));
    if (rows.length < pageSize) return matches;
  }
}

export async function hasStudentIdentityConflict(
  srv: SupabaseClient,
  institutionId: string,
  lastName: string,
  firstName: string,
  matricule: string | null,
): Promise<boolean> {
  const candidates = await findStudentIdentityCandidates(srv, institutionId, [`${lastName} ${firstName}`]);
  const incoming = String(matricule || "").trim().toUpperCase();
  return candidates.some((row) => {
    const stored = String(row.matricule || "").trim().toUpperCase();
    return !incoming || !stored || stored === incoming;
  });
}
