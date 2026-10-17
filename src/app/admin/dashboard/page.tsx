export const dynamic = "force-dynamic";
export const revalidate = 0;

import AdminDashboardClient from "./client";

/** Same landing page as production; teaching/cycle context belongs in sidebar. */
export default function AdminDashboard() {
  return <AdminDashboardClient />;
}
