// src/app/super/etablissements/ui/SuperConsole.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SCHOOL_CYCLE_OPTIONS, TEACHING_TRACK_OPTIONS, getDefaultSchoolCyclesSettings, type SchoolCycle, type SchoolCyclesSettings, type TeachingTrack } from "@/lib/school-cycles";
import { validateNewSchoolCycles } from "@/lib/school-creation";

type Institution = { id: string; name: string; code_unique: string };

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={
        "w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")
      }
    />
  );
}
function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={
        "w-full rounded-lg border px-3 py-2 font-mono text-sm " +
        (p.className ?? "")
      }
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        "rounded-xl bg-violet-600 text-white px-4 py-2 text-sm font-medium shadow " +
        (p.disabled ? "opacity-60" : "hover:bg-violet-700 transition")
      }
    />
  );
}

export default function SuperConsole() {
  // Création d’établissement
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [duration, setDuration] = useState<number>(12);
  const [settings, setSettings] = useState<string>("{}");
  const [creatingInst, setCreatingInst] = useState(false);
  const [schoolKind, setSchoolKind] = useState<"ordinary" | "franco_arabic">("ordinary");
  const [customCycles, setCustomCycles] = useState(false);
  const [cycleSettings, setCycleSettings] = useState<SchoolCyclesSettings>(() => ({
    ...getDefaultSchoolCyclesSettings(), teachingTracksByCycle: { secondary: ["french" as TeachingTrack] },
  }));
  const [createdInstitution, setCreatedInstitution] = useState<Institution | null>(null);
  const configureCycles = schoolKind === "franco_arabic" || customCycles;

  function changeKind(kind: "ordinary" | "franco_arabic") {
    setSchoolKind(kind);
    if (kind === "ordinary" && schoolKind === "franco_arabic") setCustomCycles(true);
    setCycleSettings(current => ({ ...current, teachingTracksByCycle: Object.fromEntries(
      current.enabledCycles.map(cycle => [cycle, kind === "franco_arabic" ? ["french", "arabic"] : ["french"]]),
    ) }));
  }

  function toggleCycle(cycle: SchoolCycle) {
    setCycleSettings(current => {
      const included = current.enabledCycles.includes(cycle);
      if (included && current.enabledCycles.length === 1) return current;
      const selected = included ? current.enabledCycles.filter(item => item !== cycle) : [...current.enabledCycles, cycle];
      return { ...current, enabledCycles: selected, teachingTracksByCycle: Object.fromEntries(selected.map(item =>
        [item, current.teachingTracksByCycle[item] || (schoolKind === "franco_arabic" ? ["french", "arabic"] : ["french"])])) };
    });
  }

  function toggleTrack(cycle: SchoolCycle, track: TeachingTrack) {
    setCycleSettings(current => {
      const previous = current.teachingTracksByCycle[cycle] || [];
      const next = previous.includes(track) ? previous.filter(item => item !== track) : [...previous, track];
      return next.length ? { ...current, teachingTracksByCycle: { ...current.teachingTracksByCycle, [cycle]: next } } : current;
    });
  }

  // Création d’admin (email + téléphone uniquement)
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [adminInst, setAdminInst] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  // Messages
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function reloadInstitutions() {
    setError(null);
    const r = await fetch("/api/super/institutions?fields=id,name,code_unique&limit=200", {
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error || "Chargement des établissements échoué.");
      return;
    }
    setInstitutions(j.items || []);
  }

  useEffect(() => {
    void reloadInstitutions().catch(() => setError("Chargement des établissements impossible."));
  }, []);

  async function onCreateInstitution() {
    if (creatingInst) return;
    setCreatingInst(true);
    setError(null);
    setOkMsg(null);
    try {
      const schoolCycles = {
        enabled: configureCycles, enabledCycles: cycleSettings.enabledCycles,
        teachingTracksByCycle: cycleSettings.teachingTracksByCycle,
      };
      if (!validateNewSchoolCycles(schoolCycles)) throw new Error("Choisissez au moins un cycle et un enseignement par cycle.");
      const body = {
        name,
        code_unique: code,
        duration_months: duration,
        settings_json: settings.trim() ? JSON.parse(settings) : {},
        school_cycles: schoolCycles,
      };
      const r = await fetch("/api/super/institutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec création établissement");
      setCreatedInstitution(j.item);
      setAdminInst(j.item.id);
      setName("");
      setCode("");
      setDuration(12);
      setSettings("{}");
      await reloadInstitutions();
      setInstitutions(current => current.some(item => item.id === j.item.id) ? current : [j.item, ...current]);
      setOkMsg("Établissement créé. Ses cycles et enseignements ont été enregistrés.");
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setCreatingInst(false);
    }
  }

  async function onCreateAdmin() {
    setCreatingAdmin(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!adminInst) throw new Error("Choisis un établissement.");
      if (!adminEmail) throw new Error("Email requis.");
      const r = await fetch("/api/super/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution_id: adminInst,
          email: adminEmail,
          phone: adminPhone || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec création admin");

      // On n’affiche pas de MDP ici : c’est DEFAULT_TEMP_PASSWORD côté serveur
      setOkMsg(
        "Admin créé. Utilisez le mot de passe temporaire par défaut configuré côté serveur."
      );
      setAdminEmail("");
      setAdminPhone("");
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setCreatingAdmin(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Créer un établissement */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Créer un établissement
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div>
            <label htmlFor="school-name" className="mb-1 block text-xs text-slate-500">Nom</label>
            <Input
              id="school-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lycée Exemple"
            />
          </div>

          <div>
            <label htmlFor="school-code" className="mb-1 block text-xs text-slate-500">Code unique</label>
            <Input
              id="school-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="LYC-EX-001"
            />
          </div>

          <div>
            <label htmlFor="school-duration" className="mb-1 block text-xs text-slate-500">
              Durée d’abonnement (mois)
            </label>
            <Input
              id="school-duration"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setDuration(Number.isNaN(v) ? 12 : v);
              }}
            />
          </div>

          <div className="lg:col-span-3">
            <label htmlFor="school-kind" className="mb-1 block text-sm font-semibold">Type d’établissement</label>
            <select id="school-kind" value={schoolKind} disabled={creatingInst}
              onChange={event => changeKind(event.target.value as "ordinary" | "franco_arabic")}
              className="min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm">
              <option value="ordinary">Établissement ordinaire</option>
              <option value="franco_arabic">Établissement franco-arabe / multicycle</option>
            </select>
            {schoolKind === "ordinary" && <label className="mt-3 flex items-center gap-2 text-sm">
              <input id="school-custom-cycles" type="checkbox" checked={customCycles} disabled={creatingInst}
                onChange={event => setCustomCycles(event.target.checked)} />
              Choisir les cycles et enseignements de cette école ordinaire
            </label>}
            {configureCycles && <fieldset className="mt-4 rounded-xl border bg-slate-50 p-4" disabled={creatingInst}>
              <legend className="px-1 text-sm font-semibold">Cycles et enseignements</legend>
              <p className="mb-3 text-xs text-slate-600">Choisissez un, deux ou trois cycles, avec au moins un enseignement par cycle.</p>
              <div className="grid gap-3 lg:grid-cols-3">
                {SCHOOL_CYCLE_OPTIONS.map(cycle => {
                  const selected = cycleSettings.enabledCycles.includes(cycle.id);
                  const tracks = cycleSettings.teachingTracksByCycle[cycle.id] || [];
                  return <div key={cycle.id} className="rounded-lg border bg-white p-3">
                    <label className="flex min-h-10 items-center gap-2 font-semibold text-sm">
                      <input id={`creation-cycle-${cycle.id}`} type="checkbox" checked={selected}
                        disabled={selected && cycleSettings.enabledCycles.length === 1}
                        onChange={() => toggleCycle(cycle.id)} />{cycle.label}
                    </label>
                    {selected && <div className="mt-2 space-y-2">
                      {TEACHING_TRACK_OPTIONS.map(track => <label key={track.id} className="flex min-h-10 items-center gap-2 text-sm">
                        <input id={`creation-track-${cycle.id}-${track.id}`} type="checkbox" checked={tracks.includes(track.id)}
                          disabled={tracks.length === 1 && tracks.includes(track.id)}
                          onChange={() => toggleTrack(cycle.id, track.id)} />{track.label}
                      </label>)}
                    </div>}
                  </div>;
                })}
              </div>
            </fieldset>}
          </div>

          <div className="lg:col-span-3">
            <details className="rounded-lg border bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Options avancées (JSON)
              </summary>
              <Textarea
                className="mt-2"
                value={settings}
                onChange={(e) => setSettings(e.target.value)}
              />
            </details>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={onCreateInstitution}
            disabled={creatingInst || !name.trim() || !code.trim() || duration < 1 || duration > 120}
          >
            {creatingInst ? "Création…" : "Créer l’établissement"}
          </Button>
          {okMsg && <div role="status" className="text-sm text-green-700">{okMsg}</div>}
          {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
        </div>
        {createdInstitution && <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-violet-800">
          <Link href={`/super/cycles?inst=${createdInstitution.id}`}>Consulter ou modifier les cycles de {createdInstitution.name}</Link>
          <Link href="/super/etablissements/liste">Voir la liste des établissements</Link>
        </div>}
      </div>

      {/* Créer un admin (email + téléphone) */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Créer un admin d’établissement
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Établissement</div>
            <select
              value={adminInst}
              onChange={(e) => setAdminInst(e.target.value)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="">— Choisir —</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code_unique})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Email admin</div>
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@exemple.com"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">
              Téléphone (optionnel)
            </div>
            <Input
              value={adminPhone}
              onChange={(e) => setAdminPhone(e.target.value)}
              placeholder="+225..."
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={onCreateAdmin}
            disabled={creatingAdmin || !adminInst || !adminEmail}
          >
            {creatingAdmin ? "Création…" : "Ajouter l’admin"}
          </Button>
          {okMsg && <div className="text-sm text-green-700">{okMsg}</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Le mot de passe temporaire est défini côté serveur via
          <code className="ml-1 rounded bg-slate-100 px-1">DEFAULT_TEMP_PASSWORD</code>.
        </p>
      </div>
    </div>
  );
}
