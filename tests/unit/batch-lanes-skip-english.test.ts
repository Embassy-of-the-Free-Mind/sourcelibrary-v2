/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * #5154 follow-up: the batch translation lanes (seam and chained) never send English to be
 * "translated" into English — Derek, 2026-09-30: "I don't want to do any more English-English
 * translations, just OCR." An English book is refused at enrolment; an English page inside any
 * book is left out of selection, dropped at planning, and not written at collection.
 *
 * Fixtures are real mirror pages (tests/fixtures/same-language/pages.json). Negative controls: a
 * Latin page in a Latin book passes every gate unchanged.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  sameLanguageReason,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';
import {
  selectPages, planRun,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-batch-seam.mjs';
import {
  planNextRound, enrolChainedRun,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-batch-chained.mjs';
import {
  contentHash,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/write-provenance.mjs';

const C = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/same-language/pages.json'), 'utf8')).cases as Record<string, any>;
const english = { id: 'pe', book_id: 'b1', page_number: 1, page_type: 'text', ocr: { data: C.maori_preface.ocr } };
const latin = { id: 'pl', book_id: 'b1', page_number: 2, page_type: 'text', ocr: { data: C.latin_prose.ocr } };

function dbWith({ book, pages }: { book: any; pages: any[] }) {
  return {
    collection(name: string) {
      if (name === 'books') return { findOne: async () => book };
      if (name === 'pages') return { find: () => ({ sort: () => ({ toArray: async () => pages }) }) };
      return { findOne: async () => null };
    },
  };
}

describe('sameLanguageReason', () => {
  it('names an English book and an English page', () => {
    expect(sameLanguageReason({ book: { language: 'English' } })).toBe('english-book');
    expect(sameLanguageReason({ book: { language: 'Maori' }, page: english })).toBe('english-page');
  });
  it('NEGATIVE CONTROL: a Latin page in a Latin book goes to the translator', () => {
    expect(sameLanguageReason({ book: { language: 'Latin' }, page: latin })).toBeNull();
  });
});

describe('seam lane', () => {
  it('selectPages leaves the English page out and counts it; keeps the Latin page', async () => {
    const r = await selectPages(dbWith({ book: { id: 'b1', language: 'Latin' }, pages: [english, latin] }), 'b1');
    expect(r.pages.map((p: any) => p.id)).toEqual(['pl']);
    expect(r.excluded.same_language).toBe(1);
  });
  it('planRun refuses an English book before any page is read', async () => {
    const r = await planRun(dbWith({ book: { id: 'b1', language: 'English' }, pages: [english] }), 'b1');
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^english-book/) });
  });
});

describe('chained lane', () => {
  const run = (pages: any[]) => ({ queue: pages.map((p) => ({ id: p.id, page_number: p.page_number, ocr_hash: contentHash(p.ocr.data) })), cursor: 0 });
  it('planNextRound drops an English page as same_language and sends the Latin one', () => {
    const plan = planNextRound(run([english, latin]), new Map([[english.id, english], [latin.id, latin]]));
    expect(plan.dropped).toEqual([{ id: 'pe', reason: 'same_language' }]);
    expect(plan.pages.map((p: any) => p.id)).toEqual(['pl']);
  });
  it('NEGATIVE CONTROL: a queue of Latin pages drops nothing', () => {
    const plan = planNextRound(run([latin]), new Map([[latin.id, latin]]));
    expect(plan.dropped).toEqual([]);
  });
  it('enrolChainedRun refuses an English book', async () => {
    const r = await enrolChainedRun(dbWith({ book: { id: 'b1', language: 'English' }, pages: [english] }), 'b1', { log: () => {} }, { approvedUsd: 1 });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^english-book/) });
  });
});
