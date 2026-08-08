import type { Metadata } from "next";
import AdminShell from "./ui/shell"; // ⚠ casse correcte
import OfflineScheduleSyncBridge from "@/components/admin/OfflineScheduleSyncBridge";
import OfflinePreparationCoordinator from "@/components/OfflinePreparationCoordinator";

export const metadata: Metadata = { title: "Espace Etablissement — Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflinePreparationCoordinator role="admin" />
      <OfflineScheduleSyncBridge />
      <AdminShell>{children}</AdminShell>
    </>
  );
}
