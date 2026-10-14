"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { fitClassListName, estimateClassListNameWidth } from "@/lib/class-list-name";

type PrintMode = "provisional" | "class-list";

type PrintMutationState = {
  title: HTMLElement | null;
  originalTitle: string;
  names: Array<{ cell: HTMLElement; text: string; fontSize: string }>;
};

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classLabelFromTitle(title: HTMLElement | null) {
  return cleanText(title?.textContent)
    .replace(/^LISTE\s+PROVISOIRE\s*/i, "")
    .replace(/^LISTE\s+DE\s+CLASSE\s*/i, "")
    .trim();
}

function applyPrintMutations(sheet: HTMLElement, mode: PrintMode): PrintMutationState {
  const state: PrintMutationState = {
    title: sheet.querySelector<HTMLElement>(".list-title"),
    originalTitle: "",
    names: [],
  };

  if (state.title) {
    state.originalTitle = cleanText(state.title.textContent);
    const classLabel = classLabelFromTitle(state.title);
    const prefix = mode === "provisional" ? "LISTE PROVISOIRE" : "LISTE DE CLASSE";
    state.title.textContent = classLabel ? `${prefix} ${classLabel}` : prefix;
  }

  const context = document.createElement("canvas").getContext("2d");
  if (context) context.font = "700 12px Arial, Helvetica, sans-serif";
  sheet.querySelectorAll<HTMLElement>("tbody .col-name").forEach((cell) => {
    state.names.push({ cell, text: cell.textContent || "", fontSize: cell.style.getPropertyValue("--class-list-name-font-size") });
    const fitted = fitClassListName({
      fullName: cell.dataset.fullName || cell.textContent || "",
      lastName: cell.dataset.lastName, firstName: cell.dataset.firstName,
    }, 285, (text) => context?.measureText(text).width ?? estimateClassListNameWidth(text));
    cell.textContent = fitted.text;
    cell.style.setProperty("--class-list-name-font-size", `${12 * fitted.scale}px`);
  });

  return state;
}

function restorePrintMutations(state: PrintMutationState | null) {
  if (!state) return;
  if (state.title && state.originalTitle) state.title.textContent = state.originalTitle;
  state.names.forEach(({ cell, text, fontSize }) => {
    cell.textContent = text;
    if (fontSize) cell.style.setProperty("--class-list-name-font-size", fontSize);
    else cell.style.removeProperty("--class-list-name-font-size");
  });
}

export default function ClassListPrintEnhancer() {
  const pathname = usePathname();
  const isClassListPage = Boolean(pathname?.startsWith("/admin/classes/liste/"));
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const printStates = useRef<PrintMutationState[]>([]);

  useEffect(() => {
    if (!isClassListPage) return;
    const beforePrint = () => {
      if (printStates.current.length > 0) return;
      printStates.current = Array.from(document.querySelectorAll<HTMLElement>(".class-list-sheet"))
        .map((sheet) => applyPrintMutations(sheet, "class-list"));
    };
    const afterPrint = () => {
      printStates.current.forEach(restorePrintMutations);
      printStates.current = [];
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      afterPrint();
    };
  }, [isClassListPage, pathname]);

  useEffect(() => {
    if (!isClassListPage) {
      setPortalTarget(null);
      return;
    }

    let attempts = 0;
    let interval: number | null = null;
    let exportButton: HTMLButtonElement | null = null;
    let helperText: HTMLElement | null = null;
    let originalExportDisplay = "";
    let originalHelperDisplay = "";

    const attachAfterReactLoaded = () => {
      attempts += 1;
      // IMPORTANT: aucune manipulation du DOM tant que React affiche le chargement.
      const sheet = document.querySelector<HTMLElement>(".class-list-sheet");
      if (!sheet) {
        if (attempts >= 80 && interval !== null) {
          window.clearInterval(interval);
          interval = null;
        }
        return;
      }

      const toolbars = Array.from(document.querySelectorAll<HTMLElement>(".screen-toolbar"));
      const toolbar = toolbars.find((item) =>
        cleanText(item.textContent).includes("Liste de classe imprimable"),
      );
      if (!toolbar) return;

      exportButton =
        (Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => cleanText(button.textContent) === "Exporter PDF",
        ) as HTMLButtonElement | undefined) || null;
      if (!exportButton) return;

      originalExportDisplay = exportButton.style.display;
      exportButton.style.display = "none";

      helperText =
        (Array.from(toolbar.querySelectorAll<HTMLElement>("div")).find((element) =>
          cleanText(element.textContent).startsWith("Vérifiez l’éducateur"),
        ) as HTMLElement | undefined) || null;
      if (helperText) {
        originalHelperDisplay = helperText.style.display;
        helperText.style.display = "none";
      }

      setPortalTarget(exportButton.parentElement);
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };

    attachAfterReactLoaded();
    if (!portalTarget) {
      interval = window.setInterval(attachAfterReactLoaded, 250);
    }

    return () => {
      if (interval !== null) window.clearInterval(interval);
      if (exportButton) exportButton.style.display = originalExportDisplay;
      if (helperText) helperText.style.display = originalHelperDisplay;
      setPortalTarget(null);
    };
    // portalTarget volontairement exclu: le polling doit rester one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClassListPage, pathname]);

  async function print(mode: PrintMode) {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".class-list-sheet"));
    if (sheets.length === 0) return;

    await Promise.all(sheets.flatMap((sheet) =>
      Array.from(sheet.querySelectorAll<HTMLImageElement>("img")).map((image) =>
        image.decode().catch(() => undefined),
      ),
    ));
    const mutationStates = sheets.map((sheet) => applyPrintMutations(sheet, mode));
    printStates.current = mutationStates;
    const restore = () => {
      if (printStates.current !== mutationStates) return;
      mutationStates.forEach(restorePrintMutations);
      printStates.current = [];
    };

    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        window.print();
        // Secours pour navigateurs qui n’émettent pas afterprint correctement.
        window.setTimeout(restore, 1500);
      }, 60);
    });
  }

  if (!isClassListPage || !portalTarget) return null;

  return (
    <>
      {createPortal(
        <>
          <button
            type="button"
            onClick={() => print("provisional")}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-100"
          >
            Liste provisoire
          </button>
          <button
            type="button"
            onClick={() => print("class-list")}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
          >
            Liste de classe
          </button>
        </>,
        portalTarget,
      )}


    </>
  );
}
