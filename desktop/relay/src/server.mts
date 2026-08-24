import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { adminDashboard } from "./admin-dashboard.mjs";
import { attendanceMonitor } from "./attendance-monitor.mjs";
import { founderAttendanceSlots } from "./attendance-slots.mjs";
import { issueAttendancePresenceProof } from "./presence-proof.mjs";
import { authenticateRelayTeacherAccess } from "./teacher-auth.mjs";
import {
  secureTeacherAttendanceOperation,
  TeacherAttendanceError,
} from "./teacher-attendance.mjs";
import {
  openTeacherAttendanceSession,
  TeacherSessionOpenError,
} from "./teacher-session-open.mjs";
import {
  closeTeacherAttendanceSession,
  maintainTeacherAttendanceSessions,
  TeacherSessionLifecycleError,
  transitionTeacherAttendanceSession,
} from "./teacher-session-lifecycle.mjs";
import type { RelayConfig } from "./config.mjs";
import type { RelayStore } from "./store.mjs";
import {
  institutionScheduleContract,
  relayRuntimeContract,
} from "./schedule-contract.mjs";
import { teacherOfflineSchedule } from "./teacher-offline-schedule.mjs";
import { relayGradeWorkspace, RelayGradeWorkspaceError } from "./grade-workspace.mjs";
import { secureGradeScoreOperation, RelayGradeWriteError } from "./grade-write.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BOOTSTRAP_BODY_BYTES = 32 * 1024 * 1024;
const MAX_CONNECTIVITY_CHECK_BODY_BYTES = 4 * 1024;
const MAX_TEACHER_ATTENDANCE_BODY_BYTES = 128 * 1024;
const MAX_TEACHER_SESSION_OPEN_BODY_BYTES = 16 * 1024;
const MAX_TEACHER_SESSION_LIFECYCLE_BODY_BYTES = 16 * 1024;
const MAX_TEACHER_OFFLINE_SCHEDULE_BODY_BYTES = 4 * 1024;
const MAX_GRADE_WORKSPACE_BODY_BYTES = 16 * 1024;
const MAX_GRADE_WRITE_BODY_BYTES = 16 * 1024;
const SESSION_MAINTENANCE_INTERVAL_MS = 30_000;

