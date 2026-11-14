"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CARD_PDF_BATCH, CARD_SLOTS, schoolCardClasses, type CardRoster, type CardSlot } from "@/lib/school-cards";
import { ORDER_LABELS, type ProductionOrder } from "@/lib/production-nexa";
import { CardPreview, productionDate, productionRequest } from "@/components/production-nexa/shared";

const button = "rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const slotNames = { general: "Responsable de l’établissement", french: "Direction de l’enseignement français", arabic: "Direction de l’enseignement arabe" };
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw Error(String(body.error || "Opération impossible").replaceAll("_", " "));
  return body;
}
export default function SchoolCardsWorkspace() {
  const [roster, setRoster] = useState<CardRoster | null>(null), [year, setYear] = useState("");
  const [query, setQuery] = useState(""), [level, setLevel] = useState("");
  const [classes, setClasses] = useState<string[]>([]), [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [preview, setPreview] = useState<{ front: string; back: string } | null>(null);
  const previewCache = useRef(new Map<string, { front: string; back: string }>());
  const [preparedIds, setPreparedIds] = useState<Set<string>>(new Set());
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [nextOrderPage, setNextOrderPage] = useState<number | null>(null);
  const [upload, setUpload] = useState<File | null>(null), [originalPreview, setOriginalPreview] = useState("");
  const [slot, setSlot] = useState<CardSlot>("general"), [kind, setKind] = useState<"signature" | "stamp">("signature"), [removeBackground, setRemoveBackground] = useState(false), [tolerance, setTolerance] = useState(24), [crop, setCrop] = useState(true);
  const [processedPreview, setProcessedPreview] = useState(""), [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setLoading(true); setError(""); setSelected(new Set()); setPreview(null); previewCache.current.clear(); setOrders([]); setNextOrderPage(null); setPreparedIds(new Set());
    setClasses([]); setLevel("");
    (async () => {
      let offset: number | null = 0, combined: CardRoster | null = null;
      do {
        const data: CardRoster = await jsonRequest(`/api/admin/school-cards?year=${encodeURIComponent(year)}&offset=${offset}`, { signal: controller.signal });
        const previous = combined as CardRoster | null;
        combined = previous ? { ...previous, items: [...previous.items, ...data.items], nextOffset: data.nextOffset,
          preparedIds: [...(previous.preparedIds ?? []), ...(data.preparedIds ?? [])] } : data;
        offset = data.nextOffset;
      } while (offset !== null);
      if (current && combined) { setRoster(combined); setPreparedIds(new Set(combined.preparedIds)); }
    })().catch(e => { if (current && e.name !== "AbortError") { setError(e.message); setRoster(null); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [year, refresh]);
  useEffect(() => {
    if (!upload) { setOriginalPreview(""); return; }
    const url = URL.createObjectURL(upload); setOriginalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [upload]);
  useEffect(() => { setProcessedPreview(""); setAuthorized(false); }, [upload, removeBackground, tolerance, crop, slot, kind]);

  const visible = useMemo(() => (roster?.items || []).filter(row =>
    schoolCardClasses(row).some(classe => (!classes.length || classes.includes(classe.id)) && (!level || classe.level === level)) &&
    `${row.name} ${row.matricule}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))), [roster, classes, level, query]);
  const chosen = useMemo(() => (roster?.items || []).filter(row => selected.has(row.enrollmentId)), [roster, selected]);
  const selectedCard = chosen.find(row => !row.revoked);
  const validSelection = chosen.length > 0 && chosen.every(row => !row.revoked);
  async function loadOrders(orderYear: string, offset = 0) {
    const payload = await productionRequest<{ orders: ProductionOrder[]; nextOffset: number | null }>(
      `/api/admin/school-cards/orders?year=${encodeURIComponent(orderYear)}&offset=${offset}`,
    );
    setOrders(previous => offset ? [...previous, ...payload.orders] : payload.orders);
    setNextOrderPage(payload.nextOffset);
  }
  async function showPreview() {
    if (!selectedCard || !roster) return;
    const key = selectedCard.studentId;
    const cached = previewCache.current.get(key);
    if (cached) { setPreview(cached); return; }
    const image = await productionRequest<{ front: string; back: string }>("/api/admin/school-cards",
      { action: "preview", year: roster.year, studentId: key });
    if (previewCache.current.size >= 12) previewCache.current.clear();
    previewCache.current.set(key, image);
    setPreview(image);
  }
  async function submit(action: "prepare" | "order") {
    if (!roster || !validSelection) return;
    const { count } = await productionRequest<{ count: number }>("/api/admin/school-cards/orders",
      { action, year: roster.year, studentIds: chosen.map(card => card.studentId) });
    setPreparedIds(previous => new Set([...previous, ...chosen.map(card => card.studentId)]));
    if (action === "order") await loadOrders(roster.year);
    setStatus(action === "order" ? `Commande transmise · ${count} carte(s).` : `${count} carte(s) préparée(s) pour Production Nexa.`);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Opération impossible"); } finally { setBusy(false); }
  }
  async function changeRevocation(revoked: boolean) {
    if (!roster) return;
    const enrollmentIds = [...new Set(chosen.map(card => card.enrollmentId))];
    for (let start = 0; start < enrollmentIds.length; start += CARD_PDF_BATCH) {
      await jsonRequest("/api/admin/school-cards/revoke", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: roster.year, enrollmentIds: enrollmentIds.slice(start, start + CARD_PDF_BATCH), revoked }),
      });
    }
    setRefresh(value => value + 1);
    setStatus(revoked ? "Cartes sélectionnées invalidées." : "Cartes sélectionnées réactivées.");
  }
  async function saveOptions(automaticSignature: boolean, enabled: boolean) {
    if (!roster) return;
    await jsonRequest("/api/admin/school-cards/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: roster.revision, automaticSignature, enabled }) });
    setRefresh(value => value + 1); setStatus("Configuration enregistrée. Les autres documents conservent leurs paramètres.");
  }
  async function signatureAction(action: "preview" | "save") {
    if (!upload || !roster) return;
    const form = new FormData(); form.set("file", upload); form.set("slot", slot); form.set("kind", kind); form.set("action", action);
    form.set("removeBackground", String(removeBackground)); form.set("tolerance", String(tolerance)); form.set("crop", String(crop));
    form.set("revision", String(roster.revision)); form.set("authorized", String(authorized));
    const result = await jsonRequest("/api/admin/school-cards/signature", { method: "POST", body: form });
    if (action === "preview") setProcessedPreview(result.preview);
    else { setUpload(null); setProcessedPreview(""); setRefresh(value => value + 1); setStatus(kind === "stamp" ? "Cachet enregistré." : "Signature enregistrée."); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 p-4 text-slate-900 md:p-7">
    <header className="rounded-3xl bg-emerald-950 p-6 text-white"><p className="text-xs uppercase tracking-[.2em] text-emerald-200">Administration & services</p><h1 className="mt-2 text-3xl font-semibold">Cartes scolaires</h1><p className="mt-2 text-sm text-emerald-100">Recto verso · Format 85,6 × 54 mm</p></header>
    <div role="status" aria-live="polite">{loading ? "Chargement des élèves…" : status}</div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {roster && <>
      <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="font-semibold">{roster.school.name}</h2>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-sm">Année scolaire<select aria-label="Année scolaire" className={input} value={roster.year} disabled={busy || loading} onChange={e => setYear(e.target.value)}>{roster.years.map(y => <option key={y.code}>{y.code}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Recherche<input className={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom ou matricule" /></label>
          <label className="grid gap-1 text-sm">Niveau<select className={input} value={level} onChange={e => setLevel(e.target.value)}><option value="">Tous</option>{[...new Set(roster.classes.map(classe => classe.level))].filter(Boolean).sort().map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Classes (sélection multiple)<select className={input} multiple size={3} value={classes} onChange={e => setClasses(Array.from(e.target.selectedOptions).map(option => option.value))}>{roster.classes.map(row => <option value={row.id} key={row.id}>{row.label}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={busy} onClick={() => setSelected(new Set(visible.map(row => row.enrollmentId)))}>Sélectionner les résultats ({visible.length})</button><button className={input} disabled={busy} onClick={() => setSelected(new Set(roster.items.map(row => row.enrollmentId)))}>Tout l’établissement ({roster.items.length})</button><button className={input} onClick={() => setSelected(new Set())}>Effacer la sélection</button><strong>{chosen.length} sélectionnée(s)</strong></div>
        {!loading && visible.length === 0 && <p className="text-sm text-slate-600">Aucun élève ne correspond aux filtres.</p>}
        <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Choix</th><th>Élève</th><th>Matricule</th><th>Classes</th><th>Contrôle</th></tr></thead><tbody>{visible.map(row => <tr key={row.enrollmentId} className="border-b"><td className="p-2"><input type="checkbox" aria-label={`Sélectionner ${row.name} ${row.classLabel}`} checked={selected.has(row.enrollmentId)} onChange={e => setSelected(previous => { const next = new Set(previous); e.target.checked ? next.add(row.enrollmentId) : next.delete(row.enrollmentId); return next; })} /></td><td className="py-3 font-medium">{row.name}</td><td>{row.matricule || "—"}</td><td>{schoolCardClasses(row).map(classe => <div key={classe.id}><bdi>{classe.label}</bdi></div>)}</td><td className={row.revoked ? "text-red-700" : "text-amber-800"}>{row.revoked ? "Carte invalidée" : row.warnings.join(" · ") || "Informations complètes"}{preparedIds.has(row.studentId) && !row.revoked && <div className="text-emerald-800">Préparée</div>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Préparer et commander</h2>
        <div className="flex flex-wrap gap-3">
          <button className={input} disabled={busy || loading || !selectedCard || !roster.configuration.enabled} onClick={() => run(showPreview)}>Aperçu recto verso</button>
          <button className={input} disabled={busy || loading || !validSelection || !roster.configuration.enabled} onClick={() => run(() => submit("prepare"))}>Enregistrer la préparation</button>
          <button className={button} disabled={busy || loading || !validSelection || !roster.configuration.enabled}
            onClick={() => { if (window.confirm(`Transmettre une commande pour ${chosen.length} carte(s) à Nexa Digital ?`)) void run(() => submit("order")); }}>Commander les cartes</button>
        </div>
        {preview && <CardPreview {...preview} />}
      </section>
      <section className="space-y-4 rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Suivi des commandes</h2>
          <button className={input} disabled={busy || loading} onClick={() => run(() => loadOrders(roster.year))}>Afficher les commandes</button>
        </div>
        {orders.map(order => <div key={order.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <span>{productionDate(order.created_at)} · {order.student_ids.length} carte(s) · {order.id.slice(0, 8)}</span>
          <strong>{ORDER_LABELS[order.status]}</strong>
        </div>)}
        {nextOrderPage !== null && <button className={input} disabled={busy || loading} onClick={() => run(() => loadOrders(roster.year, nextOrderPage))}>Commandes suivantes</button>}
      </section>
      {roster.canConfigure && <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Paramètres réservés à la direction</h2>
        <div className="flex flex-wrap gap-4"><label><input type="checkbox" disabled={busy} checked={roster.configuration.automaticSignature} onChange={e => run(() => saveOptions(e.target.checked, roster.configuration.enabled))} /> Signature/cachet automatiques sur les cartes</label><label><input type="checkbox" disabled={busy} checked={roster.configuration.enabled} onChange={e => run(() => saveOptions(roster.configuration.automaticSignature, e.target.checked))} /> Création des cartes active</label></div>
        <p className="text-sm text-slate-600">Cette autorisation concerne les cartes scolaires. Les bulletins, attestations et autres documents conservent leur circuit actuel. L’image apposée n’est pas une signature électronique certifiée.</p>
        <fieldset disabled={busy || loading} className="space-y-4">
          <div className="flex flex-wrap gap-4"><label className="grid gap-1 text-sm">Responsable<select className={input} value={slot} onChange={e => { setSlot(e.target.value as CardSlot); setUpload(null); }}>{CARD_SLOTS.map(value => <option key={value} value={value}>{slotNames[value]}</option>)}</select></label><label className="grid gap-1 text-sm">Type de visuel<select className={input} value={kind} onChange={e => { setKind(e.target.value as "stamp" | "signature"); setUpload(null); }}><option value="stamp">Cachet</option><option value="signature">Signature</option></select></label><label className="grid gap-1 text-sm">{kind === "stamp" ? "Image du cachet" : "Image de la signature"} (JPG/PNG, 5 Mo maximum)<input key={`${slot}-${kind}-${roster.revision}`} type="file" accept="image/jpeg,image/png" onChange={e => setUpload(e.target.files?.[0] || null)} /></label></div>
          <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={removeBackground} onChange={e => setRemoveBackground(e.target.checked)} /> Supprimer le fond uni</label><label><input type="checkbox" checked={crop} onChange={e => setCrop(e.target.checked)} /> Recadrer les marges transparentes</label><label>Tolérance <input type="range" min="0" max="100" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} /> {tolerance}</label></div>
          <button className={button} disabled={busy || !upload} onClick={() => run(() => signatureAction("preview"))}>Voir le résultat avant validation</button>
          {processedPreview && <><div className="flex flex-wrap gap-5">{originalPreview && <figure><img alt="Original à conserver" className="h-32 max-w-xs object-contain" src={originalPreview} /><figcaption className="text-xs">Original</figcaption></figure>}<figure><img alt="Résultat à valider" className="h-32 max-w-xs border bg-slate-100 object-contain" src={processedPreview} /><figcaption className="text-xs">Résultat proposé — ajustez si des détails manquent</figcaption></figure></div><label className="block text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} /> Je confirme l’autorisation de l’établissement et la fidélité de cette image.</label><button className={button} disabled={busy || !authorized} onClick={() => run(() => signatureAction("save"))}>Valider et conserver l’image</button></>}
        </fieldset>
        <div className="flex flex-wrap gap-3 border-t pt-4">
          <button className={input} disabled={busy || !chosen.length} onClick={() => run(() => changeRevocation(true))}>Invalider les cartes sélectionnées</button>
          <button className={input} disabled={busy || !chosen.length} onClick={() => run(() => changeRevocation(false))}>Réactiver les cartes sélectionnées</button>
        </div>
      </section>}
    </>}
  </main>;
}
