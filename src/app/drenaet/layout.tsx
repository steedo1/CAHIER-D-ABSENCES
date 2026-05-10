// src/app/drenaet/layout.tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import DrenaetShell from "./ui/shell";

export const metadata: Metadata = {
  title: "Mon Cahier — Supervision DRENAET",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DrenaetLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  const allowed = (roles || []).some((r: any) => ["drenaet_admin", "super_admin"].includes(String(r.role || "")));
  if (!allowed) redirect("/(errors)/forbidden");

  return <DrenaetShell>{children}</DrenaetShell>;
}
