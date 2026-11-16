/**
 * The Sanskrit profile of the GPU print lane (v3 #95): Surya 2 first reads of printed Devanagari.
 * Pure parts only: the frame, the script check (page and book), the guards, the ledger rows of a refused book, the ocr field.
 */
import { describe, it, expect } from 'vitest';
import {
  SA_PROFILE, SA_HOLD, SA_LANE, SA_ROUTE, SURYA, MIN_DEVANAGARI_SHARE, BOOK_GATE_MIN_PAGES,
  isSanskritBook, scriptProfile, devanagariVerdict, indexColumns, suryaPageVerdict, bookScriptGate, refusedBookRows,
  saBookSkip, saFrameQuery, saOcrField, cleanRead,
} from '../../scripts/lib/surya-print-lane.mjs';
import { LANGS, pageVerdict } from '../../scripts/lib/gpu-print-lane.mjs';
import { contentHash, missingProvenance } from '../../scripts/lib/write-provenance.mjs';

// Bhagavadgītā 2.47–48 and 1.1, as a printed page gives them
const DEVA = 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥ ४७ ॥\nयोगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय ।\nसिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते ॥ ४८ ॥';
const BENGALI = 'ধর্মক্ষেত্রে কুরুক্ষেত্রে সমবেতা যুযুৎসবঃ ।\nমামকাঃ পাণ্ডবাশ্চৈব কিমকুর্বত সঞ্জয় ॥ ১ ॥\nদৃষ্ট্বা তু পাণ্ডবানীকং ব্যূঢ়ং দুর্যোধনস্তদা ।';
const ROMAN = 'dharmakṣetre kurukṣetre samavetā yuyutsavaḥ\nmāmakāḥ pāṇḍavāś caiva kim akurvata sañjaya\ndṛṣṭvā tu pāṇḍavānīkaṃ vyūḍhaṃ duryodhanas tadā';
const ENGLISH = 'The present edition of the text is based upon three manuscripts lent to the editor by the Asiatic Society of Bengal, and upon the Bombay edition of 1887.';

describe('surya-print-lane: the frame (v3 #95)', () => {
  it('reads only Sanskrit books under the campaign hold, hidden ones included', () => {
    const q = saFrameQuery();
    expect(q['pipeline_auto.hold.reason']).toBe(SA_HOLD);
    expect(q).not.toHaveProperty('visible');
    expect(isSanskritBook('Sanskrit')).toBe(true);
    expect(isSanskritBook('Bengali')).toBe(false);
  });
  it('is held-only: its one hold, no hold placed or released', () => {
    expect(SA_PROFILE.heldOnly).toBe(true);
    expect([...SA_PROFILE.holds]).toEqual(['sanskrit-print-surya-lane']);
    expect(SA_PROFILE.minYear).toBeNull();
  });
  it('a manuscript by the catalogue is a recorded plan skip, a printed book is not', () => {
    expect(saBookSkip({ language: 'Sanskrit' })).toBeNull();
    expect(saBookSkip({ language: 'Sanskrit' }, { manuscript: 'manuscript by title' })).toMatch(/not print by the catalogue: manuscript by title/);
    expect(saBookSkip({ language: 'Hindi' })).toBe('not Sanskrit');
  });
  it('leaves the LightOnOCR profiles alone: sa is not one of them', () => {
    expect(Object.keys(LANGS)).not.toContain('sa');
    // the English lane still turns a Devanagari page away
    expect(pageVerdict(`${ENGLISH}\n${DEVA}`)).toMatchObject({ verdict: 'reject', reason: 'other_script' });
  });
});

describe('surya-print-lane: the script check', () => {
  it('counts letters by script; accents, vowel signs, digits and dandas do not count', () => {
    const p = scriptProfile(DEVA);
    expect(p.script).toBe('Devanagari');
    expect(p.devanagari_share).toBe(1);
    expect(scriptProfile('॥ ४७ ॥ 123').letters).toBe(0);
    expect(scriptProfile(BENGALI).script).toBe('Bengali');
    expect(scriptProfile(ROMAN).script).toBe('Latin');
  });
  it('a Devanagari page passes; Bengali script, Roman transliteration and an English page do not', () => {
    expect(devanagariVerdict(DEVA).ok).toBe(true);
    expect(devanagariVerdict(BENGALI)).toMatchObject({ ok: false, script: 'Bengali' });
    expect(devanagariVerdict(ROMAN)).toMatchObject({ ok: false, script: 'Latin' });
    expect(devanagariVerdict(ENGLISH).ok).toBe(false);
    expect(devanagariVerdict('').ok).toBe(false);
  });
  it('a Devanagari page with a short English footnote passes; a page that is mostly English does not', () => {
    const footnote = devanagariVerdict(`${DEVA}\n${DEVA}\n1 Read thus in MS. B.`);
    expect(footnote.ok).toBe(true);
    expect(footnote.share).toBeGreaterThanOrEqual(MIN_DEVANAGARI_SHARE);
    expect(devanagariVerdict(`${ENGLISH}\n${ENGLISH}\n${DEVA.split('\n')[0]}`).ok).toBe(false);
  });
});

