/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * #5055: one write-time guard for every OCR and translation writer (scripts/lib/write-text-guard.mjs). A tag left
 * open in the middle of a text is a forgotten close and is repaired; one left open in the last 15%, a text that ends
 * inside a tag, the provider's MAX_TOKENS, a CLI's partial reply, or English far shorter than its source is a cut
 * read and is refused. Pins: (1) the verdicts on the shapes measured on the 2026-10-24 backlog draw; (2) a balanced
 * page comes back byte-identical; (3) the block parse leaves a cut entry out so its page goes single-page; (4) every
 * writer asks the guard before it writes (a source-level check, as routing-from-table.test.ts does).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { checkWrittenText, unclosedTags, writeGuardReason, CENSUS_P05, LENGTH_FLOOR } from '../../scripts/lib/write-text-guard.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseBlockTranslations, recordTruncatedTranslation } from '../../scripts/lib/translate-core.mjs';

const ROOT = path.resolve(__dirname, '../..');
const PROSE = 'Nullo negotio intelligitur credulitatem varie et ratione causae efficientis distingui posse, cum alia ab infantibus proficiscatur. ';
const LATIN_OCR = `<language>Latin</language>\n<page-type>text</page-type>\n\n${PROSE.repeat(8)}`;
const ENGLISH = 'It is understood with no trouble that credulity can be distinguished in various ways, since one kind proceeds from infants. ';

