/**
 * Headers for a request this deployment makes to its OWN deployment URL.
 *
 * PRIOR ART: src/lib/api-client/images.ts withInternalImageToken — signs
 * /api/image URLs for the image budget; it does not get a request past Vercel
 * Deployment Protection, which answers before any of our code runs.
 *
 * Production calls itself through `https://${VERCEL_URL}` (cache warm, split
 * checks, revalidation, pipeline steps, batch-OCR crops). Every deployment URL
 * sits behind Vercel Deployment Protection (#7155), so those calls must carry
 * the project's automation-bypass secret, which Vercel injects into every
 * build as VERCEL_AUTOMATION_BYPASS_SECRET.
 *
 * The secret is attached ONLY when the target is this deployment's own host,
 * so a helper that also fetches external URLs (images from archive.org, etc.)
 * can call this unconditionally without ever sending the secret off-site.
 */
export function selfCallHeaders(url: string): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const ownHost = process.env.VERCEL_URL;
  if (!secret || !ownHost) return {};
  try {
    return new URL(url).host === ownHost ? { 'x-vercel-protection-bypass': secret } : {};
  } catch {
    return {};
  }
}
