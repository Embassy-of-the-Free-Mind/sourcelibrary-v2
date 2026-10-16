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
 * LEAN ROUTE (`--lean <wikidata-cache.json>`, #6721 2026-10-15): every work's representative goes to the lean model
 * (catalogue fields, 100/call); Wikidata is recorded beside it as a candidate and a check, never as the date on its own
 * (see scripts/lib/date-works.mjs). Writes instead:
 *   <dir>/work-queue.jsonl    — one representative per work cluster, carrying its author's Wikidata dates
 *                               (`author_dates`) when known
 *   <dir>/edition-queue.jsonl — every book no rule dates the edition of, except a volume sharing its representative's
 *                               catalogue string (it takes the representative's) and books in --keep (their edition is
 *                               already written by an earlier run)
 *   <dir>/plan.json           — as above, plus per cluster `wikidata_work` (the work item's date, a candidate) and
 *                               `author_window` (the author's dated window)
 * `author_id` is joined from the nightly mirror (the export predates it).
 *
 *   node scripts/maintenance/library-dating/plan.mjs <all-books.jsonl> <dir> [--batch 15]
 *     [--lean wikidata-cache.json] [--bdrc bdrc-cache.json] [--tails tails.jsonl] [--keep dated-earlier.jsonl]
 * `--bdrc`: author windows fall back to BDRC person dates (bdrc-dates.mjs). `--tails`: edition rows carry their closing
 * leaves (export-books.mjs --tail) for a colophon; the edition queue is split into editiontext-queue.jsonl (opening or
 * closing text: 20/call) and editionbare-queue.jsonl (catalogue only: 100/call).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loose, ruleEdition, wikidataWork, authorDates, authorWindowOf } from '../../lib/date-works.mjs';
import { openMirror } from '../../lib/mirror.mjs';

const [IN, DIR] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BATCH = +arg('--batch', 15);
const LEAN = arg('--lean'); const wd = LEAN ? JSON.parse(fs.readFileSync(LEAN, 'utf8')) : null;
const bd = arg('--bdrc') ? JSON.parse(fs.readFileSync(arg('--bdrc'), 'utf8')) : null;
const tails = new Map(); if (arg('--tails')) for (const l of fs.readFileSync(arg('--tails'), 'utf8').split('\n')) if (l) { const r = JSON.parse(l); if (r.tail) tails.set(r.book_id, r.tail); }
const keep = new Set(); const KEEP = arg('--keep');
if (KEEP) for (const l of fs.readFileSync(KEEP, 'utf8').split('\n')) if (l) try { const r = JSON.parse(l); if (r.edition) keep.add(r.book_id); } catch { /* torn */ }
const authorOf = new Map();
if (LEAN) for (const r of openMirror({ collections: ['books'] }).query(`SELECT coalesce((id->>'$'), _id) AS book_id, (author_id->>'$') AS author_id
  FROM books WHERE TRY_CAST(pages_count::VARCHAR AS DOUBLE) > 0 AND (author_id->>'$') IS NOT NULL`)) authorOf.set(r.book_id, r.author_id);
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
  if (LEAN) { b.author_id = b.author_id || authorOf.get(b.book_id) || null; b.author_dates = authorDates(b, wd); }
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
if (LEAN) {
  const wq = []; const eq = []; const cand = { wikidata_work: 0, author_window: 0 };
  const byKey = new Map(plan.map((p) => [p.key, p]));
  for (const [key, ms] of clusters) {
    const p = byKey.get(key); const rep = ms[0];
    // a work item's date on any member (capped at the earliest rule edition: a work cannot postdate a copy of it), and
    // the representative's author window
    const eys = ms.map((m) => m.e?.year).filter((y) => y != null); const ey = eys.length ? Math.min(...eys) : null;
    for (const m of ms) { const w = wikidataWork(m.b, wd, ey); if (w) { p.wikidata_work = w; cand.wikidata_work++; break; } }
    const aw = authorWindowOf(rep.b, wd, bd); if (aw) { p.author_window = aw; cand.author_window++; }
    wq.push({ ...rep.b, lead: undefined, role: 'work' });
    const samePub = (m) => m.b.published != null && String(m.b.published).trim() !== '' && String(m.b.published) === String(rep.b.published);
    for (const [k, m] of ms.entries()) if (!m.e && !keep.has(m.b.book_id) && (k === 0 || !samePub(m))) eq.push({ ...m.b, tail: tails.get(m.b.book_id) || undefined, role: 'edition' });
  }
  fs.writeFileSync(path.join(DIR, 'work-queue.jsonl'), wq.map((q) => JSON.stringify(q)).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'edition-queue.jsonl'), eq.map((q) => JSON.stringify(q)).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'editiontext-queue.jsonl'), eq.filter((q) => q.lead || q.tail).map((q) => JSON.stringify(q)).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'editionbare-queue.jsonl'), eq.filter((q) => !q.lead && !q.tail).map((q) => JSON.stringify(q)).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'plan.json'), JSON.stringify(plan));
  const withLead = eq.filter((q) => q.lead || q.tail).length;
  console.log(JSON.stringify({ books: n, works: clusters.size, edition_by_rule: rule, wikidata_candidates: cand,
    work_model_items: wq.length, work_calls_at_100: Math.ceil(wq.length / 100), with_author_dates_in_prompt: wq.filter((q) => q.author_dates).length,
    edition_model_items: eq.length, edition_with_leaves: withLead, edition_with_closing_leaves: eq.filter((q) => q.tail).length, edition_calls: Math.ceil(withLead / 20) + Math.ceil((eq.length - withLead) / 100),
    edition_kept_from_earlier_run: keep.size }, null, 1));
  process.exit(0);
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
