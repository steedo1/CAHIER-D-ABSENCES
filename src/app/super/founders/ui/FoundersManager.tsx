// src/app/super/founders/ui/FoundersManager.tsx
"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";

type Institution = {
  id: string;
  name: string | null;
  code_unique?: string | null;
  city?: string | null;
};

type Profile = {
  id?: string;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

type FounderRow = {
  profile_id: string;
  institution_id: string;
  role: "founder";
  profiles?: Profile | Profile[] | null;
  institutions?: Institution | Institution[] | null;
};

function normalizeOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition",
        "focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15",
        props.className || "",
      ].join(" ")}
    />
  );
}

export default function FoundersManager() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [items, setItems] = useState<FounderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [selectedInstitutionIds, setSelectedInstitutionIds] = useState<string[]>([]);

  const groupedFounders = useMemo(() => {
    const map = new Map<
      string,
      {
        profile: Profile | null;
        institutions: Institution[];
      }
    >();

    for (const row of items) {
      const profile = normalizeOne(row.profiles);
      const institution = normalizeOne(row.institutions);
      const key = row.profile_id;
      const cur = map.get(key) || { profile, institutions: [] };
      if (institution) cur.institutions.push(institution);
      map.set(key, cur);
    }

    return Array.from(map.entries()).map(([profileId, value]) => ({
      profileId,
      ...value,
    }));
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/super/founders", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Chargement impossible.");
      setInstitutions(json.institutions || []);
      setItems(json.items || []);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleInstitution(id: string) {
    setSelectedInstitutionIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function createFounder() {
    setSaving(true);
    setMsg(null);
    setError(null);

    try {
      const res = await fetch("/api/super/founders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          password: password.trim() || undefined,
          institution_ids: selectedInstitutionIds,
          country: "CI",
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Création impossible.");

      setMsg(`Compte fondateur créé et rattaché à ${json.attached || selectedInstitutionIds.length} école(s).`);
      setDisplayName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setSelectedInstitutionIds([]);
      await load();
    } catch (e: any) {
      setError(e?.message || "Erreur pendant la création.");
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    !saving &&
    selectedInstitutionIds.length > 0 &&
    (phone.trim().length > 0 || email.trim().length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
          Nouveau fondateur
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">
              Nom affiché
            </label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ex. M. Kouadio Ange" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">
                Téléphone
              </label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07 13 02 37 62" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600">
                Email
              </label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="fondateur@exemple.com" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600">
              Mot de passe initial
            </label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour le mot de passe par défaut" />
          </div>

          <div>
            <div className="mb-2 text-xs font-bold text-slate-600">
              Écoles rattachées
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {institutions.length === 0 ? (
                <div className="text-sm text-slate-500">Aucun établissement disponible.</div>
              ) : (
                institutions.map((school) => {
                  const checked = selectedInstitutionIds.includes(school.id);
                  return (
                    <label key={school.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200 hover:ring-violet-200">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInstitution(school.id)}
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <span className="block font-bold text-slate-900">{school.name || "Établissement"}</span>
                        <span className="block text-xs text-slate-500">
                          {[school.code_unique, school.city].filter(Boolean).join(" • ") || school.id}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={createFounder}
            disabled={!canSave}
            className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Création…" : "Créer le compte fondateur"}
          </button>

          {msg ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{msg}</div> : null}
          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
              Fondateurs existants
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {groupedFounders.length} compte(s) fondateur(s)
            </div>
          </div>
          <button type="button" onClick={() => load()} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
            Actualiser
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {loading ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Chargement…</div>
          ) : groupedFounders.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Aucun fondateur pour le moment.</div>
          ) : (
            groupedFounders.map((founder) => (
              <div key={founder.profileId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-black text-slate-900">
                  {founder.profile?.display_name || "Fondateur"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {[founder.profile?.phone, founder.profile?.email].filter(Boolean).join(" • ") || founder.profileId}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {founder.institutions.map((school) => (
                    <span key={`${founder.profileId}-${school.id}`} className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">
                      {school.name || "Établissement"}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
