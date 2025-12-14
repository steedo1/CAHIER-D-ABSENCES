// src/app/enseignant/signature/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type SignatureMeta = {
  storage_path: string;
  sha256: string;
  updated_at: string;
};

type ApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; signature: SignatureMeta | null }
  | { status: "error"; error: string };

export default function TeacherSignaturePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const [state, setState] = useState<ApiState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  const size = useMemo(() => ({ w: 520, h: 220 }), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState({ status: "loading" });
      try {
        const res = await fetch("/api/teacher/signature", { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (cancelled) return;

        if (!res.ok) {
          setState({ status: "error", error: json?.error || "Erreur" });
        } else {
          setState({ status: "ok", signature: json?.signature ?? null });
        }
      } catch (e: any) {
        if (!cancelled) setState({ status: "error", error: e?.message || "Erreur réseau" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    // fond blanc
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);

    // style trait
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = (e: any) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    const x = ((clientX - rect.left) / rect.width) * c.width;
    const y = ((clientY - rect.top) / rect.height) * c.height;
    return { x, y };
  };

  const onDown = (e: any) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    // évite le scroll/zoom mobile pendant le dessin
    if (e?.preventDefault) e.preventDefault();

    drawing.current = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const onMove = (e: any) => {
    if (!drawing.current) return;

    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    if (e?.preventDefault) e.preventDefault();

    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const onUp = () => {
    drawing.current = false;
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  const save = async () => {
    const c = canvasRef.current;
    if (!c) return;

    setSaving(true);
    try {
      const png = c.toDataURL("image/png"); // data:image/png;base64,...

      const res = await fetch("/api/teacher/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ png_base64: png }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Échec sauvegarde");

      // reload meta
      const r2 = await fetch("/api/teacher/signature", { cache: "no-store" });
      const j2 = await r2.json().catch(() => null);
      setState({ status: "ok", signature: j2?.signature ?? null });
    } catch (e: any) {
      setState({ status: "error", error: e?.message || "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  const signature = state.status === "ok" ? state.signature : null;

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Ma signature</h1>
          <p className="text-sm text-slate-600">
            Signez une fois. Si l’établissement active la signature électronique, elle apparaîtra sur les bulletins.
          </p>
        </div>
        <Link href="/choose-book" className="rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          Retour
        </Link>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase text-slate-500">Zone de signature</div>

        <div className="mt-3 overflow-hidden rounded-xl border border-slate-300 bg-white">
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            className="w-full touch-none"
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clear}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            Effacer
          </button>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "Sauvegarde…" : "Enregistrer ma signature"}
          </button>
        </div>

        <div className="mt-4 text-sm">
          {state.status === "loading" ? (
            <span className="text-slate-600">Chargement…</span>
          ) : state.status === "error" ? (
            <span className="text-red-700">{state.error}</span>
          ) : state.status === "idle" ? (
            <span className="text-slate-600">—</span>
          ) : (
            <span className="text-slate-700">
              Signature enregistrée : <span className="font-semibold">{signature ? "Oui" : "Non"}</span>
              {signature?.updated_at ? (
                <span className="text-slate-500"> — {new Date(signature.updated_at).toLocaleString()}</span>
              ) : null}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
