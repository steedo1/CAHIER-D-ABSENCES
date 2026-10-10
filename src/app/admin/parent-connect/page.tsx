"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { parentConnectEndLabel, type ParentConnectStatus } from "@/lib/parent-connect/domain";

type Student = { id: string; full_name: string; matricule: string | null; class_label: string; parent_connect: ParentConnectStatus; coverage_source?: string | null; sms_phone_e164?: string | null };
type Payment = { id: string; student_name: string; matricule: string; payer_name: string; receipt_no: string; created_at: string; ends_at: string; amount: number };
type Payload = {
  institution_name: string; enforcement_enabled: boolean; can_collect: boolean; can_configure: boolean; activations_paused: boolean; school_end_date: string | null;
  classes: { id: string; label: string; academic_year: string | null; level: string }[];
  academic_year: string;
  items: Student[]; page: number; total: number; roster?: { eligible_count: number; skipped_no_matricule: number };
  summary: { subscriptions_active: number; payments_count: number; collected: number; school_share: number; nexa_share: number; credits_available: number; nexa_received: number; pending_remittances: number; school_covered: number };
  payments: Payment[]; remittances: { id: string; amount: number; reference: string; created_at: string; parent_connect_credit_grants: { id: string }[] }[];
};
const money = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
const date = (s: string | null) => s ? new Date(s).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—";
const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const button = "rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";
const labels = { active: "Actif", inactive: "Non activé", expired: "Expiré", legacy: "Accès actuel" };

