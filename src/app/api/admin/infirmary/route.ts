// src/app/api/admin/infirmary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoleRow = {
  role: string | null;
  institution_id: string | null;
};

const ALLOWED_ROLES = new Set(["admin", "super_admin", "founder", "educator"]);

const STATUS_VALUES = new Set([
  "observation",
  "retour_classe",
  "parent_informe",
  "evacue",
  "cloture",
]);

const REASON_VALUES = new Set([
  "malaise",
  "douleur",
  "blessure_legere",
  "fatigue",
  "prise_traitement",
  "controle",
  "autre",
]);

function cleanText(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function onlyYmd(value: unknown) {
  const s = cleanText(value, 20);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayYmd();
}

function optionalYmd(value: unknown) {
  const s = cleanText(value, 20);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function inclusiveDays(startYmd: string | null, endYmd: string | null) {
  if (!startYmd || !endYmd) return null;
  const start = new Date(`${startYmd}T00:00:00Z`).getTime();
  const end = new Date(`${endYmd}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86400000) + 1;
}

function restText(visit: any) {
  const start = visit?.rest_start_date ? String(visit.rest_start_date) : "";
  const end = visit?.rest_end_date ? String(visit.rest_end_date) : "";
  if (!start || !end) return "";
  const days = Number(visit?.rest_days || 0);
  return `Repos du ${start} au ${end}${days > 0 ? ` (${days} jour${days > 1 ? "s" : ""})` : ""}`;
}

function onlyTime(value: unknown) {
  const s = cleanText(value, 20);
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  return "";
}

function minutesBetween(entry: string, exit: string) {
  if (!entry || !exit) return null;
  const [eh, em] = entry.split(":").map((n) => Number(n));
  const [xh, xm] = exit.split(":").map((n) => Number(n));
  if (![eh, em, xh, xm].every(Number.isFinite)) return null;

  const start = eh * 60 + em;
  const end = xh * 60 + xm;
  if (end < start) return null;
  return end - start;
}

function ymdCompact(ymd: string) {
  return ymd.replace(/-/g, "");
}

function randomReceiptCode(ymd: string) {
  const token = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `INF-${ymdCompact(ymd)}-${token}`;
}

function studentFullName(row: any) {
  const s = row || {};
  return (
    `${s.last_name ?? ""} ${s.first_name ?? ""}`.trim() ||
    String(s.full_name || "").trim() ||
    "Élève"
  );
}

function roleMatchesInstitution(role: string, roleInstitutionId: unknown, institutionId: string) {
  if (role === "super_admin") return true;
  const roleInst = String(roleInstitutionId || "").trim();
  if (!roleInst) return Boolean(institutionId);
  return roleInst === institutionId;
}

async function getCurrentAcademicYear(institutionId: string): Promise<string | null> {
  const srv = getSupabaseServiceClient();

  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((current as any)?.code) return String((current as any).code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest as any)?.code ? String((latest as any).code) : null;
}

async function requireInstitution() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ ok: false, error: meErr.message }, { status: 400 }) };
  }

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) {
    return { error: NextResponse.json({ ok: false, error: roleErr.message }, { status: 400 }) };
  }

  const roles = ((roleRows || []) as RoleRow[]).filter((row) =>
    ALLOWED_ROLES.has(String(row.role || "")),
  );

  let institutionId = String((me as any)?.institution_id || "").trim();
  if (!institutionId) {
    const roleInstitution = roles.find((row) => row.institution_id)?.institution_id;
    institutionId = roleInstitution ? String(roleInstitution).trim() : "";
  }

  if (!institutionId) {
    return { error: NextResponse.json({ ok: false, error: "no_institution" }, { status: 400 }) };
  }

  const canUse = roles.some((row) =>
    roleMatchesInstitution(String(row.role || ""), row.institution_id, institutionId),
  );

  if (!canUse) {
    return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }

  return { srv, userId: user.id, institutionId };
}

async function queueParentInfirmaryNotification(opts: {
  req: NextRequest;
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  visit: any;
  studentName: string;
  classLabel: string | null;
}) {
  const { req, srv, institutionId, visit, studentName, classLabel } = opts;
  const studentId = String(visit.student_id || "");
  if (!studentId) return { queued: 0, push_dispatched: false };

  const { data: guardians, error: guardErr } = await srv
    .from("student_guardians")
    .select("*")
    .eq("student_id", studentId);

  if (guardErr) throw guardErr;

  const parentIds = Array.from(
    new Set(
      (guardians || [])
        .filter((row: any) => row?.notifications_enabled !== false)
        .map((row: any) =>
          String(
            row?.guardian_profile_id ||
              row?.parent_id ||
              row?.parent_profile_id ||
              row?.profile_id ||
              row?.user_id ||
              "",
          ).trim(),
        )
        .filter(Boolean),
    ),
  );

  if (!parentIds.length) return { queued: 0, push_dispatched: false };

  const occurredAt = new Date().toISOString();
  const visitDate = String(visit.visit_date || "");
  const entryTime = String(visit.entry_time || "").slice(0, 5);
  const exitTime = visit.exit_time ? String(visit.exit_time).slice(0, 5) : null;
  const timeLabel = exitTime ? `${entryTime} - ${exitTime}` : `depuis ${entryTime}`;
  const conditionDescription = cleanText(
    visit.condition_description || visit.reason_details || "",
    280,
  );
  const rest = restText(visit);
  const title = `Infirmerie — ${studentName}`;
  const body = [
    classLabel || "",
    visitDate,
    timeLabel,
    conditionDescription ? `Motif : ${conditionDescription}` : "",
    rest,
    `Billet : ${visit.receipt_code}`,
  ]
    .filter(Boolean)
    .join(" • ");

  const payload = {
    kind: "infirmary_visit",
    event: "infirmary_visit_created",
    student: { id: studentId, name: studentName },
    class: { id: visit.class_id ?? null, label: classLabel },
    visit: {
      id: visit.id,
      receipt_code: visit.receipt_code,
      visit_date: visit.visit_date,
      entry_time: visit.entry_time,
      exit_time: visit.exit_time,
      duration_minutes: visit.duration_minutes,
      status: visit.status,
      reason_category: visit.reason_category,
      condition_description: conditionDescription || null,
      rest_start_date: visit.rest_start_date || null,
      rest_end_date: visit.rest_end_date || null,
      rest_days: visit.rest_days ?? null,
    },
    rest: rest || null,
    occurred_at: occurredAt,
    title,
    body,
  };

  const rows = parentIds.map((parentId) => ({
    institution_id: institutionId,
    student_id: studentId,
    parent_id: parentId,
    profile_id: null,
    channels: ["inapp", "push"],
    payload,
    title,
    body,
    status: (process.env.PUSH_WAIT_STATUS || "pending").trim(),
    send_after: occurredAt,
    meta: {
      src: "api:admin:infirmary",
      v: "1",
      visit_id: visit.id,
      receipt_code: visit.receipt_code,
    },
    severity: visit.status === "evacue" ? "warning" : "normal",
  }));

  const { error, count } = await srv
    .from("notifications_queue")
    .insert(rows, { count: "exact" });

  if (error) throw error;

  const pushDispatched = await triggerPushDispatch({
    req,
    reason: `infirmary:${visit.id}`,
    timeoutMs: 1200,
    retries: 1,
  }).catch(() => false);

  return {
    queued: count || rows.length,
    push_dispatched: Boolean(pushDispatched),
  };
}

function normalizeVisit(row: any) {
  const student = row?.students || row?.student || {};
  const klass = row?.classes || row?.class || {};

  return {
    id: row.id,
    institution_id: row.institution_id,
    academic_year: row.academic_year,
    student_id: row.student_id,
    class_id: row.class_id,
    receipt_code: row.receipt_code,
    visit_date: row.visit_date,
    entry_time: row.entry_time,
    exit_time: row.exit_time,
    duration_minutes: row.duration_minutes,
    reason_category: row.reason_category,
    reason_details: row.reason_details,
    condition_description: row.condition_description ?? row.reason_details ?? null,
    rest_start_date: row.rest_start_date ?? null,
    rest_end_date: row.rest_end_date ?? null,
    rest_days: row.rest_days ?? null,
    action_taken: row.action_taken,
    status: row.status,
    notify_parent_requested: row.notify_parent_requested,
    parent_notified: row.parent_notified,
    parent_notified_at: row.parent_notified_at,
    notification_count: row.notification_count ?? 0,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    student_name: studentFullName(student),
    student_matricule: student?.matricule ?? null,
    class_label: klass?.label ?? null,
    class_level: klass?.level ?? null,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await requireInstitution();
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
  const classId = cleanText(url.searchParams.get("class_id"), 80);
  const studentId = cleanText(url.searchParams.get("student_id"), 80);
  const from = cleanText(url.searchParams.get("from"), 20);
  const to = cleanText(url.searchParams.get("to"), 20);

  let query = srv
    .from("infirmary_visits")
    .select(
      `
      *,
      students:student_id ( id, first_name, last_name, full_name, matricule ),
      classes:class_id ( id, label, level )
    `,
    )
    .eq("institution_id", institutionId);

  if (classId) query = query.eq("class_id", classId);
  if (studentId) query = query.eq("student_id", studentId);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("visit_date", from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("visit_date", to);

  const { data, error } = await query
    .order("visit_date", { ascending: false })
    .order("entry_time", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, items: (data || []).map(normalizeVisit) });
}

export async function POST(req: NextRequest) {
  const ctx = await requireInstitution();
  if ("error" in ctx) return ctx.error;

  const { srv, userId, institutionId } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const studentId = cleanText(body.student_id, 80);
  const classId = cleanText(body.class_id, 80);
  const visitDate = onlyYmd(body.visit_date);
  const entryTime = onlyTime(body.entry_time);
  const exitTime = onlyTime(body.exit_time);
  const reasonCategoryRaw = cleanText(body.reason_category, 80) || "autre";
  const reasonCategory = REASON_VALUES.has(reasonCategoryRaw) ? reasonCategoryRaw : "autre";
  const statusRaw = cleanText(body.status, 80) || "observation";
  const status = STATUS_VALUES.has(statusRaw) ? statusRaw : "observation";
  const conditionDescription = cleanText(
    (body as any).condition_description ?? body.reason_details,
    1200,
  );
  const reasonDetails = conditionDescription || cleanText(body.reason_details, 800) || null;
  const actionTaken = cleanText(body.action_taken, 1200) || null;
  const notes = cleanText(body.notes, 1200) || null;
  const restStartDate = optionalYmd((body as any).rest_start_date);
  const restEndDate = optionalYmd((body as any).rest_end_date);
  const restDays = inclusiveDays(restStartDate, restEndDate);
  const notifyParent = body.notify_parent === true;

  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Élève obligatoire." }, { status: 400 });
  }

  if (!entryTime) {
    return NextResponse.json({ ok: false, error: "Heure d'entrée obligatoire." }, { status: 400 });
  }

  if (!conditionDescription) {
    return NextResponse.json(
      { ok: false, error: "Merci d'indiquer ce dont souffre l'enfant ou le constat fait à l'infirmerie." },
      { status: 400 },
    );
  }

  if ((restStartDate && !restEndDate) || (!restStartDate && restEndDate)) {
    return NextResponse.json(
      { ok: false, error: "Merci d'indiquer le début et la fin du repos." },
      { status: 400 },
    );
  }

  if (restStartDate && restEndDate && restDays === null) {
    return NextResponse.json(
      { ok: false, error: "La date de fin du repos doit être après la date de début." },
      { status: 400 },
    );
  }

  let enrollmentQuery = srv
    .from("class_enrollments")
    .select(
      `
      student_id,
      class_id,
      institution_id,
      students:student_id ( id, first_name, last_name, full_name, matricule, institution_id ),
      classes:class_id ( id, label, level, institution_id, academic_year )
    `,
    )
    .eq("institution_id", institutionId)
    .eq("student_id", studentId)
    .is("end_date", null);

  if (classId) enrollmentQuery = enrollmentQuery.eq("class_id", classId);

  const { data: enrollment, error: enrollmentErr } = await enrollmentQuery
    .limit(1)
    .maybeSingle();

  if (enrollmentErr) {
    return NextResponse.json({ ok: false, error: enrollmentErr.message }, { status: 400 });
  }

  if (!enrollment) {
    return NextResponse.json({ ok: false, error: "Élève introuvable dans cet établissement." }, { status: 404 });
  }

  const resolvedClassId = classId || String((enrollment as any).class_id || "");
  if (classId && String((enrollment as any).class_id || "") !== classId) {
    return NextResponse.json(
      { ok: false, error: "La classe sélectionnée ne correspond pas à l'élève." },
      { status: 400 },
    );
  }

  const academicYear =
    String((enrollment as any)?.classes?.academic_year || "").trim() ||
    (await getCurrentAcademicYear(institutionId));

  const duration = exitTime ? minutesBetween(entryTime, exitTime) : null;
  if (exitTime && duration === null) {
    return NextResponse.json(
      { ok: false, error: "L'heure de sortie doit être après l'heure d'entrée." },
      { status: 400 },
    );
  }

  const payload = {
    institution_id: institutionId,
    academic_year: academicYear,
    student_id: studentId,
    class_id: resolvedClassId || null,
    created_by: userId,
    receipt_code: randomReceiptCode(visitDate),
    visit_date: visitDate,
    entry_time: entryTime,
    exit_time: exitTime || null,
    duration_minutes: duration,
    reason_category: reasonCategory,
    reason_details: reasonDetails,
    condition_description: conditionDescription,
    rest_start_date: restStartDate,
    rest_end_date: restEndDate,
    rest_days: restDays,
    action_taken: actionTaken,
    status,
    notify_parent_requested: notifyParent,
    parent_notified: false,
    notification_count: 0,
    notes,
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await srv
    .from("infirmary_visits")
    .insert(payload)
    .select(
      `
      *,
      students:student_id ( id, first_name, last_name, full_name, matricule ),
      classes:class_id ( id, label, level )
    `,
    )
    .single();

  if (insertErr) {
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 400 });
  }

  const student = (inserted as any)?.students || (enrollment as any)?.students || {};
  const klass = (inserted as any)?.classes || (enrollment as any)?.classes || {};
  const studentName = studentFullName(student);
  const classLabel = klass?.label ? String(klass.label) : null;

  let notification = { queued: 0, push_dispatched: false };
  let finalRow = inserted;

  if (notifyParent) {
    try {
      notification = await queueParentInfirmaryNotification({
        req,
        srv,
        institutionId,
        visit: inserted,
        studentName,
        classLabel,
      });

      if (notification.queued > 0) {
        const { data: updated } = await srv
          .from("infirmary_visits")
          .update({
            parent_notified: true,
            parent_notified_at: new Date().toISOString(),
            notification_count: notification.queued,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (inserted as any).id)
          .select(
            `
            *,
            students:student_id ( id, first_name, last_name, full_name, matricule ),
            classes:class_id ( id, label, level )
          `,
          )
          .single();

        if (updated) finalRow = updated;
      }
    } catch (e: any) {
      console.warn("[admin/infirmary] notification_error", String(e?.message || e));
      notification = { queued: 0, push_dispatched: false };
    }
  }

  return NextResponse.json({
    ok: true,
    item: normalizeVisit(finalRow),
    notification,
    message:
      notifyParent && notification.queued === 0
        ? "Passage enregistré. Aucun parent notifiable n'a été trouvé."
        : notifyParent && notification.queued > 0
          ? "Passage enregistré. Alerte parent créée avec le motif et le billet d'infirmerie."
          : "Passage infirmerie enregistré.",
  });
}
