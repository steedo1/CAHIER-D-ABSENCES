import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AI_MODULE_MESSAGE } from "@/lib/mon-cahier-ai/product";
export type AiModuleState = { enabled: boolean; reason: "active" | "disabled" | "expired" | "unavailable"; expires_on: string | null; revision: string | null };

/** Never trust an institution setting editable by a school, nor a browser flag. */
export async function getAiModuleState(srv: SupabaseClient, institutionId: string): Promise<AiModuleState> {
  const { data, error } = await srv.from("institution_ai_module_settings")
    .select("ai_premium_enabled,expires_on,updated_at").eq("institution_id", institutionId).maybeSingle();
  if (error) return { enabled: false, reason: "unavailable", expires_on: null, revision: null };
  const expires = data?.expires_on || null;
  const reason = data?.ai_premium_enabled !== true ? "disabled"
    : expires && expires < new Date().toISOString().slice(0, 10) ? "expired" : "active";
  return { enabled: reason === "active", reason, expires_on: expires, revision: data?.updated_at || null };
}

const requestWindows = new Map<string, { at: number; count: number }>();
function withinRequestBudget(institutionId: string) {
  const now = Date.now();
  for (const [key, window] of requestWindows) if (now - window.at >= 60_000) requestWindows.delete(key);
  let window = requestWindows.get(institutionId);
  if (!window) {
    if (requestWindows.size >= 512) return false;
    window = { at: now, count: 0 }; requestWindows.set(institutionId, window);
  }
  return ++window.count <= 20;
}

/** Checked on every protected request, before reading any analysis or history. */
export async function aiModuleDeniedResponse(srv: SupabaseClient, institutionId: string) {
  const state = await getAiModuleState(srv, institutionId);
  if (state.enabled) {
    if (!withinRequestBudget(institutionId)) return NextResponse.json({ ok: false, error: "AI_RATE_LIMITED",
      message: "Mon Cahier IA est très sollicité pour cet établissement. Réessayez dans une minute." },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
    return null;
  }
  return NextResponse.json({ ok: false, error: state.reason === "unavailable" ? "AI_MODULE_UNAVAILABLE" : "AI_MODULE_DISABLED",
    message: state.reason === "unavailable" ? "L'autorisation Mon Cahier IA est momentanément indisponible." : AI_MODULE_MESSAGE,
    module: state }, { status: state.reason === "unavailable" ? 503 : 403, headers: { "Cache-Control": "private, no-store" } });
}
