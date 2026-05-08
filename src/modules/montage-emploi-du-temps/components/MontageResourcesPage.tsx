"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type ResourceType = "ordinary" | "pc_lab" | "svt_lab" | "computer_lab" | "sports_field";

type Resource = {
  id: string;
  name: string;
  resource_type: ResourceType;
  capacity?: number | null;
  is_shared: boolean;
  is_active: boolean;
};

type ApiResponse =
  | { ok: true; items: Resource[]; totals?: { resources: number; active: number } }
  | { ok: false; error: string; message?: string };

const TYPES: Array<{ value: ResourceType; label: string }> = [
  { value: "ordinary", label: "Salle ordinaire" },
  { value: "pc_lab", label: "Laboratoire P.C" },
  { value: "svt_lab", label: "Laboratoire SVT" },
  { value: "computer_lab", label: "Salle informatique" },
  { value: "sports_field", label: "Terrain EPS" },
];

function typeLabel(value: ResourceType) {
  return TYPES.find((item) => item.value === value)?.label || value;
}

export default function MontageResourcesPage() {
  const [items, setItems] = React.useState<Resource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [resourceType, setResourceType] = React.useState<ResourceType>("ordinary");
  const [capacity, setCapacity] = React.useState("");
  const [isShared, setIsShared] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/ressources", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!json) return setError("Réponse serveur invalide.");
      if (!json.ok) return setError(json.message || json.error);
      setItems(json.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les ressources.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/ressources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, resource_type: resourceType, capacity, is_shared: isShared, is_active: true }),
      });
      const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
      if (!json) return setError("Réponse serveur invalide pendant la sauvegarde.");
      if (!json.ok) return setError(json.message || json.error);
      setSuccess(json.message || "Ressource sauvegardée.");
      setName("");
      setCapacity("");
      setResourceType("ordinary");
      setIsShared(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de sauvegarder la ressource.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/ressources?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
      if (!json) return setError("Réponse serveur invalide pendant la suppression.");
      if (!json.ok) return setError(json.message || json.error);
      setSuccess(json.message || "Ressource supprimée.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer la ressource.");
    }
  }

  const activeCount = items.filter((item) => item.is_active).length;

  return (
    <MontageSectionShell
      title="Salles & ressources"
      description="Configurer les salles et ressources utilisées par HoraClasse : salles ordinaires, laboratoires, terrain EPS et salle informatique."
      status="Rooms / RoomPreferences"
      note="Ces ressources alimentent rooms et roomPreferences dans SchedulerContext. Les matières peuvent demander ordinary, pc_lab, svt_lab, sports_field ou computer_lab."
      cards={[
        { title: "Ressources", description: `${items.length} ressource(s) enregistrée(s).` },
        { title: "Actives", description: `${activeCount} ressource(s) disponible(s) pour le moteur.` },
        { title: "Modèle HoraClasse", description: "Aucune ressource inventée : l’admin déclare ce que l’établissement utilise réellement." },
      ]}
    >
      <div className="space-y-5">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_140px_160px_auto] lg:items-end">
            <label className="space-y-1 text-sm font-bold text-slate-700">
              Nom
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Salle 1, Labo PC, Terrain A" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </label>

            <label className="space-y-1 text-sm font-bold text-slate-700">
              Type
              <select value={resourceType} onChange={(event) => setResourceType(event.target.value as ResourceType)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                {TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>

            <label className="space-y-1 text-sm font-bold text-slate-700">
              Capacité
              <input value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="ex: 2" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              Ressource partagée
              <input type="checkbox" checked={isShared} onChange={(event) => setIsShared(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-emerald-600" />
            </label>

            <button type="button" onClick={() => void save()} disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Ajouter
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-black text-slate-950">Ressources enregistrées</h2>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
        </div>

        {error && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5" /><div><p className="font-black">Erreur</p><p className="text-sm">{error}</p></div></div></div>}
        {success && <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5" /><div><p className="font-black">Action réussie</p><p className="text-sm">{success}</p></div></div></div>}

        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center gap-3 p-6 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Chargement...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">Aucune ressource enregistrée. Tu peux commencer par les salles ordinaires, laboratoires ou terrain EPS.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <div key={item.id} className="grid gap-3 p-4 sm:grid-cols-[1.4fr_1fr_120px_120px_auto] sm:items-center">
                  <div><p className="font-black text-slate-950">{item.name}</p><p className="text-xs font-semibold text-slate-500">{item.is_shared ? "Partagée" : "Non partagée"}</p></div>
                  <div className="font-bold text-slate-700">{typeLabel(item.resource_type)}</div>
                  <div className="text-sm text-slate-600">{item.capacity || "—"}</div>
                  <div><span className={item.is_active ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700" : "rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500"}>{item.is_active ? "Active" : "Inactive"}</span></div>
                  <button type="button" onClick={() => void remove(item.id)} className="inline-flex items-center justify-center rounded-xl border border-red-100 bg-red-50 p-3 text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MontageSectionShell>
  );
}
