#!/usr/bin/env node
// PRIOR ART: draw.mjs here (the page census, marks on the stored text only) and scripts/audit/headword-mark-drop.mjs (flags a
// page by its book's median rate). Neither knows how many marks the leaf has, so neither sees a page that lost part of its
// marks. Kanripo's WYG leaf does: its marks against the stored count, per page, via ocr.qa_screen.pb.
/**
 * partial-census.mjs <dir with KR3k0059, KR3k0056, KR3k0060 (branch WYG)>. Reads $JOB_SCRATCH/census.jsonl.gz; files only.
 * Writes results/zh-ditto-restore-5274/partial-census.json. Own leaf at dice ≥ 0.6 only.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , KR] = process.argv;
const leaf = new Map();
for (const r of ['KR3k0059', 'KR3k0056', 'KR3k0060']) for (const f of fs.readdirSync(path.join(KR, r)).filter((x) => x.endsWith('.txt'))) {
  const parts = fs.readFileSync(path.join(KR, r, f), 'utf8').split(/<pb:([^>]+)>/);
  for (let i = 1; i < parts.length; i += 2) leaf.set(parts[i], (parts[i + 1].match(/丨/g) || []).length);
}
const rows = zlib.gunzipSync(fs.readFileSync(path.join(process.env.JOB_SCRATCH, 'census.jsonl.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const scored = rows.filter((r) => r.pb && r.dice >= 0.6 && leaf.has(r.pb));
const band = (r) => { const t = leaf.get(r.pb); const k = t ? r.marks / t : null; return t === 0 ? (r.marks ? 'leaf has none, page has some' : 'leaf has none') : k === 0 ? 'lost all' : k < 0.5 ? 'lost over half' : k < 0.9 ? 'lost 10-50%' : 'kept ≥ 90%'; };
const out = { leaves: leaf.size, pages: rows.length, scored: scored.length, unscored: rows.length - scored.length, bands: {}, marks_on_leaves: 0, marks_stored: 0, held: {} };
for (const r of scored) { const b = band(r); out.bands[b] = (out.bands[b] || 0) + 1; if (r.held) out.held[b] = (out.held[b] || 0) + 1; out.marks_on_leaves += leaf.get(r.pb); out.marks_stored += Math.min(r.marks, leaf.get(r.pb)); }
out.zero_pages_where_leaf_has_marks = scored.filter((r) => r.marks === 0 && leaf.get(r.pb) > 0).length;
out.zero_pages_where_leaf_has_none = scored.filter((r) => r.marks === 0 && leaf.get(r.pb) === 0).length;
out.pages_to_fix_lt90 = scored.filter((r) => leaf.get(r.pb) > 0 && r.marks / leaf.get(r.pb) < 0.9).length;
out.books_to_fix_lt90 = new Set(scored.filter((r) => leaf.get(r.pb) > 0 && r.marks / leaf.get(r.pb) < 0.9).map((r) => r.bid)).size;
fs.writeFileSync(path.join(HERE, '../results/zh-ditto-restore-5274/partial-census.json'), JSON.stringify(out, null, 1));
console.log(out);
