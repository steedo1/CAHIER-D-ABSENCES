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

export function useEducationTeachingContext() {
  const [organization, setOrganization] = useState<EducationOrganizationSettings>(
    getDefaultEducationOrganization({ hasExistingClasses: true }),
  );
  const [levels, setLevels] = useState<EducationLevelContext[]>([]);
  const [items, setItems] = useState<EducationSubjectContext[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<
    EducationAvailableSubject[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [organizationResponse, subjectsResponse] = await Promise.all([
        fetch("/api/admin/institution/education-organization", {
          cache: "no-store",
        }),
        fetch("/api/admin/institution/subject-coeffs", {
          cache: "no-store",
        }),
      ]);

      const organizationJson = await organizationResponse
        .json()
        .catch(() => ({}));
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

      setOrganization(
        organizationJson.organization ||
          getDefaultEducationOrganization({ hasExistingClasses: true }),
      );
      setLevels(Array.isArray(subjectsJson.levels) ? subjectsJson.levels : []);
      setItems(Array.isArray(subjectsJson.items) ? subjectsJson.items : []);
      setAvailableSubjects(
        Array.isArray(subjectsJson.available_subjects)
          ? subjectsJson.available_subjects
          : [],
      );
    } catch (caught: any) {
      setError(caught?.message || "Chargement du contexte pédagogique impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  function formationsFor(type: EducationType): ConfiguredFormation[] {
    if (type === "general_secondary") return [];
    return formations.filter((formation) => formation.educationType === type);
  }

  function levelsFor(
    type: EducationType,
    formationCode?: string | null,
  ): EducationLevelContext[] {
    return uniqueBy(
      levels
        .filter((level) => level.education_type === type)
        .filter((level) =>
          type === "general_secondary"
            ? true
            : String(level.formation_code || "") === String(formationCode || ""),
        )
        .sort((a, b) =>
          a.level_label.localeCompare(b.level_label, "fr", {
            numeric: true,
            sensitivity: "base",
          }),
        ),
      (level) => `${level.formation_code || ""}__${level.level}`,
    );
  }

  function subjectsFor(
    type: EducationType,
    formationCode?: string | null,
    levelCode?: string | null,
  ): EducationAvailableSubject[] {
    if (type === "general_secondary") {
      return uniqueBy(
        availableSubjects
          .slice()
          .sort((a, b) => a.subject_name.localeCompare(b.subject_name, "fr")),
        (subject) => subject.subject_id,
      );
    }

    const rows = items
      .filter((item) => item.education_type === type)
      .filter(
        (item) =>
          String(item.formation_code || "") === String(formationCode || ""),
      )
      .filter((item) => !levelCode || item.level === levelCode)
      .map((item) => ({
        subject_id: item.subject_id,
        subject_name: item.subject_name,
      }));

    return uniqueBy(
      rows.sort((a, b) => a.subject_name.localeCompare(b.subject_name, "fr")),
      (subject) => subject.subject_id,
    );
  }

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
