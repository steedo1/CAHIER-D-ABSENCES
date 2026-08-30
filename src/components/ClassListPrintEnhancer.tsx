"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

type PrintMode = "provisional" | "class-list";

type PrintMutationState = {
  title: HTMLElement | null;
  originalTitle: string;
  changedNames: Array<{ cell: HTMLElement; original: string }>;
  changedHeaders: Array<{ cell: HTMLElement; original: string }>;
  addedCells: HTMLElement[];
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

function isUppercaseToken(value: string) {
  const letters = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return Boolean(letters) && letters === letters.toUpperCase();
}

function compactPrintedName(value: string) {
  const full = cleanText(value);
  const tokens = full.split(" ").filter(Boolean);
  if (tokens.length <= 4) return full;

  let surnameTokenCount = 0;
  for (const token of tokens) {
    if (!isUppercaseToken(token)) break;
    surnameTokenCount += 1;
  }
  if (surnameTokenCount === 0 || surnameTokenCount === tokens.length) {
    surnameTokenCount = 1;
  }

  const surname = tokens.slice(0, surnameTokenCount);
  const givenNames = tokens.slice(surnameTokenCount);
  const kept = givenNames.slice(0, 2);
  const initials = givenNames.slice(2).map((name) => {
    const initial = name.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+/, "").charAt(0);
    return initial ? `${initial.toUpperCase()}.` : "";
  });

  return [...surname, ...kept, ...initials].filter(Boolean).join(" ");
}

function applyPrintMutations(sheet: HTMLElement, mode: PrintMode): PrintMutationState {
  const state: PrintMutationState = {
    title: sheet.querySelector<HTMLElement>(".list-title"),
    originalTitle: "",
    changedNames: [],
    changedHeaders: [],
    addedCells: [],
  };

  if (state.title) {
    state.originalTitle = cleanText(state.title.textContent);
    const classLabel = classLabelFromTitle(state.title);
    const prefix = mode === "provisional" ? "LISTE PROVISOIRE" : "LISTE DE CLASSE";
    state.title.textContent = classLabel ? `${prefix} ${classLabel}` : prefix;
  }

  const table = sheet.querySelector<HTMLTableElement>(".roster-table");
  const headerRow = table?.querySelector<HTMLTableRowElement>("thead tr") || null;
  if (!table || !headerRow) return state;

  Array.from(headerRow.cells).forEach((cell) => {
    const original = cleanText(cell.textContent);
    const match = original.match(/^Note\s*(\d+)$/i);
    if (!match) return;
    state.changedHeaders.push({ cell, original });
    cell.textContent = `Note ${match[1]}`;
    cell.classList.add("class-list-note-header");
  });

  for (const note of [5, 6]) {
    const th = document.createElement("th");
    th.className = "class-list-note-extra class-list-note-header";
    th.dataset.classListPrintExtra = "true";
    th.textContent = `Note ${note}`;
    headerRow.appendChild(th);
    state.addedCells.push(th);
  }

  const bodyRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  bodyRows.forEach((row) => {
    const emptyCell = row.querySelector<HTMLTableCellElement>("td[colspan]");
    if (emptyCell) {
      emptyCell.colSpan = headerRow.cells.length;
      return;
    }

    const nameCell = row.querySelector<HTMLElement>("td.col-name");
    if (nameCell) {
      const original = cleanText(nameCell.textContent);
      const compact = compactPrintedName(original);
      if (compact && compact !== original) {
        state.changedNames.push({ cell: nameCell, original });
        nameCell.textContent = compact;
      }
    }

    for (const note of [5, 6]) {
      const td = document.createElement("td");
      td.className = "class-list-note-extra";
      td.dataset.classListPrintExtra = "true";
      td.dataset.note = String(note);
      row.appendChild(td);
      state.addedCells.push(td);
    }
  });

  const count = bodyRows.filter((row) => !row.querySelector("td[colspan]")).length;
  const rowHeightMm = count <= 0 ? 8 : Math.max(5.8, Math.min(12.8, 190 / count));
  const fontSizePx = count <= 18 ? 12.4 : count <= 25 ? 11.7 : count <= 35 ? 11 : 10.4;
  sheet.style.setProperty("--class-list-row-height", `${rowHeightMm.toFixed(2)}mm`);
  sheet.style.setProperty("--class-list-font-size", `${fontSizePx}px`);
  sheet.style.setProperty(
    "--class-list-header-font-size",
    `${Math.min(12.5, fontSizePx + 0.4)}px`,
  );

  return state;
}

