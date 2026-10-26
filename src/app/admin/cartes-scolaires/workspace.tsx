"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { documentNationalEmblem } from "@/lib/document-national-emblem";
import { CARD_PDF_BATCH, CARD_SLOTS, schoolCardMinistry, type CardRoster, type CardSlot, type PreparedCard } from "@/lib/school-cards";

const button = "rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const slotNames = { general: "Responsable de l’établissement", french: "Direction de l’enseignement français", arabic: "Direction de l’enseignement arabe" };
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw Error(String(body.error || "Opération impossible").replaceAll("_", " "));
  return body;
}
type PdfFile = { url: string; name: string; count: number };
export default function SchoolCardsWorkspace() {
  const [roster, setRoster] = useState<CardRoster | null>(null), [year, setYear] = useState("");
  const [query, setQuery] = useState(""), [level, setLevel] = useState(""), [track, setTrack] = useState("");
  const [classes, setClasses] = useState<string[]>([]), [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [preview, setPreview] = useState<PreparedCard | null>(null);
  const [files, setFiles] = useState<PdfFile[]>([]), [flip, setFlip] = useState<"long" | "short">("long"), [allowMissing, setAllowMissing] = useState(false);
  const prepared = useRef(new Map<string, PreparedCard>()), urls = useRef<string[]>([]);
  const signatureImages = useRef<CardRoster["signatureImages"]>({});
  const [upload, setUpload] = useState<File | null>(null), [originalPreview, setOriginalPreview] = useState("");
  const [slot, setSlot] = useState<CardSlot>("general"), [removeBackground, setRemoveBackground] = useState(false), [tolerance, setTolerance] = useState(24), [crop, setCrop] = useState(true);
  const [processedPreview, setProcessedPreview] = useState(""), [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setLoading(true); setError(""); setSelected(new Set()); setPreview(null); prepared.current.clear();
    setClasses([]); setLevel(""); setTrack("");
    (async () => {
      let offset: number | null = 0, combined: CardRoster | null = null;
      do {
        const data: CardRoster = await jsonRequest(`/api/admin/school-cards?year=${encodeURIComponent(year)}&offset=${offset}`, { signal: controller.signal });
        const previous = combined as CardRoster | null;
        combined = previous ? { ...previous, items: [...previous.items, ...data.items], nextOffset: data.nextOffset } : data;
        offset = data.nextOffset;
      } while (offset !== null);
      if (current && combined) { setRoster(combined); signatureImages.current = combined.signatureImages; }
    })().catch(e => { if (current && e.name !== "AbortError") { setError(e.message); setRoster(null); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [year, refresh]);
  useEffect(() => {
    if (!upload) { setOriginalPreview(""); return; }
    const url = URL.createObjectURL(upload); setOriginalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [upload]);
  useEffect(() => { setProcessedPreview(""); setAuthorized(false); }, [upload, removeBackground, tolerance, crop, slot]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const visible = useMemo(() => (roster?.items || []).filter(row =>
    (!classes.length || classes.includes(row.classId)) && (!level || row.level === level) && (!track || row.tracks.includes(track)) &&
    `${row.name} ${row.matricule}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))), [roster, classes, level, track, query]);
  const chosen = useMemo(() => (roster?.items || []).filter(row => selected.has(row.enrollmentId)), [roster, selected]);
  const warnings = chosen.filter(row => row.warnings.length);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Opération impossible"); } finally { setBusy(false); }
  }
  async function prepare(ids: string[]) {
    if (!roster) return [];
    const missing = ids.filter(id => !prepared.current.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const response = await jsonRequest("/api/admin/school-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: roster.year, enrollmentIds: missing.slice(i, i + 100) }) });
      response.items.forEach((row: PreparedCard) => prepared.current.set(row.enrollmentId, row));
      signatureImages.current = { ...signatureImages.current, ...response.signatureImages };
    }
    return ids.map(id => prepared.current.get(id)!);
  }
  async function exportPdfs(individual = false) {
    if (!roster) return;
    const cards = await prepare(chosen.map(row => row.enrollmentId));
    const { exportSchoolCardPdf } = await import("@/lib/school-card-export");
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; setFiles([]);
    for (let start = 0; start < cards.length; start += CARD_PDF_BATCH) {
      setStatus(`Préparation du PDF : ${start + 1} à ${Math.min(start + CARD_PDF_BATCH, cards.length)} sur ${cards.length}…`);
      const subset = cards.slice(start, start + CARD_PDF_BATCH);
      const { blob, missing } = await exportSchoolCardPdf(subset, roster.school, signatureImages.current, { individual, flip });
      const url = URL.createObjectURL(blob); urls.current.push(url);
      const name = `Cartes-${roster.year}-${start + 1}-${start + subset.length}.pdf`;
      setFiles(previous => [...previous, { url, name, count: subset.length }]);
      if (missing.length) setError(`Images non chargées : ${missing.join(", ")}. Rechargez les élèves avant de relancer l’export.`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    setStatus(`${cards.length} carte(s) préparée(s). Téléchargez ou ouvrez les PDF ci-dessous pour imprimer.`);
  }
  async function saveOptions(automaticSignature: boolean, enabled: boolean) {
    if (!roster) return;
    await jsonRequest("/api/admin/school-cards/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: roster.revision, automaticSignature, enabled }) });
    setRefresh(value => value + 1); setStatus("Configuration enregistrée. Les autres documents conservent leurs paramètres.");
  }
  async function signatureAction(action: "preview" | "save") {
    if (!upload || !roster) return;
    const form = new FormData(); form.set("file", upload); form.set("slot", slot); form.set("action", action);
    form.set("removeBackground", String(removeBackground)); form.set("tolerance", String(tolerance)); form.set("crop", String(crop));
    form.set("revision", String(roster.revision)); form.set("authorized", String(authorized));
    const result = await jsonRequest("/api/admin/school-cards/signature", { method: "POST", body: form });
    if (action === "preview") setProcessedPreview(result.preview);
    else { setUpload(null); setProcessedPreview(""); setRefresh(value => value + 1); setStatus("Image validée. L’original est conservé pour correction."); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 p-4 text-slate-900 md:p-7">
    <header className="rounded-3xl bg-emerald-950 p-6 text-white"><p className="text-xs uppercase tracking-[.2em] text-emerald-200">Administration & services</p><h1 className="mt-2 text-3xl font-semibold">Cartes scolaires</h1><p className="mt-2 text-sm text-emerald-100">Recto verso · Sans QR code · Format 85,6 × 54 mm</p></header>
    <div role="status" aria-live="polite">{loading ? "Chargement des élèves…" : status}</div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {roster && <>
      <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="font-semibold">{roster.school.name}</h2>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-sm">Année scolaire<select aria-label="Année scolaire" className={input} value={roster.year} disabled={busy || loading} onChange={e => setYear(e.target.value)}>{roster.years.map(y => <option key={y.code}>{y.code}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Recherche<input className={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom ou matricule" /></label>
          <label className="grid gap-1 text-sm">Niveau<select className={input} value={level} onChange={e => setLevel(e.target.value)}><option value="">Tous</option>{[...new Set(roster.items.map(row => row.level))].filter(Boolean).sort().map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Section<select className={input} value={track} onChange={e => setTrack(e.target.value)}><option value="">Toutes</option><option value="french">Française</option><option value="arabic">Arabe</option></select></label>
          <label className="grid gap-1 text-sm">Classes (sélection multiple)<select className={input} multiple size={3} value={classes} onChange={e => setClasses(Array.from(e.target.selectedOptions).map(option => option.value))}>{roster.classes.map(row => <option value={row.id} key={row.id}>{row.label}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={busy} onClick={() => setSelected(new Set(visible.map(row => row.enrollmentId)))}>Sélectionner les résultats ({visible.length})</button><button className={input} disabled={busy} onClick={() => setSelected(new Set(roster.items.map(row => row.enrollmentId)))}>Tout l’établissement ({roster.items.length})</button><button className={input} onClick={() => setSelected(new Set())}>Effacer la sélection</button><strong>{chosen.length} sélectionnée(s)</strong></div>
        <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Choix</th><th>Élève</th><th>Matricule</th><th>Classe</th><th>Contrôle</th></tr></thead><tbody>{visible.map(row => <tr key={row.enrollmentId} className="border-b"><td className="p-2"><input type="checkbox" aria-label={`Sélectionner ${row.name} ${row.classLabel}`} checked={selected.has(row.enrollmentId)} onChange={e => setSelected(previous => { const next = new Set(previous); e.target.checked ? next.add(row.enrollmentId) : next.delete(row.enrollmentId); return next; })} /></td><td className="py-3 font-medium">{row.name}</td><td>{row.matricule || "—"}</td><td>{row.classLabel}</td><td className={row.revoked ? "text-red-700" : "text-amber-800"}>{row.revoked ? "Carte invalidée" : row.warnings.join(" · ") || "Informations complètes"}</td></tr>)}</tbody></table></div>
      </section>
      <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Prévisualiser et imprimer</h2>
        <p className="text-sm">A4 : 2 colonnes × 5 cartes. Imprimez à <strong>100 % / taille réelle</strong>, sans ajustement. Faites d’abord un essai recto verso d’une feuille et mesurez une carte avant de lancer le lot.</p>
        <label className="flex items-center gap-2 text-sm">Retournement duplex<select className={input} value={flip} onChange={e => setFlip(e.target.value as "long" | "short")}><option value="long">Bord long (habituel)</option><option value="short">Bord court</option></select></label>
        {!!warnings.length && <label className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm"><input type="checkbox" checked={allowMissing} onChange={e => setAllowMissing(e.target.checked)} />J’accepte d’imprimer les {warnings.length} carte(s) dont des informations ou photos manquent.</label>}
        <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || !chosen.length || chosen.some(row => row.revoked)} onClick={() => run(async () => { const cards = await prepare([chosen[0].enrollmentId]); setPreview(cards[0]); })}>Aperçu recto verso</button><button className={button} disabled={busy || !chosen.length || chosen.some(row => row.revoked) || (!!warnings.length && !allowMissing)} onClick={() => run(() => exportPdfs())}>Générer les PDF A4 / Imprimer</button><button className={input} disabled={busy || chosen.length !== 1 || chosen[0]?.revoked || (!!warnings.length && !allowMissing)} onClick={() => run(() => exportPdfs(true))}>PDF individuel 85,6 × 54 mm</button></div>
        {preview && <div className="grid gap-4 xl:grid-cols-2">
          <div aria-label="Aperçu recto" className="relative aspect-[85.6/54] max-w-lg overflow-hidden rounded-2xl border bg-white p-[4%] shadow-md"><div className="grid grid-cols-[12%_1fr_12%] items-start gap-2"><div /><div className="text-center text-[10px] text-emerald-900">{roster.school.country_name || "République de Côte d’Ivoire"}<br />{roster.school.country_motto || "Union - Discipline - Travail"}<br />{schoolCardMinistry(roster.school, preview.year)}</div><div>{documentNationalEmblem(roster.school.country_name) && <img src={documentNationalEmblem(roster.school.country_name)} alt="Armoiries de la République de Côte d’Ivoire" className="aspect-square w-full object-contain" />}</div></div><h3 className="mx-auto mt-1 w-fit rounded bg-emerald-800 px-6 font-bold text-white">CARTE SCOLAIRE</h3><p className="text-center text-[10px]">ANNÉE SCOLAIRE {preview.year}</p><div className="mt-3 flex gap-4">{preview.photoUrl ? <img alt="Photo de l’élève" className="aspect-[20/26] w-1/4 object-contain" src={preview.photoUrl} /> : <div className="grid w-1/4 place-items-center bg-slate-100 text-xs">Photo absente</div>}<div className="space-y-1 text-xs"><p>Matricule : <strong>{preview.matricule || "—"}</strong></p><p className="text-sm font-semibold">{preview.name}</p><p>Né(e) le : {preview.birthdate} · Sexe : {preview.gender}</p><p>Lieu : {preview.birthPlace}</p><p>Classe : {preview.classLabel}</p>{preview.signatureSlot && <img alt={`Signature de ${preview.signatoryName}`} src={signatureImages.current[preview.signatureSlot]} className="ml-auto h-9 max-w-28 object-contain" />}</div></div><p className="absolute inset-x-4 bottom-3 border-t-2 border-orange-400 pt-1 text-center text-[11px] font-semibold">{roster.school.name}</p></div>
          <div aria-label="Aperçu verso" className="relative aspect-[85.6/54] max-w-lg overflow-hidden rounded-2xl border bg-white p-[4%] shadow-md">
            {roster.school.logo_url ? <img src={roster.school.logo_url} alt="Logo de l’établissement" loading="lazy" className="mx-auto h-[34%] max-w-[40%] object-contain" /> : <div className="mx-auto grid h-[34%] w-[40%] place-items-center text-xs text-slate-500">Logo de l’établissement</div>}
            <h3 className="mt-1 text-center text-xs font-bold text-emerald-900">{roster.school.name}</h3>
            <div className="mx-auto mt-3 max-w-[90%] space-y-2 text-center text-[11px] leading-snug">
              <p>Cette carte est strictement personnelle et obligatoire pour toutes les démarches scolaires et administratives.</p>
              <p>Toute reproduction, altération ou utilisation frauduleuse est formellement interdite.</p>
              <p>En cas de perte, prière de contacter l’établissement au : <strong>{roster.school.phone || "coordonnées à renseigner"}</strong></p>
            </div>
            <p className="absolute inset-x-3 bottom-3 border-t border-orange-400 pt-2 text-center text-[10px] text-emerald-900">Mon Cahier — www.mon-cahier.com</p>
          </div>
        </div>}
        {files.length > 0 && <ul className="space-y-2">{files.map(file => <li key={file.url} className="flex flex-wrap gap-4 rounded-lg bg-emerald-50 p-3 text-sm"><a className="font-semibold underline" href={file.url} download={file.name}>{file.name} · {file.count} cartes</a><a href={file.url} target="_blank" rel="noreferrer" className="underline">Ouvrir pour imprimer</a></li>)}</ul>}
      </section>
      {roster.canConfigure && <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Paramètres réservés à la direction</h2>
        <div className="flex flex-wrap gap-4"><label><input type="checkbox" disabled={busy} checked={roster.configuration.automaticSignature} onChange={e => run(() => saveOptions(e.target.checked, roster.configuration.enabled))} /> Signature/cachet automatiques sur les cartes</label><label><input type="checkbox" disabled={busy} checked={roster.configuration.enabled} onChange={e => run(() => saveOptions(roster.configuration.automaticSignature, e.target.checked))} /> Création des cartes active</label></div>
        <p className="text-sm text-slate-600">Cette autorisation concerne les cartes scolaires. Les bulletins, attestations et autres documents conservent leur circuit actuel. L’image apposée n’est pas une signature électronique certifiée.</p>
        <div className="flex flex-wrap gap-4"><label className="grid gap-1 text-sm">Responsable<select className={input} value={slot} onChange={e => setSlot(e.target.value as CardSlot)}>{CARD_SLOTS.map(value => <option key={value} value={value}>{slotNames[value]}</option>)}</select></label><label className="grid gap-1 text-sm">Image signature et cachet (JPG/PNG, 5 Mo maximum)<input type="file" accept="image/jpeg,image/png" onChange={e => setUpload(e.target.files?.[0] || null)} /></label></div>
        {roster.configuration.signatures[slot] && <a className="text-sm underline" href={`/api/admin/school-cards/signature?slot=${slot}`}>Récupérer l’original conservé de ce responsable</a>}
        <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={removeBackground} onChange={e => setRemoveBackground(e.target.checked)} /> Supprimer le fond uni</label><label><input type="checkbox" checked={crop} onChange={e => setCrop(e.target.checked)} /> Recadrer les marges transparentes</label><label>Tolérance <input type="range" min="0" max="100" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} /> {tolerance}</label></div>
        <button className={button} disabled={busy || !upload} onClick={() => run(() => signatureAction("preview"))}>Voir le résultat avant validation</button>
        {processedPreview && <><div className="flex flex-wrap gap-5">{originalPreview && <figure><img alt="Original à conserver" className="h-32 max-w-xs object-contain" src={originalPreview} /><figcaption className="text-xs">Original</figcaption></figure>}<figure><img alt="Résultat à valider" className="h-32 max-w-xs border bg-slate-100 object-contain" src={processedPreview} /><figcaption className="text-xs">Résultat proposé — ajustez si des détails manquent</figcaption></figure></div><label className="block text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} /> Je confirme l’autorisation de l’établissement et la fidélité de cette image.</label><button className={button} disabled={busy || !authorized} onClick={() => run(() => signatureAction("save"))}>Valider et conserver l’image</button></>}
        <div className="flex flex-wrap gap-3 border-t pt-4"><button className={input} disabled={busy || !chosen.length} onClick={() => run(async () => { for (let i = 0; i < chosen.length; i += 100) await jsonRequest("/api/admin/school-cards/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: roster.year, enrollmentIds: chosen.slice(i,i+100).map(row => row.enrollmentId), revoked: true }) }); setRefresh(value => value + 1); setStatus("Cartes sélectionnées invalidées."); })}>Invalider les cartes sélectionnées</button><button className={input} disabled={busy || !chosen.length} onClick={() => run(async () => { for (let i = 0; i < chosen.length; i += 100) await jsonRequest("/api/admin/school-cards/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: roster.year, enrollmentIds: chosen.slice(i,i+100).map(row => row.enrollmentId), revoked: false }) }); setRefresh(value => value + 1); setStatus("Cartes sélectionnées réactivées."); })}>Réactiver les cartes sélectionnées</button></div>
      </section>}
    </>}
  </main>;
}
