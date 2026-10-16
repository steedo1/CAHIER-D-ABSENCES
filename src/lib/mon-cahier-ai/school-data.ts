import type { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { cleanText, levelMatches } from "@/lib/mon-cahier-ai/core";

export type SchoolClass = { id: string; label: string | null; level: string | null };
type Database = ReturnType<typeof getSupabaseServiceClient>;
type Enrollment = { student_id: string; class_id: string };
type Student = { id: string; gender: string | null; is_boarder: boolean | null; is_repeater: boolean | null; is_affecte: boolean | null };
type Assignment = { id: string; teacher_id: string; class_id: string; subject_id: string | null; start_date: string | null; end_date: string | null };
type FlagCounts = { yes: number; no: number; unknown: number; complete: boolean };
type StudentStatistics = {
  source: string; academic_year: string; scope_label: string; as_of: string; enrollment_basis: string;
  students_count: number; classes_count: number;
  by_class: { class_label: string; level: string | null; students: number; boarders?: number; boarding_unknown?: number }[];
  boarding?: FlagCounts; repeaters?: FlagCounts; affectation?: FlagCounts;
  gender?: { female: number; male: number; unknown: number };
};

export type SchoolDataScope = {
  srv: Database;
  institutionId: string;
  academicYear: string;
  referenceDate: string;
  classes: SchoolClass[];
  restricted: boolean;
  signal: AbortSignal;
};

const PAGE_SIZE = 1000;
const MAX_ROWS = 30_000;

/** Never return a plausible partial count when pagination or a read fails. */
async function pages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await read(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("Les données d’effectif ou d’annuaire sont momentanément indisponibles.");
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
  throw new Error("Ce périmètre contient trop de données pour un décompte complet. Précise un niveau ou une classe.");
}

function chunks<T>(values: T[], size = 150): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
}

