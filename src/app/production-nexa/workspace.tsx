"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardPreview, field, primary, productionDate, productionRequest, surface } from "@/components/production-nexa/shared";
import { ORDER_LABELS, ORDER_TRANSITIONS, PDF_BATCH_SIZE, PRODUCTION_EVENT_LABELS, productionUpload, type OrderStatus,
  type ProductionArchive, type ProductionEvent, type ProductionOrder } from "@/lib/production-nexa";
import { schoolCardClasses, type CardClass, type CardSchool, type CardSlot, type CardYear,
  type PreparedCard, type SchoolCard } from "@/lib/school-cards";

const api = "/api/production-nexa";
type School = { id: string; name: string; code: string | null };
type Capabilities = { canOrder: boolean; canGenerate: boolean; canDownload: boolean };
type CardData = { items: SchoolCard[]; classes: CardClass[]; preparedIds: string[] } & Capabilities;
type View = "cards" | "orders" | "archives";
type Layout = { format: "pvc" | "a4"; flip: "long" | "short" };
type Pending = { payload: Blob; ticket: string; ids: string[] };
type ProductionAssets = { school: CardSchool; signatures: Partial<Record<CardSlot, string>>; stamps: Partial<Record<CardSlot, string>> };
type GenerationResponse = { archive: ProductionArchive } | (Partial<ProductionAssets> & { items: PreparedCard[]; ticket: string; visualRevision: number });

const tabs: Record<View, string> = { cards: "Cartes", orders: "Commandes", archives: "Archives" };

