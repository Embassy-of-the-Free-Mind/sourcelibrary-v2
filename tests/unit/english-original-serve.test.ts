import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * An English edition's English leaf serves its TRANSCRIPTION from every door (#7100).
 *
 * Before #5384 the translate lanes ran English pages through the translator, and
 * every door that prefers `translation.data` over `ocr.data` then served a
 * model's rewording as the author's words — 446 public books read as
 * paraphrase. The fixtures are copied from production (2026-10-21), never
 * written toward the verdict:
 *
 * - HALL: Manly P. Hall, *The Secret Teachings of All Ages* (1928), p.40 — the
 *   case in the issue. The stored text is a rewrite (bigram overlap 0.59).
 * - CONTROVERSY: *The controversy of the spirit* (1811), p.31 — a light edit
 *   (overlap ~0.7), the only kind that may be offered as "Modernized spelling".
 * - LOEB: Suetonius, Loeb vol. I (1913, catalogued English), p.276 — a LATIN
 *   leaf of a bilingual edition, whose English is a real translation and stays.
 */

const HALL_BOOK = { id: '69a5526e1e2c2347112f0300', slug: 'the-secret-teachings-of-all-ages-hall', title: 'The Secret Teachings of All Ages', author: 'Manly P. Hall', published: '1928', language: 'English', visible: true, pages_count: 633, translation_state: { english_original: true } };
const HALL_P40 = {
  id: '69a5526e1e2c2347112f0328', book_id: HALL_BOOK.id, page_number: 40,
  ocr: { data: '<language>English</language>\n<page-type>text</page-type>\n<page-num>21</page-num>\n\n# The Ancient Mysteries and Secret Societies\n\n## Which Have Influenced Modern Masonic Symbolism\n\n<margin>p. 21</margin>\nWHEN confronted with a problem involving the use of the reasoning faculties, individuals of strong intellect keep their poise, and seek to reach a solution by obtaining facts bearing upon the question. Those of immature mentality, on the other hand, when similarly confronted, are overwhelmed. While the former may be qualified to solve the riddle of their own destiny, the latter must be led like a flock of sheep and taught in simple language. They depend almost entirely upon the ministrations of the shepherd. The Apostle Paul said that these little ones must be fed with milk, but that meat is the food of strong men. Thoughtlessness is almost synonymous with childishness, while thoughtfulness is symbolic of maturity.\n\nThere are, however, but few mature minds in the world; and thus it was that the philosophic-religious doctrines of the pagans were divided to meet the needs of these two fundamental groups of human intellect--one philosophic, the other incapable of appreciating the deeper mysteries of life. To the discerning few were revealed the esoteric, or spiritual, teachings, while the unqualified many received only the literal, or exoteric, interpretations.' },
  translation: { data: '<meta>This page transitions from the symbolism of the Orphic Egg to a broader exploration of the ancient secret societies and "Mysteries" that shaped Western esoteric tradition and Freemasonry.</meta>\n\n# The Ancient Mysteries and Secret Societies\n\n## Which Have Influenced Modern Masonic Symbolism\n\n<margin>p. 21</margin>\n\nWhen faced with a problem that requires the use of reason, individuals with strong intellects maintain their composure and seek a solution by gathering facts related to the question. Those with immature minds, however, are overwhelmed when faced with similar challenges. While the former may be capable of solving the mystery of their own destiny, the latter must be led like a flock of sheep and taught in simple language. They depend almost entirely on the guidance of a leader <note>original: "ministrations of the shepherd"</note>. The Apostle Paul said that these "little ones" must be fed with milk, but that solid food <note>original: "meat"</note> is the food of the mature <note>original: "strong men"</note>. Thoughtlessness is nearly synonymous with childishness, while thoughtfulness represents maturity.\n\nHowever, there are only a few mature minds in the world. Consequently, the philosophical and religious doctrines of the ancient world <note>original: "pagans"</note> were divided to meet the needs of these two basic groups of human intellect: one group was philosophical, while the other was unable to appreciate the deeper mysteries of life.' },
};
const HALL_OCR_WORDS = 'WHEN confronted with a problem involving the use of the reasoning faculties';
const HALL_REWORDING = 'When faced with a problem that requires the use of reason';

