#!/usr/bin/env node
// Translate 5 Rithmomachia books directly via Gemini API (bypasses SQS queue)
// Usage: set -a; source .env.production.local; set +a; node scripts/translate-rithmomachia.cjs

const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TIMEOUT_MS = 90_000;

const client = new MongoClient(process.env.MONGODB_URI);
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-3-flash-preview' });

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
  ]);
}

async function translatePage(promptText, ocrText, lang, prevTrans, isEng) {
  let prompt = promptText
    .replaceAll('{source_language}', lang)
    .replaceAll('{sourceLanguage}', lang)
    .replaceAll('{target_language}', 'English')
    .replaceAll('{targetLanguage}', 'English')
    .replaceAll('{language}', lang);

  prompt += isEng
    ? `\n\n**Text to modernize:**\n${ocrText}`
    : `\n\n**Text to translate:**\n${ocrText}`;

  if (prevTrans) {
    prompt += isEng
      ? `\n\n**Previous page (modernized) for continuity:**\n${prevTrans.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${prevTrans.slice(0, 2000)}...`;
  }

  const result = await withTimeout(model.generateContent(prompt), TIMEOUT_MS);
  const u = result.response.usageMetadata;
  return {
    text: result.response.text(),
    inp: u?.promptTokenCount || 0,
    out: u?.candidatesTokenCount || 0,
  };
}

async function run() {
  await client.connect();
  const db = client.db('bookstore');

  const stdPrompt = await db.collection('prompts').findOne({ type: 'translation', is_default: true });
  console.log(`Translation prompt: ${stdPrompt?.name} (${stdPrompt?.content?.length} chars)`);

  const ENGLISH_MOD = `You are modernizing Early Modern English text into clear, accessible Modern English.

**Context:** This is a historical text (1500s-1700s) written in Early Modern English. The OCR transcription preserves the original spelling, vocabulary, and syntax. Your job is to make it readable for a modern audience while preserving the author's meaning and the document's formatting.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them with modern text
- Centered text (->text<-)
- Line breaks and paragraph structure

**What to modernize:**
1. **Spelling** — normalize archaic spelling ("hee" → "he", "doe" → "do", "betweene" → "between")
2. **Vocabulary** — replace obsolete words with modern equivalents. Use <note>original: "..."</note> for significant archaic terms
3. **Sentence structure** — break up very long periodic sentences while preserving meaning
4. **Punctuation** — modernize capitalization, punctuation, and emphasis
5. **Grammar** — update archaic forms ("hath" → "has", "doth" → "does", "thou art" → "you are")

**What to keep:**
- All substantive content (don't summarize or skip anything)
- Key names, titles, and proper nouns
- The author's arguments, reasoning, and rhetorical structure

**IMPORTANT - Translate ALL embedded foreign languages to English:**
Latin, Greek, Hebrew phrases → translate to English with <note>original: "..."</note>

END with <summary>...</summary> and <keywords>...</keywords> for indexing.`;

  const books = [
    { id: '699fcd369ff0f1d2c4517fbb', name: 'Barozzi', lang: 'Italian' },
    { id: '699fcd429ff0f1d2c4517fff', name: 'Lever & Fulke', lang: 'English' },
    { id: '699fcd509ff0f1d2c4518280', name: 'Boissiere', lang: 'French' },
    { id: '699fcdd19ff0f1d2c45182ec', name: 'Jordanus', lang: 'Latin' },
    { id: '699fcd499ff0f1d2c4518062', name: 'Selenus', lang: 'German' },
  ];

  let grandTotal = 0;

  for (const book of books) {
    const isEng = book.lang.toLowerCase() === 'english';
    const promptText = isEng ? ENGLISH_MOD : stdPrompt.content;

    const pages = await db.collection('pages')
      .find({ book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } })
      .sort({ page_number: 1 })
      .toArray();

    console.log(`\n=== ${book.name} (${book.lang}) — ${pages.length} pages ===`);

    let prev = null;
    let done = 0;
    let skipped = 0;
    let errors = 0;
    let cost = 0;

    for (const page of pages) {
      // Skip already translated
      if (page.translation?.data?.length > 10) {
        prev = page.translation.data;
        skipped++;
        done++;
        continue;
      }

      try {
        const r = await translatePage(promptText, page.ocr.data, book.lang, prev, isEng);
        const c = (r.inp * 0.5 + r.out * 3.0) / 1_000_000;
        cost += c;

        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              'translation.data': r.text,
              'translation.model': 'gemini-3-flash-preview',
              'translation.language': isEng ? 'Modern English' : 'English',
              'translation.source': 'ai',
              'translation.updated_at': new Date(),
            },
          }
        );

        await db.collection('gemini_usage').insertOne({
          type: 'translation',
          book_id: book.id,
          page_ids: [page.id],
          model: 'gemini-3-flash-preview',
          input_tokens: r.inp,
          output_tokens: r.out,
          total_tokens: r.inp + r.out,
          cost_usd: c,
          status: 'success',
          timestamp: new Date(),
        });

        prev = r.text;
        done++;

        if (done % 5 === 0 || done === pages.length) {
          console.log(`  ${done}/${pages.length} ($${cost.toFixed(3)})`);
        }
      } catch (err) {
        console.error(`  ERR p${page.page_number}: ${(err.message || '').substring(0, 120)}`);
        errors++;
        done++;
        // Don't break context chain — keep prev as-is
      }
    }

    grandTotal += cost;
    console.log(`  DONE ${done}/${pages.length} (${skipped} skipped, ${errors} errors) — $${cost.toFixed(3)}`);
  }

  console.log(`\nGrand total: $${grandTotal.toFixed(3)}`);
  await client.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
