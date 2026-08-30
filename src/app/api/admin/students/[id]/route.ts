// src/app/api/admin/students/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "../../_helpers/institutionAccess";

const STUDENT_EDIT_ROLES = ["admin", "super_admin", "founder", "file_correspondent"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireInstitutionAccess({
    allowedRoles: STUDENT_EDIT_ROLES,
  });
  if ("error" in access) return access.error;

  const srv = access.srv;
  const inst = access.institutionId;

  const id = (await params).id;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};

  if ("first_name" in body) patch.first_name = body.first_name ? String(body.first_name).replace(/\s+/g, " ").trim() : null;
  if ("last_name" in body)  patch.last_name  = body.last_name ? String(body.last_name).replace(/\s+/g, " ").trim() : null;
  if ("matricule" in body)  patch.matricule  = (body.matricule ?? null) ? String(body.matricule).trim().toUpperCase() : null;

  // Vérifier que l’élève appartient à la même institution
  const { data: s, error: sErr } = await srv
    .from("students")
    .select("id,institution_id,first_name,last_name,full_name")
    .eq("id", id)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
  if (!s || (s as any).institution_id !== inst) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if ("first_name" in body || "last_name" in body) {
    const nextFirstName = "first_name" in patch ? patch.first_name : (s as any)?.first_name ?? null;
    const nextLastName = "last_name" in patch ? patch.last_name : (s as any)?.last_name ?? null;
    const nextFullName = [nextLastName, nextFirstName].filter(Boolean).join(" ").trim();

    if (!nextFullName) {
      return NextResponse.json(
        { error: "Le nom complet de l’élève est obligatoire." },
        { status: 400 },
      );
    }

    patch.full_name = nextFullName;
  }

  // Unicité du matricule dans l’établissement (si fourni)
  if (patch.matricule) {
    const { data: dup, error: dErr } = await srv
      .from("students")
      .select("id")
      .eq("institution_id", inst)
      .eq("matricule", patch.matricule)
      .neq("id", id);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });
    if ((dup ?? []).length) {
      return NextResponse.json({ error: "duplicate_matricule" }, { status: 400 });
    }
  }

  const { data: upd, error: uErr } = await srv
    .from("students")
    .update(patch)
    .eq("id", id)
    .select("id, first_name, last_name, full_name, matricule")
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  return NextResponse.json({ item: upd });
}
