"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listOfflineOutboxEntries,
  registerOfflineSessionReference,
  removeQueuedOfflineMutation,
  type OfflineOutboxEntry,
} from "@/lib/offline";

type ClassItem = {
  id: string;
  label?: string | null;
  institution_id: string;
};

type ReconcileResult = {
  operation_id: string;
  operation_type: "session-start" | "attendance" | "session-end";
  acknowledged: boolean;
  session_id: string | null;
  reason: string;
};

type RowView = {
  operationId: string;
  operationType: string;
  state: string;
  lastStatus: number | null;
  lastError: string | null;
  result?: ReconcileResult | null;
};

const CALL_OPERATION_TYPES = new Set([
  "session-start",
  "attendance",
  "session-end",
]);

function scopedToClass(entry: OfflineOutboxEntry, cls: ClassItem, classCount: number) {
  const metaClassId = String(entry.meta?.classId || "").trim();
  const metaInstitutionId = String(entry.meta?.institutionId || "").trim();
  if (metaClassId && metaClassId !== cls.id) return false;
  if (metaInstitutionId && metaInstitutionId !== cls.institution_id) return false;
  if (!metaClassId && classCount > 1) return false;
  return CALL_OPERATION_TYPES.has(String(entry.operationType || ""));
}

export default function RecoverClassSyncPage() {
  const [status, setStatus] = useState("Analyse des opérations locales…");
  const [before, setBefore] = useState<number | null>(null);
  const [removed, setRemoved] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [rows, setRows] = useState<RowView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const done = remaining === 0 && before !== null;
  const unresolved = useMemo(
    () => rows.filter((row) => row.result && !row.result.acknowledged),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const classResponse = await fetch(
          "/api/class/my-classes?offline_contract=v5&sync_reconcile=1",
          { credentials: "include", cache: "no-store" },
        );
        if (!classResponse.ok) {
          throw new Error(`Contexte de classe indisponible (${classResponse.status}).`);
        }
        const classPayload = await classResponse.json();
        const classes = (Array.isArray(classPayload?.items)
          ? classPayload.items
          : [])
          .map((item: any) => ({
            id: String(item?.id || ""),
            label: item?.label || null,
            institution_id: String(item?.institution_id || ""),
          }))
          .filter((item: ClassItem) => item.id && item.institution_id);

        if (!classes.length) {
          throw new Error("Aucune classe autorisée n’a été trouvée sur ce téléphone.");
        }

        const initialEntries = await listOfflineOutboxEntries();
        const callEntries = initialEntries.filter((entry) =>
          CALL_OPERATION_TYPES.has(String(entry.operationType || "")),
        );
        if (cancelled) return;
        setBefore(callEntries.length);

        if (!callEntries.length) {
          setRemaining(0);
          setStatus("Aucun résidu d’appel à réconcilier.");
          window.setTimeout(() => window.location.replace("/class"), 900);
          return;
        }

        const resultByOperation = new Map<string, ReconcileResult>();
        let removedCount = 0;

        for (const cls of classes) {
          const entries = callEntries.filter((entry) =>
            scopedToClass(entry, cls, classes.length),
          );
          if (!entries.length) continue;

          setStatus(
            `Vérification Cloud de ${entries.length} opération(s) pour ${cls.label || "la classe"}…`,
          );

          const response = await fetch("/api/class/sync/reconcile", {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              class_id: cls.id,
              operations: entries.map((entry) => ({
                operation_id: entry.operationId,
                operation_type: entry.operationType,
                session_dependency_key: entry.sessionDependencyKey,
              })),
            }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload?.ok !== true) {
            throw new Error(
              String(payload?.error || `Réconciliation refusée (${response.status}).`),
            );
          }

          const results = Array.isArray(payload?.results)
            ? (payload.results as ReconcileResult[])
            : [];
          for (const result of results) {
            resultByOperation.set(result.operation_id, result);
          }

          for (const entry of entries) {
            const result = resultByOperation.get(entry.operationId);
            if (!result?.acknowledged) continue;

            if (
              result.operation_type === "session-start" &&
              result.session_id
            ) {
              await registerOfflineSessionReference(
                `client:${result.operation_id}`,
                result.session_id,
              ).catch(() => undefined);
            }

            await removeQueuedOfflineMutation(entry.id);
            removedCount += 1;
          }
        }

        const finalEntries = await listOfflineOutboxEntries();
        const finalCallEntries = finalEntries.filter((entry) =>
          CALL_OPERATION_TYPES.has(String(entry.operationType || "")),
        );
        if (cancelled) return;

        setRemoved(removedCount);
        setRemaining(finalCallEntries.length);
        setRows(
          callEntries.map((entry) => ({
            operationId: entry.operationId,
            operationType: String(entry.operationType || "inconnue"),
            state: entry.state,
            lastStatus: entry.lastStatus,
            lastError: entry.lastError,
            result: resultByOperation.get(entry.operationId) || null,
          })),
        );

        if (finalCallEntries.length === 0) {
          setStatus(
            `${removedCount} résidu(s) confirmé(s) par le Cloud ont été retirés de ce téléphone.`,
          );
          window.setTimeout(() => window.location.replace("/class"), 1400);
        } else {
          setStatus(
            `${finalCallEntries.length} opération(s) restent conservées : aucune suppression n’est faite sans preuve Cloud.`,
          );
        }
      } catch (cause: any) {
        if (cancelled) return;
        setError(String(cause?.message || "La réconciliation a échoué."));
        setStatus("Réconciliation interrompue.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span
            className={[
              "grid h-11 w-11 place-items-center rounded-full text-lg font-bold",
              done ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700",
            ].join(" ")}
          >
            {done ? "✓" : "↻"}
          </span>
          <div>
            <h1 className="text-xl font-semibold">Réconciliation de la synchronisation</h1>
            <p className="mt-1 text-sm text-slate-600">{status}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-slate-100 p-3">
            <div className="text-2xl font-bold">{before ?? "…"}</div>
            <div className="text-xs text-slate-600">avant</div>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3">
            <div className="text-2xl font-bold text-emerald-700">{removed}</div>
            <div className="text-xs text-emerald-700">confirmés Cloud</div>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3">
            <div className="text-2xl font-bold text-amber-700">{remaining ?? "…"}</div>
            <div className="text-xs text-amber-700">restants</div>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        )}

        {unresolved.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              Opérations encore protégées
            </p>
            <div className="mt-3 space-y-2 text-xs text-amber-900">
              {unresolved.map((row) => (
                <div key={row.operationId} className="rounded-xl bg-white/70 p-3">
                  <div className="font-semibold">{row.operationType}</div>
                  <div className="mt-1 break-all">{row.operationId}</div>
                  <div className="mt-1">
                    Cloud : {row.result?.reason || "non vérifié"} · local : {row.state}
                    {row.lastStatus ? ` / HTTP ${row.lastStatus}` : ""}
                    {row.lastError ? ` / ${row.lastError}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Cette page ne supprime une opération locale que lorsque le serveur prouve que
          l’ouverture, les marques ou la fermeture correspondantes existent déjà dans le Cloud.
        </p>

        <a
          href="/class"
          className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Retour aux appels
        </a>
      </section>
    </main>
  );
}
