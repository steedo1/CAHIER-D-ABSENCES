import { NextRequest, NextResponse } from "next/server";
import {
  cleanText,
  cleanUuid,
  getCurrentAcademicYearCode,
  requireTextbookManager,
} from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROGRESSION_BUCKET = "progressions";

function safeFileName(name: string) {
  const cleaned = String(name || "progression.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned || "progression.pdf";
}

async function decorateDocuments(srv: any, rows: any[]) {
  const out = [];
  for (const row of rows) {
    const document = row?.document || null;
    let signedUrl: string | null = null;

    if (document?.storage_bucket && document?.storage_path) {
      const { data } = await srv.storage
        .from(String(document.storage_bucket))
        .createSignedUrl(String(document.storage_path), 60 * 60);
      signedUrl = data?.signedUrl || null;
    }

    out.push({
      ...row,
      document: document ? { ...document, signed_url: signedUrl } : null,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId } = auth.ctx;

  const url = new URL(req.url);
  const academicYear =
    cleanText(url.searchParams.get("academic_year"), 30) ||
    (await getCurrentAcademicYearCode(srv, institutionId));
  const level = cleanText(url.searchParams.get("level"), 80);
  const subjectId = cleanUuid(url.searchParams.get("subject_id"));

  let query = srv
    .from("textbook_progression_templates")
    .select(
      `
      id,
      institution_id,
      academic_year,
      subject_id,
      institution_subject_id,
      subject_name,
      level,
      series,
      title,
      description,
      status,
      created_at,
      updated_at,
      document:textbook_progression_documents(
        id,
        original_name,
        storage_bucket,
        storage_path,
        mime_type,
        size_bytes,
        created_at
      ),
      items:textbook_progression_items(id),
      assignments:textbook_progression_class_assignments(id,class_id,is_active)
    `
    )
    .eq("institution_id", institutionId)
    .order("updated_at", { ascending: false });

  if (academicYear) query = query.eq("academic_year", academicYear);
  if (level) query = query.eq("level", level);
  if (subjectId) query = query.eq("subject_id", subjectId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const rows = await decorateDocuments(srv, (data || []) as any[]);
  return NextResponse.json({ ok: true, items: rows, academic_year: academicYear });
}

export async function POST(req: NextRequest) {
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;

  const contentType = req.headers.get("content-type") || "";
  let raw: any = {};
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    raw = Object.fromEntries(form.entries());
    const maybeFile = form.get("document_file");
    if (maybeFile && typeof maybeFile !== "string") file = maybeFile as File;
  } else {
    raw = await req.json().catch(() => ({}));
  }

  const title = cleanText(raw.title, 180);
  const level = cleanText(raw.level, 80);
  const academicYear =
    cleanText(raw.academic_year, 30) ||
    (await getCurrentAcademicYearCode(srv, institutionId));
  const subjectId = cleanUuid(raw.subject_id);
  const institutionSubjectId = cleanUuid(raw.institution_subject_id);
  const subjectName = cleanText(raw.subject_name, 160);
  const series = cleanText(raw.series, 80) || null;
  const description = cleanText(raw.description, 1000) || null;

  if (!title) {
    return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  }
  if (!academicYear) {
    return NextResponse.json({ ok: false, error: "academic_year_required" }, { status: 400 });
  }
  if (!level) {
    return NextResponse.json({ ok: false, error: "level_required" }, { status: 400 });
  }
  if (!subjectId && !institutionSubjectId && !subjectName) {
    return NextResponse.json({ ok: false, error: "subject_required" }, { status: 400 });
  }

  const progressionId = crypto.randomUUID();
  let documentId: string | null = null;

  if (file && file.size > 0) {
    const mimeType = file.type || "application/pdf";
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "file_too_large", max_mb: 25 }, { status: 413 });
    }

    const extOk =
      mimeType === "application/pdf" ||
      mimeType.includes("word") ||
      mimeType.includes("spreadsheet") ||
      mimeType.includes("excel") ||
      mimeType === "text/csv";

    if (!extOk) {
      return NextResponse.json(
        { ok: false, error: "unsupported_file_type", mime_type: mimeType },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const path = `${institutionId}/${academicYear}/${progressionId}/${safeFileName(file.name)}`;

    const upload = await srv.storage.from(PROGRESSION_BUCKET).upload(path, bytes, {
      contentType: mimeType,
      upsert: true,
    });

    if (upload.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "document_upload_failed",
          details: upload.error.message,
          hint: "Exécutez d'abord sql/textbook_module_v1.sql pour créer le bucket progressions.",
        },
        { status: 500 }
      );
    }

    documentId = crypto.randomUUID();
    const { error: docErr } = await srv.from("textbook_progression_documents").insert({
      id: documentId,
      institution_id: institutionId,
      academic_year: academicYear,
      original_name: file.name || "progression",
      storage_bucket: PROGRESSION_BUCKET,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: file.size,
      uploaded_by: userId,
    });

    if (docErr) {
      return NextResponse.json({ ok: false, error: docErr.message }, { status: 400 });
    }
  }

  const { data, error } = await srv
    .from("textbook_progression_templates")
    .insert({
      id: progressionId,
      institution_id: institutionId,
      academic_year: academicYear,
      document_id: documentId,
      subject_id: subjectId,
      institution_subject_id: institutionSubjectId,
      subject_name: subjectName || null,
      level,
      series,
      title,
      description,
      status: "active",
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}
