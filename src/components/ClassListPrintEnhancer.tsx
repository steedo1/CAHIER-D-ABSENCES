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

function isUppercaseNameToken(value: string) {
  const letters = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return Boolean(letters) && letters === letters.toUpperCase();
}

function compactPrintedStudentName(value: string | null | undefined) {
  const full = cleanText(value);
  if (!full) return "";

  const tokens = full.split(" ").filter(Boolean);
  if (tokens.length <= 4) return full;

  // Le nom de famille est déjà rendu en majuscules dans la liste. On conserve
  // tous les tokens initiaux en majuscules quand ils sont identifiables.
  let surnameTokenCount = 0;
  for (const token of tokens) {
    if (!isUppercaseNameToken(token)) break;
    surnameTokenCount += 1;
  }

  // Si toute la chaîne est en majuscules, on garde le premier token comme nom
  // afin de ne pas empêcher l'abréviation des prénoms importés en capitales.
  if (surnameTokenCount === 0 || surnameTokenCount === tokens.length) {
    surnameTokenCount = 1;
  }

  const surname = tokens.slice(0, surnameTokenCount);
  const givenNames = tokens.slice(surnameTokenCount);
  const keptGivenNames = givenNames.slice(0, 2);
  const abbreviatedGivenNames = givenNames.slice(2).map((name) => {
    const initial = name.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+/, "").charAt(0);
    return initial ? `${initial.toUpperCase()}.` : "";
  });

  return [...surname, ...keptGivenNames, ...abbreviatedGivenNames]
    .filter(Boolean)
    .join(" ");
}

function normalizeNoteHeaders(headerRow: HTMLTableRowElement) {
  Array.from(headerRow.cells).forEach((cell) => {
    const match = cleanText(cell.textContent).match(/^Note\s*(\d+)$/i);
    if (!match) return;

    cell.textContent = `Note ${match[1]}`;
    cell.classList.add("class-list-note-header");
  });
}

function enhanceRosterColumnsAndNames(sheet: HTMLElement) {
  const table = sheet.querySelector<HTMLTableElement>(".roster-table");
  if (!table) return;

  const headerRow = table.querySelector<HTMLTableRowElement>("thead tr");
  if (!headerRow) return;

  if (!headerRow.querySelector('[data-class-list-note="5"]')) {
    for (const note of [5, 6]) {
      const th = document.createElement("th");
      th.className = "class-list-note-extra class-list-note-header";
      th.dataset.classListNote = String(note);
      th.textContent = `Note ${note}`;
      headerRow.appendChild(th);
    }
  }

  normalizeNoteHeaders(headerRow);

  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  rows.forEach((row) => {
    const emptyCell = row.querySelector<HTMLTableCellElement>("td[colspan]");
    if (emptyCell) {
      emptyCell.colSpan = headerRow.cells.length;
      return;
    }

    const nameCell = row.querySelector<HTMLTableCellElement>("td.col-name");
    if (nameCell) {
      if (!nameCell.dataset.classListFullName) {
        nameCell.dataset.classListFullName = cleanText(nameCell.textContent);
      }
      const compact = compactPrintedStudentName(nameCell.dataset.classListFullName);
      if (cleanText(nameCell.textContent) !== compact) {
        nameCell.textContent = compact;
      }
      nameCell.title = nameCell.dataset.classListFullName;
    }

    if (!row.querySelector('[data-class-list-note="5"]')) {
      for (const note of [5, 6]) {
        const td = document.createElement("td");
        td.className = "class-list-note-extra";
        td.dataset.classListNote = String(note);
        row.appendChild(td);
      }
    }
  });
}

