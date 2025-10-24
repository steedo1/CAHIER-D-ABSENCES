// src/app/admin/etablissements/ui/Diagnostics.tsx
"use client";

import { useEffect, useState } from "react";

export default function Diagnostics() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ping() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/debug/ping", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Ping failed");
      setData(j);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    ping();
  }, []);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-slate-700">Diagnostics</h3>
          <button
            onClick={ping}
            className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
            disabled={loading}
          >
            {loading ? "â€¦" : "RafraÃ®chir"}
          </button>
        </div>
        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
        {!data ? (
          <div className="text-sm text-slate-500">Chargementâ€¦</div>
        ) : (
          <pre className="text-xs bg-slate-50 p-2 rounded overflow-auto">
{JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