async function request(body: unknown, method = "POST") {
  const response = await fetch("/api/admin/parent-connect", { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "L’opération a échoué.");
  return payload;
}

export default function ParentConnectPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [classId, setClassId] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Student | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRemit, setShowRemit] = useState(false);
  const [remitAmount, setRemitAmount] = useState("");
  const [remitReference, setRemitReference] = useState("");
  const paymentOperation = useRef<string | null>(null);
  const remitOperation = useRef<string | null>(null);
  const inFlight = useRef(false);
  const revision = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const own = ++revision.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ q, class_id: classId, level, page: String(page) });
      const response = await fetch(`/api/admin/parent-connect?${params}`, { cache: "no-store", credentials: "include", signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (own === revision.current && !signal?.aborted) setData(payload);
    } catch (e: unknown) { if (own === revision.current && !signal?.aborted) setError(e instanceof Error ? e.message : "Chargement impossible."); }
    finally { if (own === revision.current && !signal?.aborted) setLoading(false); }
  }, [q, classId, level, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const dialogOpen = !!selected || showRemit;
  useEffect(() => {
    if (dialogOpen && !dialogRef.current?.open) dialogRef.current?.showModal();
    else if (!dialogOpen && dialogRef.current?.open) { dialogRef.current.close(); triggerRef.current?.focus(); }
  }, [dialogOpen]);

  function closeDialog() {
    if (inFlight.current) return;
    setSelected(null); setShowRemit(false); setError(null);
    paymentOperation.current = null; remitOperation.current = null;
  }

  async function savePhone(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || inFlight.current || !data?.can_collect) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const operation = paymentOperation.current ||= crypto.randomUUID();
    try {
      await request({ action: "phone", academic_year: data.academic_year, student_id: selected.id, operation_id: operation, sms_phone: phone, expected_phone: selected.sms_phone_e164 || null });
      setSelected(null); paymentOperation.current = null;
      setNotice("Numéro SMS enregistré. Aucun paiement ni crédit consommé. Les envois dépendent des autorisations du super admin.");
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function collect(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || inFlight.current || !data?.can_collect || !canActivate || selected.coverage_source || selected.parent_connect.status === "active") return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const operation = paymentOperation.current ||= crypto.randomUUID();
    try {
      const payload = await request({ academic_year: data.academic_year, student_id: selected.id, operation_id: operation, payer_name: payer, sms_phone: phone, payment_method: method, payment_reference: reference, amount: Number(amount), expected_ends_at: selected.parent_connect.ends_at });
      setSelected(null); paymentOperation.current = null;
      setNotice(`Paiement enregistré. Matricule activé jusqu’au ${parentConnectEndLabel(payload.payment.ends_at)} inclus. Reçu ${payload.payment.receipt_no}.`);
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function remit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !data?.can_collect) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const operation = remitOperation.current ||= crypto.randomUUID();
    try {
      await request({ action: "remit", academic_year: data.academic_year, operation_id: operation, amount: Number(remitAmount), reference: remitReference });
      setShowRemit(false); remitOperation.current = null;
      setNotice("Versement déclaré. Les crédits seront disponibles après confirmation par le super admin."); await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const validYear = !!data?.academic_year && !!data.school_end_date && Date.parse(`${data.school_end_date}T00:00:00Z`) + 86400_000 > Date.now();
  const canActivate = validYear && !data?.activations_paused && (data?.summary.credits_available || 0) > 0;

  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Familles · {data?.institution_name || "Mon Cahier"}</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Parent Connect</h1></div>
      <button type="button" className={button} onClick={() => void load()} disabled={loading || busy}>Actualiser</button>
    </div>
    {error && !dialogOpen ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p> : null}
    {data ? <>
      <section className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold text-slate-900">{data.enforcement_enabled ? "Connexion réservée aux matricules activés" : "Accès parents actuel conservé"}</h2><p className="mt-1 text-sm text-slate-600">{data.enforcement_enabled ? "Un abonnement actif est nécessaire pour consulter le suivi de l’enfant." : "Vous pouvez préparer les abonnements avant de passer à l’accès payant."}</p></div>
        <p className="text-xs text-slate-500">Accès et crédits gérés par le super admin.</p></div>
        {!data.can_collect ? <p className="mt-3 text-sm text-slate-500">Consultation des abonnements. Les encaissements sont enregistrés par le financier ou l’admin.</p> : null}
        <p className="mt-3 text-sm">Année {data.academic_year || "non configurée"} · fin : {date(data.school_end_date)} inclus. {data.summary.school_covered} élèves pris en charge par l’établissement.</p>
        {data.can_collect && (!validYear || data.activations_paused || (data.summary.credits_available < 1 && data.items.some((s) => s.matricule && !s.coverage_source))) ? <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{!validYear ? "Configurez une année scolaire actuelle avec une date de fin valide avant tout encaissement." : data.activations_paused ? "Les nouvelles activations sont suspendues par le super admin." : "Aucun crédit disponible. Faites confirmer un versement à Nexa par le super admin avant tout encaissement."}</p> : null}
      </section>
      <section className="rounded-2xl border bg-white p-5" aria-label="Élèves activés">
        <p className="text-sm text-slate-500">Élèves activés</p><p className="mt-2 text-3xl font-bold text-slate-900">{data.summary.subscriptions_active}</p>
        {data.roster ? <p className="mt-2 text-sm text-slate-500">{data.roster.eligible_count + data.roster.skipped_no_matricule} élèves inscrits cette année · {data.roster.skipped_no_matricule} sans matricule</p> : null}
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">Abonnements des élèves{data.academic_year ? ` · ${data.academic_year}` : ""}</h2>
        <p className="mt-2 text-sm text-slate-500">Choisissez un niveau puis une classe, ou recherchez directement l’enfant par son nom et ses prénoms.</p>
        <form className="my-4 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setPage(0); setQ(search); }}>
          <label className="flex-1"><span className="sr-only">Nom ou matricule</span><input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, prénom ou matricule" /></label>
          <label><span className="sr-only">Niveau</span><select className={input} value={level} onChange={(e) => { setPage(0); setLevel(e.target.value); setClassId(""); }}><option value="">Tous les niveaux</option>{[...new Set(data.classes.map((c) => c.level).filter(Boolean))].map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
          <label><span className="sr-only">Classe</span><select className={input} value={classId} onChange={(e) => { setPage(0); setClassId(e.target.value); }}><option value="">Toutes les classes</option>{data.classes.filter((c) => !level || c.level === level).map((c) => <option key={c.id} value={c.id}>{c.label}{c.academic_year ? ` · ${c.academic_year}` : ""}</option>)}</select></label>
          <button className={button} disabled={loading}>Rechercher</button>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Nom + prénoms", "Matricule", "Classe", "Abonnement", "Valable jusqu’au", "Numéro SMS", "Action"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.items.map((student) => <tr key={student.id} className="border-t"><td className="p-3 font-semibold">{student.full_name}</td><td className="p-3">{student.matricule || "—"}</td><td className="p-3">{student.class_label || "—"}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${student.parent_connect.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{student.coverage_source === "school_cover" ? "Pris en charge par l’établissement" : labels[student.parent_connect.status]}</span></td><td className="p-3">{parentConnectEndLabel(student.parent_connect.ends_at)}</td><td className="p-3">{student.sms_phone_e164 || "À renseigner"}</td><td className="p-3">{data.can_collect ? <><button disabled={busy || loading || !student.matricule || !!student.coverage_source || student.parent_connect.status === "active" || !canActivate} className="font-semibold text-emerald-800 disabled:text-slate-400" onClick={(e) => { triggerRef.current = e.currentTarget; setSelected(student); setPhoneOnly(false); setPhone(""); setPayer(""); setAmount(""); setReference(""); setMethod("cash"); setError(null); paymentOperation.current = null; }}>{student.coverage_source || student.parent_connect.status === "active" ? "Déjà couvert" : "Encaisser et activer"}</button>{student.parent_connect.status === "active" ? <button type="button" className="ml-3 font-semibold text-emerald-800 disabled:text-slate-400" disabled={busy || loading || !validYear} onClick={(e) => { triggerRef.current = e.currentTarget; setSelected(student); setPhoneOnly(true); setPhone(student.sms_phone_e164 || ""); setError(null); paymentOperation.current = null; }}>{student.sms_phone_e164 ? "Modifier le numéro" : "Ajouter le numéro SMS"}</button> : null}</> : "Consultation"}</td></tr>)}</tbody></table>{!data.items.length ? <p className="p-6 text-center text-sm text-slate-500">Aucun élève trouvé.</p> : null}</div>
        <div className="mt-4 flex items-center justify-between text-sm"><button disabled={page === 0 || loading} onClick={() => setPage(page - 1)} className="disabled:text-slate-300">Précédent</button><span>{data.total} élèves · Page {page + 1}{loading ? " · Chargement…" : ""}</span><button disabled={(page + 1) * 40 >= data.total || loading} onClick={() => setPage(page + 1)} className="disabled:text-slate-300">Suivant</button></div>
      </section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Derniers encaissements · Reçus</h2><p className="mt-1 text-xs text-slate-500">Les 30 derniers paiements Parent Connect, séparés de la scolarité.</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Date", "Élève", "Payeur", "Montant", "Reçu"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.payments.map((p) => <tr key={p.id} className="border-t"><td className="p-3">{date(p.created_at)}</td><td className="p-3">{p.student_name}</td><td className="p-3">{p.payer_name}</td><td className="p-3">{money(p.amount)}</td><td className="p-3"><Link prefetch={false} className="font-semibold text-emerald-800" href={`/admin/parent-connect/receipts/${p.id}`}>Ouvrir le reçu</Link></td></tr>)}</tbody></table>{!data.payments.length ? <p className="p-4 text-sm text-slate-500">Aucun encaissement Parent Connect.</p> : null}</div></section>
      <section className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Versements à Nexa Digital</h2></div>{data.can_collect ? <button className={button} disabled={busy || !validYear} onClick={(e) => { triggerRef.current = e.currentTarget; setShowRemit(true); setRemitAmount(""); setRemitReference(""); setError(null); }}>Déclarer un versement</button> : null}</div><ul className="mt-4 divide-y">{data.remittances.map((r) => <li className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={r.id}><span>{date(r.created_at)} · {r.reference}</span><strong>{money(r.amount)} · {r.parent_connect_credit_grants?.length ? "Confirmé par le super admin" : "En attente de confirmation"}</strong></li>)}</ul></section>
    </> : loading ? <p role="status" className="p-6 text-sm text-slate-500">Chargement des abonnements…</p> : null}
    <dialog ref={dialogRef} onCancel={(e) => { e.preventDefault(); closeDialog(); }} aria-labelledby="parent-connect-dialog-title" className="w-[calc(100%-2rem)] max-w-lg rounded-2xl border-0 bg-white p-6 shadow-xl backdrop:bg-slate-900/40">
      <h2 id="parent-connect-dialog-title" className="text-xl font-bold">{selected ? phoneOnly ? "Numéro SMS du parent" : "Encaisser et activer Parent Connect" : showRemit ? "Déclarer un versement" : "Parent Connect"}</h2>
      {selected ? <form onSubmit={phoneOnly ? savePhone : collect} className="mt-4 space-y-4"><p className="text-sm">{selected.full_name} · <strong>{selected.matricule}</strong></p>{!phoneOnly ? <><p className="rounded-xl bg-emerald-50 p-3 text-sm">Année {data?.academic_year} · jusqu’au {date(data?.school_end_date || null)} inclus.</p><label className="block text-sm">Nom du payeur<input autoFocus required minLength={2} maxLength={160} className={`${input} mt-1`} value={payer} onChange={(e) => setPayer(e.target.value)} disabled={busy} /></label><label className="block text-sm">Montant reçu (FCFA)<input name="amount" type="number" min={1} max={2147483647} step={1} required className={`${input} mt-1`} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></label><label className="block text-sm">Mode de règlement<select className={`${input} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy}><option value="cash">Espèces</option><option value="wave">Wave</option><option value="orange_money">Orange Money</option><option value="mtn_money">MTN Mobile Money</option><option value="bank_transfer">Virement bancaire</option></select></label><label className="block text-sm">Référence du règlement (facultative)<input maxLength={160} className={`${input} mt-1`} value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} /></label></> : <p className="rounded-xl bg-emerald-50 p-3 text-sm">Cet élève est déjà couvert. Ajouter son numéro ne consomme aucun crédit et ne demande aucun paiement.</p>}<label className="block text-sm">Numéro du parent pour les SMS<input type="tel" autoFocus={phoneOnly} autoComplete="tel" required maxLength={40} placeholder="07 00 00 00 00 ou +225…" className={`${input} mt-1`} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} /></label><p className="text-xs text-slate-500">Numéro donné par le parent pour recevoir les messages de cet enfant. L’enregistrement n’active pas les SMS : Nexa autorise les types de messages par établissement.</p>{!phoneOnly ? <p className="text-xs text-slate-500">Validez après réception du paiement.</p> : null}<button className={`${button} w-full`} disabled={busy}>{busy ? "Enregistrement…" : phoneOnly ? "Enregistrer le numéro" : "Enregistrer le paiement et activer"}</button></form> : showRemit ? <form onSubmit={remit} className="mt-4 space-y-4"><label className="block text-sm">Montant versé (FCFA)<input autoFocus type="number" min={1} max={2147483647} step={1} required className={`${input} mt-1`} value={remitAmount} onChange={(e) => setRemitAmount(e.target.value)} disabled={busy} /></label><label className="block text-sm">Référence du versement<input minLength={2} maxLength={160} required className={`${input} mt-1`} value={remitReference} onChange={(e) => setRemitReference(e.target.value)} disabled={busy} /></label><p className="text-xs text-slate-500">Déclarez ici un versement déjà effectué à Nexa Digital.</p><button className={`${button} w-full`} disabled={busy}>{busy ? "Enregistrement…" : "Déclarer le versement"}</button></form> : null}
      {error && dialogOpen ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <button className="mt-4 w-full rounded-xl border px-4 py-2.5 text-sm" type="button" disabled={busy} onClick={closeDialog}>Annuler</button>
    </dialog>
  </div>;
}
