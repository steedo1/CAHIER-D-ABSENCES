"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EDUCATION_TYPE_OPTIONS,
  getConfiguredFormations,
  getDefaultEducationOrganization,
  type ConfiguredFormation,
  type EducationOrganizationSettings,
  type EducationType,
} from "@/lib/education-organization";

export type EducationLevelContext = {
  education_type: EducationType;
  education_label: string;
  formation_code: string | null;
  formation_label: string | null;
  level: string;
  level_label: string;
};

export type EducationSubjectContext = EducationLevelContext & {
  subject_id: string;
  subject_name: string;
};

export type EducationAvailableSubject = {
  subject_id: string;
  subject_name: string;
};

type EducationTeachingSnapshot = {
  organization: EducationOrganizationSettings;
  levels: EducationLevelContext[];
  items: EducationSubjectContext[];
  availableSubjects: EducationAvailableSubject[];
};

const SHARED_CONTEXT_TTL_MS = 15_000;
let sharedSnapshot: EducationTeachingSnapshot | null = null;
let sharedSnapshotExpiresAt = 0;
let sharedRequest: Promise<EducationTeachingSnapshot> | null = null;

function uniqueBy<T>(rows: T[], keyOf: (row: T) => string) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function educationTypeLabel(type: EducationType) {
  return EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type;
}

async function fetchTeachingSnapshot(
  forceRefresh = false,
): Promise<EducationTeachingSnapshot> {
  const now = Date.now();

  if (
    !forceRefresh &&
    sharedSnapshot &&
    sharedSnapshotExpiresAt > now
  ) {
    return sharedSnapshot;
  }

  if (!forceRefresh && sharedRequest) {
    return sharedRequest;
  }

  const request = (async () => {
    const [organizationResponse, subjectsResponse] = await Promise.all([
      fetch("/api/admin/institution/education-organization", {
        cache: "no-store",
      }),
      fetch("/api/admin/institution/subject-coeffs", {
        cache: "no-store",
      }),
    ]);

    const organizationJson = await organizationResponse.json().catch(() => ({}));
    const subjectsJson = await subjectsResponse.json().catch(() => ({}));

    if (!organizationResponse.ok || !organizationJson?.ok) {
      throw new Error(
        organizationJson?.error || "Organisation pédagogique indisponible.",
      );
    }
    if (!subjectsResponse.ok || !subjectsJson?.ok) {
      throw new Error(
        subjectsJson?.error || "Référentiel des disciplines indisponible.",
      );
    }

    const snapshot: EducationTeachingSnapshot = {
      organization:
        organizationJson.organization ||
        getDefaultEducationOrganization({ hasExistingClasses: true }),
      levels: Array.isArray(subjectsJson.levels) ? subjectsJson.levels : [],
      items: Array.isArray(subjectsJson.items) ? subjectsJson.items : [],
      availableSubjects: Array.isArray(subjectsJson.available_subjects)
        ? subjectsJson.available_subjects
        : [],
    };

    sharedSnapshot = snapshot;
    sharedSnapshotExpiresAt = Date.now() + SHARED_CONTEXT_TTL_MS;
    return snapshot;
  })();

  if (!forceRefresh) {
    sharedRequest = request;
  }

  try {
    return await request;
  } finally {
    if (sharedRequest === request) {
      sharedRequest = null;
    }
  }
}

export function useEducationTeachingContext() {
  const cached =
    sharedSnapshot && sharedSnapshotExpiresAt > Date.now()
      ? sharedSnapshot
      : null;

  const [organization, setOrganization] = useState<EducationOrganizationSettings>(
    cached?.organization ||
      getDefaultEducationOrganization({ hasExistingClasses: true }),
  );
  const [levels, setLevels] = useState<EducationLevelContext[]>(
    cached?.levels || [],
  );
  const [items, setItems] = useState<EducationSubjectContext[]>(
    cached?.items || [],
  );
  const [availableSubjects, setAvailableSubjects] = useState<
    EducationAvailableSubject[]
  >(cached?.availableSubjects || []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((snapshot: EducationTeachingSnapshot) => {
    setOrganization(snapshot.organization);
    setLevels(snapshot.levels);
    setItems(snapshot.items);
    setAvailableSubjects(snapshot.availableSubjects);
  }, []);

  const load = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await fetchTeachingSnapshot(forceRefresh);
        applySnapshot(snapshot);
      } catch (caught: any) {
        setError(
          caught?.message || "Chargement du contexte pédagogique impossible.",
        );
      } finally {
        setLoading(false);
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(async () => {
    await load(true);
  }, [load]);

  const educationTypes = useMemo<EducationType[]>(() => {
    const configured = Array.isArray(organization.educationTypes)
      ? organization.educationTypes
      : [];
    return configured.length ? configured : ["general_secondary"];
  }, [organization.educationTypes]);

  const formations = useMemo(
    () => getConfiguredFormations(organization),
    [organization],
  );

  const formationsFor = useCallback(
    (type: EducationType): ConfiguredFormation[] => {
      if (type === "general_secondary") return [];
      return formations.filter((formation) => formation.educationType === type);
    },
    [formations],
  );

  const levelsFor = useCallback(
    (
      type: EducationType,
      formationCode?: string | null,
    ): EducationLevelContext[] => {
      return uniqueBy(
        levels
          .filter((level) => level.education_type === type)
          .filter((level) =>
            type === "general_secondary"
              ? true
              : String(level.formation_code || "") ===
                String(formationCode || ""),
          )
          .sort((a, b) =>
            a.level_label.localeCompare(b.level_label, "fr", {
              numeric: true,
              sensitivity: "base",
            }),
          ),
        (level) => `${level.formation_code || ""}__${level.level}`,
      );
    },
    [levels],
  );

  const subjectsFor = useCallback(
    (
      type: EducationType,
      formationCode?: string | null,
      levelCode?: string | null,
    ): EducationAvailableSubject[] => {
      if (type === "general_secondary") {
        return uniqueBy(
          availableSubjects
            .slice()
            .sort((a, b) =>
              a.subject_name.localeCompare(b.subject_name, "fr"),
            ),
          (subject) => subject.subject_id,
        );
      }

      const rows = items
        .filter((item) => item.education_type === type)
        .filter(
          (item) =>
            String(item.formation_code || "") ===
            String(formationCode || ""),
        )
        .filter((item) => !levelCode || item.level === levelCode)
        .map((item) => ({
          subject_id: item.subject_id,
          subject_name: item.subject_name,
        }));

      return uniqueBy(
        rows.sort((a, b) =>
          a.subject_name.localeCompare(b.subject_name, "fr"),
        ),
        (subject) => subject.subject_id,
      );
    },
    [availableSubjects, items],
  );

  return {
    organization,
    educationTypes,
    formations,
    levels,
    items,
    availableSubjects,
    loading,
    error,
    reload,
    formationsFor,
    levelsFor,
    subjectsFor,
  };
}
