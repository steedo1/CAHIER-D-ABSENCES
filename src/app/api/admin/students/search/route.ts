// src/app/api/admin/students/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  studentIdentityWords,
  studentMatchesIdentity,
} from "@/lib/student-class-membership";
import { requireInstitutionAccess } from "../../_helpers/institutionAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDENT_SEARCH_ROLES = [
  "admin",
  "super_admin",
  "founder",
  "file_correspondent",
  "finance_manager",
  "finance",
] as const;

export async function GET(req: NextRequest) {
  const access = await requireInstitutionAccess({
    allowedRoles: STUDENT_SEARCH_ROLES,
  });
  if ("error" in access) return access.error;

  const srv = access.srv;
  const inst = access.institutionId;

  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const lastNameRaw = (url.searchParams.get("last_name") || "").trim();
  const firstNameRaw = (url.searchParams.get("first_name") || "").trim();
  const identitySearch = Boolean(lastNameRaw || firstNameRaw);
  const requestedLimit = Number(url.searchParams.get("limit") || 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.floor(requestedLimit)))
    : 20;
  const academicYear = (url.searchParams.get("academic_year") || "").trim();

  if (identitySearch) {
    if (
      studentIdentityWords(lastNameRaw).join("").length < 2 ||
      studentIdentityWords(firstNameRaw).length === 0
    ) {
      return NextResponse.json({
        items: [],
        identity_search: true,
        identity_ready: false,
      });
    }
  } else if (qRaw.length < 2) {
    return NextResponse.json({ items: [] }); // on évite les requêtes trop vagues
  }

  // Échappe % et _ pour ILIKE
  const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

  // 1) On cherche dans students (nom, prénom, matricule)
  const studentsQuery = () => srv
    .from("students")
    .select("id, first_name, last_name, matricule")
    .eq("institution_id", inst)
    .order("last_name", { ascending: true, nullsFirst: true })
    .order("first_name", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true });

  type StudentRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    matricule: string | null;
  };
  let studs: StudentRow[] = [];
  let hasMore = false;

  if (identitySearch) {
    // ILIKE ne retire pas les accents en base. Normaliser uniquement la saisie
    // excluait ÉLODIE avant même le contrôle d'identité. Parcourir les identités
    // de l'établissement par pages, puis limiter les correspondances exactes.
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await studentsQuery().range(offset, offset + pageSize - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const candidates = (data ?? []) as StudentRow[];
      studs.push(...candidates.filter((student) => studentMatchesIdentity(student, {
        lastName: lastNameRaw,
        firstName: firstNameRaw,
      })));
      if (studs.length > limit || candidates.length < pageSize) break;
    }
    hasMore = studs.length > limit;
    studs = studs.slice(0, limit);
  } else {
    const like = `%${escapeLike(qRaw)}%`;
    const { data, error } = await studentsQuery()
      .or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `matricule.ilike.${like}`,
        ].join(",")
      )
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    studs = (data ?? []) as StudentRow[];
  }

  const ids = (studs ?? []).map((s) => s.id);
  const mapClass = new Map<string, { class_id: string | null; class_label: string | null }>();

  if (ids.length) {
    // 2) Classe active (end_date IS NULL) pour afficher le contexte
    let enrollmentQuery = srv
      .from("class_enrollments")
      .select("student_id,class_id,start_date,classes:class_id!inner(label,code,academic_year)")
      .in("student_id", ids)
      .eq("institution_id", inst)
      .is("end_date", null)
      .order("start_date", { ascending: false });
    if (academicYear) enrollmentQuery = enrollmentQuery.eq("classes.academic_year", academicYear);
    const { data: enr, error: eErr } = await enrollmentQuery;

    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

    for (const r of enr ?? []) {
      if (mapClass.has((r as any).student_id)) continue;
      const relation = (r as any).classes;
      const cls = Array.isArray(relation) ? relation[0] : relation;
      const label = cls?.label || cls?.code || null;
      mapClass.set((r as any).student_id, {
        class_id: (r as any).class_id ?? null,
        class_label: label,
      });
    }
  }

  const items = (studs ?? []).map((s) => {
    const c = mapClass.get(s.id) ?? { class_id: null, class_label: null };
    return {
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      matricule: s.matricule,
      class_id: c.class_id,
      class_label: c.class_label,
    };
  });

  return NextResponse.json({
    items,
    identity_search: identitySearch,
    identity_ready: identitySearch ? true : undefined,
    ambiguous: identitySearch ? items.length > 1 || hasMore : undefined,
    has_more: hasMore,
  });
}
