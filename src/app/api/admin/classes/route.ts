import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();

  const { data, error } = await supabase
    .from("classes")
    .select("id,label,level")
    .eq("institution_id", me?.institution_id)
    .order("label");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Front attend {id,name,level} â†’ map label -> name
  const items = (data ?? []).map(c => ({ id: c.id, name: (c as any).label, level: (c as any).level }));
  return NextResponse.json({ items });
}


