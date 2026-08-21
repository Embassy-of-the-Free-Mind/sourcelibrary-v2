/**
 * The ONE composer for page-level embedding text and rows.
 *
 * ## Why this is its own module
 *
 * `scripts/lib/book-embedding-text.mjs` exists because the book-level composer
 * was copy-pasted into three places and all three carried the same two
 * field-name bugs — silently, because a wrong field name yields well-formed text
 * that says nothing. 14,237 Supabase rows ended up containing the literal line
 * `People: , , , ,`. The repo's rule since then: import the composer, never
 * re-type it.
 *
 * Page embeddings are about to gain a SECOND writer. Until 2026-08-07 the only
 * one was `scripts/workers/embed-gemini.mjs` (a cron), and when that cron sat
 * commented out behind a `#PAUSED-GEMINI` marker from June 9, nothing noticed:
 * 2,462 live books ended up with zero page vectors and 4,420 more with under
 * 90%, so semantic search was blind on roughly 45% of the corpus while
 * reporting no error at all. Putting the writer INSIDE the enrichment pipeline
 * is the fix for that, and this module is what keeps the two writers producing
 * identical rows.
 *
 * If you change what text gets embedded here, existing rows keep whatever they
 * were written with — a composer change only takes effect on re-embed. Same
 * caveat as the book-level composer.
 */

import { stripEditorialWrappers } from './strip-editorial-wrappers.mjs';

export const EMBED_MODEL = 'gemini-embedding-2-preview';
export const EMBED_DIMS = 768;

/** Gemini embedding-2 supports 8192 tokens; 8000 chars is a safe floor. */
const MAX_CHARS = 8000;

/**
 * The text of one page, as it should be embedded.
 *
 * Editorial wrappers are dropped CONTENT AND ALL, not just unwrapped. They are
 * Gemini's "what this page is about" descriptions and they routinely name
 * content from ADJACENT pages — a page-89 `<meta>` mentioning the mercury wheel
 * that is actually on page 88. Embedding them mislocates the source and
 * produces citations to words that are not on the page. (Nirmal, 2026-05-30.)
 *
 * The wrapper list is the canonical one (strip-editorial-wrappers), not a
 * private subset: the old inline 4-tag copy here kept `<image-desc>` plate
 * descriptions, `<warning>` remarks and `<scan-quality>good` as embedded and
 * quotable text — the same misquote class, one layer down (#3820). Apparatus
 * tags (running headers, signatures, catchwords, printed page numbers) are
 * page furniture, not content, and are dropped too — same policy as the ngram
 * normalizer. Everything else (note/term/margin/gloss/…) is unwrapped:
 * content kept, tag removed.
 */
