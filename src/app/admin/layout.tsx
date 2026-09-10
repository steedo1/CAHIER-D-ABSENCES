import type { Metadata } from "next";
import AdminShell from "./ui/shell"; // ⚠ casse correcte
import AttendanceMonitorAutoRefresh from "./ui/attendance-monitor-auto-refresh";

export const metadata: Metadata = { title: "Espace Etablissement — Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AttendanceMonitorAutoRefresh />
      <AdminShell>{children}</AdminShell>
    </>
  );
}
