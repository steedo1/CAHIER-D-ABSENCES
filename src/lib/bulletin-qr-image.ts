type ErrorCorrectionLevel = "H" | "Q" | "M" | "L";

type QrImageOptions = {
  width: number;
  margin: number;
  errorCorrectionLevel: ErrorCorrectionLevel;
};

type QrEncoder = (text: string, options: QrImageOptions) => Promise<string>;

/** Garde le contenu signé intact ; adapte uniquement la redondance du symbole. */
export async function createBulletinQrDataUrl(
  text: string,
  options: QrImageOptions,
  encode: QrEncoder,
): Promise<string> {
  const levels: ErrorCorrectionLevel[] = ["H", "Q", "M", "L"];
  const start = Math.max(0, levels.indexOf(options.errorCorrectionLevel));
  for (const level of levels.slice(start)) {
    try {
      return await encode(text, { ...options, errorCorrectionLevel: level });
    } catch (error) {
      // Ne masquer ni une panne de canvas ni une erreur de configuration.
      const capacityError = error instanceof Error && /amount of data is too big/i.test(error.message);
      if (!capacityError || level === "L") throw error;
    }
  }
  throw new Error("QR indisponible");
}