describe('surya-print-lane: the page verdict', () => {
  it('writes a printed Devanagari page', () => {
    const v = suryaPageVerdict({ text: DEVA, labels: { Text: 4 } });
    expect(v).toMatchObject({ verdict: 'write', reason: 'ok' });
    expect(v.body).toBe(DEVA);
    expect(v.detail.devanagari_share).toBe(1);
  });
  it('does not write another script, and names it', () => {
    expect(suryaPageVerdict({ text: BENGALI })).toMatchObject({ verdict: 'reject', reason: 'not_devanagari', detail: { script: 'Bengali' } });
    expect(suryaPageVerdict({ text: ROMAN })).toMatchObject({ verdict: 'reject', reason: 'not_devanagari', detail: { script: 'Latin' } });
    expect(suryaPageVerdict({ text: ENGLISH })).toMatchObject({ verdict: 'reject', reason: 'not_devanagari' });
  });
  it('a blank leaf or a bare page number is textless, not written', () => {
    expect(suryaPageVerdict({ text: '' })).toMatchObject({ verdict: 'textless' });
    expect(suryaPageVerdict({ text: '॥ १२ ॥' })).toMatchObject({ verdict: 'textless', reason: 'under_min_word_chars' });
  });
  it('an empty read whose blocks errored is a reject, not a blank leaf', () => {
    expect(suryaPageVerdict({ text: '', block_errors: 2 })).toMatchObject({ verdict: 'reject', reason: 'engine_block_error' });
  });
  it('refuses a loop: the same line again and again', () => {
    const line = DEVA.split('\n')[0];
    const v = suryaPageVerdict({ text: `${DEVA}\n${Array(8).fill(line).join('\n')}` });
    expect(v.verdict).toBe('reject');
    expect(v.reason).toMatch(/^loop_guard:/);
  });
  it('refuses a page where the engine describes the image, and cuts a trailing note', () => {
    expect(suryaPageVerdict({ text: `The image shows a page of Sanskrit verse.\n${DEVA}` })).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
    const cut = suryaPageVerdict({ text: `${DEVA}\nNote: The page number is preserved as it appears.` });
    expect(cut).toMatchObject({ verdict: 'write', reason: 'ok_notes_stripped' });
    expect(cut.body).toBe(DEVA);
  });
  it('refuses a page the engine itself labels handwriting', () => {
    expect(suryaPageVerdict({ text: DEVA, labels: { Text: 2, Handwriting: 3 } })).toMatchObject({ verdict: 'reject', reason: 'handwriting_label', detail: { label: 'Handwriting', blocks: 3 } });
  });
  it('every read gets exactly one outcome with a reason', () => {
    for (const read of [{ text: DEVA }, { text: BENGALI }, { text: '' }, { text: '१' }, {}, null, { text: ENGLISH, labels: {} }]) {
      const v = suryaPageVerdict(read);
      expect(['write', 'textless', 'reject']).toContain(v.verdict);
      expect(typeof v.reason).toBe('string');
    }
  });
  it('tidies the read and nothing more', () => {
    expect(cleanRead('क \r\nख\n\n\n\nग  ')).toBe('क\nख\n\nग');
  });
});

describe('surya-print-lane: two-column index read row by row (Surya\'s weak class, #7243)', () => {
  const words = ['अग्निः', 'इन्द्रः', 'वरुणः', 'सोमः', 'रुद्रः', 'विष्णुः', 'सूर्यः', 'वायुः', 'पूषा', 'मित्रः', 'अदितिः', 'उषाः', 'अश्विनौ', 'बृहस्पतिः', 'त्वष्टा', 'सविता', 'यमः', 'पर्जन्यः', 'मरुतः', 'ऋभवः'];
  const twoColumns = Array.from({ length: 10 }, (_, i) => `${words[i]} ${12 + i}, ${40 + i} ${words[i + 10]} ${101 + i}`).join('\n');
  const oneColumn = Array.from({ length: 10 }, (_, i) => `${words[i]}सूक्तव्याख्यानम् ${12 + i}`).join('\n');
  it('flags rows that hold two entries', () => {
    expect(indexColumns(twoColumns)).toMatchObject({ hit: true, lines: 10, number_final: 10, two_entry: 10 });
    expect(suryaPageVerdict({ text: twoColumns })).toMatchObject({ verdict: 'reject', reason: 'index_columns' });
  });
  it('with Devanagari page numbers too', () => {
    const deva = Array.from({ length: 10 }, (_, i) => `${words[i]} १२ ${words[i + 10]} ४५`).join('\n');
    expect(indexColumns(deva).hit).toBe(true);
  });
  it('does not flag a one-column contents page or a verse page', () => {
    expect(indexColumns(oneColumn)).toMatchObject({ hit: false, two_entry: 0 });
    expect(suryaPageVerdict({ text: oneColumn }).verdict).toBe('write');
    expect(indexColumns(`${DEVA}\n${DEVA}\n${DEVA}`).hit).toBe(false);
  });
  it('the read is kept as a candidate, and the page is never planned again for other scripts', () => {
    expect([...SA_PROFILE.keepReasons]).toEqual(['index_columns']);
    expect([...SA_PROFILE.finalReasons]).toEqual(expect.arrayContaining(['not_devanagari', 'book_not_devanagari']));
    expect(SA_PROFILE.finalReasons).not.toContain('index_columns');
  });
});

