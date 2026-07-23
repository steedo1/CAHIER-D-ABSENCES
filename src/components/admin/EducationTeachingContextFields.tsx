"use client";

import type React from "react";
import { useEffect, useMemo } from "react";
import {
  EDUCATION_TYPE_OPTIONS,
  type EducationType,
} from "@/lib/education-organization";
import {
  useEducationTeachingContext,
  type EducationAvailableSubject,
} from "@/hooks/useEducationTeachingContext";

export type EducationTeachingContextValue = {
  educationType: EducationType;
  formationCode: string;
  levelCode: string;
};

type Props = {
  value: EducationTeachingContextValue;
  onChange: (value: EducationTeachingContextValue) => void;
  onSubjectsChange?: (subjects: EducationAvailableSubject[]) => void;
  className?: string;
  disabled?: boolean;
  generalMessage?: string;
};

type ChoiceOption = {
  value: string;
  label: string;
};

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`relative z-10 min-h-12 w-full cursor-pointer touch-manipulation rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100 ${
        props.className || ""
      }`}
    />
  );
}

function ChoiceField({
  label,
  value,
  options,
  disabled,
  emptyMessage,
  onChange,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  disabled: boolean;
  emptyMessage: string;
  onChange: (value: string) => void;
}) {
  if (!options.length) {
    return (
      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600">{label}</div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          {emptyMessage}
        </div>
      </div>
    );
  }

  if (options.length <= 8) {
    return (
      <fieldset disabled={disabled}>
        <legend className="mb-1.5 text-xs font-medium text-slate-600">
          {label}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={`min-h-11 touch-manipulation rounded-xl border px-3 py-2 text-left text-sm font-medium transition active:scale-[0.99] ${
                  selected
                    ? "border-sky-500 bg-sky-100 text-sky-900 shadow-sm ring-2 ring-sky-100"
                    : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-600">{label}</div>
      <Select
        key={`${label}-${options.map((option) => option.value).join("|")}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">— Choisir —</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export default function EducationTeachingContextFields({
  value,
  onChange,
  onSubjectsChange,
  className = "",
  disabled = false,
  generalMessage,
}: Props) {
  const context = useEducationTeachingContext();

  const formations = useMemo(
    () => context.formationsFor(value.educationType),
    [context.formationsFor, value.educationType],
  );

  const levels = useMemo(
    () =>
      context.levelsFor(
        value.educationType,
        value.formationCode || null,
      ),
    [
      context.levelsFor,
      value.educationType,
      value.formationCode,
    ],
  );

  const subjects = useMemo(
    () =>
      context.subjectsFor(
        value.educationType,
        value.formationCode || null,
        value.levelCode || null,
      ),
    [
      context.subjectsFor,
      value.educationType,
      value.formationCode,
      value.levelCode,
    ],
  );

  const formationOptions = useMemo<ChoiceOption[]>(
    () =>
      formations.map((formation) => ({
        value: formation.key,
        label: `${formation.diplomaLabel} — ${formation.name}`,
      })),
    [formations],
  );

  const levelOptions = useMemo<ChoiceOption[]>(
    () =>
      levels.map((level) => ({
        value: level.level,
        label: level.level_label,
      })),
    [levels],
  );

  useEffect(() => {
    if (
      context.educationTypes.length &&
      !context.educationTypes.includes(value.educationType)
    ) {
      const nextType = context.educationTypes[0];
      onChange({
        educationType: nextType,
        formationCode: "",
        levelCode: "",
      });
    }
  }, [
    context.educationTypes,
    value.educationType,
    onChange,
  ]);

  useEffect(() => {
    if (context.loading || value.educationType === "general_secondary") {
      if (
        value.educationType === "general_secondary" &&
        (value.formationCode || value.levelCode)
      ) {
        onChange({
          educationType: value.educationType,
          formationCode: "",
          levelCode: "",
        });
      }
      return;
    }

    const formationIsValid = formations.some(
      (formation) => formation.key === value.formationCode,
    );

    if (!formationIsValid && formations.length > 0) {
      const firstFormation = formations[0];
      const firstLevels = context.levelsFor(
        value.educationType,
        firstFormation.key,
      );
      onChange({
        educationType: value.educationType,
        formationCode: firstFormation.key,
        levelCode: firstLevels[0]?.level || "",
      });
    }
  }, [
    context.loading,
    context.levelsFor,
    formations,
    value.educationType,
    value.formationCode,
    value.levelCode,
    onChange,
  ]);

  useEffect(() => {
    if (
      context.loading ||
      value.educationType === "general_secondary" ||
      !value.formationCode
    ) {
      return;
    }

    const levelIsValid = levels.some(
      (level) => level.level === value.levelCode,
    );

    if (!levelIsValid && levels.length > 0) {
      onChange({
        educationType: value.educationType,
        formationCode: value.formationCode,
        levelCode: levels[0].level,
      });
    }
  }, [
    context.loading,
    levels,
    value.educationType,
    value.formationCode,
    value.levelCode,
    onChange,
  ]);

  useEffect(() => {
    onSubjectsChange?.(subjects);
  }, [subjects, onSubjectsChange]);

  if (
    !context.loading &&
    context.educationTypes.length === 1 &&
    context.educationTypes[0] === "general_secondary"
  ) {
    return null;
  }

  const chooseEducationType = (type: EducationType) => {
    if (type === "general_secondary") {
      onChange({
        educationType: type,
        formationCode: "",
        levelCode: "",
      });
      return;
    }

    const nextFormations = context.formationsFor(type);
    const nextFormation = nextFormations[0]?.key || "";
    const nextLevels = nextFormation
      ? context.levelsFor(type, nextFormation)
      : [];

    onChange({
      educationType: type,
      formationCode: nextFormation,
      levelCode: nextLevels[0]?.level || "",
    });
  };

  const chooseFormation = (formationCode: string) => {
    const nextLevels = context.levelsFor(
      value.educationType,
      formationCode || null,
    );

    onChange({
      educationType: value.educationType,
      formationCode,
      levelCode: nextLevels[0]?.level || "",
    });
  };

  return (
    <div
      className={`rounded-2xl border border-sky-200 bg-sky-50/60 p-4 ${className}`}
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-800">
        Enseignement concerné
      </div>

      <div className="flex flex-wrap gap-2">
        {context.educationTypes.map((type) => {
          const option = EDUCATION_TYPE_OPTIONS.find((item) => item.id === type);
          return (
            <button
              key={type}
              type="button"
              disabled={disabled || context.loading}
              onClick={() => chooseEducationType(type)}
              className={`min-h-11 touch-manipulation rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                value.educationType === type
                  ? "border-sky-500 bg-white text-sky-800 shadow-sm ring-2 ring-sky-100"
                  : "border-slate-200 bg-white/80 text-slate-700 hover:border-sky-300 hover:bg-white"
              } ${disabled || context.loading ? "opacity-60" : ""}`}
            >
              {option?.shortLabel ?? type}
            </button>
          );
        })}
      </div>

      {context.loading ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-white px-3 py-3 text-xs text-sky-800">
          Chargement des formations et des niveaux…
        </div>
      ) : value.educationType === "general_secondary" ? (
        generalMessage ? (
          <div className="mt-3 text-xs text-slate-600">{generalMessage}</div>
        ) : null
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ChoiceField
            label="Formation / filière"
            value={value.formationCode}
            options={formationOptions}
            disabled={disabled}
            emptyMessage="Aucune formation n’est encore configurée pour cet enseignement. Ajoute-la d’abord dans Organisation pédagogique."
            onChange={chooseFormation}
          />

          <ChoiceField
            label="Année de formation / niveau"
            value={value.levelCode}
            options={levelOptions}
            disabled={disabled || !value.formationCode}
            emptyMessage={
              value.formationCode
                ? "Aucune année de formation n’est configurée pour cette filière."
                : "Choisis d’abord une formation."
            }
            onChange={(levelCode) =>
              onChange({
                educationType: value.educationType,
                formationCode: value.formationCode,
                levelCode,
              })
            }
          />

          <div className="md:col-span-2 rounded-xl border border-sky-100 bg-white/70 px-3 py-2 text-[11px] text-slate-600">
            Les disciplines proposées ci-dessous sont celles configurées pour cette
            formation et cette année. Une nouvelle discipline reste autorisée et sera
            ajoutée à ce contexte après confirmation.
          </div>
        </div>
      )}

      {context.error ? (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {context.error}
        </div>
      ) : null}
    </div>
  );
}
