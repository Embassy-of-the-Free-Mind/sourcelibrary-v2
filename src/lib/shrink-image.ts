/**
 * Bring an image File under a request-body cap, in the browser, before upload.
 *
 * PRIOR ART: src/components/feedback/useFeedbackImages.ts — its private
 * shrinkImage() is this function; moved here so the profile-photo editor
 * (#411) uses the same code instead of a second copy.
 *
 * Why it exists: Vercel refuses a function request body over 4.5 MB with a
 * plain-text 413 (FUNCTION_PAYLOAD_TOO_LARGE) before the route runs, so a
 * route-side size check never sees the file and the client gets a body that
 * is not JSON. A phone or camera photo is routinely 3–10 MB, so the shrink
 * has to happen here.
 *
 * A file already under `maxBytes` is returned unchanged. Otherwise it is drawn
 * to a canvas no longer than `maxEdge` on its longest side and re-encoded as
 * JPEG, stepping quality down once. createImageBitmap applies EXIF
 * orientation by default, so the output pixels are upright, which is what the
 * crop UI (an <img>, also EXIF-aware) showed the reader.
 */

/** Vercel's body cap is 4.5 MB; leave room for the multipart envelope. */
export const MAX_UPLOAD_BODY_BYTES = 4 * 1024 * 1024;

export async function shrinkImage(
  file: File,
  { maxBytes = MAX_UPLOAD_BODY_BYTES, maxEdge = 2400 }: { maxBytes?: number; maxEdge?: number } = {},
): Promise<File> {
  if (file.size <= maxBytes) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not shrink image');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.88, 0.7]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
  }
  throw new Error('Image is too large');
}

/**
 * Read a fetch Response as JSON, or say what happened in words a reader can
 * act on. A platform error page (413, 502, 504) is HTML or plain text, and
 * `res.json()` on it throws "JSON.parse: unexpected character…" in Firefox.
 */
export async function readJsonOrStatus(res: Response): Promise<Record<string, any>> {
  const data = await res.json().catch(() => null);
  if (data && typeof data === 'object') return data;
  if (res.status === 413) return { error: 'That image is too large to upload. Try a smaller one.' };
  return { error: `The upload did not go through (${res.status}). Please try again.` };
}