const CONTROVERSY_BOOK = { id: '69c8714b6c6f3cc53c857537', language: 'English', translation_state: { english_original: true } };
const CONTROVERSY_P31 = {
  id: 'controversy-p31', book_id: CONTROVERSY_BOOK.id, page_number: 31,
  ocr: { data: '<language>en</language>\n<script>mixed</script>\n<page-type>text</page-type>\n<page-num>25</page-num>\n<header>Desire of Nations</header>\n<warning>Handwritten header "Desire of Nations" at top right.</warning>\n<vocab>Scriptures, Hann, prophets, wisdom, understanding, Bible</vocab>\n\nwhere the hearts are not hardened in sin, so that they have no desire of the knowledge of my ways, or to be delivered from the power of evil. Such there are amongst mankind, that will stand out to the end, and be cut off, having no desire to be convinced; but where the hearts are good in men, <insert>when they see the truth come on brighter and brighter, like the noon-day sun, they will have a desire to know whether I the Lord have spoken by thee.</insert>' },
  translation: { data: '# Desire of Nations\n\nwhere the hearts are not hardened in sin, so that they have no desire for the knowledge of my ways or to be delivered from the power of evil. There are such people among mankind who will resist to the end and be cut off, having no desire to be convinced. But where the hearts of men are good, <insert>when they see the truth come on brighter and brighter, like the noon-day sun, they will have a desire to know whether I, the Lord, have spoken through you.</insert>' },
};

const LOEB_BOOK = { id: '69af2362285bd7360437434a', language: 'English', translation_state: { english_original: true } };
const LOEB_P276 = {
  id: 'loeb-p276', book_id: LOEB_BOOK.id, page_number: 276,
  ocr: { data: '<language>Latin</language>\n<script>printed</script>\n<page-type>text</page-type>\n<page-num>240</page-num>\n<header>THE LIVES OF THE CAESARS, BOOK II</header>\n\nLXXV. Festos et sollemnes dies profusissime, nonnumquam tantum ioculariter celebrabat. Saturnalibus, et si quando alias libuisset, modo munera dividebat, vestem et aurum et argentum, modo nummos omnis notae, etiam veteres regios ac peregrinos, interdum nihil praeter cilicia et spongias et rutabula et forpices atque alia id genus titulis obscuris et ambiguis.' },
  translation: { data: '<header>THE LIVES OF THE CAESARS, BOOK II</header>\n\nLXXV. He celebrated festivals and holidays most lavishly, though sometimes he would observe them only in a spirit of play. During the Saturnalia, and whenever else he felt inclined, he would distribute gifts—sometimes clothing, gold, and silver, and sometimes coins of every currency, including old regal and foreign money. Occasionally, he would give nothing but haircloth, sponges, pokers, tongs, and other things of that sort, labeled with obscure and ambiguous clues.' },
};

// ── A minimal in-memory Mongo, enough for the routes below ──────────────
type Doc = Record<string, unknown>;
const store: Record<string, Doc[]> = { books: [], pages: [] };
function get(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), doc);
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    const v = k === '_id' ? doc.id : get(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Doc;
      if ('$in' in c) return (c.$in as unknown[]).map(String).includes(String(v));
      if ('$gte' in c || '$lte' in c || '$gt' in c || '$lt' in c || '$exists' in c || '$nin' in c || '$ne' in c) return true;
      return String(v) === String(cond);
    }
    return v === cond || String(v) === String(cond);
  });
}
function cursor(docs: Doc[]) {
  const c = {
    project: () => c, sort: () => c, limit: () => c, skip: () => c, maxTimeMS: () => c,
    toArray: async () => docs.map((d) => structuredClone(d)),
  };
  return c;
}
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (filter: Doc) => {
      const d = (store[name] || []).find((x) => matches(x, filter));
      return d ? structuredClone(d) : null;
    },
    find: (filter: Doc = {}) => cursor((store[name] || []).filter((x) => matches(x, filter))),
    aggregate: () => cursor([]),
    countDocuments: async () => 0,
    updateOne: async () => ({}),
    insertOne: async () => ({}),
  }),
};

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => fakeDb,
  getReadDb: async () => fakeDb,
  default: Promise.resolve({ db: () => fakeDb }),
}));

// Signed-out, untrusted-but-not-bot caller: the routes' auth layers resolve to "anonymous".
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/auth-helpers', () => ({
  withAuth: (h: unknown) => h, withAdminAuth: (h: unknown) => h,
  isInnerCircle: async () => false, getSessionRole: async () => null,
}));

beforeEach(() => {
  store.books = [HALL_BOOK, CONTROVERSY_BOOK, LOEB_BOOK] as unknown as Doc[];
  store.pages = [HALL_P40, CONTROVERSY_P31, LOEB_P276] as unknown as Doc[];
});

const stripMarks = (s: unknown) => String(s ?? '').replace(/[​-‏⁠-⁤﻿]/g, '');

