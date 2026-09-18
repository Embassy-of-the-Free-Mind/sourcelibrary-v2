import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module
import {
  LANE, ENGINES, routeBook, classifyScript, pagePolicy, envelope, letterCount, ocrSetFields,
  reenrolDecision, scriptTagCounts, editionYear, STALE_OCR_FIELDS,
} from '../../scripts/lib/syriac-kraken-lane.mjs';

const SYR = 'ܘܰܐܝܟܰܢܳܐ ܟܰܕ ܕܰܢܚܶܠ ܢܶܫܶܐ ܚܰܝ̈ܶܐ ܐܶܡܰܪܠܶܗ ܕܶܝܢ ܕܰܪ̈ܗܶܣܘܳܣ ܩܰܠܺܝܠ ܝܰܬܺܝܪ ܡܶܢܳܟܝ ܟܰܗܢܳܐ ܐܰܢ̱ܬ';
const LAT = 'Demonstratio prima de fide. Audi, fili, quae tibi dicturus sum de fide et de spe et de caritate';

describe('syriac-kraken-lane: routing per book (#4883)', () => {
  it('manuscript libraries route to Sophro; the Archive routes to omnisyr', () => {
    expect(routeBook({ id: 'a', image_source: { provider: 'vatican' }, published: '1890' })).toMatchObject({ route: 'manuscript', engine: 'sophro-mhiro' });
    expect(routeBook({ id: 'b', image_source: { provider: 'internet_archive' }, published: '1890' })).toMatchObject({ route: 'print', engine: 'omnisyr' });
  });
  it('a pre-1500 imprint is a manuscript whatever the provider', () => {
    expect(routeBook({ id: 'c', image_source: { provider: 'internet_archive' }, published: 'c. 1200' }).route).toBe('manuscript');
  });
  it("the model's own <script> tags can turn an Archive scan into a manuscript, but only with a real majority", () => {
    expect(routeBook({ id: 'd', image_source: { provider: 'internet_archive' } }, { handwritten: 40, printed: 3 }).route).toBe('manuscript');
    expect(routeBook({ id: 'e', image_source: { provider: 'internet_archive' } }, { handwritten: 3, printed: 1 }).route).toBe('print');
    expect(routeBook({ id: 'f', image_source: { provider: 'internet_archive' } }, { handwritten: 119, printed: 547 }).route).toBe('print');
  });
  it('an override wins', () => {
    expect(routeBook({ id: 'g', image_source: { provider: 'vatican' } }, {}, { g: 'print' })).toMatchObject({ route: 'print', why: 'override' });
  });
  it('editionYear reads free text and refuses nonsense', () => {
    expect(editionYear('1890')).toBe(1890);
    expect(editionYear('c. 700 (Vat. sir. 12)')).toBe(700);
    expect(editionYear('Medieval')).toBeNull();
  });
  it('scriptTagCounts counts the tag values', () => {
    expect(scriptTagCounts(['<script>printed</script> x', '<script> Handwritten </script>', 'no tag'])).toEqual({ printed: 1, handwritten: 1, none: 1 });
  });
});

