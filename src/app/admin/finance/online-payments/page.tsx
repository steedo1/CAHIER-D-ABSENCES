// src/app/admin/finance/online-payments/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Wallet,
  XCircle,
} from "lucide-react";

type ProviderCode = "orange_money" | "wave" | "mtn_momo";
type EnvironmentCode = "test" | "production";

type Account = {
  id: string | null;
  school_id: string;
  provider: ProviderCode;
  label: string;
  display_name: string;
  merchant_id: string;
  merchant_phone: string;
  environment: EnvironmentCode;
  is_active: boolean;
  has_secret_config: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type AccountEnvelope = {
  provider: ProviderCode;
  label: string;
  short_label: string;
  help: string;
  configured: boolean;
  account: Account;
};

type ApiPayload = {
  ok: boolean;
  institution?: {
    id: string;
    name: string;
  };
  model?: string;
  message?: string;
  accounts?: AccountEnvelope[];
  error?: string;
};

type EditableAccount = Account & {
  api_key?: string;
  api_user?: string;
  api_password?: string;
  client_id?: string;
  client_secret?: string;
  merchant_key?: string;
  webhook_secret?: string;
};

const PROVIDER_TONES: Record<
  ProviderCode,
  {
    border: string;
    bg: string;
    icon: string;
    badge: string;
  }
> = {
  orange_money: {
    border: "border-orange-200",
    bg: "bg-orange-50/70",
    icon: "bg-orange-100 text-orange-700",
    badge: "bg-orange-100 text-orange-800 ring-orange-200",
  },
  wave: {
    border: "border-sky-200",
    bg: "bg-sky-50/70",
    icon: "bg-sky-100 text-sky-700",
    badge: "bg-sky-100 text-sky-800 ring-sky-200",
  },
  mtn_momo: {
    border: "border-amber-200",
    bg: "bg-amber-50/70",
    icon: "bg-amber-100 text-amber-700",
    badge: "bg-amber-100 text-amber-800 ring-amber-200",
  },
};

function cleanPhone(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function providerIcon(provider: ProviderCode) {
  if (provider === "wave") return <Wallet className="h-5 w-5" />;
  if (provider === "mtn_momo") return <Smartphone className="h-5 w-5" />;
  return <CreditCard className="h-5 w-5" />;
}

function formatDate(value: string | null) {
  if (!value) return "Jamais enregistré";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function cloneAccount(account: Account): EditableAccount {
  return {
    ...account,
    merchant_phone: account.merchant_phone || "",
    merchant_id: account.merchant_id || "",
    display_name: account.display_name || account.label,
    api_key: "",
    api_user: "",
    api_password: "",
    client_id: "",
    client_secret: "",
    merchant_key: "",
    webhook_secret: "",
  };
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-800">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
      />
      {hint ? <span className="mt-1 block text-xs font-semibold text-slate-500">{hint}</span> : null}
    </label>
  );
}

function SecretInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-800">{label}</span>
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || "Laisser vide pour conserver la valeur actuelle"}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
      />
    </label>
  );
}

