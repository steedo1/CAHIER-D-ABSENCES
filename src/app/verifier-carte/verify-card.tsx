"use client";
import { useEffect, useRef, useState } from "react";
export default function VerifyCard() {
  const [token,setToken] = useState(""), [busy,setBusy] = useState(false);
  const generation = useRef(0);
  const [result,setResult] = useState<{ valid?: boolean; school?: string; year?: string; reference?: string; error?: string } | null>(null);
  useEffect(() => {
    const acceptScan = () => {
      const next = window.location.hash.slice(1); if (!next) return;
      generation.current++; setToken(next); setResult(null); setBusy(false);
      window.history.replaceState(null, "", window.location.pathname);
    };
    acceptScan(); window.addEventListener("hashchange", acceptScan);
    return () => { generation.current++; window.removeEventListener("hashchange", acceptScan); };
  }, []);
  async function verify() {
    const scanGeneration = generation.current; setBusy(true); setResult(null);
    try {
      const response = await fetch("/api/public/school-cards/verify", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const next = await response.json(); if (scanGeneration === generation.current) setResult(next);
    } catch { if (scanGeneration === generation.current) setResult({ error: "Connexion indisponible. Réessayez." }); }
    finally { if (scanGeneration === generation.current) setBusy(false); }
  }
  return <main className="mx-auto max-w-lg space-y-5 p-6 pt-16 text-slate-900"><p className="font-semibold text-emerald-800">Mon Cahier</p><h1 className="text-3xl font-bold">Vérifier une carte scolaire</h1><p>La vérification contrôle l’inscription, l’établissement et l’année scolaire. Comparez la référence affichée avec celle imprimée sous le QR.</p><button disabled={!token || busy} onClick={verify} className="rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-40">{busy ? "Vérification…" : "Vérifier cette carte"}</button>{!token && <p>Scannez le QR de la carte pour ouvrir sa vérification.</p>}<div aria-live="polite">{result?.error ? <p className="rounded-xl bg-amber-50 p-4">{result.error.replaceAll("_"," ")}</p> : result && <section className={`space-y-2 rounded-xl p-5 ${result.valid ? "bg-emerald-50" : "bg-red-50"}`}><h2 className="text-xl font-semibold">{result.valid ? "Carte valide" : "Carte non valide"}</h2>{result.valid ? <><p>{result.school}</p><p>Année scolaire : {result.year}</p><p>Référence : <strong>{result.reference}</strong></p></> : <p>Présentez la carte à l’établissement pour contrôle.</p>}</section>}</div><p className="text-sm text-slate-500">Aucune donnée personnelle de l’élève n’est affichée sur cette page publique.</p></main>;
}
