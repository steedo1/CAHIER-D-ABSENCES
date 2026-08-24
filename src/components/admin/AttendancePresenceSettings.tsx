"use client";

import { useEffect, useState } from "react";
import {
  getRelayConfig,
  relayBootstrapErrorMessage,
  saveRelayConfig,
  syncRelayScheduleAfterMutation,
} from "@/lib/local-relay";
import RelayCloudSyncDevices from "@/components/admin/RelayCloudSyncDevices";

type Zone = {
  id: string;
  name: string;
  latitude: number | string;
  longitude: number | string;
  radius_m: number;
  is_active: boolean;
};

const DEFAULT_POLICY = {
  enabled: false,
  teacher_accounts_only: true,
  allow_local_relay: true,
  allow_gps_fallback: true,
  relay_local_url: null as string | null,
  max_gps_accuracy_m: 60,
  gps_grace_m: 25,
  relay_proof_ttl_seconds: 180,
};

export default function AttendancePresenceSettings() {
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detectedRelayUrls, setDetectedRelayUrls] = useState<string[]>([]);
  const [relayAdminUrl, setRelayAdminUrl] = useState("http://127.0.0.1:4317");
  const [relayAdminToken, setRelayAdminToken] = useState("");

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/attendance/presence-settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Chargement impossible.");
      setPolicy({ ...DEFAULT_POLICY, ...(payload.policy || {}) });
      setZones(Array.isArray(payload.zones) ? payload.zones : []);
      setDetectedRelayUrls(
        Array.isArray(payload.relay_local_urls) ? payload.relay_local_urls : [],
      );
    } catch (error: any) {
      setMessage(error?.message || "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const relay = getRelayConfig();
    setRelayAdminUrl(relay.baseUrl);
    setRelayAdminToken(relay.token || "");
    void load();
  }, []);

  function addZone() {
    setZones((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: current.length ? `Site ${current.length + 1}` : "Site principal",
        latitude: "",
        longitude: "",
        radius_m: 150,
        is_active: true,
      },
    ]);
  }

  function patchZone(id: string, patch: Partial<Zone>) {
    setZones((current) => current.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)));
  }

  function useCurrentPosition(id: string) {
    setMessage("Localisation du site en cours…");
    if (!navigator.geolocation) {
      setMessage("La localisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        patchZone(id, {
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
        });
        setMessage(`Position récupérée avec une précision d'environ ${Math.round(position.coords.accuracy)} m.`);
      },
      () => setMessage("Impossible d'obtenir la position. Vérifiez l'autorisation de localisation."),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/attendance/presence-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy, zones }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Enregistrement impossible.");
      saveRelayConfig({ baseUrl: relayAdminUrl, token: relayAdminToken });
      const relay = await syncRelayScheduleAfterMutation().catch((error: any) => ({
        ok: false,
        error: String(error?.message || error),
        details: null,
      }));
      await load();
      setMessage(
        relay.ok
          ? "Verrouillage enregistré et relais synchronisé ✅"
          : `Verrouillage enregistré dans le Cloud. ${relayBootstrapErrorMessage(relay)}`,
      );
    } catch (error: any) {
      setMessage(error?.message || "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function testRelay() {
    setSaving(true);
    setMessage("Connexion au relais local…");
    try {
      saveRelayConfig({ baseUrl: relayAdminUrl, token: relayAdminToken });
      const result = await syncRelayScheduleAfterMutation();
      if (!result.ok) {
        setMessage(relayBootstrapErrorMessage(result));
        return;
      }
      setMessage("Relais local connecté et données pédagogiques synchronisées ✅");
    } catch (error: any) {
      setMessage(relayBootstrapErrorMessage(error, "Relais local inaccessible."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl border border-sky-200 bg-sky-50/50 p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-sky-800">
            Périmètre des appels enseignants
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Le réseau local confirme la présence sans GPS. Hors de ce réseau, l'enseignant doit
            autoriser une vérification GPS ponctuelle. Aucun suivi permanent n'est effectué.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(event) => setPolicy((current) => ({ ...current, enabled: event.target.checked }))}
            disabled={loading || saving}
          />
          Activer le verrouillage
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="rounded-2xl border bg-white p-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={policy.allow_local_relay}
              onChange={(event) => setPolicy((current) => ({ ...current, allow_local_relay: event.target.checked }))}
              disabled={loading || saving}
            />
            Autoriser par le relais local
          </span>
          <span className="mt-1 block text-xs text-slate-500">Aucune activation GPS si le relais de l'école répond.</span>
        </label>
        <label className="rounded-2xl border bg-white p-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={policy.allow_gps_fallback}
              onChange={(event) => setPolicy((current) => ({ ...current, allow_gps_fallback: event.target.checked }))}
              disabled={loading || saving}
            />
            Autoriser par GPS
          </span>
          <span className="mt-1 block text-xs text-slate-500">Permet l'appel dans l'école avec les données mobiles ou un autre Wi-Fi.</span>
        </label>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="text-xs font-black uppercase tracking-wide text-slate-700">
          Connexion du poste d'administration au relais
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Ces informations restent dans ce navigateur Admin. Le jeton administrateur n'est jamais envoyé aux comptes enseignants.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            type="url"
            value={relayAdminUrl}
            onChange={(event) => setRelayAdminUrl(event.target.value)}
            placeholder="http://127.0.0.1:4317"
            className="rounded-lg border px-3 py-2 text-sm"
            aria-label="Adresse du relais pour ce poste Admin"
          />
          <input
            type="password"
            value={relayAdminToken}
            onChange={(event) => setRelayAdminToken(event.target.value)}
            placeholder="Jeton Admin du relais"
            className="rounded-lg border px-3 py-2 text-sm"
            autoComplete="off"
            aria-label="Jeton Admin du relais"
          />
          <button
            type="button"
            onClick={testRelay}
            disabled={loading || saving}
            className="rounded-lg border bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            Tester et synchroniser
          </button>
        </div>
      </div>

      <RelayCloudSyncDevices />

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-3 text-xs text-slate-600 md:col-span-2">
          <div className="font-bold text-slate-800">Adresses du relais détectées automatiquement</div>
          {detectedRelayUrls.length ? (
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              {detectedRelayUrls.map((url) => <div key={url}>{url}</div>)}
            </div>
          ) : (
            <p className="mt-1">
              En attente de la première connexion Cloud du PC relais. Aucune adresse IP ne doit être saisie manuellement.
            </p>
          )}
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Précision GPS maximale acceptée (m)
          <input
            type="number"
            min={10}
            max={500}
            value={policy.max_gps_accuracy_m}
            onChange={(event) => setPolicy((current) => ({ ...current, max_gps_accuracy_m: Number(event.target.value || 60) }))}
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Tolérance liée à la précision (m)
          <input
            type="number"
            min={0}
            max={100}
            value={policy.gps_grace_m}
            onChange={(event) => setPolicy((current) => ({ ...current, gps_grace_m: Number(event.target.value || 0) }))}
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-sm font-black text-slate-800">Zones autorisées</div>
        <button type="button" onClick={addZone} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">
          + Ajouter un site
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {zones.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white p-4 text-sm text-slate-500">
            Ajoutez le site principal puis utilisez « Prendre ma position » lorsque vous êtes dans l'école.
          </div>
        ) : null}
        {zones.map((zone) => (
          <div key={zone.id} className="rounded-2xl border bg-white p-3">
            <div className="grid gap-3 md:grid-cols-5">
              <input value={zone.name} onChange={(event) => patchZone(zone.id, { name: event.target.value })} placeholder="Nom du site" className="rounded-lg border px-3 py-2 text-sm" />
              <input type="number" step="any" value={zone.latitude} onChange={(event) => patchZone(zone.id, { latitude: event.target.value })} placeholder="Latitude" className="rounded-lg border px-3 py-2 text-sm" />
              <input type="number" step="any" value={zone.longitude} onChange={(event) => patchZone(zone.id, { longitude: event.target.value })} placeholder="Longitude" className="rounded-lg border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                Rayon
                <input type="number" min={30} max={5000} value={zone.radius_m} onChange={(event) => patchZone(zone.id, { radius_m: Number(event.target.value || 150) })} className="w-20 bg-transparent" /> m
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => useCurrentPosition(zone.id)} className="flex-1 rounded-lg bg-sky-700 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-800">
                  Prendre ma position
                </button>
                <button type="button" onClick={() => setZones((current) => current.filter((item) => item.id !== zone.id))} className="rounded-lg border border-rose-200 px-2 py-2 text-xs text-rose-700 hover:bg-rose-50">
                  Retirer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600" aria-live="polite">{message}</div>
        <button type="button" onClick={save} disabled={loading || saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Enregistrement…" : "Enregistrer le verrouillage"}
        </button>
      </div>
    </div>
  );
}
