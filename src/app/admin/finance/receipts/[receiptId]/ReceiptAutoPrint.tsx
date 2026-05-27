"use client";

import { useEffect } from "react";

type ReceiptAutoPrintProps = {
  enabled: boolean;
  delayMs?: number;
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

export default function ReceiptAutoPrint({
  enabled,
  delayMs = 220,
}: ReceiptAutoPrintProps) {
  useEffect(() => {
    if (!enabled) return;

    let alreadyPrinted = false;
    const cleanups: Array<() => void> = [];

    const launchPrint = () => {
      if (alreadyPrinted) return;
      alreadyPrinted = true;

      window.setTimeout(async () => {
        try {
          await waitForFonts();
          await waitForImages();
          await waitForLayout();
          window.focus();
          window.print();
        } catch {
          // La page reste ouverte si le navigateur refuse l'ouverture automatique.
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
  }, [enabled, delayMs]);

  return null;
}