function applyResponsivePrintSizing(sheet: HTMLElement) {
  enhanceRosterColumnsAndNames(sheet);

  const rows = Array.from(
    sheet.querySelectorAll<HTMLTableRowElement>(".roster-table tbody tr"),
  ).filter((row) => !row.querySelector("td[colspan]"));
  const count = rows.length;

  // Objectif : une liste courte occupe réellement la feuille A4. Une liste
  // plus longue reste lisible et peut se fragmenter uniquement si des élèves
  // doivent réellement passer sur la page suivante.
  const rowHeightMm =
    count <= 0 ? 8 : Math.max(5.8, Math.min(12.8, 190 / count));
  const fontSizePx =
    count <= 18 ? 12.4 : count <= 25 ? 11.7 : count <= 35 ? 11 : 10.4;
  const headerFontSizePx = Math.min(12.5, fontSizePx + 0.4);

  sheet.style.setProperty("--class-list-row-height", `${rowHeightMm.toFixed(2)}mm`);
  sheet.style.setProperty("--class-list-font-size", `${fontSizePx}px`);
  sheet.style.setProperty("--class-list-header-font-size", `${headerFontSizePx}px`);
  sheet.dataset.rosterCount = String(count);
  sheet.dataset.rosterPagination = count <= 30 ? "single" : "multi";
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
          exportButton.dataset.classListOriginalDisplay =
            exportButton.style.display || "__empty__";
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
        .class-list-sheet .class-list-note-extra {
          width: 42px;
          text-align: center;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm 6mm 18mm;
          }

          .class-list-print-root {
            width: 100% !important;
          }

          .class-list-sheet {
            position: relative !important;
            box-sizing: border-box !important;
            width: 198mm !important;
            max-width: 198mm !important;
            min-height: 273mm !important;
            height: auto !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: visible !important;
            padding-bottom: 13mm !important;
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

          .roster-table thead th:nth-child(4),
          .roster-table thead th:nth-child(5),
          .roster-table thead th:nth-child(6),
          .roster-table thead th:nth-child(7) {
            white-space: nowrap !important;
            font-size: 9px !important;
          }

          .roster-table .class-list-note-header,
          .roster-table thead th:nth-child(n + 8) {
            white-space: nowrap !important;
            word-break: normal !important;
            overflow-wrap: normal !important;
            font-size: 8.6px !important;
            letter-spacing: -0.15px !important;
            padding-left: 0.2mm !important;
            padding-right: 0.2mm !important;
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
            padding: 1.05mm 0.55mm !important;
            vertical-align: middle !important;
            overflow-wrap: anywhere;
          }

          .roster-table th:nth-child(1),
          .roster-table td:nth-child(1) {
            width: 7mm !important;
          }

          .roster-table th:nth-child(2),
          .roster-table td:nth-child(2) {
            width: 18.5mm !important;
          }

          .roster-table th:nth-child(3),
          .roster-table td:nth-child(3) {
            width: 72mm !important;
          }

          .roster-table th:nth-child(4),
          .roster-table td:nth-child(4) {
            width: 9.5mm !important;
          }

          .roster-table th:nth-child(5),
          .roster-table td:nth-child(5) {
            width: 16.5mm !important;
          }

          .roster-table th:nth-child(6),
          .roster-table td:nth-child(6) {
            width: 9.5mm !important;
          }

          .roster-table th:nth-child(7),
          .roster-table td:nth-child(7) {
            width: 8.5mm !important;
          }

          .roster-table th:nth-child(n + 8),
          .roster-table td:nth-child(n + 8),
          .roster-table .class-list-note-extra {
            width: 9.3mm !important;
            min-width: 9.3mm !important;
            max-width: 9.3mm !important;
            text-align: center !important;
          }

          .roster-table .col-name {
            font-weight: 800 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: clip !important;
            font-size: calc(var(--class-list-font-size, 11px) * 0.96) !important;
          }

          .sheet-footer {
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

          .class-list-sheet[data-roster-pagination="single"] .sheet-footer {
            position: absolute !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
          }

          .class-list-sheet[data-roster-pagination="multi"] .sheet-footer {
            position: fixed !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 198mm !important;
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