export function createSchoolData(scope: SchoolDataScope) {
  const { srv, institutionId, academicYear, referenceDate } = scope;
  const cache = new Map<string, Promise<unknown>>();
  function memo<T>(key: string, read: () => Promise<T>): Promise<T> {
    if (!cache.has(key)) cache.set(key, read());
    return cache.get(key) as Promise<T>;
  }
  const signal = () => AbortSignal.any([scope.signal, AbortSignal.timeout(8_000)]);

  function selectClasses(labels: string[] = [], level?: string | null) {
    let selected = scope.classes;
    if (labels.length) {
      const normalize = (label: string) => cleanText(label).replace(/\s/g, "");
      const names = new Set(labels.map(normalize));
      selected = selected.filter((cls) => names.has(normalize(cls.label || "")));
      // A foreign or misspelled class must not silently become the whole school.
      if (new Set(selected.map((cls) => normalize(cls.label || ""))).size !== names.size) {
        throw new Error("unknown_class_in_scope");
      }
    }
    if (level) selected = selected.filter((cls) => levelMatches(cls.level, level));
    if ((labels.length || level) && !selected.length) throw new Error("unknown_class_in_scope");
    return selected;
  }

  function describe(selected: SchoolClass[]) {
    return selected.length && (scope.restricted || selected.length !== scope.classes.length)
      ? selected.map((cls) => cls.label || "Classe").join(", ") : "Établissement";
  }

  async function enrollments(selected: SchoolClass[]) {
    return memo(`enrollments:${selected.map((cls) => cls.id).sort().join(",")}`, async () => {
      const result: Enrollment[] = [];
      for (const ids of chunks(selected.map((cls) => cls.id))) {
        result.push(...await pages<Enrollment>((from, to) => srv.from("class_enrollments")
          .select("student_id,class_id").eq("institution_id", institutionId)
          .in("class_id", ids).is("end_date", null)
          .order("id", { ascending: true }).range(from, to).abortSignal(signal())));
      }
      return result;
    });
  }

  async function studentStatistics(input: { class_labels?: string[]; level?: string | null; metric?: "total" | "boarding" | "gender" | "repeaters" | "affectation" | "all" } = {}): Promise<StudentStatistics> {
    const selected = selectClasses(input.class_labels, input.level);
    const rows = await enrollments(selected);
    const ids = [...new Set(rows.map((row) => row.student_id).filter(Boolean))];
    const byClass = selected.map((cls) => ({
      class_label: cls.label || "Classe",
      level: cls.level,
      students: new Set(rows.filter((row) => row.class_id === cls.id).map((row) => row.student_id)).size,
    }));
    const base = {
      source: "Inscriptions actives et fiches élèves",
      academic_year: academicYear,
      scope_label: describe(selected),
      as_of: referenceDate,
      enrollment_basis: "Inscriptions actuellement actives ; les statuts des fiches ne constituent pas un historique à la date de référence.",
      students_count: ids.length,
      classes_count: selected.length,
      by_class: byClass,
    };
    if (!input.metric || input.metric === "total") return base;

    const students = await memo(`students:${ids.slice().sort().join(",")}`, async () => {
      const result: Student[] = [];
      for (const batch of chunks(ids)) {
        const { data, error } = await srv.from("students")
          .select("id,gender,is_boarder,is_repeater,is_affecte").eq("institution_id", institutionId)
          .in("id", batch).abortSignal(signal());
        if (error) throw new Error("school_data_unavailable");
        result.push(...(data || []) as Student[]);
      }
      return result;
    });
    const byId = new Map(students.map((student) => [student.id, student]));
    const unique = ids.map((id) => byId.get(id));
    function flag(field: "is_boarder" | "is_repeater" | "is_affecte") {
      const yes = unique.filter((student) => student?.[field] === true).length;
      const no = unique.filter((student) => student?.[field] === false).length;
      return { yes, no, unknown: ids.length - yes - no, complete: yes + no === ids.length };
    }
    const gender = unique.reduce((counts, student) => {
      const value = cleanText(student?.gender || "");
      if (["f", "feminin", "fille", "female"].includes(value)) counts.female++;
      else if (["m", "masculin", "garcon", "male"].includes(value)) counts.male++;
      else counts.unknown++;
      return counts;
    }, { female: 0, male: 0, unknown: 0 });
    const metric = input.metric;
    return {
      ...base,
      ...(metric === "boarding" || metric === "all" ? { boarding: flag("is_boarder") } : {}),
      ...(metric === "repeaters" || metric === "all" ? { repeaters: flag("is_repeater") } : {}),
      ...(metric === "affectation" || metric === "all" ? { affectation: flag("is_affecte") } : {}),
      ...(metric === "gender" || metric === "all" ? { gender } : {}),
      by_class: byClass.map((cls, index) => {
        const classId = selected[index].id;
        const members = [...new Set(rows.filter((row) => row.class_id === classId).map((row) => row.student_id))];
        return { ...cls, ...(metric === "boarding" || metric === "all" ? {
          boarders: members.filter((id) => byId.get(id)?.is_boarder === true).length,
          boarding_unknown: members.filter((id) => typeof byId.get(id)?.is_boarder !== "boolean").length,
        } : {}) };
      }),
    };
  }

  async function registeredTeacherIds() {
    return memo("teacher-roles", async () => {
      const rows = await pages<{ profile_id: string }>((from, to) => srv.from("user_roles")
        .select("profile_id").eq("institution_id", institutionId).eq("role", "teacher")
        .order("id", { ascending: true }).range(from, to).abortSignal(signal()));
      return [...new Set(rows.map((row) => row.profile_id).filter(Boolean))];
    });
  }

  async function teacherAssignments(selected: SchoolClass[]) {
    return memo(`teacher-assignments:${selected.map((cls) => cls.id).sort().join(",")}`, async () => {
      const rows: Assignment[] = [];
      for (const ids of chunks(selected.map((cls) => cls.id))) {
        rows.push(...await pages<Assignment>((from, to) => srv.from("class_teachers")
          .select("id,teacher_id,class_id,subject_id,start_date,end_date").eq("institution_id", institutionId)
          .in("class_id", ids).order("id", { ascending: true }).range(from, to).abortSignal(signal())));
      }
      return rows.filter((row) => (!row.start_date || row.start_date <= referenceDate)
        && (!row.end_date || row.end_date >= referenceDate));
    });
  }

  async function teacherDirectory(input: { class_labels?: string[]; level?: string | null } = {}) {
    const selected = selectClasses(input.class_labels, input.level);
    const [registered, assignments] = await Promise.all([registeredTeacherIds(), teacherAssignments(selected)]);
    const assigned = [...new Set(assignments.map((row) => row.teacher_id).filter(Boolean))];
    const classScope = scope.restricted || Boolean(input.class_labels?.length || input.level);
    const ids = classScope ? assigned : registered;
    const base = {
      source: "Comptes enseignants et affectations aux classes",
      academic_year: academicYear,
      scope_label: describe(selected),
      as_of: referenceDate,
      teachers_count: ids.length,
      registered_teachers_count: classScope ? undefined : registered.length,
      assigned_teachers_count: assigned.length,
      count_basis: classScope ? "Enseignants distincts affectés aux classes du périmètre à la date de référence."
        : "Comptes avec le rôle enseignant dans cet établissement ; les affectations concernent l’année sélectionnée.",
    };

    return base;
  }

  async function calendar(input: { class_label?: string | null } = {}) {
    const selected = input.class_label ? selectClasses([input.class_label]) : scope.classes;
    const classId = (input.class_label || (scope.restricted && selected.length === 1)) ? selected[0]?.id : null;
    const [{ data: year, error }, periods] = await Promise.all([
      srv.from("academic_years").select("code,label,start_date,end_date")
        .eq("institution_id", institutionId).eq("code", academicYear).abortSignal(signal()).maybeSingle(),
      listApplicableGradePeriods(srv, institutionId, academicYear, classId),
    ]);
    if (error) throw new Error("school_data_unavailable");
    return {
      source: "Calendrier scolaire configuré",
      academic_year: academicYear,
      scope_label: input.class_label || (classId ? describe(selected) : "Calendrier commun de l’établissement"),
      as_of: referenceDate,
      year: year || null,
      periods: periods.items.filter((period) => period.is_active !== false).map((period) => ({
        label: period.label || period.short_label || period.code,
        code: period.code,
        kind: period.kind,
        start_date: period.start_date,
        end_date: period.end_date,
        contains_reference_date: Boolean(period.start_date && period.end_date
          && period.start_date <= referenceDate && period.end_date >= referenceDate),
      })),
    };
  }

  return { selectClasses, studentStatistics, teacherDirectory, calendar };
}

export type SchoolData = ReturnType<typeof createSchoolData>;
