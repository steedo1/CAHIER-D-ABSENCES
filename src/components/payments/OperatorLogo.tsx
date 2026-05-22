"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

export type PaymentOperatorCode =
  | "orange_money"
  | "wave"
  | "mtn_momo"
  | "moov_money"
  | "mock"
  | (string & {});

type OperatorVisual = {
  key: string;
  label: string;
  shortLabel: string;
  pill: string;
  mark: string;
  text: string;
  note: string;
  imageSources: string[];
};

const IMAGE_BASE = "/payment-operators";

const OPERATOR_VISUALS: Record<string, OperatorVisual> = {
  orange_money: {
    key: "orange_money",
    label: "Orange Money",
    shortLabel: "OM",
    pill: "border-orange-200 bg-orange-50 text-orange-950",
    mark: "bg-orange-500 text-white",
    text: "text-orange-950",
    note: "Money",
    imageSources: [
      `${IMAGE_BASE}/orange-money.png`,
      `${IMAGE_BASE}/orange-money.jpg`,
      `${IMAGE_BASE}/orange-money.jpeg`,
      `${IMAGE_BASE}/orange_money.png`,
      `${IMAGE_BASE}/orange_money.jpg`,
      `${IMAGE_BASE}/om.png`,
      `${IMAGE_BASE}/om.jpg`,
    ],
  },
  wave: {
    key: "wave",
    label: "Wave",
    shortLabel: "W",
    pill: "border-sky-200 bg-sky-50 text-sky-950",
    mark: "bg-sky-500 text-white",
    text: "text-sky-950",
    note: "Paiement mobile",
    imageSources: [
      `${IMAGE_BASE}/wave.png`,
      `${IMAGE_BASE}/wave.jpg`,
      `${IMAGE_BASE}/wave.jpeg`,
      `${IMAGE_BASE}/wave-business.png`,
      `${IMAGE_BASE}/wave-business.jpg`,
      `${IMAGE_BASE}/wave_business.png`,
      `${IMAGE_BASE}/wave_business.jpg`,
    ],
  },
  mtn_momo: {
    key: "mtn_momo",
    label: "MTN Mobile Money",
    shortLabel: "MTN",
    pill: "border-amber-200 bg-amber-50 text-slate-950",
    mark: "bg-yellow-300 text-slate-950 ring-1 ring-yellow-400",
    text: "text-slate-950",
    note: "MoMo",
    imageSources: [
      `${IMAGE_BASE}/mtn-mobile-money.png`,
      `${IMAGE_BASE}/mtn-mobile-money.jpg`,
      `${IMAGE_BASE}/mtn-mobile-money.jpeg`,
      `${IMAGE_BASE}/mtn-momo.png`,
      `${IMAGE_BASE}/mtn-momo.jpg`,
      `${IMAGE_BASE}/mtn_momo.png`,
      `${IMAGE_BASE}/mtn_momo.jpg`,
      `${IMAGE_BASE}/mtn.png`,
      `${IMAGE_BASE}/mtn.jpg`,
    ],
  },
  moov_money: {
    key: "moov_money",
    label: "Moov Money",
    shortLabel: "MV",
    pill: "border-blue-200 bg-blue-50 text-blue-950",
    mark: "bg-blue-600 text-white",
    text: "text-blue-950",
    note: "Money",
    imageSources: [
      `${IMAGE_BASE}/moov-money.png`,
      `${IMAGE_BASE}/moov-money.jpg`,
      `${IMAGE_BASE}/moov-money.jpeg`,
      `${IMAGE_BASE}/moov_money.png`,
      `${IMAGE_BASE}/moov_money.jpg`,
      `${IMAGE_BASE}/moov.png`,
      `${IMAGE_BASE}/moov.jpg`,
    ],
  },
  mock: {
    key: "mock",
    label: "Mode test",
    shortLabel: "TEST",
    pill: "border-slate-200 bg-slate-50 text-slate-950",
    mark: "bg-slate-900 text-white",
    text: "text-slate-950",
    note: "Sandbox",
    imageSources: [],
  },
};

const FALLBACK_VISUAL: OperatorVisual = {
  key: "fallback",
  label: "Mobile Money",
  shortLabel: "MM",
  pill: "border-slate-200 bg-white text-slate-950",
  mark: "bg-slate-900 text-white",
  text: "text-slate-950",
  note: "Opérateur",
  imageSources: [],
};

function normalizeOperatorKey(provider?: PaymentOperatorCode | null, label?: string | null) {
  const raw = `${provider || ""} ${label || ""}`.trim().toLowerCase();
  const key = raw.replace(/[\s_\-]+/g, "_");

  if (key.includes("orange") || key === "om") return "orange_money";
  if (key.includes("wave")) return "wave";
  if (key.includes("mtn") || key.includes("momo")) return "mtn_momo";
  if (key.includes("moov") || key.includes("moov_money")) return "moov_money";
  if (key.includes("mock") || key.includes("test") || key.includes("sandbox")) return "mock";

  return key;
}

function visualFor(provider: PaymentOperatorCode | null | undefined, label?: string | null) {
  const key = normalizeOperatorKey(provider, label);
  const visual = OPERATOR_VISUALS[key] || FALLBACK_VISUAL;
  const cleanLabel = String(label || "").trim();
  return cleanLabel ? { ...visual, label: cleanLabel } : visual;
}

