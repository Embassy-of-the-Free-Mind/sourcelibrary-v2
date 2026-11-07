import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import { pagesForEnrichment } from '../../scripts/lib/english-original-text.mjs';
// @ts-expect-error — plain .mjs worker helper, no types
import { buildPageIndex, groundQuotes } from '../../scripts/workers/lib/quote-grounding.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { buildPageTexts, attributeEntityPages } from '../../scripts/lib/entity-page-match.mjs';

/**
 * enrich-worker Phase 6 reads only `translation.data`. An English original has
 * none (the translate lanes skip English, #5384), so Brinton's Cakchiquel
 * grammar, Codex Perez and Tozzer's Maya grammar enriched to an empty index
 * (`pagesCovered: 0`), no entities and no summary — or the Wikipedia
 * "Anonymous" placeholder — and their status advanced anyway (#6559).
 *
 * Fixtures are copied from production (2026-10-24), captured before the
 * assertions were written: Brinton p.20 (`6acc3e43…`), Codex Perez p.20 (a
 * blank leaf), and the Hall / Loeb pages from english-original-serve.test.ts.
 */

const BRINTON = { id: '6acc3e43230e9a56175ce062', language: 'English', translation_state: { english_original: true } };
const BRINTON_P20 = { id: '6acc3e45230e9a56175ce076', page_number: 20, page_type: 'text', ocr: { data: "<scan-quality>good</scan-quality>\n<language>English</language>\n<script>printed</script>\n<page-type>text</page-type>\n<page-num>9</page-num>\nthemselves as *ahcakchiquele*, but generally by the simpler term *Cakchiqueles*.\n\n### \u00a7 II. *History of the Present Work.*\n\nThe present Grammar of the Cakchiquel is the translation of a portion of a Spanish manuscript presented to the Library of the American Philosophical Society in 1836, by Se\u00f1or Mariano Galvez, then Governor of Guatemala, and obtained, it would appear, from the library of one of the religious houses. I have described this MS. in a previous publication, and will transcribe what I have there written:\n\n\"The next work is a small quarto of 109 leaves. Unfortunately, the first leaf with the general title is missing. The top of the second leaf commences in the midst of a sentence in a *Doctrina Christiana* in Cakchiquel. This covers ten leaves, and is followed by two leaves of 'Preguntas de la Doctrina,' all in Cakchiquel. Next comes a 'Confessionario breve en lengua Cakchiquel.' The Spanish translation of each question and answer is also given.\n\n\"After the Confessionario are three leaves, unnumbered and blank, except that on the recto of the second is a Latin Prayer to the Virgin, difficult to decipher.\n\n\"On the recto of the next leaf is the following:\n\n\"'*Arte* || *de la lengua cak* || *chiquel.*'\n\n\"It is written in a clear small hand, covers fifty-four pages, with an average of thirty lines to the page, sometimes with one column, sometimes with two, and closes with the colophon:\n\n\"'Martes \u00e1 21 de Junio de 1692 a\u00f1os dia del Nacimiento de S. Juan Baptista se acavo el traslado de ora\u00e7iones y Arte en Kakchiquel.'\n\n\"From the close of this to the 96th leaf there is another series of doctrinal questions in Cakchiquel.\n\n\"Then follows another 'Confessionario breve en lengua castellana y cakchiquel,' 12 pages in length, differing considerably from the previous one. The rest of the volume is taken up with 'Platicas,' short discourses on religious subjects. * * The characters of Parra are employed in all the divisions of the book, and the writing is generally quite legible.\n\n\"There is no hint throughout where the original was written nor by whom. * * * The linguistic value of the *Arte* is considerable.\"*\n\nAs no part of the collection presented to the Society by President\n\n---\n\n**A Notice of Some Manuscripts in Central American Languages*, by Daniel G. Brinton, *American Journal of Science and Arts*, March, 1869.\n<meta>Digitized by Google</meta>\n<vocab>ahcakchiquele, Cakchiqueles, Mariano Galvez, Doctrina Christiana, Preguntas de la Doctrina, Confessionario breve, Arte de la lengua cakchiquel, Platicas, characters of Parra, Brinton</vocab>" } };
const CODEX_PEREZ_P20 = { id: '6acc3eb2230e9a56175ce7dc', page_number: 20, page_type: 'blank', ocr: { data: "<scan-quality>good</scan-quality>\n<language>English</language>\n<script>printed</script>\n<page-type>blank</page-type>\n<warning>show-through from the other side only</warning>" } };