export function createRelayServer(
  config: RelayConfig,
  store: RelayStore,
  options: { now?: () => Date } = {},
) {
  const server = createServer(async (request, response) => {
    secureHeaders(response);
    applyCors(request, response, config);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (
        config.teacherAttendanceWritesEnabled === true &&
        url.pathname !== "/health" &&
        url.pathname !== "/v1/teacher/connectivity-check" &&
        url.pathname !== "/v1/teacher/offline-schedule"
      ) {
        maintainTeacherAttendanceSessions(store.db, options.now?.() ?? new Date());
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const relayStatus = store.status();
        const institutionIds = store.db.prepare(`
          SELECT id FROM institutions WHERE deleted_at IS NULL ORDER BY id
        `).all() as Array<{ id: string }>;
        const scoped =
          institutionIds.length === 1
            ? institutionScheduleContract(store.db, institutionIds[0]!.id)
            : {
                snapshot_revision: null,
                generated_at: null,
                schedule_status:
                  institutionIds.length > 1
                    ? "authenticated_institution_required"
                    : "not_prepared",
              };
        return json(response, 200, {
          ok: true,
          ...relayRuntimeContract(
            store.db,
            config.teacherAttendanceWritesEnabled === true,
            config.gradeScoreWritesEnabled === true,
          ),
          ...scoped,
          academic:
            relayStatus.institutions.length === 1
              ? relayStatus.institutions[0]!.academic
              : {
                  ready: false,
                  revision: null,
                  snapshot_complete: false,
                  last_sync_at: null,
                  required_collections_complete: false,
                },
          relay_period: null,
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/teacher/connectivity-check") {
        const body = await readJson(request, MAX_CONNECTIVITY_CHECK_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        try {
          const requestNow = options.now?.() ?? new Date();
          const teacher = authenticateRelayTeacherAccess(store.db, token, requestNow);
          if (!configuredInstitutionAllows(config, store, teacher.institution_id)) {
            return json(response, 401, { error: "unauthorized" });
          }
          return json(response, 200, {
            ok: true,
            institution_id: teacher.institution_id,
            actor_kind: teacher.actor_kind || "teacher",
            class_id: teacher.class_id || null,
            actor_profile_id: teacher.actor_profile_id,
            relay_time: requestNow.toISOString(),
            ...relayRuntimeContract(
              store.db,
              config.teacherAttendanceWritesEnabled === true,
              config.gradeScoreWritesEnabled === true,
            ),
            ...institutionScheduleContract(store.db, teacher.institution_id),
            ...teacherScheduleCompatibility(store, teacher.institution_id, body),
          });
        } catch {
          return json(response, 401, { error: "unauthorized" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/teacher/offline-schedule") {
        await readJson(request, MAX_TEACHER_OFFLINE_SCHEDULE_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        try {
          const requestNow = options.now?.() ?? new Date();
          const teacher = authenticateRelayTeacherAccess(
            store.db,
            token,
            requestNow,
          );
          if (!configuredInstitutionAllows(config, store, teacher.institution_id)) {
            return json(response, 403, { error: "institution_not_allowed" });
          }
          return json(response, 200, teacherOfflineSchedule(store.db, teacher, requestNow));
        } catch (error) {
          const code = error instanceof Error
            ? error.message
            : "teacher_offline_schedule_failed";
          if (code === "schedule_snapshot_not_prepared") {
            return json(response, 409, { error: code });
          }
          return json(response, 401, { error: "unauthorized" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/grades/workspace") {
        const body = await readJson(request, MAX_GRADE_WORKSPACE_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        try {
          const requestNow = options.now?.() ?? new Date();
          const actor = authenticateRelayTeacherAccess(store.db, token, requestNow);
          if (!configuredInstitutionAllows(config, store, actor.institution_id)) {
            return json(response, 403, { error: "institution_not_allowed" });
          }
          return json(response, 200, relayGradeWorkspace(
            store.db,
            actor,
            body && typeof body === "object" ? body : {},
          ));
        } catch (error) {
          if (error instanceof RelayGradeWorkspaceError) {
            return json(response, error.status, { error: error.code });
          }
          return json(response, 401, { error: "unauthorized" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/grades/score-operations") {
        if (config.gradeScoreWritesEnabled !== true) {
          return json(response, 503, { error: "grade_score_writes_disabled" });
        }
        const body = await readJson(request, MAX_GRADE_WRITE_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        const requestNow = options.now?.() ?? new Date();
        let actor;
        try {
          actor = authenticateRelayTeacherAccess(store.db, token, requestNow);
        } catch {
          return json(response, 401, { error: "unauthorized" });
        }
        if (!configuredInstitutionAllows(config, store, actor.institution_id)) {
          return json(response, 403, { error: "institution_not_allowed" });
        }
        try {
          const result = secureGradeScoreOperation(store, body, actor, requestNow);
          return json(
            response,
            result.action === "noop" || result.idempotent ? 200 : 202,
            result,
          );
        } catch (error) {
          if (error instanceof RelayGradeWriteError) {
            return json(response, error.status, { error: error.code });
          }
          return json(response, 500, { error: "grade_write_failed" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/teacher/attendance-operations") {
        const body = await readJson(request, MAX_TEACHER_ATTENDANCE_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        let teacher;
        const requestNow = options.now?.() ?? new Date();
        try {
          teacher = authenticateRelayTeacherAccess(store.db, token, requestNow);
        } catch {
          return json(response, 401, { error: "unauthorized" });
        }
        if (!configuredInstitutionAllows(config, store, teacher.institution_id)) {
          return json(response, 403, { error: "institution_not_allowed" });
        }
        if (config.teacherAttendanceWritesEnabled !== true) {
          return json(response, 503, { error: "teacher_attendance_writes_disabled" });
        }
        try {
          const result = secureTeacherAttendanceOperation(store.db, body, teacher, requestNow);
          return json(response, result.idempotent ? 200 : 202, result);
        } catch (error) {
          if (error instanceof TeacherAttendanceError) {
            return json(response, error.status, { error: error.code });
          }
          return json(response, 500, { error: "teacher_attendance_failed" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/teacher/attendance-sessions/open") {
        const body = await readJson(request, MAX_TEACHER_SESSION_OPEN_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        let teacher;
        const requestNow = options.now?.() ?? new Date();
        try {
          teacher = authenticateRelayTeacherAccess(store.db, token, requestNow);
        } catch {
          return json(response, 401, { error: "unauthorized" });
        }
        if (!configuredInstitutionAllows(config, store, teacher.institution_id)) {
          return json(response, 403, { error: "institution_not_allowed" });
        }
        if (config.teacherAttendanceWritesEnabled !== true) {
          return json(response, 503, { error: "teacher_attendance_writes_disabled" });
        }
        try {
          const result = openTeacherAttendanceSession(store.db, body, teacher, requestNow);
          return json(response, result.idempotent ? 200 : 201, result);
        } catch (error) {
          if (error instanceof TeacherSessionOpenError) {
            return json(response, error.status, {
              error: error.code,
              ...(error.details ? { details: error.details } : {}),
            });
          }
          return json(response, 500, { error: "teacher_session_open_failed" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/teacher/attendance-sessions/close") {
        const body = await readJson(request, MAX_TEACHER_SESSION_LIFECYCLE_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        const requestNow = options.now?.() ?? new Date();
        let teacher;
        try {
          teacher = authenticateRelayTeacherAccess(store.db, token, requestNow);
        } catch {
          return json(response, 401, { error: "unauthorized" });
        }
        if (!configuredInstitutionAllows(config, store, teacher.institution_id)) {
          return json(response, 403, { error: "institution_not_allowed" });
        }
        if (config.teacherAttendanceWritesEnabled !== true) {
          return json(response, 503, { error: "teacher_attendance_writes_disabled" });
        }
        try {
          const result = closeTeacherAttendanceSession(store.db, body, teacher, requestNow);
          return json(response, result.idempotent ? 200 : 202, result);
        } catch (error) {
          if (error instanceof TeacherSessionLifecycleError) {
            return json(response, error.status, {
              error: error.code,
              ...(error.details ? { details: error.details } : {}),
            });
          }
          return json(response, 500, { error: "teacher_session_close_failed" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/teacher/attendance-sessions/transition") {
        const body = await readJson(request, MAX_TEACHER_SESSION_LIFECYCLE_BODY_BYTES);
        const token = teacherBearerToken(request);
        if (!token) return json(response, 401, { error: "unauthorized" });
        const requestNow = options.now?.() ?? new Date();
        let teacher;
        try {
          teacher = authenticateRelayTeacherAccess(store.db, token, requestNow);
        } catch {
          return json(response, 401, { error: "unauthorized" });
        }
        if (!configuredInstitutionAllows(config, store, teacher.institution_id)) {
          return json(response, 403, { error: "institution_not_allowed" });
        }
        if (config.teacherAttendanceWritesEnabled !== true) {
          return json(response, 503, { error: "teacher_attendance_writes_disabled" });
        }
        try {
          const result = transitionTeacherAttendanceSession(store.db, body, teacher, requestNow);
          return json(response, result.idempotent ? 200 : 201, result);
        } catch (error) {
          if (error instanceof TeacherSessionLifecycleError) {
            return json(response, error.status, {
              error: error.code,
              ...(error.details ? { details: error.details } : {}),
            });
          }
          return json(response, 500, { error: "teacher_session_transition_failed" });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/attendance/presence-proof") {
        return json(
          response,
          200,
          issueAttendancePresenceProof(store.db, await readJson(request), options.now?.() ?? new Date()),
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/sync/bootstrap") {
        const body = await readJson(request, MAX_BOOTSTRAP_BODY_BYTES);
        const institutionCode = assertBootstrapMatchesConfiguredInstitution(body, config);
        if (!authorizedForInstitutionCode(request, config, institutionCode)) {
          return json(response, 401, { error: "unauthorized" });
        }
        return json(response, 200, store.bootstrap(body));
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/schedule-status") {
        const institutionId = requiredParam(url, "institution_id");
        if (!authorizedForInstitutionId(request, config, store, institutionId)) {
          return json(response, 401, { error: "unauthorized" });
        }
        return json(response, 200, {
          ok: true,
          institution_id: institutionId,
          ...relayRuntimeContract(
            store.db,
            config.teacherAttendanceWritesEnabled === true,
            config.gradeScoreWritesEnabled === true,
          ),
          ...institutionScheduleContract(store.db, institutionId),
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/dashboard") {
        const institutionId = requiredParam(url, "institution_id");
        if (!authorizedForInstitutionId(request, config, store, institutionId)) {
          return json(response, 401, { error: "unauthorized" });
        }
        const date = requiredParam(url, "date");
        return json(response, 200, adminDashboard(store.db, { institutionId, date }));
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/attendance/monitor") {
        const institutionId = requiredParam(url, "institution_id");
        if (!authorizedForInstitutionId(request, config, store, institutionId)) {
          return json(response, 401, { error: "unauthorized" });
        }
        const from = requiredParam(url, "from");
        const to = requiredParam(url, "to");
        return json(response, 200, {
          rows: attendanceMonitor(store.db, {
            institutionId,
            from,
            to,
            includeExpectedStatuses: url.searchParams.get("include_expected") === "1",
            educationType: url.searchParams.get("education_type"),
            formationCode: url.searchParams.get("formation_code"),
            levelCode:
              url.searchParams.get("formation_level_code") ||
              url.searchParams.get("level_code"),
            classId: url.searchParams.get("class_id"),
          }),
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/founder/attendance-slots") {
        const institutionId = requiredParam(url, "institution_id");
        if (!authorizedForInstitutionId(request, config, store, institutionId)) {
          return json(response, 401, { error: "unauthorized" });
        }
        return json(response, 200, founderAttendanceSlots(store.db, { institutionId }));
      }

      if (!authorized(request, config.token)) return json(response, 401, { error: "unauthorized" });

      if (request.method === "GET" && url.pathname === "/v1/status") {
        return json(response, 200, store.status());
      }
      if (request.method === "GET" && url.pathname === "/v1/sync/outbox") {
        const limit = Number(url.searchParams.get("limit") || "100");
        return json(response, 200, { items: store.listPending(limit) });
      }
      if (request.method === "POST" && url.pathname === "/v1/sync/enqueue") {
        return json(response, 200, store.enqueue(await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/v1/sync/apply") {
        return json(response, 200, store.applyRemote(await readJson(request)));
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/sync/conflicts/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/sync/conflicts/".length));
        const body = await readJson(request) as Record<string, unknown>;
        const resolution = body.resolution;
        if (resolution !== "accept_remote" && resolution !== "keep_local") {
          throw new HttpError(400, "resolution_invalid");
        }
        const institutionId = String(body.institution_id || "").trim();
        if (!institutionId) throw new HttpError(400, "institution_id_required");
        const resolvedBy = String(body.resolved_by || "local_admin").trim();
        return json(
          response,
          200,
          store.resolveConflict(institutionId, id, resolution, resolvedBy),
        );
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const message = error instanceof Error ? error.message : "relay_request_failed";
      return json(response, status, { error: message });
    }
  });
  let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  if (config.teacherAttendanceWritesEnabled === true) {
    maintainTeacherAttendanceSessions(store.db, options.now?.() ?? new Date());
    maintenanceTimer = setInterval(() => {
      try {
        maintainTeacherAttendanceSessions(store.db, options.now?.() ?? new Date());
      } catch {
        // La requête suivante réessaiera ; aucun secret ni détail SQLite n'est journalisé.
      }
    }, SESSION_MAINTENANCE_INTERVAL_MS);
    maintenanceTimer.unref();
  }
  server.once("close", () => {
    if (maintenanceTimer) clearInterval(maintenanceTimer);
  });
  return server;
}

function normalizedInstitutionCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

type ConnectivityScheduleStatus = "matched" | "period_missing" | "period_mismatch";

type RelayPeriodSummary = {
  id: string;
  weekday: number;
  label: string | null;
  start_time: string;
  end_time: string;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeConnectivityWeekday(value: unknown) {
  const day = Number(value);
  if (!Number.isInteger(day)) return null;
  if (day === 0) return 7;
  return day >= 1 && day <= 7 ? day : null;
}

function normalizeConnectivityTime(value: unknown) {
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function teacherScheduleCompatibility(
  store: RelayStore,
  institutionId: string,
  rawBody: unknown,
): {
  schedule_status?: ConnectivityScheduleStatus;
  relay_period?: RelayPeriodSummary | null;
} {
  const body = recordValue(rawBody);
  const expected = recordValue(body.expected_period);
  const periodId = String(expected.id || "").trim();
  if (!periodId) return {};

  const relayPeriod = store.db.prepare(`
    SELECT id, weekday, label, start_time, end_time
    FROM institution_periods
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(institutionId, periodId) as RelayPeriodSummary | undefined;

  if (!relayPeriod) {
    return { schedule_status: "period_missing", relay_period: null };
  }

  const normalizedRelay: RelayPeriodSummary = {
    id: String(relayPeriod.id),
    weekday: normalizeConnectivityWeekday(relayPeriod.weekday) || Number(relayPeriod.weekday),
    label: relayPeriod.label == null ? null : String(relayPeriod.label),
    start_time: normalizeConnectivityTime(relayPeriod.start_time) || String(relayPeriod.start_time),
    end_time: normalizeConnectivityTime(relayPeriod.end_time) || String(relayPeriod.end_time),
  };
  const expectedWeekday = normalizeConnectivityWeekday(expected.weekday);
  const expectedStart = normalizeConnectivityTime(expected.start_time);
  const expectedEnd = normalizeConnectivityTime(expected.end_time);
  const matches =
    (expectedWeekday == null || normalizedRelay.weekday === expectedWeekday) &&
    (expectedStart == null || normalizedRelay.start_time === expectedStart) &&
    (expectedEnd == null || normalizedRelay.end_time === expectedEnd);

  return {
    schedule_status: matches ? "matched" : "period_mismatch",
    relay_period: normalizedRelay,
  };
}

function configuredInstitutionAllows(
  config: RelayConfig,
  store: RelayStore,
  institutionId: string,
) {
  const allowedCodes = new Set(
    [
      ...(config.institutionCodes || []),
      ...(config.institutions || []).map((institution) => institution.code),
      config.institutionCode,
    ]
      .map(normalizedInstitutionCode)
      .filter(Boolean),
  );
  if (allowedCodes.size === 0) return true;
  const institution = store.db.prepare(`
    SELECT code FROM institutions WHERE id = ? AND deleted_at IS NULL
  `).get(institutionId) as { code: string | null } | undefined;
  return Boolean(institution && allowedCodes.has(normalizedInstitutionCode(institution.code)));
}

function assertBootstrapMatchesConfiguredInstitution(raw: unknown, config: RelayConfig) {
  const expectedCodes = new Set(
    [...(config.institutionCodes || []), config.institutionCode]
      .map(normalizedInstitutionCode)
      .filter(Boolean),
  );
  const snapshot = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const institution = snapshot.institution && typeof snapshot.institution === "object" &&
      !Array.isArray(snapshot.institution)
    ? snapshot.institution as Record<string, unknown>
    : {};
  const suppliedCode = normalizedInstitutionCode(
    institution.code_unique || institution.code || institution.acronym,
  );
  if (!suppliedCode) throw new HttpError(409, "bootstrap_institution_code_missing");
  if (expectedCodes.size > 0 && !expectedCodes.has(suppliedCode)) {
    throw new HttpError(409, "bootstrap_institution_code_mismatch");
  }
  return suppliedCode;
}

function authorizedForInstitutionCode(
  request: IncomingMessage,
  config: RelayConfig,
  institutionCode: string,
) {
  const configured = (config.institutions || []).find(
    (item) => normalizedInstitutionCode(item.code) === normalizedInstitutionCode(institutionCode),
  );
  const schoolToken = String(configured?.admin_token || "").trim();
  if (schoolToken) return authorized(request, schoolToken);
  if ((config.institutions?.length || 0) > 1) return false;
  return authorized(request, config.token);
}

function authorizedForInstitutionId(
  request: IncomingMessage,
  config: RelayConfig,
  store: RelayStore,
  institutionId: string,
) {
  const institution = store.db.prepare(`
    SELECT code FROM institutions WHERE id = ? AND deleted_at IS NULL
  `).get(institutionId) as { code: string | null } | undefined;
  if (!institution) return false;
  return authorizedForInstitutionCode(request, config, String(institution.code || ""));
}

function requiredParam(url: URL, name: string) {
  const value = String(url.searchParams.get(name) || "").trim();
  if (!value) throw new HttpError(400, `${name}_required`);
  return value;
}

function authorized(request: IncomingMessage, token: string | null) {
  if (!token) return true;
  const authorization = String(request.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const expectedHash = createHash("sha256").update(token).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

function teacherBearerToken(request: IncomingMessage) {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const supplied = authorization.slice(7).trim();
  return supplied && supplied.length <= 4096 ? supplied : null;
}

async function readJson(
  request: IncomingMessage,
  maxBodyBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBodyBytes) throw new HttpError(413, "request_body_too_large");
    chunks.push(bytes);
  }
  if (chunks.length === 0) throw new HttpError(400, "request_body_required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function applyCors(request: IncomingMessage, response: ServerResponse, config: RelayConfig) {
  const origin = String(request.headers.origin || "").trim();
  if (!origin) return;
  const defaults = [
    "https://mon-cahier.com",
    "https://www.mon-cahier.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://tauri.localhost",
    "tauri://localhost",
  ];
  const allowed = new Set(config.allowedOrigins?.length ? config.allowedOrigins : defaults);
  if (!allowed.has(origin)) return;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept");
  response.setHeader("Access-Control-Max-Age", "600");
  if (String(request.headers["access-control-request-private-network"] || "") === "true") {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

function secureHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
