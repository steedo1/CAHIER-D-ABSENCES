// src/app/admin/finance/fees/schedules/page.tsx
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  CircleOff,
  FolderPlus,
  Layers3,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type FeeCategoryRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type FeeScheduleRow = {
  id: string;
  school_id: string;
  academic_year: string | null;
  class_id: string | null;
  fee_category_id: string;
  label: string;
  amount: number;
  due_date: string | null;
  allow_partial: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function buildLevelScheduleLabel(
  labelInput: string,
  categoryName: string,
  classLabel: string
) {
  const base = labelInput || categoryName;
  return `${base} - ${classLabel}`;
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

async function createFeeScheduleAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const admin = getSupabaseServiceClient();

  const targetScope = normalizeText(formData.get("target_scope")) || "class";
  const classId = normalizeText(formData.get("class_id"));
  const level = normalizeText(formData.get("level"));
  const feeCategoryId = normalizeText(formData.get("fee_category_id"));
  const academicYear = normalizeText(formData.get("academic_year"));
  const labelInput = normalizeText(formData.get("label"));
  const amountRaw = normalizeText(formData.get("amount"));
  const dueDate = normalizeText(formData.get("due_date"));
  const notes = normalizeText(formData.get("notes"));
  const allowPartial = formData.get("allow_partial") === "on";

  if (!feeCategoryId) {
    throw new Error("La catégorie de frais est obligatoire.");
  }
  if (!academicYear) {
    throw new Error("L’année scolaire est obligatoire.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant doit être supérieur à 0.");
  }

  const { data: categoryRow, error: catErr } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("id,name,school_id,is_active")
    .eq("id", feeCategoryId)
    .eq("school_id", institutionId)
    .maybeSingle();

  if (catErr) throw new Error(catErr.message);
  if (!categoryRow) throw new Error("Catégorie introuvable.");

  if (targetScope === "level") {
    if (!level) {
      throw new Error("Le niveau est obligatoire pour une création par niveau.");
    }

    const { data: levelClasses, error: classesErr } = await admin
      .from("classes")
      .select("id,label,level,academic_year,institution_id")
      .eq("institution_id", institutionId)
      .eq("level", level)
      .order("label", { ascending: true });

    if (classesErr) throw new Error(classesErr.message);

    const targetClasses = ((levelClasses ?? []) as ClassRow[]).filter((c) => {
      if (!c.academic_year) return true;
      return c.academic_year === academicYear;
    });

    if (targetClasses.length === 0) {
      throw new Error(
        `Aucune classe trouvée pour le niveau ${level} sur l’année ${academicYear}.`
      );
    }

    const targetClassIds = targetClasses.map((c) => c.id);

    const { data: existingSchedules, error: existingErr } = await admin
      .schema("finance")
      .from("fee_schedules")
      .select("id,class_id")
      .eq("school_id", institutionId)
      .eq("fee_category_id", feeCategoryId)
      .eq("academic_year", academicYear)
      .in("class_id", targetClassIds);

    if (existingErr) throw new Error(existingErr.message);

    const existingClassIds = new Set(
      ((existingSchedules ?? []) as Array<{ id: string; class_id: string | null }>)
        .map((row) => row.class_id)
        .filter(Boolean) as string[]
    );

    if (existingClassIds.size > 0) {
      const conflicts = targetClasses
        .filter((c) => existingClassIds.has(c.id))
        .map((c) => c.label);

      const preview = conflicts.slice(0, 5).join(", ");
      const suffix = conflicts.length > 5 ? " ..." : "";

      throw new Error(
        `Un barème de cette catégorie existe déjà sur l’année ${academicYear} pour : ${preview}${suffix}`
      );
    }

    const rowsToInsert = targetClasses.map((c) => ({
      school_id: institutionId,
      academic_year: academicYear,
      class_id: c.id,
      fee_category_id: feeCategoryId,
      label: buildLevelScheduleLabel(labelInput, categoryRow.name, c.label),
      amount,
      due_date: dueDate || null,
      allow_partial: allowPartial,
      is_active: true,
      notes: notes || null,
    }));

    const { error } = await admin
      .schema("finance")
      .from("fee_schedules")
      .insert(rowsToInsert as any[]);

    if (error) throw new Error(error.message);

    revalidatePath("/admin/finance/fees/schedules");
    revalidatePath("/admin/finance");
    return;
  }

  if (!classId) {
    throw new Error("La classe est obligatoire.");
  }

  const { data: classRow, error: classErr } = await admin
    .from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) throw new Error(classErr.message);
  if (!classRow) throw new Error("Classe introuvable.");

  const { error } = await admin
    .schema("finance")
    .from("fee_schedules")
    .insert({
      school_id: institutionId,
      academic_year: academicYear,
      class_id: classId,
      fee_category_id: feeCategoryId,
      label: labelInput || `${categoryRow.name} - ${classRow.label}`,
      amount,
      due_date: dueDate || null,
      allow_partial: allowPartial,
      is_active: true,
      notes: notes || null,
    } as any);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/fees/schedules");
  revalidatePath("/admin/finance");
}

