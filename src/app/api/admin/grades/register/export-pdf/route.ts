import { NextRequest, NextResponse } from "next/server";
import { GET as loadAdminRegister } from "../route";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { buildAdminRegisterPdf, type AdminRegisterPdfInput } from "@/lib/grades/admin-register-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterData = {
  ok?: boolean;
  error?: string;
  class?: { id: string; institution_id?: string; label?: string; academic_year?: string };
  period?: { label?: string; short_label?: string } | null;
  subject?: { label?: string };
  teacher_id?: string;
  roster?: Array<{ id: string; full_name: string; matricule?: string | null }>;
  evaluations?: Array<{
    id: string; column_label?: string | null; component_label?: string | null;
    eval_date?: string | null; scale: number; coeff?: number | null;
    is_published?: boolean; publication_status?: string | null;
  }>;
  scores?: Array<{ evaluation_id: string; student_id: string; score: number | null }>;
};

function downloadName(value: string) {
  return String(value || "classe")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 65) || "classe";
}

/** PDF vérifié côté serveur : ne pas faire confiance aux notes passées par le navigateur. */
export async function GET(req: NextRequest) {
  const filters = req.nextUrl.searchParams;
  if (filters.get("view") === "overview" || !filters.get("class_id") ||
      !filters.get("subject_id") || !filters.get("teacher_id")) {
    return NextResponse.json({ ok: false, error: "MISSING_FILTERS" }, { status: 400 });
  }
  const publication = String(filters.get("publication") || "all");
  if (!["all", "published", "unpublished"].includes(publication)) {
    return NextResponse.json({ ok: false, error: "INVALID_PUBLICATION_FILTER" }, { status: 400 });
  }

  // Réutilise les contrôles de session/rôle, périmètre établissement, année et classe.
  const registerResponse = await loadAdminRegister(req);
  if (!registerResponse.ok) return registerResponse;
  const register = await registerResponse.json() as RegisterData;
  if (!register.ok || !register.class?.institution_id) {
    return NextResponse.json({ ok: false, error: "REGISTER_EXPORT_UNAVAILABLE" }, { status: 500 });
  }

  const evaluations = (register.evaluations || []).filter((ev) => {
    const published = ev.is_published === true ||
      String(ev.publication_status || "").toLowerCase() === "published";
    return publication === "all" || (publication === "published" ? published : !published);
  });
  if (!evaluations.length) {
    return NextResponse.json({ ok: false, error: "NO_EVALUATIONS_TO_EXPORT" }, { status: 400 });
  }
  const students = register.roster || [];
  if (evaluations.length > 80 || students.length > 600) {
    return NextResponse.json({ ok: false, error: "REGISTER_TOO_LARGE" }, { status: 413 });
  }

  const srv = getSupabaseServiceClient();
  const { data: institution, error: institutionError } = await srv.from("institutions")
    .select("name").eq("id", register.class.institution_id).maybeSingle();
  if (institutionError || !institution) {
    return NextResponse.json({ ok: false, error: "INSTITUTION_NOT_FOUND" }, { status: 404 });
  }

  const { data: teacher } = await srv.from("profiles")
    .select("display_name").eq("id", register.teacher_id || "").maybeSingle();

  const evalIds = new Set(evaluations.map((ev) => ev.id));
  const payload: AdminRegisterPdfInput = {
    institutionName: String(institution.name || ""),
    academicYear: String(register.class.academic_year || filters.get("academic_year") || ""),
    className: String(register.class.label || "Classe"),
    subjectName: String(register.subject?.label || "Discipline"),
    teacherName: String(teacher?.display_name || ""),
    periodName: String(register.period?.short_label || register.period?.label || ""),
    publicationLabel: publication === "published" ? "Notes publiées" :
      publication === "unpublished" ? "Notes non publiées" : "Toutes les notes",
    students,
    evaluations,
    scores: (register.scores || []).filter((score) => evalIds.has(score.evaluation_id)),
  };

  try {
    const pdf = await buildAdminRegisterPdf(payload);
    const filename = "registre_notes_" + downloadName(payload.className) +
      "_" + downloadName(payload.subjectName) + "_" + downloadName(payload.academicYear) + ".pdf";
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[admin/grades/register/export-pdf] export failed", error);
    return NextResponse.json({ ok: false, error: "PDF_GENERATION_FAILED" }, { status: 500 });
  }
}
