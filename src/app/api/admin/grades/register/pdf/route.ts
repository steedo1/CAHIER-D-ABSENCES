import { NextRequest, NextResponse } from "next/server";
import { GET as readRegister } from "../route";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { buildAdminRegisterPdf } from "@/lib/grades/grade-register-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pdfFilePart(value: string) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 55) || "classe";
}

/**
 * Reprend les contrôles d'authentification, de rôle et d'établissement du
 * registre existant, et ne lit les notes qu'au clic d'export PDF.
 */
export async function GET(req: NextRequest) {
  try {
    const source = await readRegister(req);
    if (!source.ok) return source;
    const result = await source.json();
    if (!result?.ok || !result?.class?.id || !result?.subject?.id) {
      return NextResponse.json({ ok: false, error: "REGISTER_REQUIRED" }, { status: 400 });
    }

    const srv = getSupabaseServiceClient();
    const { data: cls, error: classError } = await srv
      .from("classes")
      .select("institution_id")
      .eq("id", result.class.id)
      .maybeSingle();
    if (classError || !cls?.institution_id) {
      return NextResponse.json({ ok: false, error: "CLASS_NOT_FOUND" }, { status: 404 });
    }
    const { data: institution, error: schoolError } = await srv
      .from("institutions")
      .select("name")
      .eq("id", cls.institution_id)
      .maybeSingle();
    if (schoolError) throw schoolError;

    const filter = req.nextUrl.searchParams.get("publication_filter") || "all";
    if (!["all", "published", "unpublished"].includes(filter)) {
      return NextResponse.json({ ok: false, error: "INVALID_FILTER" }, { status: 400 });
    }
    const allEvaluations = Array.isArray(result.evaluations) ? result.evaluations : [];
    const evaluations = allEvaluations.filter((e: any) => {
      const published = e.is_published === true || String(e.publication_status || "") === "published";
      return filter === "all" || (filter === "published" ? published : !published);
    });
    if (evaluations.length > 160 || (result.roster || []).length > 1500) {
      return NextResponse.json({ ok: false, error: "EXPORT_TOO_LARGE" }, { status: 413 });
    }
    const ids = new Set(evaluations.map((ev: any) => String(ev.id)));
    const pdf = await buildAdminRegisterPdf({
      institution: String(institution?.name || "Établissement scolaire"),
      classLabel: String(result.class.label || "Classe"),
      academicYear: String(result.class.academic_year || ""),
      subject: String(result.subject.label || ""),
      teacher: String(req.nextUrl.searchParams.get("teacher_name") || "Enseignant"),
      period: String(result.period?.label || "Toute l’année scolaire"),
      students: result.roster || [],
      evaluations,
      scores: (result.scores || []).filter((row: any) => ids.has(String(row.evaluation_id))),
    });

    const filename = [
      "registre-notes",
      pdfFilePart(String(result.class.label || "classe")),
      pdfFilePart(String(result.subject.label || "matiere")),
    ].join("-") + ".pdf";

    return new NextResponse(Uint8Array.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[admin/grades/register/pdf] GET", err);
    return NextResponse.json(
      { ok: false, error: "PDF_EXPORT_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
