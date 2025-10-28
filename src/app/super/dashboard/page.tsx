// src/app/super/dashboard/page.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const dynamic = "force-dynamic";

export default async function SuperDashboardPage() {
  // Auth + rôle
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);
  const isSuper = (roles ?? []).some((r) => r.role === "super_admin");
  if (!isSuper) redirect("/(errors)/forbidden");

  // headers() est async dans ton environnement → on attend avant d'appeler .get()
  const h = await headers();
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${getBaseUrl()}/api/super/stats`, {
    cache: "no-store",
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`Stats API error: ${res.status}`);
  const stats = await res.json(); // { institutions, admins, users, expiringIn30d }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-slate-600">Vue d’ensemble des abonnements et utilisateurs.</p>
        </div>
      </div>

      {/* Cartes de stats */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Établissements", value: stats.institutions, icon: "🏫" },
          { label: "Admins d’établissement", value: stats.admins, icon: "🧑‍💼" },
          { label: "Utilisateurs (profils)", value: stats.users, icon: "👤" },
          { label: "Abonnements expirant ≤ 30 j", value: stats.expiringIn30d, icon: "⏳" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-2xl" aria-hidden="true">
                {c.icon}
              </div>
              <div className="text-3xl font-semibold">{c.value ?? 0}</div>
            </div>
            <div className="mt-1 text-sm text-slate-600">{c.label}</div>
          </div>
        ))}
      </section>

      {/* Raccourcis */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Actions rapides</h3>
          <ul className="text-sm leading-7">
            <li>
              <a className="text-violet-700 hover:underline" href="/super/etablissements">
                Créer un établissement
              </a>
            </li>
            <li>
              <a className="text-violet-700 hover:underline" href="/super/admins">
                Ajouter un admin
              </a>
            </li>
            <li>
              <a className="text-violet-700 hover:underline" href="/super/abonnements">
                Voir les abonnements
              </a>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Aide rapide</h3>
          <ul className="list-disc pl-5 text-sm text-slate-700">
            <li>
              Les abonnements se définissent par une <b>durée (mois)</b>, la date d’expiration est
              calculée automatiquement.
            </li>
            <li>
              Un <b>admin d’établissement</b> est créé à partir de son email (profil + rôle +
              rattachement).
            </li>
            <li>Les réglages JSON sont optionnels (thème/quotas/toggles).</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
