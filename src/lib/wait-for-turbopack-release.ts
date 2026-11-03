// PRIOR ART: none — `git grep -E "memoryUsage|project.shutdown"` over src/ and scripts/ found no wait on the compiler; Next awaits its shutdownPromise only at the very end of the build.
const GB = 2 ** 30;

/**
 * Wait until this process's RSS falls under `limitBytes`, or `timeoutMs` passes, and report which.
 *
 * Next starts Turbopack's shutdown when the compile ends but awaits it only when the whole build ends, so the next
 * step starts while the compiler still holds ~4.5 GB of the builder's 8 GB (#7731). Turbopack is native memory inside
 * this process, measured falling to ~0.5 GB about 14 s after the compile ended, and 6 of the 19 OOMs in 18 days came
 * 10-14 s after it. Never throws: a slow release costs the timeout, not the build.
 */
export async function waitForTurbopackRelease({
  limitBytes = 1.5 * GB,
  timeoutMs = 45_000,
  pollMs = 250,
  rss = () => process.memoryUsage.rss(),
}: {
  limitBytes?: number;
  timeoutMs?: number;
  pollMs?: number;
  rss?: () => number;
} = {}): Promise<{ released: boolean; waitedMs: number; rssBytes: number }> {
  const start = Date.now();
  for (;;) {
    const rssBytes = rss();
    const waitedMs = Date.now() - start;
    if (rssBytes < limitBytes) return { released: true, waitedMs, rssBytes };
    if (waitedMs >= timeoutMs) return { released: false, waitedMs, rssBytes };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
