#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/hold-empty-prior-exists-cards.mjs (v3#49: holds the 38 empty prior_exists
 * cards; status-only, no evidence to write entries from — this apply supersedes it for those cards).
 * scripts/workers/prior-translation-check.mjs (Phase 7.7: fills VOID cards only, never edits a settled one).
 * scripts/ft-search/ingest.mjs (appends one credit to a card, never touches status). None applies a
 * verified per-card review (status + entry-by-entry dispositions) to existing cards.
 *
 * Applies the evidence-backed Translation Card changes from the ft-cards-4575 verification
 * (scripts/eval/results/card-contradictions-4575.json; approved by Derek on v2#4575, 2026-11-13).
 *
 * Per card (one Opus verifier opened sources and wrote a disposition for every listed entry):
 *   set_prior_exists                 no_prior_known → prior_exists
 *   add_citation_keep_prior_exists   prior_exists (stays), the verified citations become its entries
 *   set_antiquated_or_partial_only   → antiquated_or_partial_only
 *   fix_listing_keep_no_prior_known  no_prior_known (stays), invented / wrong-work entries removed
 *   set_not_a_single_work            → not_a_single_work
 *   hold_english_original            → under_review + review.identity_flag (renders nothing; Phase 7.7 skips it)
 *   hold_under_review                NOT APPLIED (held by the results)
 *
 * Entries, on the cards whose entries readers see (prior_exists, antiquated_or_partial_only):
 *   the verifier's verified_priors (each from an opened source) become entries, verified: true;
 *   listed entries it kept (keep_verified / keep_unverified / relabel) stay unless a verified prior
 *   already stands for them; drop_* entries go; a few relabels are applied by hand (RELABEL below).
 *   On the other cards only drop_* is applied, and a relabelled entry gets the verifier's note.
 * The old entry list is kept on the card as `entries_superseded_4575` (the #7797 precedent), and the old
 * status as `review.prev_status_4575`. Full before-docs are written to a JSONL backup; --revert=<file>
 * puts them back.
 *
 * Guards: a card is skipped if its live status differs from the status the verifier saw, or if any
 * listed entry no longer sits at the index the verifier's disposition names.
 *
 * Readers of what this writes (actuation, CLAUDE.md):
 *   /book/[id] renders cardLabel() for every book whose work_id is the card (ISR, 24h; revalidated after);
 *   Phase 7.7 (enrich-worker) skips every card left settled or identity-flagged;
 *   apply-reviewed-work-splits.mjs:196 can re-split works (held cards lose the under_review protection).
 *
 * Usage (dry run unless --apply):
 *   node --env-file=.env.production.local scripts/maintenance/apply-card-contradictions-4575.mjs \
 *        [--results=<json>] [--out=<dir>] [--apply] [--revert=<backup.jsonl>]
 *   Writes to <dir>: diff.jsonl, backup-<ts>.jsonl (on --apply), ledger-input.json (for
 *   ingest-ft-verify-results.mjs), book-ids.txt (pages to revalidate).
 */
import { MongoClient, BSON } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const REVERT = arg('revert');
const RESULTS = arg('results') ?? 'scripts/eval/results/card-contradictions-4575.json';
const OUT = arg('out') ?? `${process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp'}/apply-card-contradictions-4575`;
const SWEEP = 'apply-card-contradictions-4575';
const SOURCE = 'ft_cards_4575';
mkdirSync(OUT, { recursive: true });

const STATUS_FOR = {
  set_prior_exists: 'prior_exists',
  add_citation_keep_prior_exists: 'prior_exists',
  set_antiquated_or_partial_only: 'antiquated_or_partial_only',
  fix_listing_keep_no_prior_known: 'no_prior_known',
  set_not_a_single_work: 'not_a_single_work',
  hold_english_original: 'under_review',
};
const RENDERING = new Set(['prior_exists', 'antiquated_or_partial_only']);
/** The ledger verdict per change (ingest-ft-verify-results.mjs: these four count as 'found'). */
const LEDGER_RESULT = {
  set_prior_exists: 'complete_prior_found',
  add_citation_keep_prior_exists: 'complete_prior_found',
  set_antiquated_or_partial_only: 'only_partial_exists',
  fix_listing_keep_no_prior_known: 'none_found',
  set_not_a_single_work: 'not_a_single_work',
  hold_english_original: 'english_original',
};

/**
 * Relabels whose note changes what a reader would see, on cards that render entries, and that no
 * verified prior already replaces. Key: card_id + '|' + listed translator. Value: fields to set, or
 * { exclude: why } for an entry the verifier found is not an English translation of this work (it moves
 * to review.excluded_entries_4575, so the evidence stays on the card).
 */
const RELABEL = {
  'local:a:christophorus-nigrinus:rosicrucian-sphinx|Christine Eike': { exclude: 'a summary, not a translation (verifier note)' },
  'local:a:niels-ludvig-westergaard:bundehesh-liber-pehlvicus|Anquetil-Duperron': { exclude: 'a French translation, not English (verifier note)' },
  'local:a:matteo-ricci:all-lands-map|Pasquale d\'Elia': { exclude: 'an Italian edition and translation, not English (verifier note)' },
  'local:a:eunapius:fragments-histories-lives-sophists|R.C. Blockley': { completeness: 'partial (fragments of the Histories only, not the Lives)', relationship: 'related_distinct_work' },
  'local:a:jakob-bohme:allen-aller-aus-baum-boses-darinnen-dem-der-die-drey-dreyen-durch|null': { translator: 'J. R. Earle', year: '1919', relationship: 'same_work_diff_edition' },
  'local:a:textus-receptus:novum-testamentum-graece|William Tyndale': { completeness: 'partial (the 1525 Cologne printing survives as a fragment)' },
  'local:a:textus-receptus:novum-testamentum-graece|Miles Coverdale': { relationship: 'different_source_language' },
  'Q2657860|William Lisle': { completeness: 'adaptation (verse paraphrase)', relationship: 'related_distinct_work' },
};

const REPRINT = /\b(reprint|facsimile|same translation|not a new translation)\b/i;
const yearOf = (y) => String(y ?? '').match(/\d{4}/)?.[0] ?? null;
const registerFor = (y) => {
  const n = parseInt(yearOf(y) ?? '', 10);
  if (!Number.isFinite(n)) return null;
  return n < 1500 ? 'middle_english' : n < 1900 ? 'early_modern' : 'modern';
};
const words = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]{4,}/g) ?? [];
/** Same translation: same year, or a shared surname-length word in the translator. */
const samePrior = (entry, prior) => {
  if (yearOf(entry.year) && yearOf(entry.year) === yearOf(prior.year)) return true;
  const a = words(entry.translator);
  return a.length > 0 && words(prior.translator).some((w) => a.includes(w));
};
/** Strict: same year AND a shared translator word (used for entries the verifier did not open). */
const samePriorStrict = (entry, prior) => !!yearOf(entry.year) && yearOf(entry.year) === yearOf(prior.year)
  && words(entry.translator).some((w) => words(prior.translator).includes(w));
