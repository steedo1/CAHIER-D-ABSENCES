import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    items: [],
    message:
      "Stockage des projets de montage non activé. La table SQL sera ajoutée à l’étape suivante.",
  });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "storage_not_ready",
      message:
        "La sauvegarde des brouillons sera activée après création des tables SQL du module Montage emploi du temps.",
    },
    { status: 501 }
  );
}
