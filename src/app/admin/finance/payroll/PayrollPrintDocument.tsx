"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A body-level document avoids the admin grid/sidebar affecting pagination.
export default function PayrollPrintDocument({ children, autoPrint }: {
  children: ReactNode;
  autoPrint: boolean;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const printed = useRef(false);

  useEffect(() => {
    const node = document.createElement("div");
    node.className = "payroll-document-host";
    document.body.appendChild(node);
    document.body.classList.add("payroll-document-open");
    setHost(node);
    return () => {
      node.remove();
      document.body.classList.remove("payroll-document-open");
    };
  }, []);

  const print = useCallback(async () => {
    if (!host || busy.current) return;
    busy.current = true;
    setPreparing(true);
    setError("");
    const cleanups: Array<() => void> = [];
    try {
      const images = Array.from(host.querySelectorAll("img"));
      const loaded = images.map((img) => img.complete ? Promise.resolve() :
        new Promise<void>((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          cleanups.push(() => {
            img.removeEventListener("load", done);
            img.removeEventListener("error", done);
          });
        }));
      await Promise.race([
        Promise.all([document.fonts.ready, ...loaded]),
        new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 8000);
          cleanups.push(() => window.clearTimeout(timer));
        }),
      ]);
      if (!host.isConnected) return;
      if (images.some((img) => !img.complete || img.naturalWidth === 0)) {
        throw new Error("Le logo n’a pas pu être chargé. Rechargez la page puis réessayez.");
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!host.isConnected) return;
      window.focus();
      window.print();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’impression n’a pas démarré. Réessayez avec le bouton Imprimer.");
    } finally {
      cleanups.forEach((cleanup) => cleanup());
      busy.current = false;
      setPreparing(false);
    }
  }, [host]);

  useEffect(() => {
    if (!host || !autoPrint || printed.current) return;
    // The effect runs after React has committed the document and its images.
    printed.current = true;
    void print();
  }, [host, autoPrint, print]);

  if (!host) return <p role="status">Préparation de la fiche de paie…</p>;
  return createPortal(<>
    <style>{`
      body.payroll-document-open > :not(.payroll-document-host) { display:none!important; }
      .payroll-document-host { background:white;color:#0f172a;min-height:100vh; }
      .payroll-print-root { max-width:1100px;margin:0 auto;padding:24px; }
      .payroll-print-toolbar { padding:16px;background:#f1f5f9; }
      @page { size:A4 landscape;margin:12mm; }
      @media print {
        html,body,.payroll-document-host { margin:0!important;padding:0!important;min-height:0!important;background:white!important; }
        .payroll-print-toolbar { display:none!important; }
        .payroll-print-root { max-width:none;padding:0!important; }
        .payroll-print-root table { width:100%;table-layout:fixed; }
        .payroll-print-root th,.payroll-print-root td { overflow-wrap:anywhere; }
        .payroll-print-root thead { display:table-header-group; }
        .payroll-print-root tfoot { display:table-row-group; }
        .payroll-print-root tr,.payroll-signature { break-inside:avoid; }
        .payroll-print-root { print-color-adjust:exact;-webkit-print-color-adjust:exact; }
      }
    `}</style>
    <div className="payroll-print-toolbar">
      <button type="button" onClick={() => void print()} disabled={preparing}
        className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-60">
        {preparing ? "Préparation…" : "Imprimer / Enregistrer en PDF"}
      </button>
      <p className="mt-2 text-sm">Si la fenêtre d’impression ne s’ouvre pas automatiquement, utilisez ce bouton.</p>
      {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
    </div>
    <div className="payroll-print-root">{children}</div>
  </>, host);
}
