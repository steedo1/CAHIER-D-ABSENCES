// src/app/drenaet/rapports/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Download, FileDown, Loader2 } from "lucide-react";

type ReportItem = {
  key: string;
  title: string;
  description: string;
  formats: string[];
};

type ReportsPayload = {
  ok: boolean;
  range: { fromYmd: string; toYmd: string };
  scope: { regional_directions: string[]; institutions: number };
  reports: ReportItem[];
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function toCsv(rows: any[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (value: any) => {
    const s = String(value ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.join(";"), ...rows.map((row) => headers.map((h) => esc(row[h])).join(";"))].join("\n");
}

function downloadCsv(filename: string, rows: any[]) {
  const content = toCsv(rows);
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DrenaetRapportsPage() {
  const [from, setFrom] = useState(minusDays(6));
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ from, to });
        const res = await fetch(`/api/drenaet/reports?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || json?.error || "Erreur de chargement");
        if (alive) setData(json);
      } catch (e: any) {
        if (alive) setError(e?.message || "Erreur inattendue");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [from, to]);

  async function exportReport(key: string) {
    setExporting(key);
    try {
      const params = new URLSearchParams({ from, to });
      if (key === "teacher_presence") {
        const res = await fetch(`/api/drenaet/teacher-presence?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || json?.error || "Export impossible");
        downloadCsv(`drenaet_presence_enseignants_${from}_${to}.csv`, json.items || []);
        return;
      }

      if (key === "attendance_weekly" || key === "regional_daily" || key === "silent_institutions") {
        const [attendanceRes, presenceRes] = await Promise.all([
          fetch(`/api/drenaet/attendance?${params.toString()}`, { cache: "no-store" }),
          fetch(`/api/drenaet/teacher-presence?${params.toString()}`, { cache: "no-store" }),
        ]);
        const attendance = await attendanceRes.json();
        const presence = await presenceRes.json();
        if (!attendanceRes.ok) throw new Error(attendance?.message || attendance?.error || "Export impossible");
        if (!presenceRes.ok) throw new Error(presence?.message || presence?.error || "Export impossible");

        const presenceMap = new Map((presence.items || []).map((p: any) => [p.institution_id, p]));
        const rows = (attendance.items || []).map((a: any) => {
          const p: any = presenceMap.get(a.institution_id) || {};
          return {
            institution_name: a.institution_name,
            regional_direction: a.regional_direction,
            marks: a.marks,
            absences: a.absences,
            retards: a.retards,
            absence_rate: a.absence_rate,
            late_rate: a.late_rate,
            sessions: p.sessions || 0,
            confirmed: p.confirmed || 0,
            missing: p.missing || 0,
            teacher_coverage_rate: p.coverage_rate || 0,
          };
        });

        const filtered = key === "silent_institutions"
          ? rows.filter((r: any) => Number(r.marks || 0) === 0 && Number(r.sessions || 0) === 0)
          : rows;

        downloadCsv(`drenaet_${key}_${from}_${to}.csv`, filtered);
      }
    } catch (e: any) {
      alert(e?.message || "Export impossible");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
              <FileDown className="h-4 w-4" />
              Rapports régionaux
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Rapports DRENAET</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Exports CSV prêts pour analyse. Les PDF professionnels pourront venir ensuite avec en-tête officiel DRENAET.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-600">Du<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none" /></label>
            <label className="text-xs font-bold text-slate-600">Au<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none" /></label>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-slate-200 bg-white gap-3 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />Chargement des rapports...</div>
      ) : error ? (
        <div className="rounded-[28px] border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {(data?.reports || []).map((report) => (
            <article key={report.key} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black text-slate-950">{report.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{report.description}</p>
                  <p className="mt-3 text-xs font-bold text-slate-400">Période : {from} → {to}</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <FileDown className="h-5 w-5" />
                </div>
              </div>
              <button
                type="button"
                onClick={() => exportReport(report.key)}
                disabled={exporting === report.key}
                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exporting === report.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exporter CSV
              </button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
