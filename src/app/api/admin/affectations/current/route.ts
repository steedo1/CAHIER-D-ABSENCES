//src/app/api/admin/affectations/current/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { isEducationType } from "@/lib/education-organization";

type CurrentItem = {
  teacher: { id: string; display_name: string | null; email: string | null; phone: string | null };
  subject: { id: string | null; label: string };
  classes: Array<{
    id: string;
    name: string | null;
    level: string | null;
    academic_year?: string | null;
    education_type?: string | null;
    formation_code?: string | null;
    formation_level_code?: string | null;
  }>;
};

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();
const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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

  if (current?.code) return String(current.code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.code ? String(latest.code) : null;
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  // Auth
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Institution
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { data: callerRoles, error: callerRolesError } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (callerRolesError) {
    return NextResponse.json(
      { error: callerRolesError.message },
      { status: 400 },
    );
  }

  const canRead = (callerRoles || []).some((row: any) => {
    const role = String(row.role || "");
    return (
      role === "super_admin" ||
      ((role === "admin" || role === "file_correspondent") &&
        String(row.institution_id || "") === institution_id)
    );
  });

  if (!canRead) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 });
  }

  // Filters
  const { searchParams } = new URL(req.url);
  const qRaw = searchParams.get("q") || "";
  const subjectRaw = searchParams.get("subject_id") || ""; // institution_subjects.id OU subjects.id
  const academicYearRaw = (searchParams.get("academic_year") || "").trim();
  const educationType = (searchParams.get("education_type") || "general_secondary").trim();
  const formationCode = (searchParams.get("formation_code") || "").trim();
  const formationLevelCode = (searchParams.get("formation_level_code") || "").trim();
  const classId = (searchParams.get("class_id") || "").trim();
  if (educationType !== "all" && !isEducationType(educationType)) {
    return NextResponse.json({ error: "bad_education_type" }, { status: 400 });
  }

  const q = norm(qRaw);
  const subjectFilter = (subjectRaw || "").trim();
  const academicYear = academicYearRaw || (await getCurrentAcademicYear(institution_id));
  const shouldFilterYear = Boolean(academicYear && academicYear !== "all");

  // Query (schema-tolerant)
  const { data, error } = await srv
    .from("class_teachers")
    .select(
      `
      teacher_id,
      subject_id,
      end_date,
      teacher:profiles(id,display_name,email,phone),
      class:classes(*),
      instsub:institution_subjects(
        id,
        custom_name,
        subj:subjects(id,name,code)
      )
    `
    )
    .eq("institution_id", institution_id)
    .is("end_date", null)
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Compatibilité historique : class_teachers.subject_id a parfois contenu
  // directement subjects.id au lieu de institution_subjects.id.
  const directSubjectIds = Array.from(
    new Set(
      (data || [])
        .filter((row: any) => !(row as any).instsub)
        .map((row: any) => String(row.subject_id || "").trim())
        .filter(Boolean),
    ),
  );
  const directSubjectsById = new Map<
    string,
    { id: string; name: string | null; code: string | null }
  >();

  if (directSubjectIds.length > 0) {
    const { data: directSubjects, error: directSubjectsError } = await srv
      .from("subjects")
      .select("id,name,code")
      .in("id", directSubjectIds);

    if (directSubjectsError) {
      return NextResponse.json(
        { error: directSubjectsError.message },
        { status: 400 },
      );
    }

    for (const subject of directSubjects || []) {
      directSubjectsById.set(String(subject.id), {
        id: String(subject.id),
        name: subject.name ? String(subject.name) : null,
        code: subject.code ? String(subject.code) : null,
      });
    }
  }

  // Group by (teacher_id, subject_id/institution_subjects)
  const groups = new Map<
    string,
    CurrentItem & { _subjectIds: { instSubId: string | null; subjId: string | null } }
  >();

  for (const row of data || []) {
    const t = (row as any).teacher;
    const c = (row as any).class || {};
    const is = (row as any).instsub;
    const rawSubjectId = String((row as any).subject_id || "").trim();
    const directSubject = directSubjectsById.get(rawSubjectId) || null;

    if (shouldFilterYear && String(c?.academic_year || "") !== academicYear) {
      continue;
    }

    const classType = String(c?.education_type || "").trim();
    const normalizedClassType = classType || "general_secondary";
    const classFormation = String(c?.formation_code || "").trim();
    const classFormationLevel = String(
      c?.formation_level_code || c?.level || "",
    ).trim();
    const currentClassId = String(c?.id || "").trim();

    // Le mode « Tous les enseignements » est réservé aux vues de synthèse.
    // Pour un type précis, les classes historiques sans education_type restent
    // compatibles avec le secondaire général.
    if (educationType !== "all" && normalizedClassType !== educationType) {
      continue;
    }
    if (formationCode && classFormation !== formationCode) continue;
    if (formationLevelCode && classFormationLevel !== formationLevelCode) continue;
    if (classId && currentClassId !== classId) continue;

    const teacher_id = String(t?.id || "").trim();
    if (!teacher_id) continue;

    const instSubId = (is?.id as string) ?? null;
    const subjId =
      ((is?.subj?.id as string) ?? null) || directSubject?.id || null;
    const subjectKey = instSubId || subjId || rawSubjectId || "NULL";
    const key = `${teacher_id}::${subjectKey}`;

    const subjectLabel =
      (is?.custom_name as string) ||
      (is?.subj?.name as string) ||
      directSubject?.name ||
      directSubject?.code ||
      "—";

    if (!groups.has(key)) {
      groups.set(key, {
        teacher: {
          id: teacher_id,
          display_name: t?.display_name ?? null,
          email: t?.email ?? null,
          phone: t?.phone ?? null,
        },
        subject: { id: instSubId || subjId, label: subjectLabel },
        classes: [],
        _subjectIds: { instSubId, subjId },
      });
    }

    const g = groups.get(key)!;

    // Pick class name & level robustly
    const clsId = (c?.id as string) || undefined;
    const clsName =
      c?.name ??
      c?.label ??
      c?.class_name ??
      c?.code ??
      c?.short_name ??
      c?.short_label ??
      null;
    const clsLevel = c?.level ?? c?.grade ?? c?.niveau ?? null;

    if (clsId && !g.classes.some((x) => x.id === clsId)) {
      g.classes.push({
        id: clsId,
        name: clsName ? String(clsName) : null,
        level: clsLevel ? String(clsLevel) : null,
        academic_year: c?.academic_year ? String(c.academic_year) : null,
        education_type: c?.education_type ? String(c.education_type) : null,
        formation_code: c?.formation_code ? String(c.formation_code) : null,
        formation_level_code: c?.formation_level_code
          ? String(c.formation_level_code)
          : null,
      });
    }
  }

  // Filter by subject (accepts institution_subjects.id OR subjects.id)
  let items = Array.from(groups.values());
  if (subjectFilter) {
    items = items.filter(
      (g) => g._subjectIds.instSubId === subjectFilter || g._subjectIds.subjId === subjectFilter
    );
  }

  // Text filter
  if (q) {
    items = items.filter((g) => {
      const hay = [
        norm(g.teacher.display_name),
        norm(g.teacher.email),
        norm(g.teacher.phone),
        norm(g.subject.label),
        ...g.classes.map((cl) => norm(cl.name)),
      ].join(" ");
      return hay.includes(q);
    });
  }

  // Sort: teacher then subject
  items.sort((a, b) => {
    const ta = lc(a.teacher.display_name) || lc(a.teacher.phone) || lc(a.teacher.email);
    const tb = lc(b.teacher.display_name) || lc(b.teacher.phone) || lc(b.teacher.email);
    if (ta !== tb) return ta.localeCompare(tb);
    return lc(a.subject.label).localeCompare(lc(b.subject.label));
  });

  // Strip internals
  const out: CurrentItem[] = items.map(({ _subjectIds, ...rest }) => rest);

  return NextResponse.json({ items: out, academic_year: shouldFilterYear ? academicYear : null });
}
