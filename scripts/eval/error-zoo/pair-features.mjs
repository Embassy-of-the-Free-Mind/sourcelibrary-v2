#!/usr/bin/env node
/**
 * PRIOR ART: features.py (199 text/catalogue features, Python; none of them read the OCR and the English together
 * beyond number/name overlap) — this adds the ocr-english-checks.mjs scores so train.py-style models can use them.
 *
 * pair-features.mjs <dir> → <dir>/pair-feats.json  { page_id: { neg_deficit, untraced_body, untraced_notes, hedges,
 * notes, unclear_over, sent_ratio, len_ratio } } from pages.jsonl. No Mongo, no model.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { langKey, negationDeficit, untracedNumbers, englishOverUnclear, sentenceShortfall, noteHedges } from '../../lib/ocr-english-checks.mjs';

const DIR = process.argv[2];
const out = {};
for await (const l of readline.createInterface({ input: fs.createReadStream(`${DIR}/pages.jsonl`) })) {
  if (!l.trim()) continue;
  const p = JSON.parse(l);
  if (!p.ocr_text || !p.translation) continue;
  const n = negationDeficit(p.ocr_text, p.translation, langKey(p.book?.language));
  const u = untracedNumbers(p.ocr_text, p.translation), h = noteHedges(p.translation);
  const c = englishOverUnclear(p.ocr_text, p.translation), s = sentenceShortfall(p.ocr_text, p.translation);
  out[p.page_id] = { neg_deficit: n.score, untraced_body: u.score, untraced_notes: u.inNotes, hedges: h.hedges, notes: h.notes,
    unclear_over: c.score, sent_ratio: s.ratio, len_ratio: s.lenRatio };
}
fs.writeFileSync(`${DIR}/pair-feats.json`, JSON.stringify(out));
console.log(`${Object.keys(out).length} pages`);
