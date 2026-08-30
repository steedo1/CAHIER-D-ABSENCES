"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

type ScholarshipStatus = "boursier" | "non_boursier" | "unknown";

type StudentRow = {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  matricule: string | null;
  gender: string | null;
  birthdate: string | null;
  birth_place: string | null;
  nationality: string | null;
  is_repeater: boolean | null;
  lv2: string | null;
  is_affecte?: boolean | null;
  is_boarder?: boolean | null;
  official_track_code?: string | null;
  scholarship_status?: ScholarshipStatus;
};

type EditableStudent = StudentRow;

type RosterPayload = {
  students?: StudentRow[];
  can_edit?: boolean;
};

type ScholarshipPayload = {
  scholarships?: Record<string, ScholarshipStatus>;
  academic_year?: string | null;
};

const SERIES_OPTIONS = [
  ["", "—"],
  ["1ereA1", "1ère A1"],
  ["1ereA2", "1ère A2"],
  ["tleA1", "Tle A1"],
  ["tleA2", "Tle A2"],
  ["2ndeA", "2nde A"],
  ["2ndeC", "2nde C"],
  ["1ereC", "1ère C"],
  ["1ereD", "1ère D"],
  ["tleC", "Tle C"],
  ["tleD", "Tle D"],
] as const;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeScholarship(value: unknown): ScholarshipStatus {
  const raw = clean(value).toLowerCase();
  if (raw === "boursier") return "boursier";
  if (raw === "non_boursier") return "non_boursier";
  return "unknown";
}

function normalizeRow(
  row: StudentRow,
  scholarshipStatus: ScholarshipStatus = "unknown",
): EditableStudent {
  const explicitFirst = clean(row.first_name);
  const explicitLast = clean(row.last_name);
  let firstName = explicitFirst;
  let lastName = explicitLast;

  if (!firstName && !lastName) {
    const parts = clean(row.full_name).split(" ").filter(Boolean);
    lastName = parts.shift() || "";
    firstName = parts.join(" ");
  }

  return {
    ...row,
    first_name: firstName || null,
    last_name: lastName || null,
    birthdate: row.birthdate ? String(row.birthdate).slice(0, 10) : null,
    birth_place: row.birth_place ?? null,
    nationality: row.nationality ?? null,
    scholarship_status: normalizeScholarship(scholarshipStatus),
  };
}

function comparable(value: unknown) {
  if (typeof value === "boolean") return value;
  return clean(value) || null;
}

const ROSTER_FIELDS: Array<keyof EditableStudent> = [
  "first_name",
  "last_name",
  "matricule",
  "official_track_code",
  "is_affecte",
  "is_boarder",
  "birthdate",
  "birth_place",
  "gender",
  "is_repeater",
  "lv2",
  "nationality",
];