async function toggleFeeScheduleAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const admin = getSupabaseServiceClient();

  const id = normalizeText(formData.get("id"));
  const nextActive = formData.get("next_active") === "true";

  if (!id) throw new Error("Barème introuvable.");

  const { error } = await admin
    .schema("finance")
    .from("fee_schedules")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/fees/schedules");
  revalidatePath("/admin/finance");
}

function StatusPill({
  active,
  activeLabel = "Actif",
  inactiveLabel = "Inactif",
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
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

export default async function FinanceFeeSchedulesPage() {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();

  const [
    { data: categories, error: catErr },
    { data: classes, error: clsErr },
    { data: schedules, error: schErr },
  ] = await Promise.all([
    supabase
      .schema("finance")
      .from("fee_categories")
      .select("id,code,name,is_active")
      .eq("school_id", institutionId)
      .eq("is_active", true)
      .order("name", { ascending: true }),

    supabase
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId)
      .order("level", { ascending: true })
      .order("label", { ascending: true }),

    supabase
      .schema("finance")
      .from("fee_schedules")
      .select(
        "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,allow_partial,is_active,notes,created_at,updated_at"
      )
      .eq("school_id", institutionId)
      .order("created_at", { ascending: false }),
  ]);

  if (catErr) throw new Error(catErr.message);
  if (clsErr) throw new Error(clsErr.message);
  if (schErr) throw new Error(schErr.message);

  const categoryRows = (categories ?? []) as FeeCategoryRow[];
  const classRows = (classes ?? []) as ClassRow[];
  const scheduleRows = (schedules ?? []) as FeeScheduleRow[];

  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c]));

  const activeCount = scheduleRows.filter((r) => r.is_active).length;

  const levels = Array.from(
    new Map(
      classRows
        .filter((row) => normalizeText(row.level))
        .map((row) => [normalizeText(row.level), normalizeText(row.level)])
    ).values()
  ).sort((a, b) =>
    a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" })
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <CalendarClock className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Barèmes & échéanciers
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Définis le montant réel d’un frais pour une classe donnée ou pour
              tout un niveau, avec son année scolaire, sa date limite et
              l’option de paiement partiel.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                Barèmes
              </div>
              <div className="mt-2 text-3xl font-black text-white">
                {scheduleRows.length}
              </div>
              <div className="mt-1 text-sm text-slate-200">
                Total enregistré
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                Actifs
              </div>
              <div className="mt-2 text-3xl font-black text-white">
                {activeCount}
              </div>
              <div className="mt-1 text-sm text-slate-200">
                {categoryRows.length} catégories disponibles
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[430px_1fr]">
        <form
          action={createFeeScheduleAction}
          className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <FolderPlus className="h-4 w-4 text-emerald-600" />
            Nouveau barème
          </div>

          <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-700">
            Tu peux créer un barème pour une seule classe ou pour tout un
            niveau. En mode <span className="font-bold">tout le niveau</span>,
            le système crée automatiquement un barème par classe du niveau
            choisi afin de rester compatible avec les autres modules.
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Portée
              </label>
              <select
                name="target_scope"
                defaultValue="class"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="class">Classe précise</option>
                <option value="level">Tout le niveau</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Niveau concerné
              </label>
              <select
                name="level"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="">— Choisir un niveau —</option>
                {levels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Utilisé uniquement si la portée choisie est “Tout le niveau”.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Classe
              </label>
              <select
                name="class_id"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="">— Choisir une classe —</option>
                {classRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.level ? ` — ${c.level}` : ""}
                    {c.academic_year ? ` — ${c.academic_year}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Obligatoire seulement si la portée choisie est “Classe précise”.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Catégorie de frais
              </label>
              <select
                name="fee_category_id"
                required
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="">— Choisir une catégorie —</option>
                {categoryRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Année scolaire
              </label>
              <input
                type="text"
                name="academic_year"
                required
                placeholder="Ex. 2025-2026"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Libellé
              </label>
              <input
                type="text"
                name="label"
                placeholder="Ex. Scolarité - 6e"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
              <p className="mt-1 text-xs text-slate-500">
                Laisse vide pour génération automatique. En mode niveau, le nom
                de chaque classe sera ajouté automatiquement.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Montant
              </label>
              <input
                type="number"
                name="amount"
                min="1"
                step="0.01"
                required
                placeholder="Ex. 150000"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Date limite
              </label>
              <input
                type="date"
                name="due_date"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Notes
              </label>
              <textarea
                name="notes"
                rows={4}
                placeholder="Commentaire interne éventuel"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
              <input
                type="checkbox"
                name="allow_partial"
                defaultChecked
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="block text-sm font-bold text-slate-900">
                  Paiement partiel autorisé
                </span>
                <span className="block text-sm text-slate-600">
                  Active cette option si le parent peut payer ce frais en
                  plusieurs fois.
                </span>
              </span>
            </label>

            <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700">
              <FolderPlus className="h-4 w-4" />
              Ajouter le barème
            </button>
          </div>
        </form>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Layers3 className="h-4 w-4 text-emerald-600" />
            Barèmes enregistrés
          </div>

          {scheduleRows.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun barème n’a encore été créé.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {scheduleRows.map((row) => {
                const classRow = row.class_id ? classMap.get(row.class_id) : null;
                const categoryRow = categoryMap.get(row.fee_category_id);

                return (
                  <article
                    key={row.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-black text-slate-900">
                            {row.label}
                          </h2>
                          <StatusPill active={row.is_active} />
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
                            {Number(row.amount).toLocaleString("fr-FR")} FCFA
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                            {row.allow_partial
                              ? "Partiel autorisé"
                              : "Paiement unique"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                          <div>
                            <span className="font-semibold text-slate-800">
                              Classe :
                            </span>{" "}
                            {classRow?.label || "—"}
                            {classRow?.level ? ` (${classRow.level})` : ""}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-800">
                              Catégorie :
                            </span>{" "}
                            {categoryRow?.name || "—"}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-800">
                              Année :
                            </span>{" "}
                            {row.academic_year || "—"}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-800">
                              Échéance :
                            </span>{" "}
                            {row.due_date || "—"}
                          </div>
                        </div>

                        {row.notes ? (
                          <p className="mt-3 text-sm leading-6 text-slate-600">
                            {row.notes}
                          </p>
                        ) : null}

                        <div className="mt-3 text-xs text-slate-500">
                          Dernière mise à jour :{" "}
                          {new Date(row.updated_at).toLocaleString("fr-FR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </div>
                      </div>

                      <form action={toggleFeeScheduleAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <input
                          type="hidden"
                          name="next_active"
                          value={row.is_active ? "false" : "true"}
                        />
                        <button
                          className={[
                            "inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition",
                            row.is_active
                              ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                              : "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
                          ].join(" ")}
                        >
                          {row.is_active ? "Désactiver" : "Réactiver"}
                        </button>
                      </form>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}