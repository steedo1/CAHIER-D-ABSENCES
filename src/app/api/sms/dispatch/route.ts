// src/app/api/sms/dispatch/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { sendOrangeSms } from "@/lib/sms/orange";
import { buildSmsMessageFromQueue } from "@/lib/sms/messages";
import {
  getInstitutionSmsPolicy,
  resolveSmsProvider,
  resolveSmsSenderName,
  shouldSendSmsForEvent,
  type InstitutionSmsPolicy,
  type SmsEventKind,
} from "@/lib/sms/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers log ───────────────── */
function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function shortId(x: string | null | undefined, n = 8) {
  const s = String(x || "");
  if (s.length <= n) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function safeParse<T = any>(x: any): T | null {
  if (!x) return null;
  if (typeof x === "object") return x as T;
  try {
    return JSON.parse(String(x)) as T;
  } catch {
    return null;
  }
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function previewText(value: unknown, max = 200) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildMergedMeta(existingMeta: any, patch: Record<string, any>) {
  const base = safeParse<Record<string, any>>(existingMeta);
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );

  return {
    ...(base && typeof base === "object" ? base : {}),
    ...cleanPatch,
  };
}

function extractOrangeResourceId(resourceURL: string | null | undefined) {
  const url = String(resourceURL || "").trim();
  if (!url) return null;

  const marker = "/requests/";
  const idx = url.lastIndexOf(marker);
  if (idx < 0) return null;

  const after = url.slice(idx + marker.length).trim();
  if (!after) return null;

  const clean = after.split("?")[0].split("#")[0].trim();
  return clean || null;
}

function extractOrangeDebug(result: any) {
  const response = result?.response ?? null;
  const outbound =
    response?.outboundSMSMessageRequest ??
    response ??
    null;

  const locationHeader =
    typeof result?.locationHeader === "string"
      ? result.locationHeader
      : null;

  const resourceURL =
    typeof result?.resourceURL === "string"
      ? result.resourceURL
      : typeof outbound?.resourceURL === "string"
        ? outbound.resourceURL
        : typeof outbound?.resourceUrl === "string"
          ? outbound.resourceUrl
          : locationHeader;

  const resourceId =
    typeof result?.resourceId === "string" && result.resourceId
      ? result.resourceId
      : extractOrangeResourceId(resourceURL);

  return {
    provider: result?.provider || "orange_ci",
    to: result?.to || null,
    senderAddress: result?.senderAddress || null,
    senderName: result?.senderName || null,
    resourceURL,
    resourceId,
    response,
    httpStatus:
      typeof result?.httpStatus === "number" ? result.httpStatus : null,
    locationHeader,
    requestId:
      typeof result?.requestId === "string" ? result.requestId : null,
  };
}

const WAIT_STATUS = (
  process.env.SMS_WAIT_STATUS ||
  process.env.PUSH_WAIT_STATUS ||
  "pending"
).trim();

const MAX_ATTEMPTS = Number(process.env.SMS_MAX_ATTEMPTS || 5);

const PROVIDER_ACCEPTED_STATUS = (
  process.env.SMS_PROVIDER_ACCEPTED_STATUS || "accepted_by_orange"
).trim();

const PROVIDER_ACCEPTED_PARTIAL_STATUS = (
  process.env.SMS_PROVIDER_ACCEPTED_PARTIAL_STATUS ||
  "accepted_by_orange_partial"
).trim();

/* ───────────────── Auth ───────────────── */
function okAuth(req: Request) {
  const secret = (
    process.env.CRON_SECRET ||
    process.env.CRON_PUSH_SECRET ||
    ""
  ).trim();

  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");

  const allowed =
    fromVercelCron ||
    (!!secret && (xCron === secret || bearer === secret));

  console.info("[sms/dispatch] auth", {
    fromVercelCron,
    xCronPresent: !!xCron,
    bearerPresent: !!bearer,
    secretPresent: !!secret,
    allowed,
  });

  return allowed;
}

/* ───────────────── Types ───────────────── */
type QueueRow = {
  id: string;
  institution_id: string | null;
  parent_id: string | null;
  student_id: string | null;
  profile_id: string | null;
  channels: any;
  payload: any;
  title: string | null;
  body: string | null;
  status: string;
  attempts: number | null;
  created_at: string;
  meta: any | null;
};

type ParentDeviceRow = {
  device_id: string;
  parent_profile_id: string | null;
};

type StudentGuardianRow = {
  student_id: string;
  parent_id: string | null;
  notifications_enabled: boolean | null;
};

type ContactRow = {
  id: string;
  profile_id: string;
  institution_id: string | null;
  phone_e164: string;
  sms_enabled: boolean;
  is_primary: boolean;
  verified_at: string | null;
  created_at: string;
};

/* ───────────────── Channels ───────────────── */
function hasSmsChannel(row: QueueRow) {
  try {
    const raw = row.channels;
    const arr = Array.isArray(raw) ? raw : raw ? JSON.parse(String(raw)) : [];
    const ok = Array.isArray(arr) && arr.includes("sms");

    if (!ok) {
      console.debug("[sms/dispatch] skip_no_sms_channel", {
        id: row.id,
        channels: raw,
      });
    }

    return ok;
  } catch (e: any) {
    console.warn("[sms/dispatch] channels_parse_error", {
      id: row.id,
      error: String(e?.message || e),
    });
    return false;
  }
}

/* ───────────────── Event resolution ───────────────── */
function resolveSmsEventFromPayload(payload: any): SmsEventKind | null {
  const kind = s(payload?.kind).toLowerCase();
  const event = s(payload?.event).toLowerCase();

  if (kind === "attendance") {
    if (event === "absent") return "absent";
    if (event === "late") return "late";

    if (event === "fix") {
      const minutesLate = Number(payload?.minutes_late || 0);
      return minutesLate > 0 ? "late" : "absent";
    }
  }

  if (kind === "grades_digest" || kind === "notes_digest") {
    return "notes_digest";
  }

  return null;
}

function isTerminalErrorCode(msg: string) {
  const code = s(msg).toLowerCase();
  return [
    "missing_institution_id",
    "unsupported_sms_event",
    "sms_premium_disabled",
    "sms_disabled_for_event",
    "unsupported_sms_provider",
    "no_target_profiles",
    "no_sms_contact",
  ].includes(code);
}

/* ───────────────── Target resolution ───────────────── */
async function resolveTargetProfilesByRow(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  rows: QueueRow[]
): Promise<Map<string, string[]>> {
  const noDirectRows = rows.filter((r) => !r.parent_id && !r.profile_id);

  const deviceIds = Array.from(
    new Set(
      noDirectRows
        .map((r) => (safeParse<any>(r.meta) || {}).device_id as string | undefined)
        .filter(Boolean)
    )
  );

  const studentIds = Array.from(
    new Set(noDirectRows.map((r) => r.student_id).filter(Boolean))
  ) as string[];

  const deviceToParent = new Map<string, string>();

  if (deviceIds.length) {
    const { data: mapDev, error: mapErr } = await srv
      .from("parent_devices")
      .select("device_id,parent_profile_id")
      .in("device_id", deviceIds);

    if (mapErr) {
      console.warn("[sms/dispatch] parent_devices_err", {
        error: mapErr.message,
      });
    } else {
      for (const row of (mapDev || []) as ParentDeviceRow[]) {
        if (row.device_id && row.parent_profile_id) {
          deviceToParent.set(String(row.device_id), String(row.parent_profile_id));
        }
      }
    }
  }

  const studToParents = new Map<string, string[]>();

  if (studentIds.length) {
    const { data: sgs, error: sgErr } = await srv
      .from("student_guardians")
      .select("student_id,parent_id,notifications_enabled")
      .in("student_id", studentIds);

    if (sgErr) {
      console.warn("[sms/dispatch] student_guardians_err", {
        error: sgErr.message,
      });
    } else {
      for (const row of (sgs || []) as StudentGuardianRow[]) {
        if (row.notifications_enabled === false) continue;

        const sid = String(row.student_id || "");
        const pid = String(row.parent_id || "");

        if (!sid || !pid) continue;

        const arr = studToParents.get(sid) || [];
        arr.push(pid);
        studToParents.set(sid, Array.from(new Set(arr)));
      }
    }
  }

  const out = new Map<string, string[]>();

  for (const r of rows) {
    let ids: string[] = [];

    if (r.profile_id) ids.push(String(r.profile_id));
    if (r.parent_id) ids.push(String(r.parent_id));

    if (!r.parent_id && !r.profile_id) {
      const dev = (safeParse<any>(r.meta) || {}).device_id as string | undefined;
      if (dev && deviceToParent.has(dev)) {
        ids.push(deviceToParent.get(dev)!);
      }
    }

    if (!r.profile_id && r.student_id && studToParents.has(r.student_id)) {
      ids.push(...(studToParents.get(r.student_id) || []));
    }

    ids = Array.from(new Set(ids.filter(Boolean)));
    out.set(r.id, ids);
  }

  return out;
}

/* ───────────────── Contacts ───────────────── */
async function fetchSmsContactsByProfile(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileIds: string[]
): Promise<Map<string, ContactRow[]>> {
  const out = new Map<string, ContactRow[]>();

  if (!profileIds.length) return out;

  const { data, error } = await srv
    .from("parent_notification_contacts")
    .select(
      "id,profile_id,institution_id,phone_e164,sms_enabled,is_primary,verified_at,created_at"
    )
    .in("profile_id", profileIds)
    .eq("sms_enabled", true);

  if (error) {
    throw new Error(`Chargement contacts SMS impossible: ${error.message}`);
  }

  const rows = (data || []) as ContactRow[];

  for (const row of rows) {
    const key = String(row.profile_id);
    const arr = out.get(key) || [];
    arr.push(row);
    out.set(key, arr);
  }

  for (const [profileId, arr] of out.entries()) {
    arr.sort((a, b) => {
      const primaryDelta = Number(b.is_primary) - Number(a.is_primary);
      if (primaryDelta !== 0) return primaryDelta;

      const verifiedDelta = Number(!!b.verified_at) - Number(!!a.verified_at);
      if (verifiedDelta !== 0) return verifiedDelta;

      return String(a.created_at).localeCompare(String(b.created_at));
    });

    out.set(profileId, arr);
  }

  return out;
}

function pickBestContactForInstitution(
  contacts: ContactRow[],
  institutionId: string | null | undefined
): ContactRow | null {
  if (!contacts.length) return null;

  const instId = s(institutionId);
  if (!instId) return contacts[0] || null;

  const exact = contacts.filter((c) => s(c.institution_id) === instId);
  if (exact.length) return exact[0] || null;

  const global = contacts.filter((c) => !s(c.institution_id));
  if (global.length) return global[0] || null;

  return contacts[0] || null;
}

/* ───────────────── Main ───────────────── */
export const GET = run;
export const POST = run;

async function run(req: Request) {
  const id = rid();
  const t0 = Date.now();

  console.info("[sms/dispatch] start", {
    id,
    when: new Date().toISOString(),
    method: req.method,
    waitStatus: WAIT_STATUS,
    providerAcceptedStatus: PROVIDER_ACCEPTED_STATUS,
    providerAcceptedPartialStatus: PROVIDER_ACCEPTED_PARTIAL_STATUS,
  });

  if (!okAuth(req)) {
    console.warn("[sms/dispatch] forbidden", { id });
    return NextResponse.json(
      { ok: false, error: "forbidden", id },
      { status: 403 }
    );
  }

  const srv = getSupabaseServiceClient();

  const { data: raw, error: pickErr } = await srv
    .from("notifications_queue")
    .select(
      "id,institution_id,parent_id,student_id,profile_id,channels,payload,title,body,status,attempts,created_at,meta"
    )
    .eq("status", WAIT_STATUS)
    .order("created_at", { ascending: true })
    .limit(400);

  if (pickErr) {
    console.error("[sms/dispatch] select_error", {
      id,
      error: pickErr.message,
    });

    return NextResponse.json(
      { ok: false, error: pickErr.message, stage: "select", id },
      { status: 200 }
    );
  }

  const rows: QueueRow[] = (raw || []).filter(hasSmsChannel);

  console.info("[sms/dispatch] picked_effective", {
    id,
    total: rows.length,
    sample: rows.slice(0, 3).map((r) => {
      const p = safeParse<any>(r.payload) || {};
      return {
        id: r.id,
        institution_id: r.institution_id,
        parent: shortId(r.parent_id),
        profile: shortId(r.profile_id),
        student: shortId(r.student_id),
        typ: p?.kind || p?.type || p?.event || "notification",
      };
    }),
  });

  if (!rows.length) {
    const ms = Date.now() - t0;
    console.info("[sms/dispatch] done_empty", { id, ms });

    return NextResponse.json({
      ok: true,
      id,
      attempted: 0,
      accepted_sms_sends: 0,
      sent_sms_sends: 0,
      failed: 0,
      ms,
    });
  }

  const targetProfilesByRow = await resolveTargetProfilesByRow(srv, rows);

  const allProfileIds = Array.from(
    new Set(Array.from(targetProfilesByRow.values()).flatMap((x) => x))
  );

  let contactsByProfile = new Map<string, ContactRow[]>();

  try {
    contactsByProfile = await fetchSmsContactsByProfile(srv, allProfileIds);
  } catch (e: any) {
    console.error("[sms/dispatch] contacts_load_error", {
      id,
      error: String(e?.message || e),
    });

    return NextResponse.json(
      { ok: false, error: String(e?.message || e), stage: "contacts", id },
      { status: 200 }
    );
  }

  const policyCache = new Map<string, InstitutionSmsPolicy>();

  async function getPolicyCached(institutionId: string) {
    if (policyCache.has(institutionId)) {
      return policyCache.get(institutionId)!;
    }
    const policy = await getInstitutionSmsPolicy(srv, institutionId);
    policyCache.set(institutionId, policy);
    return policy;
  }

  let acceptedSmsSends = 0;
  let failed = 0;
  const usedContactIds = new Set<string>();

  for (const n of rows) {
    const nowIso = new Date().toISOString();
    const core = safeParse<any>(n.payload) || {};
    const institutionId = s(n.institution_id);
    const targetProfiles = targetProfilesByRow.get(n.id) || [];
    const attempts = (Number(n.attempts) || 0) + 1;

    let successes = 0;
    let lastError = "";
    let provider: string | null = null;
    let smsEvent: SmsEventKind | null = null;
    let senderName: string | null = null;
    let message = "";

    const successTargets: any[] = [];
    const failedTargets: any[] = [];

    if (!institutionId) {
      lastError = "missing_institution_id";
      console.warn("[sms/dispatch] row_skip_missing_institution", {
        id,
        qid: n.id,
      });
    } else {
      try {
        const policy = await getPolicyCached(institutionId);
        provider = resolveSmsProvider(policy);
        smsEvent = resolveSmsEventFromPayload(core);
        senderName = resolveSmsSenderName(policy);

        console.info("[sms/dispatch] policy_check", {
          id,
          qid: n.id,
          institution_id: institutionId,
          smsEvent,
          provider,
          smsPremiumEnabled: policy.smsPremiumEnabled,
          smsAbsenceEnabled: policy.smsAbsenceEnabled,
          smsLateEnabled: policy.smsLateEnabled,
          smsNotesDigestEnabled: policy.smsNotesDigestEnabled,
          smsSenderName: senderName,
        });

        if (!policy.smsPremiumEnabled) {
          lastError = "sms_premium_disabled";
        } else if (!smsEvent) {
          lastError = "unsupported_sms_event";
        } else if (!shouldSendSmsForEvent(policy, smsEvent)) {
          lastError = "sms_disabled_for_event";
        } else if (provider !== "orange_ci") {
          lastError = "unsupported_sms_provider";
        } else if (!targetProfiles.length) {
          lastError = "no_target_profiles";
        } else {
          message = buildSmsMessageFromQueue({
            title: n.title,
            body: n.body,
            payload: core,
            appName: "Mon Cahier",
            institutionName: undefined,
          });

          console.info("[sms/dispatch] row_ready", {
            id,
            qid: n.id,
            institution_id: institutionId,
            event: smsEvent,
            provider,
            senderName,
            attempts,
            target_profiles_count: targetProfiles.length,
            message_length: message.length,
            message_preview: previewText(message, 180),
          });

          if (message.length > 160) {
            console.warn("[sms/dispatch] row_message_length_warning", {
              id,
              qid: n.id,
              event: smsEvent,
              message_length: message.length,
              note:
                "Le message dépasse 160 caractères. Cela peut compliquer la livraison ou segmenter le SMS selon le contrat/encodage.",
            });
          }

          for (const profileId of targetProfiles) {
            const contacts = contactsByProfile.get(profileId) || [];
            const best = pickBestContactForInstitution(contacts, institutionId);

            console.info("[sms/dispatch] target_resolution", {
              id,
              qid: n.id,
              profile: shortId(profileId),
              contacts_found: contacts.length,
              selected_contact: best ? shortId(best.id) : null,
              selected_phone: best ? shortId(best.phone_e164, 18) : null,
            });

            if (!best) {
              lastError = "no_sms_contact";
              failedTargets.push({
                profile_id: profileId,
                contact_id: null,
                phone_e164: null,
                error: lastError,
                at: new Date().toISOString(),
              });

              console.warn("[sms/dispatch] no_sms_contact_for_profile", {
                id,
                qid: n.id,
                profile: shortId(profileId),
                institution_id: institutionId,
              });

              continue;
            }

            try {
              const orangeResult = await sendOrangeSms({
                to: best.phone_e164,
                message,
                senderName: senderName || undefined,
              });

              usedContactIds.add(best.id);
              successes++;
              acceptedSmsSends++;

              const orangeDebug = extractOrangeDebug(orangeResult);
              const orangeResourceId =
                orangeDebug.resourceId ||
                extractOrangeResourceId(orangeDebug.resourceURL);
              const acceptedAtIso = new Date().toISOString();

              successTargets.push({
                profile_id: profileId,
                contact_id: best.id,
                phone_e164: best.phone_e164,
                at: acceptedAtIso,
                requested_sender_name: senderName || null,
                provider_sender_name: orangeDebug.senderName || null,
                orange: {
                  ...orangeDebug,
                  resourceId: orangeResourceId,
                },
              });

              if (orangeResourceId && orangeDebug.resourceURL) {
                const { error: outboxErr } = await srv
                  .from("orange_sms_outbox")
                  .upsert(
                    {
                      queue_id: n.id,
                      institution_id: institutionId || null,
                      profile_id: profileId,
                      contact_id: best.id,
                      phone_e164: best.phone_e164,
                      sender_address: orangeResult.senderAddress,
                      orange_resource_id: orangeResourceId,
                      orange_resource_url: orangeDebug.resourceURL,
                      provider_status: "accepted_by_orange",
                      accepted_at: acceptedAtIso,
                      raw_accept_payload: cloneJson({
                        response: orangeResult.response,
                        meta: {
                          httpStatus: orangeDebug.httpStatus,
                          locationHeader: orangeDebug.locationHeader,
                          requestId: orangeDebug.requestId,
                          requestedSenderName: senderName || null,
                          providerSenderName: orangeDebug.senderName || null,
                        },
                      }),
                      updated_at: acceptedAtIso,
                    } as any,
                    {
                      onConflict: "orange_resource_id",
                      ignoreDuplicates: false,
                    }
                  );

                if (outboxErr) {
                  console.error("[sms/dispatch] orange_outbox_upsert_fail", {
                    id,
                    qid: n.id,
                    profile: shortId(profileId),
                    contact: shortId(best.id),
                    resourceId: orangeResourceId,
                    requestId: orangeDebug.requestId,
                    error: outboxErr.message,
                  });
                } else {
                  console.info("[sms/dispatch] orange_outbox_upsert_ok", {
                    id,
                    qid: n.id,
                    profile: shortId(profileId),
                    contact: shortId(best.id),
                    resourceId: orangeResourceId,
                    requestId: orangeDebug.requestId,
                    requestedSenderName: senderName || null,
                    providerSenderName: orangeDebug.senderName || null,
                    providerSenderAddress: orangeResult.senderAddress,
                  });
                }
              } else {
                console.warn("[sms/dispatch] orange_accept_missing_resource_trace", {
                  id,
                  qid: n.id,
                  profile: shortId(profileId),
                  contact: shortId(best.id),
                  httpStatus: orangeDebug.httpStatus,
                  requestId: orangeDebug.requestId,
                  resourceURL: orangeDebug.resourceURL,
                  resourceId: orangeResourceId,
                  locationHeader: orangeDebug.locationHeader,
                  requestedSenderName: senderName || null,
                  providerSenderName: orangeDebug.senderName || null,
                  providerSenderAddress: orangeDebug.senderAddress || null,
                });
              }

              const providerQueueStatus =
                failedTargets.length > 0
                  ? PROVIDER_ACCEPTED_PARTIAL_STATUS
                  : PROVIDER_ACCEPTED_STATUS;

              console.info("[sms/dispatch] sms_provider_accept_ok", {
                id,
                qid: n.id,
                profile: shortId(profileId),
                contact: shortId(best.id),
                to: shortId(best.phone_e164, 18),
                event: smsEvent,
                requestedSenderName: senderName || null,
                providerSenderName: orangeDebug.senderName || null,
                providerSenderAddress: orangeDebug.senderAddress || null,
                httpStatus: orangeDebug.httpStatus,
                requestId: orangeDebug.requestId,
                locationHeader: orangeDebug.locationHeader,
                resourceId: orangeResourceId,
                queueStatusWillBe: "sent",
                providerStatusWillBe: providerQueueStatus,
              });
            } catch (e: any) {
              lastError = String(e?.message || e);

              failedTargets.push({
                profile_id: profileId,
                contact_id: best.id,
                phone_e164: best.phone_e164,
                error: lastError,
                requested_sender_name: senderName || null,
                at: new Date().toISOString(),
              });

              console.warn("[sms/dispatch] sms_send_fail", {
                id,
                qid: n.id,
                profile: shortId(profileId),
                contact: shortId(best.id),
                to: shortId(best.phone_e164, 18),
                event: smsEvent,
                attempts,
                requestedSenderName: senderName || null,
                message_length: message.length,
                error: lastError.slice(0, 300),
              });
            }
          }
        }

        if (lastError && successes === 0) {
          console.warn("[sms/dispatch] row_policy_or_resolution_blocked", {
            id,
            qid: n.id,
            institution_id: institutionId,
            event: smsEvent,
            provider,
            requestedSenderName: senderName || null,
            target_profiles_count: targetProfiles.length,
            attempts,
            reason: lastError,
          });
        }
      } catch (e: any) {
        lastError = String(e?.message || e);

        console.error("[sms/dispatch] row_unhandled_error", {
          id,
          qid: n.id,
          institution_id: institutionId,
          attempts,
          error: lastError.slice(0, 400),
        });
      }
    }

    const latestAccepted =
      successTargets.length > 0 ? successTargets[successTargets.length - 1] : null;

    const latestOrange = latestAccepted?.orange || null;
    const partialFailure = successes > 0 && failedTargets.length > 0;

    const successQueueStatus = "sent";

    const providerQueueStatus = partialFailure
      ? PROVIDER_ACCEPTED_PARTIAL_STATUS
      : PROVIDER_ACCEPTED_STATUS;

    const failureQueueStatus =
      isTerminalErrorCode(lastError) || attempts >= MAX_ATTEMPTS
        ? "error"
        : WAIT_STATUS;

    const computedFinalStatus =
      successes > 0 ? successQueueStatus : failureQueueStatus;

    const nextMeta = buildMergedMeta(n.meta, {
      sms_dispatch: {
        run_id: id,
        queue_id: n.id,
        processed_at: nowIso,
        institution_id: institutionId || null,
        sms_event: smsEvent ?? null,
        provider,
        requested_sender_name: senderName || null,
        attempts,
        final_status: computedFinalStatus,
        provider_accept_status: successes > 0 ? providerQueueStatus : null,
        target_profiles: cloneJson(targetProfiles),
        target_profile_count: targetProfiles.length,
        message_preview: message ? message.slice(0, 200) : null,
        message_length: message ? message.length : 0,
        success_count: successes,
        failure_count: failedTargets.length,
        partial_failure: partialFailure,
        success_targets: cloneJson(successTargets),
        failed_targets: cloneJson(failedTargets),
        last_error: successes > 0 ? null : s(lastError).slice(0, 300),
      },
      sms_delivery: latestOrange
        ? {
            provider: "orange_ci",
            provider_status: providerQueueStatus,
            accepted_by_provider: true,
            accepted_at: latestAccepted?.at || nowIso,
            requested_sender_name: senderName || null,
            provider_sender_name: latestOrange.senderName || null,
            to: latestAccepted?.phone_e164 || null,
            sender_address: latestOrange.senderAddress || null,
            orange_resource_id: latestOrange.resourceId || null,
            orange_resource_url: latestOrange.resourceURL || null,
            orange_http_status: latestOrange.httpStatus || null,
            orange_request_id: latestOrange.requestId || null,
            orange_location_header: latestOrange.locationHeader || null,
            queue_status: computedFinalStatus,
            delivery_status: null,
            delivery_status_at: null,
            terminal_delivered: null,
          }
        : undefined,
    });

    if (successes > 0) {
      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({
          status: successQueueStatus,
          sent_at: nowIso,
          attempts,
          last_error: null,
          meta: nextMeta,
        } as any)
        .eq("id", n.id);

      if (updErr) {
        console.error("[sms/dispatch] queue_update_provider_accept_fail", {
          id,
          qid: n.id,
          error: updErr.message,
          queueStatus: successQueueStatus,
          providerStatus: providerQueueStatus,
        });
      } else {
        console.info("[sms/dispatch] queue_update_provider_accept_ok", {
          id,
          qid: n.id,
          attempts,
          successes,
          partialFailure,
          queueStatus: successQueueStatus,
          providerStatus: providerQueueStatus,
          requestedSenderName: senderName || null,
        });
      }
    } else {
      failed++;

      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({
          status: failureQueueStatus,
          attempts,
          last_error: s(lastError).slice(0, 300),
          meta: nextMeta,
        } as any)
        .eq("id", n.id);

      if (updErr) {
        console.error("[sms/dispatch] queue_update_error_fail", {
          id,
          qid: n.id,
          attempts,
          statusForError: failureQueueStatus,
          error: updErr.message,
        });
      } else {
        console.warn("[sms/dispatch] queue_update_error_ok", {
          id,
          qid: n.id,
          attempts,
          statusForError: failureQueueStatus,
          lastError: s(lastError).slice(0, 200),
        });
      }
    }
  }

  if (usedContactIds.size > 0) {
    const { error: touchErr } = await srv
      .from("parent_notification_contacts")
      .update({ last_used_at: new Date().toISOString() } as any)
      .in("id", Array.from(usedContactIds));

    if (touchErr) {
      console.warn("[sms/dispatch] touch_contacts_warn", {
        id,
        error: touchErr.message,
      });
    } else {
      console.info("[sms/dispatch] touch_contacts_ok", {
        id,
        count: usedContactIds.size,
      });
    }
  }

  const ms = Date.now() - t0;

  console.info("[sms/dispatch] done", {
    id,
    attempted: rows.length,
    accepted_sms_sends: acceptedSmsSends,
    failed,
    ms,
  });

  return NextResponse.json({
    ok: true,
    id,
    attempted: rows.length,
    accepted_sms_sends: acceptedSmsSends,
    sent_sms_sends: acceptedSmsSends,
    failed,
    ms,
  });
}