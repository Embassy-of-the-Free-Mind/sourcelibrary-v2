import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dropServerSourcemaps } from '@/lib/drop-server-sourcemaps';

describe('dropServerSourcemaps (#7731)', () => {
  let dist: string;
  const put = async (rel: string) => {
    await mkdir(dirname(join(dist, rel)), { recursive: true });
    await writeFile(join(dist, rel), '{}');
  };

  beforeEach(async () => { dist = await mkdtemp(join(tmpdir(), 'drop-maps-')); });
  afterEach(async () => { await rm(dist, { recursive: true, force: true }); });

  it('keeps the browser maps and the JS, and removes every other map', async () => {
    await put('static/chunks/a.js');
    await put('static/chunks/a.js.map');
    await put('static/chunks/nested/b.css.map');
    await put('server/chunks/c.js');
    await put('server/chunks/c.js.map');
    await put('server/app/page.js.map');
    await put('server/edge/chunks/d.js.map');
    await put('build/chunks/e.js.map');

    expect(await dropServerSourcemaps(dist)).toBe(4);

    for (const kept of ['static/chunks/a.js', 'static/chunks/a.js.map', 'static/chunks/nested/b.css.map', 'server/chunks/c.js']) {
      expect(existsSync(join(dist, kept)), kept).toBe(true);
    }
    for (const gone of ['server/chunks/c.js.map', 'server/app/page.js.map', 'server/edge/chunks/d.js.map', 'build/chunks/e.js.map']) {
      expect(existsSync(join(dist, gone)), gone).toBe(false);
    }
  });

  it('does not mistake a sibling directory whose name starts with static for the browser maps', async () => {
    await put('static-extra/f.js.map');
    expect(await dropServerSourcemaps(dist)).toBe(1);
  });
});
