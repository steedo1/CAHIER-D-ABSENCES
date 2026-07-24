import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { cleanText, cleanUuid } from "@/lib/textbook/context";
import {
  decorateTextbookProgressionEducation,
  resolveTextbookProgressionEducationContext,
  textbookProgressionContextValidationError,
} from "@/lib/textbook/progression-context";

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

async function guardSuperAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user?.id) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }

  const { data: roles, error } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (error) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: error.message }, { status: 400 }) };
  }

  const isSuper = (roles || []).some((row: any) => String(row?.role) === "super_admin");
  if (!isSuper) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "super_admin_required" }, { status: 403 }) };
  }

  return { ok: true as const, srv, userId: user.id };
}

async function decorateDocuments(srv: ReturnType<typeof getSupabaseServiceClient>, rows: any[]) {
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
  const auth = await guardSuperAdmin();
  if (!auth.ok) return auth.response;
  const { srv } = auth;

  const url = new URL(req.url);
  const academicYear = cleanText(url.searchParams.get("academic_year"), 30);
  const level = cleanText(url.searchParams.get("level"), 80);
  const subjectName = cleanText(url.searchParams.get("subject_name"), 160);
  const status = cleanText(url.searchParams.get("status"), 30);
  const educationType = cleanText(url.searchParams.get("education_type"), 60);

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
      education_type,
      formation_code,
      formation_label,
      formation_level_code,
      formation_level_label,
      title,
      description,
      status,
      scope,
      published_at,
      source_metadata,
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
      items:textbook_progression_items(id)
    `,
    )
    .eq("scope", "national")
    .order("academic_year", { ascending: false })
    .order("subject_name", { ascending: true })
    .order("level", { ascending: true });

  if (academicYear) query = query.eq("academic_year", academicYear);
  if (level) query = query.eq("level", level);
  if (subjectName) query = query.ilike("subject_name", `%${subjectName}%`);
  if (status) query = query.eq("status", status);
  if (educationType) query = query.eq("education_type", educationType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  const rows = (await decorateDocuments(srv, (data || []) as any[])).map((row) =>
    decorateTextbookProgressionEducation(row),
  );
  return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: NextRequest) {
  const auth = await guardSuperAdmin();
  if (!auth.ok) return auth.response;
  const { srv, userId } = auth;

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
  const academicYear = cleanText(raw.academic_year, 30);
  const subjectId = cleanUuid(raw.subject_id);
  const subjectName = cleanText(raw.subject_name, 160);
  const series = cleanText(raw.series, 80) || null;
  const description = cleanText(raw.description, 1000) || null;
  const status = cleanText(raw.status, 30) === "draft" ? "draft" : "active";
  const educationContext = resolveTextbookProgressionEducationContext({
    educationType: raw.education_type,
    formationCode: raw.formation_code,
    formationLabel: raw.formation_label,
    formationLevelCode: raw.formation_level_code,
    formationLevelLabel: raw.formation_level_label,
    level,
  });
  const contextError = textbookProgressionContextValidationError(educationContext);

  if (!title) return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  if (!academicYear) return NextResponse.json({ ok: false, error: "academic_year_required" }, { status: 400 });
  if (contextError) return NextResponse.json({ ok: false, error: contextError.error, message: contextError.message }, { status: contextError.status });
  if (!level) return NextResponse.json({ ok: false, error: "level_required" }, { status: 400 });
  if (!subjectId && !subjectName) return NextResponse.json({ ok: false, error: "subject_required" }, { status: 400 });

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
      return NextResponse.json({ ok: false, error: "unsupported_file_type", mime_type: mimeType }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const path = `national/${academicYear}/${progressionId}/${safeFileName(file.name)}`;

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
        { status: 500 },
      );
    }

    documentId = crypto.randomUUID();
    const { error: docErr } = await srv.from("textbook_progression_documents").insert({
      id: documentId,
      institution_id: null,
      academic_year: academicYear,
      original_name: file.name || "progression",
      storage_bucket: PROGRESSION_BUCKET,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: file.size,
      uploaded_by: userId,
    });

    if (docErr) return NextResponse.json({ ok: false, error: docErr.message }, { status: 400 });
  }

  const { data, error } = await srv
    .from("textbook_progression_templates")
    .insert({
      id: progressionId,
      institution_id: null,
      academic_year: academicYear,
      document_id: documentId,
      subject_id: subjectId,
      institution_subject_id: null,
      subject_name: subjectName || null,
      level: educationContext.education_type === "general_secondary" ? level : educationContext.formation_level_code,
      series,
      education_type: educationContext.education_type,
      formation_code: educationContext.formation_code,
      formation_label: educationContext.formation_label,
      formation_level_code: educationContext.formation_level_code,
      formation_level_label: educationContext.formation_level_label,
      title,
      description,
      status,
      scope: "national",
      is_customized: false,
      published_at: status === "active" ? new Date().toISOString() : null,
      published_by: status === "active" ? userId : null,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}
