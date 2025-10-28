import { NextResponse } from "next/server";

export async function GET() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  const envOK = !!url && !!anon && url.startsWith("https://") && url.includes(".supabase.co");

  // Petit test r�seau c�t� serveur (on s�"en fiche du 200/404, on veut �viter �SFailed to fetch)
  let serverFetchOK = false;
  let status: number | null = null;
  let err: string | null = null;
  if (envOK) {
    try {
      const r = await fetch(url + "/rest/v1/", { headers: { apikey: anon } });
      status = r.status || null;
      serverFetchOK = true; // si on arrive ici, la r�solution DNS + TLS ont march�
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
    hint: "Si serverFetchOK=true mais le client �choue, c�"est un blocage c�t� navigateur (ad-block, proxy).",
  });
}


