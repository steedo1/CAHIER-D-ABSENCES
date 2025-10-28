// src/app/api/debug/env/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  const envOK = !!url && !!anon && url.startsWith("https://") && url.includes(".supabase.co");

  // Petit test reseau cote serveur (on se fiche du 200/404, on veut eviter "Failed to fetch")
  let serverFetchOK = false;
  let status: number | null = null;
  let err: string | null = null;

  if (envOK) {
    try {
      const r = await fetch(url + "/rest/v1/", { headers: { apikey: anon } });
      status = r.status ?? null;
      // Si on arrive ici, la resolution DNS + TLS ont fonctionne
      serverFetchOK = true;
    } catch (e: any) {
      err = e?.message || String(e);
    }
  }

  return NextResponse.json({
    envOK,
    url,
    anonLen: anon.length,
    serverFetchOK,
    status,
    err,
    hint:
      "Si serverFetchOK=true mais le client echoue, c'est un blocage cote navigateur (ad-block, proxy).",
  });
}