describe('surya-print-lane: the book gate and its ledger rows', () => {
  const reads = (n: number, text: string) => Array.from({ length: n }, () => ({ text }));
  it('refuses a book whose text pages are mostly another script, and names the script', () => {
    const g = bookScriptGate([...reads(12, BENGALI), ...reads(2, DEVA), ...reads(5, '')]);
    expect(g).toMatchObject({ ok: false, judged: true, reason: 'book_not_devanagari', script: 'Bengali', text_pages: 14, devanagari_pages: 2 });
  });
  it('passes a Devanagari book with an English preface', () => {
    expect(bookScriptGate([...reads(12, DEVA), ...reads(4, ENGLISH)])).toMatchObject({ ok: true, judged: true, devanagari_pages: 12, text_pages: 16 });
  });
  it('does not judge a book on a handful of pages: each page then stands on its own verdict', () => {
    const g = bookScriptGate(reads(BOOK_GATE_MIN_PAGES - 1, BENGALI));
    expect(g).toMatchObject({ ok: true, judged: false });
  });
  it('a refused book leaves one rejected row for every planned page (no silent skips)', () => {
    const pages = Array.from({ length: 14 }, (_, i) => ({ pn: i + 1, pid: `p${i + 1}` }));
    const rows = refusedBookRows('b1', pages, bookScriptGate(reads(14, BENGALI)));
    expect(rows).toHaveLength(14);
    expect(new Set(rows.map((r) => r.pn)).size).toBe(14);
    expect(rows[0]).toMatchObject({ bid: 'b1', pn: 1, pid: 'p1', reason: 'book_not_devanagari', detail: { script: 'Bengali', text_pages: 14, devanagari_pages: 0 } });
  });
});

describe('surya-print-lane: provenance on every written page', () => {
  const text = `<language>Sanskrit</language>\n<script>printed</script>\n\n${DEVA}`;
  const box = { host: 'gex45', gpu: 'RTX 4000 SFF Ada', vllm_version: '0.11.0', surya_version: '2.0.1', weights_revision: 'hf:datalab-to/surya-ocr-2@abc123', licence: 'model-card-licence' };
  it('names the source, the engine and its version, the route, the content hash and the evidence', () => {
    const f = saOcrField(text, { run: `${SA_LANE}/su-20261113T000000Z`, imageUrl: 'https://archive.org/download/x/page/n12/full/full/0/default.jpg', imageSha256: 'ab'.repeat(32), box, why: 'never_read' });
    expect(f).toMatchObject({ data: text, content_hash: contentHash(text), language: 'Sanskrit', source: 'surya', pipeline: SA_LANE, model: SURYA.model });
    expect(f.engine).toMatchObject({ name: 'Surya', model: 'datalab-to/surya-ocr-2', version: '2.0.1', revision: 'hf:datalab-to/surya-ocr-2@abc123', route: SA_ROUTE, corrected: false, issue: 95, host: 'gex45', licence: 'model-card-licence', replaced: 'never_read' });
    expect(f.engine.measured).toMatch(/2026-11-03-sanskrit-surya-print-confirm-7243/);
    expect(f.engine.input).toMatchObject({ image_url: expect.stringContaining('archive.org'), image_sha256: 'ab'.repeat(32) });
    expect(missingProvenance('ocr', f).missing).toEqual([]);
  });
  it('says so when the box did not report the licence or the snapshot; it never invents one', () => {
    const f = saOcrField(text, { run: 'r', box: {} });
    expect(f.engine.licence).toBe('not_recorded');
    expect(f.engine).not.toHaveProperty('revision');
    expect(f.engine.revision_source).toMatch(/^not_recorded/);
    expect(f.engine.input).toMatchObject({ status: 'not_recorded' });
  });
});
