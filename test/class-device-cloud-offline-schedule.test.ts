import assert from "node:assert/strict";
import test from "node:test";
import { projectClassDeviceCloudSchedule } from "../src/lib/class-device-offline-cloud-server";
import { validateClassDeviceScheduleScope } from "../src/lib/offlineClassDevice";

test("le Cloud projette un planning strictement borné au téléphone classe", () => {
  const schedule = projectClassDeviceCloudSchedule(
    {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
      classLabel: "1ère D1",
      classLevel: "1ère",
    },
    {
      revision: 42,
      generatedAt: "2026-08-08T18:00:00.000Z",
      periods: [
        {
          id: "period-a",
          weekday: 6,
          label: "Séance 1",
          start_time: "18:20:00",
          end_time: "18:25:00",
        },
      ],
      timetables: [
        {
          id: "timetable-a",
          institution_id: "school-a",
          class_id: "class-a",
          subject_id: "institution-subject-a",
          teacher_id: "teacher-a",
          period_id: "period-a",
        },
        {
          id: "timetable-b",
          institution_id: "school-a",
          class_id: "class-b",
          subject_id: "institution-subject-a",
          teacher_id: "teacher-b",
          period_id: "period-a",
        },
      ],
      subjects: [
        {
          id: "institution-subject-a",
          subject_id: "subject-a",
          custom_name: "Français",
        },
      ],
      enrollments: [
        {
          institution_id: "school-a",
          class_id: "class-a",
          student_id: "student-a",
        },
        {
          institution_id: "school-a",
          class_id: "class-b",
          student_id: "student-b",
        },
      ],
      students: [
        {
          id: "student-a",
          institution_id: "school-a",
          first_name: "Awa",
          last_name: "Koné",
        },
        {
          id: "student-b",
          institution_id: "school-a",
          first_name: "Aya",
          last_name: "Diallo",
        },
      ],
      assignments: [
        {
          institution_id: "school-a",
          class_id: "class-a",
          teacher_id: "teacher-a",
          subject_id: "institution-subject-a",
        },
        {
          institution_id: "school-a",
          class_id: "class-b",
          teacher_id: "teacher-b",
          subject_id: "institution-subject-a",
        },
      ],
    },
  );

  assert.equal(schedule.source, "cloud");
  assert.equal(schedule.institution_id, "school-a");
  assert.equal(schedule.class_id, "class-a");
  assert.equal(schedule.actor_profile_id, "device-a");
  assert.equal(schedule.schedule_revision, 42);
  assert.equal(schedule.class_count, 1);
  assert.equal(schedule.slot_count, 1);
  assert.deepEqual(Object.keys(schedule.rosters), ["class-a"]);
  assert.deepEqual(
    schedule.rosters["class-a"].items.map((student) => student.id),
    ["student-a"],
  );
  assert.deepEqual(
    schedule.slots[0].items.map((item) => item.class_id),
    ["class-a"],
  );
  assert.equal(schedule.assignments.length, 1);
  assert.deepEqual(
    validateClassDeviceScheduleScope(schedule, {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: true, revision: 42 },
  );
});
