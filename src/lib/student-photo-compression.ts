/** Browser-only photo preparation. No server codec or additional dependency. */
export const STUDENT_PHOTO_TARGET_BYTES = 180 * 1024;
export const STUDENT_PHOTO_MAX_EDGE = 1024;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Older phones use the image element decoder. */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Photo illisible : ${file.name}`));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function compressStudentPhoto(file: File): Promise<File> {
  // Preserve other historically accepted formats. JPG/JPEG/PNG are optimized.
  if (!/^image\/(jpeg|png)$/i.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) return file;
  const decoded = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    if (!decoded.width || !decoded.height) throw new Error(`Photo illisible : ${file.name}`);
    const scale = Math.min(1, STUDENT_PHOTO_MAX_EDGE / Math.max(decoded.width, decoded.height));
    if (scale === 1 && file.size <= STUDENT_PHOTO_TARGET_BYTES) return file;
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Compression des photos indisponible sur ce navigateur.");
    // PNG transparency becomes white rather than black on school documents.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    let output: Blob | null = null;
    for (const quality of [0.88, 0.8, 0.72, 0.64]) {
      output = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!output) throw new Error(`Compression impossible : ${file.name}`);
      if (output.size <= STUDENT_PHOTO_TARGET_BYTES) break;
    }
    if (!output || output.size >= file.size) return file;
    // Preserve the basename used to match the student by name or matricule.
    return new File([output], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    decoded.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
