// PRIOR ART: @posthog/nextjs-config's deleteSourceMapFiles — deletes every map, after the upload; this runs before it. `git grep runAfterProductionCompile` found no other hook.
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Delete every source map under `distDir` except the browser's (`static/`), and return how many.
 *
 * Runs before `posthog-cli sourcemap process --directory .next`, which otherwise takes up all ~4,650 maps while
 * `next build` still holds its memory; the 8 GB builder SIGKILLs the build there, intermittently (#7731). Nothing
 * reports a server exception to PostHog (every `captureException` is in the browser), so the server maps resolve
 * no stack frame. The CLI's `--delete-after` already removed them from the deployment, so nothing that ships changes.
 */
export async function dropServerSourcemaps(distDir: string): Promise<number> {
  const entries = await readdir(distDir, { recursive: true, withFileTypes: true });
  const staticDir = join(distDir, 'static');
  const maps = entries
    .filter((e) => e.isFile() && e.name.endsWith('.map'))
    .map((e) => join(e.parentPath, e.name))
    .filter((path) => !path.startsWith(staticDir + '/'));
  await Promise.all(maps.map((path) => rm(path, { force: true })));
  return maps.length;
}
