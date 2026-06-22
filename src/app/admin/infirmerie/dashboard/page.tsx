// src/app/admin/infirmerie/dashboard/page.tsx
import InfirmaryStatsDashboard from "@/components/infirmary/InfirmaryStatsDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminInfirmaryDashboardPage() {
  return <InfirmaryStatsDashboard audience="admin" />;
}
