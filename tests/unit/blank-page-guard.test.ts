import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import {
  shouldRefuseOcrWrite,
  transcriptionBody,
  inkCoverage,
} from '../../scripts/lib/blank-page-guard.mjs';

/**
 * This guard sits on the OCR write path, so its failure modes matter more than
 * its success mode. The property under test is: it may veto ONLY on positive
 * evidence of a blank page, and must let the write through on every kind of
 * doubt. A guard that failed closed on a network blip would silently stop
 * transcribing real books.
 */

const FABRICATION =
  '<language>Latin</language> <script>printed</script> <page-type>text</page-type> ' +
  '<header>DISCURSUS IV.</header> <sig>B</sig> ' +
  "<image-desc size=\"small\">Decorative initial letter 'Q'</image-desc> " +
  'Quod autem in hoc negotio, de quo agimus, non solum iuris sed etiam facti difficultas occurrat, ' +
  'nemo est qui ambigat. Nam etsi iuris ratio in promptu sit, tamen facti veritas, quae ex ' +
  'circumstantiis pendet, saepissime in dubium vocatur, ut et in praesenti casu apparet, ubi de ' +
  'testamenti validitate quaeritur inter partes litigantes coram iudice competenti.';

/** A correct response for a blank leaf: description only, no transcription. */
const HONEST_BLANK =
  '<language>None</language> <page-type>blank</page-type> ' +
  '<image-desc>The page is blank apart from foxing and light bleed-through from the reverse. ' +
  'No text is present anywhere on the leaf, and the paper shows age-related discolouration ' +
  'across the whole surface with a small stain near the gutter edge of the page.</image-desc>';

async function png(shade: number, w = 200, h = 300) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .png().toBuffer();
}

/** A white page with black bars on it — unambiguous ink. */
async function inkedPng() {
  const base = await png(250);
  const bar = await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .png().toBuffer();
  return sharp(base).composite([{ input: bar, top: 60, left: 20 }]).png().toBuffer();
}

const okFetch = (buf: Buffer) => async () => ({ ok: true, arrayBuffer: async () => buf });

let saved: string | undefined;
beforeEach(() => { saved = process.env.BLANK_PAGE_GUARD; delete process.env.BLANK_PAGE_GUARD; });
afterEach(() => { if (saved === undefined) delete process.env.BLANK_PAGE_GUARD; else process.env.BLANK_PAGE_GUARD = saved; });

describe('transcriptionBody', () => {
  it('drops metadata so a page description is not read as a text claim', () => {
    expect(transcriptionBody(HONEST_BLANK).length).toBeLessThan(20);
  });

  it('keeps the asserted transcription', () => {
    const body = transcriptionBody(FABRICATION);
    expect(body).toContain('Quod autem in hoc negotio');
    expect(body).not.toContain('DISCURSUS IV.');
    expect(body).not.toContain('Decorative initial');
  });
});

describe('inkCoverage', () => {
  it('reads a uniform pale page as blank', async () => {
    expect(await inkCoverage(await png(252))).toBeLessThanOrEqual(0.004);
  });

  it('reads a yellowed page as blank too — ground is relative, not absolute', async () => {
    expect(await inkCoverage(await png(190))).toBeLessThanOrEqual(0.004);
  });

  it('reads a page with black bars as inked', async () => {
    expect(await inkCoverage(await inkedPng())).toBeGreaterThan(0.004);
  });
});

describe('shouldRefuseOcrWrite — the veto', () => {
  it('refuses a long transcription claim over a blank image', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, imageUrl: 'x', minBody: 100, fetchImpl: okFetch(await png(252)) as never,
    });
    expect(v.refuse).toBe(true);
    expect(v.reason).toBe('blank_page_with_text_claim');
  });

  it('allows the same claim when the page actually has ink', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, imageUrl: 'x', minBody: 100, fetchImpl: okFetch(await inkedPng()) as never,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('has_ink');
  });

  it('allows an honest blank-page description over a blank image', async () => {
    // The correct response for an empty leaf must never be refused.
    const v = await shouldRefuseOcrWrite({
      text: HONEST_BLANK, imageUrl: 'x', fetchImpl: okFetch(await png(252)) as never,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('no_substantial_claim');
  });
});

describe('shouldRefuseOcrWrite — the imageBuffer path', () => {
  // The orchestrator's preview path already holds the base64 it posted to
  // Gemini, so the guard is free there. These pin that it behaves identically
  // to the fetch path and never falls back to a network call.
  const explode = (async () => { throw new Error('must not fetch when bytes are supplied'); }) as never;

  it('refuses a claim over blank bytes, without fetching', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, minBody: 100,
      imageBuffer: (await png(252)).toString('base64'), fetchImpl: explode,
    });
    expect(v.refuse).toBe(true);
  });

  it('allows a claim over inked bytes, without fetching', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, minBody: 100,
      imageBuffer: await inkedPng(), fetchImpl: explode,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('has_ink');
  });

  it('fails open on empty or unusable bytes', async () => {
    expect((await shouldRefuseOcrWrite({ text: FABRICATION, minBody: 100, imageBuffer: '' , imageUrl: '' })).refuse).toBe(false);
    const v = await shouldRefuseOcrWrite({ text: FABRICATION, minBody: 100, imageBuffer: Buffer.from('nope'), fetchImpl: explode });
    expect(v.refuse).toBe(false);
    expect(v.reason).toMatch(/^decode_failed/);
  });
});

describe('shouldRefuseOcrWrite — fails OPEN on every doubt', () => {
  it('allows when the image cannot be fetched', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, imageUrl: 'x', minBody: 100,
      fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as never,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toMatch(/^fetch_failed/);
  });

  it('allows on a non-200', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, imageUrl: 'x', minBody: 100,
      fetchImpl: (async () => ({ ok: false, status: 503 })) as never,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('fetch_503');
  });

  it('allows when the bytes are not a decodable image', async () => {
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, imageUrl: 'x', minBody: 100,
      fetchImpl: okFetch(Buffer.from('not an image')) as never,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toMatch(/^decode_failed/);
  });

  it('allows when there is no image URL at all', async () => {
    const v = await shouldRefuseOcrWrite({ text: FABRICATION, imageUrl: '', minBody: 100 });
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('no_image_url');
  });

  it('allows everything when the kill switch is off', async () => {
    process.env.BLANK_PAGE_GUARD = 'off';
    const v = await shouldRefuseOcrWrite({
      text: FABRICATION, imageUrl: 'x', minBody: 100, fetchImpl: okFetch(await png(252)) as never,
    });
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('guard_disabled');
  });
});
