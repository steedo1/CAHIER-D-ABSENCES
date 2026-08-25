"use client";

import { useEffect, type ReactNode } from "react";

const OUTSIDE_YEAR_MESSAGE = "Le mois choisi n’appartient pas à l’année scolaire sélectionnée.";

function findByText<T extends Element>(selector: string, text: string) {
  return Array.from(document.querySelectorAll<T>(selector)).find((node) =>
    String(node.textContent || "").includes(text),
  );
}

export default function PayrollInteractiveBehavior({ children }: { children: ReactNode }) {
  useEffect(() => {
    const monthInput = document.querySelector<HTMLInputElement>('input[type="month"][name="month"]');
    const payrollForm = monthInput?.closest("form") ?? null;
    if (!monthInput || !payrollForm) return;

    const submitButton = Array.from(
      payrollForm.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
    ).find((button) => String(button.textContent || "").includes("Calculer / actualiser la paie"));

    const lateInput = payrollForm.querySelector<HTMLInputElement>('input[name="late_tolerance_min"]');
    const earlyInput = payrollForm.querySelector<HTMLInputElement>('input[name="early_departure_tolerance_min"]');
    const referenceInput = payrollForm.querySelector<HTMLInputElement>('input[name="session_reference_minutes"]');
    const rateFirstInput = payrollForm.querySelector<HTMLInputElement>('input[name="rate_first"]');
    const rateSecondInput = payrollForm.querySelector<HTMLInputElement>('input[name="rate_second"]');

    const academicYearSelect = document.querySelector<HTMLSelectElement>('select[name="academic_year"]');
    const academicYearForm = academicYearSelect?.closest("form") ?? null;

    const setHiddenValue = (name: string, value: string) => {
      if (!academicYearForm) return;
      const hidden = academicYearForm.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
      if (hidden) hidden.value = value;
    };

    const syncYearSelector = () => {
      setHiddenValue("month", monthInput.value);
      if (lateInput) setHiddenValue("late_tolerance_min", lateInput.value);
      if (earlyInput) setHiddenValue("early_departure_tolerance_min", earlyInput.value);
      if (referenceInput) setHiddenValue("session_reference_minutes", referenceInput.value);
      if (rateFirstInput) setHiddenValue("rate_first", rateFirstInput.value);
      if (rateSecondInput) setHiddenValue("rate_second", rateSecondInput.value);
    };

    const normalizeCopy = () => {
      const heading = findByText<HTMLHeadingElement>("h2", "Calculer la paie");
      const intro = heading?.nextElementSibling;
      if (intro instanceof HTMLElement && intro.tagName === "P") {
        intro.textContent =
          "Les tolérances de retard et de sortie anticipée sont traitées séparément. Seul le dépassement est retenu.";
      }

      const ruleBox = Array.from(payrollForm.querySelectorAll<HTMLElement>("div")).find((node) =>
        String(node.textContent || "").includes("Règle appliquée :"),
      );
      if (ruleBox) {
        const strong = ruleBox.querySelector("strong");
        if (strong) {
          while (strong.nextSibling) strong.nextSibling.remove();
          strong.after(
            document.createTextNode(
              " une séance doit être démarrée et clôturée. Seules les minutes dépassant chaque tolérance sont déduites proportionnellement au tarif de la séance.",
            ),
          );
        }
      }
    };

    const enableCalculation = () => {
      // La validation définitive du mois reste côté serveur dans calculatePayrollAction.
      // Le bouton ne doit pas rester bloqué sur la valeur du mois rendue avant modification du champ.
      if (submitButton) submitButton.disabled = false;
      syncYearSelector();
      normalizeCopy();
    };

    const hideStaleOutsideWarning = () => {
      const warning = findByText<HTMLElement>("div", OUTSIDE_YEAR_MESSAGE);
      if (warning) warning.hidden = true;
    };

    const onMonthChange = () => {
      enableCalculation();
      hideStaleOutsideWarning();
    };

    const trackedInputs = [monthInput, lateInput, earlyInput, referenceInput, rateFirstInput, rateSecondInput].filter(
      (input): input is HTMLInputElement => Boolean(input),
    );

    for (const input of trackedInputs) {
      input.addEventListener("input", input === monthInput ? onMonthChange : enableCalculation);
      input.addEventListener("change", input === monthInput ? onMonthChange : enableCalculation);
    }

    enableCalculation();

    return () => {
      for (const input of trackedInputs) {
        input.removeEventListener("input", input === monthInput ? onMonthChange : enableCalculation);
        input.removeEventListener("change", input === monthInput ? onMonthChange : enableCalculation);
      }
    };
  }, []);

  return <>{children}</>;
}
