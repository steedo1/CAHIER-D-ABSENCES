"use client";

import React from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FlaskConical,
  Loader2,
  PlusCircle,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type ResourceType = "ordinary" | "pc_lab" | "svt_lab" | "computer_lab" | "sports_field";
type RoomFormat = "numeric" | "alpha";
type PreferenceUsage = "main" | "allowed" | "forbidden";

type Resource = {
  id: string;
  name: string;
  resource_type: ResourceType;
  capacity?: number | null;
  is_shared: boolean;
  is_active: boolean;
};

type SchoolClass = {
  id: string;
  label: string;
};

type RoomPreference = {
  id: string;
  class_id: string;
  resource_id: string;
  priority: number;
  usage_type: PreferenceUsage;
  is_allowed: boolean;
};

type Totals = {
  resources: number;
  active: number;
  ordinary: number;
  specialized: number;
  classes: number;
  classes_with_main_room: number;
};

type ApiResponse =
  | { ok: true; items: Resource[]; classes: SchoolClass[]; preferences: RoomPreference[]; totals: Totals }
  | { ok: false; error: string; message?: string };

const TYPES: Array<{ value: ResourceType; label: string; short: string; help: string }> = [
  { value: "ordinary", label: "Salle ordinaire", short: "Ordinaire", help: "Salle principale ou alternative d’une classe." },
  { value: "pc_lab", label: "Laboratoire P.C", short: "Labo P.C", help: "Utilisé pour les cours de Physique-Chimie si disponible." },
  { value: "svt_lab", label: "Laboratoire SVT", short: "Labo SVT", help: "Utilisé pour les cours SVT si disponible." },
  { value: "computer_lab", label: "Salle informatique", short: "Info", help: "Utilisée pour l’informatique si disponible." },
  { value: "sports_field", label: "Terrain EPS", short: "EPS", help: "Utilisé pour l’EPS si disponible." },
];

const SPECIALIZED_TYPES: ResourceType[] = ["pc_lab", "svt_lab", "sports_field", "computer_lab"];

function typeLabel(value: ResourceType) {
  return TYPES.find((item) => item.value === value)?.label || value;
}

function typeHelp(value: ResourceType) {
  return TYPES.find((item) => item.value === value)?.help || "";
}

function generateRoomName(baseName: string, format: RoomFormat, index: number) {
  return format === "alpha" ? `${baseName} ${String.fromCharCode(64 + index)}` : `${baseName} ${index}`;
}

function preferenceByClass(preferences: RoomPreference[]) {
  const main = new Map<string, string>();
  const alternative = new Map<string, string>();

  for (const preference of preferences) {
    if (!preference.is_allowed) continue;
    if (preference.usage_type === "main") main.set(preference.class_id, preference.resource_id);
    if (preference.usage_type === "allowed") alternative.set(preference.class_id, preference.resource_id);
  }

  return { main, alternative };
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}