function restorePrintMutations(state: PrintMutationState | null) {
  if (!state) return;
  if (state.title && state.originalTitle) state.title.textContent = state.originalTitle;
  state.changedNames.forEach(({ cell, original }) => {
    cell.textContent = original;
  });
  state.changedHeaders.forEach(({ cell, original }) => {
    cell.textContent = original;
    cell.classList.remove("class-list-note-header");
  });
  state.addedCells.forEach((cell) => cell.remove());
}

export default function ClassListPrintEnhancer() {
  const pathname = usePathname();
  const isClassListPage = Boolean(pathname?.startsWith("/admin/classes/liste/"));
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

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

  function print(mode: PrintMode) {
    const sheet = document.querySelector<HTMLElement>(".class-list-sheet");
    if (!sheet) return;

    const mutationState = applyPrintMutations(sheet, mode);
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      restorePrintMutations(mutationState);
      window.removeEventListener("afterprint", restore);
    };

    window.addEventListener("afterprint", restore, { once: true });
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

      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm 6mm 8mm;
          }

          .class-list-sheet {
            box-sizing: border-box !important;
            width: 198mm !important;
            max-width: 198mm !important;
            min-height: 283mm !important;
            height: auto !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: visible !important;
            padding: 0 !important;
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
            table-layout: fixed !important;
            font-size: var(--class-list-font-size, 11px) !important;
            line-height: 1.18 !important;
            margin-bottom: 2mm !important;
          }

          .roster-table thead {
            display: table-header-group !important;
          }

          .roster-table thead th {
            font-size: var(--class-list-header-font-size, 11.4px) !important;
            line-height: 1.08 !important;
            padding: 1.35mm 0.45mm !important;
            vertical-align: middle !important;
          }

          .roster-table .class-list-note-header,
          .roster-table thead th:nth-child(n + 8) {
            white-space: nowrap !important;
            word-break: normal !important;
            overflow-wrap: normal !important;
            font-size: 8.4px !important;
            letter-spacing: -0.15px !important;
            padding-left: 0.15mm !important;
            padding-right: 0.15mm !important;
          }

          .roster-table tbody tr {
            height: var(--class-list-row-height, 6.5mm) !important;
            min-height: var(--class-list-row-height, 6.5mm) !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .roster-table tbody td {
            font-size: var(--class-list-font-size, 11px) !important;
            line-height: 1.16 !important;
            padding: 1.05mm 0.5mm !important;
            vertical-align: middle !important;
          }

          .roster-table th:nth-child(1),
          .roster-table td:nth-child(1) { width: 7mm !important; }
          .roster-table th:nth-child(2),
          .roster-table td:nth-child(2) { width: 18.5mm !important; }
          .roster-table th:nth-child(3),
          .roster-table td:nth-child(3) { width: 69mm !important; }
          .roster-table th:nth-child(4),
          .roster-table td:nth-child(4) { width: 9.5mm !important; }
          .roster-table th:nth-child(5),
          .roster-table td:nth-child(5) { width: 16.5mm !important; }
          .roster-table th:nth-child(6),
          .roster-table td:nth-child(6) { width: 9.5mm !important; }
          .roster-table th:nth-child(7),
          .roster-table td:nth-child(7) { width: 8.5mm !important; }
          .roster-table th:nth-child(n + 8),
          .roster-table td:nth-child(n + 8) { width: 9.9mm !important; text-align: center !important; }

          .roster-table .col-name {
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: clip !important;
            font-size: calc(var(--class-list-font-size, 11px) * 0.96) !important;
            font-weight: 800 !important;
          }

          .sheet-footer {
            position: static !important;
            flex: 0 0 auto !important;
            margin-top: auto !important;
            padding-top: 2mm !important;
            border-top: 1.2px solid #475569 !important;
            background: white !important;
            font-size: 9px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .export-brand-site { font-size: 9.4px !important; }
          .export-brand-slogan { font-size: 8.4px !important; }

          .class-list-watermark {
            position: fixed !important;
            left: 50% !important;
            top: 52% !important;
            width: 82mm !important;
            transform: translate(-50%, -50%) !important;
            opacity: 0.1 !important;
          }
        }
      `}</style>
    </>
  );
}
