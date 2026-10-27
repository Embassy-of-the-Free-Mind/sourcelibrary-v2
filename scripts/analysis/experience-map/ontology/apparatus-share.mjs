/**
 * How much of a node's count is the translator's apparatus (#7458)? The counts in ontology.json match phrases in
 * translation.data, which carries the model's own <gloss>/<note>/<term> spans: a gloss "[life force]" on a page
 * that never says it counts as a use, dated to the old work. For each node, a random sample of matching pages is
 * read and each is classed as: source (a phrase in the OCR text), body (in the translation outside the spans), or
 * apparatus only. words-over-time.py reads the result and refuses a node whose apparatus-only share is high.
 *
 * PRIOR ART: measure.mjs — same index, phrase rule and text cleaning (texts(), stripEditorialWrappers); it counts
 * and quotes but never separates the apparatus from the body, so this samples beside it rather than re-counting.
 *
 *   node --env-file=<.env.production.local> apparatus-share.mjs [--only a,b] [--n 200]  → ./apparatus-share.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { stripEditorialWrappers } from '../../../lib/strip-editorial-wrappers.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const N = Number(arg('--n', 200));
const { nodes } = JSON.parse(fs.readFileSync(path.join(HERE, 'ontology.json'), 'utf8'));
const only = arg('--only', null) ? new Set(arg('--only').split(',')) : null;
const OUTF = path.join(HERE, 'apparatus-share.json');
const prev = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')).nodes : {};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const pages = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (ps) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${ps.map((p) => esc(p).replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const unwrap = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const body = (raw) => unwrap(stripEditorialWrappers(String(raw || ''))
  .replace(/<(gloss|note|term)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ').replace(/\[[^\]]*\]/g, ' '));
const all = (raw) => unwrap(stripEditorialWrappers(String(raw || '')));

const out = { ...prev };
for (const n of nodes) {
  if (only && !only.has(n.id)) continue;
  const phrases = n.search_phrases;
  const should = phrases.flatMap((q) => ['translation.data', 'ocr.data'].map((p) => ({ phrase: { query: q, path: p } })));
  const hits = await pages.aggregate([
    { $search: { index: 'pages_search', compound: { should, minimumShouldMatch: 1, filter: [{ range: { path: 'page_number', gt: 0 } }] } } },
    { $limit: 20000 }, { $sample: { size: N } },
    { $project: { _id: 0, 'translation.data': 1, 'ocr.data': 1 } },
  ]).toArray();
  const re = termRe(phrases);
  const c = { source: 0, body: 0, apparatus_only: 0, unmatched: 0 };
  for (const h of hits) {
    if (re.test(String(h.ocr?.data || ''))) c.source++;
    else if (re.test(body(h.translation?.data))) c.body++;
    else if (re.test(all(h.translation?.data))) c.apparatus_only++;
    else c.unmatched++; // tokeniser matched what the regex does not (punctuation, diacritics); not classed
  }
  const classed = c.source + c.body + c.apparatus_only;
  out[n.id] = { sampled: hits.length, ...c, apparatus_only_share: classed ? +(c.apparatus_only / classed).toFixed(3) : null };
  console.log(n.id.padEnd(24), JSON.stringify(out[n.id]));
}
fs.writeFileSync(OUTF, JSON.stringify({
  about: 'Random sample of pages matching each node\'s phrases (first 20,000 search hits, then $sample). source = phrase in OCR text; body = in the translation outside <gloss>/<note>/<term> and [brackets]; apparatus_only = only inside them. Built by apparatus-share.mjs.',
  built: new Date().toISOString().slice(0, 10), nodes: out,
}, null, 1) + '\n');
await client.close();
