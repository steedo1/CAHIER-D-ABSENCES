//src/app/api/push/subscribe/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { subscription } = await req.json();
  if (!subscription) return NextResponse.json({ error: "missing_subscription" }, { status: 400 });

  const { error } = await srv
    .from("push_subscriptions")
    .upsert({ user_id: user.id, subscription_json: subscription }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}


