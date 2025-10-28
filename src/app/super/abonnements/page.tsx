import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

type Institution = {
  id: string;
  name: string;
  code_unique: string;
  subscription_expires_at: string;
};

export const dynamic = "force-dynamic";

async function renewAction(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  await fetch(
    `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/super/institutions/${id}/renew`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ months: 12 }),
      cache: "no-store",
    }
  );
  revalidatePath("/super/abonnements");
}

export default async function AbonnementsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);
  const isSuper = (roles ?? []).some((r) => r.role === "super_admin");
  if (!isSuper) redirect("/(errors)/forbidden");

  const { data } = await supabase
    .from("institutions")
    .select("id,name,code_unique,subscription_expires_at")
    .order("subscription_expires_at", { ascending: true });

  const items = (data ?? []) as Institution[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Abonnements</h1>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Établissement</th>
              <th className="px-4 py-2 text-left">Code</th>
              <th className="px-4 py-2 text-left">Expire le</th>
              <th className="px-4 py-2 text-left">Jours restants</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const daysLeft = diffDays(i.subscription_expires_at);
              return (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2">{i.name}</td>
                  <td className="px-4 py-2">{i.code_unique}</td>
                  <td className="px-4 py-2">{i.subscription_expires_at}</td>
                  <td className={`px-4 py-2 ${daysLeft <= 30 ? "text-red-600" : ""}`}>{daysLeft}</td>
                  <td className="px-4 py-2">
                    <form action={renewAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs text-white">
                        Renouveler +12 mois
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function diffDays(dateISO: string) {
  const today = new Date();
  const d = new Date(dateISO + "T00:00:00");
  const ms =
    d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
