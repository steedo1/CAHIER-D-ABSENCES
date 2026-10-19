import type { SchoolCycle } from "../school-cycles";

/** Use the existing administrator school-cycle selector; never infer a new scope. */
export type EvaluationSettingsCycle = "all" | SchoolCycle;

export function getEvaluationSettingsScope(
  selectedCycle: EvaluationSettingsCycle,
  enabledCycles: readonly SchoolCycle[],
): { showPrimaryEvents: boolean; showGradingPeriods: boolean } {
  const visible = enabledCycles.filter(
    cycle => selectedCycle === "all" || cycle === selectedCycle,
  );
  return {
    showPrimaryEvents: visible.includes("primary"),
    showGradingPeriods: visible.some(cycle => cycle !== "primary"),
  };
}

/** Non-primary period editor cannot escape the cycle chosen in the sidebar. */
export function isVisibleGradingPeriodCycle(
  cycle: SchoolCycle,
  selectedCycle: EvaluationSettingsCycle,
  hidePrimary: boolean,
): boolean {
  return (!hidePrimary || cycle !== "primary") &&
    (selectedCycle === "all" || cycle === selectedCycle);
}
