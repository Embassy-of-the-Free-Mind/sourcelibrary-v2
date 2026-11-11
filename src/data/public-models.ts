/**
 * The models behind /about/models (#5601): which model does each job, for which books, why,
 * and how it fails. The prose lives here, once; the page counts come from the ops_reports
 * snapshot written by scripts/audit/model-usage-snapshot.mjs, which also imports engineFor()
 * from this file to flag an engine that writes pages without an entry here.
 *
 * PRIOR ART: the ENGINES and DECISIONS consts in src/app/research/quality/page.tsx — the same
 * facts written for a paper's reader, OCR only and with no page counts; this module adds the
 * jobs beyond OCR and the provenance match. Routing lives in getOcrModelForBook
 * (scripts/lib/ocr-routing.mjs) and getTranslateModelForBook (src/lib/types/ai-models.ts);
 * the evidence in the router table (.claude/docs/routing.md). Update those first, then this.
 *
 * Plain TypeScript with no path aliases and no runtime-only syntax: node imports this file
 * directly (type stripping), so keep it erasable.
 */

export type Job = 'read' | 'translate' | 'images' | 'search' | 'write' | 'judge';
/** Provenance lanes the snapshot counts: pages.ocr, pages.translation, gallery_images. */
export type Lane = 'ocr' | 'translation' | 'images';
export type Status = 'in use' | 'starting' | 'no new pages' | 'fallback' | 'retired';

export interface Evidence { label: string; href: string }

export interface PublicModel {
  id: string;
  job: Job;
  name: string;
  /** The model identifiers as stored on pages, so a reader can match a page's record. */
  version: string;
  maker: string;
  access: 'open model' | 'commercial service' | 'existing text, no model' | 'various';
  status: Status;
  /** Which books it works on. */
  books: string;
  why: string;
  weakness: string;
  evidence: Evidence[];
  /** Matches stored provenance to this entry. Absent for jobs the snapshot does not count. */
  match?: { lane: Lane; models?: RegExp[]; sources?: string[] };
}

const ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';
const BLOB = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';
const issue = (n: number, label?: string): Evidence => ({ label: label ?? `#${n}`, href: `${ISSUE}${n}` });

export const JOBS: { job: Job; title: string; sentence: string }[] = [
  { job: 'read', title: 'Reading the page', sentence: 'A model looks at the photograph of each page and types out the words on it, in the original language.' },
  { job: 'translate', title: 'Translating', sentence: 'A model turns that transcription into English, one page at a time, and the original stays beside it.' },
  { job: 'images', title: 'Finding pictures', sentence: 'A model finds the illustrations on each page and writes a short label for each one.' },
  { job: 'search', title: 'Searching by meaning', sentence: 'A model turns each page and each picture into a list of numbers, so a search can find passages about the same thing even when the words differ.' },
  { job: 'write', title: 'Summaries, indexes and the Librarian', sentence: 'Models write the summary, index and chapter list of each book, and answer questions in the Librarian.' },
  { job: 'judge', title: 'Checking the other models', sentence: 'In our tests, a model from another maker grades samples of the work above against the original page.' },
];

const GEMINI_SOURCES = ['ai', 'batch_api', 'batch_api_recovery', 'pipeline_preview', 'spread-split'];
/** Text that came from a published e-text matched to our scan, not from a model reading the image. */
export const EDITION_SOURCES = ['esukhia-derge-tengyur', 'cbeta-xml-p5', 'oraec-corpus', 'cdli-atf', 'corpus', 'wikisource', 'kanripo', 'sefaria'];
const EDITION_MODELS = [/^cbeta-/, /^oraec-/, /^esukhia-/, /^etcsl-/, /^cdli-/, /^tla-/, /^wikisource/];
/** Hand corrections and one-off test runs: a few hundred pages, named so none is silently dropped. */
const OTHER_MODELS = [/^claude-/, /^manual/, /^human$/];

