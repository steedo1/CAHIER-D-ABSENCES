type Readiness = {
  schedule_revision?: number | null; preparation_revision?: number | null;
  institution_id?: string | null; authorized_class_id?: string | null;
  authorized_actor_profile_id?: string | null; checked_at?: string | null;
  cloud_revision?: number | null; version: number; role: string; shell_ready: boolean;
};
type Schedule = {
  schedule_revision: number; preparation_revision?: number | null;
  institution_id: string; class_id?: string | null; actor_profile_id?: string | null;
};
type Cloud = { institution_id: string; actor_profile_id?: string; schedule_revision: number; preparation_revision?: number | null };
function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function advanceClassDevicePreparation<R extends Readiness, S extends Schedule>(
  bundle: { readiness: R; schedule: S }, cloud: Cloud | null,
  expected: { institutionId: string; classId: string; actorProfileId: string },
  knownRevision: number | null,
): { readiness: R; schedule: S } | null {
  const { readiness, schedule } = bundle;
  const preparedRevision = readiness.preparation_revision;
  if (!cloud || readiness.version !== 5 || readiness.role !== "class-device" || !readiness.shell_ready ||
    !validRevision(preparedRevision) || schedule.preparation_revision !== preparedRevision ||
    cloud.preparation_revision !== preparedRevision ||
    readiness.institution_id !== expected.institutionId ||
    readiness.authorized_class_id !== expected.classId ||
    readiness.authorized_actor_profile_id !== expected.actorProfileId ||
    schedule.institution_id !== expected.institutionId || schedule.class_id !== expected.classId ||
    schedule.actor_profile_id !== expected.actorProfileId ||
    cloud.institution_id !== expected.institutionId || cloud.actor_profile_id !== expected.actorProfileId ||
    !validRevision(schedule.schedule_revision) || readiness.schedule_revision !== schedule.schedule_revision ||
    !validRevision(cloud.schedule_revision) || cloud.schedule_revision <= schedule.schedule_revision ||
    (knownRevision !== null && cloud.schedule_revision < knownRevision)) return null;
  return {
    readiness: { ...readiness, schedule_revision: cloud.schedule_revision,
      cloud_revision: cloud.schedule_revision, checked_at: new Date().toISOString() },
    schedule: { ...schedule, schedule_revision: cloud.schedule_revision },
  };
}
