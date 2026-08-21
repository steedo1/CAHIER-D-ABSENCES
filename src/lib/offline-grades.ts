"use client";

import {
  cacheGet,
  cacheSet,
  offlineGetJson,
  offlineMutateJson,
  type MutateResult,
} from "@/lib/offline";
import {
  CLOUD_ONLY_GRADE_WRITE_MESSAGE,
  OFFLINE_GRADE_WRITES_ENABLED,
} from "@/lib/grade-write-capabilities";

export type GradesOfflineRole = "teacher" | "class-device";

export type GradeScoreItem = {
  student_id: string;
  score: number | null;
  comment?: string | null;
};

export type GradeScoresPayload = {
  evaluation_id: string;
  items: GradeScoreItem[];
  delete_if_null?: boolean;
  strict?: boolean;
};

function part(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? encodeURIComponent(normalized) : "none";
}

function prefix(role: GradesOfflineRole) {
  return `grades:${role}`;
}

export function gradesClassesKey(role: GradesOfflineRole) {
  return `${prefix(role)}:classes`;
}

export function gradesSettingsKey(role: GradesOfflineRole, url: string) {
  return `${prefix(role)}:settings:${part(url)}`;
}

export function gradesPeriodsKey(
  role: GradesOfflineRole,
  classId?: string | null,
) {
  return `${prefix(role)}:periods:${part(classId)}`;
}

export function gradesComponentsKey(
  role: GradesOfflineRole,
  classId: string,
  subjectId: string | null | undefined
) {
  return `${prefix(role)}:components:${part(classId)}:${part(subjectId)}`;
}

export function gradesRosterKey(role: GradesOfflineRole, classId: string) {
  return `${prefix(role)}:roster:${part(classId)}`;
}

export function gradesEvaluationsKey(
  role: GradesOfflineRole,
  classId: string,
  subjectId: string | null | undefined,
  gradingPeriodId: string | null | undefined
) {
  return `${prefix(role)}:evaluations:${part(classId)}:${part(subjectId)}:${part(
    gradingPeriodId
  )}`;
}

export function gradesScoresKey(role: GradesOfflineRole, evaluationId: string) {
  return `${prefix(role)}:scores:${part(evaluationId)}`;
}

export function gradesLockKey(role: GradesOfflineRole, evaluationId: string) {
  return `${prefix(role)}:lock:${part(evaluationId)}`;
}

export async function gradesGetJson<T = any>(url: string, key: string): Promise<T> {
  return await offlineGetJson<T>(url, key);
}

async function applyScoresToLocalCache(
  role: GradesOfflineRole,
  payload: GradeScoresPayload
) {
  const key = gradesScoresKey(role, payload.evaluation_id);
  const cached = await cacheGet<any>(key);
  const byStudent = new Map<string, any>();

  for (const item of Array.isArray(cached?.items) ? cached.items : []) {
    const studentId = String(item?.student_id || "").trim();
    if (studentId) byStudent.set(studentId, item);
  }

  for (const item of payload.items) {
    const studentId = String(item?.student_id || "").trim();
    if (!studentId) continue;
    byStudent.set(studentId, {
      ...(byStudent.get(studentId) || {}),
      evaluation_id: payload.evaluation_id,
      student_id: studentId,
      score: item.score == null ? null : Number(item.score),
      ...(Object.prototype.hasOwnProperty.call(item, "comment")
        ? { comment: item.comment ?? null }
        : {}),
    });
  }

  const items = Array.from(byStudent.values());
  await cacheSet(key, {
    ...(cached && typeof cached === "object" ? cached : {}),
    evaluation_id: payload.evaluation_id,
    items,
    count: items.length,
    local_updated_at: new Date().toISOString(),
  });
}

/**
 * Le chemin de rentrée appelle directement l'API Cloud et ne crée jamais de
 * mutation locale. Le moteur LOT3/LOT4 reste disponible derrière la capacité
 * explicite OFFLINE_GRADE_WRITES_ENABLED pour une réactivation ultérieure.
 */
export async function saveGradesScores(
  role: GradesOfflineRole,
  payload: GradeScoresPayload
): Promise<MutateResult<any>> {
  const endpoint =
    role === "teacher"
      ? "/api/teacher/grades/scores/bulk"
      : "/api/grades/scores/bulk";

  let result: MutateResult<any>;

  if (OFFLINE_GRADE_WRITES_ENABLED) {
    result = await offlineMutateJson(
      endpoint,
      {
        method: "POST",
        body: payload,
      },
      {
        meta: {
          operationType: "grades-scores",
          role,
          evaluationId: payload.evaluation_id,
        },
      }
    );
  } else {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      result = response.ok
        ? { ok: true, data, status: response.status }
        : {
            ok: false,
            queued: false,
            offline: false,
            status: response.status,
            error: String(
              data?.message || data?.error || `HTTP ${response.status}`,
            ),
            data,
          };
    } catch {
      result = {
        ok: false,
        queued: false,
        offline: false,
        status: 0,
        error: CLOUD_ONLY_GRADE_WRITE_MESSAGE,
      };
    }
  }

  if (result.ok || (OFFLINE_GRADE_WRITES_ENABLED && result.queued)) {
    await applyScoresToLocalCache(role, payload);
  }

  return result;
}
