// src/app/super/etablissements/ui/ListInstitutions.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Inst = {
  id: string;
  name: string;
  code_unique: string;
  subscription_expires_at: string | null;
};

export default function ListInstitutions() {
  const [items, setItems] = useState<Inst[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const limit = 20;

  async function load(p = page, query = q) {
    const offset = (p - 1) * limit;
    const res = await fetch(
      `/api/super/institutions?limit=${limit}&offset=${offset}&q=${encodeURIComponent(query)}`,
      { cache: "no-store" }
    );
    const j = await res.json();
    if (res.ok) {
      const list: Inst[] = j.items || [];
      setItems(list);
      setTotal(j.total || 0);

      // Charger les compteurs élèves pour les IDs de la page courante
      const ids = list.map((i) => i.id).join(",");
      setCounts({});
      if (ids) {
        setLoadingCounts(true);
        try {
          const r2 = await fetch(`/api/super/institutions/students-count?ids=${ids}`, { cache: "no-store" });
          const j2 = await r2.json();
          if (r2.ok) setCounts(j2.counts || {});
        } finally {
          setLoadingCounts(false);
        }
      }
    }
  }

  useEffect(() => {
    load(1, "");
  }, []);

  const pages = Math.max(1, Math.ceil(total / limit));

  async function onDelete(id: string) {
    if (!confirm("Supprimer cet établissement ? Cette action est irréversible.")) return;
    const r = await fetch(`/api/super/institutions/${id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      alert(j?.error || "Échec de suppression");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          placeholder="Rechercher (nom ou code)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left">Établissement</th>
              <th className="px-4 py-2 text-left">Code</th>
              <th className="px-4 py-2 text-left">Expire le</th>
              <th className="px-4 py-2 text-left">Élèves</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-4 py-2">{i.name}</td>
                <td className="px-4 py-2">{i.code_unique}</td>
                <td className="px-4 py-2">{i.subscription_expires_at || "—"}</td>
                <td className="px-4 py-2">{loadingCounts ? "…" : counts[i.id] ?? 0}</td>
                <td className="px-4 py-2 space-x-2">
                  <Link href={`/super/parametres?inst=${i.id}`} className="text-violet-700 hover:underline">
                    Modifier
                  </Link>
                  <button onClick={() => onDelete(i.id)} className="text-red-600 hover:underline">
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={5}>
                  Aucun résultat.
                </td>
              </tr>
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
              setPage((p) => {
                const n = Math.max(1, p - 1);
                load(n, q);
                return n;
              });
            }}
            className="rounded border px-3 py-1 disabled:opacity-50"
          >
            Préc.
          </button>
          <button
            disabled={page >= pages}
            onClick={() => {
              setPage((p) => {
                const n = Math.min(pages, p + 1);
                load(n, q);
                return n;
              });
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
