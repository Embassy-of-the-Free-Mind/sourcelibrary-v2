#!/usr/bin/env node
// PRIOR ART: scripts/ft-search/select-batch.mjs + ingest.mjs — they find and write a credit; this re-reads one already written.
// Recheck the earlier-translation credits the fresh search wrote (#7598). The batch 3 and 4 spot checks
// (2026-10-29) found 5 of 20 credits were translations of only PART of the book (one text of a Tengyur
// volume, the Anacreon odes without the Sappho), and the search sometimes credited a study or a Wikipedia
// article about the work. The search prompt now asks for both sides of the coverage comparison; this
// rechecks the credits written before it did.
//
//   node scripts/ft-search/recheck-credits.mjs prepare <dir> [--since 2026-10-27] [--limit N] [--ids <file>]
//   CLAUDE_CONFIG_DIR=~/.claude-team scripts/ft-search/run-batch.sh <dir> 4     # launch WITHOUT the env loaded:
//                                       # run-batch's post-run would otherwise dry-run ingest.mjs on these answers
//   node scripts/ft-search/recheck-credits.mjs apply <dir>            # dry run: counts + recheck-log.json
//   node scripts/ft-search/recheck-credits.mjs apply <dir> --apply
//
// apply writes: `partial` → prior_translation.scope 'partial' (and the catalogue row's completeness);
// `not_a_translation` / `wrong_work` → the credit is removed, its full value kept in the book_events row
// (type prior_translation_retracted) so it can be restored. Every rechecked book gets a book_events row.
// It never writes a first-translation badge: a retracted credit leaves the book with neither claim.
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const [mode, dirArg] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
if (!['prepare', 'apply'].includes(mode) || !dirArg) { console.error('usage: recheck-credits.mjs prepare|apply <dir> [--since D] [--limit N] [--apply]'); process.exit(1); }
const dir = path.resolve(dirArg);
const BY = 'ft-recheck-credits (#7598)';

const client = await MongoClient.connect(process.env.MONGODB_URI);
const books = client.db('bookstore').collection('books');
const bookEvents = client.db('bookstore').collection('book_events');

function prompt(b) {
  const id = b.id || String(b._id);
  const p = b.prior_translation;
  return `Source Library credits this book with an earlier published English translation. Check the credit.
Book: ${b.display_title || b.title || ''} | author: ${b.author || 'Anonymous'} | date: ${b.published || b.year || ''} | edition language: ${b.language || ''} | Source Library id ${id}.
First read the book's summary: curl -s https://sourcelibrary.org/api/books/${id} | head -c 4000
The credit: ${(p.translators || []).join(', ')}, "${p.work_title || ''}"${p.year ? ` (${p.year})` : ''}${p.publisher ? `, ${p.publisher}` : ''}. Link: ${p.url}
Note written with it: ${(p.evidence || '').slice(0, 600)}
Open the link. Search (at most 5 searches) if the link alone cannot answer. Then decide:
- holds: an English translation of ALL the text this book contains.
- partial: an English translation of only part of it (one of several works in the volume, one volume of several, selected poems or chapters, excerpts, an abridgement).
- not_a_translation: a study, commentary, summary, paraphrase, review, or encyclopedia/Wikipedia article ABOUT the work, and you found no actual translation.
- wrong_work: a translation of a different work.
- unverifiable: you could not tell.
If the link is only a Wikipedia page or a review but a real translation exists, verdict holds or partial, and give the translation's own record in better_url.
Report only URLs you actually opened. Never guess a URL.
Answer with ONLY a JSON object: {"id":"${id}","verdict":"holds|partial|not_a_translation|wrong_work|unverifiable","book_contains":"...","translation_covers":"...","better_url":"" ,"note":"one sentence"}`;
}

if (mode === 'prepare') {
  const since = arg('--since', '2026-10-27');
  const limit = parseInt(arg('--limit', '0'), 10);
  const only = arg('--ids'); // a file of book ids, e.g. a gate set with known partials as a positive control
  const q = only
    ? { id: { $in: fs.readFileSync(only, 'utf8').split(/\s+/).filter(Boolean) }, prior_translation: { $exists: true } }
    : { 'prior_translation.source_attempt_id': /:claude_subagent_verify:/, 'prior_translation.verified_at': { $gte: since } };
  let cur = books.find(q, { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, prior_translation: 1 } });
  if (limit) cur = cur.limit(limit);
  const list = await cur.toArray();
  fs.mkdirSync(dir, { recursive: true });
  for (const b of list) fs.writeFileSync(path.join(dir, `${b.id || b._id}.prompt`), prompt(b));
  fs.writeFileSync(path.join(dir, 'ids.txt'), list.map((b) => b.id || String(b._id)).join('\n') + '\n');
  console.log(`prepared ${list.length} credits (verified_at >= ${since}) in ${dir}`);
} else {
  const ids = fs.readFileSync(path.join(dir, 'ids.txt'), 'utf8').split(/\s+/).filter(Boolean);
  const counts = {}; const log = [];
  const inc = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const sb = APPLY ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
  for (const id of ids) {
    const f = path.join(dir, `${id}.json`);
    let o = null;
    if (fs.existsSync(f)) {
      // Same rule as parse-results.py: the last line whose result holds a JSON verdict wins.
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        try { const m = (JSON.parse(line).result || '').match(/\{[\s\S]*\}/); const j = m && JSON.parse(m[0]); if (j?.verdict) o = j; } catch { /* not this line */ }
      }
    }
    if (!o) { inc('no_answer'); continue; }
    const b = await books.findOne({ id }, { projection: { id: 1, prior_translation: 1 } });
    if (!b?.prior_translation) { inc('credit_gone'); continue; }
    const v = o.verdict;
    inc(v);
    log.push({ book_id: id, verdict: v, url: b.prior_translation.url, better_url: o.better_url || '', book_contains: o.book_contains, translation_covers: o.translation_covers, note: o.note });
    if (!APPLY) continue;
    const detail = { verdict: v, book_contains: o.book_contains || '', translation_covers: o.translation_covers || '', better_url: o.better_url || '', note: o.note || '' };
    if (v === 'partial' && b.prior_translation.scope !== 'partial') {
      await books.updateOne({ _id: b._id }, { $set: { 'prior_translation.scope': 'partial' } });
      await bookEvents.insertOne({ book_id: id, type: 'prior_translation_scope_partial', at: new Date(), by: BY, detail });
      await sb.from('translation_catalogs').update({ completeness: 'partial' }).eq('source', 'sl_prior_credit_linked').eq('source_url', b.prior_translation.url);
    } else if (v === 'not_a_translation' || v === 'wrong_work') {
      await books.updateOne({ _id: b._id }, { $unset: { prior_translation: '' } });
      await bookEvents.insertOne({ book_id: id, type: 'prior_translation_retracted', at: new Date(), by: BY, detail: { ...detail, retracted: b.prior_translation } });
    } else {
      await bookEvents.insertOne({ book_id: id, type: 'prior_translation_rechecked', at: new Date(), by: BY, detail });
    }
  }
  fs.writeFileSync(path.join(dir, APPLY ? 'recheck-log.json' : 'recheck-log-dryrun.json'), JSON.stringify(log, null, 1));
  console.log(APPLY ? 'APPLIED' : 'DRY RUN', counts);
}
await client.close();
