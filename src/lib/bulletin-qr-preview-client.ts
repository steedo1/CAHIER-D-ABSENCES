type PreviewItem = {
  qr_token?: string | null;
  qr_code?: string | null;
  official_document_source_id?: string | null;
  official_document_number?: string | null;
  official_issue_id?: string | null;
};

const pending = new Map<string, Promise<PreviewItem[]>>();

/** Appeler uniquement depuis une ouverture d'aperçu demandée par l'utilisateur. */
export async function prepareBulletinQrPreview<T extends { items: PreviewItem[]; official_snapshot_locked?: boolean }>(
  bulletin: T,
  online: boolean,
  request: typeof fetch = fetch,
): Promise<T> {
  if (!Array.isArray(bulletin.items)) return bulletin;
  const missing = bulletin.items.filter((item) => item.qr_token && !item.qr_code);
  if (!online || !missing.length) return bulletin;
  const prepared: PreviewItem[] = [];
  for (let start = 0; start < missing.length; start += 50) {
    const body = JSON.stringify({ action: "prepare_preview_qr",
      tokens: missing.slice(start, start + 50).map((item) => item.qr_token) });
    let operation = pending.get(body);
    if (!operation) {
      operation = (async () => {
        const response = await request("/api/admin/grades/bulletin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "same-origin", cache: "no-store", body,
        });
        const result = await response.json();
        if (!response.ok || !result.ok || !Array.isArray(result.items)) {
          throw new Error("Impossible de préparer les QR lisibles. Réessayez en ligne.");
        }
        return result.items as PreviewItem[];
      })();
      pending.set(body, operation);
    }
    try { prepared.push(...await operation); }
    finally { if (pending.get(body) === operation) pending.delete(body); }
  }
  const bySource = new Map(prepared.map((item) => [item.official_document_source_id, item]));
  for (const item of missing) {
    const fresh = bySource.get(item.official_document_source_id);
    if (!fresh?.qr_code || fresh.qr_token) {
      throw new Error("La préparation du QR est incomplète. Réessayez en ligne.");
    }
  }
  return { ...bulletin, items: bulletin.items.map((item) => {
    const fresh = bySource.get(item.official_document_source_id);
    if (!fresh) return item;
    return { ...item, ...fresh,
      ...(bulletin.official_snapshot_locked || item.official_issue_id
        ? { official_document_number: item.official_document_number } : {}),
    };
  }) };
}
