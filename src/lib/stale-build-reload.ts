// PRIOR ART: src/components/providers/ErrorBoundary.tsx — its reload is a manual button for any error; this is an automatic, once-per-URL reload for build-mismatch errors only.
//
// A tab that ends up holding chunks from two different builds crashes with
// "(0, x.default) is not a function" or a ChunkLoadError: since Next 16.4 the
// same module id carries differently-mangled export names in each build, so a
// newer module satisfies an older chunk's import with the wrong shape. A full
// reload fetches one consistent build. Done once per URL per minute, so a
// genuine bug still reaches the error screen instead of looping.

const STALE_BUILD_PATTERN =
  /is not a function|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk|error loading dynamically imported module|Importing a module script failed/i;

const STORAGE_KEY = 'sl:stale-build-reload';
const WINDOW_MS = 60_000;

export function isStaleBuildError(error: { message?: string; name?: string } | null | undefined): boolean {
  if (!error) return false;
  return STALE_BUILD_PATTERN.test(`${error.name ?? ''} ${error.message ?? ''}`);
}

/** Reloads the page and returns true when the error looks like a build mismatch and this URL has not just been reloaded for one. */
export function reloadOnceForStaleBuild(error: { message?: string; name?: string } | null | undefined): boolean {
  if (typeof window === 'undefined' || !isStaleBuildError(error)) return false;
  const url = window.location.href;
  try {
    const last = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as { url: string; at: number } | null;
    if (last && last.url === url && Date.now() - last.at < WINDOW_MS) return false;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ url, at: Date.now() }));
  } catch {
    // Without sessionStorage there is no loop guard, so do not reload.
    return false;
  }
  window.location.reload();
  return true;
}