const norm = (s) => String(s ?? '').trim();

/**
 * The verifiers sometimes put their own commentary in the translator field ("Rachel Hardiman
 * (paradoxography.org site author; the page itself names no translator)"). cardLabel() prints the field,
 * so a long parenthetical is cut to the name; the full text stays in translator_as_verified.
 */
function displayTranslator(t) {
  if (!t) return null;
  if (/^(not named|uncredited)/i.test(t)) return 'Translator not named';
  if (t.length > 40 && t.includes(' (')) return t.slice(0, t.indexOf(' (')).replace(/[;,]\s*$/, '');
  return t;
}

function entryFromPrior(p, now) {
  const translator = displayTranslator(p.translator);
  return {
    kind: 'english_translation',
    translator,
    ...(translator !== (p.translator ?? null) ? { translator_as_verified: p.translator } : {}),
    year: yearOf(p.year) ?? (p.year != null ? String(p.year) : null),
    title: p.english_title ?? null,
    publisher: p.publisher ?? null,
    completeness: p.completeness ?? null,
    register: registerFor(p.year),
    citation_url: p.source_url ?? null,
    verified: true,
    relationship: p.relationship ?? null,
    durable_identifier: p.durable_identifier ?? null,
    source: SOURCE,
    added_at: now,
  };
}

