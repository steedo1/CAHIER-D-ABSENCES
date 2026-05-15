// src/app/admin/finance/fees/page.tsx
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  CircleOff,
  FolderPlus,
  Layers3,
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
  { code: "frais_inscription", name: "Frais d’inscription", description: "Frais réglés à la rentrée ou lors d’une nouvelle inscription.", is_mandatory: true },
  { code: "scolarite", name: "Scolarité", description: "Frais de scolarité annuels, par tranche ou versement libre.", is_mandatory: true },
  { code: "tenue_uniforme", name: "Tenue / uniforme", description: "Tenues, uniformes ou équipements exigés par l’établissement.", is_mandatory: false },
  { code: "transport", name: "Transport", description: "Frais de transport scolaire.", is_mandatory: false },
  { code: "cantine", name: "Cantine", description: "Frais de restauration scolaire.", is_mandatory: false },
  { code: "frais_examen", name: "Frais d’examen", description: "Frais liés aux examens, concours ou évaluations officielles.", is_mandatory: false },
  { code: "assurance", name: "Assurance", description: "Assurance scolaire.", is_mandatory: false },
  { code: "carnet_badge", name: "Carnet / badge", description: "Carnet de correspondance, badge ou support d’identification.", is_mandatory: false },
  { code: "frais_dossier", name: "Frais de dossier", description: "Ouverture ou traitement de dossier.", is_mandatory: false },
  { code: "autres_frais", name: "Autres frais", description: "Autres frais ponctuels configurables par l’administration.", is_mandatory: false },
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

  if (!user) throw new Error("Utilisateur non authentifié.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile?.institution_id) throw new Error("Aucun établissement associé à cet utilisateur.");

  return profile.institution_id as string;
}

async function ensureDefaultFeeCategories(institutionId: string) {
  const admin = getSupabaseServiceClient();
  const { data: existing, error } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("code")
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  const existingCodes = new Set((existing ?? []).map((row: any) => String(row.code || "")));
  const now = new Date().toISOString();
  const inserts = DEFAULT_FEE_CATEGORIES.filter((item) => !existingCodes.has(item.code)).map((item) => ({
    school_id: institutionId,
    code: item.code,
    name: item.name,
    description: item.description,
    is_mandatory: item.is_mandatory,
    is_active: true,
    created_at: now,
    updated_at: now,
  }));

  if (inserts.length === 0) return;

  const { error: insertError } = await admin.schema("finance").from("fee_categories").insert(inserts as any);
  if (insertError && !insertError.message?.toLowerCase().includes("duplicate")) {
    throw new Error(insertError.message);
  }
}