describe('checkWrittenText — verdicts', () => {
  it('a balanced page passes untouched, byte-identical', () => {
    const ocr = '<page-type>text</page-type>\n<header>Simplicia.</header>\n\nAnethi <margin>Dill</margin> Angelicae.\n<page-num>18</page-num>';
    for (const kind of ['ocr', 'translation']) {
      const v = checkWrittenText(ocr, { kind });
      expect(v).toMatchObject({ ok: true, verdict: 'ok', reasons: [] });
      expect(v.repaired).toBe(ocr);
    }
    const tr = `${ENGLISH.repeat(7)}<note>cf. Geber</note>\n\n<summary>A page.</summary>\n<keywords>credulity</keywords>`;
    expect(checkWrittenText(tr, { kind: 'translation', source: LATIN_OCR, lang: 'Latin' }).repaired).toBe(tr);
  });

  it('a tag left open mid-text is repaired, words unchanged', () => {
    const text = `<page-type>text</page-type>\n<header>Tractatus I\n\n<margin>imperfecte\n\n${PROSE.repeat(4)}`;
    const v = checkWrittenText(text, { kind: 'ocr' });
    expect(v).toMatchObject({ ok: true, verdict: 'repaired_mid' });
    expect(v.repaired).toContain('<header>Tractatus I</header>');
    expect(v.repaired).toContain('<margin>imperfecte</margin>');
    expect(unclosedTags(v.repaired, ['header', 'margin'])).toEqual([]);
    expect(v.repaired.replace(/<\/?(header|margin)>/g, '')).toBe(text.replace(/<\/?(header|margin)>/g, ''));
    const tr = `${ENGLISH.repeat(2)}<gloss>very many\n\n${ENGLISH.repeat(6)}`;
    expect(checkWrittenText(tr, { kind: 'translation' })).toMatchObject({ ok: true, verdict: 'repaired_mid' });
  });

  it('a tag opened in the last 15% that never closes is a cut read: refused', () => {
    // The 2026-10-24 draw: a margin loop cut at the output cap, `…<margin>id est`.
    const ocr = `<page-type>text</page-type>\n\n${'<margin>id est</margin>\n'.repeat(40)}<margin>id est`;
    expect(checkWrittenText(ocr, { kind: 'ocr' })).toMatchObject({ ok: false, verdict: 'truncated', reasons: ['unclosed-at-tail:margin'] });
    const tr = `${ENGLISH.repeat(8)}The flags are planted <gloss>all around the`;
    expect(checkWrittenText(tr, { kind: 'translation' })).toMatchObject({ ok: false, verdict: 'truncated' });
  });

  it('a text that ends inside a tag is refused; a stray `<` mid-page is not', () => {
    expect(checkWrittenText(`${PROSE.repeat(4)}<unclear>n</unclear> nṯrw <un`, { kind: 'ocr' })).toMatchObject({ verdict: 'truncated', reasons: ['ends-inside-a-tag'] });
    expect(checkWrittenText(`<language>Ancient Greek</`, { kind: 'ocr' }).verdict).toBe('truncated');
    expect(checkWrittenText(`taiaha <k he pouwhenua\n${PROSE.repeat(3)}ki te ako.`, { kind: 'ocr' }).verdict).toBe('ok');
  });

  it('a mis-named close at the tail is a close, and a reply that went on to its <vocab> finished', () => {
    // Malay verse, `<unclear>pertiwi</term>`: complete, not cut.
    expect(checkWrittenText(`${ENGLISH.repeat(8)}Bowing to the dust of the <unclear>pertiwi</term>\nLikewise, all followed`, { kind: 'translation' }).verdict).toBe('ok');
    // A Chinese play's role marker never closed, then the page's <vocab>: a forgotten close, repaired.
    const zh = `<page-type>text</page-type>\n${'他高登快楽堂金倪内熟寶香痛念'.repeat(12)}<gloss>上命差遠不敢違甲人是曹老爹來了\n\n<vocab>追薦, 靈椿</vocab>`;
    expect(checkWrittenText(zh, { kind: 'ocr' }).verdict).toBe('repaired_mid');
  });

  it('a partial CLI reply (agy at --print-timeout, #6523) and MAX_TOKENS are refused whatever the text', () => {
    const fine = `${ENGLISH.repeat(8)}`;
    expect(checkWrittenText(fine, { kind: 'translation', partial: true })).toMatchObject({ ok: false, verdict: 'truncated', reasons: ['partial-reply'] });
    expect(checkWrittenText(fine, { kind: 'ocr', finishReason: 'MAX_TOKENS' })).toMatchObject({ verdict: 'truncated', reasons: ['finish:MAX_TOKENS'] });
    expect(checkWrittenText(fine, { kind: 'ocr', finishReason: 'STOP' }).verdict).toBe('ok');
  });

  it('empty is its own verdict', () => {
    expect(checkWrittenText('  \n', { kind: 'ocr' })).toMatchObject({ ok: false, verdict: 'empty' });
  });

  it('the length rule: English under 0.35× its source in a census language is cut; notes count as English', () => {
    const short = ENGLISH; // one sentence for an eight-sentence page
    expect(checkWrittenText(short, { kind: 'translation', source: LATIN_OCR, lang: 'Latin' })).toMatchObject({ verdict: 'truncated' });
    expect(checkWrittenText(short, { kind: 'translation', source: LATIN_OCR, lang: 'Latin' }).reasons[0]).toMatch(/^short:/);
    // The page's footnotes rendered as <note>s: complete (the 2026-10-24 German false positive).
    const withNotes = `${ENGLISH.repeat(2)}\n\n${Array.from({ length: 6 }, (_, i) => `<note>${i + 1}) ${ENGLISH}</note>`).join('\n')}`;
    expect(checkWrittenText(withNotes, { kind: 'translation', source: LATIN_OCR, lang: 'Latin' }).verdict).toBe('ok');
    // Hebrew is left out (census p05 0.621: healthy pages reach that low), and so is a language the census never measured.
    const he = LATIN_OCR.replace('Latin', 'Hebrew');
    expect(checkWrittenText(short, { kind: 'translation', source: he, lang: 'Hebrew' }).verdict).toBe('ok');
    expect(CENSUS_P05.hebrew).toBeUndefined();
    for (const p05 of Object.values(CENSUS_P05) as number[]) expect(LENGTH_FLOOR).toBeLessThan(p05 / 2);
    // No source in hand: not judged.
    expect(checkWrittenText(short, { kind: 'translation' }).verdict).toBe('ok');
  });

  it('names the skip it records', () => {
    expect(writeGuardReason(checkWrittenText(`${PROSE}<gloss>x`, { kind: 'ocr' }))).toBe('write-guard:truncated:unclosed-at-tail');
  });
});

describe('parseBlockTranslations — a cut entry goes single-page', () => {
  it('leaves the truncated page out and reports it; the others stand', () => {
    const pages = [1, 2].map((n) => ({ page_number: n, ocr: { data: LATIN_OCR } }));
    const block = `<translation page="1">${ENGLISH.repeat(8)}</translation>\n<translation page="2">${ENGLISH.repeat(8)}and the <gloss>three hundred</translation>`;
    const r = parseBlockTranslations(block, pages, { lang: 'Latin' });
    expect([...r.translations.keys()]).toEqual([1]);
    expect(r.truncated).toEqual([{ page_number: 2, reasons: ['unclosed-at-tail:gloss'] }]);
    expect(r.discarded).toBeNull();
  });
});

