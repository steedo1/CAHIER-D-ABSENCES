import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    items: [],
    message: "Configuration des volumes horaires non activée. La table SQL dédiée sera ajoutée à l’étape suivante.",
  });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "volumes_not_ready",
      message: "Configuration des volumes horaires non activée. La table SQL dédiée sera ajoutée à l’étape suivante.",
    },
    { status: 501 }
  );
}
