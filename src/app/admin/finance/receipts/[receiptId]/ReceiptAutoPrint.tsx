"use client";

import { useEffect } from "react";

type ReceiptAutoPrintProps = {
  enabled: boolean;
  receiptId: string;
  issueId?: string;
  delayMs?: number;
};

type PreparedPrint = {
  ok?: boolean;
  print_kind?: "original" | "duplicate";
  duplicate_number?: number | null;
  generated_at?: string | null;
  issued_at?: string | null;
  official_number?: string | null;
  error?: string;
};

function waitForFonts() {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return Promise.resolve();
  }

  return Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => window.setTimeout(resolve, 500)),
  ]).then(() => undefined);
}

function waitForImages() {
  if (typeof document === "undefined") return Promise.resolve();

  const pendingImages = Array.from(document.images).filter(
    (img) => !img.complete,
  );

  if (pendingImages.length === 0) return Promise.resolve();

  return Promise.race([
    Promise.all(
      pendingImages.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, 900)),
  ]).then(() => undefined);
}

function waitForLayout() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function applyPreparedPrint(meta: PreparedPrint) {
  document
    .querySelectorAll<HTMLElement>("[data-official-print-warning]")
    .forEach((el) => {
      el.dataset.visible = "false";
      el.textContent = "";
    });

  const isDuplicate = meta.print_kind === "duplicate";
  const duplicateNumber = Number(meta.duplicate_number || 0);
  const issuedAt = formatDateTime(meta.issued_at);
  const generatedAt = formatDateTime(meta.generated_at);

  document.querySelectorAll<HTMLElement>("[data-duplicata-banner]").forEach((el) => {
    el.dataset.visible = isDuplicate ? "true" : "false";
    el.textContent = isDuplicate ? `DUPLICATA N° ${duplicateNumber}` : "";
  });

  document
    .querySelectorAll<HTMLElement>("[data-duplicata-watermark]")
    .forEach((el) => {
      el.dataset.visible = isDuplicate ? "true" : "false";
    });

  document.querySelectorAll<HTMLElement>("[data-official-print-meta]").forEach((el) => {
    el.textContent = isDuplicate
      ? `Duplicata n° ${duplicateNumber}${issuedAt ? ` — original du ${issuedAt}` : ""}${generatedAt ? ` — tiré le ${generatedAt}` : ""}`
      : `Exemplaire original${generatedAt ? ` enregistré le ${generatedAt}` : ""}`;
  });
}

async function prepareReceiptPrint(
  receiptId: string,
  issueId?: string,
): Promise<PreparedPrint | null> {
  const response = await fetch("/api/admin/duplicata/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      document_type: "receipt",
      source_id: receiptId,
      issue_id: issueId || null,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as PreparedPrint;
  if (!response.ok || !payload.ok) {
    window.alert(
      payload.error || "Impossible de préparer l’impression du duplicata.",
    );
    return null;
  }

  return payload;
}

export default function ReceiptAutoPrint({
  enabled,
  receiptId,
  issueId,
  delayMs = 220,
}: ReceiptAutoPrintProps) {
  useEffect(() => {
    if (!enabled || !receiptId) return;

    let alreadyPrinted = false;
    const cleanups: Array<() => void> = [];

    const launchPrint = () => {
      if (alreadyPrinted) return;
      alreadyPrinted = true;

      window.setTimeout(async () => {
        try {
          const prepared = await prepareReceiptPrint(receiptId, issueId);
          if (!prepared) return;
          applyPreparedPrint(prepared);
          await waitForFonts();
          await waitForImages();
          await waitForLayout();
          window.focus();
          window.print();
        } catch {
          window.alert(
            "L’impression n’a pas pu être préparée. La page reste ouverte.",
          );
        }
      }, delayMs);
    };

    if (document.readyState === "complete") {
      launchPrint();
    } else {
      window.addEventListener("load", launchPrint, { once: true });
      cleanups.push(() => window.removeEventListener("load", launchPrint));
    }

    const fallbackTimer = window.setTimeout(launchPrint, 1400);
    cleanups.push(() => window.clearTimeout(fallbackTimer));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [enabled, receiptId, issueId, delayMs]);

  return null;
}
