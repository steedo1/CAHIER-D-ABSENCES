import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    items: [],
    message: "Configuration des règles terrain non activée. Les paramètres seront branchés sur le vrai moteur HoraClasse.",
  });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "terrain_rules_not_ready",
      message: "Configuration des règles terrain non activée. Les paramètres seront branchés sur le vrai moteur HoraClasse.",
    },
    { status: 501 }
  );
}
