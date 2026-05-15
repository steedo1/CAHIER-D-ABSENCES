// src/app/admin/finance/fees/page.tsx
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CircleOff,
  FolderPlus,
  Pencil,
  ShieldCheck,
  Trash2,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type FeeCategoryRow = {
  id: string;
  school_id: string;
  code: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const DEFAULT_FEE_CATEGORIES = [
  { code: "frais_inscription", name: "Frais d’inscription", is_mandatory: true },
  { code: "scolarite", name: "Scolarité", is_mandatory: true },
  { code: "tenue_uniforme", name: "Tenue / uniforme", is_mandatory: false },
  { code: "transport", name: "Transport", is_mandatory: false },
  { code: "cantine", name: "Cantine", is_mandatory: false },
  { code: "frais_examen", name: "Frais d’examen", is_mandatory: false },
  { code: "assurance", name: "Assurance", is_mandatory: false },
  { code: "carnet_badge", name: "Carnet / badge", is_mandatory: false },
  { code: "frais_dossier", name: "Frais de dossier", is_mandatory: false },
  { code: "autres_frais", name: "Autres frais", is_mandatory: false },
];

function slugifyCode(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

async function getCurrentInstitutionIdOrThrow() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Utilisateur non authentifié.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!profile?.institution_id) {
    throw new Error("Aucun établissement associé à cet utilisateur.");
  }

  return profile.institution_id as string;
}

async function ensureDefaultFeeCategories(institutionId: string) {
  const admin = getSupabaseServiceClient();

  const { data: existing, error } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("id,code")
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  const existingCodes = new Set(
    ((existing ?? []) as Array<{ code: string | null }>).map((row) => row.code),
  );
  const missing = DEFAULT_FEE_CATEGORIES.filter(
    (item) => !existingCodes.has(item.code),
  );

  if (missing.length === 0) return;

  const now = new Date().toISOString();
  const { error: insertErr } = await admin
    .schema("finance")
    .from("fee_categories")
    .insert(
      missing.map((item) => ({
        school_id: institutionId,
        code: item.code,
        name: item.name,
        description: null,
        is_mandatory: item.is_mandatory,
        is_active: true,
        created_at: now,
        updated_at: now,
      })) as any[],
    );

  if (insertErr && !insertErr.message?.toLowerCase().includes("duplicate")) {
    throw new Error(insertErr.message);
  }
}

async function createFeeCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  await ensureDefaultFeeCategories(institutionId);

  const name = String(formData.get("name") || "").trim();
  const codeInput = String(formData.get("code") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isMandatory = formData.get("is_mandatory") === "on";

  if (!name) throw new Error("Le nom de la catégorie est obligatoire.");

  const code = slugifyCode(codeInput || name);
  if (!code) throw new Error("Le code de la catégorie est invalide.");

  const now = new Date().toISOString();
  const admin = getSupabaseServiceClient();
  const { error } = await admin
    .schema("finance")
    .from("fee_categories")
    .insert({
      school_id: institutionId,
      code,
      name,
      description: description || null,
      is_mandatory: isMandatory,
      is_active: true,
      created_at: now,
      updated_at: now,
    } as any);

  if (error) {
    if (error.message?.toLowerCase().includes("duplicate")) {
      throw new Error("Une catégorie portant ce code existe déjà.");
    }
    throw new Error(error.message);
  }

  revalidatePath("/admin/finance/fees");
  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance");
}

async function updateFeeCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const codeInput = String(formData.get("code") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isMandatory = formData.get("is_mandatory") === "on";
  const isActive = formData.get("is_active") === "on";

  if (!id) throw new Error("Catégorie introuvable.");
  if (!name) throw new Error("Le nom de la catégorie est obligatoire.");

  const code = slugifyCode(codeInput || name);
  if (!code) throw new Error("Le code de la catégorie est invalide.");

  const admin = getSupabaseServiceClient();
  const { error } = await admin
    .schema("finance")
    .from("fee_categories")
    .update({
      code,
      name,
      description: description || null,
      is_mandatory: isMandatory,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/fees");
  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance");
}

async function deleteOrDisableFeeCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Catégorie introuvable.");

  const admin = getSupabaseServiceClient();

  const [{ count: schedulesCount, error: schErr }, { count: chargesCount, error: chErr }] =
    await Promise.all([
      admin
        .schema("finance")
        .from("fee_schedules")
        .select("id", { count: "exact", head: true })
        .eq("school_id", institutionId)
        .eq("fee_category_id", id),
      admin
        .schema("finance")
        .from("student_charges")
        .select("id", { count: "exact", head: true })
        .eq("school_id", institutionId)
        .eq("fee_category_id", id),
    ]);

  if (schErr) throw new Error(schErr.message);
  if (chErr) throw new Error(chErr.message);

  const used = Number(schedulesCount || 0) + Number(chargesCount || 0) > 0;

  if (used) {
    const { error } = await admin
      .schema("finance")
      .from("fee_categories")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", institutionId);

    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .schema("finance")
      .from("fee_categories")
      .delete()
      .eq("id", id)
      .eq("school_id", institutionId);

    if (error) throw new Error(error.message);
  }

  revalidatePath("/admin/finance/fees");
  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance");
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3.5 w-3.5" />
      Actif
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <CircleOff className="h-3.5 w-3.5" />
      Inactif
    </span>
  );
}

