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

export type VoiceContextPhrase = {
  phrase: string;
  boost: number;
};

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

/**
 * Petits alias de secours pour des erreurs STT réellement observées avec des
 * patronymes ivoiriens. Le contextual biasing du navigateur reste prioritaire ;
 * ces alias servent uniquement à rapprocher une transcription déjà déformée.
 */
const SPEECH_TOKEN_ALIASES: Record<string, string[]> = {
  guessan: ["dessin", "dessine", "guesan", "guessant", "guessin", "nguesan"],
  nguessan: ["dessin", "dessine", "guesan", "guessan", "guessant", "guessin"],
  kouassi: ["couassi", "kwasi", "kouasi"],
  kouame: ["couame", "kwame", "kouamé"],
  koffi: ["coffi", "coffy", "kofi"],
  kone: ["coné", "conne", "koné"],
};

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

function expandedNameTokens(input: string): string[] {
  const tokens = meaningfulTokens(input);
  const expanded = new Set(tokens);

  // N'Guessan est normalisé en « n guessan ». On conserve aussi « nguessan »
  // pour mieux comparer les transcriptions qui collent l'apostrophe.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].length === 1 && /^[a-z]$/.test(tokens[index])) {
      expanded.add(`${tokens[index]}${tokens[index + 1]}`);
    }
  }

  return Array.from(expanded);
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

function compactPhoneticToken(input: string): string {
  return normalizeVoiceText(input)
    .replace(/[^a-z]/g, "")
    .replace(/^n(?=g)/, "")
    .replace(/eaux|eau|aux|au/g, "o")
    .replace(/ou/g, "u")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/gn/g, "ny")
    .replace(/ch/g, "sh")
    .replace(/gu(?=[ei])/g, "g")
    .replace(/qu|ck|k/g, "c")
    .replace(/ain|ein|yn|ym|in|im/g, "in")
    .replace(/an|am|en|em/g, "an")
    .replace(/on|om/g, "on")
    .replace(/ss|ç|z/g, "s")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/g(?=[eiy])/g, "j")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}

function phoneticSimilarity(a: string, b: string): number {
  const pa = compactPhoneticToken(a);
  const pb = compactPhoneticToken(b);
  if (!pa || !pb) return 0;
  if (pa === pb) return 1;

  let best = similarity(pa, pb);

  // Les moteurs STT changent parfois la première consonne d'un patronyme
  // inhabituel (« N'Guessan » -> « dessin »). On compare donc aussi le noyau
  // sonore sans autoriser ce raccourci à devenir un match automatique à lui seul.
  if (pa.length >= 4 && pb.length >= 4) {
    best = Math.max(best, similarity(pa.slice(1), pb.slice(1)) * 0.92);
  }

  return best;
}

function aliasSimilarity(a: string, b: string): number {
  const na = normalizeVoiceText(a).replace(/\s+/g, "");
  const nb = normalizeVoiceText(b).replace(/\s+/g, "");
  if (!na || !nb) return 0;

  const aliasesForB = SPEECH_TOKEN_ALIASES[nb] || [];
  if (aliasesForB.some((alias) => normalizeVoiceText(alias).replace(/\s+/g, "") === na)) {
    return 0.99;
  }

  const aliasesForA = SPEECH_TOKEN_ALIASES[na] || [];
  if (aliasesForA.some((alias) => normalizeVoiceText(alias).replace(/\s+/g, "") === nb)) {
    return 0.99;
  }

  return 0;
}

function smartTokenSimilarity(a: string, b: string): number {
  const orthographic = similarity(a, b);
  const phonetic = phoneticSimilarity(a, b);
  const alias = aliasSimilarity(a, b);
  return Math.max(orthographic, phonetic * 0.9, alias);
}

function tokenSimilarity(queryTokens: string[], candidateTokens: string[]): number {
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const c of candidateTokens) {
      best = Math.max(best, smartTokenSimilarity(q, c));
    }
    total += best;
  }

  const average = total / queryTokens.length;
  const exactMatches = queryTokens.filter((q) => candidateTokens.includes(q)).length;
  const exactCoverage = exactMatches / queryTokens.length;

  return average * 0.72 + exactCoverage * 0.28;
}

function studentMatchScore(query: string, candidateName: string): number {
  const q = normalizeVoiceText(query);
  const c = normalizeVoiceText(candidateName);
  if (!q || !c) return 0;
  if (q === c) return 1;

  const qTokens = expandedNameTokens(q);
  const cTokens = expandedNameTokens(c);
  if (!qTokens.length || !cTokens.length) return 0;

  const allQueryTokensExact = qTokens.every((token) => cTokens.includes(token));
  if (allQueryTokensExact) {
    return Math.min(0.98, 0.91 + qTokens.length * 0.02);
  }

  const tokens = tokenSimilarity(qTokens, cTokens);
  const whole = similarity(
    meaningfulTokens(q).join(" "),
    meaningfulTokens(c).join(" ")
  );
  return tokens * 0.84 + whole * 0.16;
}