describe('recordTruncatedTranslation — a failure marker, blocked on the second cut read', () => {
  it('stamps only an untranslated page, through a pipeline that blocks when the previous failure was the guard\'s', async () => {
    const calls: any[] = [];
    const db = { collection: () => ({ updateOne: async (...a: any[]) => { calls.push(a); return {}; }, insertOne: async (d: any) => { calls.push(['insert', d]); return {}; } }) };
    const v = checkWrittenText(`${PROSE}<gloss>x`, { kind: 'translation' });
    const reason = await recordTruncatedTranslation(db, { id: 'p1', book_id: 'b1' }, `${PROSE}<gloss>x`, v, { jobId: 'j', model: 'm' });
    expect(reason).toBe('write-guard:truncated:unclosed-at-tail');
    const [filter, pipeline] = calls[1];
    expect(filter).toMatchObject({ id: 'p1', 'translation.data': { $not: /\S/ } });
    expect(JSON.stringify(pipeline)).toContain('write-guard:');
    expect(pipeline[0].$set['translation.fail_reason']).toBe(reason);
    expect(calls[2][0]).toBe('insert');
    expect(calls[2][1]).toMatchObject({ source: 'health-gate-refused', reason, field: 'translation' });
  });
});

describe('every writer asks the guard before it writes (#5055)', () => {
  const src = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const before = (f: string, guard: string, write: string, from = '') => {
    const s = src(f);
    const start = from ? s.indexOf(from) : 0;
    expect([f, from, start >= 0]).toEqual([f, from, true]);
    const g = s.indexOf(guard, start), w = s.indexOf(write, start);
    expect([f, guard, g >= 0]).toEqual([f, guard, true]);
    expect([f, write, w >= 0]).toEqual([f, write, true]);
    expect([f, `${guard} before ${write}`, g < w]).toEqual([f, `${guard} before ${write}`, true]);
  };
  it('OCR writers', () => {
    before('scripts/batch/cli-ocr.mjs', "checkWrittenText(text, { kind: 'ocr' })", 'await saveRevisionBeforeOverwrite(db, page.id', '// ── apply ──');
    before('scripts/batch/cli-ocr.mjs', 'checkWrittenText(unwrapRead(r.text).text', "fs.writeFileSync(path.join(OUT, `${key}.txt`), text)");
    before('scripts/workers/batch-collector.mjs', "checkWrittenText(text, { kind: 'ocr' })", "'ocr.data': text,");
    before('scripts/batch/claude-ocr.mjs', "checkWrittenText(t, { kind: 'ocr' })", 'const metas = todo.map');
    before('scripts/batch/ocr-convergence/correct.mjs', "checkWrittenText(a, { kind: 'ocr' })", "return { outcome: 'corrected', text: a }");
  });
  it('translation writers', () => {
    before('scripts/lib/translate-core.mjs', "checkWrittenText(text, { kind: 'translation'", "await saveRevisionBeforeOverwrite(db, page.id, 'translation'", 'export async function writePageTranslation');
    before('scripts/lib/translate-core.mjs', 'cut(p, raw)', 'translations.set(pageNum, text)', 'export function parseBlockTranslations');
    before('scripts/workers/translate-worker.mjs', "checkWrittenText(raw, { kind: 'translation'", 'return {\n    text,\n    cut,', 'async function translatePage(');
    before('scripts/workers/translate-worker.mjs', "checkWrittenText(text, { kind: 'translation'", "await db.collection('pages').updateOne({ id: page.id }, { $set: setPayload", 'async function writePageTranslation(');
    before('scripts/workers/translate-worker.mjs', "checkWrittenText(e.text, { kind: 'translation'", 'const engines = new Map(entries.map', 'async function bulkWritePageTranslations(');
    before('scripts/workers/batch-collector.mjs', "checkWrittenText(text, { kind: 'translation'", "'translation.data': text,");
    before('scripts/batch/cli-translate.mjs', "checkWrittenText(r.answer, { kind: 'translation'", "fs.writeFileSync(path.join(OUT, `${id}.txt`), text)");
    before('scripts/batch/cli-translate.mjs', "m.write_guard === 'truncated'", 'await writePageTranslation(db, {', '// ── apply ──');
    before('scripts/batch/claude-translate.mjs', "checkWrittenText(raw, { kind: 'translation'", 'texts.set(n, sanitizeTranslationTags(t))');
    before('scripts/batch/twopass-review.mjs', 'checkWrittenText(texts.get(i + 1)', 'const reviewed = sanitizeTranslationTags(texts.get(i + 1))');
    before('scripts/lib/translate-batch-chained.mjs', "checkWrittenText(raw, { kind: 'translation'", 'const res = await writeRoundPage(db, run, book, page, text, deps, unit)', '// Single pages, one request each.');
    before('scripts/lib/translate-batch-seam.mjs', "checkWrittenText(raw, { kind: 'translation'", 'out.set(pages[0].page_number, text)', 'export function parseBlockResponse');
  });
});
