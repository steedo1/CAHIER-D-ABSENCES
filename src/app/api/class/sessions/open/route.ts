// src/app/api/class/sessions/open/route.ts
import { NextRequest } from "next/server";
import { POST as startSessionPost } from "@/app/api/class/sessions/start/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Route legacy de compatibilité.
 *
 * IMPORTANT :
 * - Toute la logique métier de démarrage de séance doit désormais vivre
 *   dans /api/class/sessions/start
 * - On garde cet endpoint pour éviter de casser d'éventuels anciens appels,
 *   mais on le redirige vers la même implémentation serveur.
 */
export async function POST(req: NextRequest) {
  return startSessionPost(req);
}