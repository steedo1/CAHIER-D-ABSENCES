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

    const enableCalculation = () => {
      // La validité finale du mois est contrôlée par calculatePayrollAction côté serveur.
      // Ici, on évite uniquement que le bouton reste figé sur l'état du premier rendu.
      if (submitButton) submitButton.disabled = false;
      syncYearSelector();
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

    const onInputKeyDown = (event: KeyboardEvent) => {
      // Un champ de formulaire peut soumettre implicitement le formulaire avec Entrée.
      // Sur la paie, seul un clic explicite sur le bouton doit lancer le calcul.
      if (event.key === "Enter") {
        event.preventDefault();
      }
    };

    const onFormSubmit = (event: SubmitEvent) => {
      // Bloque toute soumission implicite (validation du sélecteur de mois, touche Entrée,
      // comportement navigateur) afin qu'un simple changement de mois ne quitte jamais la page.
      if (!submitButton || event.submitter !== submitButton) {
        event.preventDefault();
      }
    };

    for (const input of trackedInputs) {
      input.addEventListener("input", input === monthInput ? onMonthChange : enableCalculation);
      input.addEventListener("change", input === monthInput ? onMonthChange : enableCalculation);
      input.addEventListener("keydown", onInputKeyDown);
    }
    payrollForm.addEventListener("submit", onFormSubmit);

    enableCalculation();

    return () => {
      for (const input of trackedInputs) {
        input.removeEventListener("input", input === monthInput ? onMonthChange : enableCalculation);
        input.removeEventListener("change", input === monthInput ? onMonthChange : enableCalculation);
        input.removeEventListener("keydown", onInputKeyDown);
      }
      payrollForm.removeEventListener("submit", onFormSubmit);
    };
  }, []);

  return <>{children}</>;
}
