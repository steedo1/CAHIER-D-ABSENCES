type AiRequestOptions = RequestInit & {
  timeoutMs?: number;
  timeoutMessage?: string;
};

/** Bound both the request and its JSON body, including on an unstable connection. */
export async function fetchAiJson<T>(url: string, options: AiRequestOptions = {}): Promise<T> {
  const {
    timeoutMs = 15_000,
    timeoutMessage = "La préparation prend trop de temps. Réessaie dans un instant.",
    signal,
    ...init
  } = options;
  if (signal?.aborted) throw new DOMException("Requête annulée", "AbortError");

  const controller = new AbortController();
  let rejectRequest: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
  const cancel = () => {
    rejectRequest(new DOMException("Requête annulée", "AbortError"));
    controller.abort();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    rejectRequest(new Error(timeoutMessage));
    controller.abort();
  }, timeoutMs);

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
          if (response.status === 401) throw new Error("Ta session a expiré. Reconnecte-toi pour utiliser Cahier IA.");
          if (response.status === 403) throw new Error("Ce compte n’a pas accès à Cahier IA.");
          if (response.status === 429) throw new Error("Le service est très sollicité. Réessaie dans un instant.");
          const message = typeof data?.message === "string" ? data.message : data?.error;
          throw new Error(typeof message === "string" ? message : "Le service est momentanément indisponible. Réessaie dans un instant.");
        }
        return data as T;
      })(),
      interrupted,
    ]);
  } catch (error: unknown) {
    if (error instanceof TypeError) throw new Error("La connexion a été interrompue. Vérifie Internet puis réessaie.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Analyze the current period rather than an empty future end-of-year bulletin. */
export function referenceDateForAcademicYear(
  year: { start_date?: string | null; end_date?: string | null },
  today = new Date().toISOString().slice(0, 10),
): string {
  const start = year.start_date?.slice(0, 10);
  const end = year.end_date?.slice(0, 10);
  if (start && today < start) return start;
  if (end && today > end) return end;
  return today;
}
