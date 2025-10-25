// src/lib/phone.ts

/**
 * Outils de normalisation de numÃ©ros (multi-pays) sans dÃ©pendance externe.
 * Objectif : produire un E.164 propre (ex: "+22501020304") Ã  partir d'entrÃ©es variÃ©es :
 *  - "+225 01 02 03 04"
 *  - "00225 01020304"
 *  - "22501020304"
 *  - "01020304"  (prÃ©fixe pays par dÃ©faut ajoutÃ©)
 *
 * Par dÃ©faut, le prÃ©fixe pays utilisÃ© est lu dans :
 * - process.env.NEXT_PUBLIC_DEFAULT_PHONE_PREFIX
 * - sinon process.env.DEFAULT_PHONE_PREFIX
 * - sinon "+225"
 *
 * NB : E.164 = "+" + 6..15 chiffres (max ITU).
 */

const ENV_DEFAULT =
  (process.env.NEXT_PUBLIC_DEFAULT_PHONE_PREFIX ||
    process.env.DEFAULT_PHONE_PREFIX ||
    "+225") as string;

const E164_MIN_DIGITS = 6;  // limite basse "raisonnable"
const E164_MAX_DIGITS = 15; // limite E.164

/** Quelques indicatifs courants pour reconnaÃ®tre les entrÃ©es sans "+" ni "00". */
const KNOWN_CALLING_CODES = new Set([
  // Afrique de l'Ouest & proches
  "221","222","223","224","225","226","227","228","229",
  "233","234","235","236","237","238","239","240","241",
  "242","243","244","245","248","249","250","251","252",
  "253","254","255","256","257","258","260","261","262",
  "263","264","265","266","267","268","269",
  // Europe (exemples)
  "30","31","32","33","34","36","39","40","41","44","45","46","47","48","49",
  "351","352","353","354","355","356","357","358","359",
  "370","371","372","373","374","375","376","377","378","380","381","382","385","386","387","389",
  // AmÃ©riques & APAC (sÃ©lection)
  "1","52","54","55","56","57","58",
  "60","61","62","63","64","65","66",
  "81","82","84","86","90","91","92","93","94","95","98",
  "971","972","973","974","975","976","977"
]);

/** Map minimal alpha-2 â†’ indicatif pour le `defaultCountryAlpha2` */
const A2_TO_CC: Record<string, string> = {
  // Afrique de lâ€™Ouest (cÅ“ur de ton use-case)
  CI: "225", ML: "223", BJ: "229", BF: "226", SN: "221", TG: "228",
  GN: "224", NE: "227", NG: "234", GH: "233", CM: "237",
  // Maghreb
  MA: "212", DZ: "213", TN: "216",
  // Europe (francophones/usuel)
  FR: "33", BE: "32", CH: "41", LU: "352",
  // Divers utiles
  US: "1", CA: "1", GB: "44", DE: "49", ES: "34", IT: "39", PT: "351"
};

export type ToE164Options = {
  /** PrÃ©fixe pays par dÃ©faut (ex: "+225" ou "225"). */
  defaultPrefix?: string;
  /**
   * Si true (dÃ©faut), on autorise des numÃ©ros "locaux" commenÃ§ant par "0"
   * â†’ on enlÃ¨ve le 0 et on prÃ©fixe avec defaultPrefix.
   */
  acceptLocal?: boolean;
  /** Si true (dÃ©faut), on valide longueur 6..15, sinon on retourne null. */
  strict?: boolean;
};

export type NormalizePhoneCompatOptions = {
  /** Code pays ISO alpha-2, ex: "CI", "ML", "BJ", "BF" */
  defaultCountryAlpha2?: string;
  /** PrÃ©fixe explicite (ex: "+225"). Si fourni, il prime sur `defaultCountryAlpha2`. */
  defaultPrefix?: string;
};

/** Nettoie : garde seulement le '+' de tÃªte (si prÃ©sent) et les chiffres. */
export function sanitize(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  // Conserver uniquement le '+' en tÃªte, puis chiffres
  const headPlus = s[0] === "+";
  const digits = s.replace(/[^\d+]/g, "");
  return headPlus ? "+" + digits.slice(1).replace(/[^\d]/g, "") : digits.replace(/[^\d]/g, "");
}

