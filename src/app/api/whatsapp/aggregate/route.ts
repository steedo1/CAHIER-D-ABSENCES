import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sec = (process.env.CRON_WHATSAPP_SECRET || "").trim();
  const hdr = (req.headers.get("x-cron-secret") || "").trim();
  if (sec && hdr !== sec) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const srv = getSupabaseServiceClient();
  const { data, error } = await srv.rpc("f_whatsapp_compact_staged");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ grouped: data ?? 0 });
}
