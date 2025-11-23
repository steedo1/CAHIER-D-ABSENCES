import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoleRow = {
  role: string;
  institution_id: string | null;
};

type JustifItem = {
  mark_id: string;
  student_id: string;
  student_name: string;
  matricule: string | null;
  class_id: string;
  class_label: string | null;
  class_level: string | null;
  subject_id: string | null;
  subject_name: string | null;
  started_at: string;
  status: string;
  minutes: number;
  minutes_late: number;
  reason: string | null;
};

type JustifyBody = {
  items: Array<{ mark_id: string; reason: string }>;
};

const ALLOWED_ROLES = new Set(["super_admin", "admin", "educator"]);
const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

function pickInstitutions(roles: RoleRow[]) {
  const ids = new Set<string>();
  for (const r of roles) {
    if (ALLOWED_ROLES.has(String(r.role)) && r.institution_id) {
      ids.add(String(r.institution_id));
    }
  }
  return Array.from(ids);
}

function endOfDayPlus1(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// ─────────────────── Notifications "justifié" ───────────────────

async function enqueueJustifiedNotifications(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  markIds: string[],
  instIds: string[],
  reasonByMarkId: Map<string, string>,
) {
  if (!markIds.length || !instIds.length) return;

  const { data: marks, error: vmErr } = await srv
    .from("v_mark_minutes")
    .select(
      "id,institution_id,student_id,class_id,subject_id,session_id,started_at,expected_minutes,status,minutes_late",
    )
    .in("id", markIds)
    .in("institution_id", instIds);

  if (vmErr) {
    console.warn("[attendance.unjustified] enqueueJustified vmErr", vmErr.message);
    return;
  }
  if (!marks || !marks.length) return;

  const studentIds = new Set<string>();
  const classIds = new Set<string>();
  const subjectIds = new Set<string>();
  for (const m of marks as any[]) {
    if (m.student_id) studentIds.add(String(m.student_id));
    if (m.class_id) classIds.add(String(m.class_id));
    if (m.subject_id) subjectIds.add(String(m.subject_id));
  }

  // Élèves
  const { data: students, error: studentsErr } = await srv
    .from("students")
    .select("id, first_name, last_name")
    .in("id", Array.from(studentIds));
  if (studentsErr) {
    console.warn(
      "[attendance.unjustified] enqueueJustified studentsErr",
      studentsErr.message,
    );
    return;
  }
  const studentNameById = new Map<string, string>();
  for (const s of students || []) {
    const id = String((s as any).id);
    const fn = (s as any).first_name ?? "";
    const ln = (s as any).last_name ?? "";
    const full = [ln, fn].filter(Boolean).join(" ").trim() || "Élève";
    studentNameById.set(id, full);
  }

  // Classes
  const { data: classes, error: classesErr } = await srv
    .from("classes")
    .select("id,label")
    .in("id", Array.from(classIds));
  if (classesErr) {
    console.warn(
      "[attendance.unjustified] enqueueJustified classesErr",
      classesErr.message,
    );
    return;
  }
  const classLabelById = new Map<string, string>();
  for (const c of classes || []) {
    const id = String((c as any).id);
    const lab = (c as any).label ?? "";
    classLabelById.set(id, lab);
  }

  // Matières de base
  const subjectNameBaseById = new Map<string, string | null>();
  if (subjectIds.size) {
    const { data: subjects, error: subjectsErr } = await srv
      .from("subjects")
      .select("id,name")
      .in("id", Array.from(subjectIds));
    if (subjectsErr) {
      console.warn(
        "[attendance.unjustified] enqueueJustified subjectsErr",
        subjectsErr.message,
      );
    } else {
      for (const s of subjects || []) {
        subjectNameBaseById.set(
          String((s as any).id),
          (s as any).name ?? null,
        );
      }
    }
  }

  // Noms personnalisés
  const instSubjectNameBySubjectId = new Map<string, string | null>();
  if (subjectIds.size) {
    const { data: instSubjects, error: instSubjectsErr } = await srv
      .from("institution_subjects")
      .select("subject_id,custom_name,institution_id")
      .in("institution_id", instIds)
      .in("subject_id", Array.from(subjectIds));
    if (instSubjectsErr) {
      console.warn(
        "[attendance.unjustified] enqueueJustified instSubjectsErr",
        instSubjectsErr.message,
      );
    } else {
      for (const is of instSubjects || []) {
        instSubjectNameBySubjectId.set(
          String((is as any).subject_id),
          (is as any).custom_name ?? null,
        );
      }
    }
  }

  const nowIso = new Date().toISOString();
  const { data: existing, error: existingErr } = await srv
    .from("notifications_queue")
    .select("id,mark_id,meta")
    .in("mark_id", markIds);

  const already = new Set<string>();
  if (existingErr) {
    console.warn(
      "[attendance.unjustified] enqueueJustified existingErr",
      existingErr.message,
    );
  } else {
    for (const row of existing || []) {
      const mid = String((row as any).mark_id || "");
      const metaRaw = (row as any).meta;
      let meta: any = metaRaw;
      if (metaRaw && typeof metaRaw === "string") {
        try {
          meta = JSON.parse(metaRaw);
        } catch {
          meta = {};
        }
      }
      if (meta && meta.kind === "attendance_justified") {
        already.add(mid);
      }
    }
  }

  const rowsToInsert: any[] = [];

  for (const m of marks as any[]) {
    const markId = String(m.id);
    if (already.has(markId)) continue;

    const reason = (reasonByMarkId.get(markId) || "").trim();
    if (!reason) continue;

    const institution_id = String(m.institution_id);
    const student_id = String(m.student_id);
    const class_id = String(m.class_id);
    const subject_id = m.subject_id ? String(m.subject_id) : null;

    const studentName = studentNameById.get(student_id) || "Élève";
    const classLabel = classLabelById.get(class_id) || "";

    const baseSubj = subject_id ? subjectNameBaseById.get(subject_id) || "" : "";
    const customSubj = subject_id
      ? instSubjectNameBySubjectId.get(subject_id) || ""
      : "";
    const subjectName = (customSubj || baseSubj || "").trim() || "Discipline";

    const status: string = String(m.status || "");
    const minutesLate: number = Number(m.minutes_late ?? 0);
    const started_at: string = m.started_at;
    const expectedMinutes: number | null = m.expected_minutes ?? null;

    const occurred_at = nowIso;

    const payload: any = {
      kind: "attendance",
      event: status === "late" ? "late" : "absent",
      action: "justified",
      justified: true,
      student: {
        id: student_id,
        name: studentName,
      },
      class: {
        id: class_id,
        label: classLabel || null,
      },
      subject: {
        id: subject_id,
        name: subjectName,
      },
      session: {
        id: m.session_id,
        started_at,
        expected_minutes: expectedMinutes,
      },
      reason,
      occurred_at,
      severity: "normal",
      minutes_late: minutesLate,
    };

    const whenText = (() => {
      try {
        return new Date(started_at).toLocaleString("fr-FR", {
          timeZone: "Africa/Abidjan",
          hour12: false,
        });
      } catch {
        return started_at;
      }
    })();

    let title: string;
    let body: string;
    if (status === "late") {
      title = `Retard justifié — ${studentName}`;
      const parts = [
        subjectName,
        classLabel,
        whenText,
        minutesLate ? `${minutesLate} min` : "",
        "Justifié",
        reason ? `Motif : ${reason}` : "",
      ].filter(Boolean);
      body = parts.join(" • ");
    } else {
      title = `Absence justifiée — ${studentName}`;
      const parts = [
        subjectName,
        classLabel,
        whenText,
        "Justifiée",
        reason ? `Motif : ${reason}` : "",
      ].filter(Boolean);
      body = parts.join(" • ");
    }

    rowsToInsert.push({
      institution_id,
      student_id,
      session_id: m.session_id,
      mark_id: markId,
      parent_id: null,
      profile_id: null,
      channels: ["inapp", "push"],
      channel: null,
      payload,
      status: WAIT_STATUS,
      attempts: 0,
      last_error: null,
      title,
      body,
      send_after: nowIso,
      meta: {
        kind: "attendance_justified",
        mark_id: markId,
        student_id,
        class_id,
        subject_id,
      },
      severity: "normal",
    });
  }

  if (!rowsToInsert.length) return;

  const { error: insErr } = await srv
    .from("notifications_queue")
    .insert(rowsToInsert);

  if (insErr) {
    console.error(
      "[attendance.unjustified] enqueueJustified insertErr",
      insErr.message,
    );
  }
}

// ───────────────────── GET : liste des absences/retards ─────────────────────

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const srv = getSupabaseServiceClient();

    const { data: rawRoles, error: rolesErr } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);

    if (rolesErr)
      return NextResponse.json({ error: rolesErr.message }, { status: 400 });

    const roles = (rawRoles || []) as RoleRow[];
    const instIds = pickInstitutions(roles);
    if (instIds.length === 0) {
      return NextResponse.json(
        { error: "no_institution_scope" },
        { status: 403 },
      );
    }

    const institution_id = instIds[0];

    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const class_id = url.searchParams.get("class_id") || "";
    const statusParam = url.searchParams.get("status") || "all";
    const onlyUnjustified =
      (url.searchParams.get("only_unjustified") || "1") === "1";

    let q = srv
      .from("v_mark_minutes")
      .select(
        "id, student_id, status, minutes_late, minutes, session_id, class_id, subject_id, started_at, expected_minutes",
      )
      .eq("institution_id", institution_id);

    if (statusParam === "absent") {
      q = q.eq("status", "absent");
    } else if (statusParam === "late") {
      q = q.neq("status", "present").neq("status", "absent");
    } else {
      q = q.neq("status", "present");
    }

    if (class_id) q = q.eq("class_id", class_id);
    if (from) q = q.gte("started_at", from);
    if (to) q = q.lt("started_at", endOfDayPlus1(to));

    q = q.order("started_at", { ascending: false }).limit(500);

    const { data: rows, error: marksErr } = await q;
    if (marksErr)
      return NextResponse.json({ error: marksErr.message }, { status: 400 });

    if (!rows || rows.length === 0) {
      return NextResponse.json({ items: [] satisfies JustifItem[] });
    }

    const markIds = Array.from(
      new Set(rows.map((r: any) => String(r.id)).filter(Boolean)),
    );
    const studentIds = Array.from(
      new Set(rows.map((r: any) => String(r.student_id)).filter(Boolean)),
    );
    const classIds = Array.from(
      new Set(rows.map((r: any) => String(r.class_id)).filter(Boolean)),
    );
    const subjectIds = Array.from(
      new Set(rows.map((r: any) => String(r.subject_id)).filter(Boolean)),
    );

    // Justifs
    const { data: marksInfo, error: marksInfoErr } = await srv
      .from("attendance_marks")
      .select("id, reason")
      .in("id", markIds);

    if (marksInfoErr)
      return NextResponse.json(
        { error: marksInfoErr.message },
        { status: 400 },
      );

    const reasonById = new Map<string, string | null>();
    for (const m of marksInfo || []) {
      reasonById.set(String(m.id), (m as any).reason ?? null);
    }

    // Élèves
    const { data: students, error: studentsErr } = await srv
      .from("students")
      .select("id, first_name, last_name, matricule")
      .in("id", studentIds);

    if (studentsErr)
      return NextResponse.json(
        { error: studentsErr.message },
        { status: 400 },
      );

    const studentsById = new Map<
      string,
      { first_name: string | null; last_name: string | null; matricule: string | null }
    >();
    for (const s of students || []) {
      studentsById.set(String(s.id), {
        first_name: (s as any).first_name ?? null,
        last_name: (s as any).last_name ?? null,
        matricule: (s as any).matricule ?? null,
      });
    }

    // Classes
    const { data: classes, error: classesErr } = await srv
      .from("classes")
      .select("id, label, level")
      .in("id", classIds);

    if (classesErr)
      return NextResponse.json(
        { error: classesErr.message },
        { status: 400 },
      );

    const classesById = new Map<
      string,
      { label: string | null; level: string | null }
    >();
    for (const c of classes || []) {
      classesById.set(String(c.id), {
        label: (c as any).label ?? null,
        level: (c as any).level ?? null,
      });
    }

    // Matières de base
    const subjectsById = new Map<string, string | null>();
    if (subjectIds.length > 0) {
      const { data: subjects, error: subjectsErr } = await srv
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds);
      if (subjectsErr)
        return NextResponse.json(
          { error: subjectsErr.message },
          { status: 400 },
        );
      for (const s of subjects || []) {
        subjectsById.set(String(s.id), (s as any).name ?? null);
      }
    }

    // Noms personnalisés (2 cas possibles)
    const instSubjectNameByInstId = new Map<string, string | null>();
    const instSubjectNameBySubjectId = new Map<string, string | null>();

    if (subjectIds.length > 0) {
      // Cas 1 : v_mark_minutes.subject_id = institution_subjects.id
      const { data: instById, error: instByIdErr } = await srv
        .from("institution_subjects")
        .select("id, subject_id, custom_name")
        .eq("institution_id", institution_id)
        .in("id", subjectIds);
      if (instByIdErr) {
        return NextResponse.json(
          { error: instByIdErr.message },
          { status: 400 },
        );
      }
      for (const is of instById || []) {
        const instId = String((is as any).id);
        const subjId = String((is as any).subject_id);
        const name = (is as any).custom_name ?? null;
        instSubjectNameByInstId.set(instId, name);
        instSubjectNameBySubjectId.set(subjId, name);
      }

      // Cas 2 : v_mark_minutes.subject_id = subjects.id
      const { data: instBySubj, error: instBySubjErr } = await srv
        .from("institution_subjects")
        .select("id, subject_id, custom_name")
        .eq("institution_id", institution_id)
        .in("subject_id", subjectIds);
      if (instBySubjErr) {
        return NextResponse.json(
          { error: instBySubjErr.message },
          { status: 400 },
        );
      }
      for (const is of instBySubj || []) {
        const instId = String((is as any).id);
        const subjId = String((is as any).subject_id);
        const name = (is as any).custom_name ?? null;
        instSubjectNameByInstId.set(instId, name);
        instSubjectNameBySubjectId.set(subjId, name);
      }
    }

    const items: JustifItem[] = [];

    for (const r of rows as any[]) {
      const mark_id = String(r.id);
      const student_id = String(r.student_id);
      const class_id_row = String(r.class_id);

      const subject_id_raw = r.subject_id ?? null;
      const subject_id = subject_id_raw ? String(subject_id_raw) : null;

      const reason = reasonById.get(mark_id) ?? null;
      if (onlyUnjustified && reason && reason.trim() !== "") {
        continue;
      }

      const student = studentsById.get(student_id) || {
        first_name: null,
        last_name: null,
        matricule: null,
      };
      const klass = classesById.get(class_id_row) || {
        label: null,
        level: null,
      };

      let subject_name: string | null = null;
      if (subject_id) {
        subject_name =
          instSubjectNameByInstId.get(subject_id) ??
          instSubjectNameBySubjectId.get(subject_id) ??
          subjectsById.get(subject_id) ??
          null;
      }

      const fullName = [student.last_name, student.first_name]
        .filter(Boolean)
        .join(" ")
        .trim();

      items.push({
        mark_id,
        student_id,
        student_name: fullName || "—",
        matricule: student.matricule ?? null,
        class_id: class_id_row,
        class_label: klass.label,
        class_level: klass.level,
        subject_id,
        subject_name,
        started_at: r.started_at,
        status: r.status,
        minutes: Number(r.minutes ?? 0),
        minutes_late: Number(r.minutes_late ?? 0),
        reason,
      });
    }

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[admin.attendance.unjustified][GET] fatal", e);
    return NextResponse.json(
      { error: e?.message || "server_error" },
      { status: 500 },
    );
  }
}

