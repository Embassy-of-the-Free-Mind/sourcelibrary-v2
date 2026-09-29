/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * T3 (#5148) at the translation door: a translation the model wrapped whole in a <meta>/<note>
 * renders as an empty page (NotesRenderer.extractMetadata moves <meta> bodies to the metadata
 * panel) and reads to the health gate as collapsed. writePageTranslation opens the wrapper
 * BEFORE judging or storing; the stored text is the unwrapped one and its content_hash matches.
 *
 * The fixture is the taxonomy's own example (Agrippa, Armatae militiae p.233: wrapper 3,520
 * characters, body 8) pulled from the mirror; the negatives are the shapes the unwrap must
 * leave alone — a long note beside a real body, and a page whose source is unknown.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  writePageTranslation, contentHash, assessTranslationHealth,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';
import {
  unwrapHiddenTranslation,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';

const QW = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/page-integrity/quick-wins.json'), 'utf8')).cases as Record<string, any>;
const agrippa = QW['agrippa-p233-buried-meta'];
const beside = QW['note-beside-body'];

function makeDbStub() {
  const calls: { updates: any[]; revisions: unknown[] } = { updates: [], revisions: [] };
  const pageDoc = { id: 'p1', book_id: 'b1', translation: { data: 'old ai', source: 'ai' } };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => pageDoc,
        find: () => ({ toArray: async () => [pageDoc] }),
        updateOne: async (...args: unknown[]) => { if (name === 'pages') calls.updates.push(args); return { modifiedCount: 1 }; },
        insertMany: async (docs: unknown[]) => { if (name === 'page_revisions') calls.revisions.push(...docs); return {}; },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return { db, calls };
}
const promptRef = { id: 'x', name: 'Standard Translation', version: 12 };

describe('writePageTranslation unwraps a buried translation (T3, #5148)', () => {
  it('stores the Agrippa p.233 translation as body text, not inside <meta>', async () => {
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1', page_type: 'text', ocr: { data: agrippa.ocr } };
    const r = await writePageTranslation(db, { page, book: { language: 'latin' }, text: agrippa.tr, promptRef });
    expect(r.written).toBe(true);
    const stored = calls.updates[0][1].$set.translation;
    expect(stored.data).not.toMatch(/<meta>/i);
    expect(stored.data).toContain('...as having power over the things within it');
    expect(stored.data).toContain('<term>Ptolemy</term>');
    expect(stored.content_hash).toBe(contentHash(stored.data));
    expect(r.text).toBe(stored.data);
  });

  it('the unwrapped text passes the health gate that the wrapped text failed', async () => {
    expect(assessTranslationHealth(agrippa.ocr, agrippa.tr).healthy).toBe(false); // body 8 → collapsed
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1', page_type: 'text', ocr: { data: agrippa.ocr } };
    const r = await writePageTranslation(db, { page, book: { language: 'latin' }, text: agrippa.tr, promptRef, refuseUnhealthy: true });
    expect(r).toMatchObject({ written: true });
    expect(calls.updates.length).toBe(1);
  });

  it('leaves a long <note> beside a real body exactly as written', async () => {
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1', page_type: 'text', ocr: { data: beside.ocr } };
    await writePageTranslation(db, { page, book: { language: 'latin' }, text: beside.tr, promptRef });
    expect(calls.updates[0][1].$set.translation.data).toBe(beside.tr);
  });

  it('does not unwrap when the page carries no OCR (the rule needs the source)', async () => {
    const { db, calls } = makeDbStub();
    const page = { id: 'p1', book_id: 'b1' };
    await writePageTranslation(db, { page, book: { language: 'latin' }, text: agrippa.tr, promptRef });
    expect(calls.updates[0][1].$set.translation.data).toBe(agrippa.tr);
    expect(unwrapHiddenTranslation({ tr: agrippa.tr })).toMatchObject({ unwrapped: false, why: 'no-source' });
  });
});