export default function MontageResourcesPage() {
  const [items, setItems] = React.useState<Resource[]>([]);
  const [classes, setClasses] = React.useState<SchoolClass[]>([]);
  const [preferences, setPreferences] = React.useState<RoomPreference[]>([]);
  const [totals, setTotals] = React.useState<Totals | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [resourceType, setResourceType] = React.useState<ResourceType>("ordinary");
  const [capacity, setCapacity] = React.useState("");
  const [isShared, setIsShared] = React.useState(true);

  const [baseName, setBaseName] = React.useState("Salle");
  const [format, setFormat] = React.useState<RoomFormat>("numeric");
  const [count, setCount] = React.useState(6);

  const [specializedCounts, setSpecializedCounts] = React.useState<Record<ResourceType, number>>({
    ordinary: 0,
    pc_lab: 0,
    svt_lab: 0,
    computer_lab: 0,
    sports_field: 0,
  });

  const [mainByClass, setMainByClass] = React.useState<Record<string, string>>({});
  const [alternativeByClass, setAlternativeByClass] = React.useState<Record<string, string>>({});

  const ordinaryRooms = React.useMemo(() => items.filter((item) => item.resource_type === "ordinary" && item.is_active), [items]);
  const activeResources = React.useMemo(() => items.filter((item) => item.is_active), [items]);
  const generatedPreview = React.useMemo(() => {
    const safeCount = Math.max(1, Math.min(80, Number(count) || 1));
    return Array.from({ length: safeCount }, (_, index) => generateRoomName(baseName || "Salle", format, index + 1));
  }, [baseName, count, format]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/ressources", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!json) return setError("Réponse serveur invalide.");
      if (!json.ok) return setError((json as any).message || (json as any).error);

      setItems(json.items || []);
      setClasses(json.classes || []);
      setPreferences(json.preferences || []);
      setTotals(json.totals || null);

      const grouped = preferenceByClass(json.preferences || []);
      setMainByClass(Object.fromEntries(grouped.main.entries()));
      setAlternativeByClass(Object.fromEntries(grouped.alternative.entries()));

      const nextSpecializedCounts = { ordinary: 0, pc_lab: 0, svt_lab: 0, computer_lab: 0, sports_field: 0 } as Record<ResourceType, number>;
      for (const item of json.items || []) {
        nextSpecializedCounts[item.resource_type] = (nextSpecializedCounts[item.resource_type] || 0) + 1;
      }
      setSpecializedCounts(nextSpecializedCounts);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/montage-emploi-du-temps/ressources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
    if (!json) throw new Error("Réponse serveur invalide.");
    if (!json.ok) throw new Error((json as any).message || (json as any).error);
    return json.message || "Action effectuée.";
  }

  async function saveResource() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await post({ action: "save_resource", name, resource_type: resourceType, capacity, is_shared: isShared, is_active: true });
      setSuccess(message);
      setName("");
      setCapacity("");
      setResourceType("ordinary");
      setIsShared(true);
      await load();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function generateOrdinaryRooms() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await post({ action: "generate_ordinary_rooms", base_name: baseName, format, count });
      setSuccess(message);
      await load();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function ensureSpecializedRooms() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const message = await post({ action: "ensure_specialized_rooms", specialized_counts: specializedCounts });
      setSuccess(message);
      await load();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = classes.map((schoolClass) => ({
        class_id: schoolClass.id,
        main_resource_id: mainByClass[schoolClass.id] || null,
        alternative_resource_id: alternativeByClass[schoolClass.id] || null,
      }));
      const message = await post({ action: "save_class_room_preferences", preferences: payload });
      setSuccess(message);
      await load();
    } catch (err) {
      setError(normalizeError(err));
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
      if (!json.ok) return setError((json as any).message || (json as any).error);
      setSuccess(json.message || "Ressource supprimée.");
      await load();
    } catch (err) {
      setError(normalizeError(err));
    }
  }

  return (
    <MontageSectionShell
      title="Salles & ressources"
      description="Configuration réelle des espaces : salles ordinaires, laboratoires P.C/SVT, terrain EPS, salle informatique et salle principale par classe."
      status="Salles HoraClasse"
      note="On ne crée pas de classes ici. Les classes viennent de Mon Cahier ; cet écran déclare uniquement les espaces nécessaires au moteur."
      cards={[
        { title: "Salles", description: `${totals?.resources ?? items.length} ressource(s) enregistrée(s).` },
        { title: "Classes affectées", description: `${totals?.classes_with_main_room ?? 0}/${totals?.classes ?? classes.length} avec salle principale.` },
        { title: "Ressources spécialisées", description: `${totals?.specialized ?? 0} labo/terrain/salle info.` },
      ]}
    >
      <div className="space-y-6">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
                <Building2 className="h-4 w-4" />
                Création rapide des salles ordinaires
              </div>
              <h2 className="mt-3 text-xl font-black text-slate-950">Créer les salles de classe</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">Exemple : Salle 1, Salle 2, Salle 3. Les doublons ne sont pas recréés.</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
              Aperçu : <span className="font-black text-slate-950">{generatedPreview.slice(0, 6).join(", ")}{generatedPreview.length > 6 ? "…" : ""}</span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_220px_150px_auto] lg:items-end">
            <label className="space-y-1 text-sm font-bold text-slate-700">
              Nom de base
              <input value={baseName} onChange={(event) => setBaseName(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              Format
              <select value={format} onChange={(event) => setFormat(event.target.value as RoomFormat)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="numeric">Numérique : 1, 2, 3</option>
                <option value="alpha">Alphabétique : A, B, C</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              Nombre
              <input type="number" min={1} max={80} value={count} onChange={(event) => setCount(Number(event.target.value || "1"))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </label>
            <button type="button" onClick={() => void generateOrdinaryRooms()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              Créer
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-violet-700 ring-1 ring-violet-100">
                  <FlaskConical className="h-4 w-4" />
                  Laboratoires & terrains
                </div>
                <h2 className="mt-3 text-xl font-black text-slate-950">Ressources spécialisées</h2>
                <p className="mt-1 text-sm text-slate-500">Mets 0 si l’établissement n’a pas cette ressource.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {SPECIALIZED_TYPES.map((type) => (
                <label key={type} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span>
                    <strong className="block text-sm text-slate-950">{typeLabel(type)}</strong>
                    <span className="text-xs font-medium text-slate-500">{typeHelp(type)}</span>
                  </span>
                  <input type="number" min={0} max={20} value={specializedCounts[type] || 0} onChange={(event) => setSpecializedCounts((current) => ({ ...current, [type]: Number(event.target.value || "0") }))} className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center font-black outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
                </label>
              ))}
            </div>

            <button type="button" onClick={() => void ensureSpecializedRooms()} disabled={saving} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Appliquer les ressources spécialisées
            </button>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">Ajouter une ressource manuellement</h2>
            <p className="mt-1 text-sm text-slate-500">À utiliser pour une salle précise, un deuxième terrain ou une ressource particulière.</p>

            <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_220px_130px]">
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
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 sm:min-w-[240px]">
                Ressource partagée
                <input type="checkbox" checked={isShared} onChange={(event) => setIsShared(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-emerald-600" />
              </label>
              <button type="button" onClick={() => void saveResource()} disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Ajouter
              </button>
            </div>
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
            <div className="p-8 text-center text-sm font-semibold text-slate-500">Aucune ressource enregistrée. Commence par créer les salles ordinaires.</div>
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

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Affectation des classes aux salles</h2>
              <p className="mt-1 text-sm text-slate-500">Les classes viennent de Mon Cahier. Ici on choisit seulement leur salle principale et éventuellement une salle alternative.</p>
            </div>
            <button type="button" onClick={() => void savePreferences()} disabled={saving || classes.length === 0} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </button>
          </div>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Classe</th>
                  <th className="px-4 py-3">Salle principale</th>
                  <th className="px-4 py-3">Salle alternative</th>
                  <th className="px-4 py-3">Observation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {classes.map((schoolClass) => {
                  const main = mainByClass[schoolClass.id] || "";
                  const alternative = alternativeByClass[schoolClass.id] || "";
                  return (
                    <tr key={schoolClass.id}>
                      <td className="px-4 py-3 font-black text-slate-950">{schoolClass.label}</td>
                      <td className="px-4 py-3">
                        <select value={main} onChange={(event) => setMainByClass((current) => ({ ...current, [schoolClass.id]: event.target.value }))} className="w-full min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                          <option value="">Non affectée</option>
                          {ordinaryRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select value={alternative} onChange={(event) => setAlternativeByClass((current) => ({ ...current, [schoolClass.id]: event.target.value }))} className="w-full min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                          <option value="">Aucune</option>
                          {ordinaryRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {main ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Salle affectée</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">À affecter</span>}
                      </td>
                    </tr>
                  );
                })}
                {classes.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">Aucune classe Mon Cahier détectée.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-sky-100 bg-sky-50 p-5 text-sm text-sky-950">
          <p className="font-black">Règle retenue</p>
          <p className="mt-1">S’il n’y a aucun laboratoire ou terrain, le moteur ne doit pas inventer une ressource. Le fallback vers une salle ordinaire dépendra des règles terrain.</p>
        </div>
      </div>
    </MontageSectionShell>
  );
}
