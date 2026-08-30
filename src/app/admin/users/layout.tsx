import Link from "next/link";
import { FileSpreadsheet, UserPlus } from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";

async function canCreateFileCorrespondent() {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id);

    return (roles ?? []).some((row: any) =>
      ["admin", "super_admin"].includes(String(row.role || "")),
    );
  } catch {
    return false;
  }
}

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const canCreate = await canCreateFileCorrespondent();

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white shadow-sm">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-black text-slate-950">Profil Correspondant fichier</div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">
                  Crée un compte dédié qui n’affiche que Correspondant fichier,
                  Organisation scolaire et Paramètres. Le profil Admin reste inchangé.
                </p>
              </div>
            </div>

            <Link
              href="/admin/users/correspondant-fichier"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700"
            >
              <UserPlus className="h-4 w-4" />
              Créer le profil
            </Link>
          </div>
        </div>
      ) : null}

      {children}
    </div>
  );
}
