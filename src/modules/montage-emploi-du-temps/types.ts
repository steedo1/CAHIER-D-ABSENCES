export type MontageClass = {
  id: string;
  label: string;
  level_code?: string | null;
  series_code?: string | null;
};

export type MontageSubject = {
  id: string;
  label: string;
  code?: string | null;
  catalog_subject_id?: string | null;
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
  subject_code?: string | null;
  catalog_subject_id?: string | null;
  class_id: string;
  class_label: string;
  level_code?: string | null;
  series_code?: string | null;
};

export type MontageServiceAssignment = {
  class_id: string;
  class_label: string;
  level_code: string;
  series_code: string | null;
  teacher_id: string;
  teacher_name: string;
  subject_id: string;
  subject_label: string;
  subject_code: string | null;
  catalog_subject_id: string;
  catalog_subject_label: string;
  weekly_units: number | null;
  split_pattern: string | null;
  room_type_required: string | null;
  source: "default_catalog" | "override" | "manual_missing_catalog";
  is_ready: boolean;
  missing_reason: string | null;
};

export type MontageTerrainRules = Record<string, unknown>;
export type MontageRoom = Record<string, unknown>;
export type MontageRoomPreference = Record<string, unknown>;
export type MontageTeacherUnavailability = Record<string, unknown>;

export type MontageBootstrapResponse =
  | {
      ok: true;
      institution: {
        id: string;
        name: string | null;
        acronym: string | null;
        tz: string;
        default_session_minutes: number;
        logo_url?: string | null;
        institution_logo_url?: string | null;
        phone?: string | null;
        institution_phone?: string | null;
        email?: string | null;
        institution_email?: string | null;
        regional_direction?: string | null;
        institution_region?: string | null;
        postal_address?: string | null;
        institution_postal_address?: string | null;
        status?: string | null;
        settings_json?: Record<string, unknown>;
      };
      classes: MontageClass[];
      subjects: MontageSubject[];
      teachers: MontageTeacher[];
      periods: MontagePeriod[];
      affectations: MontageAffectation[];
      service_assignments: MontageServiceAssignment[];
      terrain_rules: MontageTerrainRules | null;
      rooms: MontageRoom[];
      room_preferences: MontageRoomPreference[];
      teacher_unavailability: MontageTeacherUnavailability[];
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      message?: string;
    };
