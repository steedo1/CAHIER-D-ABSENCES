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

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/**
 * Export “encre noire” :
 * - enlève le fond blanc
 * - met les traits en noir
 * - boost alpha (très visible)
 * - micro-dilatation (gras)
 */
function exportInkPngFromCanvas(source: HTMLCanvasElement): string {
  const w = source.width;
  const h = source.height;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;

  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source.toDataURL("image/png");

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1) Noir + suppression du fond
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const a = d[i + 3];

    if (a < 8) {
      d[i + 3] = 0;
      continue;
    }

    // fond quasi blanc => transparent (seuil plus agressif)
    if (r > 240 && g > 240 && b > 240) {
      d[i + 3] = 0;
      continue;
    }

    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0..255
    let boostedA = (255 - lum) * 3.2; // boost très fort
    if (!Number.isFinite(boostedA)) boostedA = a;

    // On force un minimum d’opacité pour ne pas avoir une signature “grise”
    const newA = clamp(Math.max(a, Math.round(boostedA)), 160, 255);

    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = newA;
  }

  // 2) Micro “gras” : dilatation rayon 2px
  const orig = new Uint8ClampedArray(d);
  const W = w;

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = (y * W + x) * 4;
      const a = orig[idx + 3];
      if (a === 0) continue;

      const spread = clamp(Math.round(a * 0.7), 0, 255);

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = ((y + dy) * W + (x + dx)) * 4;
          if (d[j + 3] < spread) {
            d[j] = 0;
            d[j + 1] = 0;
            d[j + 2] = 0;
            d[j + 3] = spread;
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return c.toDataURL("image/png");
}

export default function TeacherSignaturePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const [state, setState] = useState<ApiState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  // taille logique (CSS)
  const size = useMemo(() => ({ w: 520, h: 220 }), []);
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    if (typeof window !== "undefined") setDpr(window.devicePixelRatio || 1);
  }, []);

  const canvasSize = useMemo(() => {
    // buffer réel (plus grand => plus net, moins “gris”)
    return {
      w: Math.round(size.w * dpr),
      h: Math.round(size.h * dpr),
    };
  }, [size.w, size.h, dpr]);

  const setupCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;

    // fond blanc (pour guider l’utilisateur)
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);

    // stylo : plus épais + noir pur (=> signature plus foncée)
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(5, Math.round(5 * dpr)); // ✅ beaucoup plus visible
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

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
    setupCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.w, canvasSize.h]);

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

    if (e?.preventDefault) e.preventDefault();

    drawing.current = true;
    // au cas où (certains browsers “reset” le style)
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(5, Math.round(5 * dpr));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

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
    setupCanvas();
  };

  const save = async () => {
    const c = canvasRef.current;
    if (!c) return;

    setSaving(true);
    try {
      // ✅ on exporte une version “encre noire” (fond transparent, traits gras)
      const png = exportInkPngFromCanvas(c);

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
            width={canvasSize.w}
            height={canvasSize.h}
            className="w-full touch-none"
            style={{ aspectRatio: `${size.w} / ${size.h}` }}
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

        <p className="mt-2 text-[12px] text-slate-500">
          Astuce : après cette mise à jour, fais <span className="font-semibold">Effacer</span>, signe à nouveau puis
          <span className="font-semibold"> Enregistrer</span> pour obtenir une signature très noire dans les bulletins.
        </p>
      </div>
    </main>
  );
}