export default function ClassListCorrectionsPanel() {
  const pathname = usePathname();
  const match = pathname?.match(/^\/admin\/classes\/liste\/([^/?#]+)/);
  const classId = match?.[1] ? decodeURIComponent(match[1]) : "";
  const isClassListPage = Boolean(classId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, EditableStudent>>({});
  const [originalRows, setOriginalRows] = useState<Record<string, EditableStudent>>({});
  const [canEdit, setCanEdit] = useState(true);
  const [academicYear, setAcademicYear] = useState<string | null>(null);

  useEffect(() => {
    if (!isClassListPage) return;

    const intercept = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) return;
      if (clean(button.textContent) !== "Corriger les champs") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen((value) => !value);
    };

    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [isClassListPage]);

  async function load() {
    if (!classId) return;
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const sp = new URLSearchParams(window.location.search);
      const requestedAcademicYear = clean(sp.get("academic_year"));
      const qs = requestedAcademicYear
        ? `?academic_year=${encodeURIComponent(requestedAcademicYear)}`
        : "";

      const [rosterResponse, scholarshipResponse] = await Promise.all([
        fetch(`/api/admin/classes/${encodeURIComponent(classId)}/roster${qs}`, {
          cache: "no-store",
        }),
        fetch(
          `/api/admin/classes/${encodeURIComponent(classId)}/scholarships${qs}`,
          { cache: "no-store" },
        ),
      ]);

      const rosterJson = (await rosterResponse.json().catch(() => ({}))) as
        RosterPayload & { error?: string };
      const scholarshipJson = (await scholarshipResponse
        .json()
        .catch(() => ({}))) as ScholarshipPayload & { error?: string };

      if (!rosterResponse.ok) {
        throw new Error(
          rosterJson.error || "Impossible de charger les élèves.",
        );
      }
      if (!scholarshipResponse.ok) {
        throw new Error(
          scholarshipJson.error || "Impossible de charger les statuts boursier.",
        );
      }

      const scholarships = scholarshipJson.scholarships || {};
      const next: Record<string, EditableStudent> = {};
      for (const student of Array.isArray(rosterJson.students)
        ? rosterJson.students
        : []) {
        next[student.id] = normalizeRow(
          student,
          normalizeScholarship(scholarships[student.id]),
        );
      }

      setRows(next);
      setOriginalRows(
        JSON.parse(JSON.stringify(next)) as Record<string, EditableStudent>,
      );
      setCanEdit(rosterJson.can_edit !== false);
      setAcademicYear(
        clean(scholarshipJson.academic_year) || requestedAcademicYear || null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, classId]);

  const orderedRows = useMemo(
    () =>
      Object.values(rows).sort((a, b) =>
        clean(
          `${a.last_name || ""} ${a.first_name || ""} ${a.full_name || ""}`,
        ).localeCompare(
          clean(
            `${b.last_name || ""} ${b.first_name || ""} ${b.full_name || ""}`,
          ),
          "fr",
          { sensitivity: "base", numeric: true },
        ),
      ),
    [rows],
  );

  function patch(id: string, values: Partial<EditableStudent>) {
    setRows((current) => ({
      ...current,
      [id]: { ...current[id], ...values },
    }));
  }

  async function save() {
    if (!canEdit || !classId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const changedRoster = orderedRows.filter((row) => {
        const original = originalRows[row.id];
        if (!original) return true;
        return ROSTER_FIELDS.some(
          (field) => comparable(row[field]) !== comparable(original[field]),
        );
      });

      const changedScholarship = orderedRows.filter((row) => {
        const original = originalRows[row.id];
        if (!original) return true;
        return (
          normalizeScholarship(row.scholarship_status) !==
          normalizeScholarship(original.scholarship_status)
        );
      });

      if (changedRoster.length === 0 && changedScholarship.length === 0) {
        setMessage("Aucune modification détectée.");
        return;
      }

      const incompleteFinance = changedRoster.find(
        (row) =>
          typeof row.is_affecte !== "boolean" ||
          typeof row.is_boarder !== "boolean",
      );
      if (incompleteFinance) {
        throw new Error(
          `Complétez Affecté/Non affecté et Interne/Externe pour ${
            clean(
              `${incompleteFinance.last_name || ""} ${incompleteFinance.first_name || ""}`,
            ) || "cet élève"
          } avant d’enregistrer.`,
        );
      }

      let classMoves = 0;

      if (changedRoster.length > 0) {
        const rosterResponse = await fetch(
          `/api/admin/classes/${encodeURIComponent(classId)}/roster`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              updates: changedRoster.map((row) => ({
                student_id: row.id,
                first_name: clean(row.first_name) || null,
                last_name: clean(row.last_name).toUpperCase() || null,
                matricule: clean(row.matricule).toUpperCase() || null,
                official_track_code: clean(row.official_track_code) || null,
                is_affecte: row.is_affecte,
                is_boarder: row.is_boarder,
                birthdate: clean(row.birthdate) || null,
                birth_place: clean(row.birth_place) || null,
                gender: clean(row.gender) || null,
                is_repeater: row.is_repeater,
                lv2: clean(row.lv2).toUpperCase() || null,
                nationality: clean(row.nationality) || null,
              })),
            }),
          },
        );
        const rosterJson = await rosterResponse.json().catch(() => ({}));
        if (!rosterResponse.ok) {
          throw new Error(
            rosterJson?.error || "Impossible d’enregistrer les corrections.",
          );
        }
        classMoves = Number(rosterJson?.class_moves || 0);
      }

      if (changedScholarship.length > 0) {
        const scholarshipResponse = await fetch(
          `/api/admin/classes/${encodeURIComponent(classId)}/scholarships`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              academic_year: academicYear,
              updates: changedScholarship.map((row) => ({
                student_id: row.id,
                scholarship_status: normalizeScholarship(
                  row.scholarship_status,
                ),
              })),
            }),
          },
        );
        const scholarshipJson = await scholarshipResponse
          .json()
          .catch(() => ({}));
        if (!scholarshipResponse.ok) {
          throw new Error(
            scholarshipJson?.error ||
              "Impossible d’enregistrer le statut boursier.",
          );
        }
      }

      setMessage(
        `${changedRoster.length + changedScholarship.length} modification(s) enregistrée(s).${
          changedScholarship.length > 0
            ? ` Statut boursier mis à jour pour ${changedScholarship.length} élève(s).`
            : ""
        }${
          classMoves > 0
            ? ` ${classMoves} transfert(s) de série/classe appliqué(s).`
            : ""
        }`,
      );
      await load();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d’enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  if (!isClassListPage || !open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6 print:hidden">
      <div className="flex max-h-[92vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Corriger les champs élèves
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Identité complète utilisée par les bulletins et documents administratifs. Le statut boursier reste hors de la liste de classe imprimée.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !canEdit}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Fermer
            </button>
          </div>
        </div>

        {error ? (
          <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="mx-5 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {loading ? (
            <div className="rounded-xl border p-6 text-sm text-slate-600">
              Chargement des élèves…
            </div>
          ) : (
            <table className="min-w-[1790px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  {[
                    "Nom",
                    "Prénom(s)",
                    "Matricule",
                    "Date de naissance",
                    "Lieu de naissance",
                    "Sexe",
                    "Nationalité",
                    "Série",
                    "Affecté",
                    "Internat",
                    "Boursier",
                    "Redoublant",
                    "LV2",
                  ].map((label) => (
                    <th
                      key={label}
                      className="border-b border-r px-3 py-2 text-left font-bold text-slate-700 first:border-l"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedRows.map((row) => (
                  <tr
                    key={row.id}
                    className="odd:bg-white even:bg-slate-50/70"
                  >
                    <td className="border-b border-r border-l p-2">
                      <input
                        value={row.last_name || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            last_name: e.target.value.toUpperCase() || null,
                          })
                        }
                        className="w-[170px] rounded-lg border px-2 py-1 font-semibold uppercase"
                      />
                    </td>
                    <td className="border-b border-r p-2">
                      <input
                        value={row.first_name || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            first_name: e.target.value || null,
                          })
                        }
                        className="w-[210px] rounded-lg border px-2 py-1"
                      />
                    </td>
                    <td className="border-b border-r p-2">
                      <input
                        value={row.matricule || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            matricule: e.target.value.toUpperCase() || null,
                          })
                        }
                        className="w-[125px] rounded-lg border px-2 py-1 uppercase"
                      />
                    </td>
                    <td className="border-b border-r p-2">
                      <input
                        type="date"
                        value={String(row.birthdate || "").slice(0, 10)}
                        onChange={(e) =>
                          patch(row.id, {
                            birthdate: e.target.value || null,
                          })
                        }
                        className="w-[145px] rounded-lg border px-2 py-1"
                      />
                    </td>
                    <td className="border-b border-r p-2">
                      <input
                        value={row.birth_place || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            birth_place: e.target.value || null,
                          })
                        }
                        placeholder="Ex. Aboisso"
                        className="w-[180px] rounded-lg border px-2 py-1"
                      />
                    </td>
                    <td className="border-b border-r p-2">
                      <select
                        value={row.gender || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            gender: e.target.value || null,
                          })
                        }
                        className="w-[82px] rounded-lg border px-2 py-1"
                      >
                        <option value="">—</option>
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                    </td>
                    <td className="border-b border-r p-2">
                      <input
                        value={row.nationality || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            nationality: e.target.value || null,
                          })
                        }
                        placeholder="Ivoirienne"
                        className="w-[145px] rounded-lg border px-2 py-1"
                      />
                    </td>
                    <td className="border-b border-r p-2">
                      <select
                        value={row.official_track_code || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            official_track_code: e.target.value || null,
                          })
                        }
                        className="w-[110px] rounded-lg border px-2 py-1"
                      >
                        {SERIES_OPTIONS.map(([value, label]) => (
                          <option key={value || "empty"} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-r p-2">
                      <select
                        value={
                          row.is_affecte === true
                            ? "true"
                            : row.is_affecte === false
                              ? "false"
                              : ""
                        }
                        onChange={(e) =>
                          patch(row.id, {
                            is_affecte:
                              e.target.value === "true"
                                ? true
                                : e.target.value === "false"
                                  ? false
                                  : null,
                          })
                        }
                        className="w-[118px] rounded-lg border px-2 py-1"
                      >
                        <option value="">—</option>
                        <option value="true">Affecté</option>
                        <option value="false">Non affecté</option>
                      </select>
                    </td>
                    <td className="border-b border-r p-2">
                      <select
                        value={
                          row.is_boarder === true
                            ? "true"
                            : row.is_boarder === false
                              ? "false"
                              : ""
                        }
                        onChange={(e) =>
                          patch(row.id, {
                            is_boarder:
                              e.target.value === "true"
                                ? true
                                : e.target.value === "false"
                                  ? false
                                  : null,
                          })
                        }
                        className="w-[105px] rounded-lg border px-2 py-1"
                      >
                        <option value="">—</option>
                        <option value="true">Interne</option>
                        <option value="false">Externe</option>
                      </select>
                    </td>
                    <td className="border-b border-r p-2">
                      <select
                        value={normalizeScholarship(row.scholarship_status)}
                        onChange={(e) =>
                          patch(row.id, {
                            scholarship_status: normalizeScholarship(
                              e.target.value,
                            ),
                          })
                        }
                        className="w-[120px] rounded-lg border px-2 py-1"
                      >
                        <option value="unknown">—</option>
                        <option value="boursier">Oui</option>
                        <option value="non_boursier">Non</option>
                      </select>
                    </td>
                    <td className="border-b border-r p-2">
                      <select
                        value={
                          row.is_repeater === true
                            ? "true"
                            : row.is_repeater === false
                              ? "false"
                              : ""
                        }
                        onChange={(e) =>
                          patch(row.id, {
                            is_repeater:
                              e.target.value === "true"
                                ? true
                                : e.target.value === "false"
                                  ? false
                                  : null,
                          })
                        }
                        className="w-[105px] rounded-lg border px-2 py-1"
                      >
                        <option value="">—</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </select>
                    </td>
                    <td className="border-b border-r p-2">
                      <input
                        value={row.lv2 || ""}
                        onChange={(e) =>
                          patch(row.id, {
                            lv2: e.target.value.toUpperCase() || null,
                          })
                        }
                        placeholder="ESP / ALL"
                        className="w-[100px] rounded-lg border px-2 py-1 uppercase"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
