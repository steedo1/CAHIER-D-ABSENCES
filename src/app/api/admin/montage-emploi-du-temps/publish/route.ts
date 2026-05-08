import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "publish_not_ready",
      message:
        "Publication désactivée pour l’instant. Elle sera branchée après validation du moteur et création des tables de brouillon.",
    },
    { status: 501 }
  );
}
