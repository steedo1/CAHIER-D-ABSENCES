// src/app/super/admins/ui/AdminsTable.tsx
"use client";

import { useEffect, useState } from "react";

type Profile = { display_name?: string | null; email?: string | null; phone?: string | null };
type Institution = { name: string; code_unique: string };
type AdminRowRaw = {
  profile_id: string;
  institution_id: string | null;
  role: "admin";
  profiles?: Profile | Profile[] | null;
  institutions?: Institution | Institution[] | null;
};
type AdminRow = {
  profile_id: string;
  institution_id: string | null;
  role: "admin";
  profiles: Profile | null;
  institutions: Institution | null;
};

function normalize(r: AdminRowRaw): AdminRow {
  return {
    profile_id: r.profile_id,
    institution_id: r.institution_id ?? null,
    role: r.role,
    profiles: Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles ?? null,
    institutions: Array.isArray(r.institutions) ? r.institutions[0] ?? null : r.institutions ?? null,
  };
}

export default function AdminsTable() {
  const [items, setItems] = useState<AdminRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const limit = 20;

  async function load(p = page, query = q) {
    setLoading(true);
    const offset = (p - 1) * limit;
    const res = await fetch(
      `/api/super/admins?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`,
      { cache: "no-store" }
    );
    const j = await res.json();
    if (res.ok) {
      setItems((j.items ?? []).map(normalize));
      setTotal(j.total ?? 0);
    }
    setLoading(false);
  }

  useEffect(() => {
    load(1, "");
  }, []);
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          placeholder="Rechercher (nom admin, email, téléphone, établissement ou code)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(1, q)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <button
          onClick={() => {
            setPage(1);
            load(1, q);
          }}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white"
        >
          Rechercher
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-600">
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Téléphone</th>
              <th className="px-4 py-2">Établissement</th>
              <th className="px-4 py-2">Rôle</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={5}>
                  Chargement…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={5}>
                  Aucun résultat.
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={`${a.profile_id}-${a.institution_id}`} className="border-b last:border-0">
                  <td className="px-4 py-2">{a.profiles?.display_name || "—"}</td>
                  <td className="px-4 py-2">{a.profiles?.email || "—"}</td>
                  <td className="px-4 py-2">{a.profiles?.phone || "—"}</td>
                  <td className="px-4 py-2">
                    {a.institutions?.name
                      ? `${a.institutions.name} (${a.institutions.code_unique})`
                      : a.institution_id || "—"}
                  </td>
                  <td className="px-4 py-2">{a.role}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div>
          Page {page} / {pages} • {total} résultat(s)
        </div>
        <div className="space-x-2">
          <button
            disabled={page <= 1}
            onClick={() => {
              const n = Math.max(1, page - 1);
              setPage(n);
              load(n, q);
            }}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Préc.
          </button>
          <button
            disabled={page >= pages}
            onClick={() => {
              const n = Math.min(pages, page + 1);
              setPage(n);
              load(n, q);
            }}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Suiv.
          </button>
        </div>
      </div>
    </div>
  );
}
