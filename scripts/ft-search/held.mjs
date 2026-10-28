#!/usr/bin/env node
// PRIOR ART: scripts/ft-search/ingest.mjs holds these books (prior found on a badged book) and stops there;
// .claude/skills/ft-verify adjudicates proposed flips from the retired card system. This settles the books
// the fresh search held, with one same-work check each (#7598).
//
// A fresh search found an earlier English translation, but the book already carries a first-translation
// badge, so ingest.mjs held it. A prior only defeats a badge if it is real, of the SAME text, and complete
// (.claude/docs/invariants/first-translation-claims.md). One Sonnet `claude -p` per book checks that.
//
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/held.mjs prompts <dir> [--since 2026-10-27]   # find held books, write <id>.prompt + ids.txt
//   CLAUDE_CONFIG_DIR=~/.claude-team scripts/ft-search/run-batch.sh <dir> 3   # same runner as a batch
//   node scripts/ft-search/held.mjs apply <dir>              # dry run, prints tallies
//   node scripts/ft-search/held.mjs apply <dir> --apply      # writes; held-log.json lists every action
//
// Apply, per verdict:
//   real, same text, complete            → badge removed (verdict not_first), prior credited
//   real, same text, partial or excerpts → badge stays, partial credit added (the page shows both)
//   anything else                        → badge stays; the attempt row is marked overruled so it is not held again
import { MongoClient } from 'mongodb';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const [MODE, DIR] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const SINCE = process.argv.includes('--since') ? process.argv[process.argv.indexOf('--since') + 1] : '2026-10-27';
if (!['prompts', 'apply'].includes(MODE) || !DIR) { console.error('usage: held.mjs prompts|apply <dir> [--apply] [--since YYYY-MM-DD]'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const METHOD = 'claude_subagent_verify';
const BY = 'ft-fresh-search-held';
const BAD_HOSTS = /(goodreads|perlego|scribd|amazon\.|abebooks|bookshop\.org|ebay\.|biblio\.com|sourcelibrary\.org)/i;
const NOW = new Date();

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');
const events = db.collection('book_events');

if (MODE === 'prompts') {
  const keyFile = [process.env.SL_INTERNAL_KEY_FILE, `${homedir()}/.sl-internal-key`, '/root/.sl-internal-key'].find((f) => f && existsSync(f));
  if (!keyFile) { console.error('No internal key file; the record fetch would hit the crawler gate'); process.exit(1); }
  const key = readFileSync(keyFile, 'utf8').trim();
  mkdirSync(DIR, { recursive: true });
  const rows = await attempts.find({ method: METHOD, result: 'found', date: { $gte: SINCE } /* stored as an ISO string */, held_adjudication: { $exists: false } }).toArray();
  const ids = [];
  for (const a of rows) {
    const b = await books.findOne({ id: a.book_id }, { projection: { is_first_translation: 1, prior_translation: 1, first_translation: 1 } });
    if (!b?.is_first_translation || b.prior_translation) continue;
    const res = await fetch(`https://sourcelibrary.org/api/books/${a.book_id}`, { headers: { Authorization: `Bearer ${key}` } });
    const rec = (await res.text()).slice(0, 4000);
    const prior = JSON.stringify((a.priors || [])[0] || {});
    writeFileSync(`${DIR}/${a.book_id}.prompt`, `A search found an earlier published English translation for this book, but the book currently carries a "First English translation" badge (${b.first_translation?.evidence_strength || 'unknown'} evidence). Decide whether the claimed translation defeats the badge.

The book's Source Library record (already fetched; do not fetch sourcelibrary.org yourself):
<<<
${rec}
>>>

The claimed earlier English translation:
${prior}

A prior defeats the badge only if ALL of these hold:
1. It is a real publication: open its URL or find it in a library catalogue (WorldCat, HathiTrust, Internet Archive, a national library, the publisher). A bookseller or Goodreads listing alone is not enough.
2. It translates the SAME TEXT this book contains. Not another work by the same author, not a study or paraphrase, and not the ancient source when this book is itself a translation, commentary or adaptation of it (e.g. an Italian Persius with the translator's own commentary is not defeated by an English Persius). If this book is an edition of a text that the prior translates in full, that is the same text.
3. It is complete, not excerpts or selections.

Use at most 6 searches. Then answer with ONLY this JSON on the last line:
{"id": "${a.book_id}", "exists": true|false, "same_text": true|false, "verdict": "same_text|source_of_this_book|other_work_same_author|study_or_paraphrase|no_such_publication|unclear", "scope": "complete|partial|excerpts|unknown", "prior": {"title": "...", "translator": "...", "year": "...", "publisher": "...", "url": "best catalogue or publisher URL you opened"}, "reason": "two or three plain sentences naming what you opened"}
`);
    ids.push(a.book_id);
  }
  writeFileSync(`${DIR}/ids.txt`, ids.join('\n') + '\n');
  console.log(`fresh 'found' rows since ${SINCE}: ${rows.length}; held (badged, no credit): ${ids.length}; prompts in ${DIR}`);
}

if (MODE === 'apply') {
  const parse = (f) => {
    const out = JSON.parse(readFileSync(f, 'utf8'));
    const lines = String(out.result || '').trim().split('\n').reverse();
    for (const l of lines) { const m = l.match(/\{.*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* keep looking */ } } }
    const m = String(out.result || '').match(/\{[\s\S]*"(?:verdict|relationship)"[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  };
  const ids = readFileSync(`${DIR}/ids.txt`, 'utf8').trim().split('\n').filter(Boolean);
  const stats = {}; const inc = (k) => (stats[k] = (stats[k] || 0) + 1);
  const log = [];
  for (const id of ids) {
    let v = null;
    try { v = parse(`${DIR}/${id}.json`); } catch { /* unparsed */ }
    if (!v) { inc('unparsed'); log.push({ id, action: 'unparsed' }); continue; }
    const b = await books.findOne({ id }, { projection: { is_first_translation: 1, prior_translation: 1 } });
    if (!b?.is_first_translation || b.prior_translation) { inc('already_changed'); continue; }
    v.relationship ??= v.verdict; // run-batch.sh skips a book whose output already holds "verdict"
    const p = v.prior || {};
    const url = p.url && /^https?:\/\//.test(p.url) && !BAD_HOSTS.test(p.url) ? p.url : null;
    const yr = parseInt(String(p.year || '').match(/\d{3,4}/)?.[0] ?? '', 10);
    const credit = (scope) => ({
      work_title: p.title, translators: p.translator && !/^(anonymous|unknown|\.\.\.)$/i.test(p.translator) ? [p.translator] : [], scope, url,
      verification_method: 'other', verified_at: NOW.toISOString(), evidence: v.reason,
      ...(Number.isInteger(yr) ? { year: yr } : {}), ...(p.publisher && p.publisher !== '...' ? { publisher: p.publisher } : {}),
    });
    const real = v.exists === true && v.same_text === true && v.relationship === 'same_text' && p.title && url;
    let action;
    if (real && v.scope === 'complete') action = 'badge_removed_prior_credited';
    else if (real && ['partial', 'excerpts'].includes(v.scope)) action = 'badge_kept_partial_credited';
    else action = 'badge_kept_prior_overruled';
    inc(action); log.push({ id, action, relationship: v.relationship, scope: v.scope, prior: p, reason: v.reason });
    if (!APPLY) continue;
    if (action === 'badge_removed_prior_credited') {
      await books.updateOne({ id }, { $set: { is_first_translation: false, 'first_translation.verdict': 'not_first', 'first_translation.decided_at': NOW, 'first_translation.decided_by': BY, prior_translation: credit('complete') } });
      await events.insertOne({ book_id: id, type: 'first_translation_badge_removed', at: NOW, by: `${BY} (#7598)`, detail: { reason: v.reason, prior: p } });
    } else if (action === 'badge_kept_partial_credited') {
      await books.updateOne({ id }, { $set: { prior_translation: credit('partial') } });
      await events.insertOne({ book_id: id, type: 'prior_translation_partial_credited', at: NOW, by: `${BY} (#7598)`, detail: { reason: v.reason, prior: p } });
    }
    await attempts.updateMany({ book_id: id, method: METHOD, result: 'found' }, { $set: { held_adjudication: { action, relationship: v.relationship, scope: v.scope, reason: v.reason, at: NOW } } });
  }
  writeFileSync(`${DIR}/held-log${APPLY ? '' : '-dryrun'}.json`, JSON.stringify(log, null, 1));
  console.log(APPLY ? 'APPLIED' : 'DRY RUN', stats);
}
await c.close();
