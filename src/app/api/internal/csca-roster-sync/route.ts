import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_HASH = "6020ebd6cd3effa082e56a95192154e53fc751b4af8baa140127fa7b6cbcf59f";
const INSTITUTION_CODE = "000657";
const ACADEMIC_YEAR = "2026-2027";
const ALLOWED_CLASS_CODES = new Set([
  "5e1", "5e2",
  "4e1", "4e2", "4e3",
  "3e1", "3e2", "3e3",
  "1a1", "1d1",
  "t-d1", "t-d2", "ta1", "ta2",
]);
const PROTECTED_CLASS_CODES = new Set([
  "6e1", "6e2",
  "2a1", "2c1", "2dea", "2de-c",
]);

type InputRecord = {
  matricule?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  class_code?: string | null;
  is_boarder?: boolean | null;
  affectation_status?: "affecte" | "non_affecte" | "reaffecte" | "transfere" | null;
  lv2?: "ESP" | "ALL" | null;
  source?: string | null;
};

type Issue = {
  source?: string | null;
  matricule?: string | null;
  name?: string;
  reason: string;
  detail?: string;
};

function norm(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMatricule(value: unknown) {
  const v = String(value ?? "").trim().toUpperCase();
  return v || null;
}

function namesCompatible(a: string, b: string) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function authorized(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  const raw = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!raw) return false;
  const got = createHash("sha256").update(raw).digest();
  const expected = Buffer.from(TOKEN_HASH, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "commit" ? "commit" : "dry_run";
  const rawRecords = Array.isArray(body?.records) ? body.records : [];
  if (!rawRecords.length || rawRecords.length > 500) {
    return NextResponse.json({ error: "invalid_records_count" }, { status: 400 });
  }

  const records: InputRecord[] = rawRecords.map((r: any) => ({
    matricule: cleanMatricule(r?.matricule),
    last_name: String(r?.last_name ?? "").trim(),
    first_name: String(r?.first_name ?? "").trim(),
    class_code: String(r?.class_code ?? "").trim(),
    is_boarder: typeof r?.is_boarder === "boolean" ? r.is_boarder : null,
    affectation_status: ["affecte", "non_affecte", "reaffecte", "transfere"].includes(String(r?.affectation_status || ""))
      ? r.affectation_status
      : null,
    lv2: ["ESP", "ALL"].includes(String(r?.lv2 || "").toUpperCase())
      ? String(r.lv2).toUpperCase() as "ESP" | "ALL"
      : null,
    source: String(r?.source ?? "").trim() || null,
  }));

  const issues: Issue[] = [];
  const actions: any[] = [];
  const srv = getSupabaseServiceClient();

  const { data: inst, error: instErr } = await srv
    .from("institutions")
    .select("id,code_unique,code,name")
    .or(`code_unique.eq.${INSTITUTION_CODE},code.eq.${INSTITUTION_CODE}`)
    .limit(1)
    .maybeSingle();
  if (instErr || !inst?.id) {
    return NextResponse.json({ error: instErr?.message || "institution_not_found" }, { status: 400 });
  }
  const instId = String(inst.id);

  const { data: ay, error: ayErr } = await srv
    .from("academic_years")
    .select("id,code,start_date")
    .eq("institution_id", instId)
    .eq("code", ACADEMIC_YEAR)
    .maybeSingle();
  if (ayErr || !ay?.id) {
    return NextResponse.json({ error: ayErr?.message || "academic_year_not_found" }, { status: 400 });
  }
  const academicYearId = String(ay.id);
  const enrollmentStart = String(ay.start_date || "2026-09-09");

  const { data: allClasses, error: classErr } = await srv
    .from("classes")
    .select("id,code,label,level,academic_year,official_track_code")
    .eq("institution_id", instId);
  if (classErr) return NextResponse.json({ error: classErr.message }, { status: 400 });

  const classesByCode = new Map<string, any>();
  const classesById = new Map<string, any>();
  for (const c of allClasses || []) {
    classesById.set(String(c.id), c);
    if (String(c.academic_year) === ACADEMIC_YEAR) classesByCode.set(String(c.code), c);
  }

  for (const code of ALLOWED_CLASS_CODES) {
    if (!classesByCode.has(code)) {
      return NextResponse.json({ error: "target_class_missing", class_code: code }, { status: 400 });
    }
  }

  const { data: students, error: studentsErr } = await srv
    .from("students")
    .select("id,matricule,last_name,first_name,full_name,full_name_key,is_boarder,is_affecte,lv2,lifecycle_status")
    .eq("institution_id", instId);
  if (studentsErr) return NextResponse.json({ error: studentsErr.message }, { status: 400 });

  const studentRows = students || [];
  const byMatricule = new Map<string, any>();
  const byName = new Map<string, any[]>();
  for (const s of studentRows) {
    const m = cleanMatricule(s.matricule);
    if (m) byMatricule.set(m, s);
    const key = norm(`${s.last_name || ""} ${s.first_name || ""}`);
    if (key) {
      const arr = byName.get(key) || [];
      arr.push(s);
      byName.set(key, arr);
    }
  }

  const { data: activeEnrollments, error: activeErr } = await srv
    .from("class_enrollments")
    .select("id,student_id,class_id,start_date,end_date")
    .eq("institution_id", instId)
    .is("end_date", null);
  if (activeErr) return NextResponse.json({ error: activeErr.message }, { status: 400 });
  const activeByStudent = new Map<string, any>();
  for (const e of activeEnrollments || []) activeByStudent.set(String(e.student_id), e);

  const { data: yearProfiles, error: ypErr } = await srv
    .from("student_year_profiles")
    .select("id,student_id,class_id,level,is_boarder,boarding_status_raw,affectation_status,affectation_status_raw,billing_affectation_group,scholarship_status,guardian_phone,source,source_payload,notes")
    .eq("institution_id", instId)
    .eq("academic_year_id", academicYearId);
  if (ypErr) return NextResponse.json({ error: ypErr.message }, { status: 400 });
  const profileByStudent = new Map<string, any>();
  for (const p of yearProfiles || []) profileByStudent.set(String(p.student_id), p);

  const matriculeCounts = new Map<string, number>();
  for (const r of records) {
    const m = cleanMatricule(r.matricule);
    if (m) matriculeCounts.set(m, (matriculeCounts.get(m) || 0) + 1);
  }

  let created = 0;
  let enriched = 0;
  let classChanged = 0;
  let alreadyCorrect = 0;
  let profilesUpdated = 0;
  let skipped = 0;

  for (const r of records) {
    const matricule = cleanMatricule(r.matricule);
    const inputName = norm(`${r.last_name || ""} ${r.first_name || ""}`);
    const displayName = `${r.last_name || ""} ${r.first_name || ""}`.trim();
    const source = r.source || null;
    const classCode = String(r.class_code || "").trim();

    const fail = (reason: string, detail?: string) => {
      skipped++;
      issues.push({ source, matricule, name: displayName, reason, detail });
    };

    if (!ALLOWED_CLASS_CODES.has(classCode)) {
      fail("class_not_allowed", classCode || "empty");
      continue;
    }
    if (!matricule) {
      fail("missing_matricule");
      continue;
    }
    if ((matriculeCounts.get(matricule) || 0) > 1) {
      fail("duplicate_matricule_in_input");
      continue;
    }
    if (!inputName) {
      fail("missing_name");
      continue;
    }

    const targetClass = classesByCode.get(classCode)!;
    let student = byMatricule.get(matricule) || null;
    let resolution = "matricule";
    let mustFillMatricule = false;

    if (student) {
      const dbName = norm(`${student.last_name || ""} ${student.first_name || ""}`);
      if (!namesCompatible(dbName, inputName)) {
        fail("matricule_name_conflict", `${student.last_name || ""} ${student.first_name || ""}`.trim());
        continue;
      }
    } else {
      const nameMatches = byName.get(inputName) || [];
      if (nameMatches.length > 1) {
        fail("ambiguous_exact_name", `${nameMatches.length} matches`);
        continue;
      }
      if (nameMatches.length === 1) {
        const candidate = nameMatches[0];
        const existingMatricule = cleanMatricule(candidate.matricule);
        if (existingMatricule && existingMatricule !== matricule) {
          fail("name_matches_different_matricule", existingMatricule);
          continue;
        }
        student = candidate;
        resolution = "unique_exact_name";
        mustFillMatricule = !existingMatricule;
      } else {
        resolution = "new";
      }
    }

    if (student) {
      if (String(student.lifecycle_status || "active") !== "active") {
        fail("student_not_active", String(student.lifecycle_status || ""));
        continue;
      }
      const active = activeByStudent.get(String(student.id));
      if (active) {
        const activeClass = classesById.get(String(active.class_id));
        const activeCode = String(activeClass?.code || "");
        if (PROTECTED_CLASS_CODES.has(activeCode)) {
          fail("protected_6e_or_seconde", activeCode);
          continue;
        }
      }
    }

    const planned = {
      source,
      matricule,
      name: displayName,
      class_code: classCode,
      resolution,
      action: student ? "update" : "create",
    };
    actions.push(planned);

    if (mode === "dry_run") continue;

    if (!student) {
      const newRow: any = {
        institution_id: instId,
        matricule,
        last_name: String(r.last_name || "").trim(),
        first_name: String(r.first_name || "").trim(),
        full_name: displayName,
        full_name_key: inputName,
        lifecycle_status: "active",
      };
      if (typeof r.is_boarder === "boolean") newRow.is_boarder = r.is_boarder;
      if (r.affectation_status === "affecte" || r.affectation_status === "reaffecte") newRow.is_affecte = true;
      if (r.affectation_status === "non_affecte") newRow.is_affecte = false;
      if (r.lv2) newRow.lv2 = r.lv2;

      const { data: inserted, error: insertErr } = await srv
        .from("students")
        .insert(newRow)
        .select("id,matricule,last_name,first_name,full_name,full_name_key,is_boarder,is_affecte,lv2,lifecycle_status")
        .single();
      if (insertErr || !inserted?.id) {
        fail("insert_failed", insertErr?.message || "no_id");
        continue;
      }
      student = inserted;
      byMatricule.set(matricule, student);
      const arr = byName.get(inputName) || [];
      arr.push(student);
      byName.set(inputName, arr);
      created++;
    } else {
      const patch: any = {};
      if (mustFillMatricule) patch.matricule = matricule;
      if (typeof r.is_boarder === "boolean") patch.is_boarder = r.is_boarder;
      if (r.affectation_status === "affecte" || r.affectation_status === "reaffecte") patch.is_affecte = true;
      if (r.affectation_status === "non_affecte") patch.is_affecte = false;
      if (r.lv2) patch.lv2 = r.lv2;
      if (Object.keys(patch).length) {
        const { error: updErr } = await srv.from("students").update(patch).eq("id", student.id);
        if (updErr) {
          fail("student_update_failed", updErr.message);
          continue;
        }
        enriched++;
      }
    }

    const studentId = String(student.id);
    const active = activeByStudent.get(studentId) || null;
    if (active && String(active.class_id) === String(targetClass.id)) {
      alreadyCorrect++;
    } else {
      if (active) {
        const activeStart = String(active.start_date || enrollmentStart);
        const endDate = activeStart > enrollmentStart ? activeStart : enrollmentStart;
        const { error: closeErr } = await srv
          .from("class_enrollments")
          .update({ end_date: endDate })
          .eq("id", active.id);
        if (closeErr) {
          fail("close_previous_enrollment_failed", closeErr.message);
          continue;
        }
      }

      const { data: existingTarget, error: existingTargetErr } = await srv
        .from("class_enrollments")
        .select("id,start_date,end_date")
        .eq("institution_id", instId)
        .eq("student_id", studentId)
        .eq("class_id", targetClass.id)
        .maybeSingle();
      if (existingTargetErr) {
        fail("target_enrollment_lookup_failed", existingTargetErr.message);
        continue;
      }

      if (existingTarget?.id) {
        const { error: reactivateErr } = await srv
          .from("class_enrollments")
          .update({ end_date: null })
          .eq("id", existingTarget.id);
        if (reactivateErr) {
          fail("target_enrollment_reactivate_failed", reactivateErr.message);
          continue;
        }
        activeByStudent.set(studentId, { ...existingTarget, student_id: studentId, class_id: targetClass.id, end_date: null });
      } else {
        const { data: insertedEnrollment, error: enrollErr } = await srv
          .from("class_enrollments")
          .insert({
            institution_id: instId,
            student_id: studentId,
            class_id: targetClass.id,
            start_date: enrollmentStart,
            end_date: null,
            official_track_code: targetClass.official_track_code || null,
          })
          .select("id,student_id,class_id,start_date,end_date")
          .single();
        if (enrollErr || !insertedEnrollment?.id) {
          fail("target_enrollment_insert_failed", enrollErr?.message || "no_id");
          continue;
        }
        activeByStudent.set(studentId, insertedEnrollment);
      }
      classChanged++;
    }

    const existingProfile = profileByStudent.get(studentId) || null;
    const status = r.affectation_status || existingProfile?.affectation_status || "unknown";
    const billingGroup = r.affectation_status === "transfere"
      ? "transfere"
      : (r.affectation_status === "affecte" || r.affectation_status === "reaffecte")
        ? "affecte"
        : r.affectation_status === "non_affecte"
          ? "non_affecte"
          : existingProfile?.billing_affectation_group || "unknown";
    const boarder = typeof r.is_boarder === "boolean"
      ? r.is_boarder
      : (typeof existingProfile?.is_boarder === "boolean" ? existingProfile.is_boarder : Boolean(student.is_boarder));

    const profileRow: any = {
      institution_id: instId,
      academic_year_id: academicYearId,
      academic_year: ACADEMIC_YEAR,
      student_id: studentId,
      class_id: targetClass.id,
      level: targetClass.level || classCode,
      is_boarder: boarder,
      boarding_status_raw: r.is_boarder === true ? "interne" : (existingProfile?.boarding_status_raw || null),
      affectation_status: status,
      affectation_status_raw: r.affectation_status || existingProfile?.affectation_status_raw || null,
      billing_affectation_group: billingGroup,
      scholarship_status: existingProfile?.scholarship_status || "unknown",
      guardian_phone: existingProfile?.guardian_phone || null,
      source: "xlsx_csca_20260827",
      source_payload: {
        ...(existingProfile?.source_payload || {}),
        source: source || null,
      },
      notes: existingProfile?.notes || null,
    };

    const { data: profileUpsert, error: profileErr } = await srv
      .from("student_year_profiles")
      .upsert(profileRow, { onConflict: "institution_id,academic_year_id,student_id" })
      .select("id,student_id,class_id")
      .single();
    if (profileErr || !profileUpsert?.id) {
      fail("student_year_profile_upsert_failed", profileErr?.message || "no_id");
      continue;
    }
    profileByStudent.set(studentId, { ...existingProfile, ...profileRow, id: profileUpsert.id });
    profilesUpdated++;
  }

  return NextResponse.json({
    mode,
    institution: { id: instId, code: INSTITUTION_CODE, name: inst.name },
    academic_year: ACADEMIC_YEAR,
    input_rows: records.length,
    summary: { created, enriched, classChanged, alreadyCorrect, profilesUpdated, skipped, issues: issues.length },
    issues,
    actions: actions.slice(0, 500),
  });
}
