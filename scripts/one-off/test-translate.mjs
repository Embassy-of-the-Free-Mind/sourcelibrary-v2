import { MongoClient } from 'mongodb';

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

// Get one Da Vinci page with OCR but no translation
const book = await db.collection('books').findOne({ author: /leonardo/i, pages_ocr: { $gt: 0 } });
console.log('Book:', book.id, book.title?.substring(0, 50), 'lang:', book.language);

const pages = await db.collection('pages').find({ book_id: book.id })
  .project({ id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, page_type: 1 })
  .sort({ page_number: 1 }).limit(5).toArray();

for (const p of pages) {
  const ocrSnip = (p.ocr?.data || '').substring(0, 60).replace(/\n/g, ' ');
  const translSnip = (p.translation?.data || 'NONE').substring(0, 30);
  console.log(`  p${p.page_number} ocr:${ocrSnip} transl:${translSnip}`);
}

// Try a direct Gemini call on the first page with OCR
const testPage = pages.find(p => p.ocr?.data?.length > 10);
if (!testPage) { console.log('No page with OCR'); await client.close(); process.exit(0); }

console.log(`\nTest translating page ${testPage.page_number} (${testPage.ocr.data.length} chars OCR)...`);

const prompt = await db.collection('prompts').findOne(
  { type: 'translation', is_default: true }, { sort: { version: -1 } }
);
console.log('Prompt:', prompt?.name, 'v' + prompt?.version);

const fullPrompt = prompt.content
  .replace('{language}', book.language || 'Italian')
  .replace('{sourceLanguage}', book.language || 'Italian')
  .replace('{targetLanguage}', 'English')
  + '\n\n**Text to translate:**\n' + testPage.ocr.data;

console.log('Prompt length:', fullPrompt.length, 'chars');

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY_TIER3}`;
const start = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
  }),
  signal: AbortSignal.timeout(120000),
});

const elapsed = Date.now() - start;
console.log('Status:', res.status, 'in', elapsed + 'ms');

if (!res.ok) {
  console.log('Error:', (await res.text()).substring(0, 500));
} else {
  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log(`Translation (${text.length} chars):`, text.substring(0, 200));
  const usage = result.usageMetadata || {};
  console.log('Tokens:', usage.promptTokenCount, 'in /', usage.candidatesTokenCount, 'out');
}

await client.close();
