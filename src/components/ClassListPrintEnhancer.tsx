"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

type PrintMode = "provisional" | "class-list";

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function classLabelFromTitle(title: HTMLElement | null) {
  const current = cleanText(title?.textContent);
  return current
    .replace(/^LISTE\s+PROVISOIRE\s*/i, "")
    .replace(/^LISTE\s+DE\s+CLASSE\s*/i, "")
    .trim();
}

function applyResponsivePrintSizing(sheet: HTMLElement) {
  const rows = Array.from(
    sheet.querySelectorAll<HTMLTableRowElement>(".roster-table tbody tr"),
  ).filter((row) => !row.querySelector("td[colspan]"));
  const count = rows.length;

  // Objectif : une liste courte occupe vraiment la feuille A4 ; une grande
  // liste garde une police lisible et passe naturellement sur une 2e page.
  const rowHeightMm =
    count <= 0 ? 8 : Math.max(5.8, Math.min(12.8, 190 / count));
  const fontSizePx =
    count <= 18 ? 12.4 : count <= 25 ? 11.7 : count <= 35 ? 11 : 10.4;
  const headerFontSizePx = Math.min(12.5, fontSizePx + 0.4);

  sheet.style.setProperty("--class-list-row-height", `${rowHeightMm.toFixed(2)}mm`);
  sheet.style.setProperty("--class-list-font-size", `${fontSizePx}px`);
  sheet.style.setProperty("--class-list-header-font-size", `${headerFontSizePx}px`);
  sheet.dataset.rosterCount = String(count);
}