const HALL_BOOK = { id: '69a5526e1e2c2347112f0300', language: 'English', translation_state: { english_original: true } };
const HALL_P40 = {
  id: '69a5526e1e2c2347112f0328', page_number: 40,
  ocr: { data: '<language>English</language>\n<page-type>text</page-type>\n<page-num>21</page-num>\n\n# The Ancient Mysteries and Secret Societies\n\n## Which Have Influenced Modern Masonic Symbolism\n\n<margin>p. 21</margin>\nWHEN confronted with a problem involving the use of the reasoning faculties, individuals of strong intellect keep their poise, and seek to reach a solution by obtaining facts bearing upon the question. Those of immature mentality, on the other hand, when similarly confronted, are overwhelmed. While the former may be qualified to solve the riddle of their own destiny, the latter must be led like a flock of sheep and taught in simple language. They depend almost entirely upon the ministrations of the shepherd. The Apostle Paul said that these little ones must be fed with milk, but that meat is the food of strong men. Thoughtlessness is almost synonymous with childishness, while thoughtfulness is symbolic of maturity.\n\nThere are, however, but few mature minds in the world; and thus it was that the philosophic-religious doctrines of the pagans were divided to meet the needs of these two fundamental groups of human intellect--one philosophic, the other incapable of appreciating the deeper mysteries of life. To the discerning few were revealed the esoteric, or spiritual, teachings, while the unqualified many received only the literal, or exoteric, interpretations.' },
  translation: { data: '<meta>This page transitions from the symbolism of the Orphic Egg to a broader exploration of the ancient secret societies and "Mysteries" that shaped Western esoteric tradition and Freemasonry.</meta>\n\n# The Ancient Mysteries and Secret Societies\n\n## Which Have Influenced Modern Masonic Symbolism\n\n<margin>p. 21</margin>\n\nWhen faced with a problem that requires the use of reason, individuals with strong intellects maintain their composure and seek a solution by gathering facts related to the question. Those with immature minds, however, are overwhelmed when faced with similar challenges. While the former may be capable of solving the mystery of their own destiny, the latter must be led like a flock of sheep and taught in simple language. They depend almost entirely on the guidance of a leader <note>original: "ministrations of the shepherd"</note>. The Apostle Paul said that these "little ones" must be fed with milk, but that solid food <note>original: "meat"</note> is the food of the mature <note>original: "strong men"</note>. Thoughtlessness is nearly synonymous with childishness, while thoughtfulness represents maturity.\n\nHowever, there are only a few mature minds in the world. Consequently, the philosophical and religious doctrines of the ancient world <note>original: "pagans"</note> were divided to meet the needs of these two basic groups of human intellect: one group was philosophical, while the other was unable to appreciate the deeper mysteries of life.' },
};

const LOEB_BOOK = { id: '69af2362285bd7360437434a', language: 'English', translation_state: { english_original: true } };
const LOEB_P276 = {
  id: 'loeb-p276', page_number: 276,
  ocr: { data: '<language>Latin</language>\n<script>printed</script>\n<page-type>text</page-type>\n<page-num>240</page-num>\n<header>THE LIVES OF THE CAESARS, BOOK II</header>\n\nLXXV. Festos et sollemnes dies profusissime, nonnumquam tantum ioculariter celebrabat. Saturnalibus, et si quando alias libuisset, modo munera dividebat, vestem et aurum et argentum, modo nummos omnis notae, etiam veteres regios ac peregrinos, interdum nihil praeter cilicia et spongias et rutabula et forpices atque alia id genus titulis obscuris et ambiguis.' },
  translation: { data: '<header>THE LIVES OF THE CAESARS, BOOK II</header>\n\nLXXV. He celebrated festivals and holidays most lavishly, though sometimes he would observe them only in a spirit of play. During the Saturnalia, and whenever else he felt inclined, he would distribute gifts—sometimes clothing, gold, and silver, and sometimes coins of every currency, including old regal and foreign money. Occasionally, he would give nothing but haircloth, sponges, pokers, tongs, and other things of that sort, labeled with obscure and ambiguous clues.' },
};

