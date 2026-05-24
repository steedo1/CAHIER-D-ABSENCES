// src/app/parents/payments/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, RefreshCw, XCircle } from "lucide-react";
import { OperatorLogo } from "@/components/payments/OperatorLogo";

type ProviderOption = {
  id: string;
  provider: string;
  label: string;
  environment: string;
};

type ChargeOption = {
  id: string;
  label: string;
  net_amount: number;
  paid_amount: number;
  balance_due: number;
  due_date: string | null;
  status: string;
};

type PaymentChild = {
  student_id: string;
  student_name: string;
  matricule: string | null;
  class_id: string | null;
  class_label: string | null;
  institution_id: string | null;
  institution_name: string;
  charges: ChargeOption[];
  providers: ProviderOption[];
};

type PaymentStatus = {
  id: string;
  student_id: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  receipt_id: string | null;
  receipt_no: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  confirmed_at: string | null;
};

function formatMoney(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function normalizePhone(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function dueLabel(value: string | null) {
  if (!value) return "Sans échéance";
  try {
    return new Date(value + "T00:00:00").toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function statusLabel(status: string) {
  if (status === "succeeded") return "Paiement confirmé";
  if (status === "failed") return "Paiement échoué";
  if (status === "cancelled") return "Paiement annulé";
  if (status === "expired") return "Paiement expiré";
  if (status === "initiated") return "Paiement initialisé";
  return "Paiement en attente";
}

function statusIcon(status: string) {
  if (status === "succeeded") return <CheckCircle2 className="h-5 w-5" />;
  if (["failed", "cancelled", "expired"].includes(status)) return <XCircle className="h-5 w-5" />;
  return <Clock3 className="h-5 w-5" />;
}

function statusBoxClass(status: string) {
  if (status === "succeeded") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (["failed", "cancelled", "expired"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export default function ParentOnlinePaymentsPage() {
  const [items, setItems] = useState<PaymentChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedChargeId, setSelectedChargeId] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [currentIntentId, setCurrentIntentId] = useState("");
  const [currentStatus, setCurrentStatus] = useState<PaymentStatus | null>(null);

  async function loadOptions() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/parent/payments/options", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Impossible de charger les paiements.");
      const rows = Array.isArray(json?.items) ? json.items : [];
      setItems(rows);

      const firstStudent = rows.find((row: PaymentChild) => row.charges?.length > 0) || rows[0];
      if (firstStudent && !selectedStudentId) {
        setSelectedStudentId(firstStudent.student_id);
        setPayerName(firstStudent.student_name || "");
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function checkIntent(intentId: string) {
    if (!intentId) return;
    setCheckingStatus(true);
    setError("");
    try {
      const res = await fetch(`/api/parent/payments/status?intent_id=${encodeURIComponent(intentId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Impossible de vérifier le paiement.");
      setCurrentStatus(json?.item || null);
      setCurrentIntentId(intentId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setCheckingStatus(false);
    }
  }

  useEffect(() => {
    loadOptions();
    const params = new URLSearchParams(window.location.search);
    const intent = params.get("intent") || params.get("intent_id") || "";
    if (intent) checkIntent(intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedChild = useMemo(() => {
    return items.find((item) => item.student_id === selectedStudentId) || null;
  }, [items, selectedStudentId]);

  const selectedCharge = useMemo(() => {
    return selectedChild?.charges.find((charge) => charge.id === selectedChargeId) || null;
  }, [selectedChild, selectedChargeId]);

  const hasAnyConfiguredProvider = useMemo(() => {
    return items.some((item) => (item.providers || []).length > 0);
  }, [items]);

  useEffect(() => {
    if (!selectedChild) return;
    const firstCharge = selectedChild.charges[0];
    setSelectedChargeId(firstCharge?.id || "");
    setSelectedProvider(selectedChild.providers[0]?.provider || "");
    setAmount(firstCharge ? String(firstCharge.balance_due) : "");
    setPayerName((current) => current || selectedChild.student_name || "");
  }, [selectedChild?.student_id]);

  useEffect(() => {
    if (selectedCharge) setAmount(String(selectedCharge.balance_due));
  }, [selectedCharge?.id]);

  const canSubmit =
    Boolean(selectedChild && selectedCharge && selectedProvider && normalizePhone(payerPhone)) &&
    Number(amount || 0) > 0 &&
    !submitting;

  async function submitPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedChild || !selectedCharge) return;

    setSubmitting(true);
    setError("");
    setMessage("");
    setCurrentStatus(null);

    try {
      const res = await fetch("/api/parent/payments/initiate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: selectedChild.student_id,
          charge_id: selectedCharge.id,
          provider: selectedProvider,
          amount: Number(amount || 0),
          payer_name: payerName,
          payer_phone: payerPhone,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Paiement non initialisé.");

      const intentId = String(json?.intent_id || "");
      setCurrentIntentId(intentId);
      setMessage(json?.message || "Paiement initialisé. Vérifiez votre téléphone.");

      if (intentId) {
        await checkIntent(intentId);
      }

      if (json?.checkout_url && !String(json.checkout_url).includes("/parents/payments")) {
        window.location.href = String(json.checkout_url);
        return;
      }

      await loadOptions();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 bg-[#003766] text-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="min-w-0">
            <div className="text-[12px] font-black uppercase tracking-[0.22em] text-amber-300">
              Mon Cahier
            </div>
            <h1 className="truncate text-lg font-black">Frais scolaires</h1>
          </div>
          <Link
            href="/parents"
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/15"
          >
            Retour
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                Frais scolaires
              </div>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                Règlement des frais de votre enfant
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                L’option de paiement s’affiche seulement si l’établissement l’a activée.
              </p>
            </div>
            {hasAnyConfiguredProvider ? (
              <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                Reçu officiel après confirmation
              </div>
            ) : null}
          </div>
        </section>

        {loading && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">
            Chargement des frais disponibles…
          </div>
        )}

        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            {message}
          </div>
        )}

        {currentStatus && (
          <section className={`rounded-[28px] border p-4 shadow-sm ${statusBoxClass(currentStatus.status)}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{statusIcon(currentStatus.status)}</div>
                <div>
                  <div className="text-lg font-black">{statusLabel(currentStatus.status)}</div>
                  <div className="mt-1 text-sm font-semibold">
                    Montant : {formatMoney(currentStatus.amount)} · Référence : {currentStatus.id.slice(0, 8)}
                  </div>
                  {currentStatus.status === "succeeded" ? (
                    <div className="mt-2 text-xs font-bold leading-5">
                      Reçu officiel généré{currentStatus.receipt_no ? ` : ${currentStatus.receipt_no}` : ""}.
                    </div>
                  ) : (
                    <div className="mt-2 text-xs font-bold leading-5">
                      Aucun reçu officiel n’est créé tant que le paiement n’est pas confirmé par l’opérateur.
                    </div>
                  )}
                  {currentStatus.error_message ? (
                    <div className="mt-2 text-xs font-bold leading-5">{currentStatus.error_message}</div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => checkIntent(currentIntentId)}
                disabled={checkingStatus}
                className="inline-flex w-fit items-center justify-center gap-2 rounded-2xl bg-white/70 px-4 py-2 text-sm font-black shadow-sm ring-1 ring-black/5 disabled:opacity-60"
              >
                {checkingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Vérifier
              </button>
            </div>
          </section>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="text-lg font-black text-slate-900">Aucun enfant rattaché</div>
            <p className="mt-2 text-sm text-slate-600">
              Retournez dans l’espace parent pour rattacher un enfant avec son matricule.
            </p>
          </div>
        )}

        {!loading && items.length > 0 && !hasAnyConfiguredProvider && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="text-lg font-black text-slate-900">Paiement en ligne non activé</div>
            <p className="mt-2 text-sm text-slate-600">
              Cet établissement n’a configuré aucun opérateur de paiement. L’écran reste donc volontairement simple, sans bloc opérateur.
            </p>
          </div>
        )}

        {!loading && items.length > 0 && hasAnyConfiguredProvider && (
          <form onSubmit={submitPayment} className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <section className="space-y-3">
              <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                <label className="text-sm font-black text-slate-800">Enfant concerné</label>
                <div className="mt-3 grid gap-2">
                  {items.map((child) => {
                    const active = child.student_id === selectedStudentId;
                    return (
                      <button
                        key={child.student_id}
                        type="button"
                        onClick={() => {
                          setSelectedStudentId(child.student_id);
                          setPayerName(child.student_name || "");
                          setCurrentStatus(null);
                          setCurrentIntentId("");
                        }}
                        className={[
                          "rounded-3xl border p-4 text-left transition",
                          active
                            ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100"
                            : "border-slate-200 bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="font-black text-slate-950">{child.student_name}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-600">
                          {child.class_label || "Classe non précisée"} · {child.institution_name}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            {child.charges.length} frais à régler
                          </span>
                          {(child.providers || []).length > 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">
                              Paiement en ligne actif
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                <label className="text-sm font-black text-slate-800">Frais à payer</label>
                <div className="mt-3 space-y-2">
                  {(selectedChild?.charges || []).length === 0 ? (
                    <div className="rounded-3xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                      Aucun frais ouvert pour cet enfant.
                    </div>
                  ) : (
                    selectedChild!.charges.map((charge) => {
                      const active = charge.id === selectedChargeId;
                      return (
                        <button
                          key={charge.id}
                          type="button"
                          onClick={() => {
                            setSelectedChargeId(charge.id);
                            setCurrentStatus(null);
                            setCurrentIntentId("");
                          }}
                          className={[
                            "flex w-full items-center justify-between gap-3 rounded-3xl border p-4 text-left transition",
                            active
                              ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100"
                              : "border-slate-200 bg-white hover:bg-slate-50",
                          ].join(" ")}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-black text-slate-950">{charge.label}</span>
                            <span className="mt-1 block text-xs font-semibold text-slate-500">
                              Échéance : {dueLabel(charge.due_date)}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-lg font-black text-slate-950">
                              {formatMoney(charge.balance_due)}
                            </span>
                            <span className="text-xs font-bold text-slate-500">reste dû</span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            <aside className="space-y-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24 lg:self-start">
              <div>
                <label className="text-sm font-black text-slate-800">Moyen de paiement</label>
                <div className="mt-3 grid gap-2">
                  {(selectedChild?.providers || []).length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                      Aucun opérateur configuré pour cet établissement.
                    </div>
                  ) : (
                    selectedChild!.providers.map((provider) => {
                      const active = selectedProvider === provider.provider;
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => setSelectedProvider(provider.provider)}
                          className={[
                            "flex w-full items-center justify-between gap-3 rounded-3xl border p-3 text-left transition",
                            active
                              ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100"
                              : "border-slate-200 bg-white hover:bg-slate-50",
                          ].join(" ")}
                        >
                          <div className="min-w-0">
                            <OperatorLogo
                              provider={provider.provider}
                              label={provider.label}
                              size="md"
                              showLabel
                              showNote
                            />
                          </div>
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-[11px] font-black ring-1",
                              provider.environment === "production"
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-amber-50 text-amber-800 ring-amber-200",
                            ].join(" ")}
                          >
                            {provider.environment === "production" ? "Actif" : "Test"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-black text-slate-800">Nom du payeur</label>
                <input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Nom et prénom"
                />
              </div>

              <div>
                <label className="text-sm font-black text-slate-800">Numéro du payeur</label>
                <input
                  value={payerPhone}
                  onChange={(e) => setPayerPhone(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Ex : 07 00 00 00 00"
                  inputMode="tel"
                />
              </div>

              <div>
                <label className="text-sm font-black text-slate-800">Montant à payer</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Montant"
                  inputMode="numeric"
                />
                {selectedCharge && (
                  <div className="mt-2 text-xs font-semibold text-slate-500">
                    Reste dû maximum : {formatMoney(selectedCharge.balance_due)}
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Résumé</div>
                <div className="mt-2 space-y-2 text-sm font-bold text-slate-700">
                  <div>{selectedChild?.student_name || "Élève"}</div>
                  <div>{selectedCharge?.label || "Frais"}</div>
                  {selectedProvider ? (
                    <div>
                      <OperatorLogo
                        provider={selectedProvider}
                        label={(selectedChild?.providers || []).find((provider) => provider.provider === selectedProvider)?.label || undefined}
                        size="sm"
                        showLabel
                      />
                    </div>
                  ) : null}
                  <div className="text-lg font-black text-emerald-700">{formatMoney(Number(amount || 0))}</div>
                </div>
              </div>

              {(selectedChild?.providers || []).length === 0 && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                  Le paiement en ligne n’est pas encore activé pour cet établissement.
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? "Initialisation…" : "Payer maintenant"}
              </button>
            </aside>
          </form>
        )}
      </main>
    </div>
  );
}
