// src/app/api/class/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  class_id: string;
  subject_id?: string | null;
  started_at?: string;
  expected_minutes?: number | null;
  actual_call_at?: string;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

type PhoneVariants = { variants: string[]; likePatterns: string[] };

function buildPhoneVariants(raw: string): PhoneVariants {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";

  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),
    digits,
    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,
    `00${cc}${local10}`,
    `00${cc}${localNo0}`,
    `${cc}${local10}`,
    `${cc}${localNo0}`,
    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
  ]);

  return { variants, likePatterns };
}

function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localHMAndWeekday(iso: string, tz: string) {
  const d = new Date(iso);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  const wdStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
    .toLowerCase();

  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return { hm, weekday: map[wdStr] ?? 0 };
}

function tzOffsetMinutes(atUTC: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(atUTC);

  const y = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  const mo = parseInt(parts.find((p) => p.type === "month")?.value || "1", 10);
  const d = parseInt(parts.find((p) => p.type === "day")?.value || "1", 10);
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  const wallAsUTC = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);
  return Math.round((wallAsUTC - atUTC.getTime()) / 60000);
}

function dateInTZFromYMDHM(ymd: string, hm: string, tz: string) {
  const [Y, M, D] = ymd.split("-").map((x) => parseInt(x, 10));
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));

  let guessUTC = new Date(Date.UTC(Y, M - 1, D, h, m, 0, 0));
  let off = tzOffsetMinutes(guessUTC, tz);
  let realUTC = new Date(guessUTC.getTime() - off * 60_000);

  const off2 = tzOffsetMinutes(realUTC, tz);
  if (off2 != off) realUTC = new Date(guessUTC.getTime() - off2 * 60_000);

  return realUTC;
}

