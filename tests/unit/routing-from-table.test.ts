/**
 * #7170: the translation routers READ their table, and the OCR refusal lane its `refused-pages` row (getOcrModelForBook reads
 * the router table since #8283: tests/unit/router-bound-table.test.ts). This pins three things:
 *   - the router follows the table (an edited table routes differently, with no code change);
 *   - a malformed table fails loudly (at import, and so in this test), never routing to lite by accident;
 *   - an absent route falls back to the default row.
 * What each route SHOULD be is the table's business and its evidence's; tests/unit/ocr-routing-table.test.ts and
 * translate-core-parity.test.ts hold the rows to the evidence and the two routers to each other.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OCR_ROUTING_TABLE, OCR_MODEL_FLASH, OCR_MODEL_LITE, FLASH_OCR_FROM, FLASH_OCR_INCLUDES_HIDDEN,
  isFlashOcrBook, getOcrModelForBook, ocrRefusalFallback,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-routing.mjs';
import {
  TRANSLATION_ROUTING_TABLE, getTranslateModelForBook, MODEL_FLASH, MODEL_LITE, isFlashMeasuredLanguage,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';
import { translateEngineFor, validateTranslationTable, prefixRegex, translateLaneForBook, tableRowFor, cliBookFilter, CLI_TRANSLATE_LANES } from '../../scripts/lib/translation-routing.mjs';
import { getTranslateModelForBook as getTranslateModelForBookTs } from '../../src/lib/types/ai-models';

type Row = { id: string };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const LANGUAGE_OF: Record<string, string> = { grc: 'Greek', fas: 'Persian', san: 'Sanskrit', pli: 'Pali', ara: 'Arabic', gez: "Ge'ez", zho: 'Chinese' };
const OLD = new Date('2020-01-01');
const ROOT = path.resolve(__dirname, '../..');

describe('OCR: the legacy label, and the refusal lane reading its row', () => {
  it('a visible book in each routed family reads on flash; an old hidden one only where hidden is set', () => {
    for (const f of Object.keys(FLASH_OCR_FROM)) {
      const language = LANGUAGE_OF[f];
      expect([f, !!language]).toEqual([f, true]);
      expect([f, getOcrModelForBook({ language, visible: true, created_at: OLD }, { liteOnly: true })]).toEqual([f, OCR_MODEL_FLASH]);
      expect([f, isFlashOcrBook({ language, visible: false, created_at: OLD })]).toEqual([f, FLASH_OCR_INCLUDES_HIDDEN.has(f)]);
    }
    expect(getOcrModelForBook({ language: 'Latin', visible: true, created_at: OLD }, { liteOnly: true })).toBe(OCR_MODEL_LITE);
  });

  it('the refusal fallback is never Gemini, names a lane file that exists, and was adopted from a proposal file', () => {
    const route = (OCR_ROUTING_TABLE.rows as (Row & { route?: { fallback?: { chart: string; engine: string; lane: string }[]; otherwise?: string; source?: string } })[])
      .find((r) => r.id === 'refused-pages')!.route!;
    expect(route.fallback!.length).toBeGreaterThanOrEqual(5);
    expect(fs.existsSync(path.join(ROOT, route.source!))).toBe(true);
    for (const f of route.fallback!) {
      expect([f.chart, /^gemini/.test(f.engine)]).toEqual([f.chart, false]);
      expect([f.chart, fs.existsSync(path.join(ROOT, f.lane.split(' ')[0]))]).toEqual([f.chart, true]);
    }
    expect(/^gemini/.test(route.otherwise!)).toBe(false);
    expect(ocrRefusalFallback('greek').engine).toBe(route.fallback!.find((f) => f.chart === 'greek')!.engine);
    expect(ocrRefusalFallback('no-such-chart').engine).toBe(route.otherwise);
  });
});

describe('Translation: both routers read translation-routing-table.json', () => {
  const PROBES: [string, unknown][] = [
    ['Latin', MODEL_LITE], ['German', MODEL_LITE], ['Syriac', MODEL_LITE], ['Latin; Greek', MODEL_LITE],
    ['Greek', MODEL_FLASH], ['Ancient  Greek', MODEL_FLASH], ['Greek, Latin', MODEL_FLASH], ['Classical Chinese', MODEL_FLASH],
    ['Hebrew and Aramaic', MODEL_FLASH], ['Ancient Hebrew', MODEL_FLASH], ['ancient  Chinese', MODEL_FLASH], ['Ancient Egyptian', MODEL_LITE], ['Tibetan (script); Tibetan; Chinese', MODEL_FLASH], ['Greekish', MODEL_LITE],
  ];

  it('the table routes today as the measured rules say (#4742, #5695), in the .mjs and the TS router alike', () => {
    for (const [language, want] of PROBES) {
      expect([language, getTranslateModelForBook({ language })]).toEqual([language, want]);
      expect([language, getTranslateModelForBookTs({ language })]).toEqual([language, want]);
    }
    expect(getTranslateModelForBook({ language: 'Latin', image_source: { provider: 'bph' } })).toBe(MODEL_FLASH);
    expect(isFlashMeasuredLanguage({ language: 'Persian' })).toBe(true);
    expect(isFlashMeasuredLanguage({ language: 'Tibetan' })).toBe(false);
  });

  it('an edited table routes differently with no code change', () => {
    const t = clone(TRANSLATION_ROUTING_TABLE);
    t.rows.push({ id: 'german-test', match: { language_prefix: ['german'] }, engine: MODEL_FLASH, evidence: [{ issue: 1 }] });
    expect(translateEngineFor(validateTranslationTable(t, [MODEL_FLASH, MODEL_LITE]), { language: 'German' })).toBe(MODEL_FLASH);
  });

  it('a row the Batch routers cannot run, or a malformed match, throws', () => {
    // The first BATCH row: a cli row may name a subscription reader, so rows[0] is not the one to corrupt (#7075).
    const firstBatch = (x: typeof TRANSLATION_ROUTING_TABLE) => x.rows.find((r: { channel?: string }) => (r.channel ?? 'batch') === 'batch')!;
    const t = clone(TRANSLATION_ROUTING_TABLE);
    firstBatch(t).engine = 'claude-opus-5-5';
    expect(() => validateTranslationTable(t, [MODEL_FLASH, MODEL_LITE])).toThrow(/run only/);
    const u = clone(TRANSLATION_ROUTING_TABLE);
    firstBatch(u).match = {};
    expect(() => validateTranslationTable(u, [MODEL_FLASH, MODEL_LITE])).toThrow(/exactly one/);
  });

  // #7075: a `channel: "cli"` row overlays the batch rows. The orchestrator holds its books; Batch callers never see it.
  const cliRow = (over: Record<string, unknown> = {}) => ({
    id: 'pali-test', channel: 'cli', match: { language_prefix: ['pali'] }, engine: 'claude-opus-5-5',
    adoption: { sample: 'test', replaces: MODEL_FLASH }, evidence: [{ issue: 1 }], ...over,
  });
  const withCli = (row: Record<string, unknown>) => { const t = clone(TRANSLATION_ROUTING_TABLE); t.rows.unshift(row); return t; };

  it('a cli row sends its books to the CLI channel, and the Batch engine underneath stays what Batch callers get', () => {
    const t = validateTranslationTable(withCli(cliRow()), [MODEL_FLASH, MODEL_LITE]);
    const lane = translateLaneForBook(t, { language: 'Pali' });
    expect([lane.channel, lane.engine, lane.reader, lane.row.id]).toEqual(['cli', 'claude-opus-5-5', 'scripts/batch/claude-translate.mjs', 'pali-test']);
    expect(translateEngineFor(t, { language: 'Pali' })).toBe(MODEL_FLASH);
    expect(tableRowFor(t, { language: 'Pali' })?.id).toBe('flash-measured');
    // Since 2026-11-06 (everything-cli-agy) every other book is cli too; the Batch engine underneath is unchanged.
    expect(translateLaneForBook(t, { language: 'Hebrew' })).toMatchObject({ channel: 'cli', row: { id: 'everything-cli-agy' } });
    expect(translateEngineFor(t, { language: 'Hebrew' })).toBe(MODEL_FLASH);
    expect(translateLaneForBook(t, { language: 'Spanish' })).toMatchObject({ channel: 'cli', row: { id: 'everything-cli-agy' } });
    expect(translateEngineFor(t, { language: 'Spanish' })).toBe(MODEL_LITE);
  });

  // Derek 2026-11-06: "no one should use lite", "everything on agy". The catch-all is the last cli row.
  it('every book translates on agy, except a Loeb (printed English facing: the agy read copied it, #7075)', () => {
    const t = TRANSLATION_ROUTING_TABLE;
    for (const language of ['Spanish', 'Dutch', 'Portuguese', 'Hebrew', 'Arabic', 'Sanskrit', 'Tibetan', 'Old French', '', 'Unknown']) {
      expect([language, translateLaneForBook(t, { language }).channel]).toEqual([language, 'cli']);
    }
    expect(translateLaneForBook(t, { language: 'Latin', image_source: { provider: 'bph' } })).toMatchObject({ channel: 'cli', row: { id: 'everything-cli-agy' } });
    expect(translateLaneForBook(t, { language: 'Hebrew', title: 'Josephus (Loeb Classical Library)' }).channel).toBe('batch');
    const last = (t.rows as { channel?: string; id: string }[]).filter((r) => r.channel === 'cli').at(-1);
    expect(last?.id).toBe('everything-cli-agy');
    // A cli row after the catch-all is unreachable, and match.any is cli-only.
    const after = clone(TRANSLATION_ROUTING_TABLE); after.rows.push(cliRow({ id: 'after-catch-all' }));
    expect(() => validateTranslationTable(after, [MODEL_FLASH, MODEL_LITE])).toThrow(/unreachable/);
    const batchAny = clone(TRANSLATION_ROUTING_TABLE); batchAny.rows.unshift({ id: 'batch-any', match: { any: true }, engine: MODEL_LITE, evidence: [{ issue: 1 }] });
    expect(() => validateTranslationTable(batchAny, [MODEL_FLASH, MODEL_LITE])).toThrow(/only on a cli row/);
    // cliBookFilter (the orchestrator's Phase 4 selector) now selects every book that is not a Loeb.
    const f = cliBookFilter(t) as { $or: Record<string, unknown>[] };
    expect(f.$or.some((c) => !('language' in c) && !('image_source.provider' in c))).toBe(true);
  });

  // #7075 (2026-10-25): Greek and Ancient Greek go to the agy reader; every other flash-measured language stays on Batch.
  it('the live table sends Greek to its own agy cli row; the rest of flash-measured reaches agy by the catch-all', () => {
    const t = TRANSLATION_ROUTING_TABLE;
    for (const language of ['Greek', 'Ancient Greek', 'Greek, Latin']) {
      expect(translateLaneForBook(t, { language })).toMatchObject({ channel: 'cli', engine: 'gemini-3.8-flash+agy-cli', row: { id: 'greek-cli-gemini38' } });
      expect(translateEngineFor(t, { language })).toBe(MODEL_FLASH);
    }
    for (const language of ['Hebrew', 'Arabic', 'Sanskrit']) expect(translateLaneForBook(t, { language })).toMatchObject({ channel: 'cli', row: { id: 'everything-cli-agy' } });
    // "Latin; Greek" is not Greek (first label); it is Latin, and Latin has its own cli row since #7263.
    expect(translateLaneForBook(t, { language: 'Latin; Greek' })).toMatchObject({ channel: 'cli', row: { id: 'latin-cli-agy4' } });
    expect(translateLaneForBook(t, { language: 'Pali' })).toMatchObject({ channel: 'cli', engine: 'claude-opus-5-5' });
  });

  // #7075 (2026-10-26): on a Loeb the facing page is printed English, and the agy read copied it (Plutarch Loeb 99 p.94).
  it('a Loeb (by title or by publisher) skips the Greek cli row and stays on the Batch row it had before', () => {
    const t = TRANSLATION_ROUTING_TABLE;
    const loeb = { language: 'Ancient Greek', title: "Plutarch's Lives, Vol. 7 (Loeb 99: Demosthenes, Cicero, Alexander, Caesar)" };
    expect(translateLaneForBook(t, loeb)).toMatchObject({ channel: 'batch', engine: MODEL_FLASH });
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Loebliche Schriften' }).channel).toBe('cli');
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Historiae (editio princeps)' }).channel).toBe('cli');
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Plato Statesman & Philebus', publisher: 'William Heinemann' }).channel).toBe('batch');
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Meditations', publisher: 'The Loeb Classical Library' }).channel).toBe('batch');
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Ilias', publisher: 'Teubner' }).channel).toBe('cli');
    const v = (row: Record<string, unknown>) => () => validateTranslationTable(withCli(row), [MODEL_FLASH, MODEL_LITE]);
    expect(v(cliRow({ unless: { title_words: [] } }))).toThrow(/title_words/);
    expect(v(cliRow({ unless: {} }))).toThrow(/title_words/);
    expect(v(cliRow({ unless: { title_word: ['loeb'] } }))).toThrow(/title_words/);
    expect(() => validateTranslationTable(withCli(cliRow({ unless: { title_words: ['loeb'] } })), [MODEL_FLASH, MODEL_LITE])).not.toThrow();
  });

  // #7263 (Derek 2026-11-02): Latin, German, Italian and French first translation go to agy Flash-low at 4 pages a call
  // (PR #7909 beat the served Flash-Lite lane in all four print cells). A cli row overlays EVERY batch row, so these
  // carry `unless: { providers: ['bph'] }`: BPH keeps its own row.
  it('the live table sends Latin, German, Italian and French to agy@4, and leaves BPH and the Batch engine alone', () => {
    const t = TRANSLATION_ROUTING_TABLE;
    for (const [language, id] of [['Latin', 'latin-cli-agy4'], ['German, Latin', 'german-cli-agy4'], ['Italian', 'italian-cli-agy4'], ['French', 'french-cli-agy4'], ['Latin-German', 'latin-cli-agy4']]) {
      expect(translateLaneForBook(t, { language })).toMatchObject({ channel: 'cli', engine: 'gemini-3.8-flash+agy-cli', row: { id, per_call: 4 } });
      expect(translateEngineFor(t, { language })).toBe(MODEL_LITE);
    }
    // BPH skips the language rows (their `unless`) and, since 2026-11-06, reaches agy by the catch-all; its Batch row
    // is still what a Batch caller would get.
    for (const language of ['Latin', 'German', 'Latin. French. English']) {
      expect(translateLaneForBook(t, { language, image_source: { provider: 'bph' } })).toMatchObject({ channel: 'cli', row: { id: 'everything-cli-agy' } });
      expect(tableRowFor(t, { language, image_source: { provider: 'bph' } })?.id).toBe('bph');
    }
    // Not the tested cells: other first labels reach agy by the catch-all; the Greek row keeps its own reader (no per_call).
    for (const language of ['Old French', 'Middle High German', 'Neo-Latin', 'Spanish']) expect(translateLaneForBook(t, { language })).toMatchObject({ channel: 'cli', row: { id: 'everything-cli-agy' } });
    expect(translateLaneForBook(t, { language: 'Greek, Latin' }).row.id).toBe('greek-cli-gemini38');
    expect(translateLaneForBook(t, { language: 'Greek' }).row.per_call).toBeUndefined();
  });

  it('unless.providers and per_call are validated', () => {
    const v = (row: Record<string, unknown>) => () => validateTranslationTable(withCli(row), [MODEL_FLASH, MODEL_LITE]);
    const agy = { engine: 'gemini-3.8-flash+agy-cli' };
    expect(v(cliRow({ unless: { providers: [] } }))).toThrow(/providers/);
    expect(v(cliRow({ unless: { providers: ['bph'] } }))).not.toThrow();
    expect(v(cliRow({ ...agy, per_call: 4 }))).not.toThrow();
    // #8399: seam_pass rides on a per_call row only, as true or 'edit-before'
    expect(v(cliRow({ ...agy, per_call: 4, seam_pass: true }))).not.toThrow();
    expect(v(cliRow({ ...agy, per_call: 4, seam_pass: 'edit-before' }))).not.toThrow();
    expect(v(cliRow({ ...agy, per_call: 4, seam_pass: 'yes' }))).toThrow(/seam_pass/);
    expect(v(cliRow({ ...agy, seam_pass: true }))).toThrow(/seam_pass/);
    expect(v(cliRow({ ...agy, per_call: 5 }))).toThrow(/per_call/);
    expect(v(cliRow({ ...agy, per_call: 2.5 }))).toThrow(/per_call/);
    expect(v(cliRow({ per_call: 4 }))).toThrow(/per_call/);   // an Opus row: claude-translate has its own --per-call
    expect(v({ id: 'b', match: { language_prefix: ['latin'] }, engine: MODEL_LITE, per_call: 4, evidence: [{ issue: 1 }] })).toThrow(/per_call/);
    const t = validateTranslationTable(withCli(cliRow({ ...agy, unless: { providers: ['bph'] } })), [MODEL_FLASH, MODEL_LITE]);
    expect(translateLaneForBook(t, { language: 'Pali', image_source: { provider: 'bph' } }).row?.id).not.toBe('pali-test');
    expect(translateLaneForBook(t, { language: 'Pali', image_source: { provider: 'mdz' } }).row.id).toBe('pali-test');
  });

  it('the lane reads a per_call row with the block reader its sample measured, and any other agy row as before', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS module, no declarations
    const { readerArgs } = await import('../../scripts/batch/cli-translate-lane.mjs');
    const t = TRANSLATION_ROUTING_TABLE;
    const a = readerArgs(translateLaneForBook(t, { language: 'Latin' }), { ids: 'i.json', dir: 'd', job: 'j' }) as string[];
    expect(path.relative(ROOT, a[0])).toBe('scripts/batch/claude-translate.mjs');
    expect(a).toEqual(expect.arrayContaining(['read', '--cli=agy', '--per-call=4', '--model=gemini-3.8-flash-low', '--job=j']));
    const g = readerArgs(translateLaneForBook(t, { language: 'Greek' }), { ids: 'i.json', dir: 'd', job: 'j' }) as string[];
    expect(path.relative(ROOT, g[0])).toBe('scripts/batch/cli-translate.mjs');
    expect(g.some((x) => x.startsWith('--per-call'))).toBe(false);
  });

  it('cliBookFilter selects exactly the books translateLaneForBook sends to a cli lane (#7263)', () => {
    // A matcher for the only shapes cliBookFilter writes: a RegExp, a string, { $nin }, { $not: RegExp }.
    type Clause = Record<string, unknown>;
    const get = (b: Record<string, unknown>, k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], b);
    const fits = (b: Record<string, unknown>, c: Clause) => Object.entries(c).every(([k, cond]) => {
      const v = get(b, k);
      if (cond instanceof RegExp) return typeof v === 'string' && cond.test(v);
      if (typeof cond === 'string') return v === cond;
      const o = cond as { $nin?: string[]; $not?: RegExp };
      if (o.$nin) return !o.$nin.includes(v as string);
      if (o.$not) return !(typeof v === 'string' && o.$not.test(v));
      throw new Error(`unexpected condition on ${k}`);
    });
    const t = TRANSLATION_ROUTING_TABLE;
    const f = cliBookFilter(t) as { $or: Clause[] };
    const books: Record<string, unknown>[] = [];
    for (const language of ['Latin', 'latin', 'Latin; Greek', 'Neo-Latin', 'German', 'Middle High German', 'French', 'Italian', 'Greek', 'Ancient Greek', 'Greek, Latin', 'Pali', 'Hebrew', 'Tibetan', 'English', 'Spanish', '']) {
      for (const image_source of [undefined, { provider: 'bph' }, { provider: 'mdz' }]) {
        for (const extra of [{}, { title: 'Plutarch Loeb' }, { publisher: 'William Heinemann' }]) books.push({ language, ...(image_source ? { image_source } : {}), ...extra });
      }
    }
    for (const b of books) {
      expect([b, f.$or.some((c) => fits(b, c))]).toEqual([b, translateLaneForBook(t, b).channel === 'cli']);
    }
    expect(cliBookFilter({ default: t.default, rows: t.rows.filter((r: { channel?: string }) => r.channel !== 'cli') })).toBeNull();
  });

  it('under the translate brake, Phase 4 holds books for their CLI lane and dispatches nothing to an API lane (#7263)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
    expect(src).toMatch(/const cliOnly = translateGate\.paused && CLI_TRANSLATE_BOOK_FILTER != null;/);
    const hold = src.indexOf('const held = await routeBookToCliTranslateLane(');
    const stop = src.indexOf('if (cliOnly) {', hold);
    expect(hold).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(hold);
    expect(stop).toBeLessThan(src.indexOf("if (phase4Lane(book) === 'chained')", hold));
    // A book it cannot act on stays put, so the cap is on holds, not on books selected (else the refused ones starve the rest).
    expect(src).toMatch(/if \(cliOnly && cliHolds >= TRANSLATE_SUBMIT_LIMIT\) break;/);
    expect(src).toMatch(/if \(\(cliOnly \|\| freshBooks\.length === 0\) && gapLimit > 0\)/);
  });

  it('the CLI translation lane asks the OCR-first gate before a book takes budget, and refunds a refused read (#7263)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/batch/cli-translate-lane.mjs'), 'utf8');
    const loop = src.slice(src.indexOf('let budget = MAX;'));
    const gate = loop.indexOf('await gateBeforeRead(db, take,');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(loop.indexOf('budget -= take.length;'));
    expect(loop).toMatch(/if \(read === 2\) budget \+= take\.length;/);
  });

  it('the correction lane keeps the books the CLI translation lane waits on (its OCR-first gate) in its frame', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/batch/cli-ocr-lane.mjs'), 'utf8');
    expect(src).toMatch(/\{ 'pipeline_auto\.status': HOLD_STATUS, 'pipeline_auto\.hold\.reason': CLI_TRANSLATE_HOLD\.reason \}/);
  });

  it('a cli row must name a CLI reader and carry its blind sample; a batch row may not name one', () => {
    const v = (row: Record<string, unknown>) => () => validateTranslationTable(withCli(row), [MODEL_FLASH, MODEL_LITE]);
    expect(v(cliRow({ engine: MODEL_FLASH }))).toThrow(/a cli lane runs only/);
    expect(v(cliRow({ adoption: undefined }))).toThrow(/adoption\.sample/);
    expect(v(cliRow({ channel: 'api' }))).toThrow(/"batch" or "cli"/);
    expect(v(cliRow({ channel: undefined }))).toThrow(/run only/);
  });

  it('every CLI reader the table may name exists, and the live table\'s cli rows are well-formed', () => {
    for (const [engine, l] of Object.entries(CLI_TRANSLATE_LANES as Record<string, { reader: string }>)) {
      expect([engine, fs.existsSync(path.join(ROOT, l.reader))]).toEqual([engine, true]);
    }
    for (const row of (TRANSLATION_ROUTING_TABLE.rows as { id: string; channel?: string; adoption?: { sample?: string } }[]).filter((r) => r.channel === 'cli')) {
      expect([row.id, !!row.adoption?.sample]).toEqual([row.id, true]);
    }
  });

  it('the orchestrator asks for the channel before either API lane in Phase 4, and holds a cli book', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
    const ask = src.indexOf('const translateLane = translateLaneForBook(book);');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(src.indexOf("if (phase4Lane(book) === 'chained') {"));
    expect(ask).toBeLessThan(src.indexOf("type: 'translation',"));
    expect(src).toMatch(/holdBook\(db, book\.id, \{\s*\.\.\.CLI_TRANSLATE_HOLD/);
    // A row's `unless` reads the title and publisher: both Phase 4 selections, and their --book overrides, must project them.
    expect(src.match(/\$project: \{ id: 1, title: 1, [^}]*'image_source\.provider': 1, publisher: 1 \}/g)?.length).toBe(2);
    expect(src.match(/applyBookOverride\(db, (fresh|partial)Books, \{ id: 1, title: 1, publisher: 1,/g)?.length).toBe(2);
  });

  it('a prefix is a whole word at the start of the label', () => {
    const re = prefixRegex(['classical chinese', 'greek']);
    expect(re.test(' Classical   Chinese')).toBe(true);
    expect(re.test('Greek-Latin')).toBe(true);
    expect(re.test('Greekish')).toBe(false);
    expect(re.test('Latin, Greek')).toBe(false);
  });
});
