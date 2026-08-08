import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  assertTeacherSessionReplayScheduledStart,
  TeacherSessionReplayError,
  validateTeacherSessionReplay,
  type ValidatedTeacherSessionReplay,
} from "@/lib/teacher-session-replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  session_id?: string | null;
  client_session_id?: string | null;
  actual_end_at?: string | null;
  operation_id?: string | null;
  replay_context?: unknown;
};

type SessionRow = {
  id: string;
  institution_id: string | null;
  created_by: string | null;
  ended_at: string | null;
  status: string | null;
  started_at: string | null;
  actual_call_at: string | null;
};

class EffectiveEndAtError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function parseLiveEndAt(raw: unknown, serverNow: Date) {
  const value = String(raw || "").trim();
  if (!value) return serverNow;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new EffectiveEndAtError("actual_end_at_invalid");
  }
  if (parsed.getTime() > serverNow.getTime() + 10 * 60_000) {
    throw new EffectiveEndAtError("actual_end_at_in_future");
  }
  if (parsed.getTime() < serverNow.getTime() - 7 * 24 * 60 * 60_000) {
    throw new EffectiveEndAtError("actual_end_at_too_old_use_offline_replay");
  }
  return parsed;
}

function validOperationId(value: string) {
  return /^[a-zA-Z0-9:_-]{8,160}$/.test(value) && !value.startsWith("client:");
}

function replayError(error: unknown) {
  if (error instanceof TeacherSessionReplayError) {
    return NextResponse.json({ error: error.code }, { status: 409 });
  }
  throw error;
}

async function institutionReplayContext(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
) {
  const [{ data: institution, error: institutionError }, { data: revision, error: revisionError }] =
    await Promise.all([
      srv
        .from("institutions")
        .select("tz")
        .eq("id", institutionId)
        .maybeSingle(),
      srv
        .from("attendance_schedule_revisions")
        .select("revision")
        .eq("institution_id", institutionId)
        .maybeSingle(),
    ]);
  if (institutionError) throw new EffectiveEndAtError("institution_lookup_unavailable");
  if (revisionError) throw new EffectiveEndAtError("schedule_revision_lookup_unavailable");
  return {
    timezone: String(institution?.tz || "Africa/Abidjan"),
    revision: Number.isSafeInteger(Number(revision?.revision))
      ? Number(revision?.revision)
      : 0,
  };
}

function responseItem(input: {
  session: Partial<SessionRow> & { id: string };
  operationId: string | null;
  replay: ValidatedTeacherSessionReplay | null;
  receivedAt: Date;
  currentScheduleRevision: number | null;
  idempotent: boolean;
  fallbackEndedAt?: string;
}) {
  return {
    ...input.session,
    ended_at: input.session.ended_at || input.fallbackEndedAt || null,
    operation_id: input.operationId,
    idempotent: input.idempotent,
    delivery_mode: input.replay ? "offline_replay" : "live",
    event_at:
      input.replay?.eventAt.toISOString() ||
      input.session.ended_at ||
      input.fallbackEndedAt ||
      null,
    received_at: input.receivedAt.toISOString(),
    schedule_revision:
      input.replay?.scheduleRevision ?? input.currentScheduleRevision,
    schedule_revision_stale: input.replay?.scheduleRevisionStale ?? false,
    server_time: input.receivedAt.toISOString(),
  };
}

