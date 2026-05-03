// src/app/admin/notes/publication-settings/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
} from "lucide-react";

type SmsDigestMode = "manual" | "weekly" | "disabled";

type PublicationSettings = {
  institution_id: string;
  require_admin_validation: boolean;
  auto_push_on_publish: boolean;
  sms_digest_mode: SmsDigestMode;
  created_at?: string | null;
  updated_at?: string | null;
};

type SmsDigestDecision = {
  allowed?: boolean;
  reason?: string | null;
  message?: string | null;
  last_sent_at?: string | null;
  next_allowed_at?: string | null;
  monthly_count?: number | null;
  monthly_limit?: number | null;
  min_interval_days?: number | null;
  running_batch_id?: string | null;
};

type SmsDigestBatchSnapshot = {
  id?: string;
  trigger_type?: "manual" | "auto" | string | null;
  status?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  blocked_reason?: string | null;
  total_parents?: number | null;
  total_students?: number | null;
  total_grades?: number | null;
  total_sms?: number | null;
  next_allowed_at?: string | null;
};

type SmsDigestStatusPayload = {
  ok: boolean;
  error?: string | null;
  institution_id?: string | null;
  settings?: PublicationSettings | null;
  decision?: SmsDigestDecision | null;
  latest_batch?: SmsDigestBatchSnapshot | null;
  open_batch?: SmsDigestBatchSnapshot | null;
};

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber" | "red";
  }
) {
  const { tone = "emerald", className = "", ...rest } = props;

  const tones: Record<string, string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500/30",
    amber:
      "bg-amber-500 text-slate-950 hover:bg-amber-600 focus:ring-amber-400/30",
    red: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30",
  };

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      ].join(" ")}
    />
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
  icon,
  tone = "emerald",
  disabled = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon: React.ReactNode;
  tone?: "emerald" | "amber" | "slate";
  disabled?: boolean;
}) {
  const toneClasses = {
    emerald: checked
      ? "border-emerald-300 bg-emerald-50"
      : "border-slate-200 bg-white",
    amber: checked ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white",
    slate: checked ? "border-slate-300 bg-slate-50" : "border-slate-200 bg-white",
  };

  const iconClasses = {
    emerald: checked
      ? "bg-emerald-100 text-emerald-700"
      : "bg-slate-100 text-slate-500",
    amber: checked ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500",
    slate: checked ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-500",
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "w-full rounded-2xl border p-4 text-left shadow-sm transition",
        "focus:outline-none focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        toneClasses[tone],
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            iconClasses[tone],
          ].join(" ")}
        >
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">
            {title}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-slate-600">
            {description}
          </span>
        </span>

        <span
          className={[
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
            checked ? "bg-emerald-600" : "bg-slate-300",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-5 w-5 rounded-full bg-white shadow transition",
              checked ? "translate-x-5" : "translate-x-1",
            ].join(" ")}
          />
        </span>
      </div>
    </button>
  );
}

function formatDateTimeFr(value?: string | null) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function normalizePublicationSettings(item: PublicationSettings): PublicationSettings {
  return {
    ...item,
    sms_digest_mode: "manual",
  };
}

function smsDigestModeLabel() {
  return "Manuel contrôlé";
}

function smsDecisionReasonLabel(reason?: string | null) {
  if (reason === "ok") return "Envoi autorisé";
  if (reason === "sms_disabled") return "SMS désactivé";
  if (reason === "too_early") return "Délai de 7 jours non atteint";
  if (reason === "monthly_limit_reached") return "Limite mensuelle atteinte";
  if (reason === "batch_already_running") return "Lot SMS déjà en cours";
  if (reason === "missing_institution_id") return "Institution introuvable";
  if (reason === "no_pending_grades") return "Aucune note en attente";
  return "Statut à vérifier";
}

function batchStatusLabel(status?: string | null) {
  if (status === "pending") return "En préparation";
  if (status === "sending") return "Envoi en cours";
  if (status === "sent") return "Envoyé";
  if (status === "failed") return "Échec";
  if (status === "blocked") return "Bloqué";
  return "—";
}