export default function ProductionWorkspace() {
  const [schools, setSchools] = useState<School[]>([]);
  const [years, setYears] = useState<CardYear[]>([]);
  const [school, setSchool] = useState(""), [year, setYear] = useState("");
  const [view, setView] = useState<View>("cards");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [cards, setCards] = useState<CardData | null>(null);
  const [orders, setOrders] = useState<ProductionOrder[]>([]), [archives, setArchives] = useState<ProductionArchive[]>([]);
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [query, setQuery] = useState(""), [classId, setClassId] = useState(""), [preparation, setPreparation] = useState("ready");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<Layout>({ format: "pvc", flip: "long" });
  const [allowMissing, setAllowMissing] = useState(false);
  const [preview, setPreview] = useState<{ front: string; back: string } | null>(null);
  const [history, setHistory] = useState<{ id: string; events: ProductionEvent[]; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const pending = useRef<Pending | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const scope = `school=${encodeURIComponent(school)}&year=${encodeURIComponent(year)}`;

  useEffect(() => {
    const controller = new AbortController();
    async function readSchools() {
      const result: School[] = [];
      for (let offset: number | null = 0; offset !== null;) {
        const page: { schools: School[]; nextOffset: number | null } = await productionRequest(`${api}?offset=${offset}`, undefined, controller.signal);
        result.push(...page.schools); offset = page.nextOffset;
      }
      if (!controller.signal.aborted) setSchools(result);
    }
    void readSchools().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!school) return;
    const controller = new AbortController();
    void productionRequest<{ years: CardYear[] }>(`${api}?school=${school}&view=years`, undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setYears(result.years);
        setYear(result.years.find(item => item.is_current)?.code ?? result.years[0]?.code ?? "");
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [school]);

  useEffect(() => {
    if (!school || !year) return;
    const controller = new AbortController();
    setLoading(true);
    const url = `${api}?${scope}&view=${view}`;
    async function load() {
      if (view === "cards") {
        let result: CardData | undefined;
        for (let offset: number | null = 0; offset !== null;) {
          const page: CardData & { nextOffset: number | null } = await productionRequest(`${url}&offset=${offset}`, undefined, controller.signal);
          if (!result) result = page;
          else { result.items.push(...page.items); result.preparedIds.push(...page.preparedIds); }
          offset = page.nextOffset;
        }
        if (!controller.signal.aborted && result) { setCards(result); setCapabilities(result); }
      } else if (view === "orders") {
        const page = await productionRequest<{ orders: ProductionOrder[]; nextOffset: number | null } & Capabilities>(url, undefined, controller.signal);
        if (!controller.signal.aborted) { setOrders(page.orders); setNextPage(page.nextOffset); setCapabilities(page); }
      } else {
        const page = await productionRequest<{ archives: ProductionArchive[]; nextOffset: number | null } & Capabilities>(url, undefined, controller.signal);
        if (!controller.signal.aborted) { setArchives(page.archives); setNextPage(page.nextOffset); setCapabilities(page); }
      }
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [school, year, scope, view]);

  const prepared = useMemo(() => new Set(cards?.preparedIds), [cards]);
  const orderStudents = useMemo(() => order ? new Set(order.student_ids) : null, [order]);
  const rows = useMemo(() => (cards?.items ?? []).filter(card => {
    const classes = schoolCardClasses(card);
    return (!orderStudents || orderStudents.has(card.studentId)) && (!classId || classes.some(classe => classe.id === classId)) &&
      (preparation === "all" || (preparation === "ready" ? prepared.has(card.studentId) : !prepared.has(card.studentId))) &&
      [card.name, card.matricule, ...classes.map(classe => classe.label)].join(" ").toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"));
  }), [cards, classId, orderStudents, preparation, prepared, query]);
  // Preparing a card is the first production step; unprepared pupils must be selectable.
  const isSelectable = (card: SchoolCard) => !card.revoked;
  const pendingPreparationIds = useMemo(() => [...selected].filter(id => !prepared.has(id)), [selected, prepared]);
  const canGenerateSelected = selected.size > 0 && pendingPreparationIds.length === 0;
  const batchLocked = busy || canRetry;

  function toggleSelection(id: string, checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function resetScope() {
    setCards(null); setCapabilities(null); setOrders([]); setArchives([]); setNextPage(null); setLoading(false);
    setOrder(null); setHistory(null); setPreview(null); setSelected(new Set()); setClassId(""); setQuery(""); setError(""); setStatus("");
  }
  function changeView(next: View, nextOrder: ProductionOrder | null = null) {
    setView(next); setOrder(nextOrder); setPreview(null); setHistory(null); setQuery(""); setClassId("");
    setRecordsForView(next); setNextPage(null); setSelected(new Set());
  }
  function setRecordsForView(next: View) {
    if (next !== view && next === "orders") setOrders([]);
    if (next !== view && next === "archives") setArchives([]);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function more() {
    const url = `${api}?${scope}&view=${view}&offset=${nextPage}`;
    if (view === "orders") {
      const data = await productionRequest<{ orders: ProductionOrder[]; nextOffset: number | null }>(url);
      setOrders(previous => [...previous, ...data.orders]); setNextPage(data.nextOffset);
    } else if (view === "archives") {
      const data = await productionRequest<{ archives: ProductionArchive[]; nextOffset: number | null }>(url);
      setArchives(previous => [...previous, ...data.archives]); setNextPage(data.nextOffset);
    }
  }
  async function updateStatus(item: ProductionOrder, status: OrderStatus) {
    const data = await productionRequest<{ order: ProductionOrder }>(api,
      { action: "orderStatus", school, year, orderId: item.id, status, revision: item.revision });
    setOrders(previous => previous.map(row => row.id === item.id ? data.order : row));
  }
  async function prepareSelection() {
    if (!pendingPreparationIds.length) return;
    const ids = [...pendingPreparationIds];
    const result = await productionRequest<{ count: number }>(api, {
      action: "prepare", school, year, studentIds: ids,
    });
    setCards(previous => previous ? {
      ...previous, preparedIds: [...new Set([...previous.preparedIds, ...ids])],
    } : previous);
    setPreparation("ready");
    setStatus(result.count + " carte(s) préparée(s). Vous pouvez maintenant générer les PDF.");
  }
  async function inspect(studentId: string) {
    setPreview(await productionRequest(`${api}/preview`, { school, year, studentId }));
  }
  async function showHistory(id: string, offset = 0) {
    const data = await productionRequest<{ history: ProductionEvent[]; nextOffset: number | null }>(
      `${api}?${scope}&view=history&id=${id}&offset=${offset}`,
    );
    setHistory(previous => ({ id, events: offset && previous?.id === id ? [...previous.events, ...data.history] : data.history, next: data.nextOffset }));
  }
  async function upload() {
    if (!pending.current) return;
    const { ticket, payload, ids } = pending.current;
    const response = await fetch(`${api}/archive`, { method: "POST", cache: "no-store", body: payload,
      headers: { "Content-Type": payload.type, "X-Nexa-Production-Ticket": ticket } });
    const data = await response.json() as { archive?: ProductionArchive; error?: string };
    if (!response.ok || !data.archive) throw Error((data.error ?? "Archivage indisponible").replaceAll("_", " "));
    const archived = data.archive;
    pending.current = null; setCanRetry(false);
    setArchives(previous => [archived, ...previous.filter(item => item.id !== archived.id)]);
    setSelected(previous => {
      const next = new Set(previous);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }
  async function generate(old?: ProductionArchive) {
    const ids = old?.student_ids || [...selected];
    const options: Layout = old ? { format: old.format, flip: old.flip } : layout;
    const { exportSchoolCardPdf } = await import("@/lib/school-card-export");
    let assets: (ProductionAssets & { revision: number }) | undefined;
    let visualSlots: CardSlot[] = [];
    const sortedIds = [...ids].sort();
    let reused = 0;
    const total = Math.ceil(sortedIds.length / PDF_BATCH_SIZE);
    for (let batch = 0; batch < total; batch += 1) {
      setStatus(`Archivage du lot ${batch + 1} sur ${total}…`);
      const batchIds = sortedIds.slice(batch * PDF_BATCH_SIZE, (batch + 1) * PDF_BATCH_SIZE);
      const data: GenerationResponse = await productionRequest(api, {
        action: "generation", school, year, ...options, previousId: old?.id ?? null,
        orderId: old ? old.order_id : order?.id ?? null, allowMissing, visualRevision: assets?.revision, visualSlots,
        studentIds: batchIds,
      });
      if ("archive" in data) {
        reused += 1;
        setSelected(previous => {
          const next = new Set(previous);
          batchIds.forEach(id => next.delete(id));
          return next;
        });
        continue;
      }
      if (data.school) {
        assets = { school: data.school, signatures: {}, stamps: {}, revision: data.visualRevision };
        visualSlots = [];
      }
      if (!assets || assets.revision !== data.visualRevision) throw Error("Visuels de production indisponibles.");
      Object.assign(assets.signatures, data.signatures);
      Object.assign(assets.stamps, data.stamps);
      visualSlots = [...new Set([...visualSlots, ...data.items.flatMap(item => item.signatureSlot ? [item.signatureSlot] : [])])];
      const { blob, missing } = await exportSchoolCardPdf(data.items, assets.school, assets.signatures,
        { individual: options.format === "pvc", flip: options.flip, stamps: assets.stamps });
      if (missing.length) throw Error(`Images indisponibles. Relancez après vérification. ${missing.join(", ")}`);
      const payload = productionUpload(blob, data.items.map(item => ({ id: item.studentId, name: item.name, matricule: item.matricule })));
      pending.current = { payload, ticket: data.ticket, ids: old ? [] : data.items.map(item => item.studentId) };
      setCanRetry(true);
      await upload();
    }
    setStatus(`${ids.length} carte(s) dans ${total} fichier(s) PDF${reused ? `, dont ${reused} déjà archivé(s)` : ""}.`);
    if (!old) changeView("archives");
  }
  async function download(item: ProductionArchive) {
    // The authenticated endpoint audits each download.
    const response = await fetch(`${api}/archive/${item.id}?school=${school}`, { cache: "no-store" });
    if (!response.ok) {
      const data = await response.json();
      throw Error(String(data.error || "PDF indisponible").replaceAll("_", " "));
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `Cartes-${item.academic_year}-v${item.version}-${item.id.slice(0, 8)}.pdf`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-5">
    <section className={surface}>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm">Établissement<select className={field} value={school} disabled={batchLocked} onChange={e => {
          resetScope(); setYears([]); setYear(""); setSchool(e.target.value);
        }}><option value="">Choisir un établissement</option>
          {schools.map(item => <option key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ""}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm">Année scolaire<select className={field} value={year} disabled={batchLocked || !years.length} onChange={e => {
          resetScope(); setYear(e.target.value);
        }}><option value="">Choisir une année</option>{years.map(item => <option key={item.code}>{item.code}</option>)}</select></label>
      </div>
      {year && <nav aria-label="Production Nexa" className="flex flex-wrap gap-2">{(Object.keys(tabs) as View[]).map(key =>
        <button key={key} className={key === view ? primary : field} aria-pressed={key === view} disabled={batchLocked}
          onClick={() => { if (key !== view) changeView(key); }}>{tabs[key]}</button>)}</nav>}
    </section>
    <div role="status" aria-live="polite">{loading ? "Chargement…" : status}</div>
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">{error}</p>}
    {canRetry && <div className={surface}>
      <p>Un PDF a été assemblé. Vous pouvez reprendre son archivage sans régénérer les cartes.</p>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy} onClick={() => run(async () => {
          await upload(); setStatus("PDF archivé. Les autres cartes sélectionnées restent disponibles.");
        })}>Reprendre l’archivage</button>
        <button className={field} disabled={busy} onClick={() => { pending.current = null; setCanRetry(false); }}>Abandonner ce fichier</button>
      </div>
    </div>}
    {year && view === "cards" && cards && <section className={surface}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{order ? `Commande ${order.id.slice(0, 8)} · ${ORDER_LABELS[order.status]}` : "Cartes de l’établissement"}</h2>
        {order && <button className={field} disabled={batchLocked} onClick={() => changeView("orders")}>Retour aux commandes</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-sm">Recherche<input className={field + " w-full min-w-0"} placeholder="Nom, matricule ou classe" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label className="grid min-w-0 gap-1 text-sm">Classe<select className={field + " w-full min-w-0"} value={classId} onChange={e => setClassId(e.target.value)}>
          <option value="">Toutes</option>{cards.classes.map(classe => <option key={classe.id} value={classe.id}>{classe.label}</option>)}
        </select></label>
        <label className="grid min-w-0 gap-1 text-sm">Préparation<select className={field + " w-full min-w-0"} value={preparation} onChange={e => setPreparation(e.target.value)}>
          <option value="ready">Préparées</option><option value="missing">À préparer</option><option value="all">Toutes</option>
        </select></label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={field} disabled={batchLocked || loading} onClick={() => setSelected(new Set(rows.filter(isSelectable).map(row => row.studentId)))}>Sélectionner les résultats</button>
        <button className={field} disabled={batchLocked || loading} onClick={() => setSelected(new Set(cards.items
          .filter(row => isSelectable(row) && (!orderStudents || orderStudents.has(row.studentId))).map(row => row.studentId)))}>Toutes les cartes préparées</button>
        <button className={field} disabled={batchLocked || !selected.size} onClick={() => setSelected(new Set())}>Effacer</button>
        <span className="text-sm" aria-live="polite">{selected.size} sélectionnée(s){pendingPreparationIds.length > 0 ? " · " + pendingPreparationIds.length + " à préparer" : ""}</span>
      </div>
            <div className="grid max-h-[32rem] gap-2 overflow-y-auto md:hidden">
        {rows.map(row => {
          const available = !batchLocked && isSelectable(row);
          const checked = selected.has(row.studentId);
          return <article key={row.studentId} className={checked ? "rounded-xl border-2 border-emerald-700 bg-emerald-50 p-3" : "rounded-xl border border-slate-200 bg-white p-3"}>
            <label className={available ? "flex min-h-14 cursor-pointer items-start gap-3" : "flex min-h-14 cursor-not-allowed items-start gap-3 opacity-60"}>
              <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-emerald-700" aria-label={"Sélectionner " + row.name}
                disabled={!available} checked={checked} onChange={e => toggleSelection(row.studentId, e.target.checked)} />
              <span className="min-w-0 flex-1 text-sm">
                <strong className="block break-words text-base leading-6 text-slate-900"><bdi>{row.name}</bdi></strong>
                <span className="block text-slate-600">{row.matricule || "Sans matricule"}</span>
                <span className="block break-words text-slate-600">{schoolCardClasses(row).map(classe => classe.label).join(" · ")}</span>
              </span>
            </label>
            <div className="mt-2 flex items-start justify-between gap-3 border-t border-slate-100 pt-2 text-xs">
              <span className="min-w-0 text-slate-700">{row.revoked ? "Invalidée" : prepared.has(row.studentId) ? "Préparée" : "À préparer"}
                {row.warnings.length > 0 && <span className="block break-words text-amber-800">{row.warnings.join(" · ")}</span>}</span>
              <button type="button" className="shrink-0 rounded-lg px-3 py-2 font-semibold text-emerald-800 underline"
                disabled={batchLocked || row.revoked} onClick={() => run(() => inspect(row.studentId))}>Voir</button>
            </div>
          </article>;
        })}
      </div>
      <div className="hidden max-h-[28rem] overflow-auto md:block"><table className="min-w-[720px] w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Choix</th><th>Élève</th><th>Matricule</th><th>Classes</th><th>Statut</th><th>Aperçu</th></tr></thead>
        <tbody>{rows.map(row => <tr className={selected.has(row.studentId) ? "cursor-pointer border-b bg-emerald-50" : "cursor-pointer border-b"} key={row.studentId}
          onClick={event => {
            if ((event.target as HTMLElement).closest("input,button,a,label") || batchLocked || !isSelectable(row)) return;
            toggleSelection(row.studentId, !selected.has(row.studentId));
          }}>
          <td className="p-2"><label className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center"><input type="checkbox"
            className="h-6 w-6 accent-emerald-700" aria-label={"Sélectionner " + row.name}
            disabled={batchLocked || !isSelectable(row)} checked={selected.has(row.studentId)}
            onChange={e => toggleSelection(row.studentId, e.target.checked)} /></label></td>
          <td className="py-2 font-medium"><bdi>{row.name}</bdi></td><td>{row.matricule}</td>
          <td>{schoolCardClasses(row).map(classe => <div key={classe.id}><bdi>{classe.label}</bdi></div>)}</td>
          <td>{row.revoked ? "Invalidée" : prepared.has(row.studentId) ? "Préparée" : "À préparer"}{row.warnings.length > 0 && <div className="text-xs text-amber-800">{row.warnings.join(" · ")}</div>}</td>
          <td><button className="p-2 text-emerald-800 underline" disabled={batchLocked || row.revoked} onClick={() => run(() => inspect(row.studentId))}>Voir</button></td>
        </tr>)}</tbody>
      </table></div>
      {rows.length === 0 && !loading && <p>Aucune carte ne correspond aux filtres.</p>}
      {preview && <CardPreview {...preview} />}
      {cards.canGenerate && <div className="flex flex-wrap items-end gap-3 border-t pt-4">
        {pendingPreparationIds.length > 0 && <button className={primary} disabled={batchLocked || loading}
          onClick={() => run(prepareSelection)}>Préparer {pendingPreparationIds.length} carte(s) sélectionnée(s)</button>}
        <label className="grid gap-1 text-sm">Format PDF<select className={field} disabled={batchLocked} value={layout.format}
          onChange={e => setLayout(previous => ({ ...previous, format: e.target.value as Layout["format"] }))}>
          <option value="pvc">PVC, un recto et un verso par élève</option><option value="a4">Planche A4 recto verso</option>
        </select></label>
        {layout.format === "a4" && <label className="grid gap-1 text-sm">Retournement<select className={field} disabled={batchLocked}
          value={layout.flip} onChange={e => setLayout(previous => ({ ...previous, flip: e.target.value as Layout["flip"] }))}>
          <option value="long">Bord long</option><option value="short">Bord court</option>
        </select></label>}
        <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" disabled={batchLocked} checked={allowMissing} onChange={e => setAllowMissing(e.target.checked)} /> Autoriser les informations manquantes</label>
        <button className={primary} disabled={batchLocked || loading || !canGenerateSelected || Boolean(order && !ORDER_TRANSITIONS[order.status].length)}
          onClick={() => run(() => generate())}>Générer et archiver les PDF</button>
      </div>}
    </section>}
    {year && view === "orders" && <section className={surface}>
      <h2 className="text-lg font-semibold">Commandes des établissements</h2>
      {!orders.length && !loading && <p>Aucune commande.</p>}
      {orders.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <div><strong>{ORDER_LABELS[item.status]}</strong><p>{productionDate(item.created_at)} · {item.student_ids.length} carte(s) · {item.id.slice(0, 8)}</p></div>
        <div className="flex flex-wrap gap-2">
          <button className={field} disabled={batchLocked} onClick={() => { setPreparation("all"); changeView("cards", item); }}>Voir les cartes</button>
          {capabilities?.canOrder && ORDER_TRANSITIONS[item.status].length > 0 && <select aria-label="Changer le statut" className={field} disabled={batchLocked}
            value="" onChange={e => { const next = e.target.value as OrderStatus; if (next && (next !== "cancelled" ||
              window.confirm("Annuler cette commande ?"))) void run(() => updateStatus(item, next)); }}>
            <option value="">Changer le statut</option>{ORDER_TRANSITIONS[item.status].map(key => <option key={key} value={key}>{ORDER_LABELS[key]}</option>)}
          </select>}
        </div>
      </article>)}
    </section>}
    {year && view === "archives" && <section className={surface}>
      <h2 className="text-lg font-semibold">Archives PDF</h2>
      {!archives.length && !loading && <p>Aucune production archivée.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={batchLocked} checked={allowMissing} onChange={e => setAllowMissing(e.target.checked)} /> Autoriser les informations manquantes lors d’une régénération</label>
      {archives.map(item => <article key={item.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <p><strong>Version {item.version}</strong> · {item.student_ids.length} carte(s) · {item.format === "pvc" ? "PVC" : "A4"} · {productionDate(item.created_at)}</p>
        <p className="text-slate-600">Responsable {item.actor_name ?? item.actor_id}{item.order_id ? ` · Commande ${item.order_id.slice(0, 8)}` : ""}</p>
        <details><summary>Élèves concernés</summary><ul className="ml-5 list-disc">{item.students.map(student =>
          <li key={student.id}><bdi>{student.name}</bdi> · {student.matricule}</li>)}</ul></details>
        <div className="flex flex-wrap gap-2">
          {capabilities?.canDownload && <button className={primary} disabled={batchLocked} onClick={() => run(() => download(item))}>Télécharger le PDF</button>}
          <button className={field} disabled={batchLocked} onClick={() => run(() => showHistory(item.id))}>Historique</button>
          {capabilities?.canGenerate && !archives.some(candidate => candidate.previous_id === item.id) &&
            <button className={field} disabled={batchLocked} onClick={() => run(() => generate(item))}>Régénérer cette version</button>}
        </div>
        {history?.id === item.id && <div className="space-y-2 border-t pt-2">
          {history.events.map(event => <p key={event.id}>{productionDate(event.created_at)} · {PRODUCTION_EVENT_LABELS[event.action] ?? event.action} · {event.actor_id}</p>)}
          {history.next !== null && <button className={field} disabled={busy} onClick={() => run(() => showHistory(item.id, history.next!))}>Événements suivants</button>}
        </div>}
      </article>)}
    </section>}
    {view !== "cards" && nextPage !== null && <button className={field} disabled={batchLocked} onClick={() => run(more)}>Afficher la suite</button>}
  </div>;
}
