// src/app/super/drenaets/ui/DrenaetsManager.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type DrenaetAccount = {
  profile_id: string;
  email: string | null;
  display_name: string | null;
  phone: string | null;
  scopes: {
    regional_direction: string;
    can_export: boolean;
    can_view_grades: boolean;
    can_view_teacher_presence: boolean;
  }[];
};

type LoadResponse = {
  items?: DrenaetAccount[];
  total?: number;
  regional_directions?: string[];
  error?: string;
};

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  regional_directions: string[];
  can_export: boolean;
  can_view_grades: boolean;
  can_view_teacher_presence: boolean;
};

const EMPTY_FORM: FormState = {
  full_name: "",
  email: "",
  phone: "",
  regional_directions: [],
  can_export: true,
  can_view_grades: true,
  can_view_teacher_presence: true,
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
      {children}
    </span>
  );
}

export default function DrenaetsManager() {
  const [items, setItems] = useState<DrenaetAccount[]>([]);
  const [regionalDirections, setRegionalDirections] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const filteredDirections = useMemo(() => {
    return regionalDirections.filter((direction) => direction.trim().length > 0);
  }, [regionalDirections]);

  async function load(query = q) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/super/drenaets?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as LoadResponse;

      if (!res.ok) {
        throw new Error(json.error || "Impossible de charger les accès DRENAET.");
      }

      setItems(json.items ?? []);
      setRegionalDirections(json.regional_directions ?? []);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleDirection(direction: string) {
    setForm((current) => {
      const exists = current.regional_directions.includes(direction);
      return {
        ...current,
        regional_directions: exists
          ? current.regional_directions.filter((d) => d !== direction)
          : [...current.regional_directions, direction],
      };
    });
  }

  function editAccount(account: DrenaetAccount) {
    const firstScope = account.scopes[0];
    setForm({
      full_name: account.display_name ?? "",
      email: account.email ?? "",
      phone: account.phone ?? "",
      regional_directions: account.scopes.map((scope) => scope.regional_direction),
      can_export: firstScope?.can_export ?? true,
      can_view_grades: firstScope?.can_view_grades ?? true,
      can_view_teacher_presence: firstScope?.can_view_teacher_presence ?? true,
    });
    setSuccess(null);
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/super/drenaets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Impossible d’enregistrer cet accès DRENAET.");
      }

      const passwordText = json.temporary_password
        ? ` Mot de passe temporaire à communiquer une seule fois : ${json.temporary_password}`
        : " Le mot de passe temporaire est celui configuré dans DEFAULT_TEMP_PASSWORD.";

      setSuccess(`Accès DRENAET enregistré pour ${json.user?.email || form.email}.${passwordText}`);
      setForm(EMPTY_FORM);
      await load(q);
    } catch (e: any) {
      setError(e?.message || "Erreur pendant l’enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
      <section className="space-y-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Comptes DRENAET</h2>
              <p className="text-sm text-slate-500">
                Liste des accès régionaux créés depuis le super-admin.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && load(q)}
                placeholder="Rechercher nom, email, zone..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 sm:w-72"
              />
              <button
                type="button"
                onClick={() => load(q)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Rechercher
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
            {success}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Responsable</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Périmètre</th>
                  <th className="px-4 py-3">Droits</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-slate-500" colSpan={5}>
                      Chargement des accès DRENAET…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-slate-500" colSpan={5}>
                      Aucun compte DRENAET trouvé.
                    </td>
                  </tr>
                ) : (
                  items.map((account) => (
                    <tr key={account.profile_id} className="align-top">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-900">{account.display_name || "—"}</div>
                        <div className="mt-1 text-xs text-slate-400">ID : {account.profile_id}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        <div>{account.email || "—"}</div>
                        <div className="mt-1 text-xs text-slate-400">{account.phone || "Téléphone non renseigné"}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {account.scopes.length > 0 ? (
                            account.scopes.map((scope) => (
                              <Badge key={`${account.profile_id}-${scope.regional_direction}`}>
                                {scope.regional_direction}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-slate-400">Aucune zone</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        <div>Export : {account.scopes.some((s) => s.can_export) ? "Oui" : "Non"}</div>
                        <div>Notes : {account.scopes.some((s) => s.can_view_grades) ? "Oui" : "Non"}</div>
                        <div>
                          Présence enseignants :{" "}
                          {account.scopes.some((s) => s.can_view_teacher_presence) ? "Oui" : "Non"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => editAccount(account)}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Modifier
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <aside className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Créer ou mettre à jour un accès</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Utilisez un email dédié au DRENAET. Pour éviter toute confusion de redirection, un compte qui possède déjà
          un autre rôle sera refusé.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nom complet</label>
            <input
              value={form.full_name}
              onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
              placeholder="Ex : Directeur régional Aboisso"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email de connexion</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="drenaet.aboisso@example.com"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Téléphone</label>
            <input
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+225..."
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zones DRENAET</label>
              <span className="text-xs text-slate-400">{form.regional_directions.length} sélectionnée(s)</span>
            </div>

            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
              {filteredDirections.length === 0 ? (
                <div className="text-sm text-slate-500">
                  Aucune direction régionale trouvée. Renseignez d’abord le champ regional_direction des établissements.
                </div>
              ) : (
                filteredDirections.map((direction) => (
                  <label key={direction} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={form.regional_directions.includes(direction)}
                      onChange={() => toggleDirection(direction)}
                      className="h-4 w-4 rounded border-slate-300 text-violet-600"
                    />
                    <span className="text-sm font-medium text-slate-700">{direction}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Droits</div>
            <div className="mt-2 space-y-2 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.can_export}
                  onChange={(event) => setForm((current) => ({ ...current, can_export: event.target.checked }))}
                />
                Peut exporter les rapports
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.can_view_grades}
                  onChange={(event) => setForm((current) => ({ ...current, can_view_grades: event.target.checked }))}
                />
                Peut voir les indicateurs de notes
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.can_view_teacher_presence}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, can_view_teacher_presence: event.target.checked }))
                  }
                />
                Peut voir la présence enseignants
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Enregistrement…" : "Enregistrer l’accès"}
            </button>
            <button
              type="button"
              onClick={() => setForm(EMPTY_FORM)}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Réinitialiser
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