export function matchRosterStudent<T extends VoiceRosterItem>(
  spokenName: string,
  roster: T[]
): VoiceStudentMatch<T> {
  const queryTokens = expandedNameTokens(spokenName);
  if (!queryTokens.length || !roster.length) {
    return { status: "not_found", candidates: [] };
  }

  const ranked = roster
    .map((student) => ({ student, score: studentMatchScore(spokenName, student.full_name) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  const suggestions = ranked.filter((item) => item.score >= 0.5).slice(0, 4);

  if (!top || top.score < 0.56) {
    return { status: "not_found", candidates: suggestions };
  }

  const exactQueryTokens = meaningfulTokens(spokenName);
  const exactTokenSubset = exactQueryTokens.every((token) =>
    meaningfulTokens(top.student.full_name).includes(token)
  );
  const secondIsClose = !!second && second.score >= top.score - 0.06;

  // Un mot seul ne sélectionne pas silencieusement un élève, sauf correspondance
  // textuelle quasi parfaite et nettement unique. Cela protège les homonymes.
  if (secondIsClose || (exactQueryTokens.length === 1 && top.score < 0.965)) {
    return {
      status: "ambiguous",
      candidates: ranked.filter((item) => item.score >= top.score - 0.12).slice(0, 4),
    };
  }

  const uniqueTwoTokenRecovery =
    exactQueryTokens.length >= 2 &&
    top.score >= 0.78 &&
    (!second || second.score < top.score - 0.12);

  if (
    top.score >= 0.82 ||
    (exactTokenSubset && top.score >= 0.91) ||
    uniqueTwoTokenRecovery
  ) {
    return { status: "matched", candidate: top };
  }

  return {
    status: "ambiguous",
    candidates: suggestions.length ? suggestions : [top],
  };
}

function addContextPhrase(
  store: Map<string, VoiceContextPhrase>,
  phrase: string,
  boost: number
) {
  const value = String(phrase || "").trim().replace(/\s+/g, " ");
  if (!value || value.length < 2) return;
  const key = normalizeVoiceText(value).replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!key) return;
  const previous = store.get(key);
  if (!previous || boost > previous.boost) store.set(key, { phrase: value, boost });
}

/**
 * Vocabulaire envoyé au navigateur pendant l'étape « nom ». Les noms complets
 * ont le boost le plus fort ; les patronymes/prénoms servent de filet de secours.
 */
export function buildRosterContextPhrases<T extends VoiceRosterItem>(
  roster: T[],
  maxPhrases = 180
): VoiceContextPhrase[] {
  const store = new Map<string, VoiceContextPhrase>();

  for (const student of roster) {
    const fullName = String(student.full_name || "").trim();
    if (!fullName) continue;

    addContextPhrase(store, fullName, 7.5);
    addContextPhrase(store, fullName.replace(/[’']/g, " "), 7.0);

    const rawTokens = fullName
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    for (const token of rawTokens) {
      const normalized = normalizeVoiceText(token).replace(/\s+/g, "");
      if (normalized.length >= 3) addContextPhrase(store, token, 4.8);
    }

    for (let index = 0; index < rawTokens.length - 1; index += 1) {
      addContextPhrase(store, `${rawTokens[index]} ${rawTokens[index + 1]}`, 5.8);
    }
  }

  return Array.from(store.values())
    .sort((a, b) => b.boost - a.boost || b.phrase.length - a.phrase.length)
    .slice(0, maxPhrases);
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

export function buildGradeContextPhrases(scale: number): VoiceContextPhrase[] {
  const max = Math.max(0, Math.min(100, Math.floor(Number(scale) || 20)));
  const phrases: VoiceContextPhrase[] = [];

  for (let value = 0; value <= max; value += 1) {
    phrases.push({ phrase: String(value), boost: 5.5 });
  }

  const spoken = [
    "zéro",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
    "treize",
    "quatorze",
    "quinze",
    "seize",
    "dix sept",
    "dix huit",
    "dix neuf",
    "vingt",
  ];

  spoken.slice(0, Math.min(spoken.length, max + 1)).forEach((phrase) => {
    phrases.push({ phrase, boost: 6.5 });
    phrases.push({ phrase: `${phrase} virgule cinq`, boost: 5.8 });
  });

  return phrases.slice(0, 80);
}

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