export const MODELS: PublicModel[] = [
  // ── Reading the page ────────────────────────────────────────────────────
  {
    id: 'ocr-flash-lite', job: 'read', name: 'Lightest general model', version: 'gemini-3.1-flash-lite, earlier gemini-3.1-flash-lite-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Every book not listed under a specialist reader below. Since 11 September 2026 it reads every new page that goes to our general models, in every language.',
    why: 'On printed English from 1800–1930, checked against published texts, it tied with the mid-tier model on 75 of 92 test pages (the mid-tier model better on 14, the lightest on 3), at a lower price.',
    weakness: 'On scripts it reads poorly, such as Tibetan, Syriac or Japanese cursive, it can write fluent text that is not on the page; in testing it also refused 15–18% of English pages as quotations of a known text.',
    evidence: [issue(5182, 'English test, #5182'), { label: 'per-language study', href: `${BLOB}scripts/eval/results/per-language-suitability-2026-09-11.md` }],
    match: { lane: 'ocr', models: [/^gemini-3\.1-flash-lite/] },
  },
  {
    id: 'ocr-flash', job: 'read', name: 'Mid-tier general model', version: 'gemini-3-flash-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Much of the library, read before most new reading moved to the lightest model. Until 11 September 2026 it still read books in non-Latin scripts, books whose language was unknown, and the books of the Bibliotheca Philosophica Hermetica. Its transcriptions stay on those pages.',
    why: 'In our tests it made fewer errors than the lightest model on Greek and Chinese; it was the only general model that passed on Greek printed both before and after 1700.',
    weakness: 'It shares the lightest model’s habits: refusals on famous texts, and invented text on scripts it cannot read. On Syriac, the general model found the right passage on only 19% of pages.',
    evidence: [issue(4744, 'Greek test, #4744'), issue(4883, 'Syriac test, #4883')],
    match: { lane: 'ocr', models: [/^gemini-3-flash/] },
  },
  {
    id: 'ocr-agy-flash', job: 'read', name: 'Newer mid-tier general model', version: 'gemini-3.8-flash-low (also gemini-3.8-flash, -medium, gemini-3.7-flash-low)',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'The default reader in our current routing: it reads a page alone, or corrects a draft from one of the specialist engines. It runs through the command-line tool of a subscription, not the paid per-page service.',
    why: 'Our router picks it wherever its measured defects are no worse than the other routes’, and uses the strongest model tested only where every route of this kind fails.',
    weakness: 'It shares the other general models’ habits: refusals on famous texts, and fluent text on scripts it cannot read. The lower-effort level, “low”, is the one that reads most pages.',
    evidence: [{ label: 'routes', href: `${BLOB}.claude/docs/routing.md` }],
    match: { lane: 'ocr', models: [/^gemini-3\.[78]-flash/] },
  },
  {
    id: 'ocr-heavy', job: 'read', name: 'Heavier general model', version: 'gemini-4-argon-low, gemini-4-argon-high',
    maker: 'Commercial AI service', access: 'commercial service', status: 'fallback',
    books: 'A few thousand pages, re-read.',
    why: 'A heavier model than the others on this page, used for re-reads.',
    weakness: 'It is limited to a few hundred calls a day, because one large run once used up the whole shared quota. Not measured against the current models on our pages.',
    evidence: [{ label: 'routes', href: `${BLOB}.claude/docs/routing.md` }],
    match: { lane: 'ocr', models: [/argon/] },
  },
  {
    id: 'ocr-lighton', job: 'read', name: 'Open engine for English print', version: 'lightonai/LightOnOCR-3-1B',
    maker: 'Open-weights project (Apache-2.0 licence)', access: 'open model', status: 'in use',
    books: 'Printed English books from 1800 onwards, and Fraktur. It reads only pages that have no text yet: never read, or refused or returned empty by the lightest general model.',
    why: 'On 97 typed reference pages of English print from 1800 on, its median character error was 0.12% against 0.27% for the lightest general model, with no catastrophic reads against 17.',
    weakness: 'It garbled Sanskrit, Devanagari and Chinese spans, misread the diacritics of transliterated names, and sometimes added a note about its own reading; pages with these are checked and set aside.',
    evidence: [issue(6871, 'the lane, #6871'), { label: 'routes', href: `${BLOB}.claude/docs/routing.md` }],
    match: { lane: 'ocr', models: [/lighton/i], sources: ['lightonocr'] },
  },
  {
    id: 'ocr-paddle', job: 'read', name: 'Open engine for Chinese manuscripts', version: 'PaddleOCR-VL-1.6, PaddleOCR-VL-1.6-0.9B',
    maker: 'Open-weights project', access: 'open model', status: 'starting',
    books: 'The Siku Quanshu manuscript copies: about 7,900 Chinese books whose reading was held back for this model.',
    why: 'Checked against the Kanripo and CBETA texts on 433 of these books, it got more than half the characters wrong on 0.9% of pages, against 10.6% for the lightest general model and 3.7% for the mid-tier one.',
    weakness: 'Its typical error against those texts is about the same as the general models’ (18–26% of characters), partly because the reference texts follow other editions. It is new to our pipeline, and pages that disagree badly with a Kanripo text will be set aside for review.',
    evidence: [issue(5547, 'comparison, #5547'), issue(5600, 'the run, #5600')],
    match: { lane: 'ocr', models: [/paddle/i], sources: ['paddle'] },
  },
  {
    id: 'ocr-ndl', job: 'read', name: 'NDL Classical Japanese OCR, version 3', version: 'ndl-koten/v3 (ndlkotenocr)',
    maker: 'National Diet Library, Japan', access: 'open model', status: 'in use',
    books: 'Japanese books written in cursive script (kuzushiji).',
    why: 'On 45 cursive pages checked by eye, it stayed coherent where both general models repeated themselves or invented text.',
    weakness: 'There are no reference transcriptions for these books yet, so its accuracy has not been measured.',
    evidence: [issue(4745, 'test, #4745'), { label: 'the model', href: 'https://github.com/ndl-lab/ndlkotenocr_cli' }],
    match: { lane: 'ocr', models: [/^ndl-koten/], sources: ['ndl-koten'] },
  },
  {
    id: 'ocr-bdrc', job: 'read', name: 'Tibetan model from BDRC', version: 'bdrc-yigdzin-v1, bdrc-woodblock-easter2',
    maker: 'Buddhist Digital Resource Center', access: 'open model', status: 'in use',
    books: 'Tibetan books.',
    why: 'Its text matched the Derge e-text with 0.88 identity, against 0.41 for the general model; the lightest model failed on about a third of Tibetan pages.',
    weakness: 'It reads Tibetan only. Given a page in another script, it still writes fluent Tibetan, so we check that a book is written in Tibetan before it reads it. Unusual page layouts need our own handling before it can find the lines.',
    evidence: [issue(4523, 'test, #4523'), issue(5737, 'routing by script, #5737')],
    match: { lane: 'ocr', models: [/^bdrc-/], sources: ['bdrc'] },
  },
  {
    id: 'ocr-kraken', job: 'read', name: 'Kraken, with Syriac models from Beth Mardutho', version: 'kraken 7.1 with sophro-mhiro (manuscripts) or omnisyr (print)',
    maker: 'Kraken: open source; models: Beth Mardutho', access: 'open model', status: 'in use',
    books: 'Syriac books and manuscripts.',
    why: 'A general model returned fluent scripture that was not on the page; Kraken reads the letters that are there.',
    weakness: 'It is only as good as its model is for a given hand, and hands it was not trained on may read poorly.',
    evidence: [issue(4883, 'test, #4883'), { label: 'manuscript model', href: 'https://doi.org/10.5281/zenodo.17406773' }, { label: 'print model', href: 'https://doi.org/10.5281/zenodo.8425684' }],
    match: { lane: 'ocr', models: [/^kraken\//], sources: ['kraken'] },
  },
  {
    id: 'ocr-mineru', job: 'read', name: 'Open engine for print', version: 'mineru-pipeline',
    maker: 'Open-weights project', access: 'open model', status: 'fallback',
    books: 'A small number of printed English pages that our general models refused to transcribe.',
    why: 'It never refuses a page.',
    weakness: 'Page by page it read worse than the lightest general model (better on 10 pages, worse on 49), and before a fix it dropped footnotes.',
    evidence: [issue(5182, 'test, #5182')],
    match: { lane: 'ocr', models: [/^mineru/], sources: ['mineru'] },
  },
  {
    id: 'ocr-ia', job: 'read', name: 'Internet Archive text', version: 'ia-ocr/<version of the Archive’s OCR>, ia-abbyy-hocr',
    maker: 'Internet Archive', access: 'existing text, no model', status: 'in use',
    books: 'Books imported from the Internet Archive, until our own reading replaces it.',
    why: 'It is free and arrives with the scan, so a new book is searchable at once.',
    weakness: 'The lightest general model read better on 57 books to 5, and the Archive’s text misreads about 1.5% of printed numbers.',
    evidence: [issue(5186, 'test, #5186')],
    match: { lane: 'ocr', models: [/^ia-ocr\//, /^ia-legacy-ocr/, /^ia-abbyy-/], sources: ['ia_djvu', 'ia-ocr-repair', 'internet_archive'] },
  },
  {
    id: 'ocr-editions', job: 'read', name: 'Published e-texts', version: 'Esukhia Derge Tengyur, CBETA, ORAEC, ETCSL, CDLI, TLA, Wikisource',
    maker: 'Scholarly text projects', access: 'existing text, no model', status: 'in use',
    books: 'Pages where a scholarly e-text of the same work exists and has been matched to our scan.',
    why: 'Text typed and checked by people is more reliable than any model reading the image.',
    weakness: 'The e-text may follow a different edition than our scan, and its match to the page can slip by a line or a leaf.',
    evidence: [issue(5497, 'Tengyur, #5497'), issue(5571, 'licence display, #5571')],
    match: { lane: 'ocr', models: EDITION_MODELS, sources: EDITION_SOURCES },
  },
  {
    id: 'ocr-gemini-older', job: 'read', name: 'Earlier general models', version: 'gemini-2.5-flash, gemini-2.0-flash',
    maker: 'Commercial AI service', access: 'commercial service', status: 'retired',
    books: 'Pages read before our current general models existed. We no longer use these models; their text stays until a page is read again.',
    why: 'They were the best models of their kind available to us at the time.',
    weakness: 'Not measured against the current models on our pages.',
    evidence: [],
    match: { lane: 'ocr', models: [/^gemini-(1|2)\./, /^gemini$/] },
  },
  {
    id: 'ocr-other', job: 'read', name: 'Hand corrections and test runs', version: 'manual, human, claude-*',
    maker: 'People, and an AI model in tests', access: 'various', status: 'in use',
    books: 'A few hundred pages typed or corrected by hand (including volunteers’ corrections and pages checked by eye), or read by an AI model while we tested it.',
    why: 'Corrections by people; the AI-model pages are left from tests.',
    weakness: 'Each is a small, one-off source. The record on each page says which.',
    evidence: [],
    match: { lane: 'ocr', models: OTHER_MODELS, sources: ['manual', 'volunteer-correction', 'by_eye'] },
  },
  {
    id: 'ocr-unrecorded', job: 'read', name: 'Not recorded', version: '—',
    maker: '—', access: 'various', status: 'retired',
    books: 'Pages transcribed before we began storing the model’s name on each page.',
    why: '—',
    weakness: 'We cannot say which model read these pages.',
    evidence: [],
  },

  // ── Translating ─────────────────────────────────────────────────────────
  {
    id: 'tr-flash-lite', job: 'translate', name: 'Lightest general model', version: 'gemini-3.1-flash-lite, earlier gemini-3.1-flash-lite-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Books in Latin, the European vernaculars and every language not listed under the mid-tier general model. The same model writes the Spanish translations and the modern-spelling versions of English books printed before 1700.',
    why: 'Set against the mid-tier model on 303 pages from 137 books in non-Latin scripts, a blind judge found no passage it failed to understand.',
    weakness: 'It translates whatever the transcription says: if the reading is wrong, the English is fluent and wrong.',
    evidence: [issue(4759, 'test, #4759'), issue(4765, 'the failure, #4765')],
    match: { lane: 'translation', models: [/^gemini-3\.1-flash-lite/] },
  },
  {
    id: 'tr-flash', job: 'translate', name: 'Mid-tier general model', version: 'gemini-3-flash-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Books of the Bibliotheca Philosophica Hermetica, our partner library in Amsterdam, and books in Tibetan, Greek, Hebrew, Aramaic, Arabic, Persian, Sanskrit, Pali and Chinese. Many older translations of other books were also written by it.',
    why: 'Against published human translations of the same passages (191 pages), the mid-tier model was more faithful than the lightest in Greek, Hebrew, Arabic, Persian, Sanskrit, Pali and Chinese, and reversed the meaning of a sentence less often.',
    weakness: 'The same as the lightest model: a wrong transcription becomes fluent, wrong English.',
    evidence: [issue(4742, 'Tibetan test, #4742'), issue(5695, 'Tests against human translations, #5695')],
    match: { lane: 'translation', models: [/^gemini-3-flash/] },
  },
  {
    id: 'tr-agy-flash', job: 'translate', name: 'Newer mid-tier general model', version: 'gemini-3.8-flash-low (also gemini-3.8-flash)',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'The default translator in our current routing, for the books the router sends it. It runs through the command-line tool of a subscription, not the paid per-page service.',
    why: 'Our router picks it wherever its measured defects are no worse than the other routes’, and uses the strongest model tested only where every route of this kind fails.',
    weakness: 'The same as the other general models: a wrong transcription becomes fluent, wrong English.',
    evidence: [{ label: 'routes', href: `${BLOB}.claude/docs/routing.md` }],
    match: { lane: 'translation', models: [/^gemini-3\.[78]-flash/] },
  },
  {
    id: 'tr-heavy', job: 'translate', name: 'Heavier general model', version: 'gemini-4-argon-low',
    maker: 'Commercial AI service', access: 'commercial service', status: 'fallback',
    books: 'A few thousand pages, translated a second time.',
    why: 'A heavier model than the others on this page, used for second translations.',
    weakness: 'It is limited to a few hundred calls a day, because one large run once used up the whole shared quota. Not measured against the current models on our pages.',
    evidence: [{ label: 'routes', href: `${BLOB}.claude/docs/routing.md` }],
    match: { lane: 'translation', models: [/argon/] },
  },
  {
    id: 'tr-gemini-older', job: 'translate', name: 'Earlier general models', version: 'gemini-2.5-flash, gemini-2.0-flash',
    maker: 'Commercial AI service', access: 'commercial service', status: 'retired',
    books: 'Pages translated before our current general models existed. Their English stays until a page is translated again.',
    why: 'They were the best models of their kind available to us at the time.',
    weakness: 'Not measured against the current models on our pages.',
    evidence: [],
    match: { lane: 'translation', models: [/^gemini-(1|2)\./, /^gemini$/] },
  },

  {
    id: 'tr-editions', job: 'translate', name: 'Published translations', version: 'ETCSL, TLA',
    maker: 'Scholarly text projects', access: 'existing text, no model', status: 'in use',
    books: 'Sumerian and Egyptian texts whose scholarly translation is openly published and has been matched to our pages.',
    why: 'A translation made and checked by scholars is more reliable than any model.',
    weakness: 'It may translate a different edition than our scan, and its match to the page can slip.',
    evidence: [{ label: 'ETCSL', href: 'https://etcsl.orinst.ox.ac.uk/' }],
    match: { lane: 'translation', models: [/^etcsl-/, /^tla-/], sources: ['corpus'] },
  },
  {
    id: 'tr-other', job: 'translate', name: 'Hand corrections and test runs', version: 'manual, human, claude-*',
    maker: 'People, and an AI model in tests', access: 'various', status: 'in use',
    books: 'A few hundred pages translated or corrected by hand (including volunteers’ corrections), or translated by an AI model while we tested it.',
    why: 'Corrections by people; the AI-model pages are left from tests.',
    weakness: 'Each is a small, one-off source. The record on each page says which.',
    evidence: [],
    match: { lane: 'translation', models: OTHER_MODELS, sources: ['manual', 'volunteer-correction'] },
  },
  {
    id: 'tr-unrecorded', job: 'translate', name: 'Not recorded', version: '—',
    maker: '—', access: 'various', status: 'retired',
    books: 'Pages translated before we began storing the model’s name on each page.',
    why: '—',
    weakness: 'We cannot say which model translated these pages.',
    evidence: [],
  },

  // ── Finding pictures ────────────────────────────────────────────────────
  {
    id: 'img-flash', job: 'images', name: 'Mid-tier general model', version: 'gemini-3-flash-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Every book that goes through the picture step.',
    why: 'A test on 5 pages suggested the cheaper model missed pictures; that test is too small, and a test on 400 pages is planned.',
    weakness: 'A label is the model’s own reading of a picture and can misname its subject. Books whose text came from the Internet Archive were skipped by mistake.',
    evidence: [issue(4747, 'the 5-page test, #4747'), issue(5009, 'the skipped books, #5009')],
    match: { lane: 'images', models: [/^gemini-3-flash/] },
  },
  {
    id: 'img-flash-lite', job: 'images', name: 'Lightest general model', version: 'gemini-3.1-flash-lite, earlier gemini-3.1-flash-lite-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'no new pages',
    books: 'Two trial runs, in spring 2026 and on 24 August 2026. The pictures it found stay in the gallery.',
    why: 'Tried as a cheaper alternative to the mid-tier model.',
    weakness: 'Whether it misses pictures has not been measured on enough pages to decide.',
    evidence: [issue(4747, 'the open question, #4747')],
    match: { lane: 'images', models: [/^gemini-3\.1-flash-lite/] },
  },
  {
    id: 'img-older', job: 'images', name: 'Earlier or unrecorded models', version: 'gemini-2.5-flash, gemini-2.0-flash, or not recorded',
    maker: 'Commercial AI service', access: 'commercial service', status: 'retired',
    books: 'Pictures found before we stored the model’s name with each one.',
    why: '—',
    weakness: 'We cannot say which model found these pictures.',
    evidence: [],
    match: { lane: 'images', models: [/^gemini-(1|2)\./, /^gemini$/] },
  },

  // ── Searching by meaning ────────────────────────────────────────────────
  {
    id: 'search-gemini-embedding', job: 'search', name: 'Search model for meaning', version: 'gemini-embedding-2',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Every translated page, every book summary and every picture label.',
    why: 'One model for every kind of text, so a search can compare a page with a picture label.',
    weakness: 'It finds passages about the same thing, not exact quotations; for an exact phrase, search for the words. We have not published a measurement of how well it ranks.',
    evidence: [{ label: 'how search works', href: `${BLOB}.claude/docs/embeddings.md` }],
  },
  {
    id: 'search-clip', job: 'search', name: 'Image search model', version: 'clip-vit-base-patch32',
    maker: 'Open-weights project', access: 'open model', status: 'in use',
    books: 'Every picture in the gallery, for finding pictures that look alike.',
    why: 'It runs on our own server, so it costs nothing per picture.',
    weakness: 'It compares how pictures look, not what they mean.',
    evidence: [{ label: 'how search works', href: `${BLOB}.claude/docs/embeddings.md` }],
  },

  // ── Summaries, indexes and the Librarian ────────────────────────────────
  {
    id: 'write-flash-lite', job: 'write', name: 'Lightest general model', version: 'gemini-3.1-flash-lite',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'Every book: the summary, the index of people, places and ideas, and the chapter list.',
    why: 'It writes from the transcription and translation we already hold. We have not compared it with other models for this job.',
    weakness: 'A summary is only as good as the text it read: a wrong transcription can put the wrong subject into the summary.',
    evidence: [],
  },
  {
    id: 'write-librarian', job: 'write', name: 'Mid-tier general model', version: 'gemini-3-flash-preview',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'The Librarian, which searches the whole library to answer a question and cites the pages it used.',
    why: 'It searches, reads and quotes in one conversation. We have not compared it with other models for this job.',
    weakness: 'It can still misquote a page or give a wrong link, so check the page it cites.',
    evidence: [issue(4704, 'log review, #4704')],
  },

  // ── Checking the other models ───────────────────────────────────────────
  {
    id: 'judge-claude', job: 'judge', name: 'AI reviewer', version: 'Claude Opus, with Claude Sonnet as a second judge',
    maker: 'Commercial AI service', access: 'commercial service', status: 'in use',
    books: 'A monthly sample of about 100 translated books, one page each, graded against the original page.',
    why: 'It comes from a different maker than the translator on purpose: in an earlier test, a judge from the translator’s own model family grading its translations barely agreed with scholars’ own judgements.',
    weakness: 'It reads the transcription, not the page image, so it cannot see when a transcription is of the wrong page. Each batch hides pages we spoiled on purpose (swapped, cut or repeated text); if the judge misses too many, that month is not reported. A person checked 21 of its flagged errors against the page images and confirmed 20.',
    evidence: [{ label: 'first audit', href: `${BLOB}scripts/eval/results/translation-corpus-audit-2026-09-30/README.md` }, issue(5301, 'monthly audit, #5301'), { label: 'results', href: '/research/quality' }],
  },
];

export const NOT_A_MODEL = new Set(['system', 'skip', 'same-language']);

/**
 * Which entry wrote a stored row. Returns the entry id, 'not-a-model' for rows that carry no
 * model by design (a page marked blank, already in English), or null for an engine the page
 * does not describe — which the snapshot script and the unit test treat as drift.
 */
export function engineFor(lane: string, model: string | null, source: string | null): string | null {
  if (lane === 'ocr' && !model && !source) return 'ocr-unrecorded';
  if (lane === 'translation' && !model && (!source || GEMINI_SOURCES.includes(source))) return 'tr-unrecorded';
  if (lane === 'images' && !model) return 'img-older';
  if (source && NOT_A_MODEL.has(source) && !model) return 'not-a-model';
  // The model name decides first (a BDRC model can arrive under a Gemini-shaped source, 'ai');
  // the source decides only when no entry claims the model.
  const lanes = MODELS.filter(m => m.match?.lane === lane);
  if (model) for (const m of lanes) if (m.match!.models?.some(re => re.test(model))) return m.id;
  if (source) for (const m of lanes) if (m.match!.sources?.includes(source)) return m.id;
  // A Gemini source with no model name recorded: Gemini, version unknown.
  if (lane === 'ocr' && source && GEMINI_SOURCES.includes(source) && !model) return 'ocr-unrecorded';
  return null;
}
