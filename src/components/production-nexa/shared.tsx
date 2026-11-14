export const primary = "rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-950 disabled:opacity-45";
export const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50";
export const surface = "space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5";
export const productionDate = (value: string) => new Intl.DateTimeFormat("fr-CI", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Abidjan",
}).format(new Date(value));

export async function productionRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store", signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(String(data.error || "Opération indisponible").replaceAll("_", " "));
  return data;
}

export function CardPreview({ front, back }: { front: string; back: string }) {
  return <div className="grid max-w-5xl gap-3 sm:grid-cols-2">
    <img className="w-full max-w-[480px] rounded-lg border" src={front} alt="Aperçu recto filigrané" />
    <img className="w-full max-w-[480px] rounded-lg border" src={back} alt="Aperçu verso filigrané" />
  </div>;
}
