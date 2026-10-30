import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTestDb, cleanDb } from '../setup';
import { PAGE_API_PROJECTION, READER_PAGE_PROJECTION, withoutTextLayer } from '@/lib/reader-page-projection';
import { translationLayers } from '../../scripts/lib/translation-text.mjs';

// #5942 pre-go test (Derek, 2026-10-28): a page the notes-layer backfill has written must reach the
// reader exactly as a page it never touched — the stored text layer stays on the server.

const DATA = 'Geomancy <note>divination by figures cast in earth</note>, an art of the Arabs, is <margin>Hermes</margin> taught here.';
const base = (id: string) => ({
  id, book_id: 'b1', page_number: 3, photo: 'https://example.org/p.jpg', detected_images: [{ x: 1 }],
  translation: { data: DATA, language: 'English', model: 'm', source: 'ai', prompt_version: '13', updated_at: new Date('2026-01-01T00:00:00Z'), content_hash: 'abc' },
  ocr: { data: 'Geomantia ars Arabum', language: 'Latin' },
});
const backfilled = (id: string) => {
  const p = base(id);
  const l = translationLayers(DATA, { promptVersion: 13 });
  return { ...p, translation: { ...p.translation, text: l.text, text_from: l.text_from } };
};
const sameButId = (a: unknown, b: unknown) => expect(JSON.stringify({ ...(a as object), id: 'x' })).toBe(JSON.stringify({ ...(b as object), id: 'x' }));

describe('reader payload without the stored text layer (#5942)', () => {
  beforeEach(cleanDb);

  it('/api/pages/* projection: a backfilled page equals a non-backfilled one', async () => {
    const db = getTestDb();
    await db.collection('pages').insertMany([base('plain'), backfilled('filled')]);
    const a = await db.collection('pages').findOne({ id: 'plain' }, { projection: { _id: 0, ...PAGE_API_PROJECTION } });
    const b = await db.collection('pages').findOne({ id: 'filled' }, { projection: { _id: 0, ...PAGE_API_PROJECTION } });
    expect(b!.translation.text).toBeUndefined();
    expect(b!.translation.text_from).toBeUndefined();
    expect(b!.detected_images).toBeUndefined();
    sameButId(a, b);
  });

  it('reader route (inclusion projection + withoutTextLayer): a backfilled page equals a non-backfilled one', async () => {
    const db = getTestDb();
    await db.collection('pages').insertMany([base('plain'), backfilled('filled')]);
    const a = withoutTextLayer(await db.collection('pages').findOne({ id: 'plain' }, { projection: READER_PAGE_PROJECTION }));
    const b = withoutTextLayer(await db.collection('pages').findOne({ id: 'filled' }, { projection: READER_PAGE_PROJECTION }));
    expect(b!.translation.text).toBeUndefined();
    sameButId(a, b);
    // A page without the layer is returned as the same object (no copy, nothing changed).
    const plain = base('p');
    expect(withoutTextLayer(plain)).toBe(plain);
    expect(withoutTextLayer(null)).toBeNull();
  });

  it('every reader door uses them', () => {
    const uses = (f: string, s: string) => expect(readFileSync(f, 'utf8')).toContain(s);
    uses('src/app/book/[id]/page/[pageId]/(reader)/page.tsx', 'withoutTextLayer(');
    uses('src/app/book/[id]/page/[pageId]/reader-v2-data.ts', 'withoutTextLayer(');
    for (const f of ['src/app/api/pages/[id]/route.ts', 'src/app/api/[tenant]/pages/[id]/route.ts', 'src/app/api/pages/batch/route.ts', 'src/app/api/[tenant]/pages/batch/route.ts']) {
      uses(f, 'PAGE_API_PROJECTION');
      expect(readFileSync(f, 'utf8')).not.toContain('{ detected_images: 0 }');
    }
  });
});
