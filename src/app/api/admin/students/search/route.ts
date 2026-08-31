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
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));

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
  let studentsQuery = srv
    .from("students")
    .select("id, first_name, last_name, matricule")
    .eq("institution_id", inst)
    .order("last_name", { ascending: true, nullsFirst: true })
    .order("first_name", { ascending: true, nullsFirst: true });

  if (identitySearch) {
    // Le filtre final est strict et insensible aux accents. Ces deux fragments
    // bornent seulement le volume lu sans confondre NOM et prénom(s).
    const longestLastNameWord = studentIdentityWords(lastNameRaw).sort(
      (a, b) => b.length - a.length,
    )[0];
    const longestFirstNameWord = studentIdentityWords(firstNameRaw).sort(
      (a, b) => b.length - a.length,
    )[0];

    studentsQuery = studentsQuery
      .ilike("last_name", `%${escapeLike(longestLastNameWord)}%`)
      .ilike("first_name", `%${escapeLike(longestFirstNameWord)}%`)
      .limit(Math.min(200, Math.max(50, limit * 4)));
  } else {
    const like = `%${escapeLike(qRaw)}%`;
    studentsQuery = studentsQuery
      .or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `matricule.ilike.${like}`,
        ].join(",")
      )
      .limit(limit);
  }

  const { data: candidates, error: sErr } = await studentsQuery;

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const studs = identitySearch
    ? (candidates ?? [])
        .filter((student) =>
          studentMatchesIdentity(student, {
            lastName: lastNameRaw,
            firstName: firstNameRaw,
          }),
        )
        .slice(0, limit)
    : candidates ?? [];

  const ids = (studs ?? []).map((s) => s.id);
  let mapClass = new Map<string, { class_id: string | null; class_label: string | null }>();

  if (ids.length) {
    // 2) Classe active (end_date IS NULL) pour afficher le contexte
    const { data: enr, error: eErr } = await srv
      .from("class_enrollments")
      .select("student_id, class_id, classes(name,label)")
      .in("student_id", ids)
      .eq("institution_id", inst)
      .is("end_date", null);

    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

    for (const r of enr ?? []) {
      const label = (r as any)?.classes?.name || (r as any)?.classes?.label || null;
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
    ambiguous: identitySearch ? items.length > 1 : undefined,
  });
}