async function createFeeCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) redirect("/admin/finance/locked");

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const name = String(formData.get("name") || "").trim();
  const codeInput = String(formData.get("code") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isMandatory = formData.get("is_mandatory") === "on";

  if (!name) throw new Error("Le nom de la catégorie est obligatoire.");

  const code = slugifyCode(codeInput || name);
  if (!code) throw new Error("Le code de la catégorie est invalide.");

  const admin = getSupabaseServiceClient();
  const now = new Date().toISOString();

  const { error } = await admin.schema("finance").from("fee_categories").insert({
    school_id: institutionId,
    code,
    name,
    description: description || null,
    is_mandatory: isMandatory,
    is_active: true,
    updated_at: now,
    created_at: now,
  } as any);

  if (error) {
    if (error.message?.toLowerCase().includes("duplicate")) {
      throw new Error("Une catégorie portant ce code existe déjà pour cet établissement.");
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
  if (!access.ok) redirect("/admin/finance/locked");

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const codeInput = String(formData.get("code") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isMandatory = formData.get("is_mandatory") === "on";

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
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) {
    if (error.message?.toLowerCase().includes("duplicate")) {
      throw new Error("Une autre catégorie utilise déjà ce code.");
    }
    throw new Error(error.message);
  }

  revalidatePath("/admin/finance/fees");
  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance");
}

async function toggleFeeCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) redirect("/admin/finance/locked");

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = String(formData.get("id") || "").trim();
  const nextActive = formData.get("next_active") === "true";

  if (!id) throw new Error("Catégorie introuvable.");

  const admin = getSupabaseServiceClient();
  const { error } = await admin
    .schema("finance")
    .from("fee_categories")
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
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
  if (!access.ok) redirect("/admin/finance/locked");

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Catégorie introuvable.");

  const admin = getSupabaseServiceClient();

  const [{ count: chargeCount, error: chargeErr }, { count: scheduleCount, error: scheduleErr }] = await Promise.all([
    admin
      .schema("finance")
      .from("student_charges")
      .select("id", { count: "exact", head: true })
      .eq("school_id", institutionId)
      .eq("fee_category_id", id),
    admin
      .schema("finance")
      .from("fee_schedules")
      .select("id", { count: "exact", head: true })
      .eq("school_id", institutionId)
      .eq("fee_category_id", id),
  ]);

  if (chargeErr) throw new Error(chargeErr.message);
  if (scheduleErr) throw new Error(scheduleErr.message);

  if ((chargeCount || 0) > 0 || (scheduleCount || 0) > 0) {
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

function StatusPill({ active, activeLabel = "Actif", inactiveLabel = "Inactif" }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3.5 w-3.5" />
      {activeLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <CircleOff className="h-3.5 w-3.5" />
      {inactiveLabel}
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default async function FinanceFeesPage() {
  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) redirect("/admin/finance/locked");

  const institutionId = await getCurrentInstitutionIdOrThrow();
  await ensureDefaultFeeCategories(institutionId);

  const supabase = await getSupabaseServerClient();
  const { data: categories, error } = await supabase
    .schema("finance")
    .from("fee_categories")
    .select("id,school_id,code,name,description,is_mandatory,is_active,created_at,updated_at")
    .eq("school_id", institutionId)
    .order("is_mandatory", { ascending: false })
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
              <Wallet className="h-3.5 w-3.5" /> Catégories de frais
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Catégories</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Les catégories par défaut sont créées automatiquement. L’admin peut ensuite ajouter, modifier, désactiver ou supprimer une catégorie non utilisée.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Catégories</div>
              <div className="mt-2 text-3xl font-black text-white">{rows.length}</div>
              <div className="mt-1 text-sm text-slate-200">Total enregistré</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Actives</div>
              <div className="mt-2 text-3xl font-black text-white">{activeCount}</div>
              <div className="mt-1 text-sm text-slate-200">{mandatoryCount} obligatoires</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Link href="/admin/finance/payments" className="rounded-[26px] border border-slate-200 bg-white p-4 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50">Encaissement</Link>
        <Link href="/admin/finance/payments" className="rounded-[26px] border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-800 shadow-sm hover:bg-emerald-100">Nouvelle inscription</Link>
        <Link href="/admin/finance/receipts" className="rounded-[26px] border border-sky-200 bg-sky-50 p-4 text-sm font-black text-sky-800 shadow-sm hover:bg-sky-100">Reçus</Link>
        <div className="rounded-[26px] border border-amber-300 bg-amber-100 p-4 text-sm font-black text-amber-900 shadow-sm">Catégories</div>
        <Link href="/admin/finance/fees/schedules" className="rounded-[26px] border border-violet-200 bg-violet-50 p-4 text-sm font-black text-violet-800 shadow-sm hover:bg-violet-100">Paramètres des tranches</Link>
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form action={createFeeCategoryAction} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <FolderPlus className="h-4 w-4 text-emerald-600" /> Nouvelle catégorie
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom</label>
              <input type="text" name="name" required placeholder="Ex. Scolarité" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Code</label>
              <input type="text" name="code" placeholder="Ex. scolarite" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400" />
              <p className="mt-1 text-xs text-slate-500">Laisse vide pour génération automatique à partir du nom.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Description</label>
              <textarea name="description" rows={4} placeholder="Ex. Frais annuels liés à la scolarité" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400" />
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <input type="checkbox" name="is_mandatory" defaultChecked className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <span>
                <span className="block text-sm font-bold text-slate-900">Frais obligatoire</span>
                <span className="block text-sm text-slate-600">À cocher si ce frais s’applique normalement aux élèves concernés.</span>
              </span>
            </label>
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700">
              <FolderPlus className="h-4 w-4" /> Ajouter la catégorie
            </button>
          </div>
        </form>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Layers3 className="h-4 w-4 text-emerald-600" /> Catégories enregistrées
          </div>

          {rows.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucune catégorie de frais n’a encore été créée.</div>
          ) : (
            <div className="mt-5 space-y-4">
              {rows.map((row) => (
                <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{row.code}</span>
                        <StatusPill active={row.is_active} />
                        <MandatoryPill mandatory={row.is_mandatory} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{row.description || "Aucune description."}</p>
                      <div className="mt-2 text-xs text-slate-500">Dernière mise à jour : {formatDateTime(row.updated_at)}</div>
                    </div>

                    <form action={toggleFeeCategoryAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="next_active" value={row.is_active ? "false" : "true"} />
                      <button className={["inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition", row.is_active ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50" : "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"].join(" ")}>{row.is_active ? "Désactiver" : "Réactiver"}</button>
                    </form>
                  </div>

                  <form action={updateFeeCategoryAction} className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_0.8fr_1.2fr_auto]">
                    <input type="hidden" name="id" value={row.id} />
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom</label>
                      <input name="name" defaultValue={row.name} required className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Code</label>
                      <input name="code" defaultValue={row.code} required className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Description</label>
                      <input name="description" defaultValue={row.description || ""} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none" />
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input type="checkbox" name="is_mandatory" defaultChecked={row.is_mandatory} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /> Obligatoire
                      </label>
                      <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
                        <Pencil className="h-4 w-4" /> Mettre à jour
                      </button>
                    </div>
                  </form>

                  <form action={deleteOrDisableFeeCategoryAction} className="mt-3">
                    <input type="hidden" name="id" value={row.id} />
                    <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" /> Supprimer si inutilisée, sinon désactiver
                    </button>
                  </form>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700"><CalendarClock className="h-5 w-5" /></div>
          <div>
            <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">Étape suivante</div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Après les catégories, configure les montants par classe ou niveau dans les paramètres des tranches. Les paiements restent souples : versement libre, paiement partiel, tranche ou paiement complet.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