/** Normalise un prÃ©fixe pays en "+XYZ". */
export function canonicalPrefix(prefix?: string): string {
  let p = (prefix || ENV_DEFAULT || "+225").trim();
  if (!p) p = "+225";
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (!p.startsWith("+")) p = "+" + p;
  // garder uniquement + et chiffres
  p = "+" + p.slice(1).replace(/[^\d]/g, "");
  if (p === "+") p = "+225";
  return p;
}

/** DÃ©tecte si la chaÃ®ne ressemble dÃ©jÃ  Ã  un E.164 valide. */
export function isValidE164(s: string): boolean {
  if (!s || s[0] !== "+") return false;
  const digits = s.slice(1);
  return /^\d{6,15}$/.test(digits);
}

/** Tente de reconnaÃ®tre un indicatif pays au dÃ©but d'une chaÃ®ne numÃ©rique. */
function startsWithKnownCallingCode(num: string): string | null {
  // On teste 1, 2 et 3 chiffres (la plupart des indicatifs font 1 Ã  3).
  for (const len of [3, 2, 1]) {
    const cc = num.slice(0, len);
    if (KNOWN_CALLING_CODES.has(cc)) return cc;
  }
  return null;
}

/** Convertit un alpha-2 en prÃ©fixe "+CC". */
function alpha2ToPrefix(a2?: string | null): string | null {
  if (!a2) return null;
  const k = a2.trim().toUpperCase();
  const cc = A2_TO_CC[k];
  return cc ? `+${cc}` : null;
}

/**
 * Convertit vers E.164 (ou null si impossible en mode strict).
 * - GÃ¨re "00" â†’ "+"
 * - GÃ¨re entrÃ©e dÃ©jÃ  en "+â€¦"
 * - GÃ¨re "225â€¦" â†’ "+225â€¦"
 * - GÃ¨re "0â€¦" (local) â†’ "<defaultPrefix>â€¦"
 */
export function toE164(
  raw?: string | null,
  opts: ToE164Options = {}
): string | null {
  if (!raw) return null;

  const {
    defaultPrefix = ENV_DEFAULT,
    acceptLocal = true,
    strict = true
  } = opts;

  let s = sanitize(raw);
  if (!s) return null;

  // "00" â†’ "+"
  if (s.startsWith("00")) s = "+" + s.slice(2);

  // DÃ©jÃ  "+â€¦" : vÃ©rifier longueur
  if (s.startsWith("+")) {
    const onlyDigits = s.slice(1);
    if (!/^\d+$/.test(onlyDigits)) return strict ? null : "+" + onlyDigits.replace(/[^\d]/g, "");
    if (strict && (onlyDigits.length < E164_MIN_DIGITS || onlyDigits.length > E164_MAX_DIGITS)) return null;
    return "+" + onlyDigits;
  }

  // "225â€¦", "223â€¦", "1â€¦", etc. â†’ "+â€¦"
  const cc = startsWithKnownCallingCode(s);
  if (cc) {
    const rest = s.slice(cc.length);
    const candidate = "+" + cc + rest;
    if (!strict) return candidate;
    const len = (cc + rest).length;
    return len >= E164_MIN_DIGITS && len <= E164_MAX_DIGITS ? candidate : null;
  }

  // "0â€¦" (local) â†’ defaultPrefix + (num sans 0)
  if (acceptLocal && s.startsWith("0")) {
    const without0 = s.replace(/^0+/, ""); // supprime 1+ zÃ©ros de tÃªte
    const pref = canonicalPrefix(defaultPrefix);
    const candidate = pref + without0;
    if (!strict) return candidate;
    const digitsLen = (candidate.startsWith("+") ? candidate.slice(1) : candidate).length;
    return digitsLen >= E164_MIN_DIGITS && digitsLen <= E164_MAX_DIGITS ? candidate : null;
  }

  // Sinon : on applique simplement le prÃ©fixe par dÃ©faut
  const pref = canonicalPrefix(defaultPrefix);
  const candidate = pref + s;
  if (!strict) return candidate;
  {
    const digitsLen = (candidate.startsWith("+") ? candidate.slice(1) : candidate).length;
    return digitsLen >= E164_MIN_DIGITS && digitsLen <= E164_MAX_DIGITS ? candidate : null;
  }
}