function MandatoryPill({ mandatory }: { mandatory: boolean }) {
  return mandatory ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
      <ShieldCheck className="h-3.5 w-3.5" />
      Obligatoire
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200">
      Optionnel
    </span>
  );
}

export default async function FinanceFeesPage() {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  await ensureDefaultFeeCategories(institutionId);

  const supabase = await getSupabaseServerClient();
  const { data: categories, error } = await supabase
    .schema("finance")
    .from("fee_categories")
    .select(
      "id,school_id,code,name,description,is_mandatory,is_active,created_at,updated_at",
    )
    .eq("school_id", institutionId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (categories ?? []) as FeeCategoryRow[];
  const activeCount = rows.filter((r) => r.is_active).length;
  const mandatoryCount = rows.filter((r) => r.is_mandatory).length;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <Wallet className="h-3.5 w-3.5" />
              Paramètres de caisse
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Catégories de frais
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Les catégories par défaut sont créées automatiquement. L’admin peut
              ajouter, modifier, supprimer si la catégorie est inutilisée ou la
              désactiver si elle a déjà servi.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                Actives
              </div>
              <div className="mt-2 text-2xl font-black text-white">{activeCount}</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                Obligatoires
              </div>
              <div className="mt-2 text-2xl font-black text-white">{mandatoryCount}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <form
          action={createFeeCategoryAction}
          className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <FolderPlus className="h-4 w-4 text-emerald-600" />
            Ajouter une catégorie
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Nom
              </label>
              <input
                name="name"
                required
                placeholder="Ex. Frais d’inscription"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Code
              </label>
              <input
                name="code"
                placeholder="Facultatif"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Description
              </label>
              <textarea
                name="description"
                rows={3}
                placeholder="Précision interne"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                name="is_mandatory"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              Frais obligatoire
            </label>
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
              <FolderPlus className="h-4 w-4" />
              Ajouter
            </button>
          </div>
        </form>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                Catégories disponibles
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Modifiez sans casser l’historique. Si une catégorie est déjà
                utilisée, elle sera désactivée plutôt que supprimée.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {rows.map((row) => (
              <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto text-lg font-black text-slate-900">{row.name}</h2>
                  <StatusPill active={row.is_active} />
                  <MandatoryPill mandatory={row.is_mandatory} />
                </div>

                <form action={updateFeeCategoryAction} className="grid gap-3 lg:grid-cols-[1fr_0.85fr_1.2fr_auto] lg:items-end">
                  <input type="hidden" name="id" value={row.id} />
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                      Nom
                    </label>
                    <input
                      name="name"
                      defaultValue={row.name}
                      required
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                      Code
                    </label>
                    <input
                      name="code"
                      defaultValue={row.code}
                      required
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                      Description
                    </label>
                    <input
                      name="description"
                      defaultValue={row.description || ""}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                      <input type="checkbox" name="is_mandatory" defaultChecked={row.is_mandatory} />
                      Obligatoire
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                      <input type="checkbox" name="is_active" defaultChecked={row.is_active} />
                      Actif
                    </label>
                    <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800">
                      <Pencil className="h-3.5 w-3.5" />
                      Mettre à jour
                    </button>
                  </div>
                </form>

                <form action={deleteOrDisableFeeCategoryAction} className="mt-3">
                  <input type="hidden" name="id" value={row.id} />
                  <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100">
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer si inutilisée / désactiver sinon
                  </button>
                </form>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
