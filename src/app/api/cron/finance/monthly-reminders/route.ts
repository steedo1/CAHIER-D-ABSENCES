// src/app/api/cron/finance/monthly-reminders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChargeRow = {
  id: string;
  school_id: string | null;
  student_id: string | null;
  class_id: string | null;
  label: string | null;
  balance_due: number | string | null;
  due_date: string | null;
  computed_status: string | null;
};

type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  matricule: string | null;
};

type ClassRow = {
  id: string;
  label: string | null;
};

type GuardianRow = {
  student_id: string;
  parent_id: string | null;
  notifications_enabled: boolean | null;
};

type InstitutionRow = {
  id: string;
  name: string | null;
};

type ChannelSettingsRow = {
  institution_id: string;
  push_enabled: boolean | null;
  sms_premium_enabled: boolean | null;
  sms_finance_reminders_enabled: boolean | null;
};

type FinanceSettingsRow = {
  institution_id: string;
  finance_premium_enabled: boolean | null;
};

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function money(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function formatMoney(v: unknown) {
  return `${Math.round(money(v)).toLocaleString("fr-FR")} F CFA`;
}

function monthKeyFromDate(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function okAuth(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");
  return fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
}

function isInternatLabel(label: string) {
  const x = label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return [
    "internat",
    "pension",
    "hebergement",
    "dortoir",
    "trousseau",
    "cantine internat",
    "frais annexes internat",
    "boarding",
  ].some((needle) => x.includes(needle));
}

function studentName(row: StudentRow | undefined) {
  const name = [row?.last_name, row?.first_name].map(s).filter(Boolean).join(" ");
  return name || s(row?.matricule) || "votre enfant";
}

function getPushAllowed(row: ChannelSettingsRow | undefined) {
  return row?.push_enabled !== false;
}

function getSmsFinanceAllowed(row: ChannelSettingsRow | undefined) {
  return !!row?.sms_premium_enabled && !!row?.sms_finance_reminders_enabled;
}

export const GET = run;
export const POST = run;

async function run(req: NextRequest) {
  const trace = rid();
  const startedAt = Date.now();

  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: "forbidden", trace }, { status: 403 });
  }

  const url = new URL(req.url);
  const monthKey = s(url.searchParams.get("month")) || monthKeyFromDate();
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 1000), 5000));
  const dryRun = url.searchParams.get("dry_run") === "1";

  const srv = getSupabaseServiceClient();

  const { data: chargesRaw, error: chargesErr } = await srv
    .schema("finance")
    .from("v_charge_balances")
    .select("id,school_id,student_id,class_id,label,balance_due,due_date,computed_status")
    .neq("computed_status", "cancelled")
    .gt("balance_due", 0)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (chargesErr) {
    return NextResponse.json({ ok: false, error: chargesErr.message, trace, stage: "charges" }, { status: 400 });
  }

  const charges = (chargesRaw || []) as ChargeRow[];
  const institutionIds = Array.from(new Set(charges.map((c) => s(c.school_id)).filter(Boolean)));
  const studentIds = Array.from(new Set(charges.map((c) => s(c.student_id)).filter(Boolean)));
  const classIds = Array.from(new Set(charges.map((c) => s(c.class_id)).filter(Boolean)));

  const [institutionsRes, studentsRes, classesRes, guardiansRes, channelsRes, financeRes] = await Promise.all([
    institutionIds.length
      ? srv.from("institutions").select("id,name").in("id", institutionIds)
      : Promise.resolve({ data: [] as InstitutionRow[], error: null }),
    studentIds.length
      ? srv.from("students").select("id,first_name,last_name,matricule").in("id", studentIds)
      : Promise.resolve({ data: [] as StudentRow[], error: null }),
    classIds.length
      ? srv.from("classes").select("id,label").in("id", classIds)
      : Promise.resolve({ data: [] as ClassRow[], error: null }),
    studentIds.length
      ? srv.from("student_guardians").select("student_id,parent_id,notifications_enabled").in("student_id", studentIds)
      : Promise.resolve({ data: [] as GuardianRow[], error: null }),
    institutionIds.length
      ? srv
          .from("institution_notification_channel_settings")
          .select("institution_id,push_enabled,sms_premium_enabled,sms_finance_reminders_enabled")
          .in("institution_id", institutionIds)
      : Promise.resolve({ data: [] as ChannelSettingsRow[], error: null }),
    institutionIds.length
      ? srv
          .from("institution_finance_module_settings")
          .select("institution_id,finance_premium_enabled")
          .in("institution_id", institutionIds)
      : Promise.resolve({ data: [] as FinanceSettingsRow[], error: null }),
  ] as const);

  for (const res of [institutionsRes, studentsRes, classesRes, guardiansRes, channelsRes, financeRes]) {
    if ((res as any).error) {
      return NextResponse.json({ ok: false, error: (res as any).error.message, trace, stage: "lookup" }, { status: 400 });
    }
  }

  const institutionById = new Map<string, InstitutionRow>(
    (institutionsRes.data || []).map((r: any) => [String(r.id), r as InstitutionRow] as [string, InstitutionRow]),
  );
  const studentById = new Map<string, StudentRow>(
    (studentsRes.data || []).map((r: any) => [String(r.id), r as StudentRow] as [string, StudentRow]),
  );
  const classById = new Map<string, ClassRow>(
    (classesRes.data || []).map((r: any) => [String(r.id), r as ClassRow] as [string, ClassRow]),
  );
  const channelByInstitution = new Map<string, ChannelSettingsRow>(
    (channelsRes.data || []).map((r: any) => [String(r.institution_id), r as ChannelSettingsRow] as [string, ChannelSettingsRow]),
  );
  const financeEnabledByInstitution = new Map<string, boolean>(
    (financeRes.data || []).map((r: any) => [String(r.institution_id), r.finance_premium_enabled !== false] as [string, boolean]),
  );

  const guardiansByStudent = new Map<string, string[]>();
  for (const row of (guardiansRes.data || []) as GuardianRow[]) {
    if (row.notifications_enabled === false) continue;
    const studentId = s(row.student_id);
    const parentId = s(row.parent_id);
    if (!studentId || !parentId) continue;
    const arr = guardiansByStudent.get(studentId) || [];
    arr.push(parentId);
    guardiansByStudent.set(studentId, Array.from(new Set(arr)));
  }

  const grouped = new Map<
    string,
    {
      institutionId: string;
      studentId: string;
      classId: string | null;
      scolarite: number;
      internat: number;
      chargeIds: string[];
      dueDates: string[];
    }
  >();

  for (const charge of charges) {
    const institutionId = s(charge.school_id);
    const studentId = s(charge.student_id);
    if (!institutionId || !studentId) continue;

    // Si la ligne de réglage n’existe pas encore, on considère le module finance actif
    // pour ne pas masquer des écoles déjà en production. Si elle existe et vaut false,
    // on ne déclenche rien.
    if (financeEnabledByInstitution.has(institutionId) && financeEnabledByInstitution.get(institutionId) === false) {
      continue;
    }

    const key = `${institutionId}:${studentId}`;
    const row = grouped.get(key) || {
      institutionId,
      studentId,
      classId: s(charge.class_id) || null,
      scolarite: 0,
      internat: 0,
      chargeIds: [],
      dueDates: [],
    };

    const amount = money(charge.balance_due);
    if (isInternatLabel(s(charge.label))) row.internat += amount;
    else row.scolarite += amount;

    if (charge.id) row.chargeIds.push(String(charge.id));
    if (charge.due_date) row.dueDates.push(String(charge.due_date));
    if (!row.classId && charge.class_id) row.classId = String(charge.class_id);

    grouped.set(key, row);
  }

  let pushQueued = 0;
  let smsQueued = 0;
  let duplicates = 0;
  let skippedNoParent = 0;
  let logErrors = 0;
  let queueErrors = 0;
  const samples: any[] = [];

  for (const item of grouped.values()) {
    const parentIds = guardiansByStudent.get(item.studentId) || [];
    if (!parentIds.length) {
      skippedNoParent++;
      continue;
    }

    const channels = channelByInstitution.get(item.institutionId);
    const pushAllowed = getPushAllowed(channels);
    const smsAllowed = getSmsFinanceAllowed(channels);
    const total = item.scolarite + item.internat;
    if (total <= 0) continue;

    const inst = institutionById.get(item.institutionId);
    const st = studentById.get(item.studentId);
    const cls = item.classId ? classById.get(item.classId) : undefined;
    const displayStudentName = studentName(st);
    const classLabel = s(cls?.label);
    const institutionName = s(inst?.name) || "Établissement";

    const balanceText = [
      item.scolarite > 0 ? `Scolarité : ${formatMoney(item.scolarite)}` : "",
      item.internat > 0 ? `Internat : ${formatMoney(item.internat)}` : "",
      `Total : ${formatMoney(total)}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const title = "Rappel de solde";
    const body = `${displayStudentName}${classLabel ? ` (${classLabel})` : ""} — ${balanceText}.`;

    for (const parentId of parentIds) {
      const rowsToQueue: Array<{ channel: "push" | "sms"; channels: string[] }> = [];
      if (pushAllowed) rowsToQueue.push({ channel: "push", channels: ["push"] });
      if (smsAllowed) rowsToQueue.push({ channel: "sms", channels: ["sms"] });

      for (const target of rowsToQueue) {
        if (dryRun) {
          if (target.channel === "push") pushQueued++;
          if (target.channel === "sms") smsQueued++;
          if (samples.length < 5) samples.push({ channel: target.channel, parentId, body });
          continue;
        }

        const { error: logErr } = await srv
          .from("finance_monthly_reminder_runs")
          .insert({
            month_key: monthKey,
            institution_id: item.institutionId,
            student_id: item.studentId,
            parent_id: parentId,
            channel: target.channel,
            balance_scolarite: item.scolarite,
            balance_internat: item.internat,
            balance_total: total,
          } as any);

        if (logErr) {
          const msg = String(logErr.message || "").toLowerCase();
          if (msg.includes("duplicate") || msg.includes("unique")) duplicates++;
          else logErrors++;
          continue;
        }

        const payload = {
          kind: "finance_reminder",
          event: "finance_reminder",
          type: "finance_reminder",
          month_key: monthKey,
          url: "/parents/payments",
          student: {
            id: item.studentId,
            name: displayStudentName,
            matricule: st?.matricule || null,
          },
          class: {
            id: item.classId,
            label: classLabel || null,
          },
          institution: {
            id: item.institutionId,
            name: institutionName,
          },
          balances: {
            scolarite: item.scolarite,
            internat: item.internat,
            total,
          },
          charge_ids: item.chargeIds,
          due_dates: Array.from(new Set(item.dueDates)),
        };

        const { data: q, error: qErr } = await srv
          .from("notifications_queue")
          .insert({
            institution_id: item.institutionId,
            parent_id: parentId,
            student_id: item.studentId,
            profile_id: null,
            channels: target.channels,
            title,
            body,
            severity: item.internat > 0 ? "warning" : "info",
            status: WAIT_STATUS,
            attempts: 0,
            send_after: new Date().toISOString(),
            payload,
            meta: {
              source: "finance_monthly_reminder",
              month_key: monthKey,
              channel: target.channel,
              generated_at: new Date().toISOString(),
            },
          } as any)
          .select("id")
          .maybeSingle();

        if (qErr) {
          queueErrors++;
          await srv
            .from("finance_monthly_reminder_runs")
            .delete()
            .eq("month_key", monthKey)
            .eq("institution_id", item.institutionId)
            .eq("student_id", item.studentId)
            .eq("parent_id", parentId)
            .eq("channel", target.channel);
          continue;
        }

        if ((q as any)?.id) {
          await srv
            .from("finance_monthly_reminder_runs")
            .update({ notification_queue_id: (q as any).id } as any)
            .eq("month_key", monthKey)
            .eq("institution_id", item.institutionId)
            .eq("student_id", item.studentId)
            .eq("parent_id", parentId)
            .eq("channel", target.channel);
        }

        if (target.channel === "push") pushQueued++;
        if (target.channel === "sms") smsQueued++;
        if (samples.length < 5) samples.push({ channel: target.channel, parentId, body });
      }
    }
  }

  const [pushDispatchTriggered, smsDispatchTriggered] = await Promise.all([
    pushQueued ? triggerPushDispatch({ req, reason: "finance_monthly_reminders", timeoutMs: 1200, retries: 1 }) : Promise.resolve(false),
    smsQueued ? triggerSmsDispatch({ req, reason: "finance_monthly_reminders", timeoutMs: 3500, retries: 1 }) : Promise.resolve(false),
  ]);

  return NextResponse.json({
    ok: true,
    trace,
    month_key: monthKey,
    dry_run: dryRun,
    groups: grouped.size,
    queued: { push: pushQueued, sms: smsQueued },
    skipped: { duplicates, no_parent: skippedNoParent, log_errors: logErrors, queue_errors: queueErrors },
    dispatch: { push: pushDispatchTriggered, sms: smsDispatchTriggered },
    samples,
    ms: Date.now() - startedAt,
  });
}
