/**
 * Shrink a photo so the free 1 GB of storage lasts as long as possible.
 * Target ~100 KB: long edge <= 1600px, WebP when the browser can encode it (Chrome/Android), otherwise JPEG.
 * Quality and size step down until the target is met, but never below 900px so bill text stays readable.
 */
export const TARGET_KB = 100;
export const MAX_PDF_MB = 2;

export async function compressImage(file: File, maxKB = TARGET_KB): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= maxKB * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const longEdge = Math.max(bmp.width, bmp.height);
    let scale = Math.min(1, 1600 / longEdge);
    const minScale = Math.min(1, 900 / longEdge);
    let best: Blob | null = null;
    for (let step = 0; step < 8; step++) {
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.7, 0.55, 0.42]) {
        let blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/webp", q));
        if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= maxKB * 1024) return toFile(blob, file.name);
      }
      if (scale <= minScale) break;
      scale = Math.max(minScale, scale * 0.8);
    }
    if (best && best.size < file.size) return toFile(best, file.name);
  } catch { /* fall through: keep the original */ }
  return file;
}

function toFile(blob: Blob, name: string) {
  return new File([blob], name.replace(/\.\w+$/, "") + (blob.type === "image/webp" ? ".webp" : ".jpg"), { type: blob.type });
}
