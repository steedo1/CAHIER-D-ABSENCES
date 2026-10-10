"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parentConnectEndLabel } from "@/lib/parent-connect/domain";

type Summary = { subscriptions_active: number; credits_available: number; credits_granted: number; credits_used: number; nexa_received: number; pending_remittances: number; school_covered: number };
type School = { id: string; name: string; summary: Summary };
type Remittance = { id: string; academic_year: string; amount: number; reference: string; created_at: string; created_by: string | null; parent_connect_credit_grants: { id: string }[] };
type Detail = {
  sms_channels?: { sms_premium_enabled?: boolean; sms_absence_enabled?: boolean; sms_late_enabled?: boolean; sms_notes_digest_enabled?: boolean };
  phone_changes?: { id: string; student_id: string; student_name: string; matricule: string; changed_by_name: string; academic_year: string; previous_phone: string | null; phone_e164: string; changed_by: string | null; changed_at: string }[];
  institution: { id: string; name: string }; year: { code: string; end_date: string | null } | null;
  settings: { enforcement_enabled: boolean; activations_paused: boolean; approved_academic_year?: string; approved_ends_at?: string }; summary: Summary;
  roster: { eligible_count: number; skipped_no_matricule: number };
  remittances: Remittance[];
  grants: { id: string; academic_year: string; quantity: number; amount_received: number; reference: string; confirmed_at: string; confirmed_by: string | null }[];
  bulk: { id: string; academic_year: string; reference: string; eligible_count: number; skipped_no_matricule: number; ends_at: string; created_at: string; created_by: string | null }[];
  payments: { id: string; academic_year: string; student_name: string; matricule: string; payer_name: string; sms_phone_e164?: string; amount: number; receipt_no: string; created_at: string; created_by: string | null }[];
};
type Operation = { kind: "grant" | "bulk" | "configure"; id: string; school: string; year: string; end: string; eligible: number; missing: number; remittance?: Remittance; enforcement: boolean; paused: boolean };
const money = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
const date = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—";
const input = "w-full rounded-xl border px-3 py-2.5 text-sm";
const button = "rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50";
async function api(path = "", body?: unknown, signal?: AbortSignal) {
  const r = await fetch(`/api/super/parent-connect${path}`, { cache: "no-store", credentials: "include", signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Opération impossible.");
  return data;
}

export default function ParentConnectControl() {
  const [schools, setSchools] = useState<School[]>([]);
  const [search, setSearch] = useState(""); const [q, setQ] = useState(""); const [page, setPage] = useState(0); const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(""); const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false); const [loadingSchools, setLoadingSchools] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null); const [quantity, setQuantity] = useState("1"); const [reference, setReference] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement | null>(null); const inFlight = useRef(false);
  const listRevision = useRef(0); const detailRevision = useRef(0); const submitted = useRef<object | null>(null);
  const loadSchools = useCallback(async (signal?: AbortSignal) => {
    const own = ++listRevision.current; setLoadingSchools(true);
    try {
      const data = await api(`?${new URLSearchParams({ q, page: String(page) })}`, undefined, signal);
      if (own === listRevision.current && !signal?.aborted) { setSchools(data.items); setTotal(data.total); }
    } catch (e) { if (own === listRevision.current && !signal?.aborted) setError(e instanceof Error ? e.message : "Chargement impossible."); }
    finally { if (own === listRevision.current && !signal?.aborted) setLoadingSchools(false); }
  }, [q, page]);
  const loadDetail = useCallback(async (signal?: AbortSignal) => {
    const own = ++detailRevision.current; if (!selected) { setDetail(null); return; }
    setLoading(true);
    try {
      const data = await api(`?institution_id=${encodeURIComponent(selected)}`, undefined, signal);
      if (own === detailRevision.current && !signal?.aborted) setDetail(data);
    } catch (e) { if (own === detailRevision.current && !signal?.aborted) { setDetail(null); setError(e instanceof Error ? e.message : "Chargement impossible."); } }
    finally { if (own === detailRevision.current && !signal?.aborted) setLoading(false); }
  }, [selected]);
  useEffect(() => { const c = new AbortController(); void loadSchools(c.signal); return () => c.abort(); }, [loadSchools]);
  useEffect(() => { const c = new AbortController(); void loadDetail(c.signal); return () => c.abort(); }, [loadDetail]);
  useEffect(() => {
    if (operation && !dialogRef.current?.open) dialogRef.current?.showModal();
    else if (!operation && dialogRef.current?.open) { dialogRef.current.close(); trigger.current?.focus(); }
  }, [operation]);
  const validYear = !!detail?.year?.code && !!detail.year.end_date && Date.parse(`${detail.year.end_date}T00:00:00Z`) + 86400_000 > Date.now();
  function open(kind: Operation["kind"], target: HTMLButtonElement, remittance?: Remittance) {
    if (!detail || loading || inFlight.current) return;
    trigger.current = target; setError(null); submitted.current = null; setConfirmed(false);
    setQuantity("1"); setReceivedAmount(remittance ? String(remittance.amount) : ""); setReference(remittance?.reference || "");
    const calendarEnd = detail.year?.end_date || "";
    const approvedEnd = detail.settings.approved_academic_year === detail.year?.code && detail.settings.approved_ends_at ? new Date(Date.parse(detail.settings.approved_ends_at) - 1).toISOString().slice(0, 10) : calendarEnd;
    setOperation({ kind, id: crypto.randomUUID(), school: detail.institution.id, year: detail.year?.code || "", end: kind === "grant" && approvedEnd < calendarEnd ? approvedEnd : calendarEnd, eligible: detail.roster.eligible_count, missing: detail.roster.skipped_no_matricule, remittance, enforcement: detail.settings.enforcement_enabled, paused: detail.settings.activations_paused });
  }
  function close() { if (!inFlight.current) { setOperation(null); submitted.current = null; setError(null); } }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!operation || inFlight.current || !confirmed || operation.school !== selected) return;
    const body = submitted.current ||= operation.kind === "configure"
      ? { action: "configure", institution_id: operation.school, enforcement_enabled: operation.enforcement, activations_paused: operation.paused }
      : { action: operation.kind, institution_id: operation.school, operation_id: operation.id, academic_year: operation.year, reference: reference.trim(), confirm_received: true, ...(operation.kind === "grant" ? { quantity: Number(quantity), received_amount: Number(receivedAmount), remittance_id: operation.remittance?.id || null } : { expected_count: operation.eligible }) };
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api("", body);
      setOperation(null); submitted.current = null;
      setNotice(operation.kind === "bulk" ? `${result.bulk.activated_count} élèves couverts pour ${operation.year}, jusqu’au ${parentConnectEndLabel(result.bulk.ends_at)} inclus.` : operation.kind === "grant" ? `${result.grant.quantity} crédits attribués après confirmation du paiement reçu par Nexa.` : "Paramètres d’accès mis à jour.");
      await Promise.all([loadSchools(), loadDetail()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Opération impossible."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-violet-700">Nexa Digital SARL · Super admin</p><h1 className="mt-2 text-3xl font-bold">Parent Connect</h1><p className="mt-2 text-sm text-slate-600">Confirmez les paiements reçus, attribuez les crédits et gérez les établissements déjà couverts.</p></header>
    {error && !operation ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p> : null}
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Établissements</h2><form className="my-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setQ(search); }}><label className="flex-1"><span className="sr-only">Rechercher un établissement</span><input className={input} placeholder="Nom de l’établissement, CSCA…" value={search} onChange={(e) => setSearch(e.target.value)} /></label><button className={button} disabled={busy || !!operation || loadingSchools}>Rechercher</button></form>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{["Établissement", "Élèves activés", "Pilotage"].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{schools.map((school) => <tr className="border-t" key={school.id}><td className="p-3 font-semibold">{school.name}</td><td className="p-3">{school.summary.subscriptions_active}</td><td className="p-3"><button className="font-semibold text-violet-700 disabled:opacity-40" disabled={busy || !!operation || loadingSchools} onClick={() => { setDetail(null); setSelected(school.id); setError(null); setNotice(null); }}>Gérer</button></td></tr>)}</tbody></table></div>
      {!schools.length ? <p className="p-4 text-sm text-slate-500">{loadingSchools ? "Chargement…" : "Aucun établissement trouvé."}</p> : null}
      <div className="mt-4 flex justify-between text-sm"><button disabled={!page || loadingSchools || busy || !!operation} onClick={() => setPage(page - 1)}>Précédent</button><span>{total} établissements · page {page + 1}</span><button disabled={(page + 1) * 30 >= total || loadingSchools || busy || !!operation} onClick={() => setPage(page + 1)}>Suivant</button></div>
    </section>
    {loading ? <p role="status">Chargement de l’établissement…</p> : detail ? <>
      <section className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">{detail.institution.name}</h2><p className="mt-2 text-sm">Année {detail.year?.code || "non configurée"} · fin : {date(detail.year?.end_date)} inclus</p></div><button className={button} disabled={busy || !!operation} onClick={() => { setError(null); void loadDetail(); void loadSchools(); }}>Actualiser</button></div>
        <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">Élèves activés</p><strong className="mt-2 block text-3xl">{detail.summary.subscriptions_active}</strong></div>
        {!validYear ? <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">Une année scolaire actuelle avec une date de fin valide est requise pour attribuer des crédits ou activer des élèves.</p> : null}
        <div className="mt-5 flex flex-wrap gap-3"><button className={button} disabled={busy || !!operation || !validYear} onClick={(e) => open("grant", e.currentTarget)}>Attribuer des crédits</button><button className={button} disabled={busy || !!operation || !validYear || !detail.roster.eligible_count} onClick={(e) => open("bulk", e.currentTarget)}>Activer tous les élèves</button><button className="rounded-xl border px-4 py-2.5 text-sm font-semibold" disabled={busy || !!operation} onClick={(e) => open("configure", e.currentTarget)}>Gérer l’accès et les activations</button></div>
        <p className="mt-3 text-xs text-slate-500">{detail.roster.eligible_count} élèves inscrits avec matricule · {detail.roster.skipped_no_matricule} sans matricule. {detail.settings.enforcement_enabled ? "Accès réservé aux matricules activés." : "Accès antérieur conservé."} {detail.settings.activations_paused ? "Nouvelles activations suspendues." : "Nouvelles activations autorisées dans la limite des crédits."}</p>
      </section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">SMS de cet établissement</h2><p className="mt-2 text-sm">{detail.sms_channels?.sms_premium_enabled ? "Service SMS activé par Nexa." : "Service SMS désactivé : aucun envoi, même si les numéros sont enregistrés."}</p><p className="mt-2 text-sm">Absences : {detail.sms_channels?.sms_premium_enabled && detail.sms_channels.sms_absence_enabled ? "activées" : "désactivées"} · Retards : {detail.sms_channels?.sms_premium_enabled && detail.sms_channels.sms_late_enabled ? "activés" : "désactivés"} · Notes : {detail.sms_channels?.sms_premium_enabled && detail.sms_channels.sms_notes_digest_enabled ? "activées" : "désactivées"}</p><a className="mt-3 inline-block text-sm font-semibold text-violet-700" href="/super/abonnements">Gérer les autorisations SMS par établissement</a><p className="mt-2 text-xs text-slate-500">Les crédits Parent Connect permettent les activations d’abonnement. L’autorisation SMS reste séparée. Les push conservent leur fonctionnement actuel.</p></section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Dernières modifications des numéros SMS</h2><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Date", "Élève", "Année", "Ancien numéro", "Nouveau numéro", "Auteur"].map((v) => <th className="p-2" key={v}>{v}</th>)}</tr></thead><tbody>{(detail.phone_changes || []).map((change) => <tr className="border-t" key={change.id}><td className="p-2">{date(change.changed_at)}</td><td className="p-2 break-all">{change.student_name} · {change.matricule}</td><td className="p-2">{change.academic_year}</td><td className="p-2">{change.previous_phone || "—"}</td><td className="p-2">{change.phone_e164}</td><td className="p-2 break-all">{change.changed_by_name}</td></tr>)}</tbody></table></div>{!detail.phone_changes?.length ? <p className="mt-3 text-sm text-slate-500">Aucune modification enregistrée.</p> : null}</section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Versements déclarés par l’établissement</h2><p className="mt-1 text-xs text-slate-500">100 dernières déclarations. Seule votre confirmation après réception effective crée les crédits.</p><ul className="mt-4 divide-y">{detail.remittances.map((r) => <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" key={r.id}><div><strong>{money(r.amount)}</strong> · {r.reference}<p className="mt-1 text-xs text-slate-500">{r.academic_year} · {date(r.created_at)} · Auteur : {r.created_by || "—"}</p></div>{r.parent_connect_credit_grants?.length ? <span className="text-emerald-700">Confirmé</span> : <button className={button} disabled={busy || !!operation || !validYear || r.academic_year !== detail.year?.code} onClick={(e) => open("grant", e.currentTarget, r)}>Confirmer la réception</button>}</li>)}</ul>{!detail.remittances.length ? <p className="mt-4 text-sm text-slate-500">Aucun versement déclaré.</p> : null}</section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Historique des crédits confirmés</h2><ul className="mt-4 divide-y">{detail.grants.map((g) => <li className="py-3 text-sm" key={g.id}><strong>{g.quantity} crédits · {money(g.amount_received)}</strong> · {g.reference}<p className="mt-1 text-xs text-slate-500">{g.academic_year} · {date(g.confirmed_at)} · Confirmé par : {g.confirmed_by || "—"}</p></li>)}</ul></section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Prises en charge collectives</h2><ul className="mt-4 divide-y">{detail.bulk.map((b) => <li className="py-3 text-sm" key={b.id}><strong>{b.eligible_count} élèves · {b.academic_year}</strong> · {b.reference}<p className="mt-1 text-xs text-slate-500">{date(b.created_at)} · jusqu’au {parentConnectEndLabel(b.ends_at)} inclus · {b.skipped_no_matricule} sans matricule · Auteur : {b.created_by || "—"}</p></li>)}</ul></section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Derniers encaissements parents</h2><p className="mt-1 text-xs text-slate-500">30 derniers paiements, conservés séparément des crédits et des prises en charge collectives.</p><ul className="mt-4 divide-y">{detail.payments.map((p) => <li className="py-3 text-sm" key={p.id}><strong>{p.student_name} · {p.matricule} · {money(p.amount)}</strong><p className="mt-1 break-all text-xs text-slate-500">{p.academic_year} · {date(p.created_at)} · Payeur : {p.payer_name} · SMS : {p.sms_phone_e164 || "—"} · Auteur : {p.created_by || "—"} · {p.receipt_no}</p></li>)}</ul></section>
    </> : null}
    <dialog ref={dialogRef} aria-labelledby="super-parent-connect-dialog" onCancel={(e) => { e.preventDefault(); close(); }} className="w-[calc(100%-2rem)] max-w-lg rounded-2xl border-0 bg-white p-6 shadow-xl backdrop:bg-slate-900/40"><h2 id="super-parent-connect-dialog" className="text-xl font-bold">{operation?.kind === "bulk" ? "Activer tous les élèves" : operation?.kind === "grant" ? "Confirmer les crédits prépayés" : "Gérer l’accès parents"}</h2>
      {operation ? <form className="mt-4 space-y-4" onSubmit={submit}><p className="text-sm font-semibold">{detail?.institution.name} · {operation.year}</p>
        {operation.kind === "configure" ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={operation.enforcement} disabled={busy || !!submitted.current} onChange={(e) => setOperation({ ...operation, enforcement: e.target.checked })} />Réserver la connexion aux matricules activés</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={operation.paused} disabled={busy || !!submitted.current} onChange={(e) => setOperation({ ...operation, paused: e.target.checked })} />Suspendre les nouvelles activations</label><p className="text-xs text-slate-500">La suspension des activations conserve l’accès des parents déjà abonnés. Désactiver la restriction autorise l’accès sans abonnement.</p></> : <>
          <p className="rounded-xl bg-violet-50 p-3 text-sm">{operation.kind === "bulk" ? `${operation.eligible} élèves seront couverts jusqu’au ${date(operation.end)} inclus. ${operation.missing} élèves sans matricule seront exclus. Aucun encaissement parent ni consommation de crédit ne sera enregistré. Les élèves déjà abonnés conservent leur couverture.` : `${quantity} crédits pour l’année ${operation.year}, jusqu’au ${date(operation.end)} inclus.`}</p>
          {operation.kind === "grant" ? <label className="block text-sm">Nombre de crédits<input autoFocus type="number" required min={1} max={1000000} step={1} className={`${input} mt-1`} value={quantity} disabled={busy || !!submitted.current} onChange={(e) => setQuantity(e.target.value)} /></label> : null}
          <label className="block text-sm">Référence du paiement reçu<input autoFocus={operation.kind === "bulk"} required minLength={2} maxLength={160} className={`${input} mt-1`} value={reference} disabled={busy || !!submitted.current} onChange={(e) => setReference(e.target.value)} /></label>
        </>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />{operation.kind === "configure" ? "Je confirme ces paramètres d’accès." : operation.kind === "bulk" ? "Je confirme que Nexa a déjà reçu le paiement couvrant ces élèves pour cette année scolaire." : "Je confirme avoir vérifié la réception effective de ce montant par Nexa Digital SARL."}</label>
        {operation.kind === "grant" ? <label className="block text-sm">Montant reçu par Nexa (FCFA)<input name="received_amount" type="number" required min={1} max={Number.MAX_SAFE_INTEGER} step={1} className={`${input} mt-1`} value={receivedAmount} disabled={busy || !!operation.remittance || !!submitted.current} onChange={(e) => setReceivedAmount(e.target.value)} /></label> : null}
        {operation.kind === "grant" ? <p className="text-xs text-slate-500">La confirmation réserve aussi l’accès Parent Connect aux matricules activés de cet établissement.</p> : null}
        <button className={`${button} w-full`} disabled={busy || !confirmed}>{busy ? "Enregistrement…" : operation.kind === "bulk" ? "Confirmer l’activation collective" : operation.kind === "grant" ? "Confirmer et attribuer les crédits" : "Enregistrer les paramètres"}</button>
      </form> : null}
      {error && operation ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}<button className="mt-4 w-full rounded-xl border px-4 py-2.5 text-sm" disabled={busy} onClick={close}>Annuler</button>
    </dialog>
  </div>;
}
