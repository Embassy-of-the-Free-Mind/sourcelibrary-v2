import { MongoClient } from 'mongodb';

const TRANSLITERATION_MODEL = 'gemini-3.1-flash-lite-preview';
const CONCURRENCY = 10;
const SOURCE_SCRIPT = 'Greek';
const BOOK_ID = '6953a93977f38f6761bd58f4'; // Hermetica Vol. I

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
  return { inputTokens, outputTokens, costUsd };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const SKIP_TYPES = ['blank', 'illustration', 'map', 'frontispiece', 'diagram'];

  // Find Hermetica pages that have OCR but no transliteration
  const pages = await db.collection('pages').find({
    book_id: BOOK_ID,
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

  console.log(`Hermetica Vol. I — ${pages.length} pages missing transliteration`);

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
        console.log(`  Error: ${msg.substring(0, 120)}`);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          console.log('  Rate limited — waiting 30s...');
          await sleep(30000);
        }
      }
    }

    console.log(`  Progress: ${done}/${pages.length} ($${totalCost.toFixed(4)})`);
  }

  console.log(`\nDone: ${done} ok, ${errors} errors, $${totalCost.toFixed(4)}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