export function getPaymentOperatorLabel(provider: PaymentOperatorCode | null | undefined, fallback?: string | null) {
  return visualFor(provider, fallback).label;
}

function WaveMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-5 w-5">
      <path
        d="M4 18.2c4.4-7.8 9.1-8.1 13.2-.9 2.9 5.1 6 5.4 10.8 1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="M6.5 23.5c3.5-2.7 6.6-2.3 9.4 1.3 2.6 3.3 5.7 3 9.6-.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        opacity="0.7"
      />
    </svg>
  );
}

function OperatorMark({ provider, shortLabel }: { provider?: PaymentOperatorCode | null; shortLabel: string }) {
  const key = normalizeOperatorKey(provider);

  if (key === "wave") return <WaveMark />;
  if (key === "orange_money") return <span className="text-[11px] font-black tracking-tight">om</span>;
  if (key === "mtn_momo") return <span className="text-[10px] font-black tracking-[-0.08em]">MTN</span>;
  if (key === "moov_money") return <span className="text-[10px] font-black tracking-tight">MV</span>;
  return <span className="text-[10px] font-black tracking-tight">{shortLabel.slice(0, 4)}</span>;
}

function OperatorImage({
  visual,
  size,
  compact = false,
}: {
  visual: OperatorVisual;
  size: "sm" | "md" | "lg";
  compact?: boolean;
}) {
  const sources = useMemo(() => visual.imageSources.filter(Boolean), [visual.imageSources]);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [visual.key, sources.length]);

  const src = sources[sourceIndex];
  const boxSize = compact
    ? size === "lg"
      ? "h-11 w-11 rounded-2xl"
      : size === "sm"
        ? "h-8 w-8 rounded-xl"
        : "h-9 w-9 rounded-xl"
    : size === "lg"
      ? "h-12 w-32 rounded-2xl"
      : size === "sm"
        ? "h-8 w-20 rounded-xl"
        : "h-10 w-28 rounded-2xl";

  if (!src) {
    return (
      <span className={`grid shrink-0 place-items-center ${boxSize} ${visual.mark}`}>
        <OperatorMark provider={visual.key as PaymentOperatorCode} shortLabel={visual.shortLabel} />
      </span>
    );
  }

  return (
    <span className={`relative shrink-0 overflow-hidden bg-white/90 p-1 ring-1 ring-slate-200 ${boxSize}`}>
      <Image
        src={src}
        alt={visual.label}
        fill
        sizes={compact ? "44px" : "128px"}
        className="object-contain p-1"
        unoptimized
        onError={() => setSourceIndex((current) => current + 1)}
      />
    </span>
  );
}

export function OperatorLogo({
  provider,
  label,
  size = "md",
  showLabel = true,
  showNote = false,
  className = "",
}: {
  provider?: PaymentOperatorCode | null;
  label?: string | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  showNote?: boolean;
  className?: string;
}) {
  const visual = visualFor(provider, label);
  const titleSize = size === "lg" ? "text-base" : size === "sm" ? "text-xs" : "text-sm";
  const padding = showLabel ? "px-2.5 py-2" : "px-2 py-2";

  return (
    <span
      title={visual.label}
      aria-label={visual.label}
      className={`inline-flex max-w-full items-center gap-2 rounded-2xl border shadow-sm ${padding} ${visual.pill} ${className}`}
    >
      <OperatorImage visual={visual} size={size} compact={!showLabel} />
      {showLabel ? (
        <span className="min-w-0 leading-tight">
          <span className={`block truncate font-black ${visual.text} ${titleSize}`}>{visual.label}</span>
          {showNote ? <span className="block truncate text-[11px] font-bold text-slate-500">{visual.note}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

export function OperatorLogoStack({
  providers,
  className = "",
  max = 4,
}: {
  providers?: Array<PaymentOperatorCode | { provider?: PaymentOperatorCode | null; label?: string | null }>;
  className?: string;
  max?: number;
}) {
  const normalized = (providers || []).slice(0, max).map((item) => {
    if (typeof item === "string") return { provider: item, label: undefined };
    return { provider: item.provider || "", label: item.label || undefined };
  });

  const visible = normalized.length
    ? normalized
    : [
        { provider: "orange_money" as PaymentOperatorCode, label: "Orange Money" },
        { provider: "wave" as PaymentOperatorCode, label: "Wave" },
        { provider: "mtn_momo" as PaymentOperatorCode, label: "MTN Mobile Money" },
      ];

  return (
    <span className={`inline-flex items-center ${className}`}>
      {visible.map((item, index) => {
        const visual = visualFor(item.provider, item.label);
        return (
          <span
            key={`${String(item.provider)}-${index}`}
            title={visual.label}
            aria-label={visual.label}
            className={`grid h-10 w-10 place-items-center rounded-2xl border-2 border-white bg-white shadow-sm ring-1 ring-slate-100 ${index > 0 ? "-ml-2" : ""}`}
          >
            <OperatorImage visual={visual} size="md" compact />
          </span>
        );
      })}
    </span>
  );
}
