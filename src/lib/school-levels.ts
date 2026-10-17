import type { SchoolCycle } from "./school-cycles";

/** Pedagogical levels only. Never use this to identify a physical class or
 * collapse division labels. Unspecified A remains distinct from A1 and A2. */
export function normalizeSchoolLevel(value: unknown, cycle?: SchoolCycle): string {
  const raw = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  const token = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[\s_.-]+/g, "");
  if ((!cycle || cycle === "primary") && /^(CP[12]|CE[12]|CM[12])$/.test(token)) return token;
  if (!cycle || cycle === "preschool") {
    const preschool: Record<string, string> = { PS: "PS", MS: "MS", GS: "GS", PETITESECTION: "PS", MOYENNESECTION: "MS", GRANDESECTION: "GS" };
    if (preschool[token]) return preschool[token];
  }
  if (!cycle || cycle === "secondary") {
    const college: Record<string, string> = { "6E": "6eme", "6EME": "6eme", SIXIEME: "6eme", "5E": "5eme", "5EME": "5eme", CINQUIEME: "5eme",
      "4E": "4eme", "4EME": "4eme", QUATRIEME: "4eme", "3E": "3eme", "3EME": "3eme", TROISIEME: "3eme" };
    if (college[token]) return college[token];
    const second = /^(2NDE|2DE|SECONDE|2)([ACD])?$/.exec(token);
    if (second && (second[1] !== "2" || second[2])) return `2nde${second[2] || ""}`;
    const first = /^(1ERE|1RE|1E|PREMIERE|1)(A[12]?|C|D)?$/.exec(token);
    if (first && (first[1] !== "1" || first[2])) return `1ere${first[2] || ""}`;
    const terminal = /^(TLE|TERM|TERMINALE|T)(A[12]?|C|D)?$/.exec(token);
    if (terminal && (terminal[1] !== "T" || terminal[2])) return `tle${terminal[2] || ""}`;
  }
  return raw;
}

export function schoolLevelKey(value: unknown, cycle?: SchoolCycle): string {
  return normalizeSchoolLevel(value, cycle).toLocaleLowerCase("fr");
}

export function sameSchoolLevel(left: unknown, right: unknown, cycle?: SchoolCycle): boolean {
  return schoolLevelKey(left, cycle) === schoolLevelKey(right, cycle);
}
