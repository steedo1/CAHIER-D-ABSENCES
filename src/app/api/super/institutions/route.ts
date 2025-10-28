// src/app/api/super/institutions/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function addMonthsISO(dateISO: string, months: number) {
  const d = new Date(dateISO);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  // �x� v�rifie super_admin
  const s = await getSupabaseServerClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: roles } = await s.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const q = (url.searchParams.get("q") ?? "").trim();

  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("institutions")
    .select("id,name,code_unique,subscription_expires_at,settings_json", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.or(`name.ilike.%${q}%,code_unique.ilike.%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0 });
}

export async function POST(req: Request) {
  const supabase = getSupabaseServiceClient();
  const { name, code_unique, subscription_expires_at, settings_json, duration_months, start_date } = await req.json();

  if (!name || !code_unique)
    return NextResponse.json({ error: "name et code_unique requis" }, { status: 400 });

  const startISO = (start_date || new Date().toISOString().slice(0, 10)) as string;
  const months = Number(duration_months ?? 12);
  const expires = subscription_expires_at && String(subscription_expires_at).length > 0
    ? subscription_expires_at
    : addMonthsISO(startISO, months > 0 ? months : 12);

  const { data, error } = await supabase
    .from("institutions")
    .insert({
      name,
      code_unique,
      subscription_expires_at: expires,
      settings_json: settings_json ?? {},
    })
    .select("id,name,code_unique,subscription_expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data });
}


