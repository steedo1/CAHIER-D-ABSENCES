// src/app/api/admin/notifications/grades-digest/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { shouldSendSmsForInstitutionEvent } from "@/lib/sms/policy";
import { enqueueNotesDigestSms } from "@/lib/sms/queue-notes-digest";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device"
  | string;

type SmsDigestMode = "manual" | "weekly" | "disabled";

type Ctx =
  | {
      ok: true;
      srv: ReturnType<typeof getSupabaseServiceClient>;
      userId: string;
      profileId: string;
      institutionId: string;
      roles: Set<Role>;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

type OfficialScoreRow = {
  id: string;
  evaluation_id: string;
  class_id: string;
  student_id: string;
  subject_id: string | null;
  score: number | null;
  scale: number | null;
  published_at: string | null;
};

type DigestGroup = {
  studentId: string;
  classId: string;
  officialScoreIds: string[];
  evaluationIds: string[];
  itemKeys: Set<string>;
  items: Array<{
    subject: string;
    score: number;
    scale: number;
  }>;
};

type StartBatchResult = {
  ok?: boolean;
  allowed?: boolean;
  blocked?: boolean;
  batch_id?: string | null;
  reason?: string | null;
  message?: string | null;
  last_sent_at?: string | null;
  next_allowed_at?: string | null;
  monthly_count?: number | null;
  monthly_limit?: number | null;
  min_interval_days?: number | null;
};

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function isPrivileged(roles: Set<Role>) {
  return roles.has("super_admin") || roles.has("admin");
}

function isMissingRelationError(err: any) {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  return code === "42P01" || msg.includes("does not exist");
}

function toIsoOrNull(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

function toStringOrNull(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      timeZone: "Africa/Abidjan",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return iso;
  }
}

function buildPeriodLabel(startIso: string, endIso: string) {
  return `Semaine ${formatDateShort(startIso)}-${formatDateShort(endIso)}`;
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeUuid(value: unknown) {
  const v = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

function looksLikeStudentCode(value: unknown) {
  const v = cleanText(value);
  if (!v) return false;
  if (v.includes(" ")) return false;
  if (looksLikeUuid(v)) return true;

  return (
    /^\d{4,}[A-Za-z0-9-]*$/.test(v) ||
    /^[A-Z]{1,6}\d{2,}[A-Z0-9-]*$/i.test(v)
  );
}

function safeHumanName(value: unknown) {
  const v = cleanText(value);
  if (!v) return "";
  if (looksLikeStudentCode(v)) return "";
  return v;
}

function pickStudentName(row: any, fallback = "Eleve") {
  const combinedLastFirst = safeHumanName(
    [row?.last_name, row?.first_name]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(" ")
  );

  const full = safeHumanName(row?.full_name || row?.display_name);

  return combinedLastFirst || full || fallback || "Eleve";
}

function pickClassLabel(row: any, fallback: string) {
  return String(row?.label || "").trim() || fallback;
}

function pickSubjectLabel(row: any, fallback = "Note") {
  return (
    cleanText(row?.custom_name) ||
    cleanText(row?.name) ||
    cleanText(row?.label) ||
    cleanText(row?.title) ||
    fallback
  );
}

function toFiniteNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function registerSubjectLabel(
  map: Map<string, string>,
  resolved: Set<string>,
  key: unknown,
  label: unknown
) {
  const cleanKey = cleanText(key);
  const cleanLabel = cleanText(label);

  if (!cleanKey || !cleanLabel) return;

  map.set(cleanKey, cleanLabel);
  resolved.add(cleanKey);
}

function extractRelatedSubject(row: any) {
  const related = row?.subjects;

  if (Array.isArray(related)) {
    return related[0] || null;
  }

  return related || null;
}

async function getContext(): Promise<Ctx> {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user?.id) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const { data: profile, error: profErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr) {
    console.error(
      "[admin/notifications/grades-digest/send] profile error",
      profErr
    );
    return { ok: false, status: 401, error: "profile_error" };
  }

  if (!profile?.id || !profile?.institution_id) {
    return { ok: false, status: 403, error: "no_institution" };
  }

  const srv = getSupabaseServiceClient();

  const roles = new Set<Role>();

  const { data: roleRows, error: rolesErr } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rolesErr) {
    console.error(
      "[admin/notifications/grades-digest/send] user_roles error",
      rolesErr
    );
  } else if (Array.isArray(roleRows)) {
    for (const r of roleRows) {
      roles.add(String((r as any).role) as Role);
    }
  }

  return {
    ok: true,
    srv,
    userId: user.id,
    profileId: profile.id,
    institutionId: profile.institution_id,
    roles,
  };
}

async function getSmsDigestMode(
  _srv: ReturnType<typeof getSupabaseServiceClient>,
  _institutionId: string
): Promise<SmsDigestMode> {
  /*
   * Mode stabilisé :
   * - plus de dépendance à public.grade_publication_settings ;
   * - plus de mode automatique SMS ;
   * - SMS digest uniquement en manuel contrôlé.
   */
  return "manual";
}

async function startControlledBatch(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  input: {
    institutionId: string;
    profileId: string;
    triggerType: "manual" | "auto";
    metadata?: Record<string, unknown>;
  }
): Promise<StartBatchResult> {
  const { data, error } = await srv.rpc("start_grade_sms_digest_batch", {
    p_institution_id: input.institutionId,
    p_trigger_type: input.triggerType,
    p_created_by: input.profileId,
    p_min_interval_days: 7,
    p_monthly_limit: 4,
    p_metadata: input.metadata || {},
  });

  if (error) {
    throw new Error(
      error.message || "Impossible de créer le lot SMS digest contrôlé."
    );
  }

  return (data || {}) as StartBatchResult;
}

async function markControlledBatchSent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  input: {
    batchId: string | null;
    totalParents: number;
    totalStudents: number;
    totalGrades: number;
    totalSms: number;
    metadata?: Record<string, unknown>;
  }
) {
  if (!input.batchId) return null;

  const { data, error } = await srv.rpc("mark_grade_sms_digest_batch_sent", {
    p_batch_id: input.batchId,
    p_total_parents: input.totalParents,
    p_total_students: input.totalStudents,
    p_total_grades: input.totalGrades,
    p_total_sms: input.totalSms,
    p_metadata: input.metadata || {},
  });

  if (error) {
    console.warn("[admin/notifications/grades-digest/send] mark batch sent error", {
      batchId: input.batchId,
      error: error.message,
    });
    return null;
  }

  return data;
}

