export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 54;
export const CARDS_PER_SHEET = 10;
export const CARD_PDF_BATCH = 100;
export const CARD_READ_ROLES = ["admin", "super_admin", "file_correspondent", "educator"] as const;
export const CARD_WRITE_ROLES = ["admin", "super_admin"] as const;
export const CARD_SLOTS = ["general", "french", "arabic"] as const;
export type CardSlot = typeof CARD_SLOTS[number];
export type CardAsset = { original: string; processed: string; updatedAt: string };
export type CardConfiguration = {
  enabled: boolean;
  signatures: Partial<Record<CardSlot, CardAsset>>;
  automaticSignature: boolean;
  // Separate choices; existing bulletin/attestation engines are untouched.
  documentPolicies: { cards: boolean; bulletins: false; attestations: false; other: false };
};
export function defaultCardConfiguration(): CardConfiguration {
  return { enabled: true, signatures: {}, automaticSignature: false,
    documentPolicies: { cards: false, bulletins: false, attestations: false, other: false } };
}
export type CardSchool = {
  id: string; name: string; phone: string | null; logo_url: string | null;
  country_name: string | null; country_motto: string | null; ministry_name: string | null;
  head_name: string | null; head_title: string | null;
};
export type CardYear = { code: string; start_date: string; end_date: string; is_current: boolean };
export type CardClass = { id: string; label: string; level: string | null; academic_year: string };
export type SchoolCard = {
  enrollmentId: string; studentId: string; classId: string; year: string;
  name: string; matricule: string; birthdate: string; birthPlace: string; gender: string;
  classLabel: string; level: string; tracks: string[]; photoUrl: string | null;
  revoked: boolean; warnings: string[];
};
export type PreparedCard = SchoolCard & {
  token: string; verificationUrl: string; fingerprint: string;
  signatureSlot: CardSlot | null; signatoryName: string;
};
export type CardRoster = {
  school: CardSchool; years: CardYear[]; year: string; classes: CardClass[];
  items: SchoolCard[]; configuration: CardConfiguration; revision: number;
  canConfigure: boolean; nextOffset: number | null;
  signatureImages: Partial<Record<CardSlot, string>>;
};
export function cardWarnings(row: Pick<SchoolCard, "name" | "matricule" | "birthdate" | "birthPlace" | "gender" | "photoUrl">) {
  return [[row.name, "Nom absent"], [row.matricule, "Matricule absent"],
    [row.birthdate, "Date de naissance absente"], [row.birthPlace, "Lieu de naissance absent"],
    [row.gender, "Sexe absent"], [row.photoUrl, "Photo absente"]]
    .filter(([value]) => !value).map(([, warning]) => warning as string);
}
export function signatureSlotForTracks(tracks: string[], bilingual: boolean): CardSlot | null {
  if (!bilingual) return "general";
  // Do not guess a director from the class label, UI filter or student name.
  return tracks.length === 1 && (tracks[0] === "french" || tracks[0] === "arabic") ? tracks[0] : null;
}
export function cardSheetPosition(index: number, side: "front" | "back", flip: "long" | "short" = "long") {
  const column = index % 2, row = Math.floor(index / 2);
  return { x: 16.9 + (side === "back" && flip === "long" ? 1 - column : column) * 90.6,
    y: 5.5 + (side === "back" && flip === "short" ? 4 - row : row) * 58 };
}
