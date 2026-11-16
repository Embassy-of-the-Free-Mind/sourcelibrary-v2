/**
 * #8632: a re-read that calls the leaf blank must not replace a stored transcription that still has a body. On
 * 2026-11-12 the re-read lane wrote "blank, show-through only" over a printed two-column index (p. 20 of
 * 69dbc8e91040d1d5e209d605, 1,591 characters; reverted), and 6 of 24 sampled blank writes over text had erased a real
 * page. The 40% shared-word floor missed them because their stored text has under 40 distinct long words.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { blankReadOverText } from '../../scripts/lib/blank-page-guard.mjs';

const INDEX_PAGE =
  '<scan-quality>good</scan-quality>\n<language>Latin</language>\n<script>printed</script>\n<page-type>index</page-type>\n<columns>2</columns>\n\n' +
  'Cite huius mala verbis lucide rep[resentare]. **Bias.**\nVitam suā emendat sapiens ex alteri⁹ vite consideratione. **Tullius Terentius.**\n' +
  'Vita presens vie vel viatori comparatur. **Varro**\nVivere male miserabilius est q̃ mori. **Tullius.**\nVivēdi 7 addiscendi finis vnus. **Socrates.**\n' +
  'Vivere bene omnes homines optāt **Apulegius**\nVivere cum letitia animi docemur. **Xistus.**\nVivere 7 recte vivere distinguūtur. **Tullius.**\n' +
  'Vivere vt velis libertas est. **Tulli⁹.**\nVivere iuste quomodo prelatis cōtingat. **Thales.**\nVoluptas pestis in homine pessima';
// The read the lane wrote over it, verbatim.
const BLANK_READ =
  '<scan-quality>good</scan-quality>\n<language>Latin</language>\n<script>printed</script>\n<page-type>blank</page-type>\n<warning>show-through from the other side only</warning>';

describe('blankReadOverText (#8632)', () => {
  it('refuses the recorded case: a blank read over a printed index page', () => {
    expect(blankReadOverText(INDEX_PAGE, BLANK_READ)).toMatch(/^a blank read over a stored transcription of \d+ characters: check by eye$/);
  });
  it('lets a blank read through over a stored text with almost no body (a stray mark, a shelfmark)', () => {
    expect(blankReadOverText('<page-type>text</page-type>\nfol. 12 ex libris', BLANK_READ)).toBeNull();
  });
  it('does not judge a read that is not typed blank, or a "blank" read that transcribes a body', () => {
    expect(blankReadOverText(INDEX_PAGE, INDEX_PAGE)).toBeNull();
    expect(blankReadOverText(INDEX_PAGE, BLANK_READ + '\n' + INDEX_PAGE.split('\n\n')[1])).toBeNull();
  });
  it('cli-ocr apply checks it on the over-stored-text path, before the shared-word floor', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
    const block = src.slice(src.indexOf('} else if (page.ocr?.data && !LANE_GATE) {'));
    const at = block.indexOf('blankReadOverText(page.ocr.data, text)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(block.indexOf('const was = longWords(page.ocr.data)'));
  });
});
