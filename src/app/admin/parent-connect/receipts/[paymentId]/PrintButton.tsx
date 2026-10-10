"use client";
export default function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Imprimer le reçu</button>;
}
