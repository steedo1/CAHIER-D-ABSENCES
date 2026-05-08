export type MontageClass = {
  id: string;
  label: string;
};

export type MontageSubject = {
  id: string;
  label: string;
};

export type MontageTeacher = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
};

export type MontagePeriod = {
  id: string;
  weekday: number;
  period_no: number;
  label: string;
  start_time: string | null;
  end_time: string | null;
  duration_min: number;
};

export type MontageAffectation = {
  teacher_id: string;
  teacher_name: string;
  subject_id: string | null;
  subject_label: string;
  class_id: string;
  class_label: string;
};

export type MontageBootstrapResponse =
  | {
      ok: true;
      institution: {
        id: string;
        name: string | null;
        acronym: string | null;
        tz: string;
        default_session_minutes: number;
      };
      classes: MontageClass[];
      subjects: MontageSubject[];
      teachers: MontageTeacher[];
      periods: MontagePeriod[];
      affectations: MontageAffectation[];
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      message?: string;
    };
