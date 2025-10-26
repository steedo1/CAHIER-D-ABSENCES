// src/app/super/etablissements/ui/SuperConsole.tsx
"use client";

import { useEffect, useState } from "react";

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
    setOkMsg(null);
    const r = await fetch("/api/super/institutions?fields=id,name,code_unique", {
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
    reloadInstitutions();
  }, []);

  async function onCreateInstitution() {
    setCreatingInst(true);
    setError(null);
    setOkMsg(null);
    try {
      const body = {
        name,
        code_unique: code,
        duration_months: duration,
        settings_json: settings.trim() ? JSON.parse(settings) : {},
      };
      const r = await fetch("/api/super/institutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Ã‰chec création établissement");
      setName("");
      setCode("");
      setDuration(12);
      setSettings("{}");
      setOkMsg("Ã‰tablissement créé.");
      await reloadInstitutions();
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
      if (!r.ok) throw new Error(j?.error || "Ã‰chec création admin");

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
            <div className="mb-1 text-xs text-slate-500">Nom</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lycée Exemple"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Code unique</div>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="LYC-EX-001"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">
              Durée d’abonnement (mois)
            </div>
            <Input
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

        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={onCreateInstitution}
            disabled={creatingInst || !name || !code}
          >
            {creatingInst ? "Création…" : "Créer l’établissement"}
          </Button>
          {okMsg && <div className="text-sm text-green-700">{okMsg}</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      </div>

      {/* Créer un admin (email + téléphone) */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Créer un admin d’établissement
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Ã‰tablissement</div>
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

        <div className="mt-3 flex items-center gap-2">
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


