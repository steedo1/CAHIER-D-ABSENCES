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

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-sm ${
        props.className || ""
      }`}
    />
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
    [context.formations, value.educationType],
  );
  const levels = useMemo(
    () => context.levelsFor(value.educationType, value.formationCode || null),
    [context.levels, value.educationType, value.formationCode],
  );
  const subjects = useMemo(
    () =>
      context.subjectsFor(
        value.educationType,
        value.formationCode || null,
        value.levelCode || null,
      ),
    [
      context.items,
      context.availableSubjects,
      value.educationType,
      value.formationCode,
      value.levelCode,
    ],
  );

  useEffect(() => {
    if (
      context.educationTypes.length &&
      !context.educationTypes.includes(value.educationType)
    ) {
      onChange({
        educationType: context.educationTypes[0],
        formationCode: "",
        levelCode: "",
      });
    }
  }, [context.educationTypes, value.educationType, onChange]);

  useEffect(() => {
    if (value.educationType === "general_secondary") {
      if (value.formationCode || value.levelCode) {
        onChange({
          educationType: value.educationType,
          formationCode: "",
          levelCode: "",
        });
      }
      return;
    }

    if (!formations.some((formation) => formation.key === value.formationCode)) {
      onChange({
        educationType: value.educationType,
        formationCode: formations[0]?.key || "",
        levelCode: "",
      });
    }
  }, [formations, value, onChange]);

  useEffect(() => {
    if (value.educationType === "general_secondary") return;
    if (!levels.some((level) => level.level === value.levelCode)) {
      onChange({
        educationType: value.educationType,
        formationCode: value.formationCode,
        levelCode: levels[0]?.level || "",
      });
    }
  }, [levels, value, onChange]);

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
              disabled={disabled}
              onClick={() =>
                onChange({
                  educationType: type,
                  formationCode: "",
                  levelCode: "",
                })
              }
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                value.educationType === type
                  ? "border-sky-500 bg-white text-sky-800 shadow-sm"
                  : "border-slate-200 bg-white/70 text-slate-700"
              } ${disabled ? "opacity-60" : ""}`}
            >
              {option?.shortLabel ?? type}
            </button>
          );
        })}
      </div>

      {value.educationType === "general_secondary" ? (
        generalMessage ? (
          <div className="mt-3 text-xs text-slate-600">{generalMessage}</div>
        ) : null
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Formation / filière</div>
            <Select
              value={value.formationCode}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  educationType: value.educationType,
                  formationCode: event.target.value,
                  levelCode: "",
                })
              }
            >
              <option value="">— Choisir —</option>
              {formations.map((formation) => (
                <option key={formation.key} value={formation.key}>
                  {formation.diplomaLabel} — {formation.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">
              Année de formation / niveau
            </div>
            <Select
              value={value.levelCode}
              disabled={disabled || !value.formationCode}
              onChange={(event) =>
                onChange({
                  educationType: value.educationType,
                  formationCode: value.formationCode,
                  levelCode: event.target.value,
                })
              }
            >
              <option value="">— Choisir —</option>
              {levels.map((level) => (
                <option key={level.level} value={level.level}>
                  {level.level_label}
                </option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-2 text-[11px] text-slate-600">
            Les disciplines proposées ci-dessous sont celles configurées pour cette
            formation et cette année. Une nouvelle discipline reste autorisée et sera
            ajoutée à ce contexte après confirmation.
          </div>
        </div>
      )}

      {context.error ? (
        <div className="mt-2 text-xs text-rose-700">{context.error}</div>
      ) : null}
    </div>
  );
}
