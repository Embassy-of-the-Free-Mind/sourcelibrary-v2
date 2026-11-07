/**
 * A catalogue link inside the Embassy's iframe must stay in the room (#8047).
 * `/catalog` is the room on bph.sourcelibrary.org, and the GLOBAL catalogue on
 * sourcelibrary.org, where the frame goes blank (X-Frame-Options: DENY).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { tenantRoomPrefix } from '@/lib/tenant-room-href';

const repoRoot = path.resolve(__dirname, '../..');
const walk = (dir: string): string[] =>
  readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : /\.tsx$/.test(e.name) ? [rel] : [];
  });

describe('tenantRoomPrefix', () => {
  it('is empty on the subdomain, where /catalog is the room', () => {
    expect(tenantRoomPrefix('bph', 'bph.sourcelibrary.org')).toBe('');
  });
  it('carries the prefix on the apex and locally', () => {
    expect(tenantRoomPrefix('bph', 'sourcelibrary.org')).toBe('/embed/bph');
    expect(tenantRoomPrefix('bph', 'localhost:3107')).toBe('/embed/bph');
  });
});

describe('catalogue pages write no bare /catalog link', () => {
  const files = [...walk('src/app/embed/[tenant]/catalog'), 'src/components/embed/CatalogueUnavailable.tsx', 'src/components/catalog/CatalogEditorNav.tsx', 'src/components/catalog/BphWorkEditForm.tsx', 'src/components/catalog/PendingChangesInbox.tsx'];
  it.each(files)('%s', file => {
    const src = readFileSync(path.join(repoRoot, file), 'utf8');
    expect(src).not.toMatch(/href=(?:"\/catalog|\{`\/catalog)/);
    expect(src).not.toMatch(/(?:redirect|router\.push)\((?:'|`)\/catalog/);
  });
});

describe('/embed/<tenant>/catalog', () => {
  const req = (url: string) =>
    new NextRequest(url, {
      headers: { host: new URL(url).host, 'user-agent': 'Mozilla/5.0 Chrome/124', 'accept-language': 'en', 'sec-fetch-mode': 'navigate' },
    });
  const rewriteOf = async (url: string) => (await proxy(req(url)))?.headers.get('x-middleware-rewrite') ?? null;

  it.each(['catalog', 'catalogue'])('/embed/bph/%s shows the catalogue view, keeping the query', async seg => {
    const target = await rewriteOf(`https://sourcelibrary.org/embed/bph/${seg}?cq=maier`);
    expect(new URL(target!).pathname).toBe('/embed/bph');
    expect(new URL(target!).searchParams.get('view')).toBe('catalog');
    expect(new URL(target!).searchParams.get('cq')).toBe('maier');
  });
  it('leaves a record alone', async () => {
    expect(await rewriteOf('https://sourcelibrary.org/embed/bph/catalog/9180')).toBeNull();
  });
  it('sends a manuscript tenant to its own catalogue route', async () => {
    expect(new URL((await rewriteOf('https://sourcelibrary.org/embed/bhutan/catalog'))!).pathname).toBe('/embed/bhutan/catalogue');
    expect(await rewriteOf('https://sourcelibrary.org/embed/bhutan/catalogue')).toBeNull();
  });
});
