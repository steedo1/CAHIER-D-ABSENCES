// src/app/api/admin/students/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = me?.institution_id as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const id = (await params).id;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};

  if ("first_name" in body) patch.first_name = body.first_name ?? null;
  if ("last_name" in body)  patch.last_name  = body.last_name ?? null;
  if ("matricule" in body)  patch.matricule  = (body.matricule ?? null) ? String(body.matricule).trim().toUpperCase() : null;

  // Vérifier que l’élève appartient à la même institution
  const { data: s, error: sErr } = await srv
    .from("students")
    .select("id,institution_id")
    .eq("id", id)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
  if (!s || (s as any).institution_id !== inst) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
    .select("id, first_name, last_name, matricule")
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  return NextResponse.json({ item: upd });
}


/** Efface réellement l'élève et ses données liées après confirmation explicite. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = String(me?.institution_id || "");
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // Seule la direction (ou un super administrateur) peut supprimer définitivement.
  const { data: roles, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);
  if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 400 });

  const authorized = (roles ?? []).some((r) =>
    (r.role === "admin" && r.institution_id === inst) ||
    r.role === "super_admin"
  );
  if (!authorized) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.confirmation !== "SUPPRIMER" || typeof body?.student_name !== "string") {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const { data: student, error: lookupErr } = await srv
    .from("students")
    .select("id,first_name,last_name,full_name,photo_path")
    .eq("id", id)
    .eq("institution_id", inst)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 400 });
  if (!student) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  const expectedName =
    String(student.full_name || "").trim() ||
    [student.last_name, student.first_name].filter(Boolean).join(" ").trim();
  if (body.student_name.trim() !== expectedName) {
    return NextResponse.json({ error: "student_identity_changed" }, { status: 409 });
  }

  // Une seule transaction SQL évite la suppression partielle des données.
  const { data: deleted, error: deleteErr } = await srv.rpc("admin_hard_delete_student", {
    p_institution_id: inst,
    p_student_id: id,
    p_expected_full_name: expectedName,
  });
  if (deleteErr) {
    const errorCode = deleteErr.message?.includes("student_identity_changed")
      ? "student_identity_changed"
      : "student_delete_failed";
    return NextResponse.json(
      { error: errorCode, detail: deleteErr.message },
      { status: errorCode === "student_identity_changed" ? 409 : 400 }
    );
  }
  if (!deleted) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  // Le stockage de photos est hors transaction SQL : nettoyage ensuite.
  // Ne retirer que les fichiers du répertoire propre à cet élève.
  const folder = `${inst}/${id}`;
  const photoPath = String(student.photo_path || "").trim();
  const { data: photoFiles, error: listErr } = await srv.storage
    .from("student-photos")
    .list(folder, { limit: 100 });

  const paths = (photoFiles ?? [])
    .filter((file) => Boolean(file.name) && !file.name.startsWith("."))
    .map((file) => `${folder}/${file.name}`);
  if (photoPath.startsWith(`${folder}/`) && !paths.includes(photoPath)) {
    paths.push(photoPath);
  }
  let photoCleanup = "no_photo";
  if (listErr) {
    photoCleanup = "failed";
  } else if (paths.length > 0) {
    const { error: removeErr } = await srv.storage
      .from("student-photos")
      .remove(paths);
    photoCleanup = removeErr ? "failed" : "deleted";
  }
  if (photoPath && !photoPath.startsWith(`${folder}/`)) {
    photoCleanup = "unrecognized_path";
  }

  return NextResponse.json({ deleted: true, photo_cleanup: photoCleanup });
}
