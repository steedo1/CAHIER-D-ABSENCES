-- Directors of the two teaching tracks: additive, opt-in, no legacy role change.
-- Deliberately NOT applied to production until server permissions are reviewed.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'teaching_director';

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check CHECK (
  role::text = ANY (ARRAY[
    'super_admin','admin','educator','teacher','parent','student',
    'class_device','drenaet_admin','founder','finance_manager',
    'infirmier','file_correspondent','teaching_director'
  ]::text[])
);

CREATE TABLE IF NOT EXISTS public.school_teaching_directors (
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  teaching_track text NOT NULL CHECK (teaching_track IN ('french','arabic')),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, teaching_track)
);
CREATE INDEX IF NOT EXISTS school_teaching_directors_profile_idx
  ON public.school_teaching_directors (profile_id, institution_id)
  WHERE is_active;

-- Privileged API only: the browser can never mutate or read this authority.
ALTER TABLE public.school_teaching_directors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.school_teaching_directors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_teaching_directors TO service_role;

COMMENT ON TABLE public.school_teaching_directors IS
  'Scope for teaching_director, one director per French/Arabic teaching track and school; no class/cycle restriction.';
