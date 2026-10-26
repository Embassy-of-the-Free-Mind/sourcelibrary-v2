/**
 * #7170: the OCR and translation routers READ their tables. This pins three things:
 *   - the router follows the table (an edited table routes differently, with no code change);
 *   - a malformed table fails loudly (at import, and so in this test), never routing to lite by accident;
 *   - an absent route falls back to the pinned constants (OCR) or the default row (translation).
 * What each route SHOULD be is the table's business and its evidence's; tests/unit/ocr-routing-table.test.ts and
 * translate-core-parity.test.ts hold the rows to the evidence and the two routers to each other.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OCR_ROUTING_TABLE, OCR_MODEL_FLASH, OCR_MODEL_LITE, FLASH_OCR_FROM, FLASH_OCR_INCLUDES_HIDDEN,
  FLASH_OCR_FROM_FALLBACK, flashFamiliesFromTable, isFlashOcrBook, getOcrModelForBook, ocrRefusalFallback,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-routing.mjs';
import {
  TRANSLATION_ROUTING_TABLE, getTranslateModelForBook, MODEL_FLASH, MODEL_LITE, isFlashMeasuredLanguage,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';
import { translateEngineFor, validateTranslationTable, prefixRegex, translateLaneForBook, tableRowFor, CLI_TRANSLATE_LANES } from '../../scripts/lib/translation-routing.mjs';
import { getTranslateModelForBook as getTranslateModelForBookTs } from '../../src/lib/types/ai-models';

type Route = { engine: string; default?: boolean; families?: Record<string, { from: string; hidden?: boolean }> };
type Row = { id: string; route?: Route };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const LANGUAGE_OF: Record<string, string> = { grc: 'Greek', fas: 'Persian', san: 'Sanskrit', pli: 'Pali', ara: 'Arabic', gez: "Ge'ez", zho: 'Chinese' };
const OLD = new Date('2020-01-01');
const ROOT = path.resolve(__dirname, '../..');

describe('OCR: getOcrModelForBook reads the `route` fields of ocr-routing-table.json', () => {
  const routed = (OCR_ROUTING_TABLE.rows as Row[]).filter((r) => r.route?.families);

  it('every family the table routes is what the router exports, with its date and hidden flag', () => {
    expect(routed.length).toBeGreaterThanOrEqual(3);
    const fams = routed.flatMap((r) => Object.entries(r.route!.families!));
    expect(Object.keys(FLASH_OCR_FROM).sort()).toEqual(fams.map(([f]) => f).sort());
    for (const [f, spec] of fams) {
      expect([f, (FLASH_OCR_FROM[f] as Date).toISOString().slice(0, 10)]).toEqual([f, spec.from]);
      expect([f, FLASH_OCR_INCLUDES_HIDDEN.has(f)]).toEqual([f, spec.hidden === true]);
    }
  });

  it('a visible book in each routed family reads on flash; an old hidden one only where the table says hidden', () => {
    for (const f of Object.keys(FLASH_OCR_FROM)) {
      const language = LANGUAGE_OF[f];
      expect([f, !!language]).toEqual([f, true]);
      expect([f, getOcrModelForBook({ language, visible: true, created_at: OLD }, { liteOnly: true })]).toEqual([f, OCR_MODEL_FLASH]);
      expect([f, isFlashOcrBook({ language, visible: false, created_at: OLD })]).toEqual([f, FLASH_OCR_INCLUDES_HIDDEN.has(f)]);
    }
    expect(getOcrModelForBook({ language: 'Latin', visible: true, created_at: OLD }, { liteOnly: true })).toBe(OCR_MODEL_LITE);
  });

  it('an edited table routes differently with no code change', () => {
    const t = clone(OCR_ROUTING_TABLE);
    const greek = t.rows.find((r: Row) => r.id === 'greek-print');
    greek.route.families.heb = { from: '2026-11-01', hidden: true };
    delete greek.route.families.grc;
    const got = flashFamiliesFromTable(t);
    expect(got.from.heb.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(got.hidden.has('heb')).toBe(true);
    expect(got.from.grc).toBeUndefined();
  });

  it('with no family route anywhere it keeps the pinned fallback', () => {
    const t = clone(OCR_ROUTING_TABLE);
    for (const r of t.rows) delete r.route;
    expect(flashFamiliesFromTable(t).from).toBe(FLASH_OCR_FROM_FALLBACK);
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

  it('a malformed route throws instead of routing', () => {
    const bad = (edit: (rows: Row[]) => void) => { const t = clone(OCR_ROUTING_TABLE); edit(t.rows); return () => flashFamiliesFromTable(t); };
    expect(bad((rows) => { rows.find((r) => r.id === 'greek-print')!.route!.engine = 'claude-opus-5-5'; })).toThrow(/can only route/);
    expect(bad((rows) => { rows.find((r) => r.id === 'greek-print')!.route!.families!.grc.from = '2 Oct'; })).toThrow(/bad date/);
    expect(bad((rows) => { rows.find((r) => r.id === 'chinese-print')!.route!.families!.grc = { from: '2026-10-02' }; })).toThrow(/two rows/);
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
    expect(translateLaneForBook(t, { language: 'Hebrew' })).toMatchObject({ channel: 'batch', engine: MODEL_FLASH });
    expect(translateLaneForBook(t, { language: 'Latin' })).toMatchObject({ channel: 'batch', engine: MODEL_LITE, row: null });
  });

  // #7075 (2026-10-25): Greek and Ancient Greek go to the agy reader; every other flash-measured language stays on Batch.
  it('the live table sends Greek to the agy cli lane and leaves the rest of flash-measured on Batch', () => {
    const t = TRANSLATION_ROUTING_TABLE;
    for (const language of ['Greek', 'Ancient Greek', 'Greek, Latin']) {
      expect(translateLaneForBook(t, { language })).toMatchObject({ channel: 'cli', engine: 'gemini-3.8-flash+agy-cli' });
      expect(translateEngineFor(t, { language })).toBe(MODEL_FLASH);
    }
    for (const language of ['Hebrew', 'Arabic', 'Sanskrit', 'Latin; Greek']) expect(translateLaneForBook(t, { language }).channel).toBe('batch');
    expect(translateLaneForBook(t, { language: 'Pali' })).toMatchObject({ channel: 'cli', engine: 'claude-opus-5-5' });
  });

  // #7075 (2026-10-26): on a Loeb the facing page is printed English, and the agy read copied it (Plutarch Loeb 99 p.94).
  it('a Loeb skips the Greek cli row and stays on the Batch row it had before', () => {
    const t = TRANSLATION_ROUTING_TABLE;
    const loeb = { language: 'Ancient Greek', title: "Plutarch's Lives, Vol. 7 (Loeb 99: Demosthenes, Cicero, Alexander, Caesar)" };
    expect(translateLaneForBook(t, loeb)).toMatchObject({ channel: 'batch', engine: MODEL_FLASH });
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Loebliche Schriften' }).channel).toBe('cli');
    expect(translateLaneForBook(t, { language: 'Greek', title: 'Historiae (editio princeps)' }).channel).toBe('cli');
    const v = (row: Record<string, unknown>) => () => validateTranslationTable(withCli(row), [MODEL_FLASH, MODEL_LITE]);
    expect(v(cliRow({ unless: { title_words: [] } }))).toThrow(/title_words/);
    expect(v(cliRow({ unless: {} }))).toThrow(/title_words/);
    expect(() => validateTranslationTable(withCli(cliRow({ unless: { title_words: ['loeb'] } })), [MODEL_FLASH, MODEL_LITE])).not.toThrow();
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
  });

  it('a prefix is a whole word at the start of the label', () => {
    const re = prefixRegex(['classical chinese', 'greek']);
    expect(re.test(' Classical   Chinese')).toBe(true);
    expect(re.test('Greek-Latin')).toBe(true);
    expect(re.test('Greekish')).toBe(false);
    expect(re.test('Latin, Greek')).toBe(false);
  });
});
