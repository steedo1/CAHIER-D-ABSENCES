// src/lib/studentPhotoAccess.ts
// Référence stable et privée pour les photos d'élèves.
// Le fichier physique reste dans le bucket privé "student-photos".

export type StudentPhotoRef = {
  id?: string | null;
  student_id?: string | null;
  photo_path?: string | null;
  photo_updated_at?: string | null;
};

export function buildProtectedStudentPhotoUrl(
  student: StudentPhotoRef | null | undefined,
): string | null {
  const studentId = String(student?.id || student?.student_id || "").trim();
  const photoPath = String(student?.photo_path || "").trim();

  if (!studentId || !photoPath) return null;

  const rawUpdatedAt = String(student?.photo_updated_at || "").trim();
  const parsedUpdatedAt = rawUpdatedAt ? Date.parse(rawUpdatedAt) : Number.NaN;
  const version = Number.isFinite(parsedUpdatedAt)
    ? `?v=${Math.trunc(parsedUpdatedAt)}`
    : "";

  return `/api/media/student-photo/${encodeURIComponent(studentId)}${version}`;
}
