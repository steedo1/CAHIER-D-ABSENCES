import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "horaclasse_model",
    items: [],
    message: "Coque conforme au modèle HoraClasse. Le stockage sera branché après intégration du vrai scheduler.",
  });
}
