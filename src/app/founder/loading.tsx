import { Loader2 } from "lucide-react";

export default function FounderLoading() {
  return (
    <div className="grid min-h-[42vh] place-items-center px-4 py-8">
      <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <h2 className="mt-5 text-lg font-black text-slate-950">
          Chargement de l’espace fondateur
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Préparation des indicateurs, écoles et données financières.
        </p>
      </div>
    </div>
  );
}
