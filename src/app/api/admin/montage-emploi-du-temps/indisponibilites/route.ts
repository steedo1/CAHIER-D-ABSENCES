import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    items: [],
    message: "Gestion des indisponibilités non activée. Les tables et l’interface seront ajoutées ensuite.",
  });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "unavailability_not_ready",
      message: "Gestion des indisponibilités non activée. Les tables et l’interface seront ajoutées ensuite.",
    },
    { status: 501 }
  );
}