function SmsDigestStatusCard({
  status,
  loading,
  error,
  onRefresh,
}: {
  status: SmsDigestStatusPayload | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const decision = status?.decision || null;
  const latestBatch = status?.latest_batch || null;
  const openBatch = status?.open_batch || null;

  const allowed = decision?.allowed === true;
  const reason = decision?.reason || null;

  const monthlyCount = Number(decision?.monthly_count ?? 0);
  const monthlyLimit = Number(decision?.monthly_limit ?? 4);
  const minIntervalDays = Number(decision?.min_interval_days ?? 7);

  const mainTone = allowed
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : reason === "sms_disabled"
      ? "border-slate-200 bg-slate-50 text-slate-800"
      : reason === "too_early" || reason === "monthly_limit_reached"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-red-200 bg-red-50 text-red-900";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={[
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              allowed
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-800",
            ].join(" ")}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : allowed ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Clock3 className="h-5 w-5" />
            )}
          </span>

          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Statut serveur du digest SMS
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Décision serveur en temps réel pour l’envoi manuel des SMS de notes.
            </p>
          </div>
        </div>

        <Button
          type="button"
          tone="slate"
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Actualiser statut
        </Button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : (
        <>
          <div className={["mt-4 rounded-2xl border px-4 py-3", mainTone].join(" ")}>
            <div className="text-sm font-semibold">
              {loading
                ? "Vérification du statut SMS..."
                : smsDecisionReasonLabel(reason)}
            </div>

            {!loading && decision?.message && (
              <p className="mt-1 text-sm leading-relaxed opacity-90">
                {decision.message}
              </p>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Dernier envoi réussi</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {formatDateTimeFr(decision?.last_sent_at || latestBatch?.sent_at)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Prochain envoi possible</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {formatDateTimeFr(decision?.next_allowed_at)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Envois ce mois-ci</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {monthlyCount} / {monthlyLimit}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Délai minimum</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {minIntervalDays} jours
              </div>
            </div>
          </div>

          {openBatch && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              Un lot SMS est déjà ouvert :{" "}
              <span className="font-semibold">
                {batchStatusLabel(openBatch.status)}
              </span>{" "}
              depuis {formatDateTimeFr(openBatch.created_at)}.
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function AdminGradePublicationSettingsPage() {
  const [settings, setSettings] = useState<PublicationSettings | null>(null);
  const [draft, setDraft] = useState<PublicationSettings | null>(null);

  const [smsStatus, setSmsStatus] = useState<SmsDigestStatusPayload | null>(null);
  const [smsStatusLoading, setSmsStatusLoading] = useState(false);
  const [smsStatusErr, setSmsStatusErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const changed =
    !!settings &&
    !!draft &&
    (settings.require_admin_validation !== draft.require_admin_validation ||
      settings.auto_push_on_publish !== draft.auto_push_on_publish ||
      settings.sms_digest_mode !== draft.sms_digest_mode);

  async function loadSmsDigestStatus() {
    setSmsStatusLoading(true);
    setSmsStatusErr(null);

    try {
      const res = await fetch("/api/admin/grades/sms-digest/status", {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => ({}))) as SmsDigestStatusPayload;

      if (!res.ok || !json?.ok) {
        throw new Error(
          json?.error || "Impossible de charger le statut SMS digest."
        );
      }

      setSmsStatus(json);
    } catch (e: any) {
      setSmsStatus(null);
      setSmsStatusErr(e?.message || "Erreur de chargement du statut SMS digest.");
    } finally {
      setSmsStatusLoading(false);
    }
  }

  async function loadSettings() {
    setLoading(true);
    setMsg(null);
    setErr(null);

    try {
      const res = await fetch("/api/admin/grades/publication-settings", {
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible de charger les paramètres.");
      }

      const rawItem = json.item as PublicationSettings;
      const normalizedItem = normalizePublicationSettings(rawItem);

      setSettings(rawItem);
      setDraft(normalizedItem);

      void loadSmsDigestStatus();
    } catch (e: any) {
      setErr(e?.message || "Erreur de chargement des paramètres.");
      setSettings(null);
      setDraft(null);
      setSmsStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!draft) return;

    setSaving(true);
    setMsg(null);
    setErr(null);

    try {
      const res = await fetch("/api/admin/grades/publication-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          require_admin_validation: draft.require_admin_validation,
          auto_push_on_publish: draft.auto_push_on_publish,
          sms_digest_mode: "manual",
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible d’enregistrer les paramètres.");
      }

      const item = normalizePublicationSettings(json.item as PublicationSettings);

      setSettings(item);
      setDraft(item);
      setMsg("Paramètres de publication enregistrés ✅");

      void loadSmsDigestStatus();
    } catch (e: any) {
      setErr(e?.message || "Erreur pendant l’enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  function patchDraft(patch: Partial<PublicationSettings>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch, sms_digest_mode: "manual" };
    });
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-950 px-5 py-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-200/80">
              Administration des notes
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Paramètres de publication
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-indigo-100/85">
              Réglez la publication des notes et les notifications envoyées aux parents.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              tone="amber"
              onClick={() => void loadSettings()}
              disabled={loading || saving}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Actualiser
            </Button>

            <Button
              type="button"
              tone="emerald"
              onClick={() => void saveSettings()}
              disabled={loading || saving || !draft || !changed}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Enregistrer
            </Button>
          </div>
        </div>
      </header>

      {msg && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {msg}
        </div>
      )}

      {err && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {err}
        </div>
      )}

      {loading ? (
        <section className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Chargement des paramètres...
        </section>
      ) : !draft ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          Impossible de charger les paramètres de publication.
        </section>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <ToggleCard
              checked={draft.require_admin_validation}
              onChange={(next) =>
                patchDraft({ require_admin_validation: next })
              }
              tone="amber"
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Validation administrative obligatoire"
              description="L’enseignant soumet les notes. L’administration valide avant publication officielle."
            />

            <ToggleCard
              checked={!draft.require_admin_validation}
              onChange={(next) =>
                patchDraft({ require_admin_validation: !next })
              }
              tone="emerald"
              icon={<Send className="h-5 w-5" />}
              title="Publication directe par les enseignants"
              description="L’enseignant publie directement les notes officielles, sans validation préalable."
            />

            <ToggleCard
              checked={draft.auto_push_on_publish}
              onChange={(next) => patchDraft({ auto_push_on_publish: next })}
              tone="emerald"
              icon={<BellRing className="h-5 w-5" />}
              title="Push automatique après publication officielle"
              description="Après publication, Mon Cahier prépare automatiquement les notifications push."
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Settings2 className="h-5 w-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-900">
                    SMS digest manuel contrôlé
                  </h2>

                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Envoi manuel depuis le tableau de bord des notes. Le serveur
                    applique automatiquement les limites.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      7 jours minimum
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      4 envois / mois
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      Notes officielles
                    </span>
                  </div>

                  {settings?.sms_digest_mode !== "manual" && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      Ancienne valeur SMS détectée. Cliquez sur{" "}
                      <span className="font-semibold">Enregistrer</span> pour
                      revenir au mode manuel contrôlé.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <SmsDigestStatusCard
            status={smsStatus}
            loading={smsStatusLoading}
            error={smsStatusErr}
            onRefresh={() => void loadSmsDigestStatus()}
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span
                className={[
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  draft.require_admin_validation
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-700",
                ].join(" ")}
              >
                {draft.require_admin_validation ? (
                  <Clock3 className="h-5 w-5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-slate-900">
                  Résumé de la règle active
                </h2>

                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {draft.require_admin_validation
                    ? "Les enseignants soumettent les notes à l’administration avant publication officielle."
                    : "Les enseignants publient directement les notes officielles."}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Validation admin</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {draft.require_admin_validation ? "Activée" : "Désactivée"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Push auto</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {draft.auto_push_on_publish ? "Activé" : "Désactivé"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">SMS digest</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {smsDigestModeLabel()}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  SMS notes : manuel contrôlé · 7 jours min · 4 envois max/mois ·
                  notes officielles uniquement.
                </div>

                {changed && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <AlertTriangle className="mr-2 inline h-4 w-4" />
                    Des modifications ne sont pas encore enregistrées.
                  </div>
                )}

                <div className="mt-4 text-xs text-slate-500">
                  Dernière mise à jour : {formatDateTimeFr(settings?.updated_at)}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}