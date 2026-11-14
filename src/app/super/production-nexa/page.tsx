import { notFound } from "next/navigation";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";
import Supervision from "./supervision";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supervision Production Nexa — Mon Cahier" };

export default async function SuperProductionPage() {
  const access = await requireSuperAdminAccess();
  if ("error" in access) notFound();
  return <Supervision />;
}
