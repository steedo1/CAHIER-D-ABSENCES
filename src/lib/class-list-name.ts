type RosterName = { fullName: string; lastName?: string | null; firstName?: string | null };
const clean = (value: string | null | undefined) => String(value || "").replace(/\s+/g, " ").trim();
const initial = (name: string) => name.split(/[-‐‑]/).map(part => {
  const letter = part.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0);
  return letter ? `${letter.toUpperCase()}.` : "";
}).filter(Boolean).join("-");

// Keep the family name intact; shorten the last given names first.
export function fitClassListName(
  name: RosterName,
  maxWidth: number,
  measure: (text: string) => number,
) {
  const fullName = clean(name.fullName);
  if (measure(fullName) <= maxWidth) return { text: fullName, scale: 1 };
  const tokens = fullName.split(" ");
  const familyName = clean(name.lastName) || tokens[0];
  const givenNames = clean(name.firstName)
    ? clean(name.firstName).split(" ")
    : tokens.slice(familyName.split(" ").length);
  const shortened = [...givenNames];
  for (let index = shortened.length - 1; index >= 1; index -= 1) {
    shortened[index] = initial(shortened[index]);
    const text = [familyName, ...shortened].filter(Boolean).join(" ");
    if (measure(text) <= maxWidth) return { text, scale: 1 };
  }
  // With many given names, keep the first readable and indicate omitted initials.
  for (let kept = shortened.length - 1; kept >= 1; kept -= 1) {
    const text = [familyName, ...shortened.slice(0, kept), "…"].filter(Boolean).join(" ");
    if (measure(text) <= maxWidth) return { text, scale: 1 };
  }
  const text = [familyName, ...shortened.map(initial)].filter(Boolean).join(" ");
  return { text, scale: Math.min(1, maxWidth / Math.max(1, measure(text))) };
}

// Initial screen rendering; printing uses the browser's exact font measurements.
export function estimateClassListNameWidth(text: string) {
  return Array.from(text).reduce((width, character) => width + (
    /[ .,'’iIl]/.test(character) ? 3.5 : /[MWmw]/.test(character) ? 10 : 7
  ), 0);
}
