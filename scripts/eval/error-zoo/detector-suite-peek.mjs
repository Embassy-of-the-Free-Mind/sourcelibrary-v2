#!/usr/bin/env node
/**
 * PRIOR ART: detector-suite.mjs (same inputs) — this prints what one check fires on, for reading by eye.
 * detector-suite-peek.mjs <dir> <check> <half A|B> [n] — negatives (clean random pages) on which a check fires, with
 * its reason, from ONE half of the books, so a fix can be made on that half and measured on the other.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { langKey, untracedNumbers, englishOverUnclear, noteHedges, negationDeficit } from '../../lib/ocr-english-checks.mjs';

const [DIR, CHECK, HALF, N = '15'] = process.argv.slice(2);
async function* jsonl(f) { for await (const l of readline.createInterface({ input: fs.createReadStream(f) })) if (l.trim()) yield JSON.parse(l); }
const pages = new Map();
for await (const p of jsonl(`${DIR}/pages.jsonl`)) if (p.ocr_text && p.translation) pages.set(p.page_id, p);
const neg = new Set(), blocked = new Set();
for await (const r of jsonl(`${DIR}/labels.jsonl`)) {
  if (!pages.has(r.page_id) || r.stale !== false) continue;
  if ((r.errors || []).some((e) => e.severity === 'serious')) blocked.add(r.page_id);
  else if (r.source === 'spare_audit' && r.selection === 'random' && r.exposure === 'served') neg.add(r.page_id);
}
const F = {
  numbers: (p) => untracedNumbers(p.ocr_text, p.translation),
  unclear: (p) => englishOverUnclear(p.ocr_text, p.translation),
  hedges: (p) => noteHedges(p.translation),
  negation: (p) => negationDeficit(p.ocr_text, p.translation, langKey(p.book?.language)),
}[CHECK];
let shown = 0;
for (const id of neg) {
  if (blocked.has(id)) continue;
  const p = pages.get(id);
  if ((parseInt(p.book_id.slice(-2), 16) % 2 ? 'B' : 'A') !== HALF) continue;
  const v = F(p);
  if (!(v.score >= 1)) continue;
  console.log(id, p.book?.language, JSON.stringify(v));
  if (CHECK === 'hedges') for (const m of p.translation.matchAll(/<(note|gloss)\b[^>]*>([\s\S]*?)<\/\1>/gi)) console.log('   ', m[2].slice(0, 160).replace(/\n/g, ' '));
  if (++shown >= Number(N)) break;
}
