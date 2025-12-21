"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Lock } from "lucide-react";

type Props = {
  classId: string;
  academicYear: string;
};

const PERIOD_OPTIONS = [
  { value: "Fin T1", label: "Clôturer T1" },
  { value: "Fin T2", label: "Clôturer T2" },
  { value: "Fin d'année", label: "Clôturer l'année" },
];

export function ClosePeriodButton({ classId, academicYear }: Props) {
  const [period, setPeriod] = React.useState<string>("Fin T1");
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = async () => {
    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      const res = await fetch("/api/admin/grades/close-period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: classId,
          academic_year: academicYear,
          period_label: period,
          generate_labels: period === "Fin d'année",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        setError(data?.message || data?.error || `Erreur ${res.status}`);
        return;
      }

      setMessage(
        `Période "${period}" clôturée le ${data.snapshot_date || "aujourd'hui"}.`
      );
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          disabled={loading}
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleClick}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Clôture...
            </>
          ) : (
            <>
              <Lock className="mr-1 h-3 w-3" />
              Clôturer
            </>
          )}
        </Button>
      </div>

      {message && (
        <p className="text-[11px] text-emerald-700">{message}</p>
      )}
      {error && (
        <p className="text-[11px] text-red-600">{error}</p>
      )}
    </div>
  );
}
