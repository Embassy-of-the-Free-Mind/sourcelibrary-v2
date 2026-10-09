#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t4/list-books.mjs and xlref-t5/census.mjs list one track's books by exact language label; neither groups by the FIRST-label regex the Flash routing uses (isFlashMeasuredLanguage), nor counts the untranslated backlog the decision card prices. Read-only.
/** Census for the #5873 reference top-up: live translated books and untranslated pages per routed language. */
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ref-topup-5873/census.mjs <out.json>
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
export const LANGS = { Persian: /^\s*persian\b/i, Hebrew: /^\s*(hebrew|heb)\b/i, Aramaic: /^\s*aramaic\b/i, Arabic: /^\s*arabic\b/i, Pali: /^\s*pali\b/i, Chinese: /^\s*(chinese|classical\s+chinese)\b/i, Sanskrit: /^\s*sanskrit\b/i };
export const langOf = (label) => Object.keys(LANGS).find((k) => LANGS[k].test(label || '')) || null;
if (process.argv[1]?.endsWith('census.mjs')) {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const out = {};
  try {
    const cur = c.db('bookstore').collection('books').find({ language: { $regex: /^\s*(persian|hebrew|heb|aramaic|arabic|pali|chinese|classical\s+chinese|sanskrit)\b/i } }, { projection: { id: 1, language: 1, visible: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1 } });
    for await (const b of cur) {
      const l = langOf(b.language); if (!l) continue;
      const o = (out[l] ||= { books: 0, live_books: 0, live_translated_books: 0, pages: 0, pages_translated: 0, pages_untranslated: 0 });
      o.books++; const pc = b.pages_count || 0, pt = b.pages_translated || 0;
      if (b.visible === true && pc > 0) { o.live_books++; if (pt > 0) o.live_translated_books++; }
      o.pages += pc; o.pages_translated += pt; o.pages_untranslated += Math.max(0, pc - pt);
    }
  } finally { await c.close(); }
  for (const o of Object.values(out)) o.flash_minus_lite_batch_usd = Math.round(o.pages_untranslated * 0.00094); // T5: Flash $0.00178 − Lite $0.00084 a page at the Batch rate
  fs.writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), by_language: out }, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
