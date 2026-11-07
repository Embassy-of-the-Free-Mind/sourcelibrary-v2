import { describe, it, expect } from 'vitest';
import {
  candidateKey, pagePrefix, classifyRead, jobOf, keptHashes, planObjects, pendingObjects, textProblem, pageIdOf,
  // @ts-expect-error — .mjs maintenance script, no types
} from '../../scripts/maintenance/archive-candidate-reads.mjs';
// @ts-expect-error — .mjs lib, no types
import { contentHash } from '../../scripts/lib/write-provenance.mjs';

/**
 * Unwritten reads go to R2 under the page they belong to (#7075). The key must carry its own book id (#3362: a
 * book-independent key is shared between books by construction), a read already kept in page_revisions or on the page
 * is not copied again, and a re-run plans nothing new.
 */
const BOOK = '69dfeb9f090ad7d5c33b0a11';
const PAGE = '69dfebac090ad7d5c33b187a';

const read = (text: string, over: Record<string, unknown> = {}) => ({
  pageId: PAGE, field: 'ocr', hash: contentHash(text.trim()), kept: keptHashes(text), bytes: text.length,
  model: 'gemini-3.8-flash-low', job: 'flash-reread-agy2-5924', readDir: 'flash-reread-agy2-5924/F', txtPath: `/jobs/x/${PAGE}.txt`, ...over,
});
const pages = new Map([[PAGE, { id: PAGE, book_id: BOOK, page_number: 872 }]]);

describe('archive-candidate-reads key', () => {
  it('is book-scoped and shaped candidate-reads/<book>/<page>/<field>/<hash>.json', () => {
    const h = contentHash('Liber primus');
    expect(candidateKey(BOOK, PAGE, 'ocr', h)).toBe(`candidate-reads/${BOOK}/${PAGE}/ocr/${h}.json`);
    expect(pagePrefix(BOOK, PAGE)).toBe(`candidate-reads/${BOOK}/${PAGE}/`);
  });
  it('refuses a missing book id, a bad field, a bad hash', () => {
    const h = contentHash('x');
    expect(() => candidateKey(undefined, PAGE, 'ocr', h)).toThrow();
    expect(() => candidateKey('', PAGE, 'ocr', h)).toThrow();
    expect(() => candidateKey(BOOK, PAGE, 'summary', h)).toThrow();
    expect(() => candidateKey(BOOK, PAGE, 'ocr', 'not-a-hash')).toThrow();
    expect(() => candidateKey(BOOK, 'a/b', 'ocr', h)).toThrow();
  });
});

describe('archive-candidate-reads classification', () => {
  it('reads the field from the read site, the agy meta, or the prompt name', () => {
    expect(classifyRead({ read_site: 'scripts/batch/claude-ocr.mjs' })).toBe('ocr');
    expect(classifyRead({ read_site: 'scripts/batch/ocr-convergence/correct.mjs', outcome: 'corrected' })).toBe('ocr');
    expect(classifyRead({ read_site: 'scripts/batch/claude-translate.mjs' })).toBe('translation');
    expect(classifyRead({ read_site: 'scripts/batch/twopass-review.mjs' })).toBe('translation');
    expect(classifyRead({ cli: 'agy', model: 'gemini-3.8-flash-low' })).toBe('ocr');
    expect(classifyRead({ cli: 'agy', ocr_hash: 'abc', prompt_ref: {} })).toBe('translation');
    expect(classifyRead({ cli: 'agy', mode: 'correct' })).toBe('ocr');
    expect(classifyRead({ api: 'gemini', prompt_ref: { name: 'Standard Translation' } })).toBe('translation');
    expect(classifyRead({ api: 'gemini', prompt_ref: { name: 'Standard OCR' } })).toBe('ocr');
    expect(classifyRead({ models: ['claude-opus-5-5'] })).toHaveProperty('unknown');
  });
  it('names the job by the folder under jobs/, even when the root is one job dir', () => {
    expect(jobOf('/mnt/v/jobs/flash-reread-agy2-5924/F', '/mnt/v/jobs/flash-reread-agy2-5924').job).toBe('flash-reread-agy2-5924');
    expect(jobOf('/data/scratch/sl/jobs/g4-hard-6707/read', '/data/scratch/sl/jobs').job).toBe('g4-hard-6707');
  });
  it('takes the page id from the meta, else only from a 24-hex file name', () => {
    expect(pageIdOf({ page_id: PAGE }, 'whatever')).toBe(PAGE);
    expect(pageIdOf({}, PAGE)).toBe(PAGE);
    expect(pageIdOf({}, '10-b')).toBeNull();
  });
  it('skips empty and chatter texts', () => {
    expect(textProblem('   ', 'ocr')).toBe('empty');
    expect(textProblem('I cannot transcribe this image.', 'ocr')).toBeTruthy();
    expect(textProblem('Sure, here is the translation:', 'translation')).toBeTruthy();
    expect(textProblem('<page-type>body</page-type>\nIn principio erat verbum', 'ocr')).toBeNull();
  });
});

describe('archive-candidate-reads planning', () => {
  it('skips a read equal to a page_revisions row (or the current field), whitespace aside', () => {
    const text = 'In principio erat verbum\net verbum erat apud Deum';
    const kept = new Map([[`${PAGE}|ocr`, new Set(keptHashes('In principio erat verbum et verbum   erat apud Deum'))]]);
    const tally = { skip: {} as Record<string, number>, unknown: {}, byJobFieldModel: {}, candidates: 0, bytes: 0 };
    const objects = planObjects([read(text)], pages, kept, tally);
    expect(objects.size).toBe(0);
    expect(tally.skip['already kept (current field or page_revisions)']).toBe(1);
  });
  it('a kept translation does not hide an OCR read with the same text', () => {
    const kept = new Map([[`${PAGE}|translation`, new Set(keptHashes('same'))]]);
    expect(planObjects([read('same')], pages, kept).size).toBe(1);
  });
  it('skips a page Mongo does not have; never takes the book from the path', () => {
    const tally = { skip: {}, unknown: {} as Record<string, number>, byJobFieldModel: {}, candidates: 0, bytes: 0 };
    expect(planObjects([read('x', { pageId: '000000000000000000000000' })], pages, new Map(), tally).size).toBe(0);
    expect(Object.keys(tally.unknown)[0]).toMatch(/page not in Mongo/);
  });
  it('is idempotent: identical texts make one object, a re-plan gives the same keys, a checkpointed key is not resent', () => {
    const a = read('Liber secundus', { txtPath: '/jobs/a.txt' });
    const b = read('Liber secundus', { txtPath: '/jobs/b.txt' });
    const first = planObjects([a, b], pages, new Map());
    expect(first.size).toBe(1);
    expect([...first.values()][0].sources).toEqual(['/jobs/a.txt', '/jobs/b.txt']);
    const again = planObjects([a, b], pages, new Map());
    expect([...again.keys()]).toEqual([...first.keys()]);
    expect(pendingObjects(again, new Set(first.keys()))).toEqual([]);
  });
});
