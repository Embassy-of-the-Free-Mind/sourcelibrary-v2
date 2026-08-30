#!/usr/bin/env node
/**
 * ingest-ft-attempts.mjs — persist grounded-adjudication evidence into the durable
 * append-only provenance log `first_translation_attempts` (Sink A, #2564).
 *
 * Reads one or more enumeration JSONL files (each record has real book_id, queries[],
 * sources_checked[], prior_translations_found[], reasoning, model, date, cost_usd) and
 * appends one attempt per record. Idempotent: deterministic attempt_id = book:method:date,
 * skips any attempt_id already present. NO badge writes (this is evidence only).
 *
 * USAGE:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ingest-ft-attempts.mjs file1.jsonl [file2.jsonl ...] [--apply]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const files = process.argv.slice(2).filter(a => a.endsWith('.jsonl'));
const APPLY = process.argv.includes('--apply');
if (!files.length) { console.error('usage: ingest-ft-attempts.mjs <file.jsonl ...> [--apply]'); process.exit(1); }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const COL = c.db('bookstore').collection('first_translation_attempts');

const FIRST = new Set(['first_no_prior', 'first_from_source', 'first_complete', 'first_modern']);
const attempts = [];
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.book_id || /^v\d+$/.test(r.book_id)) continue;   // skip synthetic (work-level) ids
    const date = r.date || '1970-01-01T00:00:00.000Z';
    const priors = r.prior_translations_found || [];
    const priorStr = priors.map(p => [p.translator, p.pub_year, p.english_title, p.source_url].filter(Boolean).join(', ')).join(' | ');
    attempts.push({
      attempt_id: `${r.book_id}:gemini_verifier:${date}`,
      book_id: r.book_id,
      date,
      method: 'gemini_verifier',
      match_key: r.match_key || 'author_title',
      sources_checked: r.sources_checked || [],
      queries: r.queries || [],
      result: priors.length > 0 ? 'found' : 'none',
      found_refs: [],
      verdict: r.verdict,
      // #3785: schema requires a valid strength; unstated fails toward 'weak' (never trust by omission).
      evidence_strength: ['strong', 'moderate', 'weak'].includes(r.evidence_strength) ? r.evidence_strength : 'weak',
      model: r.model || null,
      cost_usd: r.cost_usd || null,
      notes: `${r.work_identified ? `[${r.work_identified}] ` : ''}${r.reasoning || ''}${priorStr ? `  PRIOR: ${priorStr}` : ''}`.trim(),
      _src: 'ingest-ft-attempts',
    });
  }
}
// idempotency: drop attempt_ids already present
const ids = attempts.map(a => a.attempt_id);
const present = new Set((await COL.find({ attempt_id: { $in: ids } }, { projection: { attempt_id: 1 } }).toArray()).map(d => d.attempt_id));
const fresh = attempts.filter(a => !present.has(a.attempt_id));
const withQ = fresh.filter(a => a.queries.length).length;
console.log(`Parsed ${attempts.length} book-keyed records · ${present.size} already in log · ${fresh.length} to insert (${withQ} carry search queries).`);
if (!APPLY) { console.log('DRY RUN — re-run with --apply to write.'); await c.close(); process.exit(0); }
if (fresh.length) { const res = await COL.insertMany(fresh, { ordered: false }); console.log(`Inserted ${res.insertedCount} attempts.`); }
console.log(`first_translation_attempts total now: ${await COL.estimatedDocumentCount()}`);
await c.close();
