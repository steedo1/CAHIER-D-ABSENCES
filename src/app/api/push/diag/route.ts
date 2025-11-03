// src/app/api/push/diag/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const srv = getSupabaseServiceClient();

  // 1) Tester l'existence de colonnes en tentant une petite sélection
  const tests: Record<string, boolean | string> = {};
  async function hasColumn(col: string) {
    const r = await srv.from("push_subscriptions").select(col).limit(1);
    if (r.error) { tests[col] = r.error.message; return false; }
    tests[col] = true; return true;
  }

  await hasColumn("subscription_json");
  await hasColumn("platform");
  await hasColumn("device_id");
  await hasColumn("last_seen_at");

  // 2) Compter doublons (si la table est grande, c'est limité mais utile)
  let duplicates: Array<{ user_id: string; platform: string | null; device_id: string | null; n: number }> = [];
  try {
    const { data, error } = await srv
      .from("push_subscriptions")
      .select("user_id, platform, device_id")
      .limit(10000); // échantillon raisonnable
    if (!error && data) {
      const map = new Map<string, number>();
      for (const r of data as any[]) {
        const k = [r.user_id, r.platform ?? "NULL", r.device_id ?? "NULL"].join("|");
        map.set(k, (map.get(k) || 0) + 1);
      }
      duplicates = Array.from(map.entries())
        .filter(([, n]) => n > 1)
        .map(([k, n]) => {
          const [u, p, d] = k.split("|");
          return { user_id: u, platform: p === "NULL" ? null : p, device_id: d === "NULL" ? null : d, n };
        });
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    env: {
      has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      has_vapid_pub: !!process.env.VAPID_PUBLIC_KEY,
    },
    columns_ok: tests,
    duplicates_sample: duplicates.slice(0, 50),
    hint_unique:
      "Assure une contrainte UNIQUE (user_id,platform,device_id). Si elle manque, crée-la et NOTIFY pgrst, 'reload schema';",
  });
}