async function markControlledBatchFailed(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  batchId: string | null,
  reason: string,
  metadata?: Record<string, unknown>
) {
  if (!batchId) return null;

  const { data, error } = await srv.rpc("mark_grade_sms_digest_batch_failed", {
    p_batch_id: batchId,
    p_reason: reason,
    p_metadata: metadata || {},
  });

  if (error) {
    console.warn("[admin/notifications/grades-digest/send] mark batch failed error", {
      batchId,
      reason,
      error: error.message,
    });
    return null;
  }

  return data;
}

async function getLastCompletedRun(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { data, error } = await srv
    .from("grade_sms_digest_runs")
    .select("id, period_start, period_end, created_at")
    .eq("institution_id", institutionId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  return data ?? null;
}

async function findExistingCompletedRun(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  periodStart: string,
  periodEnd: string
) {
  const { data, error } = await srv
    .from("grade_sms_digest_runs")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .eq("status", "completed")
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  return data ?? null;
}

async function createRun(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  input: {
    institutionId: string;
    triggeredBy: string;
    periodStart: string;
    periodEnd: string;
  }
): Promise<string | null> {
  const { data, error } = await srv
    .from("grade_sms_digest_runs")
    .insert({
      institution_id: input.institutionId,
      triggered_by: input.triggeredBy,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      status: "running",
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  return String(data?.id || "") || null;
}

async function completeRun(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  runId: string | null,
  input: {
    studentsCount: number;
    notificationsCreated: number;
  }
) {
  if (!runId) return;

  const { error } = await srv
    .from("grade_sms_digest_runs")
    .update({
      status: "completed",
      students_count: input.studentsCount,
      notifications_created: input.notificationsCreated,
      completed_at: new Date().toISOString(),
      error_text: null,
    })
    .eq("id", runId);

  if (error && !isMissingRelationError(error)) {
    console.error(
      "[admin/notifications/grades-digest/send] completeRun error",
      error
    );
  }
}

async function failRun(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  runId: string | null,
  errorText: string
) {
  if (!runId) return;

  const { error } = await srv
    .from("grade_sms_digest_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_text: errorText,
    })
    .eq("id", runId);

  if (error && !isMissingRelationError(error)) {
    console.error(
      "[admin/notifications/grades-digest/send] failRun error",
      error
    );
  }
}

async function fetchInstitutionName(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { data, error } = await srv
    .from("institutions")
    .select("id,name")
    .eq("id", institutionId)
    .maybeSingle();

  if (error) {
    console.warn(
      "[admin/notifications/grades-digest/send] institutions lookup error",
      error
    );
    return null;
  }

  return String((data as any)?.name || "").trim() || null;
}

async function fetchClassRows(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId?: string | null
) {
  if (classId) {
    const { data, error } = await srv
      .from("classes")
      .select("id,institution_id,label")
      .eq("id", classId)
      .maybeSingle();

    if (error) throw error;

    if (!data || (data as any).institution_id !== institutionId) {
      return [];
    }

    return [data];
  }

  const { data, error } = await srv
    .from("classes")
    .select("id,institution_id,label")
    .eq("institution_id", institutionId);

  if (error) throw error;

  return data ?? [];
}

async function fetchSubjectMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  subjectIds: string[]
) {
  const map = new Map<string, string>();
  const resolved = new Set<string>();

  const uniq = Array.from(new Set(subjectIds.filter(Boolean)));
  if (!uniq.length) return map;

  try {
    const instById = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects(name)")
      .eq("institution_id", institutionId)
      .in("id", uniq);

    if (!instById.error && Array.isArray(instById.data)) {
      for (const row of instById.data) {
        const anyRow = row as any;
        const related = extractRelatedSubject(anyRow);
        const label = cleanText(anyRow.custom_name) || pickSubjectLabel(related, "");

        registerSubjectLabel(map, resolved, anyRow.id, label);
        registerSubjectLabel(map, resolved, anyRow.subject_id, label);
      }
    } else if (instById.error) {
      console.warn(
        "[admin/notifications/grades-digest/send] institution_subjects by id warning",
        {
          error: instById.error.message,
          details: instById.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/notifications/grades-digest/send] institution_subjects by id exception",
      String(e?.message || e)
    );
  }

  try {
    const instBySubject = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects(name)")
      .eq("institution_id", institutionId)
      .in("subject_id", uniq);

    if (!instBySubject.error && Array.isArray(instBySubject.data)) {
      for (const row of instBySubject.data) {
        const anyRow = row as any;
        const related = extractRelatedSubject(anyRow);
        const label = cleanText(anyRow.custom_name) || pickSubjectLabel(related, "");

        registerSubjectLabel(map, resolved, anyRow.id, label);
        registerSubjectLabel(map, resolved, anyRow.subject_id, label);
      }
    } else if (instBySubject.error) {
      console.warn(
        "[admin/notifications/grades-digest/send] institution_subjects by subject_id warning",
        {
          error: instBySubject.error.message,
          details: instBySubject.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/notifications/grades-digest/send] institution_subjects by subject_id exception",
      String(e?.message || e)
    );
  }

  const leftoverIds = uniq.filter((id) => !resolved.has(id));

  if (leftoverIds.length) {
    const broad = await srv
      .from("subjects")
      .select("id,name,label,title")
      .in("id", leftoverIds);

    if (!broad.error && Array.isArray(broad.data)) {
      for (const row of broad.data) {
        registerSubjectLabel(
          map,
          resolved,
          (row as any).id,
          pickSubjectLabel(row, "")
        );
      }
    } else if (broad.error) {
      console.warn(
        "[admin/notifications/grades-digest/send] subjects lookup warning",
        broad.error
      );
    }
  }

  return map;
}

async function fetchStudentMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  studentIds: string[]
) {
  const map = new Map<string, string>();

  const uniq = Array.from(new Set(studentIds.filter(Boolean)));
  if (!uniq.length) return map;

  let rows: any[] = [];

  const broad = await srv
    .from("students")
    .select("id,first_name,last_name,full_name,display_name,matricule")
    .in("id", uniq);

  if (!broad.error) {
    rows = broad.data ?? [];
  } else {
    console.warn(
      "[admin/notifications/grades-digest/send] broad students lookup failed",
      broad.error
    );

    const narrow = await srv
      .from("students")
      .select("id,first_name,last_name,full_name,matricule")
      .in("id", uniq);

    if (!narrow.error) {
      rows = narrow.data ?? [];
    }
  }

  for (const row of rows) {
    map.set(String(row.id), pickStudentName(row, "Eleve"));
  }

  return map;
}

async function markOfficialScoresAsQueuedForSms(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  scoreIds: string[],
  runId: string | null
) {
  const uniq = Array.from(new Set(scoreIds.filter(Boolean)));

  if (!uniq.length) return;

  const patch: Record<string, any> = {
    sms_digest_queued_at: new Date().toISOString(),
  };

  if (runId) {
    patch.sms_digest_run_id = runId;
  }

  const { error } = await srv
    .from("grade_published_scores")
    .update(patch)
    .in("id", uniq);

  if (error) {
    console.warn(
      "[admin/notifications/grades-digest/send] markOfficialScoresAsQueuedForSms error",
      error
    );
  }
}

export async function POST(req: NextRequest) {
  let runId: string | null = null;
  let batchId: string | null = null;

  try {
    const ctx = await getContext();

    if (!ctx.ok) return bad(ctx.error, ctx.status);

    const { srv, profileId, institutionId, roles } = ctx;

    if (!isPrivileged(roles)) {
      return bad("FORBIDDEN", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      period_start?: string;
      period_end?: string;
      class_id?: string;
      period_label?: string;
      force?: boolean;
      trigger_type?: "manual" | "auto";
    };

    const triggerType: "manual" | "auto" =
      body.trigger_type === "auto" ? "auto" : "manual";

    const smsDigestMode = await getSmsDigestMode(srv, institutionId);

    if (smsDigestMode === "disabled") {
      return bad("SMS_DIGEST_DISABLED_IN_PUBLICATION_SETTINGS", 409, {
        sms_digest_mode: smsDigestMode,
      });
    }

    if (triggerType === "auto") {
      return bad("SMS_DIGEST_AUTO_MODE_REMOVED", 409, {
        sms_digest_mode: smsDigestMode,
        message: "Le digest SMS des notes est uniquement en mode manuel contrôlé.",
      });
    }

    const { allowed, policy } = await shouldSendSmsForInstitutionEvent({
      srv,
      institutionId,
      event: "notes_digest",
    });

    if (!allowed) {
      return bad("SMS_NOTES_DIGEST_DISABLED", 409, {
        policy: {
          smsPremiumEnabled: !!policy?.smsPremiumEnabled,
          smsProvider: policy?.smsProvider ?? null,
          smsNotesDigestEnabled: !!policy?.smsNotesDigestEnabled,
        },
      });
    }

    const batchStart = await startControlledBatch(srv, {
      institutionId,
      profileId,
      triggerType,
      metadata: {
        source: "admin_notifications_grades_digest_send",
        requested_class_id: body.class_id || null,
        requested_period_start: body.period_start || null,
        requested_period_end: body.period_end || null,
        requested_force: body.force === true,
      },
    });

    batchId = toStringOrNull(batchStart.batch_id);

    if (!batchStart.allowed) {
      return bad(String(batchStart.reason || "SMS_DIGEST_BLOCKED"), 409, {
        blocked: true,
        batch_id: batchId,
        decision: batchStart,
      });
    }

    const nowIso = new Date().toISOString();
    const explicitStart = toIsoOrNull(body.period_start);
    const explicitEnd = toIsoOrNull(body.period_end);

    let periodStart = explicitStart;
    let periodEnd = explicitEnd || nowIso;

    if (!periodStart) {
      const lastRun = await getLastCompletedRun(srv, institutionId);

      periodStart =
        toIsoOrNull(batchStart.last_sent_at) ||
        String(lastRun?.period_end || "").trim() ||
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    if (!periodEnd) {
      periodEnd = nowIso;
    }

    if (new Date(periodStart).getTime() >= new Date(periodEnd).getTime()) {
      await markControlledBatchFailed(srv, batchId, "invalid_period", {
        period_start: periodStart,
        period_end: periodEnd,
      });

      return bad("INVALID_PERIOD", 400, {
        batch_id: batchId,
        period_start: periodStart,
        period_end: periodEnd,
      });
    }

    if ((explicitStart || explicitEnd) && !body.force) {
      const exists = await findExistingCompletedRun(
        srv,
        institutionId,
        periodStart,
        periodEnd
      );

      if (exists?.id) {
        await markControlledBatchFailed(srv, batchId, "digest_already_sent_for_period", {
          run_id: exists.id,
          period_start: periodStart,
          period_end: periodEnd,
        });

        return bad("DIGEST_ALREADY_SENT_FOR_PERIOD", 409, {
          batch_id: batchId,
          run_id: exists.id,
          period_start: periodStart,
          period_end: periodEnd,
        });
      }
    }

    runId = await createRun(srv, {
      institutionId,
      triggeredBy: profileId,
      periodStart,
      periodEnd,
    });

    const classRows = await fetchClassRows(
      srv,
      institutionId,
      body.class_id || null
    );

    const classIds = classRows.map((x: any) => String(x.id));

    if (!classIds.length) {
      await completeRun(srv, runId, {
        studentsCount: 0,
        notificationsCreated: 0,
      });

      await markControlledBatchFailed(srv, batchId, "no_classes", {
        run_id: runId,
        period_start: periodStart,
        period_end: periodEnd,
      });

      return NextResponse.json({
        ok: true,
        batch_id: batchId,
        run_id: runId,
        period_start: periodStart,
        period_end: periodEnd,
        students_count: 0,
        notifications_created: 0,
        reason: "NO_CLASSES",
      });
    }

    const classLabelById = new Map<string, string>();

    for (const row of classRows) {
      classLabelById.set(
        String((row as any).id),
        pickClassLabel(row, String((row as any).id))
      );
    }

    let officialQuery = srv
      .from("grade_published_scores")
      .select(
        [
          "id",
          "evaluation_id",
          "class_id",
          "student_id",
          "subject_id",
          "score",
          "scale",
          "published_at",
          "sms_digest_run_id",
          "sms_digest_queued_at",
        ].join(",")
      )
      .eq("institution_id", institutionId)
      .eq("is_current", true)
      .in("class_id", classIds)
      .gte("published_at", periodStart)
      .lt("published_at", periodEnd);

    if (!body.force) {
      officialQuery = officialQuery
        .is("sms_digest_run_id", null)
        .is("sms_digest_queued_at", null);
    }

    const { data: officialRowsRaw, error: officialErr } = await officialQuery;

    if (officialErr) {
      throw officialErr;
    }

    const officialRows: OfficialScoreRow[] = ((officialRowsRaw ?? []) as any[]).map(
      (row) => ({
        id: String(row.id),
        evaluation_id: String(row.evaluation_id),
        class_id: String(row.class_id),
        student_id: String(row.student_id),
        subject_id: row.subject_id ? String(row.subject_id) : null,
        score:
          row.score === null || row.score === undefined ? null : Number(row.score),
        scale:
          row.scale === null || row.scale === undefined ? 20 : Number(row.scale),
        published_at: row.published_at ? String(row.published_at) : null,
      })
    );

    if (!officialRows.length) {
      await completeRun(srv, runId, {
        studentsCount: 0,
        notificationsCreated: 0,
      });

      await markControlledBatchFailed(srv, batchId, "no_official_published_scores", {
        run_id: runId,
        period_start: periodStart,
        period_end: periodEnd,
      });

      return NextResponse.json({
        ok: true,
        batch_id: batchId,
        run_id: runId,
        period_start: periodStart,
        period_end: periodEnd,
        students_count: 0,
        notifications_created: 0,
        reason: "NO_OFFICIAL_PUBLISHED_SCORES",
      });
    }

    const subjectIds = officialRows
      .map((row) => row.subject_id)
      .filter((x): x is string => !!x);

    const subjectLabelById = await fetchSubjectMap(srv, institutionId, subjectIds);

    const grouped = new Map<string, DigestGroup>();

    for (const row of officialRows) {
      if (row.score === null || row.score === undefined) continue;

      const score = Number(row.score);
      if (!Number.isFinite(score)) continue;

      const scale = toFiniteNumber(row.scale, 20);
      const roundedScore = Math.round(score * 100) / 100;
      const subjectLabel = subjectLabelById.get(row.subject_id || "") || "Note";

      const key = `${row.student_id}::${row.class_id}`;
      const existing =
        grouped.get(key) ||
        ({
          studentId: row.student_id,
          classId: row.class_id,
          officialScoreIds: [],
          evaluationIds: [],
          itemKeys: new Set<string>(),
          items: [],
        } as DigestGroup);

      existing.officialScoreIds.push(row.id);
      existing.evaluationIds.push(row.evaluation_id);

      const itemKey = [
        row.evaluation_id,
        cleanText(subjectLabel).toLowerCase(),
        String(roundedScore),
        String(scale),
      ].join("::");

      if (!existing.itemKeys.has(itemKey)) {
        existing.itemKeys.add(itemKey);
        existing.items.push({
          subject: subjectLabel,
          score: roundedScore,
          scale,
        });
      }

      grouped.set(key, existing);
    }

    if (!grouped.size) {
      await completeRun(srv, runId, {
        studentsCount: 0,
        notificationsCreated: 0,
      });

      await markControlledBatchFailed(srv, batchId, "no_official_scores", {
        run_id: runId,
        period_start: periodStart,
        period_end: periodEnd,
      });

      return NextResponse.json({
        ok: true,
        batch_id: batchId,
        run_id: runId,
        period_start: periodStart,
        period_end: periodEnd,
        students_count: 0,
        notifications_created: 0,
        reason: "NO_OFFICIAL_SCORES",
      });
    }

    const studentIds = Array.from(
      new Set(Array.from(grouped.values()).map((g) => g.studentId))
    );

    const studentNameById = await fetchStudentMap(srv, studentIds);
    const institutionName = await fetchInstitutionName(srv, institutionId);

    const periodLabel =
      String(body.period_label || "").trim() ||
      buildPeriodLabel(periodStart, periodEnd);

    let notificationsCreated = 0;
    const queuedOfficialScoreIds: string[] = [];

    for (const group of grouped.values()) {
      const studentName = studentNameById.get(group.studentId) || "Eleve";
      const classLabel = classLabelById.get(group.classId) || group.classId;

      const officialScoreIds = Array.from(new Set(group.officialScoreIds));
      const evaluationIds = Array.from(new Set(group.evaluationIds));

      await enqueueNotesDigestSms({
        srv,
        req,
        institutionId,
        studentId: group.studentId,
        studentName,
        classId: group.classId,
        classLabel,
        institutionName,
        periodLabel,
        average: null,
        items: group.items,
        profileId: null,
        parentId: null,
        dispatch: false,

        source: "grade_published_scores",
        digestRunId: runId,
        officialScoreIds,
        evaluationIds,
        smsDigestBatchId: batchId,
      } as any);

      notificationsCreated += 1;
      queuedOfficialScoreIds.push(...officialScoreIds);
    }

    await markOfficialScoresAsQueuedForSms(srv, queuedOfficialScoreIds, runId);

    let dispatchOk = false;

    if (notificationsCreated > 0) {
      dispatchOk = await triggerSmsDispatch({
        req,
        reason: "notes_digest",
        timeoutMs: 8000,
        retries: 2,
      });
    }

    await completeRun(srv, runId, {
      studentsCount: grouped.size,
      notificationsCreated,
    });

    await markControlledBatchSent(srv, {
      batchId,
      totalParents: notificationsCreated,
      totalStudents: grouped.size,
      totalGrades: Array.from(new Set(queuedOfficialScoreIds)).length,
      totalSms: notificationsCreated,
      metadata: {
        run_id: runId,
        dispatch_ok: dispatchOk,
        period_start: periodStart,
        period_end: periodEnd,
        period_label: periodLabel,
        source: "grade_published_scores",
      },
    });

    return NextResponse.json({
      ok: true,
      batch_id: batchId,
      run_id: runId,
      period_start: periodStart,
      period_end: periodEnd,
      students_count: grouped.size,
      notifications_created: notificationsCreated,
      official_scores_count: Array.from(new Set(queuedOfficialScoreIds)).length,
      evaluations_count: new Set(
        Array.from(grouped.values()).flatMap((g) => g.evaluationIds)
      ).size,
      dispatch_ok: dispatchOk,
      source: "grade_published_scores",
      rule: {
        min_interval_days: 7,
        monthly_limit: 4,
        force_does_not_bypass_frequency_lock: true,
      },
    });
  } catch (e: any) {
    console.error("[admin/notifications/grades-digest/send] unexpected error", e);

    const srv = getSupabaseServiceClient();

    await failRun(srv, runId, String(e?.message || "INTERNAL_ERROR"));

    await markControlledBatchFailed(
      srv,
      batchId,
      "unexpected_error",
      {
        run_id: runId,
        error: String(e?.message || "INTERNAL_ERROR"),
      }
    );

    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}