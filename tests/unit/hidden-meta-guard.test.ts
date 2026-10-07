/**
 * The hidden-meta write guard (#5376): a translation whose continuity <meta> holds the page is
 * refused at every writer, the refusal is recorded on the page, and the text is kept.
 *
 * The fixture pages are real translations from the local mirror, whole and unedited. The parity
 * suite runs BOTH implementations (scripts/lib/hidden-translation.mjs and its TS twin in
 * src/lib/translate-write.ts) on them — two copies of a rule drift, and the batch collectors and
 * the Lambda each import a different one.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn(async () => ({})) }));

import {
  hidesPageInMeta as hidesMjs, continuityMeta, HIDDEN_META_MIN_WORDS as MIN_MJS, HIDDEN_META_REASON as REASON_MJS,
} from '../../scripts/lib/hidden-translation.mjs';
import {
  assessTranslationHealth, isCollapsed, CONTINUITY_MARKER_RE, writePageTranslation, recordRefusedTranslation as recordMjs,
} from '../../scripts/lib/translate-core.mjs';
import {
  hidesPageInMeta as hidesTs, recordRefusedTranslation as recordTs, HIDDEN_META_MIN_WORDS as MIN_TS, HIDDEN_META_REASON as REASON_TS,
} from '@/lib/translate-write';

type Case = { name: string; source: string; refuse: boolean; tr: string };
const CASES: Case[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/translate/hidden-meta-guard.json'), 'utf8')).cases;

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const hiding = (n: number, body = '') => `<meta>continues from previous page: ${words(n)}</meta>\n\n${body}`;

describe('hidesPageInMeta — real pages', () => {
  it('has both a refused and an allowed page in the fixture (the suite can fail both ways)', () => {
    expect(CASES.some(c => c.refuse)).toBe(true);
    expect(CASES.some(c => !c.refuse)).toBe(true);
  });
  for (const c of CASES) {
    it(`${c.refuse ? 'refuses' : 'allows'}: ${c.name} (${c.source})`, () => {
      expect(hidesMjs(c.tr)).toBe(c.refuse);
      expect(hidesTs(c.tr)).toBe(c.refuse);
    });
  }
});

describe('hidesPageInMeta — the edges, on both implementations', () => {
  const both = (tr: string) => { const a = hidesMjs(tr); expect(hidesTs(tr)).toBe(a); return a; };

  it('shares its threshold and reason between the two copies', () => {
    expect(MIN_TS).toBe(MIN_MJS);
    expect(REASON_TS).toBe(REASON_MJS);
  });
  it('fires at the word threshold and not one word under it', () => {
    expect(both(hiding(MIN_MJS))).toBe(true);
    expect(both(hiding(MIN_MJS - 1))).toBe(false);
  });
  it('does not fire when the body carries the page (the meta is under 80% of it)', () => {
    expect(both(hiding(60, words(40)))).toBe(false);
    expect(both(hiding(60, words(10)))).toBe(true);
  });
  it('never fires on the bare marker, a sentence about the previous page, or a page with no meta', () => {
    expect(both(`<meta>continues from previous page</meta>\n\n${words(5)}`)).toBe(false);
    expect(both(`<meta>continues from previous page's discussion of ${words(60)}</meta>`)).toBe(false);
    expect(both(words(200))).toBe(false);
    expect(both('')).toBe(false);
  });
  it('does not count other <meta> blocks — a catchword note is not the continuity marker', () => {
    expect(both(`<meta>catchword: ${words(60)}</meta>`)).toBe(false);
  });
  it('reads "continued from the previous page" as the same marker', () => {
    expect(both(`<meta>…continued from the previous page: ${words(50)}</meta>`)).toBe(true);
  });
  it('a note is visible to the reader only as apparatus: text in <note> does not count as body', () => {
    expect(both(hiding(50, `<note>${words(200)}</note>`))).toBe(true);
  });
  it('continuityMeta hands back the element and its inner text for a repair', () => {
    const cm = continuityMeta('<header>X</header>\n<meta>continues from previous page: ...and <term>so</term> on</meta>\nBody');
    expect(cm).toMatchObject({ form: 'text', words: 3, inner: 'and <term>so</term> on' });
    expect(cm!.raw).toBe('<meta>continues from previous page: ...and <term>so</term> on</meta>');
  });
});

describe('assessTranslationHealth', () => {
  it("refuses a hidden page as 'hidden-meta', ahead of 'collapsed'", () => {
    const ocr = 'lorem ipsum dolor sit amet '.repeat(40);
    const tr = hiding(120);
    expect(isCollapsed(ocr, tr)).toBe(true); // it is ALSO a collapse; the specific reason wins
    expect(assessTranslationHealth(ocr, tr)).toEqual({ healthy: false, reason: 'hidden-meta' });
  });
  it('still passes an ordinary page that opens with the marker', () => {
    const ocr = 'lorem ipsum dolor sit amet '.repeat(40);
    expect(assessTranslationHealth(ocr, hiding(6, words(180)))).toEqual({ healthy: true, reason: null });
  });
});

describe('the continuity marker in the collapse check', () => {
  it('matches what the prompt writes ("continues") as well as the older "continued"', () => {
    expect(CONTINUITY_MARKER_RE.test('<meta>continues from previous page</meta>')).toBe(true);
    expect(CONTINUITY_MARKER_RE.test('<note>continued from previous page…</note>')).toBe(true);
    expect(CONTINUITY_MARKER_RE.test('<meta>Continues from the previous page</meta>')).toBe(true);
    expect(CONTINUITY_MARKER_RE.test('the story continues on the next page')).toBe(false);
  });
});

// ── the door ───────────────────────────────────────────────────────────────────────────────────

type Update = { $set?: Record<string, unknown> & { translation?: { data?: string } } };
type Recorder = (db: unknown, page: { id: string; book_id?: string }, text: string, reason: string, opts?: { jobId?: string; model?: string }) => Promise<void>;
function makeDb(pageDoc: Record<string, unknown> = { id: 'p1', book_id: 'b1' }) {
  const calls = { pageUpdates: [] as Array<[unknown, Update]>, revisions: [] as Array<Record<string, unknown>> };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => pageDoc,
        find: () => ({ toArray: async () => [pageDoc] }),
        updateOne: async (filter: unknown, update: Update) => { if (name === 'pages') calls.pageUpdates.push([filter, update]); return { matchedCount: 1, modifiedCount: 1 }; },
        insertOne: async (doc: Record<string, unknown>) => { if (name === 'page_revisions') calls.revisions.push(doc); return {}; },
        insertMany: async (docs: Array<Record<string, unknown>>) => { if (name === 'page_revisions') calls.revisions.push(...docs); return {}; },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return { db, calls };
}
const call = { call_site: 'tests/unit/hidden-meta-guard.test.ts', promptText: 'PROMPT', generationConfig: {}, run: { code_version: 'test', host: 'test' } };
const wroteTranslation = (calls: ReturnType<typeof makeDb>['calls']) => calls.pageUpdates.some(([, u]) => u?.$set?.translation?.data !== undefined);
const stamp = (calls: ReturnType<typeof makeDb>['calls']) => calls.pageUpdates.find(([, u]) => u?.$set?.['translation.health_blocked'])?.[1].$set;
const RECORDERS: Array<[string, Recorder]> = [['mjs', recordMjs as Recorder], ['ts', recordTs as unknown as Recorder]];

describe('writePageTranslation (the .mjs door) — always on, no opt-in', () => {
  const hidden = CASES.find(c => c.refuse)!;

  it('refuses a hidden page it cannot repair, stamps the reason and keeps the text', async () => {
    const { db, calls } = makeDb();
    // No source text on the page object: the write-time unwrap declines, the refusal is what is left.
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1' }, book: { language: 'German' }, text: hidden.tr, promptRef: { id: 'x', name: 'n', version: 13 }, call });
    expect(r).toMatchObject({ written: false, protected: false, unhealthy: true, reason: 'hidden-meta' });
    expect(wroteTranslation(calls)).toBe(false);
    expect(stamp(calls)?.['translation.health_blocked']).toBe('hidden-meta');
    expect(calls.revisions).toHaveLength(1);
    expect(calls.revisions[0]).toMatchObject({ page_id: 'p1', book_id: 'b1', field: 'translation', source: 'health-gate-refused', reason: 'hidden-meta' });
    expect(String(calls.revisions[0].data)).toContain('continues from previous page');
  });

  it('writes an ordinary page (negative control: the gate is not refusing everything)', async () => {
    const { db, calls } = makeDb();
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1' }, book: { language: 'Latin' }, text: `<meta>continues from previous page</meta>\n\n${words(120)}`, promptRef: { id: 'x', name: 'n', version: 13 }, call });
    expect(r.written).toBe(true);
    expect(wroteTranslation(calls)).toBe(true);
    expect(stamp(calls)).toBeUndefined();
  });

  it('where the source is in hand the page is opened, not refused (#5148 unwrap runs first)', async () => {
    const { db, calls } = makeDb();
    const ocr = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor. '.repeat(12);
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1', ocr: { data: ocr } }, book: { language: 'Latin' }, text: hiding(120), promptRef: { id: 'x', name: 'n', version: 13 }, call });
    expect(r.written).toBe(true);
    expect(r.text).toContain('word0 word1');
    expect(r.text).not.toMatch(/<meta>/);
    expect(stamp(calls)).toBeUndefined();
  });

  it('does not stamp a page a person translated', async () => {
    const { db, calls } = makeDb({ id: 'p1', book_id: 'b1', translation: { data: 'BY HAND', source: 'manual' } });
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1' }, book: { language: 'German' }, text: hidden.tr, promptRef: { id: 'x', name: 'n', version: 13 }, call });
    expect(r).toMatchObject({ written: false, protected: true });
    expect(calls.pageUpdates).toHaveLength(0);
  });
});

describe('recordRefusedTranslation — the recorded skip, both copies', () => {
  for (const [label, record] of RECORDERS) {
    it(`${label}: stamps translation.health_blocked and files the text under health-gate-refused`, async () => {
      const { db, calls } = makeDb();
      await record(db, { id: 'p9', book_id: 'b9' }, 'REFUSED TEXT', 'hidden-meta', { jobId: 'job1', model: 'm' });
      // a dotted $set cannot descend into `translation: null` — the null is replaced first
      expect(calls.pageUpdates[0][0]).toEqual({ id: 'p9', translation: null });
      const s = stamp(calls);
      expect(s?.['translation.health_blocked']).toBe('hidden-meta');
      expect(s?.['translation.health_blocked_at']).toBeInstanceOf(Date);
      expect(calls.revisions).toHaveLength(1);
      expect(calls.revisions[0]).toMatchObject({ page_id: 'p9', book_id: 'b9', field: 'translation', data: 'REFUSED TEXT', source: 'health-gate-refused', reason: 'hidden-meta', job_id: 'job1', model: 'm', original_length: 12, truncated: false });
    });
    it(`${label}: never throws when the store does`, async () => {
      const db = { collection: () => ({ updateOne: async () => { throw new Error('down'); }, insertOne: async () => { throw new Error('down'); } }) };
      await expect(record(db, { id: 'p9' }, 'x', 'hidden-meta')).resolves.toBeUndefined();
    });
  }
});

// Every unattended writer of model translation text asks the question before it stores a page.
// This catches a writer LOSING its check (the failure it can see); it cannot see a new writer,
// which is why the standing detector is on the read side (scripts/audit/hidden-meta-scan.mjs).
describe('the writers', () => {
  const WRITERS = [
    'scripts/workers/translate-worker.mjs',          // Hetzner realtime — via assessTranslationHealth
    'scripts/workers/batch-collector.mjs',           // Hetzner batch collector
    'scripts/batch/collect-batch-results.mjs',       // manual batch collect
    'scripts/lib/translate-core.mjs',                // the door (chained + seam batch lanes, retranslate, restore)
    'src/workers/translation-processor-logic.ts',    // Lambda
    'src/app/api/books/[id]/batch-translate-async/route.ts',
    'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts',
    'src/app/api/batch-save/route.ts',
    'src/app/api/process/route.ts',
    'src/app/api/contribute/process/route.ts',
  ];
  for (const f of WRITERS) {
    it(`${f} calls the gate`, () => {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      expect(/\b(?:hidesPageInMeta|assessTranslationHealth)\(/.test(src)).toBe(true);
    });
  }
});
