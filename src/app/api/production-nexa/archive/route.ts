import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { PRODUCTION_BUCKET, PDF_MAX_BYTES } from "@/lib/production-nexa";
import { ARCHIVE_FIELDS, canProduce, openGenerationTicket, productionAccess, ProductionError, productionFailure, productionStudentsDigest, readLimited } from "@/lib/server/production-nexa";
import { cardJson, requireCardOrigin } from "@/lib/server/school-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let uploadInProgress = false;

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const access = await productionAccess(); if ("error" in access) return access.error;
    if (!canProduce(access, "cards.generate")) return cardJson({ error: "production_non_autorisee" }, 403);
    const ticket = openGenerationTicket(req.headers.get("x-nexa-production-ticket"), access.userId);
    if (!canProduce(access, "cards.generate", ticket.institutionId)) return cardJson({ error: "etablissement_hors_perimetre" }, 403);
    if (req.headers.get("content-type") !== "application/vnd.nexa.card-production") return cardJson({ error: "pdf_requis" }, 415);
    const service = access.service;
    const existing = await service.from("nexa_card_archives").select(ARCHIVE_FIELDS).eq("id", ticket.id)
      .eq("institution_id", ticket.institutionId).maybeSingle();
    if (existing.error) throw Error("archive_indisponible");
    if (existing.data) return cardJson({ archive: existing.data });
    if (uploadInProgress) return cardJson({ error: "archivage_en_cours_reessayer" }, 503);
    uploadInProgress = true;
    try {
      const payload = await readLimited(req, PDF_MAX_BYTES + 65_536);
      const metadataSize = payload.length >= 4 ? payload.readUInt32BE(0) : 0;
      if (!metadataSize || metadataSize > 65_532 || metadataSize + 4 >= payload.length) throw new ProductionError("fiche_production_invalide", 400);
      let students: { id: string; name: string; matricule: string }[];
      try {
        students = JSON.parse(payload.subarray(4, 4 + metadataSize).toString("utf8"));
        if (!Array.isArray(students) || students.length !== ticket.studentIds.length || students.some((item, index) =>
          !item || item.id !== ticket.studentIds[index] || typeof item.name !== "string" || typeof item.matricule !== "string") ||
          productionStudentsDigest(students) !== ticket.studentsDigest) throw Error();
        students = students.map(({ id, name, matricule }) => ({ id, name, matricule }));
      } catch { throw new ProductionError("fiche_production_invalide", 400); }
      const bytes = payload.subarray(4 + metadataSize);
      if (bytes.length > PDF_MAX_BYTES) throw new ProductionError("pdf_trop_volumineux", 413);
      if (!/^%PDF-1\.[0-9]/.test(bytes.subarray(0, 8).toString("ascii")) ||
        !bytes.subarray(-64).toString("ascii").trimEnd().endsWith("%%EOF")) throw new ProductionError("pdf_invalide", 400);
      const objectPath = `${ticket.institutionId}/${ticket.year}/${ticket.id}.pdf`;
      const storage = service.storage.from(PRODUCTION_BUCKET);
      const file = await storage.upload(objectPath, new Uint8Array(bytes), {
        contentType: "application/pdf", cacheControl: "0", upsert: false,
      });
      if (file.error) {
        const prior = await service.from("nexa_card_archives").select(ARCHIVE_FIELDS).eq("id", ticket.id)
          .eq("institution_id", ticket.institutionId).maybeSingle();
        if (prior.data) return cardJson({ archive: prior.data });
        if (!(("statusCode" in file.error && String(file.error.statusCode) === "409") || /already exists|duplicate/i.test(file.error.message))) {
          throw Error("stockage_pdf_indisponible");
        }
        // The object may have survived a restart between upload and insert.
        // Resume only with exactly the PDF originally uploaded for this ticket.
        const stored = await storage.download(objectPath).asStream();
        if (stored.error || !stored.data) throw Error("fichier_a_reprendre_indisponible");
        const hash = createHash("sha256");
        const reader = stored.data.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            hash.update(value);
          }
        } finally { reader.releaseLock(); }
        if (hash.digest("hex") !== createHash("sha256").update(bytes).digest("hex")) {
          throw new ProductionError("fichier_de_reprise_different", 409);
        }
      }

      const row = { id: ticket.id, institution_id: ticket.institutionId, academic_year: ticket.year, order_id: ticket.orderId,
        previous_id: ticket.previousId, batch_key: ticket.batchKey, version: ticket.version, student_ids: ticket.studentIds, students,
        object_path: objectPath, size_bytes: bytes.length, actor_id: access.userId, format: ticket.format, flip: ticket.flip };
      try {
        const result = await service.from("nexa_card_archives").insert(row).select(ARCHIVE_FIELDS).single();
        if (!result.error && result.data) return cardJson({ archive: result.data }, 201);
        if (result.error?.code === "23505" || result.error?.code === "23514" || result.error?.code === "23503") {
          const check = await service.from("nexa_card_archives").select(ARCHIVE_FIELDS).eq("id", ticket.id).maybeSingle();
          if (check.data) return cardJson({ archive: check.data });
          if (!check.error) {
            await storage.remove([objectPath]);
            return cardJson({ error: "version_ou_commande_modifiee_recharger" }, 409);
          }
        }
      } catch {
        // A lost response may conceal a committed insert. Check before cleanup.
      }
      const check = await service.from("nexa_card_archives").select(ARCHIVE_FIELDS).eq("id", ticket.id).maybeSingle();
      if (check.data) return cardJson({ archive: check.data });
      throw Error("archivage_pdf_indisponible");
    } finally { uploadInProgress = false; }
  } catch (error) { return productionFailure(error); }
}
