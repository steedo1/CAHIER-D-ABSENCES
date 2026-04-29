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

function smsDigestModeLabel(mode: SmsDigestMode) {
  if (mode === "weekly") return "Automatique hebdomadaire";
  if (mode === "disabled") return "Désactivé";
  return "Manuel";
}

export default function AdminGradePublicationSettingsPage() {
  const [settings, setSettings] = useState<PublicationSettings | null>(null);
  const [draft, setDraft] = useState<PublicationSettings | null>(null);

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

      const item = json.item as PublicationSettings;

      setSettings(item);
      setDraft(item);
    } catch (e: any) {
      setErr(e?.message || "Erreur de chargement des paramètres.");
      setSettings(null);
      setDraft(null);
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
          sms_digest_mode: draft.sms_digest_mode,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible d’enregistrer les paramètres.");
      }

      const item = json.item as PublicationSettings;

      setSettings(item);
      setDraft(item);
      setMsg("Paramètres de publication enregistrés ✅");
    } catch (e: any) {
      setErr(e?.message || "Erreur pendant l’enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  function patchDraft(patch: Partial<PublicationSettings>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
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
            <p className="mt-2 max-w-2xl text-sm text-indigo-100/85">
              Choisissez si les enseignants publient directement les notes ou si
              l’administration doit valider avant l’envoi aux parents.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              tone="amber"
              onClick={loadSettings}
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
              onClick={saveSettings}
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
              description="Quand ce mode est activé, l’enseignant soumet les notes. L’administration doit valider avant publication officielle et envoi aux parents."
            />

            <ToggleCard
              checked={!draft.require_admin_validation}
              onChange={(next) =>
                patchDraft({ require_admin_validation: !next })
              }
              tone="emerald"
              icon={<Send className="h-5 w-5" />}
              title="Publication directe par les enseignants"
              description="Quand ce mode est actif, l’enseignant peut publier directement les notes officielles sans validation préalable."
            />

            <ToggleCard
              checked={draft.auto_push_on_publish}
              onChange={(next) => patchDraft({ auto_push_on_publish: next })}
              tone="emerald"
              icon={<BellRing className="h-5 w-5" />}
              title="Push automatique après publication"
              description="Après validation ou publication directe, Mon Cahier prépare automatiquement les notifications push des notes officielles."
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Settings2 className="h-5 w-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Mode SMS digest des notes
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Le digest SMS regroupe les notes officielles publiées. Il ne
                    doit jamais envoyer des notes encore soumises ou en correction.
                  </p>

                  <select
                    value={draft.sms_digest_mode}
                    onChange={(e) =>
                      patchDraft({
                        sms_digest_mode: e.target.value as SmsDigestMode,
                      })
                    }
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20"
                  >
                    <option value="manual">Manuel</option>
                    <option value="weekly">Automatique hebdomadaire</option>
                    <option value="disabled">Désactivé</option>
                  </select>

                  <div className="mt-2 text-xs text-slate-500">
                    Mode actuel :{" "}
                    <span className="font-semibold text-slate-700">
                      {smsDigestModeLabel(draft.sms_digest_mode)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

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

                {draft.require_admin_validation ? (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Les enseignants ne publieront pas directement les notes. Ils
                    feront une demande de publication. L’administration verra la
                    demande, consultera la liste des élèves et des notes, puis
                    pourra valider ou demander une correction.
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Les enseignants peuvent publier directement. Les notes
                    deviennent officielles dès publication et peuvent déclencher
                    les notifications selon les réglages actifs.
                  </p>
                )}

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
                      {smsDigestModeLabel(draft.sms_digest_mode)}
                    </div>
                  </div>
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