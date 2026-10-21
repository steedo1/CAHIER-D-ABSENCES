// src/app/api/payments/webhooks/orange/route.ts
// Alias conservé pour compatibilité avec les URLs courtes communiquées à Orange.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export { GET, POST } from "../orange_money/route";
