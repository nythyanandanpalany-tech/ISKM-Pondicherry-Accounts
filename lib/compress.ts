/** Shrink a photo to roughly <= maxKB (default 150) so storage stays small. PDFs pass through. */
export async function compressImage(file: File, maxKB = 150): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= maxKB * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.8, 0.65, 0.5, 0.4]) {
        const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
        if (blob && blob.size <= maxKB * 1024) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
      }
      scale *= 0.75;
    }
  } catch { /* fall through */ }
  return file;
}
