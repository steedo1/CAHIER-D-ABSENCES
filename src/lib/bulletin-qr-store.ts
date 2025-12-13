//src/lib/bulletin-qr-store.ts
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

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

  // 1) Réutilise un code existant (non révoqué, non expiré)
  const { data: existing } = await srv
    .from("bulletin_qr_codes")
    .select("code, expires_at, revoked")
    .eq("bulletin_key", opts.bulletinKey)
    .eq("revoked", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.code) {
    const exp = existing.expires_at ? new Date(existing.expires_at) : null;
    if (!exp || exp.getTime() > Date.now()) return existing.code;
  }

  // 2) Sinon crée un nouveau code (anti-collision)
  for (let i = 0; i < 8; i++) {
    const code = makeShortCode(12);

    const { error } = await srv.from("bulletin_qr_codes").insert({
      code,
      bulletin_key: opts.bulletinKey,
      payload: opts.payload,
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
  const { data, error } = await srv
    .from("bulletin_qr_codes")
    .select("payload, revoked, expires_at, scan_count")
    .eq("code", code)
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
    .eq("code", code);

  return { ok: true as const, payload: data.payload };
}
