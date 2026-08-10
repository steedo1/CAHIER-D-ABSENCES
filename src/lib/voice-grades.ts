export type VoiceRosterItem = {
  id: string;
  full_name: string;
  matricule?: string | null;
};

export type VoiceStudentCandidate<T extends VoiceRosterItem = VoiceRosterItem> = {
  student: T;
  score: number;
};

export type VoiceStudentMatch<T extends VoiceRosterItem = VoiceRosterItem> =
  | { status: "matched"; candidate: VoiceStudentCandidate<T> }
  | { status: "ambiguous"; candidates: VoiceStudentCandidate<T>[] }
  | { status: "not_found"; candidates: VoiceStudentCandidate<T>[] };

const FILLER_WORDS = new Set([
  "eleve",
  "l",
  "le",
  "la",
  "les",
  "monsieur",
  "madame",
  "mademoiselle",
  "nom",
  "prenom",
  "prenoms",
]);

export function normalizeVoiceText(input: string): string {
  let text = String(input || "").toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // Certains environnements très anciens peuvent ne pas exposer normalize().
  }

  return text
    .replace(/[’'`´-]/g, " ")
    .replace(/[^a-z0-9\s,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(input: string): string[] {
  return normalizeVoiceText(input)
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !FILLER_WORDS.has(token));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function tokenSimilarity(queryTokens: string[], candidateTokens: string[]): number {
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const c of candidateTokens) {
      best = Math.max(best, similarity(q, c));
    }
    total += best;
  }

  const average = total / queryTokens.length;
  const exactMatches = queryTokens.filter((q) => candidateTokens.includes(q)).length;
  const exactCoverage = exactMatches / queryTokens.length;

  return average * 0.65 + exactCoverage * 0.35;
}

function studentMatchScore(query: string, candidateName: string): number {
  const q = normalizeVoiceText(query);
  const c = normalizeVoiceText(candidateName);
  if (!q || !c) return 0;
  if (q === c) return 1;

  const qTokens = meaningfulTokens(q);
  const cTokens = meaningfulTokens(c);
  if (!qTokens.length || !cTokens.length) return 0;

  const allQueryTokensExact = qTokens.every((token) => cTokens.includes(token));
  if (allQueryTokensExact) {
    // Un nom/prénom partiel mais exact est très fiable, tout en gardant une
    // petite marge pour détecter les homonymes.
    return Math.min(0.97, 0.9 + qTokens.length * 0.02);
  }

  const tokens = tokenSimilarity(qTokens, cTokens);
  const whole = similarity(qTokens.join(" "), cTokens.join(" "));
  return tokens * 0.78 + whole * 0.22;
}

export function matchRosterStudent<T extends VoiceRosterItem>(
  spokenName: string,
  roster: T[]
): VoiceStudentMatch<T> {
  const queryTokens = meaningfulTokens(spokenName);
  if (!queryTokens.length || !roster.length) {
    return { status: "not_found", candidates: [] };
  }

  const ranked = roster
    .map((student) => ({ student, score: studentMatchScore(spokenName, student.full_name) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  const suggestions = ranked.filter((item) => item.score >= 0.56).slice(0, 3);

  if (!top || top.score < 0.68) {
    return { status: "not_found", candidates: suggestions };
  }

  const exactTokenSubset = queryTokens.every((token) =>
    meaningfulTokens(top.student.full_name).includes(token)
  );
  const secondIsClose = !!second && second.score >= top.score - 0.055;

  // Un seul mot (ex. « Kouassi ») ne doit jamais sélectionner silencieusement
  // un élève si plusieurs noms de la classe se ressemblent fortement.
  if (secondIsClose || (queryTokens.length === 1 && top.score < 0.96)) {
    return {
      status: "ambiguous",
      candidates: ranked.filter((item) => item.score >= top.score - 0.09).slice(0, 3),
    };
  }

  if (top.score >= 0.8 || (exactTokenSubset && top.score >= 0.9)) {
    return { status: "matched", candidate: top };
  }

  return { status: "ambiguous", candidates: suggestions.length ? suggestions : [top] };
}

const SIMPLE_NUMBERS: Record<string, number> = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};

const TENS: Record<string, number> = {
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

function parseFrenchIntegerWords(input: string): number | null {
  const normalized = normalizeVoiceText(input).replace(/[,.]/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== "et");

  if (!tokens.length) return null;
  if (tokens.length === 1 && SIMPLE_NUMBERS[tokens[0]] != null) {
    return SIMPLE_NUMBERS[tokens[0]];
  }
  if (tokens.length === 1 && TENS[tokens[0]] != null) {
    return TENS[tokens[0]];
  }

  if (tokens[0] === "dix" && tokens.length === 2) {
    const unit = SIMPLE_NUMBERS[tokens[1]];
    if (unit != null && unit >= 7 && unit <= 9) return 10 + unit;
  }

  const tens = TENS[tokens[0]];
  if (tens != null && tokens.length === 2) {
    const unit = SIMPLE_NUMBERS[tokens[1]];
    if (unit != null && unit >= 0 && unit <= 9) return tens + unit;
  }

  return null;
}

function parseNumericString(input: string): number | null {
  const normalized = normalizeVoiceText(input);
  const match = normalized.match(/(?:^|\s)(\d{1,2}(?:[,.]\d{1,2})?)(?:\s|$)/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function parseWordDecimal(input: string): number | null {
  const normalized = normalizeVoiceText(input);
  const parts = normalized.split(/\bvirgule\b|\bpoint\b/).map((part) => part.trim());
  if (parts.length !== 2) return null;

  const integer = parseFrenchIntegerWords(parts[0]);
  const decimalWords = parseFrenchIntegerWords(parts[1]);
  if (integer == null || decimalWords == null) return null;

  const decimalText = String(decimalWords);
  return integer + decimalWords / Math.pow(10, decimalText.length);
}

function parseMixedDecimal(input: string): number | null {
  const normalized = normalizeVoiceText(input);
  const parts = normalized.split(/\bvirgule\b|\bpoint\b/).map((part) => part.trim());
  if (parts.length !== 2) return null;

  const integerDigits = parts[0].match(/^\d{1,2}$/);
  const integer = integerDigits ? Number(integerDigits[0]) : parseFrenchIntegerWords(parts[0]);
  if (integer == null || !Number.isFinite(integer)) return null;

  const decimalDigits = parts[1].match(/^\d{1,2}$/);
  const decimal = decimalDigits ? Number(decimalDigits[0]) : parseFrenchIntegerWords(parts[1]);
  if (decimal == null || !Number.isFinite(decimal)) return null;

  const decimalText = decimalDigits ? decimalDigits[0] : String(decimal);
  return integer + decimal / Math.pow(10, decimalText.length);
}

export function parseSpokenGrade(input: string): number | null {
  const normalized = normalizeVoiceText(input)
    .replace(/\bsur\s+\d{1,2}\b/g, " ")
    .replace(/\bnote\b/g, " ")
    .replace(/\best\b/g, " ")
    .replace(/\bde\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const mixedDecimal = parseMixedDecimal(normalized);
  if (mixedDecimal != null) return mixedDecimal;

  const decimal = parseWordDecimal(normalized);
  if (decimal != null) return decimal;

  const halfMatch = normalized.match(/^(.*?)\s+(?:et\s+)?demi(?:e)?$/);
  if (halfMatch) {
    const integer = /^\d{1,2}$/.test(halfMatch[1].trim())
      ? Number(halfMatch[1].trim())
      : parseFrenchIntegerWords(halfMatch[1]);
    if (integer != null) return integer + 0.5;
  }

  const quarterMatch = normalized.match(/^(.*?)\s+(?:et\s+)?quart$/);
  if (quarterMatch) {
    const integer = /^\d{1,2}$/.test(quarterMatch[1].trim())
      ? Number(quarterMatch[1].trim())
      : parseFrenchIntegerWords(quarterMatch[1]);
    if (integer != null) return integer + 0.25;
  }

  const threeQuarterMatch = normalized.match(/^(.*?)\s+(?:et\s+)?trois\s+quarts$/);
  if (threeQuarterMatch) {
    const integer = /^\d{1,2}$/.test(threeQuarterMatch[1].trim())
      ? Number(threeQuarterMatch[1].trim())
      : parseFrenchIntegerWords(threeQuarterMatch[1]);
    if (integer != null) return integer + 0.75;
  }

  const numeric = parseNumericString(normalized);
  if (numeric != null) return numeric;

  return parseFrenchIntegerWords(normalized);
}
