import { useEffect, useMemo, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeFinanceText } from "@mon-cahier-finance-rules";
import type { Charge, Overview, Payment } from "./types";

const formatFcfa = (value: number) => new Intl.NumberFormat("fr-FR").format(value) + " FCFA";
const empty: Overview = { school: null, students: [], charges: [], payments: [], pending_events: 0 };

function amountFrom(form: FormData, field: string): number {
  const raw = String(form.get(field) ?? "").trim();
  const amount = Number(raw);
  if (!raw || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Montant invalide : saisir un nombre entier positif de FCFA.");
  }
  return amount;
}

export default function App() {
  const [overview, setOverview] = useState<Overview>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [lastReceipt, setLastReceipt] = useState<Payment | null>(null);

  async function refresh() {
    const data = await invoke<Overview>("get_overview");
    setOverview(data);
  }

  useEffect(() => {
    refresh().catch((e: unknown) => setError(String(e))).finally(() => setLoading(false));
  }, []);

  async function operation<T>(
    command: string,
    args: Record<string, unknown>,
    label: string,
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await invoke<T>(command, args);
      await refresh();
      setSuccess(label);
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const students = useMemo(
    () => overview.students.filter((student) =>
      normalizeFinanceText(student.full_name + " " + student.matricule + " " + student.class_name)
        .includes(normalizeFinanceText(studentSearch))),
    [overview.students, studentSearch],
  );
  const chargeAmount = overview.charges.reduce((sum, charge) => sum + charge.amount_fcfa, 0);
  const paidAmount = overview.charges.reduce((sum, charge) => sum + charge.paid_fcfa, 0);

  function withForm(
    handler: (form: FormData) => Promise<void>,
  ): (event: FormEvent<HTMLFormElement>) => void {
    return (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      void handler(data).then(() => {
        if (!busy) form.reset();
      }).catch((e: unknown) => setError(String(e)));
    };
  }

  const studentLabel = (id: string) => {
    const s = overview.students.find((row) => row.id === id);
    return s ? s.full_name + " (" + s.class_name + ")" : id;
  };
  const chargeLabel = (charge: Charge) =>
    studentLabel(charge.student_id) + " — " + charge.label + " (reste " +
    formatFcfa(charge.amount_fcfa - charge.paid_fcfa) + ")";

  return (
    <main>
      <header>
        <h1>Mon Cahier Finance Desktop</h1>
        <p>Gestion de caisse locale — prototype de développement, sans réseau</p>
      </header>

      <div className="notice">
        PROTOTYPE TECHNIQUE — Ne pas saisir de données personnelles réelles,
        ne pas réaliser d'encaissements réels et ne pas délivrer de reçus officiels.
      </div>
      {error && <p role="alert" className="card error">{error}</p>}
      {success && <p role="status" className="card success">{success}</p>}
      {loading && <p>Ouverture de la base locale…</p>}

      {!loading && !overview.school && (
        <section className="card">
          <h2>Configuration de l'établissement pilote</h2>
          <p className="small">Identifiant d'essai exclusivement. Une base locale = un établissement.</p>
          <form onSubmit={withForm(async (form) => {
            await operation("configure_school", {
              schoolId: String(form.get("school_id") ?? ""),
              schoolName: String(form.get("school_name") ?? ""),
              academicYear: String(form.get("academic_year") ?? ""),
            }, "Établissement pilote configuré.");
          })}>
            <label>ID établissement (test)
              <input required name="school_id" maxLength={160} placeholder="DIEUDONNE-PILOTE" />
            </label>
            <label>Nom
              <input required name="school_name" maxLength={160} placeholder="Collège Privé Dieudonné — test" />
            </label>
            <label>Année scolaire
              <input required name="academic_year" defaultValue="2026-2027" />
            </label>
            <button disabled={busy} type="submit">Créer la base locale</button>
          </form>
        </section>
      )}

      {overview.school && (
        <>
          <section className="card">
            <h2>{overview.school.school_name} — {overview.school.academic_year}</h2>
            <div className="grid">
              <p><strong>{overview.students.length}</strong><br />élèves dans la base locale</p>
              <p><strong>{formatFcfa(chargeAmount)}</strong><br />créances d'essai</p>
              <p><strong>{formatFcfa(paidAmount)}</strong><br />encaissements d'essai</p>
              <p><strong>{formatFcfa(chargeAmount - paidAmount)}</strong><br />reste à payer local</p>
              <p><strong>{overview.pending_events}</strong><br />événements locaux non envoyés</p>
            </div>
            <p className="small">Ces chiffres ne représentent que les données de cet ordinateur.</p>
            <button disabled title="Import sécurisé à développer">Récupérer depuis Mon Cahier (à venir)</button>{" "}
            <button disabled title="Synchronisation sécurisée à développer">Envoyer vers Mon Cahier (à venir)</button>
          </section>

          <div className="grid">
            <section className="card">
              <h2>Ajouter un élève de test</h2>
              <form onSubmit={withForm(async (form) => {
                await operation("add_student", {
                  matricule: String(form.get("matricule") ?? ""),
                  fullName: String(form.get("full_name") ?? ""),
                  className: String(form.get("class_name") ?? ""),
                }, "Élève enregistré sur cet ordinateur.");
              })}>
                <label>Matricule<input name="matricule" required maxLength={160} /></label>
                <label>Nom complet<input name="full_name" required maxLength={160} /></label>
                <label>Classe<input name="class_name" required maxLength={160} /></label>
                <button disabled={busy}>Enregistrer</button>
              </form>
            </section>

            <section className="card">
              <h2>Ajouter une créance de test</h2>
              <form onSubmit={withForm(async (form) => {
                await operation("add_charge", {
                  studentId: String(form.get("student_id") ?? ""),
                  label: String(form.get("label") ?? ""),
                  amountFcfa: amountFrom(form, "amount_fcfa"),
                }, "Créance enregistrée localement.");
              })}>
                <label>Élève
                  <select required name="student_id" defaultValue="">
                    <option value="" disabled>Choisir un élève</option>
                    {overview.students.map((s) =>
                      <option key={s.id} value={s.id}>{studentLabel(s.id)}</option>)}
                  </select>
                </label>
                <label>Libellé<input name="label" required placeholder="Scolarité (test)" /></label>
                <label>Montant FCFA<input name="amount_fcfa" type="number" min={1} step={1} required /></label>
                <button disabled={busy || overview.students.length === 0}>Enregistrer</button>
              </form>
            </section>
          </div>

          <section className="card">
            <h2>Versement espèces de test</h2>
            <form onSubmit={withForm(async (form) => {
              const payment = await operation<Payment>("record_cash_payment", {
                chargeId: String(form.get("charge_id") ?? ""),
                amountFcfa: amountFrom(form, "amount_fcfa"),
                requestId: crypto.randomUUID(),
              }, "Versement enregistré localement; reçu PROVISOIRE généré.");
              if (payment) setLastReceipt(payment);
            })}>
              <label>Créance
                <select required name="charge_id" defaultValue="">
                  <option value="" disabled>Choisir une créance</option>
                  {overview.charges.filter((c) => c.amount_fcfa > c.paid_fcfa).map((c) =>
                    <option key={c.id} value={c.id}>{chargeLabel(c)}</option>)}
                </select>
              </label>
              <label>Versement FCFA
                <input name="amount_fcfa" type="number" min={1} step={1} required />
              </label>
              <button disabled={busy || !overview.charges.some((c) => c.amount_fcfa > c.paid_fcfa)}>
                Enregistrer le versement
              </button>
            </form>
          </section>

          {lastReceipt && (
            <section className="card printable" aria-label="Reçu provisoire">
              <div className="receipt">
                <h2>REÇU PROVISOIRE — NON OFFICIEL</h2>
                <p>Numéro : {lastReceipt.receipt_no}</p>
                <p>Date UTC : {lastReceipt.created_at}</p>
                <p>Montant : <strong>{formatFcfa(lastReceipt.amount_fcfa)}</strong></p>
                <p>Statut : conservé localement, non synchronisé</p>
                <p className="small">Document de simulation sans valeur de quittance.</p>
              </div>
              <button type="button" onClick={() => window.print()}>Imprimer la simulation</button>
            </section>
          )}

          <section className="card">
            <h2>Élèves et situations locales</h2>
            <label>Rechercher
              <input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)}
                     placeholder="Nom, matricule ou classe" />
            </label>
            <table>
              <thead><tr><th>Matricule</th><th>Élève</th><th>Classe</th><th>Créances</th><th>Reste local</th></tr></thead>
              <tbody>
                {students.map((student) => {
                  const rows = overview.charges.filter((c) => c.student_id === student.id);
                  return <tr key={student.id}>
                    <td>{student.matricule}</td><td>{student.full_name}</td><td>{student.class_name}</td>
                    <td className="money">{formatFcfa(rows.reduce((n, c) => n + c.amount_fcfa, 0))}</td>
                    <td className="money">{formatFcfa(rows.reduce((n, c) => n + c.amount_fcfa - c.paid_fcfa, 0))}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Journal des versements locaux</h2>
            <table>
              <thead><tr><th>Date UTC</th><th>Référence provisoire</th><th>Montant</th><th>Statut</th></tr></thead>
              <tbody>
                {overview.payments.map((payment) => <tr key={payment.id}>
                  <td>{payment.created_at}</td><td>{payment.receipt_no}</td>
                  <td>{formatFcfa(payment.amount_fcfa)}</td><td>{payment.sync_status}</td>
                </tr>)}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
