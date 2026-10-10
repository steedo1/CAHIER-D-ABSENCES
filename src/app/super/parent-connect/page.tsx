import { redirect } from "next/navigation";
import { requireParentConnectSuper } from "@/lib/parent-connect/super-access";
import ParentConnectControl from "./Control";

export const dynamic = "force-dynamic";
export default async function Page() {
  const access = await requireParentConnectSuper();
  if (access.error?.status === 401) redirect("/login");
  if (access.error) return <p role="alert" className="rounded-xl border bg-white p-6">{access.error.status === 403 ? "Cet espace est réservé au super admin." : "Impossible de vérifier votre accès. Réessayez."}</p>;
  return <ParentConnectControl />;
}
