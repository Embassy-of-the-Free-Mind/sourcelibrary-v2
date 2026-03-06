import { MongoClient } from 'mongodb';

const TRANSLITERATION_MODEL = 'gemini-3.1-flash-lite-preview';
const CONCURRENCY = 30;

const TRANSLITERATION_PROMPT = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. PRESERVE the <column-break/> tag exactly where it appears.
4. Remove all OTHER XML/markup tags from the output.
5. Remove any LaTeX-style notation (e.g. $^{19}$, $^k$, superscript markers) — these are editorial artifacts, not part of the original text.
6. Include standard scholarly diacritics.
7. Do not translate — only transliterate.
8. If the text contains passages in Latin script already (actual words, not markup), preserve them as-is.

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

// Strip LaTeX-style editorial markup from OCR text before transliteration
function stripLatexArtifacts(text) {
  // Remove $^{N}$ patterns (verse numbers), $^k$ patterns (footnote markers)
  return text
    .replace(/\$\^{[^}]*}\$/g, '')    // $^{19}$, $^{abc}$
    .replace(/\$\^([a-zA-Z0-9])\$/g, '')  // $^k$, $^l$, $^m$
    .replace(/\$\^{[^}]*}/g, '')       // $^{19} without closing $
    .replace(/\$\\[a-z]+{[^}]*}\$/g, '') // $\textbf{...}$ etc
    .replace(/\s{2,}/g, ' ')           // collapse multiple spaces left behind
    .trim();
}

// Check if OCR text is actually in a non-Latin script (not just English/Latin intro pages)
function hasNonLatinContent(ocrText) {
  // Strip XML tags
  const clean = ocrText.replace(/<[^>]+>/g, '').trim();
  if (clean.length < 20) return false;

  // Count non-ASCII characters (proxy for non-Latin script)
  let nonAscii = 0;
  let total = 0;
  for (const ch of clean) {
    if (ch.trim()) {
      total++;
      if (ch.charCodeAt(0) > 127) nonAscii++;
    }
  }
  // At least 20% non-ASCII means there's real non-Latin content
  return total > 0 && (nonAscii / total) > 0.20;
}

async function transliteratePage(db, page, sourceScript) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLITERATION_MODEL}:generateContent?key=${apiKey}`;
  const cleanedOcr = stripLatexArtifacts(page.ocr.data);
  const prompt = `${TRANSLITERATION_PROMPT}\n\nThe source script is: **${sourceScript}**\n\n**Text to transliterate:**\n${cleanedOcr}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
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
  clearTimeout(timeout);

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
    endpoint: 'sample-full-book-transliteration',
    timestamp: new Date(),
  }).catch(() => {});

  return { text, inputTokens, outputTokens, costUsd };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const LANGUAGES = ['Greek', 'Hebrew', 'Arabic', 'Persian', 'Syriac', 'Chinese',
    'Japanese', 'Sanskrit', 'Armenian', 'Coptic', 'Ethiopic', 'Tibetan', 'Russian'];

  const SKIP_TYPES = ['blank', 'illustration', 'map', 'frontispiece', 'diagram'];
  const summary = [];

  for (const lang of LANGUAGES) {
    // Find books with OCR, prefer completed/furthest-along with most reads
    const candidates = await db.collection('books')
      .find({
        language: { $regex: new RegExp('^' + lang + '$', 'i') },
        'pipeline_auto.status': { $in: ['complete', 'chapters_complete', 'translate_complete', 'enriched', 'translate_submitted', 'metadata_enriched', 'ocr_complete', 'ocr_submitted'] },
      })
      .sort({ read_count: -1 })
      .project({ id: 1, title: 1, language: 1, slug: 1 })
      .limit(5)
      .toArray();

    if (candidates.length === 0) {
      console.log(`\n${lang}: no eligible books`);
      continue;
    }

    // Pick the first book that has substantial non-Latin OCR content
    let chosen = null;
    for (const book of candidates) {
      // Sample a few pages to check if content is actually in the target script
      const samplePages = await db.collection('pages')
        .find({
          book_id: book.id,
          'ocr.data': { $exists: true, $nin: [null, ''] },
          page_type: { $nin: SKIP_TYPES },
          page_number: { $gte: 10 },  // Skip front matter
        })
        .sort({ page_number: 1 })
        .project({ 'ocr.data': 1 })
        .limit(3)
        .toArray();

      const nonLatinPages = samplePages.filter(p => hasNonLatinContent(p.ocr.data));
      if (nonLatinPages.length >= 2) {
        chosen = book;
        break;
      }
    }

    if (!chosen) {
      console.log(`\n${lang}: no book with substantial ${lang} content found (all candidates were mostly Latin/English)`);
      continue;
    }

    // Get all pages needing transliteration
    const pages = await db.collection('pages')
      .find({
        book_id: chosen.id,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_TYPES },
        $or: [
          { 'transliteration.data': { $exists: false } },
          { 'transliteration.data': null },
          { 'transliteration.data': '' },
        ],
      })
      .sort({ page_number: 1 })
      .project({ id: 1, book_id: 1, page_number: 1, ocr: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`\n${lang}: ${chosen.title} — already fully transliterated`);
      continue;
    }

    const sourceScript = languageToScript(chosen.language);
    const label = (chosen.title || '').substring(0, 55);
    const slug = chosen.slug || chosen.id;

    console.log(`\n=== ${lang} (${sourceScript}) ===`);
    console.log(`Book: ${label}`);
    console.log(`Pages to transliterate: ${pages.length}`);
    console.log(`URL: https://sourcelibrary.org/book/${slug}`);

    let pagesDone = 0;
    let pagesErr = 0;
    let totalCost = 0;

    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const chunk = pages.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(page => transliteratePage(db, page, sourceScript))
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          pagesDone++;
          totalCost += r.value.costUsd;
        } else if (r.status === 'rejected') {
          pagesErr++;
          const msg = r.reason?.message || '';
          console.log(`  Error: ${msg.substring(0, 120)}`);
          if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
            console.log('  Rate limited — waiting 30s...');
            await sleep(30000);
          }
        }
      }

      if ((i + CONCURRENCY) % 20 === 0 || i + CONCURRENCY >= pages.length) {
        console.log(`  Progress: ${pagesDone}/${pages.length} ($${totalCost.toFixed(4)})`);
      }
    }

    console.log(`  Done: ${pagesDone} ok, ${pagesErr} errors, $${totalCost.toFixed(4)}`);
    summary.push({ lang, title: label, slug, pages: pagesDone, errors: pagesErr, cost: totalCost });
  }

  console.log('\n\n=== SUMMARY ===');
  let grandTotal = 0;
  for (const s of summary) {
    console.log(`${s.lang}: ${s.title} — ${s.pages} pages, $${s.cost.toFixed(4)}`);
    console.log(`  https://sourcelibrary.org/book/${s.slug}`);
    grandTotal += s.cost;
  }
  console.log(`\nTotal cost: $${grandTotal.toFixed(4)}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
