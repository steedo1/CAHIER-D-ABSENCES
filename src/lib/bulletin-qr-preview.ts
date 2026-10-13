import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyBulletinQR } from "@/lib/bulletin-qr";
import { findExistingBulletinShortCodes, getOrCreateBulletinShortCode } from "@/lib/bulletin-qr-store";
import { bulletinOfficialNumber, computeOfficialBulletinSourceId } from "@/lib/official-documents";

type PreviewPayload = {
  instId: string;
  classId: string;
  studentId: string;
  academicYear?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  periodLabel?: string | null;
  [key: string]: unknown;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Une action d'aperçu conserve exactement le snapshot signé, sans relire les notes. */
export async function prepareBulletinPreviewShortCodes(
  srv: SupabaseClient,
  tokens: unknown,
  institutionId: string,
  origin: string,
) {
  if (!Array.isArray(tokens) || !tokens.length || tokens.length > 50) {
    throw new Error("INVALID_PREVIEW_QR_REQUEST");
  }
  // Valider toute la demande avant la première lecture ou écriture.
  const candidates = tokens.map((token) => {
    const signed = typeof token === "string" && token.length <= 200000
      ? verifyBulletinQR(token) : null;
    if (!signed || signed.instId !== institutionId ||
      !uuid.test(signed.classId) || !uuid.test(signed.studentId)) {
      throw new Error("INVALID_PREVIEW_QR_TOKEN");
    }
    // v et iat appartiennent à l'enveloppe HMAC, pas au payload du code court.
    const { v: _version, iat: _issuedAt, ...payload } = signed;
    const snapshot = payload as PreviewPayload;
    const bulletinKey = computeOfficialBulletinSourceId({
      institutionId, classId: snapshot.classId, studentId: snapshot.studentId,
      academicYear: snapshot.academicYear ?? null,
      periodFrom: snapshot.periodFrom ?? null, periodTo: snapshot.periodTo ?? null,
      periodLabel: snapshot.periodLabel ?? null,
    });
    return { bulletinKey, payload: snapshot };
  });
  if (new Set(candidates.map((item) => item.bulletinKey)).size !== candidates.length) {
    throw new Error("INVALID_PREVIEW_QR_REQUEST");
  }
  const classIds = Array.from(new Set(candidates.map((item) => item.payload.classId)));
  const { data: classes, error } = await srv.from("classes").select("id")
    .in("id", classIds).eq("institution_id", institutionId);
  if (error) throw error;
  if (!classes || new Set(classes.map((row) => row.id)).size !== classIds.length) {
    throw new Error("FORBIDDEN_PREVIEW_QR_CLASS");
  }
  const existing = await findExistingBulletinShortCodes(srv, candidates);
  const result = [];
  // Les codes déjà présents ne déclenchent ni requête individuelle ni écriture.
  for (const candidate of candidates) {
    const code = existing.get(candidate.bulletinKey) ||
      await getOrCreateBulletinShortCode(srv, candidate);
    result.push({
      student_id: candidate.payload.studentId,
      official_document_source_id: candidate.bulletinKey,
      official_document_number: bulletinOfficialNumber(code, candidate.bulletinKey),
      qr_mode: "short" as const, qr_code: code, qr_token: null,
      qr_url: `${origin}/v/${code}`,
    });
  }
  return result;
}
