import { NextResponse } from "next/server";

export async function GET() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  const envOK = !!url && !!anon && url.startsWith("https://") && url.includes(".supabase.co");

  // Petit test réseau côté serveur (on s’en fiche du 200/404, on veut éviter “Failed to fetchâ€)
  let serverFetchOK = false;
  let status: number | null = null;
  let err: string | null = null;
  if (envOK) {
    try {
      const r = await fetch(url + "/rest/v1/", { headers: { apikey: anon } });
      status = r.status || null;
      serverFetchOK = true; // si on arrive ici, la résolution DNS + TLS ont marché
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
    hint: "Si serverFetchOK=true mais le client échoue, c’est un blocage côté navigateur (ad-block, proxy).",
  });
}


