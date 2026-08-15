import type { SupabaseClient } from "@supabase/supabase-js";

type RelaySnapshot = {
  entities?: Record<string, unknown>;
  [key: string]: unknown;
};

type StudentGradeRow = Record<string, unknown> & {
  id?: unknown;
  server_version?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function validVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function readRelayStudentGradeServerVersion(
  service: SupabaseClient,
  institutionId: string,
  entityId: string,
) {
  const { data, error } = await service
    .from("relay_entity_versions")
    .select("server_version")
    .eq("institution_id", institutionId)
    .eq("entity_type", "student_grade")
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) {
    throw new Error(`student_grade_version_lookup_failed:${error.message}`);
  }
  return validVersion((data as any)?.server_version);
}

/**
 * Le schéma métier student_grades ne porte pas de colonne server_version.
 * Le LOT 4 maintient donc la version logique dans relay_entity_versions et
 * l'injecte dans le snapshot académique avant son envoi au relais SQLite.
 * Cela permet aussi d'installer un client V4 avant l'activation du canary CAS.
 */
export async function attachRelayStudentGradeVersions(
  service: SupabaseClient,
  institutionId: string,
  snapshot: RelaySnapshot,
) {
  const entities = snapshot.entities && typeof snapshot.entities === "object"
    ? snapshot.entities
    : {};
  const grades = Array.isArray((entities as any).student_grades)
    ? ((entities as any).student_grades as StudentGradeRow[])
    : [];

  if (!grades.length) return snapshot;

  const gradeIds = Array.from(new Set(grades.map((row) => text(row.id)).filter(Boolean)));
  const versions = new Map<string, number>();

  for (let index = 0; index < gradeIds.length; index += 300) {
    const batch = gradeIds.slice(index, index + 300);
    const { data, error } = await service
      .from("relay_entity_versions")
      .select("entity_id,server_version")
      .eq("institution_id", institutionId)
      .eq("entity_type", "student_grade")
      .in("entity_id", batch);

    if (error) {
      throw new Error(`student_grade_version_lookup_failed:${error.message}`);
    }

    for (const row of data || []) {
      const entityId = text((row as any).entity_id);
      const version = validVersion((row as any).server_version);
      if (entityId && version !== null) versions.set(entityId, version);
    }
  }

  const versionedGrades = grades.map((row) => {
    const entityId = text(row.id);
    const version = versions.get(entityId);
    if (!entityId || version === undefined) {
      throw new Error(`student_grade_version_missing:${entityId || "unknown"}`);
    }
    return { ...row, server_version: version };
  });

  return {
    ...snapshot,
    entities: {
      ...entities,
      student_grades: versionedGrades,
    },
  };
}
