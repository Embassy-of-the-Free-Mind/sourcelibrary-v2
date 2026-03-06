import { MongoClient } from 'mongodb';

const TRANSLITERATION_MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 20;
const SOURCE_SCRIPT = 'Greek';

const TRANSLITERATION_PROMPT_BASE = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input. Do not merge or split lines.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. Remove all XML/markup tags (<note>, <term>, <margin>, <page-type>, <columns>, <language>, <detected-images>, etc.) from the output.
4. Include standard scholarly diacritics (macrons for long vowels, dots for emphatics, etc.).
5. Do not translate — only transliterate. The output should be a phonetic representation in Latin script, not a translation.
6. If the text contains passages in Latin script already (e.g. Latin in a Greek manuscript), preserve them as-is.

Romanization conventions:
- Greek: Standard scholarly. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, ι→i, κ→k, λ→l, μ→m, ν→n, ξ→x, ο→o, π→p, ρ→r, σ/ς→s, τ→t, υ→y, φ→ph, χ→ch, ψ→ps, ω→ō.`;

// Remaining 6 books that had OK ratios but were done with flash-lite
const BOOK_IDS = [
  '6953a93977f38f6761bd58f4', // Hermetica Vol. I (just redone with flash-lite)
  '6952e4cc77f38f6761bc8c0b', // Novum Testamentum Graece
  '695311a477f38f6761bcc8b8', // Codex Alexandrinus
  '6952c9ca77f38f6761bc3062', // Plotini Enneades
  '69938fa45d28b693146d14dd', // Genesis Fragment
  '696925034fa3b04c6de86f6b', // Pluteus 71.33 Corpus Hermeticum
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

function stripLatexArtifacts(text) {
  return text
    .replace(/\$\^{[^}]*}\$/g, '')
    .replace(/\$\^([a-zA-Z0-9])\$/g, '')
    .replace(/\$\^{[^}]*}/g, '')
    .replace(/\$\\[a-z]+{[^}]*}\$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function transliteratePage(db, page) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLITERATION_MODEL}:generateContent?key=${apiKey}`;
  const cleanedOcr = stripLatexArtifacts(page.ocr.data);

  let prompt = TRANSLITERATION_PROMPT_BASE;
  if (cleanedOcr.includes('<column-break/>')) {
    prompt += `\n\nIMPORTANT: The text contains a <column-break/> tag marking a column boundary. PRESERVE it exactly where it appears.`;
  }
  prompt += `\n\nThe source script is: **${SOURCE_SCRIPT}**\n\n**Text to transliterate:**\n${cleanedOcr}`;

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
        'transliteration.script': SOURCE_SCRIPT,
        updated_at: new Date(),
      },
    }
  );

  const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.60;
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
    endpoint: 'retransliterate-flash-upgrade',
    timestamp: new Date(),
  }).catch(() => {});

  return { inputTokens, outputTokens, costUsd };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const SKIP_TYPES = ['blank', 'illustration', 'map', 'frontispiece', 'diagram'];
  const summary = [];

  for (const bookId of BOOK_IDS) {
    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { id: 1, title: 1, slug: 1 } }
    );
    if (!book) { console.log(`Book ${bookId}: not found`); continue; }

    // Get pages transliterated with flash-lite
    const pages = await db.collection('pages').find({
      book_id: bookId,
      'ocr.data': { $exists: true, $nin: [null, ''] },
      page_type: { $nin: SKIP_TYPES },
      'transliteration.model': 'gemini-3.1-flash-lite-preview',
    }).sort({ page_number: 1 })
      .project({ id: 1, book_id: 1, page_number: 1, ocr: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`\n${(book.title || '').substring(0, 55)}: no flash-lite pages to redo`);
      continue;
    }

    const label = (book.title || '').substring(0, 55);
    console.log(`\n=== ${label} ===`);
    console.log(`Pages to re-transliterate: ${pages.length}`);

    let done = 0, errors = 0, totalCost = 0;

    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const chunk = pages.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(page => transliteratePage(db, page))
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          done++;
          totalCost += r.value.costUsd;
        } else if (r.status === 'rejected') {
          errors++;
          const msg = r.reason?.message || '';
          if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
            console.log('  Rate limited — waiting 30s...');
            await sleep(30000);
          }
        }
      }

      if (i % 100 === 0 || i + CONCURRENCY >= pages.length) {
        console.log(`  Progress: ${done}/${pages.length} ($${totalCost.toFixed(4)})`);
      }
    }

    console.log(`  Done: ${done} ok, ${errors} errors, $${totalCost.toFixed(4)}`);
    summary.push({ title: label, slug: book.slug, pages: done, errors, cost: totalCost });
  }

  console.log('\n\n=== SUMMARY ===');
  let grandTotal = 0;
  for (const s of summary) {
    console.log(`${s.title} — ${s.pages} pages, $${s.cost.toFixed(4)}`);
    console.log(`  https://sourcelibrary.org/book/${s.slug}`);
    grandTotal += s.cost;
  }
  console.log(`\nTotal cost: $${grandTotal.toFixed(4)}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
