// src/app/super/abonnements/page.tsx
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  Crown,
  MessageSquareMore,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Institution = {
  id: string;
  name: string;
  code_unique: string;
  subscription_expires_at: string | null;
};

type ChannelSettings = {
  institution_id: string;
  push_enabled: boolean;
  sms_premium_enabled: boolean;
  sms_provider: "orange_ci" | "twilio" | "custom" | null;
  sms_sender_name: string | null;
  sms_absence_enabled: boolean;
  sms_late_enabled: boolean;
  sms_notes_digest_enabled: boolean;
  updated_at?: string | null;
};

type PageRow = Institution & {
  channels: ChannelSettings;
};

function diffDays(dateISO: string | null | undefined) {
  if (!dateISO) return null;
  const today = new Date();
  const d = new Date(`${dateISO}T00:00:00`);
  const ms =
    d.getTime() -
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function addMonthsISO(dateISO: string, months: number) {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateISO: string | null | undefined) {
  if (!dateISO) return "â€”";
  try {
    return new Date(`${dateISO}T00:00:00`).toLocaleDateString("fr-FR");
  } catch {
    return dateISO;
  }
}

function formatDateTime(dateISO: string | null | undefined) {
  if (!dateISO) return "â€”";
  try {
    return new Date(dateISO).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return dateISO;
  }
}

function normalizeProvider(x: unknown): ChannelSettings["sms_provider"] {
  const s = String(x || "").trim();
  if (s === "orange_ci" || s === "twilio" || s === "custom") return s;
  return null;
}

async function assertSuperAdmin() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (roleErr) {
    throw new Error(roleErr.message);
  }

  const isSuper = (roles ?? []).some((r) => r.role === "super_admin");
  if (!isSuper) redirect("/(errors)/forbidden");

  return { user };
}

async function renewAction(formData: FormData) {
  "use server";

  await assertSuperAdmin();

  const institutionId = String(formData.get("id") || "").trim();
  const months = Math.max(
    1,
    Math.trunc(Number(formData.get("months") || 12))
  );

  if (!institutionId) {
    throw new Error("Institution introuvable.");
  }

  const admin = getSupabaseServiceClient();

  const { data: inst, error: getErr } = await admin
    .from("institutions")
    .select("subscription_expires_at")
    .eq("id", institutionId)
    .maybeSingle();

  if (getErr) throw new Error(getErr.message);

  const today = new Date().toISOString().slice(0, 10);
  const base =
    inst?.subscription_expires_at && inst.subscription_expires_at > today
      ? inst.subscription_expires_at
      : today;

  const next = addMonthsISO(base, months);

  const { error: updErr } = await admin
    .from("institutions")
    .update({ subscription_expires_at: next })
    .eq("id", institutionId);

  if (updErr) throw new Error(updErr.message);

  revalidatePath("/super/abonnements");
}

