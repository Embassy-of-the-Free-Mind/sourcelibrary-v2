import { MongoClient } from 'mongodb';

const TRANSLITERATION_MODEL = 'gemini-3.1-flash-lite-preview';
const TRANSLITERATION_PROMPT = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. PRESERVE the <column-break/> tag exactly where it appears.
4. Remove all OTHER XML/markup tags from the output.
5. Include standard scholarly diacritics.
6. Do not translate — only transliterate.
7. If the text contains passages in Latin script already, preserve them as-is.

Romanization conventions by script:
- Greek: Standard scholarly. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, etc.
- Hebrew: SBL academic style.
- Arabic: DIN 31635 / Library of Congress.
- Syriac: Standard Semiticist conventions.
- Armenian: Library of Congress romanization.
- Chinese: Pinyin with tone marks.
- Japanese: Modified Hepburn.
- Korean: Revised Romanization.
- Sanskrit/Devanagari: IAST.`;

function languageToScript(language) {
  if (!language) return 'Unknown';
  const map = {
    'greek': 'Greek', 'hebrew': 'Hebrew', 'arabic': 'Arabic',
    'persian': 'Arabic (Persian)', 'ottoman turkish': 'Arabic (Ottoman Turkish)',
    'syriac': 'Syriac', 'chinese': 'Chinese', 'japanese': 'Japanese',
    'korean': 'Korean', 'sanskrit': 'Sanskrit/Devanagari', 'armenian': 'Armenian',
    'georgian': 'Georgian', 'ethiopic': 'Ethiopic', 'coptic': 'Coptic',
    'tibetan': 'Tibetan', 'russian': 'Cyrillic', 'church slavonic': 'Cyrillic',
  };
  return map[language.toLowerCase()] || language;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

async function transliteratePage(db, page, sourceScript) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLITERATION_MODEL}:generateContent?key=${apiKey}`;
  const prompt = `${TRANSLITERATION_PROMPT}\n\nThe source script is: **${sourceScript}**\n\n**Text to transliterate:**\n${page.ocr.data}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;

  if (!text) return null;

  const ocrHash = hashString(page.ocr.data);
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'transliteration.data': text,
        'transliteration.model': TRANSLITERATION_MODEL,
        'transliteration.updated_at': new Date(),
        'transliteration.source_ocr_hash': ocrHash,
        'transliteration.script': sourceScript,
        updated_at: new Date(),
      },
    }
  );

  const costUsd = (inputTokens / 1_000_000) * 0.10 + (outputTokens / 1_000_000) * 0.40;
  db.collection('gemini_usage').insertOne({
    type: 'transliterate',
    mode: 'realtime',
    model: TRANSLITERATION_MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    status: 'success',
    endpoint: 'sample-transliteration',
    timestamp: new Date(),
  }).catch(() => {});

  return { text, inputTokens, outputTokens, costUsd };
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const LANGUAGES = ['Greek', 'Hebrew', 'Arabic', 'Persian', 'Syriac', 'Chinese',
    'Japanese', 'Sanskrit', 'Armenian', 'Coptic', 'Ethiopic', 'Tibetan', 'Russian'];

  const SKIP_TYPES = ['blank', 'illustration', 'map', 'frontispiece', 'diagram'];
  const results = [];

  for (const lang of LANGUAGES) {
    // Find a book with good OCR — prefer completed books with most reads
    const book = await db.collection('books').findOne(
      {
        language: { $regex: new RegExp('^' + lang + '$', 'i') },
        'pipeline_auto.status': { $in: ['complete', 'chapters_complete', 'translate_complete', 'enriched', 'translate_submitted', 'metadata_enriched', 'ocr_complete', 'ocr_submitted'] },
      },
      { sort: { read_count: -1 }, projection: { id: 1, title: 1, language: 1, slug: 1, 'pipeline_auto.status': 1 } }
    );

    if (!book) {
      console.log(`${lang}: no eligible book found`);
      continue;
    }

    // Find a content page with OCR (skip first few pages which are often title pages)
    const page = await db.collection('pages').findOne(
      {
        book_id: book.id,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_TYPES },
        page_number: { $gte: 5 },  // Skip early pages (title, TOC)
      },
      { sort: { page_number: 1 }, projection: { id: 1, book_id: 1, page_number: 1, ocr: 1 } }
    );

    if (!page) {
      console.log(`${lang}: no OCR page found for ${book.title}`);
      continue;
    }

    const sourceScript = languageToScript(book.language);
    console.log(`\n=== ${lang} (${sourceScript}) ===`);
    console.log(`Book: ${book.title}`);
    console.log(`Page: ${page.page_number}`);
    console.log(`OCR preview: ${page.ocr.data.substring(0, 150)}...`);

    try {
      const result = await transliteratePage(db, page, sourceScript);
      if (result) {
        console.log(`Transliteration preview: ${result.text.substring(0, 150)}...`);
        console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out ($${result.costUsd.toFixed(4)})`);
        const slug = book.slug || book.id;
        console.log(`Review: https://sourcelibrary.org/book/${slug}?page=${page.page_number}`);
        results.push({ lang, book: book.title, page: page.page_number, slug, cost: result.costUsd });
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log('\n\n=== REVIEW LINKS ===');
  for (const r of results) {
    console.log(`${r.lang}: https://sourcelibrary.org/book/${r.slug}?page=${r.page}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
