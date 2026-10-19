/** Compatibility with the existing DB CHECK(scale IN (5,10,20,40,60)).
 * Keep raw points untouched. Unsupported primary barèmes travel in the existing
 * primary title; official snapshots and all grade APIs expose the real barème.
 * No conversion/rounding of a pupil's mark and no schema change. */
const STORED_SCALES = new Set([5, 10, 20, 40, 60]);
const ENCODED = /^(MCPE:[OPIMD]:[A-Z][A-Z0-9_-]{0,19}(?::(?:french|arabic))?|Composition|Devoir):S(\d+(?:\.\d+)?)$/;
export const primaryStorageScale = (scale: number): number => STORED_SCALES.has(scale) ? scale : 60;
export function primaryScaleTitle(title: string, scale: number): string {
  return STORED_SCALES.has(scale) ? title : `${title}:S${scale}`;
}
export function primaryTitleScale(title: unknown): number | null {
  if (typeof title !== "string") return null;
  const match = ENCODED.exec(title);
  const scale = match ? Number(match[2]) : NaN;
  return Number.isFinite(scale) && scale > 0 && scale < 10000 ? scale : null;
}
export function primaryBaseTitle(title: unknown): unknown {
  return typeof title === "string" && primaryTitleScale(title) !== null ? ENCODED.exec(title)![1] : title;
}
export function withPrimaryDisplayScale<T extends { title?: string | null; scale: number | null }>(row: T): T {
  const scale = primaryTitleScale(row.title);
  return scale === null ? row : { ...row, scale };
}
