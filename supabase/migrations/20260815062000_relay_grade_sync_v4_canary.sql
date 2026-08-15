-- LOT 4A.4 — activation progressive du moteur versionné des notes.
-- Désactivé par défaut : aucun relais existant ne change de comportement
-- tant qu'il n'est pas explicitement activé après validation.

ALTER TABLE public.relay_sync_devices
  ADD COLUMN IF NOT EXISTS grade_sync_v4_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.relay_sync_devices.grade_sync_v4_enabled IS
  'Active le push CAS et le pull versionné des student_grade pour ce relais.';
