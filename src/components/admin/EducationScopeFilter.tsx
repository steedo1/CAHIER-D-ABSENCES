"use client";

import type React from "react";
import { useEffect, useMemo } from "react";
import { useEducationTeachingContext } from "@/hooks/useEducationTeachingContext";
import {
  EDUCATION_TYPE_OPTIONS,
  type EducationType,
} from "@/lib/education-organization";
import {
  ALL_EDUCATION_TYPES,
  classMatchesEducationScope,
  getClassDisplayLabel,
  getClassFormationCode,
  getClassLevelCode,
  normalizeClassEducationType,
  type EducationScopedClass,
  type EducationScopeType,
  type EducationScopeValue,
} from "@/lib/education-scope";

type Props = {
  value: EducationScopeValue;
  onChange: (value: EducationScopeValue) => void;
  classes?: EducationScopedClass[];
  allowAllEducationTypes?: boolean;
  showLevel?: boolean;
  showClass?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  classLabel?: string;
};

type Choice = {
  value: string;
  label: string;
};

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100 ${
        props.className || ""
      }`}
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-600">{label}</div>
      {children}
    </div>
  );
}

function typeLabel(type: EducationScopeType) {
  if (type === ALL_EDUCATION_TYPES) return "Tous les enseignements";
  return (
    EDUCATION_TYPE_OPTIONS.find((option) => option.id === type)?.label || type
  );
}

function uniqueChoices(rows: Choice[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.value || seen.has(row.value)) return false;
    seen.add(row.value);
    return true;
  });
}

export default function EducationScopeFilter({
  value,
  onChange,
  classes = [],
  allowAllEducationTypes = false,
  showLevel = true,
  showClass = true,
  disabled = false,
  className = "",
  title = "Périmètre pédagogique",
  classLabel = "Classe",
}: Props) {
  const context = useEducationTeachingContext();

  const enabledEducationTypes = useMemo<EducationType[]>(() => {
    return context.educationTypes.length
      ? context.educationTypes
      : ["general_secondary"];
  }, [context.educationTypes]);

  const typeChoices = useMemo<EducationScopeType[]>(() => {
    return allowAllEducationTypes
      ? [ALL_EDUCATION_TYPES, ...enabledEducationTypes]
      : enabledEducationTypes;
  }, [allowAllEducationTypes, enabledEducationTypes]);

  const selectedTypeIsValid = typeChoices.includes(value.educationType);

  useEffect(() => {
    if (context.loading || selectedTypeIsValid) return;

    onChange({
      educationType: typeChoices[0] || "general_secondary",
      formationCode: "",
      levelCode: "",
      classId: "",
    });
  }, [
    context.loading,
    onChange,
    selectedTypeIsValid,
    typeChoices,
  ]);

  const formations = useMemo(() => {
    if (
      value.educationType === ALL_EDUCATION_TYPES ||
      value.educationType === "general_secondary"
    ) {
      return [];
    }
    return context.formationsFor(value.educationType);
  }, [context.formationsFor, value.educationType]);

  const formationChoices = useMemo<Choice[]>(
    () =>
      formations.map((formation) => ({
        value: formation.key,
        label: `${formation.diplomaLabel} — ${formation.name}`,
      })),
    [formations],
  );

  const classesForTypeAndFormation = useMemo(() => {
    return classes.filter((row) => {
      if (
        value.educationType !== ALL_EDUCATION_TYPES &&
        normalizeClassEducationType(row) !== value.educationType
      ) {
        return false;
      }

      if (
        value.formationCode &&
        getClassFormationCode(row) !== value.formationCode
      ) {
        return false;
      }

      return true;
    });
  }, [classes, value.educationType, value.formationCode]);

  const levelChoices = useMemo<Choice[]>(() => {
    const configuredLabels = new Map<string, string>();

    if (
      value.educationType !== ALL_EDUCATION_TYPES &&
      value.educationType !== "general_secondary"
    ) {
      for (const level of context.levelsFor(
        value.educationType,
        value.formationCode || null,
      )) {
        configuredLabels.set(level.level, level.level_label);
      }
    }

    const fromClasses = classesForTypeAndFormation.map((row) => {
      const code = getClassLevelCode(row);
      return {
        value: code,
        label: configuredLabels.get(code) || code,
      };
    });

    const configuredOnly = Array.from(configuredLabels.entries()).map(
      ([code, label]) => ({ value: code, label }),
    );

    return uniqueChoices([...fromClasses, ...configuredOnly]).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [
    classesForTypeAndFormation,
    context.levelsFor,
    value.educationType,
    value.formationCode,
  ]);

  const classesForScope = useMemo(() => {
    const scopeWithoutClass: EducationScopeValue = {
      ...value,
      classId: "",
    };

    return classes
      .filter((row) => classMatchesEducationScope(row, scopeWithoutClass))
      .sort((a, b) =>
        getClassDisplayLabel(a).localeCompare(getClassDisplayLabel(b), "fr", {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [classes, value]);

  useEffect(() => {
    if (
      value.educationType === ALL_EDUCATION_TYPES ||
      value.educationType === "general_secondary"
    ) {
      if (value.formationCode) {
        onChange({
          ...value,
          formationCode: "",
          levelCode: "",
          classId: "",
        });
      }
      return;
    }

    if (
      value.formationCode &&
      !formationChoices.some((choice) => choice.value === value.formationCode)
    ) {
      onChange({
        ...value,
        formationCode: "",
        levelCode: "",
        classId: "",
      });
    }
  }, [formationChoices, onChange, value]);

  useEffect(() => {
    if (
      value.levelCode &&
      !levelChoices.some((choice) => choice.value === value.levelCode)
    ) {
      onChange({ ...value, levelCode: "", classId: "" });
    }
  }, [levelChoices, onChange, value]);

  useEffect(() => {
    if (
      value.classId &&
      !classesForScope.some((row) => row.id === value.classId)
    ) {
      onChange({ ...value, classId: "" });
    }
  }, [classesForScope, onChange, value]);

  const chooseType = (educationType: EducationScopeType) => {
    onChange({
      educationType,
      formationCode: "",
      levelCode: "",
      classId: "",
    });
  };

  const showTypeSelector = typeChoices.length > 1;
  const needsFormation =
    value.educationType !== ALL_EDUCATION_TYPES &&
    value.educationType !== "general_secondary";
  const canChooseLevel = !needsFormation || Boolean(value.formationCode);
  const canChooseClass =
    !showLevel || !levelChoices.length || Boolean(value.levelCode);

  return (
    <section
      className={`rounded-2xl border border-sky-200 bg-sky-50/60 p-4 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-800">
          {title}
        </div>
        {!showTypeSelector ? (
          <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-sky-800">
            {typeLabel(value.educationType)}
          </span>
        ) : null}
      </div>

      {showTypeSelector ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {typeChoices.map((type) => {
            const selected = value.educationType === type;
            return (
              <button
                key={type}
                type="button"
                disabled={disabled || context.loading}
                onClick={() => chooseType(type)}
                className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? "border-sky-500 bg-white text-sky-900 shadow-sm ring-2 ring-sky-100"
                    : "border-slate-200 bg-white/80 text-slate-700 hover:border-sky-300 hover:bg-white"
                } ${disabled || context.loading ? "opacity-60" : ""}`}
              >
                {typeLabel(type)}
              </button>
            );
          })}
        </div>
      ) : null}

      {context.loading ? (
        <div className="rounded-xl border border-sky-200 bg-white px-3 py-3 text-xs text-sky-800">
          Chargement du contexte pédagogique…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {needsFormation ? (
            <Field label="Formation / filière">
              <Select
                value={value.formationCode}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    formationCode: event.target.value,
                    levelCode: "",
                    classId: "",
                  })
                }
              >
                <option value="">— Choisir —</option>
                {formationChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {showLevel ? (
            <Field
              label={
                value.educationType === "general_secondary"
                  ? "Niveau"
                  : "Année de formation / niveau"
              }
            >
              <Select
                value={value.levelCode}
                disabled={disabled || !canChooseLevel}
                onChange={(event) =>
                  onChange({
                    ...value,
                    levelCode: event.target.value,
                    classId: "",
                  })
                }
              >
                <option value="">— Tous les niveaux —</option>
                {levelChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {showClass ? (
            <Field label={classLabel}>
              <Select
                value={value.classId}
                disabled={disabled || !canChooseClass}
                onChange={(event) =>
                  onChange({ ...value, classId: event.target.value })
                }
              >
                <option value="">— Choisir —</option>
                {classesForScope.map((row) => (
                  <option key={row.id} value={row.id}>
                    {getClassDisplayLabel(row)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      )}

      {!context.loading && needsFormation && !formationChoices.length ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Aucune formation n’est configurée pour cet enseignement. Ajoutez-la
          dans Organisation pédagogique.
        </div>
      ) : null}

      {context.error ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {context.error}
        </div>
      ) : null}
    </section>
  );
}