/** Returns { status, entries, excluded, problems } for one card. */
function plan(card, live, now) {
  const problems = [];
  const status = STATUS_FOR[card.proposed_change];
  const entries = live.entries ?? [];
  const disp = new Map((card.entry_dispositions ?? []).map((d) => [d.idx, d]));
  for (const [idx, d] of disp) {
    const e = entries[idx];
    if (!e || norm(e.title) !== norm(d.listed?.title) || norm(e.translator) !== norm(d.listed?.translator)) {
      problems.push(`entry ${idx} moved since verification`);
    }
  }
  const excluded = [];
  let out = [];
  const priors = card.verified_priors ?? [];
  const rendering = RENDERING.has(status);
  entries.forEach((e, idx) => {
    const d = disp.get(idx);
    const kind = d?.disposition ?? 'none';
    if (kind.startsWith('drop_')) return;
    const replacedBy = rendering && priors.find((p) => ((kind === 'keep_verified' || kind === 'relabel') ? samePrior(e, p) : samePriorStrict(e, p)));
    if (replacedBy) { excluded.push({ ...e, excluded_because: `replaced by the verified entry ${replacedBy.translator ?? '?'} ${replacedBy.year ?? ''}`.trim(), ...(d?.note ? { verifier_note: d.note } : {}) }); return; }
    const fix = kind === 'relabel' ? RELABEL[`${card.card_id}|${e.translator ?? null}`] : null;
    if (fix?.exclude) { excluded.push({ ...e, excluded_because: fix.exclude, verifier_note: d.note }); return; }
    const next = { ...e };
    if (kind === 'keep_verified') {
      next.verified = true;
      if (!next.citation_url && d.verified_url) next.citation_url = d.verified_url;
    }
    if (kind === 'relabel') {
      next.relabel_note_4575 = d.note;
      if (fix) Object.assign(next, fix);
      else if (rendering) problems.push(`relabel without a mapping: ${e.translator ?? e.title}`);
      // A relabel on a no_prior_known card means "not a complete English translation of this work"
      // (the verifier kept the line); keep the entry, but it must not read as one.
      if (status === 'no_prior_known' && /^\s*complete\b/i.test(String(next.completeness ?? ''))) {
        next.completeness = 'not a complete English translation of this work (relabelled, #4575)';
      }
    }
    if (rendering && !next.register && registerFor(next.year)) next.register = registerFor(next.year);
    out.push(next);
  });
  if (rendering) {
    // A reprint or facsimile of an older translation is in that translation's English, whatever the
    // edition year: take the register of the earliest prior by the same translator (or the earliest prior).
    const fromPriors = priors.map((p) => {
      const e = entryFromPrior(p, now);
      if (REPRINT.test(`${p.translator ?? ''} ${p.completeness ?? ''} ${p.english_title ?? ''}`)) {
        const same = priors.filter((q) => q !== p && samePrior({ translator: p.translator }, q));
        const pool = same.length ? same : priors.filter((q) => q !== p);
        const first = pool.map((q) => parseInt(yearOf(q.year) ?? '', 10)).filter(Number.isFinite).sort((x, y) => x - y)[0];
        if (first && first < parseInt(yearOf(p.year) ?? '9999', 10)) { e.register = registerFor(first); e.register_from_original_year = String(first); }
      }
      return e;
    });
    out = [...fromPriors, ...out];
    // One line per translation: same year and a shared translator word (or both nameless) is a duplicate.
    const seen = [];
    out = out.filter((e) => {
      if (!(e.title || e.translator)) return true;
      const dup = seen.some((x) => yearOf(x.year) && yearOf(x.year) === yearOf(e.year)
        && (words(x.translator).some((w) => words(e.translator).includes(w)) || (!x.translator && !e.translator && norm(x.title) === norm(e.title))));
      if (dup) { excluded.push({ ...e, excluded_because: 'duplicate of an entry above (#4575 apply)' }); return false; }
      seen.push(e);
      return true;
    });
  }
  if (rendering && !out.some((e) => e.title || e.translator)) problems.push('rendering status with no usable entry');
  if (status === 'no_prior_known' && out.some((e) => e.completeness === 'complete')) problems.push('no_prior_known keeps a complete entry');
  return { status, entries: out, excluded, problems };
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const col = db.collection('work_translation_history');

if (REVERT) {
  // EJSON, so Dates and other BSON types come back as written (plain JSON would turn them into strings).
  const docs = readFileSync(REVERT, 'utf8').trim().split('\n').map((l) => BSON.EJSON.parse(l, { relaxed: false }));
  let n = 0;
  for (const d of docs) {
    if (!APPLY) continue;
    const r = await col.replaceOne({ _id: d._id, 'review.applied_by': SWEEP }, d);
    n += r.modifiedCount;
  }
  console.log(`${APPLY ? 'REVERTED' : 'DRY RUN revert of'} ${APPLY ? n : docs.length} cards from ${REVERT}`);
  await mongo.close();
  process.exit(0);
}

const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
const todo = results.cards.filter((c) => STATUS_FOR[c.proposed_change]);
const held = results.cards.filter((c) => !STATUS_FOR[c.proposed_change]);
const uncertain = todo.filter((c) => c.verifier_classification === 'uncertain' || c.verifier_result === 'uncertain');
if (uncertain.length) throw new Error(`refusing: ${uncertain.length} cards marked uncertain are in the apply set`);

const live = new Map((await col.find({ _id: { $in: todo.map((c) => c.card_id) } }).toArray()).map((d) => [d._id, d]));
const now = new Date().toISOString();
const diff = [];
const writes = [];
const skipped = [];
for (const c of todo) {
  const doc = live.get(c.card_id);
  if (!doc) { skipped.push({ card_id: c.card_id, why: 'card missing' }); continue; }
  if (doc.status !== c.current_status) { skipped.push({ card_id: c.card_id, why: `status now ${doc.status}, verifier saw ${c.current_status}` }); continue; }
  const p = plan(c, doc, now);
  if (p.problems.length) { skipped.push({ card_id: c.card_id, why: p.problems.join('; ') }); continue; }
  const set = {
    status: p.status,
    entries: p.entries,
    entries_superseded_4575: doc.entries ?? [],
    'review.prev_status_4575': doc.status,
    'review.change_4575': c.proposed_change,
    'review.verified_by': 'claude:ft-cards-4575 (Opus subagent, ft-verify; opened sources)',
    'review.verified_at': `${results.date}T00:00:00.000Z`,
    'review.issue': '#4575',
    'review.applied_by': SWEEP,
    'review.applied_at': now,
    'review.notes_4575': String(c.reasoning || c.strongest_prior || '').slice(0, 600),
    updated_at: new Date(now),
  };
  if (p.excluded.length) set['review.excluded_entries_4575'] = p.excluded;
  if (c.proposed_change === 'hold_english_original') {
    Object.assign(set, { 'review.identity_flag': true, 'review.held_from_status': doc.status, 'review.hold_reason': 'english_original', 'review.held_at': now, 'review.held_by': SWEEP });
  }
  diff.push({ card_id: c.card_id, change: c.proposed_change, status: [doc.status, p.status], entries: [(doc.entries ?? []).length, p.entries.length], excluded: p.excluded.length, entries_after: p.entries.map((e) => `${e.translator ?? '?'} ${e.year ?? ''} [${e.completeness ?? ''}${e.register ? `, ${e.register}` : ''}]`) });
  writes.push({ c, doc, set });
}
writeFileSync(`${OUT}/planned.jsonl`, writes.map((w) => JSON.stringify({ _id: w.c.card_id, change: w.c.proposed_change, status: w.set.status, entries: w.set.entries })).join('\n') + '\n');
writeFileSync(`${OUT}/diff.jsonl`, diff.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(`${OUT}/skipped.json`, JSON.stringify(skipped, null, 1));

// The books whose pages render these cards, read live (work_id is the join the book page uses).
const books = await db.collection('books').find({ work_id: { $in: writes.map((w) => w.c.card_id) } },
  { projection: { id: 1, work_id: 1, visible: 1, pages_translated: 1, prior_translation: 1 } }).toArray();
const bookId = (b) => b.id || String(b._id);
writeFileSync(`${OUT}/book-ids.txt`, books.filter((b) => b.visible).map(bookId).join('\n') + '\n');
const ledger = [];
for (const w of writes) {
  for (const b of books.filter((x) => x.work_id === w.c.card_id)) {
    ledger.push({
      book_id: bookId(b), work: w.c.work, author: w.c.author, direction: 'card-review', bucket: `card-${w.c.proposed_change}`,
      result: LEDGER_RESULT[w.c.proposed_change], model: 'claude-opus-5-5',
      priors: (w.c.verified_priors ?? []).map((p) => ({ translator: p.translator, year: p.year, english_title: p.english_title, completeness: p.completeness, relationship: p.relationship, source_url: p.source_url })),
      evidence_url: w.c.evidence_url ?? null, queries_run: w.c.queries_run ?? [], sources_consulted: w.c.sources_consulted ?? [],
      reasoning: `Work-level card review (#4575), card ${w.c.card_id} → ${STATUS_FOR[w.c.proposed_change]}. ${String(w.c.reasoning ?? '').slice(0, 800)}`,
    });
  }
}
writeFileSync(`${OUT}/ledger-input.json`, JSON.stringify(ledger, null, 1));

const tally = (xs, k) => xs.reduce((t, x) => ((t[k(x)] = (t[k(x)] ?? 0) + 1), t), {});
console.log(`${SWEEP} [${APPLY ? 'APPLY' : 'DRY RUN'}] ${now}`);
console.log(`results: ${results.cards.length} cards; in the apply set: ${todo.length}; held by the results (not applied): ${held.length}`);
console.log(`to write: ${writes.length} ${JSON.stringify(tally(writes, (w) => w.c.proposed_change))}`);
console.log(`skipped: ${skipped.length} → ${OUT}/skipped.json`);
console.log(`books on these works: ${books.length} (${books.filter((b) => b.visible).length} visible); ledger rows prepared: ${ledger.length}`);
console.log(`diff → ${OUT}/diff.jsonl`);

if (!APPLY) {
  console.log('DRY RUN — nothing written. Re-run with --apply.');
  await mongo.close();
  process.exit(0);
}

const backup = `${OUT}/backup-${now.replace(/[:.]/g, '-')}.jsonl`;
writeFileSync(backup, writes.map((w) => BSON.EJSON.stringify(w.doc, { relaxed: false })).join('\n') + '\n');
const { recordSweepAction } = await import('../lib/sweep-log.mjs');
let modified = 0;
const lost = [];
for (const w of writes) {
  const r = await col.updateOne({ _id: w.c.card_id, status: w.c.current_status }, { $set: w.set });
  if (!r.modifiedCount) { lost.push(w.c.card_id); continue; }
  modified++;
  await recordSweepAction(db, { sweep: SWEEP, book_id: w.c.books?.[0]?.id ?? w.c.card_id, action: `card-${w.c.proposed_change}`,
    detail: { work_id: w.c.card_id, before: w.doc.status, after: w.set.status } }).catch(() => {});
}
// Post-write verification: read the cards back, not our own counter.
const after = await col.find({ 'review.applied_by': SWEEP }, { projection: { status: 1, 'review.change_4575': 1 } }).toArray();
console.log(`APPLIED: modifiedCount ${modified}; lost to a concurrent change: ${lost.length} ${JSON.stringify(lost)}`);
console.log(`read back: ${after.length} cards carry review.applied_by=${SWEEP}: ${JSON.stringify(tally(after, (d) => `${d.review.change_4575}→${d.status}`))}`);
console.log(`backup: ${backup}`);
console.log(`revert: node --env-file=.env.production.local scripts/maintenance/apply-card-contradictions-4575.mjs --revert=${backup} --apply`);
await mongo.close();
