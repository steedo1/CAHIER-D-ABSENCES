"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { field, primary, productionDate, productionRequest, surface } from "@/components/production-nexa/shared";
import { PRODUCTION_EVENT_LABELS, PRODUCTION_PERMISSIONS, type ProductionEvent, type ProductionPermission } from "@/lib/production-nexa";

type School = { id: string; name: string; code: string | null };
type Status = "active" | "disabled" | "revoked";
type Account = { user_id: string; email: string; status: Status; permissions: ProductionPermission[];
  all_schools: boolean; institution_ids: string[]; revision: number };
type SupervisionEvent = ProductionEvent & { institution_id: string | null; academic_year: string | null };
type AccountPage = { schools: School[]; accounts: Account[]; nextOffset: number | null };
type AccountForm = { status: Status; permissions: ProductionPermission[]; allSchools: boolean; institutionIds: string[] };

const api = "/api/super/production-nexa";
const statuses: Record<Status, string> = { active: "Actif", disabled: "Désactivé", revoked: "Révoqué" };
const permissionLabels: Record<ProductionPermission, string> = {
  "cards.read": "Consulter cartes, commandes et archives", "cards.orders": "Traiter les commandes",
  "cards.generate": "Générer et archiver les PDF", "cards.download": "Télécharger les PDF",
};
const initialForm: AccountForm = { status: "active", permissions: [...PRODUCTION_PERMISSIONS], allSchools: false, institutionIds: [] };

