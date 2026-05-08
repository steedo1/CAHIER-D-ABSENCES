import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    items: [],
    message: "Gestion des salles et ressources non activée. Les ressources seront préparées avant génération réelle.",
  });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "resources_not_ready",
      message: "Gestion des salles et ressources non activée. Les ressources seront préparées avant génération réelle.",
    },
    { status: 501 }
  );
}
