#!/usr/bin/env node
/**
 * Plan the library-wide dating (#6721 amendment: date WORKS, not editions; no model where a rule does).
 *
 * Reads export-books.mjs output and writes:
 *   <dir>/queue.jsonl  — the books a model must see: one REPRESENTATIVE per work cluster (its call dates the work and
 *                        its own edition), plus every other member whose edition no rule can date (its call is for the
 *                        edition; its work date still comes from the representative) — except a volume whose
 *                        catalogue date string equals the representative's, which shares its edition date
 *   <dir>/plan.json    — clusters { key, rep, members } and each member's rule edition (or null), for the writer
 *   and prints the books → works → calls arithmetic.
 *
 * CLUSTER KEY: books.work_id (else a normalised author key) + the normalised title HEAD (the title up to its first
 * volume/part marker or separator). The title head keeps a polluted work_id (one id over several distinct works,
 * work-identity.md) from lending one work's date to another, while the volumes of one work (周禮注疏·卷三十六 (vol 39),
 * Punica, Vol. 2) still share one call.
 *
 * PRIOR ART: scripts/maintenance/merge-work-clusters.mjs clusters by work_id to MERGE ids (writes, queues review); this
 * only groups for one dating call and writes nothing to Mongo. normalizeAuthor-style folding is done locally (loose()).
 *
 *   node scripts/maintenance/library-dating/plan.mjs <all-books.jsonl> <dir> [--batch 15]
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loose, ruleEdition } from '../../lib/date-works.mjs';

const [IN, DIR] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BATCH = +arg('--batch', 15);
if (!IN || !DIR) { console.error('usage: plan.mjs <all-books.jsonl> <dir> [--batch 15]'); process.exit(2); }
fs.mkdirSync(DIR, { recursive: true });

export function titleHead(t) {
  const s = String(t || '').split(/[·:;(\[/|]|\s[-–—]\s|,?\s+(?:vol\.?|volume|tome|tom\.|band|bd\.|pars|part|liber|lib\.|teil|juan|卷)\s*\S*/i)[0];
  return loose(s).replace(/\b\d+\b/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ') || loose(t).slice(0, 40);
}
const authorKey = (a) => loose(a).split(' ').filter((w) => w.length > 2).sort().slice(0, 3).join('-') || 'anon';

const clusters = new Map(); let n = 0;
const rl = readline.createInterface({ input: fs.createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const b = JSON.parse(line); n++;
  const key = `${b.work_id || `a:${authorKey(b.author)}`}|${titleHead(b.original_title || b.title)}`;
  const e = ruleEdition(b);
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push({ b, e });
}

// the representative: the member with the most opening text, visible first
const queue = []; const plan = []; const rule = { title_page: 0, catalogue: 0, model: 0 }; let editionCalls = 0;
for (const [key, ms] of clusters) {
  ms.sort((x, y) => (y.b.visible - x.b.visible) || ((y.b.lead || '').length - (x.b.lead || '').length));
  const rep = ms[0];
  queue.push({ ...rep.b, role: 'work' });
  for (const m of ms) rule[m.e ? m.e.basis : 'model']++;
  // a volume whose catalogue date string is the representative's (one set, one printing: "1982–1985", "明萬曆 …")
  // takes the representative's edition date; any other member without a rule edition gets its own model call
  const samePub = (m) => m.b.published != null && String(m.b.published).trim() !== '' && String(m.b.published) === String(rep.b.published);
  for (const m of ms.slice(1)) if (!m.e && !samePub(m)) { queue.push({ ...m.b, role: 'edition' }); editionCalls++; }
  plan.push({ key, rep: rep.b.book_id, members: ms.map((m, k) => ({ book_id: m.b.book_id, rule_edition: m.e, ...(k && !m.e && samePub(m) ? { edition_from_rep: true } : {}) })) });
}
fs.writeFileSync(path.join(DIR, 'queue.jsonl'), queue.map((q) => JSON.stringify(q)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'plan.json'), JSON.stringify(plan));
const multi = plan.filter((p) => p.members.length > 1);
console.log(JSON.stringify({
  books: n, works: clusters.size, multi_member_works: multi.length, books_in_multi: multi.reduce((s, p) => s + p.members.length, 0),
  edition_by_rule: { title_page: rule.title_page, catalogue: rule.catalogue, needs_model: rule.model },
  queue: { work_calls_items: clusters.size, edition_only_items: editionCalls, total_items: queue.length },
  calls_at_batch: { batch: BATCH, calls: Math.ceil(queue.length / BATCH) },
}, null, 1));
