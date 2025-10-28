import { NextResponse } from "next/server";

function hourCIV() {
  // Abidjan = UTC
  return new Date().getUTCHours();
}

export async function POST(req: Request) {
  // Auth simple via Bearer
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Garde-fou horaire (07h–18h CIV)
  const h = hourCIV();
  if (h < 7 || h > 18) {
    return NextResponse.json({ ok: true, skipped: "outside CIV window", hour: h }, { status: 200 });
  }

  // TODO: ta logique de dispatch push ici
  // Exemple minimal pour voir que ça marche :
  const startedAt = new Date().toISOString();
  // const result = await doDispatch(); // ← ta fonction
  const summary = { sent: 0, queued: 0 }; // remplace par tes stats réelles

  return NextResponse.json({ ok: true, startedAt, summary }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "Use POST with Bearer token" }, { status: 200 });
}
