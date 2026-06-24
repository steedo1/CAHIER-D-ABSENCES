import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { extractStructuredItems, serializeImportLines } from "@/lib/textbook/import-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OptionalModule = Record<string, any> | null;

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

  return { ok: true as const, srv };
}

async function optionalImport(name: string): Promise<OptionalModule> {
  try {
    // Keep dependency optional at build time. The route returns a clear error if it is absent.
    const importer = new Function("moduleName", "return import(moduleName)") as (moduleName: string) => Promise<any>;
    return await importer(name);
  } catch {
    return null;
  }
}

function getFileKind(mimeType?: string | null, originalName?: string | null) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(originalName || "").toLowerCase();

  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("text/") || mime.includes("csv") || name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".tsv")) return "text";
  if (mime.includes("spreadsheet") || mime.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) return "excel";
  if (mime.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "word";
  return "unknown";
}

function compactExtractedText(value: string) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodePdfEscapedString(value: string) {
  return value
    .replace(/\\\)/g, ")")
    .replace(/\\\(/g, "(")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\");
}

function fallbackPdfLiteralExtraction(buffer: Buffer) {
  // Very small fallback for text-based PDFs. It does NOT replace a real PDF parser/OCR.
  const raw = buffer.toString("latin1");
  const matches = [...raw.matchAll(/\(([^()]{2,300})\)\s*(?:Tj|'|")/g)]
    .map((m) => decodePdfEscapedString(m[1]))
    .filter((part) => /[A-Za-zÀ-ÿ0-9]/.test(part));

  const text = compactExtractedText(matches.join("\n"));
  return text.length >= 80 ? text : "";
}

function extractionQuality(text: string) {
  const value = String(text || "");
  const chars = [...value];
  if (!chars.length) return { usable: false, weirdRatio: 1, wordCount: 0 };

  const allowed = /[A-Za-zÀ-ÿ0-9\s.,;:!?"'’`´()\[\]{}\/_+\-=°%&€$#@\n\r]/;
  const weird = chars.filter((char) => !allowed.test(char)).length;
  const wordCount = value.match(/[A-Za-zÀ-ÿ]{3,}/g)?.length || 0;
  const usefulSignals = value.match(/\b(unit|unité|progression|semaine|mois|séance|session|lesson|revision|révision|evaluation|évaluation|remédiation|correction|competence|compétence|theme|thème|chapitre|leçon)\b/gi)?.length || 0;
  const weirdRatio = weird / chars.length;

  return {
    usable: value.trim().length >= 40 && weirdRatio < 0.08 && (wordCount >= 8 || usefulSignals >= 2),
    weirdRatio,
    wordCount,
  };
}

function isUsableExtractedText(text: string) {
  return extractionQuality(text).usable;
}

async function extractTextFromDocument(buffer: Buffer, kind: string) {
  if (kind === "text") {
    return { rawText: compactExtractedText(buffer.toString("utf8")), warning: null as string | null };
  }

  if (kind === "excel") {
    const mod: any = await optionalImport("xlsx");
    const XLSX = mod?.default || mod;
    if (!XLSX?.read || !XLSX?.utils?.sheet_to_csv) {
      return {
        rawText: "",
        warning: "xlsx_missing",
        error: "Le lecteur Excel n'est pas disponible. Installe le package xlsx ou importe un CSV/TXT.",
      };
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const parts = (workbook.SheetNames || []).map((name: string) => {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ";" });
      return [`# Feuille : ${name}`, csv].join("\n");
    });
    return { rawText: compactExtractedText(parts.join("\n\n")), warning: null as string | null };
  }

  if (kind === "word") {
    const mod: any = await optionalImport("mammoth");
    const mammoth = mod?.default || mod;
    if (!mammoth?.extractRawText) {
      return {
        rawText: "",
        warning: "mammoth_missing",
        error: "Le lecteur Word n'est pas disponible. Installe le package mammoth ou importe un TXT/CSV.",
      };
    }

    const result = await mammoth.extractRawText({ buffer });
    return { rawText: compactExtractedText(result?.value || ""), warning: null as string | null };
  }

  if (kind === "pdf") {
    const mod: any = await optionalImport("pdf-parse");
    const pdfParse = mod?.default || mod;

    if (typeof pdfParse !== "function") {
      return {
        rawText: "",
        warning: "pdf_parser_missing",
        error: "Le lecteur PDF n'est pas disponible côté serveur. Installe le package pdf-parse, puis relance le build.",
      };
    }

    const result = await pdfParse(buffer);
    const text = compactExtractedText(result?.text || "");
    if (!isUsableExtractedText(text)) {
      return {
        rawText: "",
        warning: "pdf_text_unusable",
        error:
          "Le PDF a été lu, mais aucun texte pédagogique exploitable n'a été trouvé. Il s'agit probablement d'un PDF scanné/image ou d'un PDF encodé en images. L'ancien mode secours a été désactivé pour éviter les lignes illisibles. Prochaine étape : ajouter une vraie OCR avant la structuration.",
      };
    }

    return { rawText: text, warning: null as string | null };
  }

  return {
    rawText: "",
    warning: "unsupported_file_type",
    error: "Format non reconnu pour l'extraction assistée. Utilise PDF texte, Word, Excel, CSV ou TXT.",
  };
}

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await guardSuperAdmin();
  if (!auth.ok) return auth.response;
  const { srv } = auth;

  const { data: progression, error: progressionErr } = await srv
    .from("textbook_progression_templates")
    .select(
      `
      id,
      title,
      academic_year,
      subject_name,
      level,
      series,
      scope,
      document:textbook_progression_documents(
        id,
        original_name,
        storage_bucket,
        storage_path,
        mime_type,
        size_bytes
      )
    `,
    )
    .eq("id", id)
    .eq("scope", "national")
    .maybeSingle();

  if (progressionErr) return NextResponse.json({ ok: false, error: progressionErr.message }, { status: 400 });
  if (!progression) return NextResponse.json({ ok: false, error: "national_progression_not_found" }, { status: 404 });

  const document = Array.isArray((progression as any).document)
    ? (progression as any).document[0]
    : (progression as any).document;

  if (!document?.storage_bucket || !document?.storage_path) {
    return NextResponse.json({ ok: false, error: "official_document_required" }, { status: 400 });
  }

  const download = await srv.storage.from(String(document.storage_bucket)).download(String(document.storage_path));
  if (download.error || !download.data) {
    return NextResponse.json(
      { ok: false, error: "document_download_failed", details: download.error?.message || null },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await download.data.arrayBuffer());
  const kind = getFileKind(document.mime_type, document.original_name);
  const extracted = await extractTextFromDocument(buffer, kind);

  if ((extracted as any).error) {
    return NextResponse.json(
      {
        ok: false,
        error: (extracted as any).warning || "document_extraction_failed",
        details: (extracted as any).error,
        file_kind: kind,
      },
      { status: 422 },
    );
  }

  const rawText = extracted.rawText;
  if (!rawText || rawText.length < 20 || !isUsableExtractedText(rawText)) {
    const quality = extractionQuality(rawText || "");
    return NextResponse.json(
      {
        ok: false,
        error: "empty_or_unusable_extracted_text",
        details:
          kind === "pdf"
            ? "Le document a été lu, mais le texte extrait n'est pas exploitable. Très probablement : PDF scanné/image. Il faut passer par une OCR avant de générer les lignes cliquables."
            : "Le document a été lu, mais aucun texte exploitable n'a été extrait. Vérifie le format ou importe un TXT/CSV.",
        file_kind: kind,
        quality,
      },
      { status: 422 },
    );
  }

  const items = extractStructuredItems(rawText, progression as any);
  return NextResponse.json({
    ok: true,
    file_kind: kind,
    warning: extracted.warning,
    raw_text: rawText,
    raw_text_length: rawText.length,
    items,
    items_count: items.length,
    import_text: serializeImportLines(items),
  });
}