/**
 * Alias historique compat :
 * - normalizePhone(raw)                                  â†’ OK
 * - normalizePhone(raw, "+225")                          â†’ OK
 * - normalizePhone(raw, { defaultPrefix: "+225" })       â†’ OK
 * - normalizePhone(raw, { defaultCountryAlpha2: "CI" })  â†’ OK
 */
export function normalizePhone(raw?: string | null): string | null;
export function normalizePhone(
  raw: string | null | undefined,
  defaultPrefix: string | null | undefined
): string | null;
export function normalizePhone(
  raw: string | null | undefined,
  opts: NormalizePhoneCompatOptions | string | null | undefined
): string | null;
export function normalizePhone(
  raw?: string | null,
  opts?: NormalizePhoneCompatOptions | string | null
): string | null {
  if (raw == null) return null;

  // Valeurs par dÃ©faut
  let chosenPrefix: string | null = null;

  if (typeof opts === "string") {
    chosenPrefix = opts || null;
  } else if (opts && typeof opts === "object") {
    // prioritÃ© au defaultPrefix explicite
    if (opts.defaultPrefix) {
      chosenPrefix = opts.defaultPrefix;
    } else if (opts.defaultCountryAlpha2) {
      chosenPrefix = alpha2ToPrefix(opts.defaultCountryAlpha2) || null;
    }
  }

  // fallback sur l'env si rien
  const finalPrefix = canonicalPrefix(chosenPrefix || ENV_DEFAULT);
  return toE164(raw, { defaultPrefix: finalPrefix, strict: true });
}

/** Compare deux entrÃ©es en se basant sur lâ€™E.164 calculÃ©. */
export function isSamePhone(
  a?: string | null,
  b?: string | null,
  defaultPrefix?: string
): boolean {
  const na = toE164(a, { defaultPrefix });
  const nb = toE164(b, { defaultPrefix });
  return !!na && na === nb;
}

/**
 * Format dâ€™affichage simple (insertion dâ€™espaces) Ã  partir dâ€™un E.164.
 * - On laisse le "+CC", puis on espace tous les 2 chiffres (usage courant en Afrique de lâ€™Ouest).
 * - Si non E.164, on retourne la chaÃ®ne dâ€™origine.
 */
export function formatInternational(e164?: string | null): string {
  if (!e164 || !isValidE164(e164)) return e164 || "";
  const ccMatch = e164.slice(1).match(/^\d{1,3}/);
  const cc = ccMatch ? ccMatch[0] : "";
  const rest = e164.slice(1 + cc.length);

  // groupe en "xx xx xx xx" tant que possible
  const groups: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    groups.push(rest.slice(i, i + 2));
  }
  return `+${cc} ${groups.join(" ")}`.trim();
}

/** Masque une partie du numÃ©ro pour lâ€™affichage (ex: "+225 ** ** 12 34"). */
export function maskPhone(e164?: string | null): string {
  if (!e164 || !isValidE164(e164)) return e164 || "";
  const formatted = formatInternational(e164);
  // Remplace les 4 premiers groupes de 2 chiffres (si prÃ©sents) par "**"
  return formatted.replace(/\b(\d{2})\b/g, (_m, _g, idx) => (idx < 4 ? "**" : _m));
}

/** Extrait lâ€™indicatif pays Ã  partir dâ€™un E.164. */
export function getCountryCallingCode(e164?: string | null): string | null {
  if (!e164 || !isValidE164(e164)) return null;
  const digits = e164.slice(1);
  // Cherche 1..3 chiffres prÃ©sents dans la table
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (KNOWN_CALLING_CODES.has(cc)) return cc;
  }
  // fallback : 1 Ã  3 premiers chiffres
  return digits.slice(0, Math.min(3, digits.length));
}


