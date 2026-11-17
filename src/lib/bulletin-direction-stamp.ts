/**
 * A bilingual school's French and Arabic sections must never receive the
 * other section's stamp. A general stamp is reserved for combined documents.
 */
export type DirectionStampSlot = "general" | "french" | "arabic";
export type DirectionStampImages = Partial<Record<DirectionStampSlot, string>>;

export function pickBulletinDirectionStamp(
  stamps: DirectionStampImages,
  slot: DirectionStampSlot,
  bilingual: boolean,
): string | null {
  if (slot === "general") return stamps.general || null;
  return stamps[slot] || (!bilingual ? stamps.general || null : null);
}
