import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requiresDirectGradePublication } from "@/lib/grades/franco-arabic-publication-policy";

/**
 * Hide legacy approval/settings screens for opt-in Franco-Arabic schools,
 * including direct URL visits. Classic schools keep the original screens.
 * The API layer enforces the same rule independently.
 */
export default async function ClassicGradePublicationOnly({
  children,
}: { children: ReactNode }) {
  const browser = await getSupabaseServerClient();
  const { data: { user }, error } = await getVerifiedServerUser(browser);
  if (error || !user) redirect("/login");
  const service = getSupabaseServiceClient();
  const { data: profile, error: profileError } = await service.from("profiles")
    .select("institution_id").eq("id", user.id).maybeSingle();
  if (profileError) throw new Error("school_publication_access_unavailable");
  if (profile?.institution_id &&
      await requiresDirectGradePublication(service, profile.institution_id)) {
    redirect("/admin/notes");
  }
  return <>{children}</>;
}