describe('serveEnglishOriginalPage — the reader payload, /book/[id]/read, text-only works', () => {
  it('withholds the stored rewording on an English edition\'s English leaf, and offers no modernized view for a rewrite', async () => {
    const { serveEnglishOriginalPage } = await import('@/lib/english-original-text');
    const served = serveEnglishOriginalPage(HALL_P40, HALL_BOOK);
    expect(served.translation).toBeUndefined();
    expect(served.ocr?.data).toContain(HALL_OCR_WORDS);
    expect(served.modernized_spelling).toBeUndefined();
    expect(JSON.stringify(served)).not.toContain(HALL_REWORDING);
    // Non-mutating: the stored document is untouched.
    expect(HALL_P40.translation.data).toContain(HALL_REWORDING);
  });

  it('offers a light spelling edit as modernized_spelling, never as translation', async () => {
    const { serveEnglishOriginalPage, wordBigramOverlap, MODERNIZED_SPELLING_MIN_OVERLAP } = await import('@/lib/english-original-text');
    expect(wordBigramOverlap(CONTROVERSY_P31.translation.data, CONTROVERSY_P31.ocr.data)!).toBeGreaterThanOrEqual(MODERNIZED_SPELLING_MIN_OVERLAP);
    expect(wordBigramOverlap(HALL_P40.translation.data, HALL_P40.ocr.data)!).toBeLessThan(MODERNIZED_SPELLING_MIN_OVERLAP);
    const served = serveEnglishOriginalPage(CONTROVERSY_P31, CONTROVERSY_BOOK);
    expect(served.translation).toBeUndefined();
    expect(served.modernized_spelling?.data).toBe(CONTROVERSY_P31.translation.data);
    expect(serveEnglishOriginalPage(CONTROVERSY_P31, CONTROVERSY_BOOK, { modernized: false }).modernized_spelling).toBeUndefined();
  });

  it('keeps the real translation of a foreign leaf in a bilingual English edition, and of a non-English book', async () => {
    const { serveEnglishOriginalPage } = await import('@/lib/english-original-text');
    expect(serveEnglishOriginalPage(LOEB_P276, LOEB_BOOK)).toBe(LOEB_P276);
    expect(serveEnglishOriginalPage(HALL_P40, { language: 'Latin', translation_state: { english_original: false } })).toBe(HALL_P40);
  });

  it('falls back to books.language when the book is unstamped', async () => {
    const { serveEnglishOriginalPage } = await import('@/lib/english-original-text');
    expect(serveEnglishOriginalPage(HALL_P40, { language: 'English' }).translation).toBeUndefined();
  });
});

