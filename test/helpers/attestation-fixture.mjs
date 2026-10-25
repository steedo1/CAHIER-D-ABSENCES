import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveAttestationSignatories } from "../../src/lib/franco-arabic-document-signatories.ts";
import { attestationPhotoUrlForCurrentOrigin } from "../../src/lib/attestation-photo-url.ts";
import { documentNationalEmblem } from "../../src/lib/document-national-emblem.ts";

export function generateActualAttestationHtml(args) {
  // Exercise the ACTUAL certificate template without mounting a browser or
  // contacting Supabase: extract its pure template, compile it with TypeScript,
  // and supply only the existing display helpers that it calls.
  const source = readFileSync(new URL("../../src/app/admin/parents/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function buildAttestationHtml(");
  const end = source.indexOf("\nfunction openPrintDocument(", start);
  assert.ok(start > 0 && end > start, "existing A4 certificate generator must remain in use");
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  assert.match(source, /settings_json: settingsJson\?\.settings_json \?\? \{\}/);
  assert.match(source, /resolveAttestationSignatories\(cfg\)/);
  const factory = new Function(
    "resolveAttestationSignatories", "formatDateLongFr", "institutionDisplayName",
    "escapeHtml", "formatDateShortFr", "safeSlug", "studentOfficialName",
    "attestationPhotoUrlForCurrentOrigin", "documentNationalEmblem", "window",
    compiled + "\nreturn buildAttestationHtml;",
  );
  const escape = value => String(value ?? "").replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const slug = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const html = factory(
    resolveAttestationSignatories,
    () => "18 octobre 2026",
    cfg => cfg.institution_name || "École",
    escape,
    () => "01/01/2015",
    slug,
    row => [row.last_name, row.first_name].filter(Boolean).join(" "),
    attestationPhotoUrlForCurrentOrigin,
    documentNationalEmblem,
    { location: { origin: "https://www.mon-cahier.com" } },
  );
  return html(args);
}

