/**
 * Print layout policy for Franco-Arabic bulletins.
 *
 * One student record may be presented through distinct layouts, while
 * program-specific results remain separate. There is deliberately no
 * "combinedAverage" field in the printable view.
 */
export type PrintableTeachingTrack = "french" | "arabic";
export type PrintableBulletinVariant = PrintableTeachingTrack | "combined" | "ordinary";

type PrintableProgramBase = {
  track: PrintableTeachingTrack;
  generalAverage: number | null;
};

export function selectPrintablePrograms<
  F extends PrintableProgramBase,
  A extends PrintableProgramBase
>(
  model: { french?: F | null; arabic?: A | null },
  variant: PrintableBulletinVariant,
): Array<F | A> | null {
  const french = model.french?.track === "french" ? model.french : null;
  const arabic = model.arabic?.track === "arabic" ? model.arabic : null;

  if (variant === "french" || variant === "ordinary") return french ? [french] : null;
  if (variant === "arabic") return arabic ? [arabic] : null;
  if (variant === "combined") return french && arabic ? [french, arabic] : null;
  return null;
}

/**
 * The two-program view has exactly two independent general averages.
 * No summation, weighted average or warning banner is required.
 */
export function printableAverageFields<
  T extends { track: PrintableTeachingTrack; generalAverage: number | null }
>(sections: readonly T[]): Partial<Record<PrintableTeachingTrack, number | null>> {
  const result: Partial<Record<PrintableTeachingTrack, number | null>> = {};
  for (const section of sections) result[section.track] = section.generalAverage;
  return result;
}

/** Readiness belongs to each server-calculated program, not to the selected
 * layout. A ready French report may be printed while Arabic is incomplete. */
export function isSpecializedBulletinPrintable(
  model: {
    french?: (PrintableProgramBase & { denominator: number; allowHistoricalNc?: boolean }) | null;
    arabic?: (PrintableProgramBase & { denominator: number; allowHistoricalNc?: boolean }) | null;
    sample?: boolean;
    draft?: boolean;
  },
  readiness: Partial<Record<PrintableTeachingTrack, boolean>> = {},
  variant: PrintableBulletinVariant,
): boolean {
  const programs = selectPrintablePrograms(model, variant);
  return !model.sample && !model.draft && !!programs?.length && programs.every(program =>
    readiness[program.track] === true && Number.isFinite(program.denominator) && program.denominator > 0 &&
    ((program.generalAverage !== null && Number.isFinite(program.generalAverage) &&
      program.generalAverage >= 0 && program.generalAverage <= program.denominator) ||
      (("allowHistoricalNc" in program) && program.allowHistoricalNc === true &&
        program.generalAverage === null)));
}
