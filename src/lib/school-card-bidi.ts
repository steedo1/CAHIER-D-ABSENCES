import bidiFactory from "bidi-js";

const bidi = bidiFactory();
export const hasCardRtlText = (value: string) => /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(value);

/** Visual run order, with each RTL run still in logical order for Fontkit's
 * Arabic joining. Reversing characters before shaping breaks connected forms. */
export function schoolCardTextRuns(value: string): { text: string; rtl: boolean }[] {
  const embedding = bidi.getEmbeddingLevels(value);
  const logical: { text: string; rtl: boolean }[] = [], runByIndex: number[] = [];
  const mirrored = bidi.getMirroredCharactersMap(value, embedding);
  let previousLevel = -1;
  for (let i = 0; i < value.length; i++) {
    const level = embedding.levels[i];
    if (level !== previousLevel) { logical.push({ text: "", rtl: Boolean(level & 1) }); previousLevel = level; }
    runByIndex[i] = logical.length - 1;
    logical[logical.length - 1].text += mirrored.get(i) || value[i];
  }
  const indices = Array.from({ length: value.length }, (_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(value, embedding)) {
    const reversed = indices.slice(start, end + 1).reverse();
    indices.splice(start, reversed.length, ...reversed);
  }
  const seen = new Set<number>(), visual: typeof logical = [];
  for (const index of indices) {
    const run = runByIndex[index];
    if (!seen.has(run)) { seen.add(run); visual.push(logical[run]); }
  }
  return visual;
}
