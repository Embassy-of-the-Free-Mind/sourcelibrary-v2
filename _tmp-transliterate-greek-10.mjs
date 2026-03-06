import { MongoClient } from 'mongodb';

const TRANSLITERATION_MODEL = 'gemini-3.1-flash-lite-preview';
const CONCURRENCY = 30;
const SOURCE_SCRIPT = 'Greek';

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

Romanization conventions:
- Greek: Standard scholarly. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, ι→i, κ→k, λ→l, μ→m, ν→n, ξ→x, ο→o, π→p, ρ→r, σ/ς→s, τ→t, υ→y, φ→ph, χ→ch, ψ→ps, ω→ō.`;

const BOOK_IDS = [
  '6952e4cc77f38f6761bc8c0b', // Novum Testamentum Graece (1002 pages)
  '695311a477f38f6761bcc8b8', // Codex Alexandrinus (1595 pages)
  '6952c9ca77f38f6761bc3062', // Plotini Enneades (860 pages)
  '6953a54c77f38f6761bcf531', // Philokalia (404 pages)
  '6953a91277f38f6761bd545d', // Ephraem Syri Opera Omnia (100 pages)
  '6953a93977f38f6761bd58f4', // Hermetica Vol. I (556 pages)
  '69938fa45d28b693146d14dd', // Genesis Fragment (92 pages)
  '6953a8b277f38f6761bd365c', // Codex Sinaiticus (295 pages)
  '696925034fa3b04c6de86f6b', // Pluteus 71.33 Corpus Hermeticum (450 pages)
  '6953cbb777f38f6761bdfc4d', // Codex Alexandrinus Facsimile (346 pages)
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

function hasNonLatinContent(ocrText) {
  const clean = ocrText.replace(/<[^>]+>/g, '').trim();
  if (clean.length < 20) return false;
  let nonAscii = 0, total = 0;
  for (const ch of clean) {
    if (ch.trim()) {
      total++;
      if (ch.charCodeAt(0) > 127) nonAscii++;
    }
  }
  return total > 0 && (nonAscii / total) > 0.15;
}

async function transliteratePage(db, page) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLITERATION_MODEL}:generateContent?key=${apiKey}`;
  const cleanedOcr = stripLatexArtifacts(page.ocr.data);
  const prompt = `${TRANSLITERATION_PROMPT}\n\nThe source script is: **${SOURCE_SCRIPT}**\n\n**Text to transliterate:**\n${cleanedOcr}`;

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
    endpoint: 'greek-10-transliteration',
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
      { projection: { id: 1, title: 1, slug: 1, language: 1 } }
    );
    if (!book) { console.log(`Book ${bookId}: not found`); continue; }

    // Get pages needing transliteration (have OCR, no transliteration yet)
    const pages = await db.collection('pages').find({
      book_id: bookId,
      'ocr.data': { $exists: true, $nin: [null, ''] },
      page_type: { $nin: SKIP_TYPES },
      $or: [
        { 'transliteration.data': { $exists: false } },
        { 'transliteration.data': null },
        { 'transliteration.data': '' },
      ],
    }).sort({ page_number: 1 })
      .project({ id: 1, book_id: 1, page_number: 1, ocr: 1 })
      .toArray();

    // Filter to pages with actual Greek content
    const greekPages = pages.filter(p => hasNonLatinContent(p.ocr.data));

    if (greekPages.length === 0) {
      console.log(`\n${(book.title || '').substring(0, 55)}: no pages needing transliteration`);
      continue;
    }

    const label = (book.title || '').substring(0, 55);
    console.log(`\n=== ${label} ===`);
    console.log(`Pages to transliterate: ${greekPages.length} (of ${pages.length} with OCR)`);
    console.log(`URL: https://sourcelibrary.org/book/${book.slug || book.id}`);

    let done = 0, errors = 0, totalCost = 0;

    for (let i = 0; i < greekPages.length; i += CONCURRENCY) {
      const chunk = greekPages.slice(i, i + CONCURRENCY);
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

      if (i % 90 === 0 || i + CONCURRENCY >= greekPages.length) {
        console.log(`  Progress: ${done}/${greekPages.length} ($${totalCost.toFixed(4)})`);
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