describe('/api/pages/[id] and /api/pages/batch — reader page turns', () => {
  it('GET /api/pages/[id] serves the OCR and no translation', async () => {
    const { GET } = await import('@/app/api/pages/[id]/route');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/api/pages/${HALL_P40.id}`), { params: Promise.resolve({ id: HALL_P40.id }) });
    const body = await res.json();
    expect(body.ocr.data).toContain(HALL_OCR_WORDS);
    expect(body.translation).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(HALL_REWORDING);
  });

  it('POST /api/pages/batch serves the OCR on English leaves and keeps the Loeb translation', async () => {
    const { POST } = await import('@/app/api/pages/batch/route');
    const res = await POST(new NextRequest('https://sourcelibrary.org/api/pages/batch', {
      method: 'POST', body: JSON.stringify({ ids: [HALL_P40.id, CONTROVERSY_P31.id, LOEB_P276.id] }),
    }));
    const { pages } = await res.json() as { pages: Array<Doc & { translation?: { data: string }; modernized_spelling?: { data: string } }> };
    const by = new Map(pages.map((p) => [p.id, p]));
    expect(by.get(HALL_P40.id)?.translation).toBeUndefined();
    expect(by.get(CONTROVERSY_P31.id)?.translation).toBeUndefined();
    expect(by.get(CONTROVERSY_P31.id)?.modernized_spelling?.data).toBeTruthy();
    expect(stripMarks(by.get(LOEB_P276.id)?.translation?.data)).toContain('He celebrated festivals');
  });
});

describe('quote — /api/books/[id]/quote and the Librarian (resolveQuoteText)', () => {
  it('quotes the transcription as ocr_original, never the rewording', async () => {
    const { resolveQuoteText } = await import('@/lib/quote-text');
    const q = resolveQuoteText(HALL_P40 as never, HALL_BOOK.id, 'en', { book: HALL_BOOK, mark: false });
    expect(q?.source).toBe('ocr_original');
    expect(q?.text).toContain(HALL_OCR_WORDS);
    expect(q?.text).not.toContain(HALL_REWORDING);
    // A light edit is not quotable either.
    const c = resolveQuoteText(CONTROVERSY_P31 as never, CONTROVERSY_BOOK.id, 'en', { book: CONTROVERSY_BOOK, mark: false });
    expect(c?.source).toBe('ocr_original');
    expect(c?.text).toContain('desire of the knowledge');
    // The bilingual Latin leaf keeps its translation.
    expect(resolveQuoteText(LOEB_P276 as never, LOEB_BOOK.id, 'en', { book: LOEB_BOOK, mark: false })?.source).toBe('translation');
  });

  it('GET /api/books/[id]/quote serves the transcription in `original`', async () => {
    const { GET } = await import('@/app/api/books/[id]/quote/route');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${HALL_BOOK.id}/quote?page=40&include_context=true`), { params: Promise.resolve({ id: HALL_BOOK.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.quote.text_source).toBe('ocr_original');
    expect(stripMarks(body.quote.original)).toContain(HALL_OCR_WORDS);
    expect(body.quote.translation).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(HALL_REWORDING);
  });
});

describe('/api/books/[id]/text — get_book_text', () => {
  it('serves the OCR and no translation, and says why', async () => {
    const { GET } = await import('@/app/api/books/[id]/text/route');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${HALL_BOOK.id}/text`), { params: Promise.resolve({ id: HALL_BOOK.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.english_edition_note).toBeTruthy();
    const p40 = body.pages.find((p: Doc) => p.page_number === 40);
    expect(stripMarks(p40.ocr)).toContain(HALL_OCR_WORDS);
    expect(p40.translation).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(HALL_REWORDING);
  });

  it('content=translation does not hand back the rewording', async () => {
    const { GET } = await import('@/app/api/books/[id]/text/route');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${HALL_BOOK.id}/text?content=translation&format=plain`), { params: Promise.resolve({ id: HALL_BOOK.id }) });
    expect(stripMarks(await res.text())).not.toContain(HALL_REWORDING);
  });
});

describe('exports and the embedding snippet (scripts-side twin)', () => {
  it('the download filter and the TS/MJS twins agree on every fixture', async () => {
    const ts = await import('@/lib/english-original-text');
    const tsPage = await import('@/lib/english-page-language');
    const mjs = await import('../../scripts/lib/english-original-text.mjs');
    for (const [page, book, want] of [
      [HALL_P40, HALL_BOOK, true], [CONTROVERSY_P31, CONTROVERSY_BOOK, true], [LOEB_P276, LOEB_BOOK, false],
      [HALL_P40, { language: 'English' }, true], [HALL_P40, { language: 'Latin' }, false],
    ] as const) {
      expect(ts.servesTranscriptionInsteadOfTranslation(page, book)).toBe(want);
      expect(mjs.servesTranscriptionInsteadOfTranslation(page, book)).toBe(want);
      expect(mjs.isEnglishOriginalPage(page.ocr.data)).toBe(tsPage.isEnglishOriginalPage(page.ocr.data));
    }
    // The book-level first-language test, restated scripts-side, matches page-counts.mjs.
    const counts = await import('../../scripts/lib/page-counts.mjs');
    for (const l of ['English', 'english; Latin', 'Latin; English', 'English and Hebrew', 'en', 'Eng (modernized)', 'German', '', null]) {
      expect(mjs.isEnglishEdition(l)).toBe(counts.isEnglishOriginal(l));
    }
    // A mixed declaration defers to frequency on both sides.
    const mixed = HALL_P40.ocr.data.replace('<language>English</language>', '<language>English, Latin</language>');
    expect(mjs.isEnglishOriginalPage(mixed)).toBe(tsPage.isEnglishOriginalPage(mixed));
  });

  it('pageEmbeddingInput embeds the OCR with an empty translation column', async () => {
    const { pageEmbeddingInput, workerEmbeddingInput } = await import('../../scripts/lib/page-embedding-text.mjs');
    for (const fn of [pageEmbeddingInput, workerEmbeddingInput]) {
      const input = fn(HALL_P40, { book: HALL_BOOK });
      expect(input?.hasTranslation).toBe(false);
      expect(input?.text).toContain(HALL_OCR_WORDS);
      expect(input?.text).not.toContain(HALL_REWORDING);
      expect(fn(LOEB_P276, { book: LOEB_BOOK })?.hasTranslation).toBe(true);
    }
  });
});
