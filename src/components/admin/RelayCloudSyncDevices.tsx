"use client";

import { useEffect, useMemo, useState } from "react";

type InstitutionSummary = {
  id: string;
  name: string;
  code: string;
};

type RelayDevice = {
  id: string;
  institution_id: string;
  label: string;
  is_active: boolean;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type CreatedRelayDevice = {
  id: string;
  institution_id: string;
  institution_code: string;
  institution_name: string;
  label: string;
  push_url: string;
  token: string;
  token_displayed_once: true;
};

function displayDate(value: string | null) {
  if (!value) return "Jamais";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function errorLabel(value: unknown, fallback: string) {
  const code = String(value || "").trim();
  const labels: Record<string, string> = {
    unauthorized: "Votre session a expiré.",
    forbidden: "Vous n'avez pas l'autorisation de gérer les relais.",
    institution_lookup_failed: "L'établissement n'a pas pu être chargé.",
    institution_code_missing: "Le code unique de l'établissement doit être renseigné avant de créer le relais.",
    label_too_long: "Le nom du relais est trop long.",
    device_not_found: "Ce relais n'existe plus.",
  };
  return labels[code] || code || fallback;
}

export default function RelayCloudSyncDevices() {
  const [institution, setInstitution] = useState<InstitutionSummary | null>(null);
  const [devices, setDevices] = useState<RelayDevice[]>([]);
  const [label, setLabel] = useState("PC relais principal");
  const [created, setCreated] = useState<CreatedRelayDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/offline/relay-devices", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorLabel(payload?.error, "Chargement impossible."));
      setInstitution(payload?.institution || null);
      setDevices(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error: any) {
      setMessage(error?.message || "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const configureCommand = useMemo(() => {
    if (!created) return "";
    return [
      "cd C:\\Projects\\CAHIER-D-ABSENCES\\desktop\\relay",
      "node dist\\src\\cli.mjs sync-configure `",
      '  --institution-code "' + created.institution_code + '" `',
      '  --endpoint "' + created.push_url + '" `',
      '  --device-id "' + created.id + '" `',
      `  --token "${created.token}"`,
      "node dist\\src\\cli.mjs sync-once",
    ].join("\n");
  }, [created]);

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
    } catch {
      setMessage("Copie automatique impossible. Sélectionnez le texte et copiez-le manuellement.");
    }
  }

  async function createDevice() {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setMessage("Donnez un nom au PC relais.");
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/offline/relay-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: cleanLabel }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorLabel(payload?.error, "Création impossible."));
      setCreated(payload.item as CreatedRelayDevice);
      setMessage("Identité Cloud créée. Copiez immédiatement la commande sur le PC relais.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "Création impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function revokeDevice(device: RelayDevice) {
    if (!window.confirm(`Révoquer « ${device.label} » ? Ce PC ne pourra plus envoyer de données au Cloud.`)) {
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/offline/relay-devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: device.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorLabel(payload?.error, "Révocation impossible."));
      if (created?.id === device.id) setCreated(null);
      await load();
      setMessage("Relais révoqué. Son ancien jeton n'est plus accepté.");
    } catch (error: any) {
      setMessage(error?.message || "Révocation impossible.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 md:p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-indigo-800">
            Envoi automatique du relais vers le Cloud
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Chaque PC relais possède une identité révocable. Le secret est affiché une seule fois et
            doit être configuré directement sur le PC concerné.
          </p>
          {institution ? (
            <p className="mt-1 text-xs font-semibold text-indigo-900">
              {institution.name} · {institution.code || institution.id}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || working}
          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-800 disabled:opacity-50"
        >
          Actualiser
        </button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={120}
          placeholder="Ex. PC relais secrétariat"
          className="rounded-lg border bg-white px-3 py-2 text-sm"
          disabled={loading || working}
          aria-label="Nom du PC relais Cloud"
        />
        <button
          type="button"
          onClick={createDevice}
          disabled={loading || working}
          className="rounded-lg bg-indigo-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {working ? "Traitement…" : "Créer l'identité Cloud"}
        </button>
      </div>

      {created ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-black uppercase tracking-wide text-amber-900">
            Secret affiché une seule fois
          </div>
          <p className="mt-1 text-xs text-amber-900">
            Copiez maintenant cette commande PowerShell. Après fermeture ou actualisation de la page,
            le jeton ne pourra pas être récupéré ; il faudra révoquer ce relais et en créer un nouveau.
          </p>
          <textarea
            readOnly
            value={configureCommand}
            rows={9}
            className="mt-2 w-full rounded-lg border border-amber-300 bg-white p-2 font-mono text-[11px] leading-5 text-slate-800"
            aria-label="Commande de configuration Cloud du relais"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText(configureCommand, "Commande PowerShell copiée ✅")}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
            >
              Copier la commande
            </button>
            <button
              type="button"
              onClick={() => void copyText(created.token, "Jeton Cloud copié ✅")}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900"
            >
              Copier seulement le jeton
            </button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700"
            >
              J'ai sauvegardé le secret
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-xl border bg-white p-3 text-xs text-slate-500">Chargement des relais…</div>
        ) : devices.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white p-3 text-xs text-slate-500">
            Aucun PC relais Cloud n'a encore été créé pour cet établissement.
          </div>
        ) : devices.map((device) => {
          const active = device.is_active && !device.revoked_at;
          return (
            <div key={device.id} className="rounded-xl border bg-white p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">{device.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${active ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                      {active ? "ACTIF" : "RÉVOQUÉ"}
                    </span>
                  </div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-500">{device.id}</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Créé le {displayDate(device.created_at)} · Dernier contact : {displayDate(device.last_seen_at)}
                  </div>
                </div>
                {active ? (
                  <button
                    type="button"
                    onClick={() => void revokeDevice(device)}
                    disabled={working}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50"
                  >
                    Révoquer
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-slate-600" aria-live="polite">{message}</div>
    </div>
  );
}
