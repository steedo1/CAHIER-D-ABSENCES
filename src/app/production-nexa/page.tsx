import Link from "next/link";
import { redirect } from "next/navigation";
import { productionAccess, canProduce } from "@/lib/server/production-nexa";
import ProductionWorkspace from "./workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Production Nexa — Mon Cahier", robots: { index: false, follow: false } };

export default async function ProductionPage() {
  const access = await productionAccess();
  if ("error" in access && access.error?.status === 401) redirect("/login");
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b bg-emerald-950 text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6">
        <div><p className="text-sm text-emerald-100">Nexa Digital SARL</p><h1 className="text-3xl font-semibold">Production Nexa</h1></div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {!("error" in access) && !access.account && <Link href="/super/production-nexa" className="underline">Supervision</Link>}
          <Link href="/logout" className="rounded-lg border border-emerald-300 px-3 py-2">Se déconnecter</Link>
        </div>
      </div>
    </header>
    {"error" in access || !canProduce(access, "cards.read")
      ? <p role="alert" className="mx-auto max-w-7xl p-5">L’accès à l’espace Production Nexa est indisponible pour ce compte.</p>
      : <ProductionWorkspace />}
  </main>;
}