describe('syriac-kraken-lane: policy per page', () => {
  it('classifies by code-point share, tags stripped', () => {
    expect(classifyScript(`<language>Syriac</language>\n${SYR} ${SYR}`).klass).toBe('syriac');
    expect(classifyScript(LAT).klass).toBe('other');
    expect(classifyScript(`${SYR} ${LAT}`).klass).toBe('mixed');
    expect(classifyScript('ܐܒܓ').klass).toBe('short');
  });
  it('a loop always goes, whatever script it is nominally in', () => {
    expect(pagePolicy({ ocr: { data: LAT } }, { loopRefused: true })).toEqual({ action: 'reocr', why: 'loop' });
  });
  it('a Syriac reading is re-transcribed; Latin, Hebrew and mixed pages keep their text', () => {
    expect(pagePolicy({ ocr: { data: `${SYR} ${SYR}` } })).toEqual({ action: 'reocr', why: 'syriac' });
    expect(pagePolicy({ ocr: { data: LAT } })).toEqual({ action: 'keep', why: 'other_script' });
    expect(pagePolicy({ ocr: { data: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ והארץ היתה תהו ובהו' } })).toEqual({ action: 'keep', why: 'other_script' });
    expect(pagePolicy({ ocr: { data: `${SYR} ${LAT}` } })).toEqual({ action: 'keep', why: 'mixed_script' });
  });
  it('an empty page is a first write; a human-edited page is never touched, even a loop', () => {
    expect(pagePolicy({ ocr: null })).toEqual({ action: 'reocr', why: 'first_write' });
    expect(pagePolicy({ ocr: { data: SYR, edited_by: 'someone' } }, { loopRefused: true })).toEqual({ action: 'keep', why: 'human_edited' });
    expect(pagePolicy({ ocr: { data: SYR, source: 'manual' } })).toEqual({ action: 'keep', why: 'human_edited' });
  });
});

describe('syriac-kraken-lane: what is written', () => {
  it('the envelope carries the language tag the corpus trusts, the script, and NO page-type claim', () => {
    const e = envelope('ܐ ܒ  \n\nܓ\n\n', 'manuscript');
    expect(e).toBe('<language>Syriac</language>\n<script>handwritten</script>\n\nܐ ܒ\n\nܓ');
    expect(envelope('x', 'print')).toContain('<script>printed</script>');
    expect(e).not.toContain('page-type');
  });
  it('letterCount ignores tags and whitespace', () => {
    expect(letterCount('<language>Syriac</language>\n ܐܒ ܓ')).toBe(3);
  });
  it('provenance names the engine, the model DOI and the lane, and nothing Gemini-shaped survives', () => {
    const set = ocrSetFields('<language>Syriac</language>\n\nܐ', 'sophro-mhiro', 'manuscript', { run: 'r1', now: new Date('2026-09-18T00:00:00Z') });
    expect(set['ocr.model']).toBe('kraken/sophro-mhiro');
    expect(set['ocr.source']).toBe('kraken');
    expect(set['ocr.pipeline']).toBe(LANE);
    expect(set['ocr.engine']).toMatchObject({ name: 'kraken', model_doi: '10.5281/zenodo.17406773', direction: 'horizontal-rl', base_dir: 'R', route: 'manuscript', run: 'r1' });
    for (const k of ['ocr.prompt_version', 'ocr.batch_job_id', 'ocr.input_tokens', 'ocr.unreadable', 'ocr.ia']) expect(STALE_OCR_FIELDS).toContain(k);
    expect(() => ocrSetFields('x', 'nope', 'print')).toThrow();
  });
  it('every engine with a route has a DOI and a licence — the (i) panel shows them', () => {
    for (const e of Object.values(ENGINES) as any[]) {
      expect(e.model_doi).toMatch(/^10\.5281\/zenodo\.\d+$/);
      expect(e.licence).toBeTruthy();
    }
    expect((ENGINES as any)['omnisyr'].route).toBe('print');
    expect((ENGINES as any)['sophro-mhiro'].route).toBe('manuscript');
  });
});

describe('syriac-kraken-lane: re-enrolment for translation', () => {
  const counts = { total: 10, with_ocr: 10, with_translation: 4 };
  it('a fully-read, unheld book goes back to ocr_complete from a terminal status', () => {
    expect(reenrolDecision({ pipeline_auto: { status: 'complete' } }, counts)).toMatchObject({ ok: true });
    expect(reenrolDecision({ pipeline_auto: { status: 'loop_quarantine_hold' } }, counts)).toMatchObject({ ok: true });
  });
  it('a held book, a takedown, or a book with unread pages does not', () => {
    expect(reenrolDecision({ pipeline_auto: { status: 'complete', hold: { reason: 'x' } } }, counts)).toMatchObject({ ok: false, why: 'held' });
    expect(reenrolDecision({ hidden_reason: 'copyright', pipeline_auto: { status: 'complete' } }, counts).ok).toBe(false);
    expect(reenrolDecision({ hidden_reason: 'unprocessed', pipeline_auto: { status: 'archive_complete' } }, counts).ok).toBe(true);
    expect(reenrolDecision({ pipeline_auto: { status: 'complete' } }, { total: 10, with_ocr: 9 }).ok).toBe(false);
    expect(reenrolDecision({ pipeline_auto: { status: 'ocr_submitted' } }, counts).ok).toBe(false);
  });
});
