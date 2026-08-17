import type { Metadata } from "next";
import AdminShell from "./ui/shell"; // ⚠ casse correcte
import OfflineScheduleSyncBridge from "@/components/admin/OfflineScheduleSyncBridge";
import RelaySupervisionBadge from "@/components/admin/RelaySupervisionBadge";

export const metadata: Metadata = { title: "Espace Etablissement — Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflineScheduleSyncBridge />
      <RelaySupervisionBadge />
      <AdminShell>{children}</AdminShell>
    </>
  );
}