export default function Supervision() {
  const [accounts, setAccounts] = useState<Account[]>([]), [schools, setSchools] = useState<School[]>([]);
  const [edit, setEdit] = useState<Account | null>(null), [form, setForm] = useState(initialForm);
  const [email, setEmail] = useState(""), [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [history, setHistory] = useState<SupervisionEvent[]>([]), [historyAccount, setHistoryAccount] = useState("");
  const [nextHistory, setNextHistory] = useState<number | null>(null), [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const result: AccountPage = { accounts: [], schools: [], nextOffset: 0 };
      while (result.nextOffset !== null) {
        const page: AccountPage = await productionRequest(`${api}?offset=${result.nextOffset}`, undefined, controller.signal);
        result.accounts.push(...page.accounts); result.schools.push(...page.schools); result.nextOffset = page.nextOffset;
      }
      if (!controller.signal.aborted) { setAccounts(result.accounts); setSchools(result.schools); }
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  async function run(action: () => Promise<void>) {
    setError(""); setStatus(""); setBusy(true);
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function resetForm() { setEdit(null); setEmail(""); setForm(initialForm); }
  function selectAccount(account: Account) {
    setEdit(account);
    setForm({ status: account.status, permissions: account.permissions, allSchools: account.all_schools, institutionIds: account.institution_ids });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.status === "revoked" && !window.confirm("Révoquer définitivement l’accès de ce responsable ?")) return;
    void run(async () => {
      const result = await productionRequest<{ account: Account; password?: string }>(api, {
        ...form, ...(edit ? { action: "update", userId: edit.user_id, revision: edit.revision } : { action: "create", email }),
      });
      setAccounts(previous => [...previous.filter(item => item.user_id !== result.account.user_id), result.account]
        .sort((a, b) => a.email.localeCompare(b.email)));
      if (result.password) setCredentials({ email: result.account.email, password: result.password });
      setStatus(edit ? "Accès du responsable mis à jour." : "Compte Responsable Production Nexa créé.");
      resetForm();
    });
  }
  async function showHistory(offset = 0) {
    const result = await productionRequest<{ history: SupervisionEvent[]; nextOffset: number | null }>(
      `${api}?view=history&offset=${offset}${historyAccount ? `&account=${historyAccount}` : ""}`,
    );
    setHistory(previous => offset ? [...previous, ...result.history] : result.history);
    setNextHistory(result.nextOffset); setHistoryLoaded(true);
  }
  return <div className="space-y-4 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Production Nexa</h1><p className="text-sm text-slate-600">Comptes, autorisations et journal des opérations</p></div>
      <Link href="/production-nexa" className={primary}>Ouvrir l’espace de production</Link>
    </header>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3">{error}</p>}
    {credentials && <section className={surface}>
      <h2 className="font-semibold">Identifiants à remettre au responsable</h2>
      <p>Adresse <strong>{credentials.email}</strong></p>
      <p>Mot de passe initial <code className="select-all rounded bg-slate-100 p-1">{credentials.password}</code></p>
      <p className="text-sm">Remettez-le par un canal privé. Le responsable peut le changer via « Mot de passe oublié ».</p>
      <button className={field} onClick={() => setCredentials(null)}>Masquer les identifiants</button>
    </section>}
    <form onSubmit={submit} className={surface}>
      <h2 className="text-lg font-semibold">{edit ? `Modifier ${edit.email}` : "Créer un compte Responsable Production Nexa"}</h2>
      {!edit && <label className="grid max-w-md gap-1 text-sm">Adresse e-mail<input type="email" className={field} required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>}
      <label className="grid max-w-md gap-1 text-sm">État<select className={field} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status })}>
        <option value="active">Actif</option><option value="disabled">Désactivé</option>{edit && <option value="revoked">Révoqué définitivement</option>}
      </select></label>
      <fieldset className="grid gap-2"><legend className="mb-2 font-medium">Autorisations</legend>
        {PRODUCTION_PERMISSIONS.map(permission => <label key={permission} className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.permissions.includes(permission)} onChange={e => {
            const checked = e.target.checked;
            setForm(previous => ({ ...previous, permissions: checked
              ? [...new Set([...previous.permissions, "cards.read" as const, permission])]
              : permission === "cards.read" ? [] : previous.permissions.filter(item => item !== permission) }));
          }} />{permissionLabels[permission]}
        </label>)}
      </fieldset>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.allSchools} onChange={e => setForm({ ...form, allSchools: e.target.checked })} />
        Tous les établissements, y compris les futurs</label>
      {!form.allSchools && <label className="grid max-w-lg gap-1 text-sm">Établissements autorisés<select multiple size={Math.min(6, Math.max(2, schools.length))} className={field}
        value={form.institutionIds} onChange={e => setForm({ ...form, institutionIds: Array.from(e.target.selectedOptions, item => item.value) })}>
        {schools.map(school => <option key={school.id} value={school.id}>{school.name}{school.code ? ` · ${school.code}` : ""}</option>)}
      </select></label>}
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy || (!edit && credentials !== null)}>{edit ? "Enregistrer les autorisations" : "Créer le compte"}</button>
        {edit && <button type="button" className={field} onClick={resetForm}>Annuler la modification</button>}
      </div>
    </form>
    <section className={surface}>
      <h2 className="text-lg font-semibold">Comptes de production</h2>
      {!accounts.length && <p>Aucun compte enregistré.</p>}
      {accounts.map(item => <div key={item.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
        <div><strong>{item.email}</strong><p>{statuses[item.status]} · {item.all_schools ? "Tous les établissements" : `${item.institution_ids.length} établissement(s)`}</p></div>
        {item.status !== "revoked" && <button className={field} disabled={busy} onClick={() => selectAccount(item)}>Modifier l’accès</button>}
      </div>)}
    </section>
    <section className={surface}>
      <h2 className="text-lg font-semibold">Journal des opérations</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">Compte<select className={field} disabled={busy} value={historyAccount} onChange={e => {
          setHistoryAccount(e.target.value); setHistory([]); setHistoryLoaded(false); setNextHistory(null);
        }}><option value="">Toute l’activité</option>{accounts.map(item => <option key={item.user_id} value={item.user_id}>{item.email}</option>)}</select></label>
        <button className={primary} disabled={busy} onClick={() => run(() => showHistory())}>Afficher le journal</button>
      </div>
      {historyLoaded && !history.length && <p>Aucune opération.</p>}
      {history.map(event => <div key={event.id} className="rounded-lg border p-3 text-sm">
        <p><strong>{PRODUCTION_EVENT_LABELS[event.action] ?? event.action}</strong> · {productionDate(event.created_at)}</p>
        <p>{accounts.find(item => item.user_id === event.actor_id)?.email ?? event.actor_id}{event.institution_id ? ` · ${schools.find(item => item.id === event.institution_id)?.name ?? event.institution_id}` : ""} {event.academic_year}</p>
        <p className="break-all text-slate-600">Référence {event.subject_id}</p>
        {typeof event.details.count === "number" && <p>{event.details.count} carte(s)</p>}
      </div>)}
      {nextHistory !== null && <button className={field} disabled={busy} onClick={() => run(() => showHistory(nextHistory))}>Événements suivants</button>}
    </section>
  </div>;
}