async function saveChannelsAction(formData: FormData) {
  "use server";

  await assertSuperAdmin();

  const institutionId = String(formData.get("institution_id") || "").trim();
  if (!institutionId) throw new Error("Ã‰tablissement introuvable.");

  const smsPremiumEnabled = formData.get("sms_premium_enabled") === "on";
  const smsProvider = smsPremiumEnabled
    ? normalizeProvider(formData.get("sms_provider"))
    : null;

  const smsSenderName = smsPremiumEnabled
    ? String(formData.get("sms_sender_name") || "").trim() || null
    : null;

  const smsAbsenceEnabled =
    smsPremiumEnabled && formData.get("sms_absence_enabled") === "on";
  const smsLateEnabled =
    smsPremiumEnabled && formData.get("sms_late_enabled") === "on";
  const smsNotesDigestEnabled =
    smsPremiumEnabled && formData.get("sms_notes_digest_enabled") === "on";

  const admin = getSupabaseServiceClient();

  const payload = {
    institution_id: institutionId,
    push_enabled: true, // formule standard
    sms_premium_enabled: smsPremiumEnabled,
    sms_provider: smsProvider,
    sms_sender_name: smsSenderName,
    sms_absence_enabled: smsAbsenceEnabled,
    sms_late_enabled: smsLateEnabled,
    sms_notes_digest_enabled: smsNotesDigestEnabled,
  };

  const { error } = await admin
    .from("institution_notification_channel_settings")
    .upsert(payload, {
      onConflict: "institution_id",
      ignoreDuplicates: false,
    });

  if (error) throw new Error(error.message);

  revalidatePath("/super/abonnements");
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint: string;
  tone?: "slate" | "emerald" | "amber" | "violet";
}) {
  const tones: Record<
    NonNullable<typeof tone>,
    {
      wrap: string;
      iconWrap: string;
      value: string;
    }
  > = {
    slate: {
      wrap: "border-slate-200 bg-white",
      iconWrap: "bg-slate-100 text-slate-700",
      value: "text-slate-900",
    },
    emerald: {
      wrap: "border-emerald-200 bg-emerald-50/60",
      iconWrap: "bg-emerald-100 text-emerald-700",
      value: "text-emerald-800",
    },
    amber: {
      wrap: "border-amber-200 bg-amber-50/70",
      iconWrap: "bg-amber-100 text-amber-700",
      value: "text-amber-800",
    },
    violet: {
      wrap: "border-violet-200 bg-violet-50/70",
      iconWrap: "bg-violet-100 text-violet-700",
      value: "text-violet-800",
    },
  };

  const t = tones[tone];

  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${t.wrap}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className={`mt-2 text-3xl font-black ${t.value}`}>{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div
          className={`grid h-12 w-12 place-items-center rounded-2xl ${t.iconWrap}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  ok,
  yesLabel = "Oui",
  noLabel = "Non",
}: {
  ok: boolean;
  yesLabel?: string;
  noLabel?: string;
}) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {yesLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 ring-1 ring-rose-200">
      <XCircle className="h-3.5 w-3.5" />
      {noLabel}
    </span>
  );
}

export default async function AbonnementsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await assertSuperAdmin();

  const params = searchParams ? await searchParams : undefined;
  const q = String(params?.q || "")
    .trim()
    .toLowerCase();

  const admin = getSupabaseServiceClient();

  const { data: institutions, error: iErr } = await admin
    .from("institutions")
    .select("id,name,code_unique,subscription_expires_at")
    .order("subscription_expires_at", { ascending: true });

  if (iErr) throw new Error(iErr.message);

  const institutionRows = (institutions ?? []) as Institution[];
  const institutionIds = institutionRows.map((i) => i.id);

  const { data: settings, error: sErr } = institutionIds.length
    ? await admin
        .from("institution_notification_channel_settings")
        .select(
          "institution_id,push_enabled,sms_premium_enabled,sms_provider,sms_sender_name,sms_absence_enabled,sms_late_enabled,sms_notes_digest_enabled,updated_at"
        )
        .in("institution_id", institutionIds)
    : { data: [], error: null as any };

  if (sErr) throw new Error(sErr.message);

  const settingsMap = new Map<string, ChannelSettings>();
  for (const row of (settings ?? []) as ChannelSettings[]) {
    settingsMap.set(String(row.institution_id), row);
  }

  const rows: PageRow[] = institutionRows
    .map((inst) => ({
      ...inst,
      channels: settingsMap.get(inst.id) ?? {
        institution_id: inst.id,
        push_enabled: true,
        sms_premium_enabled: false,
        sms_provider: "orange_ci",
        sms_sender_name: null,
        sms_absence_enabled: false,
        sms_late_enabled: false,
        sms_notes_digest_enabled: false,
        updated_at: null,
      },
    }))
    .filter((row) => {
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.code_unique.toLowerCase().includes(q)
      );
    });

  const total = rows.length;
  const today = new Date().toISOString().slice(0, 10);

  const premiumCount = rows.filter(
    (r) => r.channels.sms_premium_enabled
  ).length;
  const expiringSoon = rows.filter((r) => {
    const d = diffDays(r.subscription_expires_at);
    return d !== null && d <= 30;
  }).length;
  const expiredCount = rows.filter((r) => {
    const d = diffDays(r.subscription_expires_at);
    return d !== null && d < 0;
  }).length;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 px-5 py-6 text-white shadow-xl sm:px-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-violet-100 ring-1 ring-white/15">
              <Crown className="h-3.5 w-3.5" />
              Super administration
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Abonnements & options premium
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Ici, le push reste la formule standard. Le SMS est une option
              premium accordÃ©e uniquement par le super admin au niveau de
              lâ€™abonnement de lâ€™Ã©tablissement.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                Push = standard
              </span>
              <span className="rounded-full bg-amber-500/15 px-3 py-1 ring-1 ring-amber-400/25">
                SMS = premium
              </span>
              <span className="rounded-full bg-violet-500/15 px-3 py-1 ring-1 ring-violet-400/25">
                ContrÃ´le centralisÃ©
              </span>
            </div>
          </div>

          <form
            action="/super/abonnements"
            className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/10 p-3 backdrop-blur"
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Rechercher un Ã©tablissement ou un code"
                  className="w-full rounded-2xl border border-white/10 bg-white/90 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-500"
                />
              </div>
              <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-400">
                <Search className="h-4 w-4" />
                Rechercher
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-6 w-6" />}
          label="Ã‰tablissements"
          value={total}
          hint="AffichÃ©s avec filtre actuel"
          tone="slate"
        />
        <StatCard
          icon={<MessageSquareMore className="h-6 w-6" />}
          label="SMS premium"
          value={premiumCount}
          hint="Ã‰tablissements autorisÃ©s"
          tone="violet"
        />
        <StatCard
          icon={<CalendarClock className="h-6 w-6" />}
          label="Expire â‰¤ 30 j"
          value={expiringSoon}
          hint="Ã€ surveiller rapidement"
          tone="amber"
        />
        <StatCard
          icon={<ShieldCheck className="h-6 w-6" />}
          label="DÃ©jÃ  expirÃ©s"
          value={expiredCount}
          hint="Abonnements Ã  rÃ©gulariser"
          tone="emerald"
        />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-violet-100 bg-gradient-to-r from-violet-50 via-white to-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-700">
            <Sparkles className="h-4 w-4 text-violet-600" />
            RÃ¨gle mÃ©tier active
          </div>
          <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="font-bold text-slate-900">1. Push standard</div>
              <div className="mt-1 text-slate-600">
                Les notifications push restent disponibles pour tous les
                Ã©tablissements.
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="font-bold text-slate-900">2. SMS premium</div>
              <div className="mt-1 text-slate-600">
                Le SMS ne part que si le super admin accorde la fonctionnalitÃ©
                Ã  lâ€™Ã©tablissement.
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="font-bold text-slate-900">3. Parent = opt-in</div>
              <div className="mt-1 text-slate-600">
                Le parent renseigne juste son numÃ©ro. Il nâ€™active jamais lui-mÃªme
                le premium.
              </div>
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
            Aucun Ã©tablissement trouvÃ© pour ce filtre.
          </div>
        ) : (
          <div className="space-y-5">
            {rows.map((row) => {
              const daysLeft = diffDays(row.subscription_expires_at);
              const isExpired = daysLeft !== null && daysLeft < 0;
              const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;

              return (
                <article
                  key={row.id}
                  className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm"
                >
                  <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-5 py-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-black tracking-tight text-slate-900">
                            {row.name}
                          </h2>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                            {row.code_unique}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <StatusPill
                            ok={true}
                            yesLabel="Push standard actif"
                            noLabel="Push inactif"
                          />
                          <StatusPill
                            ok={row.channels.sms_premium_enabled}
                            yesLabel="SMS premium accordÃ©"
                            noLabel="SMS premium non accordÃ©"
                          />
                          <StatusPill
                            ok={!!row.channels.sms_absence_enabled}
                            yesLabel="SMS absence ON"
                            noLabel="SMS absence OFF"
                          />
                          <StatusPill
                            ok={!!row.channels.sms_late_enabled}
                            yesLabel="SMS retard ON"
                            noLabel="SMS retard OFF"
                          />
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Expiration
                            </div>
                            <div className="mt-1 text-base font-extrabold text-slate-900">
                              {formatDate(row.subscription_expires_at)}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Jours restants
                            </div>
                            <div
                              className={[
                                "mt-1 text-base font-extrabold",
                                isExpired
                                  ? "text-rose-700"
                                  : isSoon
                                  ? "text-amber-700"
                                  : "text-emerald-700",
                              ].join(" ")}
                            >
                              {daysLeft === null
                                ? "â€”"
                                : isExpired
                                ? `${Math.abs(daysLeft)} j de retard`
                                : `${daysLeft} j`}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              DerniÃ¨re mise Ã  jour canaux
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-700">
                              {formatDateTime(row.channels.updated_at)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <form
                        action={renewAction}
                        className="w-full max-w-md rounded-3xl border border-violet-200 bg-violet-50/70 p-4"
                      >
                        <input type="hidden" name="id" value={row.id} />
                        <div className="flex items-center gap-2 text-sm font-black text-violet-900">
                          <RefreshCw className="h-4 w-4" />
                          Renouveler lâ€™abonnement
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                          <select
                            name="months"
                            defaultValue="12"
                            className="w-full rounded-2xl border border-violet-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                          >
                            <option value="1">+1 mois</option>
                            <option value="3">+3 mois</option>
                            <option value="6">+6 mois</option>
                            <option value="12">+12 mois</option>
                            <option value="24">+24 mois</option>
                          </select>

                          <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-700">
                            <RefreshCw className="h-4 w-4" />
                            Renouveler
                          </button>
                        </div>

                        <div className="mt-3 text-xs text-violet-900/80">
                          Base de calcul : aujourdâ€™hui si lâ€™abonnement est expirÃ©,
                          sinon la date actuelle dâ€™expiration.
                        </div>
                      </form>
                    </div>
                  </div>

                  <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1.2fr_1fr]">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                        <BellRing className="h-4 w-4 text-emerald-600" />
                        RÃ©sumÃ© des canaux
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Push
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <StatusPill
                              ok={true}
                              yesLabel="Inclus dans lâ€™offre"
                              noLabel="Non"
                            />
                          </div>
                          <p className="mt-3 text-sm text-slate-600">
                            Les push restent la formule standard pour cet
                            Ã©tablissement.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            SMS premium
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <StatusPill
                              ok={row.channels.sms_premium_enabled}
                              yesLabel="AutorisÃ©"
                              noLabel="Non autorisÃ©"
                            />
                          </div>
                          <p className="mt-3 text-sm text-slate-600">
                            Le parent peut enregistrer son numÃ©ro, mais aucun SMS
                            ne partira tant que cette option nâ€™est pas accordÃ©e.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Fournisseur SMS
                          </div>
                          <div className="mt-2 text-sm font-bold text-slate-900">
                            {row.channels.sms_provider || "â€”"}
                          </div>
                          <p className="mt-3 text-sm text-slate-600">
                            Tu peux le fixer maintenant mÃªme si lâ€™option premium
                            est encore inactive.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Nom expÃ©diteur
                          </div>
                          <div className="mt-2 text-sm font-bold text-slate-900">
                            {row.channels.sms_sender_name || "â€”"}
                          </div>
                          <p className="mt-3 text-sm text-slate-600">
                            RÃ©glage prÃªt pour lâ€™intÃ©gration du provider SMS.
                          </p>
                        </div>
                      </div>
                    </div>

                    <form
                      action={saveChannelsAction}
                      className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white p-4 shadow-sm"
                    >
                      <input
                        type="hidden"
                        name="institution_id"
                        value={row.id}
                      />

                      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-violet-900">
                        <Crown className="h-4 w-4" />
                        Pilotage premium SMS
                      </div>

                      <div className="mt-4 space-y-4">
                        <label className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-white px-4 py-3">
                          <input
                            type="checkbox"
                            name="sms_premium_enabled"
                            defaultChecked={row.channels.sms_premium_enabled}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-900">
                              Accorder le SMS premium Ã  cet Ã©tablissement
                            </span>
                            <span className="mt-1 block text-sm text-slate-600">
                              Cette case autorise lâ€™Ã©tablissement Ã  utiliser le
                              SMS comme fonctionnalitÃ© premium.
                            </span>
                          </span>
                        </label>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Fournisseur SMS
                            </label>
                            <select
                              name="sms_provider"
                              defaultValue={row.channels.sms_provider || "orange_ci"}
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                            >
                              <option value="orange_ci">Orange CI</option>
                              <option value="twilio">Twilio</option>
                              <option value="custom">Custom</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                              Nom expÃ©diteur
                            </label>
                            <input
                              type="text"
                              name="sms_sender_name"
                              defaultValue={row.channels.sms_sender_name || ""}
                              placeholder="Ex. MONCAHIER"
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                            />
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Ã‰vÃ©nements SMS autorisÃ©s
                          </div>

                          <div className="space-y-3">
                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                name="sms_absence_enabled"
                                defaultChecked={row.channels.sms_absence_enabled}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                              />
                              <span>
                                <span className="block text-sm font-bold text-slate-900">
                                  SMS pour les absences
                                </span>
                                <span className="block text-sm text-slate-600">
                                  Envoi SMS individuel quand une absence est
                                  enregistrÃ©e.
                                </span>
                              </span>
                            </label>

                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                name="sms_late_enabled"
                                defaultChecked={row.channels.sms_late_enabled}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                              />
                              <span>
                                <span className="block text-sm font-bold text-slate-900">
                                  SMS pour les retards
                                </span>
                                <span className="block text-sm text-slate-600">
                                  Envoi SMS individuel quand un retard est
                                  enregistrÃ©.
                                </span>
                              </span>
                            </label>

                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                name="sms_notes_digest_enabled"
                                defaultChecked={
                                  row.channels.sms_notes_digest_enabled
                                }
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                              />
                              <span>
                                <span className="block text-sm font-bold text-slate-900">
                                  Digest SMS des notes
                                </span>
                                <span className="block text-sm text-slate-600">
                                  RÃ©servÃ© pour lâ€™envoi groupÃ© hebdomadaire des
                                  notes.
                                </span>
                              </span>
                            </label>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          <span className="font-bold">Important :</span> le parent
                          peut enregistrer son numÃ©ro depuis son espace, mais le
                          SMS ne sera envoyÃ© que si cette configuration premium est
                          activÃ©e ici.
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-slate-500">
                            Push standard conservÃ© automatiquement pour cet
                            Ã©tablissement.
                          </div>

                          <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-700">
                            <ShieldCheck className="h-4 w-4" />
                            Enregistrer la configuration
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <MessageSquareMore className="h-4 w-4 text-violet-600" />
          Ce que cette page couvre dÃ©jÃ 
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-sm font-bold text-slate-900">
              Abonnement Ã©tablissement
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Date dâ€™expiration et renouvellement rapide depuis le mÃªme Ã©cran.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-sm font-bold text-slate-900">
              Accord premium centralisÃ©
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Le super admin choisit quels Ã©tablissements ont droit au SMS.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-sm font-bold text-slate-900">
              PrÃ©paration du digest notes
            </div>
            <p className="mt-2 text-sm text-slate-600">
              La bascule existe dÃ©jÃ  pour ton futur envoi groupÃ© hebdomadaire.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}