// Single source of truth for the CLIP visual-embedding service endpoint.
//
// The image-search routes (/api/identify, /api/gallery, /api/search/visual,
// /api/search/unified) and the Librarian all call a self-hosted CLIP box to
// turn text/images into embeddings for visual search. The base URL used to be
// a bare-IP literal duplicated in five files — change the host and you had to
// find every copy. It now lives here: override with the CLIP_URL env var, or
// fall back to the default host.

const DEFAULT_CLIP_URL = 'http://46.224.122.120:3456/clip';

/** Resolved CLIP service base URL. Append `/embed-text` or `/embed-image`. */
export const CLIP_URL = process.env.CLIP_URL || DEFAULT_CLIP_URL;

/** True when CLIP_URL is explicitly configured (not relying on the fallback host). */
export const isClipConfigured = (): boolean => !!process.env.CLIP_URL;

// Surface the liability once per cold start: if we're in production and no
// CLIP_URL is set, visual search depends on the hardcoded fallback host.
if (process.env.NODE_ENV === 'production' && !process.env.CLIP_URL) {
  console.warn(`[clip] CLIP_URL not set — visual search is using the fallback host ${DEFAULT_CLIP_URL}. Set CLIP_URL to make this configurable.`);
}