export default function ClassListPrintEnhancer() {
  const pathname = usePathname();
  const isClassListPage = Boolean(pathname?.startsWith("/admin/classes/liste/"));
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<PrintMode>("class-list");

  useEffect(() => {
    if (!isClassListPage) {
      setPortalTarget(null);
      return;
    }

    let observer: MutationObserver | null = null;

    const enhance = () => {
      const sheet = document.querySelector<HTMLElement>(".class-list-sheet");
      if (sheet) applyResponsivePrintSizing(sheet);

      const toolbars = Array.from(
        document.querySelectorAll<HTMLElement>(".screen-toolbar"),
      );
      const mainToolbar = toolbars.find((toolbar) =>
        cleanText(toolbar.textContent).includes("Liste de classe imprimable"),
      );
      if (!mainToolbar) return;

      const exportButton = Array.from(mainToolbar.querySelectorAll("button")).find(
        (button) => cleanText(button.textContent) === "Exporter PDF",
      ) as HTMLButtonElement | undefined;

      if (exportButton) {
        if (!exportButton.dataset.classListOriginalDisplay) {
          exportButton.dataset.classListOriginalDisplay = exportButton.style.display || "__empty__";
        }
        exportButton.style.display = "none";
        if (exportButton.parentElement) setPortalTarget(exportButton.parentElement);
      }
    };

    enhance();
    observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("beforeprint", enhance);

    return () => {
      observer?.disconnect();
      window.removeEventListener("beforeprint", enhance);
      const hiddenButtons = document.querySelectorAll<HTMLButtonElement>(
        "button[data-class-list-original-display]",
      );
      hiddenButtons.forEach((button) => {
        const original = button.dataset.classListOriginalDisplay;
        button.style.display = original === "__empty__" ? "" : original || "";
        delete button.dataset.classListOriginalDisplay;
      });
      setPortalTarget(null);
    };
  }, [isClassListPage]);

  function print(modeToUse: PrintMode) {
    const sheet = document.querySelector<HTMLElement>(".class-list-sheet");
    if (!sheet) return;

    applyResponsivePrintSizing(sheet);
    setMode(modeToUse);
    sheet.dataset.printMode = modeToUse;

    const title = sheet.querySelector<HTMLElement>(".list-title");
    const classLabel = classLabelFromTitle(title);
    const prefix =
      modeToUse === "provisional" ? "LISTE PROVISOIRE" : "LISTE DE CLASSE";
    if (title) title.textContent = classLabel ? `${prefix} ${classLabel}` : prefix;

    // Laisser le navigateur appliquer le nouveau titre et les variables de
    // densité avant d'ouvrir la boîte d'impression.
    requestAnimationFrame(() => {
      setTimeout(() => window.print(), 40);
    });
  }

  if (!isClassListPage) return null;

  const buttons = portalTarget
    ? createPortal(
        <>
          <button
            type="button"
            onClick={() => print("provisional")}
            aria-pressed={mode === "provisional"}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-100"
            title="Imprimer avec le titre LISTE PROVISOIRE"
          >
            Liste provisoire
          </button>
          <button
            type="button"
            onClick={() => print("class-list")}
            aria-pressed={mode === "class-list"}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
            title="Imprimer avec le titre LISTE DE CLASSE"
          >
            Liste de classe
          </button>
        </>,
        portalTarget,
      )
    : null;

  return (
    <>
      {buttons}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm 6mm 18mm;
          }

          .class-list-print-root {
            width: 100% !important;
          }

          .class-list-sheet {
            box-sizing: border-box !important;
            width: 198mm !important;
            max-width: 198mm !important;
            min-height: 273mm !important;
            height: auto !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: visible !important;
          }

          .official-header {
            flex: 0 0 auto !important;
            margin-bottom: 2.5mm !important;
            gap: 7px !important;
          }

          .school-logo {
            width: 48px !important;
            height: 48px !important;
          }

          .school-name {
            font-size: 12.8px !important;
            line-height: 1.12 !important;
          }

          .school-meta {
            font-size: 9.4px !important;
            line-height: 1.3 !important;
          }

          .list-title {
            max-width: 100% !important;
            width: auto !important;
            white-space: normal !important;
            font-size: 16.2px !important;
            line-height: 1.08 !important;
            padding: 6px 7px !important;
            border-width: 3px !important;
          }

          .right-meta {
            font-size: 10.4px !important;
            line-height: 1.3 !important;
          }

          .staff-line {
            flex: 0 0 auto !important;
            grid-template-columns: 1fr 1fr 1fr !important;
            gap: 6px !important;
            margin: 2mm 0 2.7mm !important;
            padding: 5px 6px !important;
            font-size: 10.3px !important;
            line-height: 1.25 !important;
          }

          .roster-table {
            width: 100% !important;
            font-size: var(--class-list-font-size, 11px) !important;
            line-height: 1.18 !important;
            margin-bottom: 2mm !important;
          }

          .roster-table thead {
            display: table-header-group !important;
          }

          .roster-table thead th {
            font-size: var(--class-list-header-font-size, 11.4px) !important;
            line-height: 1.15 !important;
            padding: 1.5mm 1mm !important;
          }

          .roster-table tbody tr {
            height: var(--class-list-row-height, 6.5mm) !important;
            min-height: var(--class-list-row-height, 6.5mm) !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .roster-table tbody td {
            font-size: var(--class-list-font-size, 11px) !important;
            line-height: 1.18 !important;
            padding: 1.05mm 1mm !important;
            vertical-align: middle !important;
            overflow-wrap: anywhere;
          }

          .roster-table .col-name {
            font-weight: 800 !important;
          }

          .sheet-footer {
            position: fixed !important;
            left: 0 !important;
            right: 0 !important;
            bottom: -13mm !important;
            width: 198mm !important;
            box-sizing: border-box !important;
            grid-template-columns: 1fr 1.45fr 1fr !important;
            gap: 8px !important;
            margin: 0 !important;
            padding-top: 2.5mm !important;
            border-top: 1.2px solid #475569 !important;
            background: #ffffff !important;
            font-size: 9.7px !important;
            line-height: 1.25 !important;
            color: #1f2937 !important;
            z-index: 1000 !important;
          }

          .export-brand-site {
            font-size: 10.2px !important;
          }

          .export-brand-slogan {
            font-size: 9.1px !important;
          }

          .class-list-watermark {
            position: fixed !important;
            top: 50% !important;
            left: 50% !important;
            width: 82mm !important;
            max-height: 120mm !important;
            transform: translate(-50%, -50%) !important;
            opacity: 0.1 !important;
          }
        }
      `}</style>
    </>
  );
}
