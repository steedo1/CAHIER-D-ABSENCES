"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Imprimer les avis affichés" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700"
    >
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
