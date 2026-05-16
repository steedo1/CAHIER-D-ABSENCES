// src/app/api/payments/webhooks/orange_money/route.ts
// Sécurisé par défaut : on activera ce webhook quand Orange aura fourni le format officiel de signature/callback.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Webhook Orange Money non activé. Il faut d’abord renseigner le format officiel de callback et de signature fourni par Orange.",
    },
    { status: 503 },
  );
}
