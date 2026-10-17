// Shared normalization extracted unchanged from the existing coefficient API.
const OFFICIAL_TRACK_CODES = [
  "6eme",
  "5eme",
  "4eme",
  "3eme",
  "2ndeA",
  "2ndeC",
  "1ereA1",
  "1ereA2",
  "1ereC",
  "1ereD",
  "tleA1",
  "tleA2",
  "tleC",
  "tleD",
] as const;

type OfficialTrackCode = (typeof OFFICIAL_TRACK_CODES)[number];

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isOfficialTrackCode(value: string): value is OfficialTrackCode {
  return (OFFICIAL_TRACK_CODES as readonly string[]).includes(value);
}

export function normalizeOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = String(value ?? "").trim();
  if (isOfficialTrackCode(raw)) return raw;

  const normalized = normalizeText(raw);
  const exactByNormalized: Record<string, OfficialTrackCode> = {
    "6EME": "6eme",
    "6E": "6eme",
    SIXIEME: "6eme",
    "5EME": "5eme",
    "5E": "5eme",
    CINQUIEME: "5eme",
    "4EME": "4eme",
    "4E": "4eme",
    QUATRIEME: "4eme",
    "3EME": "3eme",
    "3E": "3eme",
    TROISIEME: "3eme",
    "2NDEA": "2ndeA",
    SECONDEA: "2ndeA",
    "2A": "2ndeA",
    "2NDEC": "2ndeC",
    SECONDEC: "2ndeC",
    "2C": "2ndeC",
    "1EREA1": "1ereA1",
    PREMIEREA1: "1ereA1",
    "1EREA2": "1ereA2",
    PREMIEREA2: "1ereA2",
    "1EREC": "1ereC",
    PREMIEREC: "1ereC",
    "1C": "1ereC",
    "1ERED": "1ereD",
    PREMIERED: "1ereD",
    "1D": "1ereD",
    TLEA1: "tleA1",
    TERMINALEA1: "tleA1",
    TLEA2: "tleA2",
    TERMINALEA2: "tleA2",
    TLEC: "tleC",
    TERMINALEC: "tleC",
    TC: "tleC",
    TLED: "tleD",
    TERMINALED: "tleD",
    TD: "tleD",
  };

  if (exactByNormalized[normalized]) return exactByNormalized[normalized];
  if (/^6/.test(normalized)) return "6eme";
  if (/^5/.test(normalized)) return "5eme";
  if (/^4/.test(normalized)) return "4eme";
  if (/^3/.test(normalized)) return "3eme";
  if (/^(2NDEA|2A|SECONDEA)/.test(normalized)) return "2ndeA";
  if (/^(2NDEC|2C|SECONDEC)/.test(normalized)) return "2ndeC";
  if (/^(1D|1ERED|PREMIERED)/.test(normalized)) return "1ereD";
  if (/^(1C|1EREC|PREMIEREC)/.test(normalized)) return "1ereC";
  if (/^(1A|1EREA|PREMIEREA)/.test(normalized)) return "1ereA2";
  if (/^(TLED|TD|TERMINALED)/.test(normalized)) return "tleD";
  if (/^(TLEC|TC|TERMINALEC)/.test(normalized)) return "tleC";
  if (/^(TLEA|TA|TERMINALEA)/.test(normalized)) return "tleA2";
  return null;
}
