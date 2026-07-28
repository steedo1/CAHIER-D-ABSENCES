//src/lib/bulletin-qr-store.ts
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashOfficialSnapshot } from "@/lib/official-documents";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I

export function makeShortCode(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export async function getOrCreateBulletinShortCode(
  srv: SupabaseClient,
  opts: {
    bulletinKey: string;
    payload: any; // { instId, classId, studentId, ... }
    expiresAt?: string | null;
  }
) {
  const nowIso = new Date().toISOString();
  const payloadHash = hashOfficialSnapshot(opts.payload);

  // 1) Réutilise un code existant seulement tant qu'il n'a pas été
  // rattaché à un bulletin officiellement émis. Un QR officiel est immuable.
  const { data: existingRows } = await srv
    .from("bulletin_qr_codes")
    .select("id, code, payload, expires_at, revoked, payload_hash, official_issue_id")
    .eq("bulletin_key", opts.bulletinKey)
    .eq("revoked", false)
    .order("created_at", { ascending: false })
    .limit(20);

  const usableRows = (existingRows ?? []).filter((row: any) => {
    if (!row?.code) return false;
    const exp = row.expires_at ? new Date(row.expires_at) : null;
    return !exp || exp.getTime() > Date.now();
  });

  // Une version officielle ayant exactement le même contenu reste prioritaire,
  // même si un brouillon plus récent a été généré après une modification.
  const officialMatch = usableRows.find((row: any) => {
    if (!row.official_issue_id) return false;
    const storedHash =
      String(row.payload_hash || "") || hashOfficialSnapshot(row.payload ?? null);
    return storedHash === payloadHash;
  });
  if (officialMatch?.code) return officialMatch.code;

  // Un QR non encore émis peut être actualisé. Un QR officiel ne l'est jamais.
  const editableDraft = usableRows.find((row: any) => !row.official_issue_id);
  if (editableDraft?.code) {
    const { error: updateError } = await srv
      .from("bulletin_qr_codes")
      .update({
        payload: opts.payload,
        payload_hash: payloadHash,
        expires_at: opts.expiresAt ?? null,
      })
      .eq("id", editableDraft.id);

    if (!updateError) return editableDraft.code;
  }

  // 2) Sinon crée un nouveau code (anti-collision)
  for (let i = 0; i < 8; i++) {
    const code = makeShortCode(12);

    const { error } = await srv.from("bulletin_qr_codes").insert({
      code,
      bulletin_key: opts.bulletinKey,
      payload: opts.payload,
      payload_hash: payloadHash,
      expires_at: opts.expiresAt ?? null,
      revoked: false,
      created_at: nowIso,
    });

    if (!error) return code;

    // collision unique sur code => on réessaye
    if ((error as any)?.code === "23505") continue;

    throw error;
  }

  throw new Error("Impossible de générer un code QR unique (trop de collisions).");
}

export async function resolveBulletinByCode(srv: SupabaseClient, code: string) {
  const normalizedCode = String(code || "").trim().toUpperCase();

  const { data, error } = await srv
    .from("bulletin_qr_codes")
    .select("payload, revoked, expires_at, scan_count")
    .eq("code", normalizedCode)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false as const, error: "invalid_code" as const };

  if (data.revoked) return { ok: false as const, error: "revoked" as const };

  if (data.expires_at) {
    const exp = new Date(data.expires_at);
    if (exp.getTime() <= Date.now())
      return { ok: false as const, error: "expired" as const };
  }

  // petit tracking (optionnel)
  await srv
    .from("bulletin_qr_codes")
    .update({
      scan_count: (data.scan_count ?? 0) + 1,
      last_seen_at: new Date().toISOString(),
    })
    .eq("code", normalizedCode);

  return { ok: true as const, payload: data.payload };
}