export async function PATCH(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionId = String(body?.session_id || "").trim();
    const operationId = String(
      req.headers.get("x-mon-cahier-operation-id") || body?.operation_id || "",
    ).trim();
    if (operationId && !validOperationId(operationId)) {
      return NextResponse.json({ error: "invalid_operation_id" }, { status: 400 });
    }

    const serverNow = new Date();
    const replayRequested = body?.replay_context != null;
    if (replayRequested && !operationId) {
      return NextResponse.json({ error: "operation_id_required" }, { status: 400 });
    }
    if (replayRequested && !sessionId) {
      return NextResponse.json(
        { error: "offline_replay_session_id_required" },
        { status: 400 },
      );
    }

    let session: SessionRow | null = null;
    if (sessionId) {
      const { data, error } = await srv
        .from("teacher_sessions")
        .select(
          "id,institution_id,created_by,ended_at,status,started_at,actual_call_at",
        )
        .eq("id", sessionId)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: "session_lookup_unavailable" }, { status: 503 });
      }
      session = (data as SessionRow | null) || null;
      if (!session) {
        return NextResponse.json({ error: "session_not_found" }, { status: 404 });
      }
      if (String(session.created_by || "") !== String(user.id)) {
        return NextResponse.json({ error: "forbidden_not_owner" }, { status: 403 });
      }
    } else {
      const { data, error } = await srv
        .from("teacher_sessions")
        .select(
          "id,institution_id,created_by,ended_at,status,started_at,actual_call_at",
        )
        .eq("created_by", user.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: "session_lookup_unavailable" }, { status: 503 });
      }
      session = (data as SessionRow | null) || null;
      if (!session) {
        return NextResponse.json({ error: "no_open_session" }, { status: 404 });
      }
    }

    let replay: ValidatedTeacherSessionReplay | null = null;
    let currentScheduleRevision: number | null = null;
    let effectiveEndAt: Date;

    if (replayRequested) {
      if (!session.institution_id) {
        return NextResponse.json(
          { error: "offline_replay_institution_required" },
          { status: 409 },
        );
      }
      let institutionContext: { timezone: string; revision: number };
      try {
        institutionContext = await institutionReplayContext(
          srv,
          session.institution_id,
        );
      } catch (error) {
        if (error instanceof EffectiveEndAtError) {
          return NextResponse.json({ error: error.code }, { status: 503 });
        }
        throw error;
      }
      currentScheduleRevision = institutionContext.revision;
      try {
        replay = validateTeacherSessionReplay({
          rawContext: body.replay_context,
          eventAtRaw: body.actual_end_at,
          operationId,
          clientSessionId: body.client_session_id,
          serverNow,
          expectedTimezone: institutionContext.timezone,
          currentScheduleRevision,
          requireScheduledStart: true,
          requireOperationBoundClientSession: false,
        });
        if (!replay) {
          throw new TeacherSessionReplayError(
            "offline_replay_context_required",
          );
        }
        if (!replay.clientSessionId.startsWith("client:")) {
          throw new TeacherSessionReplayError(
            "offline_replay_client_session_id_invalid",
          );
        }
        const startedAt = new Date(String(session.started_at || ""));
        if (!Number.isFinite(startedAt.getTime())) {
          throw new TeacherSessionReplayError(
            "offline_replay_session_start_invalid",
          );
        }
        assertTeacherSessionReplayScheduledStart(replay, startedAt);
        const earliestEnd = new Date(
          String(session.actual_call_at || session.started_at || ""),
        );
        if (
          Number.isFinite(earliestEnd.getTime()) &&
          replay.eventAt.getTime() < earliestEnd.getTime() - 60_000
        ) {
          throw new TeacherSessionReplayError(
            "offline_replay_end_before_session_start",
          );
        }
      } catch (error) {
        return replayError(error);
      }
      if (!replay) {
        return replayError(
          new TeacherSessionReplayError("offline_replay_context_required"),
        );
      }
      effectiveEndAt = replay.eventAt;
    } else {
      try {
        effectiveEndAt = parseLiveEndAt(body.actual_end_at, serverNow);
      } catch (error) {
        if (error instanceof EffectiveEndAtError) {
          return NextResponse.json({ error: error.code }, { status: 400 });
        }
        throw error;
      }
      const startedAt = new Date(String(session.actual_call_at || session.started_at || ""));
      if (
        Number.isFinite(startedAt.getTime()) &&
        effectiveEndAt.getTime() < startedAt.getTime() - 60_000
      ) {
        return NextResponse.json(
          { error: "actual_end_at_before_session_start" },
          { status: 409 },
        );
      }
    }

    if (session.ended_at) {
      return NextResponse.json(
        {
          ok: true,
          item: responseItem({
            session,
            operationId: operationId || null,
            replay,
            receivedAt: serverNow,
            currentScheduleRevision,
            idempotent: true,
          }),
        },
        { status: 200 },
      );
    }

    const endedAtIso = effectiveEndAt.toISOString();
    const { data: updated, error: updateError } = await srv
      .from("teacher_sessions")
      .update({ ended_at: endedAtIso, status: "submitted" })
      .eq("id", session.id)
      .eq("created_by", user.id)
      .is("ended_at", null)
      .select(
        "id,institution_id,created_by,ended_at,status,started_at,actual_call_at",
      )
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: "session_close_unavailable" }, { status: 503 });
    }

    if (!updated) {
      const { data: alreadyClosed, error: lookupError } = await srv
        .from("teacher_sessions")
        .select(
          "id,institution_id,created_by,ended_at,status,started_at,actual_call_at",
        )
        .eq("id", session.id)
        .maybeSingle();
      if (lookupError || !alreadyClosed?.ended_at) {
        return NextResponse.json({ error: "session_close_conflict" }, { status: 409 });
      }
      return NextResponse.json(
        {
          ok: true,
          item: responseItem({
            session: alreadyClosed as SessionRow,
            operationId: operationId || null,
            replay,
            receivedAt: serverNow,
            currentScheduleRevision,
            idempotent: true,
          }),
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        item: responseItem({
          session: updated as SessionRow,
          operationId: operationId || null,
          replay,
          receivedAt: serverNow,
          currentScheduleRevision,
          idempotent: false,
          fallbackEndedAt: endedAtIso,
        }),
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "end_failed" },
      { status: 500 },
    );
  }
}