export function cleanPageText(text) {
  if (!text || typeof text !== 'string') return '';
  return stripEditorialWrappers(text)
    .replace(/<(header|catchword|sig|page-num)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

/**
 * Which text represents this page, and is it a translation?
 *
 * Falls back to OCR when there is no translation, so an untranslated original
 * still gets a work-specific vector — with an EMPTY translation column, so the
 * original-language text never leaks into a surface that promises English.
 */
export function pageEmbeddingInput(page) {
  const translation = cleanPageText(page?.translation?.data);
  if (translation) return { text: translation, hasTranslation: true };
  const ocr = cleanPageText(page?.ocr?.data);
  if (ocr) return { text: ocr, hasTranslation: false };
  return null;
}

/**
 * Build the `page_translations` row. Every column the table has, in one place,
 * so the two writers cannot disagree about the shape.
 */
export function buildPageEmbeddingRow({ page, book, text, hasTranslation, embedding }) {
  const mongoTs = page.translation?.updated_at || page.ocr?.updated_at || page.updated_at;
  return {
    page_id: page.id,
    book_id: page.book_id,
    page_number: page.page_number,
    // Only a real translation goes in this column — see pageEmbeddingInput.
    translation: (hasTranslation ? text : '').slice(0, 50000),
    embedding: JSON.stringify(embedding),
    book_title: book?.title ?? null,
    book_author: book?.author ?? null,
    book_language: book?.language ?? null,
    book_year: book?.year ?? null,
    updated_at: mongoTs || new Date(),
    embedding_model: EMBED_MODEL,
    // Freshness watermark of the Mongo source at embed time. `--restale`
    // compares it against current Mongo updated_at to catch drift — a re-OCR or
    // re-translation in Mongo that never got re-embedded.
    mongo_updated_at: mongoTs || null,
  };
}

/** Columns of `page_translations`, in the order the upsert statement uses. */
export const PAGE_EMBEDDING_COLUMNS = [
  'page_id', 'book_id', 'page_number', 'translation', 'embedding',
  'book_title', 'book_author', 'book_language', 'book_year',
  'updated_at', 'embedding_model', 'mongo_updated_at',
];

// ── The language-keyed store: page_texts (#4095) ─────────────────────
//
// `page_translations` above holds ONE translation per page — English, on the
// `translation` column. Every other language lives in `page_texts`, keyed
// `(page_id, lang)`, mirroring Mongo's `pages.translations.<iso>`. The row
// shape lives HERE, next to the English one, for the reason this whole module
// exists: two writers that each re-type the shape will drift, silently.

/**
 * The text of one page in ONE language, cleaned, or null if that language has
 * no translation for the page.
 *
 * Note there is NO OCR fallback, unlike `pageEmbeddingInput`. The English store
 * falls back to the original text so an untranslated page still gets a vector;
 * a language-keyed store must not, because a row in `lang = 'es'` is a promise
 * that the text IS Spanish. Falling back would put German or Latin into the
 * Spanish lane, where it would be retrieved for Spanish queries and quoted as
 * the Spanish edition. Absence is the honest answer.
 *
 * The legacy `pages.translation_es` field is folded in for `es`, matching
 * `src/lib/page-translations.ts` — the map wins when both are present.
 */
export function pageTextForLang(page, lang) {
  const src = page?.translations?.[lang]?.data
    ?? (lang === 'es' ? page?.translation_es?.data : null);
  const text = cleanPageText(src);
  return text ? { text } : null;
}

/** Build the `page_texts` row. Every column the table has, in one place. */
export function buildPageTextRow({ page, book, lang, text, embedding }) {
  const t = page?.translations?.[lang] ?? (lang === 'es' ? page?.translation_es : null);
  const mongoTs = t?.updated_at || page.updated_at;
  return {
    page_id: page.id,
    lang,
    book_id: page.book_id,
    page_number: page.page_number,
    text: text.slice(0, 50000),
    embedding: JSON.stringify(embedding),
    book_title: book?.title ?? null,
    book_author: book?.author ?? null,
    book_language: book?.language ?? null,
    book_year: book?.year ?? null,
    updated_at: mongoTs || new Date(),
    embedding_model: EMBED_MODEL,
    mongo_updated_at: mongoTs || null,
  };
}

/** Columns of `page_texts`, in the order the upsert statement uses. */
export const PAGE_TEXT_COLUMNS = [
  'page_id', 'lang', 'book_id', 'page_number', 'text', 'embedding',
  'book_title', 'book_author', 'book_language', 'book_year',
  'updated_at', 'embedding_model', 'mongo_updated_at',
];

/** The one upsert statement for `page_texts`. Positional args follow PAGE_TEXT_COLUMNS. */
export const PAGE_TEXT_UPSERT_SQL = `
  INSERT INTO page_texts (${PAGE_TEXT_COLUMNS.join(', ')})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (page_id, lang) DO UPDATE SET
    book_id = EXCLUDED.book_id,
    page_number = EXCLUDED.page_number,
    text = EXCLUDED.text,
    embedding = EXCLUDED.embedding,
    book_title = EXCLUDED.book_title,
    book_author = EXCLUDED.book_author,
    book_language = EXCLUDED.book_language,
    book_year = EXCLUDED.book_year,
    updated_at = EXCLUDED.updated_at,
    embedding_model = EXCLUDED.embedding_model,
    mongo_updated_at = EXCLUDED.mongo_updated_at`;

/** The values array for PAGE_TEXT_UPSERT_SQL, from a row built above. */
export function pageTextUpsertValues(row) {
  return PAGE_TEXT_COLUMNS.map((c) => row[c]);
}

/**
 * Embed a batch of texts. Retries on 429 with a growing backoff, because the
 * caller is usually a long-running loop that should slow down rather than die.
 */
export async function embedTexts(texts, apiKey, { signal } = {}) {
  if (!texts.length) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`;
  const body = JSON.stringify({
    requests: texts.map((t) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: t }] },
      outputDimensionality: EMBED_DIMS,
    })),
  });

  let backoff = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: signal ?? AbortSignal.timeout(30000),
    });
    if (res.status === 429) {
      backoff = Math.min(backoff + 5, 60);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings, got ${data.embeddings?.length || 0}`);
    }
    return data.embeddings.map((e) => e.values);
  }
  throw new Error('Gemini rate limit did not clear after 6 attempts');
}
