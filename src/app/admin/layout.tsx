import type { Metadata } from "next";
import AdminShell from "./ui/shell"; // ⚠ casse correcte
import FileCorrespondentShell from "./ui/file-correspondent-shell";
import OfflineScheduleSyncBridge from "@/components/admin/OfflineScheduleSyncBridge";
import RelaySupervisionBadge from "@/components/admin/RelaySupervisionBadge";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { ROLE_PRIORITY, type AppRole } from "@/lib/auth/role";

export const metadata: Metadata = { title: "Espace Etablissement — Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getPrimaryRole(): Promise<AppRole | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: rows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id);

    const roles = (rows ?? [])
      .map((row: any) => String(row.role || ""))
      .filter((role): role is AppRole => ROLE_PRIORITY.includes(role as AppRole));

    return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? roles[0] ?? null;
  } catch {
    return null;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const primaryRole = await getPrimaryRole();

  return (
    <>
      <OfflineScheduleSyncBridge />
      <RelaySupervisionBadge />
      {primaryRole === "file_correspondent" ? (
        <FileCorrespondentShell>{children}</FileCorrespondentShell>
      ) : (
        <AdminShell initialRole={primaryRole}>{children}</AdminShell>
      )}
    </>
  );
}
