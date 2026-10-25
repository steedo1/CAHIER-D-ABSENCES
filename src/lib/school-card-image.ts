import sharp from "sharp";

export type SignatureProcessing = { removeBackground: boolean; tolerance: number; crop: boolean };
/** Remove only near-uniform pixels connected to the image boundary. Interior
 * white details in a seal remain intact. Original is always retained. */
export async function processSchoolCardSignature(input: Buffer, options: SignatureProcessing) {
  if (input.length > 5 * 1024 * 1024) throw Error("image_too_large");
  const image = sharp(input, { limitInputPixels: 20_000_000 }).rotate();
  const metadata = await image.metadata();
  if (!["jpeg", "png"].includes(metadata.format || "")) throw Error("unsupported_image");
  const { data, info } = await image.resize({ width: 1400, height: 900, fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (options.removeBackground) {
    const corners = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
    const bg = [0, 1, 2].map(c => Math.round(corners.reduce((sum, p) => sum + data[p + c], 0) / 4));
    const tolerance = Math.min(100, Math.max(0, Number(options.tolerance) || 0));
    const visited = new Uint8Array(width * height), queue = new Uint32Array(width * height);
    let head = 0, tail = 0;
    const push = (p: number) => {
      if (visited[p]) return;
      visited[p] = 1;
      const offset = p * 4;
      if (data[offset + 3] === 0 || [0, 1, 2].every(c => Math.abs(data[offset + c] - bg[c]) <= tolerance)) queue[tail++] = p;
    };
    for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
    while (head < tail) {
      const p = queue[head++]; data[p * 4 + 3] = 0;
      if (p % width > 0) push(p - 1);
      if (p % width < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p + width < width * height) push(p + width);
    }
  }
  let left = width, top = height, right = -1, bottom = -1;
  if (options.crop) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 24) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (options.removeBackground && right < 0 && options.crop) throw Error("empty_signature_adjust_tolerance");
  let result = sharp(data, { raw: { width, height, channels: 4 } });
  if (options.crop && right >= left) result = result.extract({ left, top, width: right - left + 1, height: bottom - top + 1 });
  return result.png().toBuffer();
}