function ymdInTZ(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseIsoDate(v: any): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const b = (await req.json().catch(() => ({}))) as Body;
    const class_id = String(b?.class_id ?? "").trim();
    const subject_id =
      b?.subject_id && String(b.subject_id).trim() ? String(b.subject_id).trim() : null;

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }
    if (!subject_id) {
      return NextResponse.json({ error: "subject_id_required" }, { status: 400 });
    }

    const startedAtRaw = b?.started_at ? new Date(b.started_at) : new Date();
    const startedAt = isNaN(startedAtRaw.getTime()) ? new Date() : startedAtRaw;
    const serverNow = new Date();

    const candidateClientCall =
      parseIsoDate((b as any)?.actual_call_at) ||
      parseIsoDate((b as any)?.client_call_at) ||
      parseIsoDate((b as any)?.click_at) ||
      parseIsoDate((b as any)?.clicked_at) ||
      null;

    let actualCallAt: Date = serverNow;
    if (candidateClientCall) {
      const maxFutureMs = 5 * 60_000;
      if (candidateClientCall.getTime() <= serverNow.getTime() + maxFutureMs) {
        actualCallAt = candidateClientCall;
      }
    }

    let phone = String((user as any).phone || "").trim();
    if (!phone) {
      const { data: au } = await srv
        .schema("auth")
        .from("users")
        .select("phone")
        .eq("id", user.id)
        .maybeSingle();
      phone = String(au?.phone || "").trim();
    }
    if (!phone) {
      return NextResponse.json({ error: "no_phone" }, { status: 400 });
    }

    const { variants, likePatterns } = buildPhoneVariants(phone);

    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,institution_id,class_phone_e164")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }
    if (!cls) {
      return NextResponse.json({ error: "class_not_found" }, { status: 404 });
    }

    let match = false;
    if (cls.class_phone_e164 && variants.includes(String(cls.class_phone_e164))) match = true;
    if (!match && likePatterns.length) {
      const stored = String(cls.class_phone_e164 || "");
      match = likePatterns.some((p) => {
        const pat = String(p).replace(/%/g, ".*");
        try {
          return new RegExp(pat).test(stored);
        } catch {
          return false;
        }
      });
    }
    if (!match) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    let instSubjectId: string | null = null;

    {
      const { data: asInst } = await srv
        .from("institution_subjects")
        .select("id")
        .eq("id", subject_id)
        .maybeSingle();

      if (asInst?.id) {
        instSubjectId = String(asInst.id);
      } else {
        const { data: viaCanonical } = await srv
          .from("institution_subjects")
          .select("id")
          .eq("institution_id", cls.institution_id)
          .eq("subject_id", subject_id)
          .eq("is_active", true)
          .maybeSingle();

        if (viaCanonical?.id) instSubjectId = String(viaCanonical.id);
      }
    }

    if (!instSubjectId) {
      return NextResponse.json(
        {
          error: "invalid_subject_for_institution",
          message:
            "La matière sélectionnée n’est pas correctement affectée à cet établissement.",
        },
        { status: 400 }
      );
    }

    const { data: inst, error: iErr } = await srv
      .from("institutions")
      .select("tz, default_session_minutes")
      .eq("id", cls.institution_id)
      .maybeSingle();

    if (iErr) {
      return NextResponse.json({ error: iErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");
    const defSessionMin =
      Number.isFinite(Number(inst?.default_session_minutes)) &&
      Number(inst?.default_session_minutes) > 0
        ? Math.floor(Number(inst!.default_session_minutes as number))
        : 60;

    const { hm: callHM, weekday } = localHMAndWeekday(actualCallAt.toISOString(), tz);
    const callMin = hmToMin(callHM);

    const { data: periods, error: pErr } = await srv
      .from("institution_periods")
      .select("id,weekday,period_no,label,start_time,end_time,duration_min")
      .eq("institution_id", cls.institution_id)
      .eq("weekday", weekday)
      .order("period_no", { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }

    let periodDuration: number | null = null;
    let currentPeriod: { periodId: string; startMin: number; endMin: number } | null = null;

    if (Array.isArray(periods) && periods.length) {
      const expanded = periods.map((p: any) => {
        const s = hmsToMin(p.start_time);
        const e = hmsToMin(p.end_time);
        const duration =
          typeof p.duration_min === "number" && p.duration_min > 0
            ? Math.floor(p.duration_min)
            : Math.max(1, e - s);

        return {
          periodId: String(p.id || ""),
          label: String(p.label || ""),
          startMin: s,
          endMin: e,
          durationMin: duration,
        };
      });

      const cur = expanded.find((p) => callMin >= p.startMin && callMin < p.endMin) ?? null;

      if (cur) {
        currentPeriod = {
          periodId: cur.periodId,
          startMin: cur.startMin,
          endMin: cur.endMin,
        };
        periodDuration = cur.durationMin ?? null;
      }
    }

    if (!currentPeriod) {
      const configuredSlots = (Array.isArray(periods) ? periods : [])
        .map((p: any) => `${String(p.start_time || "").slice(0, 5)}–${String(p.end_time || "").slice(0, 5)}`)
        .filter(Boolean)
        .join(", ");

      return NextResponse.json(
        {
          error: "attendance_outside_slot",
          message:
            "Démarrage refusé : l’appel doit être effectué strictement dans un créneau configuré.",
          details: {
            actual_call_hm: callHM,
            weekday,
            configured_slots: configuredSlots || "Aucun créneau configuré pour ce jour.",
          },
        },
        { status: 409 }
      );
    }

    const { data: scheduledRows, error: scheduledErr } = await srv
      .from("teacher_timetables")
      .select("teacher_id")
      .eq("institution_id", cls.institution_id)
      .eq("class_id", class_id)
      .eq("subject_id", instSubjectId)
      .eq("period_id", currentPeriod.periodId);

    if (scheduledErr) {
      return NextResponse.json({ error: scheduledErr.message }, { status: 400 });
    }

    const scheduledTeacherIds = uniq<string>(
      ((scheduledRows || []) as any[]).map((r) => String(r.teacher_id || "")).filter(Boolean)
    );

    if (scheduledTeacherIds.length === 0) {
      return NextResponse.json(
        {
          error: "class_subject_not_scheduled_for_slot",
          message:
            "Démarrage refusé : cette discipline n’est pas prévue pour cette classe dans le créneau en cours selon l’emploi du temps.",
        },
        { status: 403 }
      );
    }

    if (scheduledTeacherIds.length > 1) {
      return NextResponse.json(
        {
          error: "ambiguous_timetable_for_slot",
          message:
            "Démarrage refusé : plusieurs enseignants sont prévus pour cette classe et cette discipline sur le même créneau. Corrigez l’emploi du temps.",
        },
        { status: 409 }
      );
    }

    const teacher_id = scheduledTeacherIds[0]!;

    let expected_minutes: number | null;
    if (b?.expected_minutes === null) {
      expected_minutes = null;
    } else if (Number.isFinite(Number(b?.expected_minutes))) {
      expected_minutes = Math.max(1, Math.floor(Number(b!.expected_minutes)));
    } else {
      expected_minutes = periodDuration ?? defSessionMin;
    }

    const ymd = ymdInTZ(actualCallAt, tz);
    const hh = Math.floor(currentPeriod.startMin / 60);
    const mm = currentPeriod.startMin % 60;
    const slotStartedAt = dateInTZFromYMDHM(ymd, `${pad2(hh)}:${pad2(mm)}`, tz);
    const slotStartedISO = slotStartedAt.toISOString();
    const callISO = actualCallAt.toISOString();

    let subject_name: string | null = null;
    {
      const { data: subj } = await srv
        .from("institution_subjects")
        .select("custom_name,subjects:subject_id(name)")
        .eq("id", instSubjectId)
        .maybeSingle();

      subject_name = (subj as any)?.custom_name ?? (subj as any)?.subjects?.name ?? null;
    }

    let session:
      | {
          id: string;
          started_at: string;
          expected_minutes: number | null;
          actual_call_at: string | null;
          class_id: string | null;
          subject_id: string | null;
        }
      | null = null;

    const upPayload = {
      institution_id: cls.institution_id,
      teacher_id,
      class_id,
      subject_id: instSubjectId,
      started_at: slotStartedISO,
      actual_call_at: callISO,
      expected_minutes,
      status: "open",
      created_by: user.id,
      origin: "class_device",
    };

    const { data: inserted, error: insertErr } = await srv
      .from("teacher_sessions")
      .insert(upPayload as any)
      .select("id,started_at,expected_minutes,actual_call_at,class_id,subject_id")
      .maybeSingle();

    if (!insertErr && inserted) {
      session = inserted as any;
    } else if (
      insertErr &&
      String(insertErr.message || "").toLowerCase().includes("duplicate")
    ) {
      // doublon attendu: on relira juste après
    } else if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    if (!session) {
      const { data: rows, error: selErr } = await srv
        .from("teacher_sessions")
        .select("id,started_at,expected_minutes,actual_call_at,class_id,subject_id,created_at")
        .eq("institution_id", cls.institution_id)
        .eq("teacher_id", teacher_id)
        .eq("started_at", slotStartedISO)
        .order("actual_call_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(1);

      if (selErr) return NextResponse.json({ error: selErr.message }, { status: 400 });
      session = (rows as any[])?.[0] ?? null;
    }

    if (session) {
      if (
        session.class_id &&
        String(session.class_id) !== String(class_id)
      ) {
        return NextResponse.json(
          {
            error: "session_slot_already_bound_to_other_class",
            message:
              "Conflit détecté : une autre classe est déjà enregistrée pour cet enseignant sur ce créneau.",
          },
          { status: 409 }
        );
      }

      if (
        session.subject_id &&
        String(session.subject_id) !== String(instSubjectId)
      ) {
        return NextResponse.json(
          {
            error: "session_slot_already_bound_to_other_subject",
            message:
              "Conflit détecté : une autre discipline est déjà enregistrée pour cet enseignant sur ce créneau.",
          },
          { status: 409 }
        );
      }

      const patch: any = {};
      const existingCall = parseIsoDate(session.actual_call_at);
      const candidate = actualCallAt;

      const windowMin = slotStartedAt.getTime() - 8 * 60 * 60_000;
      const windowMax = slotStartedAt.getTime() + 12 * 60 * 60_000;
      const candidateOk = candidate.getTime() >= windowMin && candidate.getTime() <= windowMax;

      if (!existingCall) {
        patch.actual_call_at = callISO;
      } else if (candidateOk) {
        const diffMs = existingCall.getTime() - candidate.getTime();
        if (diffMs > 60_000) patch.actual_call_at = callISO;
      }

      if (session.expected_minutes == null && expected_minutes != null) patch.expected_minutes = expected_minutes;
      if (!session.subject_id && instSubjectId) patch.subject_id = instSubjectId;
      if (!session.class_id && class_id) patch.class_id = class_id;

      if (Object.keys(patch).length) {
        const { data: upd, error: updErr } = await srv
          .from("teacher_sessions")
          .update(patch)
          .eq("id", session.id)
          .select("id,started_at,expected_minutes,actual_call_at,class_id,subject_id")
          .maybeSingle();

        if (!updErr && upd) session = upd as any;
      }
    }

    if (!session) {
      return NextResponse.json({ error: "start_failed_no_session" }, { status: 400 });
    }

    return NextResponse.json({
      item: {
        id: session.id,
        class_id,
        class_label: cls.label as string,
        subject_id,
        subject_name,
        started_at: session.started_at,
        actual_call_at: session.actual_call_at ?? callISO,
        expected_minutes: session.expected_minutes ?? expected_minutes ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "start_failed" }, { status: 400 });
  }
}
