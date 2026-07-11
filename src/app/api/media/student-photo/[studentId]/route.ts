// src/app/api/media/student-photo/[studentId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "student-photos";
const INSTITUTION_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "educator",
  "infirmier",
  "teacher",
]);

function roleMatchesInstitution(
  role: string,
  roleInstitutionId: unknown,
  profileInstitutionId: string,
  studentInstitutionId: string,
) {
  if (role === "super_admin") return true;
  if (!INSTITUTION_ROLES.has(role)) return false;

  const roleInst = String(roleInstitutionId || "").trim();
  const effectiveInst = roleInst || profileInstitutionId;
  return Boolean(effectiveInst && effectiveInst === studentInstitutionId);
}

function mimeTypeFromPath(path: string, fallback: string | null | undefined) {
  const supplied = String(fallback || "").trim();
  if (supplied.startsWith("image/")) return supplied;

  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ studentId: string }> },
) {
  const { studentId: rawStudentId } = await context.params;
  const studentId = String(rawStudentId || "").trim();

  if (!studentId) {
    return NextResponse.json({ error: "student_id_required" }, { status: 400 });
  }

  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: student, error: studentError } = await srv
    .from("students")
    .select("id,institution_id,photo_path,photo_updated_at")
    .eq("id", studentId)
    .maybeSingle();

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 400 });
  }

  const institutionId = String((student as any)?.institution_id || "").trim();
  const photoPath = String((student as any)?.photo_path || "").trim();

  if (!student || !institutionId || !photoPath) {
    return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  }

  // Le chemin est créé sous institution_id/student_id/fichier.ext.
  // Cette vérification empêche qu'une référence incohérente serve un objet tiers.
  const expectedPrefix = `${institutionId}/${studentId}/`;
  if (!photoPath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "photo_path_invalid" }, { status: 404 });
  }

  const [{ data: profile }, { data: roleRows, error: roleError }] = await Promise.all([
    supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle(),
    srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id),
  ]);

  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 400 });
  }

  const profileInstitutionId = String(
    (profile as any)?.institution_id || "",
  ).trim();

  const institutionalAccess = (roleRows || []).some((row: any) =>
    roleMatchesInstitution(
      String(row?.role || ""),
      row?.institution_id,
      profileInstitutionId,
      institutionId,
    ),
  );

  let guardianAccess = false;
  if (!institutionalAccess) {
    const { data: guardianLink, error: guardianError } = await srv
      .from("student_guardians")
      .select("id")
      .eq("student_id", studentId)
      .or(`parent_id.eq.${user.id},guardian_profile_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    if (guardianError) {
      return NextResponse.json({ error: guardianError.message }, { status: 400 });
    }

    guardianAccess = Boolean(guardianLink);
  }

  if (!institutionalAccess && !guardianAccess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: file, error: downloadError } = await srv.storage
    .from(BUCKET)
    .download(photoPath);

  if (downloadError || !file) {
    return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  }

  const bytes = await file.arrayBuffer();
  const contentType = mimeTypeFromPath(photoPath, file.type);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