// ───────────────────── POST : justification ─────────────────────

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const srv = getSupabaseServiceClient();

    const { data: rawRoles, error: rolesErr } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);
    if (rolesErr)
      return NextResponse.json({ error: rolesErr.message }, { status: 400 });

    const roles = (rawRoles || []) as RoleRow[];
    const instIds = pickInstitutions(roles);
    if (instIds.length === 0) {
      return NextResponse.json(
        { error: "no_institution_scope" },
        { status: 403 },
      );
    }

    let body: JustifyBody;
    try {
      body = (await req.json()) as JustifyBody;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const payload =
      Array.isArray(body.items) && body.items.length > 0 ? body.items : [];
    const cleaned = payload
      .map((it) => ({
        mark_id: String(it?.mark_id || "").trim(),
        reason: String(it?.reason ?? "").trim(),
      }))
      .filter((it) => it.mark_id.length > 0);

    if (cleaned.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const markIds = Array.from(new Set(cleaned.map((c) => c.mark_id)));

    const { data: owned, error: ownedErr } = await srv
      .from("v_mark_minutes")
      .select("id,institution_id")
      .in("id", markIds)
      .in("institution_id", instIds);

    if (ownedErr)
      return NextResponse.json({ error: ownedErr.message }, { status: 400 });

    const allowedMarkIds = new Set<string>(
      (owned || []).map((o: any) => String(o.id)),
    );

    let updated = 0;
    const reasonByMarkId = new Map<string, string>();
    for (const c of cleaned) {
      if (c.reason) reasonByMarkId.set(c.mark_id, c.reason);
    }

    for (const item of cleaned) {
      if (!allowedMarkIds.has(item.mark_id)) continue;

      const { error: updErr } = await srv
        .from("attendance_marks")
        .update({ reason: item.reason || null })
        .eq("id", item.mark_id);

      if (!updErr) {
        updated += 1;
      } else {
        console.warn(
          "[admin.attendance.unjustified][POST] update error",
          item.mark_id,
          updErr,
        );
      }
    }

    const toNotifyIds = markIds.filter(
      (id) => allowedMarkIds.has(id) && !!reasonByMarkId.get(id),
    );
    if (toNotifyIds.length) {
      await enqueueJustifiedNotifications(
        srv,
        toNotifyIds,
        instIds,
        reasonByMarkId,
      );
    }

    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    console.error("[admin.attendance.unjustified][POST] fatal", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "server_error" },
      { status: 500 },
    );
  }
}
