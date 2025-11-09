// src/app/api/push/public-key/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERBOSE = (process.env.VERBOSE_PUSH || "1") !== "0";
function log(stage: string, meta: Record<string, unknown>) {
  if (VERBOSE) console.info(`[push/public-key] ${stage}`, meta);
}

export async function GET() {
  const pubFromNext = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
  const pubLegacy   = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const key = pubFromNext || pubLegacy || "";
  if (!key) log("missing_key", { hasNextPublic: !!pubFromNext, hasLegacy: !!pubLegacy });
  else log("key_ok", { source: pubFromNext ? "NEXT_PUBLIC" : "VAPID", len: key.length });
  return NextResponse.json({ key });
}