const BRINTON_QUOTE = 'The present Grammar of the Cakchiquel is the translation of a portion of a Spanish manuscript presented to the Library of the American Philosophical Society in 1836';

describe('pagesForEnrichment — an English original enriches from its transcription (#6559)', () => {
  it('gives an untranslated English leaf its OCR as the text Phase 6 reads', () => {
    const [p] = pagesForEnrichment([BRINTON_P20], BRINTON);
    expect(BRINTON_P20).not.toHaveProperty('translation'); // the input is not mutated
    expect(p.translation.data).toBe(BRINTON_P20.ocr.data);
    expect(p.translation.source).toBe('ocr_original');
  });

  it('lets quote grounding and entity attribution find the author\'s own words', async () => {
    const pages = pagesForEnrichment([BRINTON_P20], BRINTON);
    const { grounded } = await groundQuotes([{ text: BRINTON_QUOTE, page: 20 }], buildPageIndex(pages));
    expect(grounded).toHaveLength(1);
    expect(grounded[0].page).toBe(20);
    expect(attributeEntityPages('Mariano Galvez', buildPageTexts(pages)).pages).toEqual([20]);

    // The failure this replaces: with the raw page, nothing grounds.
    const before = await groundQuotes([{ text: BRINTON_QUOTE, page: 20 }], buildPageIndex([BRINTON_P20]));
    expect(before.grounded).toHaveLength(0);
  });

  it('prefers the transcription over a stored rewording (#7100)', () => {
    const [p] = pagesForEnrichment([HALL_P40], HALL_BOOK);
    expect(p.translation.data).toContain('WHEN confronted with a problem involving the use of the reasoning faculties');
    expect(p.translation.data).not.toContain('When faced with a problem that requires the use of reason');
  });

  it('keeps the real translation of a foreign leaf in an English edition (Loeb Latin page)', () => {
    const [p] = pagesForEnrichment([LOEB_P276], LOEB_BOOK);
    expect(p).toBe(LOEB_P276);
  });

  it('leaves a blank leaf without text', () => {
    const [p] = pagesForEnrichment([CODEX_PEREZ_P20], BRINTON);
    expect(p).toBe(CODEX_PEREZ_P20);
  });

  it('does not change how a non-English book enriches', () => {
    const latinBook = { id: 'x', language: 'Latin' };
    const stampedFalse = { id: 'y', language: 'English', translation_state: { english_original: false } };
    const pages = [BRINTON_P20, HALL_P40, LOEB_P276];
    expect(pagesForEnrichment(pages, latinBook)).toBe(pages);
    expect(pagesForEnrichment(pages, stampedFalse)).toBe(pages);
  });
});

describe('enrich-worker Phase 6 reads its pages through pagesForEnrichment', () => {
  // enrich-worker.mjs runs its main loop on import, so the loader cannot be called from a
  // test. The failure mode of #6559 was the ABSENCE of this step, so the guard pins that the
  // pages loadPhase6Inputs returns are the helper's output (comments stripped, scoped to
  // the function), and that both book reads carry the stamp it decides on.
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/workers/enrich-worker.mjs'), 'utf8');
  const body = src.slice(src.indexOf('async function loadPhase6Inputs'), src.indexOf('async function enrichBook'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('wraps the pages read in pagesForEnrichment(..., book)', () => {
    expect(body).toMatch(/const pages = pagesForEnrichment\(await db\.collection\('pages'\)[\s\S]*?\.toArray\(\), book\)/);
  });

  it('projects translation_state.english_original on both Phase 6 book reads', () => {
    const lane = fs.readFileSync(path.join(__dirname, '../../scripts/workers/lib/enrich-batch-lane.mjs'), 'utf8');
    expect(src).toMatch(/\.find\(\{ 'pipeline_auto\.status': 'translate_complete'[\s\S]{0,1200}'translation_state\.english_original': 1/);
    expect(lane).toMatch(/\.project\(\{ id: 1, title: 1, display_title: 1, author: 1, language: 1, 'translation_state\.english_original': 1, summary:/);
  });
});