export default function AdminOnlinePaymentsPage() {
  const [institutionName, setInstitutionName] = useState("Établissement");
  const [accounts, setAccounts] = useState<AccountEnvelope[]>([]);
  const [forms, setForms] = useState<Record<ProviderCode, EditableAccount | undefined>>({
    orange_money: undefined,
    wave: undefined,
    mtn_momo: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<ProviderCode | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const activeCount = useMemo(
    () => accounts.filter((item) => item.account?.is_active).length,
    [accounts],
  );

  const configuredCount = useMemo(
    () =>
      accounts.filter((item) => {
        const account = item.account;
        return Boolean(account?.merchant_id || account?.merchant_phone || account?.has_secret_config);
      }).length,
    [accounts],
  );

  function updateForm(provider: ProviderCode, patch: Partial<EditableAccount>) {
    setForms((current) => {
      const previous = current[provider];
      if (!previous) return current;
      return {
        ...current,
        [provider]: {
          ...previous,
          ...patch,
        },
      };
    });
  }

  async function loadAccounts() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/finance/online-payment-accounts", {
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as ApiPayload;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible de charger les comptes Mobile Money.");
      }

      const rows = Array.isArray(json.accounts) ? json.accounts : [];
      setInstitutionName(json.institution?.name || "Établissement");
      setAccounts(rows);
      setForms(
        rows.reduce(
          (acc, item) => {
            acc[item.provider] = cloneAccount(item.account);
            return acc;
          },
          {} as Record<ProviderCode, EditableAccount>,
        ),
      );
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  async function saveAccount(provider: ProviderCode) {
    const form = forms[provider];
    if (!form) return;

    setSavingProvider(provider);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/finance/online-payment-accounts", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          display_name: form.display_name,
          merchant_id: form.merchant_id,
          merchant_phone: cleanPhone(form.merchant_phone),
          environment: form.environment,
          is_active: form.is_active,
          api_key: form.api_key,
          api_user: form.api_user,
          api_password: form.api_password,
          client_id: form.client_id,
          client_secret: form.client_secret,
          merchant_key: form.merchant_key,
          webhook_secret: form.webhook_secret,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Enregistrement impossible.");
      }

      setMessage(json?.message || "Configuration enregistrée.");
      await loadAccounts();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSavingProvider(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/admin/finance"
            className="inline-flex w-fit items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour finance
          </Link>

          <button
            type="button"
            onClick={loadAccounts}
            disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualiser
          </button>
        </div>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-[#003766] px-5 py-6 text-white sm:px-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Paiement en ligne direct école
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                  Comptes Mobile Money de l’établissement
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
                  Chaque école encaisse directement sur son propre compte marchand. Mon Cahier déclenche le paiement, vérifie la confirmation, crée le reçu et garde l’historique.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100">
                    Établissement
                  </div>
                  <div className="mt-2 line-clamp-2 text-lg font-black text-white">
                    {institutionName}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100">
                    Moyens actifs
                  </div>
                  <div className="mt-2 text-3xl font-black text-white">
                    {activeCount}/{accounts.length || 3}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:grid-cols-3 sm:px-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                <Building2 className="h-4 w-4 text-slate-500" />
                Modèle validé
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                Nexa Digital ne reçoit pas les frais scolaires.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                <BadgeCheck className="h-4 w-4 text-emerald-600" />
                Reçu officiel
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                Le reçu est créé après confirmation réelle du fournisseur.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                <Wallet className="h-4 w-4 text-sky-600" />
                Configuration
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                {configuredCount} moyen(s) renseigné(s) pour cet établissement.
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            {message}
          </div>
        ) : null}

        <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-black">Important avant activation réelle</div>
              <p className="mt-1 text-sm font-semibold leading-6">
                Activez seulement un compte dont l’établissement est bien titulaire. Les clés API ne sont jamais renvoyées au navigateur après enregistrement.
              </p>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-500" />
            <div className="mt-3 text-sm font-bold text-slate-600">
              Chargement des comptes de paiement…
            </div>
          </div>
        ) : (
          <section className="grid gap-5 xl:grid-cols-3">
            {accounts.map((item) => {
              const form = forms[item.provider];
              const tone = PROVIDER_TONES[item.provider];
              const saving = savingProvider === item.provider;
              const active = Boolean(form?.is_active);

              if (!form) return null;

              return (
                <article
                  key={item.provider}
                  className={`overflow-hidden rounded-[28px] border bg-white shadow-sm ${tone.border}`}
                >
                  <div className={`border-b px-5 py-5 ${tone.border} ${tone.bg}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`grid h-11 w-11 place-items-center rounded-2xl ${tone.icon}`}>
                            {providerIcon(item.provider)}
                          </span>
                          <div>
                            <h2 className="text-xl font-black text-slate-950">{item.label}</h2>
                            <p className="text-sm font-semibold text-slate-600">{item.help}</p>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-black ring-1 ${
                          active
                            ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                            : "bg-slate-100 text-slate-600 ring-slate-200"
                        }`}
                      >
                        {active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                        {active ? "Actif" : "Inactif"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">Activer pour les parents</div>
                        <div className="text-xs font-semibold text-slate-500">
                          Visible dans l’espace parent si au moins un frais est dû.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(event) => updateForm(item.provider, { is_active: event.target.checked })}
                        className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>

                    <label className="block">
                      <span className="text-sm font-black text-slate-800">Environnement</span>
                      <select
                        value={form.environment}
                        onChange={(event) =>
                          updateForm(item.provider, {
                            environment: event.target.value === "production" ? "production" : "test",
                          })
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                      >
                        <option value="test">Test / Sandbox</option>
                        <option value="production">Production réelle</option>
                      </select>
                    </label>

                    <TextInput
                      label="Nom affiché aux parents"
                      value={form.display_name}
                      onChange={(value) => updateForm(item.provider, { display_name: value })}
                      placeholder={item.label}
                    />

                    <TextInput
                      label="Identifiant marchand"
                      value={form.merchant_id}
                      onChange={(value) => updateForm(item.provider, { merchant_id: value })}
                      placeholder="Ex : code marchand, business id, merchant id"
                    />

                    <TextInput
                      label="Numéro marchand"
                      value={form.merchant_phone}
                      onChange={(value) => updateForm(item.provider, { merchant_phone: value })}
                      placeholder="Ex : +2250700000000"
                      hint="Numéro du compte Mobile Money de l’établissement, si fourni par l’opérateur."
                    />

                    <details className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <summary className="cursor-pointer text-sm font-black text-slate-800">
                        Clés techniques API, si l’opérateur les fournit
                      </summary>
                      <div className="mt-4 space-y-3">
                        <SecretInput
                          label="API key"
                          value={form.api_key || ""}
                          onChange={(value) => updateForm(item.provider, { api_key: value })}
                        />
                        <SecretInput
                          label="API user / login"
                          value={form.api_user || ""}
                          onChange={(value) => updateForm(item.provider, { api_user: value })}
                        />
                        <SecretInput
                          label="Mot de passe API"
                          value={form.api_password || ""}
                          onChange={(value) => updateForm(item.provider, { api_password: value })}
                        />
                        <SecretInput
                          label="Client ID"
                          value={form.client_id || ""}
                          onChange={(value) => updateForm(item.provider, { client_id: value })}
                        />
                        <SecretInput
                          label="Client secret"
                          value={form.client_secret || ""}
                          onChange={(value) => updateForm(item.provider, { client_secret: value })}
                        />
                        <SecretInput
                          label="Merchant key"
                          value={form.merchant_key || ""}
                          onChange={(value) => updateForm(item.provider, { merchant_key: value })}
                        />
                        <SecretInput
                          label="Webhook secret"
                          value={form.webhook_secret || ""}
                          onChange={(value) => updateForm(item.provider, { webhook_secret: value })}
                        />
                      </div>
                    </details>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>Clés API enregistrées</span>
                        <span className="font-black text-slate-900">
                          {form.has_secret_config ? "Oui" : "Non"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span>Dernière mise à jour</span>
                        <span className="text-right font-black text-slate-900">
                          {formatDate(form.updated_at)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => saveAccount(item.provider)}
                      disabled={saving}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Enregistrer {item.short_label}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
