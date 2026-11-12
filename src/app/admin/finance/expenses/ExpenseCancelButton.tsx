"use client";

import { useFormStatus } from "react-dom";

export function ExpenseCancelButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (
          !window.confirm(
            "Annuler cette dépense ? Elle sera exclue des montants validés, conservée dans l’historique, puis vous pourrez corriger et ressaisir le poste."
          )
        ) {
          event.preventDefault();
        }
      }}
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Annulation en cours…" : "Annuler et ressaisir"}
    </button>
  );
}
