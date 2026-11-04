/**
 * mint-local-work-ids.mjs — deterministic local work_id backbone.
 *
 * The lesson from #1634 + the Wikidata-resolver exhaustion (re-run on the full
 * Latin gap = 0 new HIGH): external authorities (Wikidata QIDs) only cover the
 * famous classical core. They will never reach the early-modern esoteric tail,
 * because Wikidata simply doesn't model those individual works as items.
 *
 * So a work_id does NOT have to be resolved against an external authority. It
 * can be MINTED deterministically from what we already hold:
 *       work_id = local:{author_id}:{uniform-title-slug}
 * keyed off the canonical author thesaurus (author_id) + a normalized uniform
 * title. This is the OCLC work-key pattern (author authority + normalized
 * title), applied locally.
 *
 * SAFE BY CONSTRUCTION (the project's "under-cluster over mis-cluster" rule):
 *  - two editions of one work with divergent titles -> different slugs ->
 *    harmless under-cluster (a later, human-gated merge pass collapses them).
 *  - two genuinely different works -> collide only if same author_id AND same
 *    normalized title token-set -> that is the same work anyway.
 * Deterministic minting therefore never creates a false MERGE; its only error
 * mode is leaving two editions un-merged, which is the safe direction.
 *
 * The uniform-title slug uses the OCLC trick: distinctive tokens, author name
 * stripped, edition/apparatus words stripped, then ALPHABETICALLY SORTED so
 * "Three Books of Occult Philosophy" and "Occult Philosophy: Three Books"
 * collapse to one key for free.
 *
 *   node scripts/analysis/mint-local-work-ids.mjs              # dry-run: coverage jump + samples
 *   node scripts/analysis/mint-local-work-ids.mjs --apply      # write work_id (+backup)
 *   node scripts/analysis/mint-local-work-ids.mjs --include-anon   # also mint anonymous (>=2 distinctive tokens)
 *
 * Writes: work_id, work_title (uniform title display), work_id_source:'local-mint',
 *         work_id_confidence:'deterministic'. Backup to scripts/output/.
 * Issue #2318 / #2264 / #1634.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { deacc, slug, authorTokens, mintAuthorPart, remintAliasPlan } from '../lib/work-id-remint.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const INCLUDE_ANON = process.argv.includes('--include-anon');
// --singletons-only: write work_id ONLY for books whose mint is unique (cluster
// size 1). Mathematically zero merge risk — a unique label on one book. The
// multi-edition clusters are held for the human-gated merge review instead.
const SINGLETONS_ONLY = process.argv.includes('--singletons-only');
// Multi-volume sets / periodical issues ("Vol. 8", "No. 6", juan slices) cannot
// be safely fused by uniform title — "one work in N volumes" vs "N works in a
// series" (Wubei Zhi vols = one work; Nicene & Post-Nicene Fathers Vol 8 Basil
// vs Vol 9 Hilary = different works) is a curatorial call, and the single-digit
// volume number drops out of the token filter, so they falsely cluster. So by
// DEFAULT we HOLD any multi-edition cluster whose members carry a part/volume
// marker (singletons are always safe). Pass --include-parts to mint them anyway.
const INCLUDE_PARTS = process.argv.includes('--include-parts');

const PART_RX = /(\bvol\b|\bvolume\b|\bno\b|\bnos\b|\bband\b|\btome\b|\btomus\b|\bteil\b|\bheft\b|\bpt\b|\bpart\b|\blivre\b|\bfasc\b|\bser\b|\bseries\b|\bjuan\b|slice|卷|册|巻)\.?\s*[ivxlcdm0-9]/i;
const clusterHasParts = bks => bks.length > 1 && bks.some(x => PART_RX.test(deacc(x.display_title || x.title || '')));
// Apparatus / edition words ONLY — pure publication-process words. We do NOT
// strip numbers, roman numerals, or volume LETTERS: those distinguish works
// (Proverbs collection 25 vs 15; Kanjur mDo sde Ka vs Kha). Bias is hard toward
// UNDER-clustering — a wrongly-split edition is harmless (merge pass joins it);
// a wrongly-fused pair of distinct works is the error we must never make.
const STOP = new Set(['the','a','an','of','and','or','with','to','in','for','on','de','von','di','le','la','les','des','du','het','een',
  'commentary','translation','translated','trans','edition','edited','ed','text','complete','selected',
  'new','revised','reprint','facsimile','being','containing','together','his','its','her','their']);
// catalog/library/provenance boilerplate that leaks into titles and falsely
// fuses unrelated records (the Harvard-Yenching Korean over-merge). Strip it so
// it can't BECOME the key — a title left with only boilerplate won't mint.
const BOILER = new Set(['harvard','yenching','library','sn','ms','mss','cod','codex','shelf','call','number','sine','nomine','copy','scan','digiti','digitized','microfilm','collection','various','unknown','anonymous','google','archive','internet']);

function uniformTitle(title, authorStr, siglaSource) {
  const at = authorStr ? authorTokens(authorStr) : new Set();
  const raw = deacc(title);
  // sigla come from the FULL title — `display_title` often strips the distinguishing
  // parenthetical ("A Balbale to Inana (ETCSL 4.07.1)" → "A Balbale to Inana"), which
  // would re-fuse distinct works. Read sigla from the raw title to recover it.
  const siglaRaw = deacc(siglaSource || title);
  // SHORT parentheticals are usually a SIGLUM that identifies a distinct work —
  // "(Šulgi C)", "(ETCSL 4.08.06)", "(Dumuzid-Inana Y)" are DIFFERENT compositions.
  // Pull them out as distinguishing tokens (keeping single chars C/X that the main
  // filter would drop) so they SPLIT. Long/descriptive parens (translations) stay
  // dropped. Policy: when in doubt, MORE works.
  const sigla = [];
  siglaRaw.replace(/[\(\[]([^)\]]{1,22})[\)\]]/g, (m, inner) => {
    for (const w of inner.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
      // keep ONLY siglum-like tokens that identify a distinct work: a single
      // letter (Šulgi C / X), a number (ETCSL 4.08.06), or a known catalog code.
      // NOT descriptive gloss words ("Secret of Secrets") — those would over-split
      // legit cross-language clusters.
      if (w && (w.length === 1 || /[0-9]/.test(w) || /^(etcsl|ms|mss|cod|frag|rec|ct|bm)$/.test(w))
        && !STOP.has(w) && !at.has(w)) sigla.push(w);
    }
    return ' ';
  });
  // main title with parens stripped; keep single-DIGIT numbers (Vol 8 / Series 1),
  // single LETTERS only survive via the sigla path above.
  const s = raw.replace(/[\(\[].*?[\)\]]/g, ' ');
  const main = s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => (w.length >= 2 || /^[0-9]+$/.test(w)) && !STOP.has(w) && !BOILER.has(w) && !at.has(w));
  const toks = [...main, ...sigla];
  const uniq = [...new Set(toks)].sort();           // alphabetical -> word-order-invariant key
  return uniq.slice(0, 12);                           // longer cap: keep distinguishers
}
const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await mc.connect();
const b = mc.db('bookstore').collection('books');

// --include-hidden: also mint hidden/draft books (ownership truth for the #2453
// catalog dedup — the Philo-16-hidden-editions case). Reader /work pages still
// gate on visibility downstream; this only assigns the work_id join key.
const INCLUDE_HIDDEN = process.argv.includes('--include-hidden');
// --remint-local: also RE-derive existing local-mint work_ids (to apply improved
// normalization — split a fusion that an earlier mint made). Only ever overwrites
// work_id_source:'local-mint'; wikidata / work-merge / hand ids are untouched.
const REMINT = process.argv.includes('--remint-local');
const TEXT = { pages_count: { $gt: 0 }, language: { $nin: ['Visual', 'Unknown', null] },
  ...(INCLUDE_HIDDEN ? {} : { visible: true }) };
const total = await b.countDocuments(TEXT);
const already = await b.countDocuments({ ...TEXT, work_id: { $exists: true, $ne: null } });

const gapOr = [{ work_id: { $exists: false } }, { work_id: null }];
if (REMINT) gapOr.push({ work_id_source: 'local-mint' });
const gap = await b.find(
  { ...TEXT, $or: gapOr },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, author_id: 1, language: 1, year: 1, work_id: 1 } }
).toArray();
console.log(`Textual books: ${total} | already have work_id: ${already} (${(100*already/total).toFixed(1)}%)`);
console.log(`Gap (no work_id): ${gap.length}\n`);

// Generic collected-works CONTAINER words. A title that reduces to ONLY these is
// not a single work — "Works of Plato" is a compilation, and Plato had many works.
// So such editions get a UNIQUE per-book work_id (more works, no false mega-work)
// instead of all fusing into local:a:plato:works.
const CONTAINER = new Set(['works', 'work', 'opera', 'omnia', 'opuscula', 'dialogues',
  'collected', 'writings', 'miscellanea', 'collection', 'anthology', 'compendium', 'corpus']);

// A manuscript catalogued only by what it IS ("Theologische Sammelhandschrift",
// "Handschrift", "Document") names an object, not a work; its identity is the
// shelfmark in the parenthesis the title filter drops. These fused 67 different
// Bodleian manuscripts into one work, and 42 calligraphy sheets by one hand into
// another (spot check 2026-10-28, #3780). Treated like a container: one work id
// per book. Named works in
// manuscript ("Sīrat ʿAntar", "Breviarium Carthusiense") are unaffected.
const MS_HEAD = new Set(['handschrift', 'sammelhandschrift', 'manuscript', 'manuscripts', 'codex', 'fragment',
  'fragmente', 'fragments', 'document', 'documents', 'specimen', 'calligraphy', 'miscellany', 'sammelband', 'konvolut']);
const MS_QUALIFIER = new Set(['theologische', 'theological', 'lateinische', 'deutsche', 'liturgische', 'medizinische',
  'juristische', 'astronomische', 'alchemistische', 'philosophische', 'historische', 'religious', 'legal', 'persian', 'arabic', 'zusammengesetzte', 'rhetorische', 'poetische', 'grammatische', 'album',
  'cod', 'ms', 'hs']);
const isBareMsTitle = (toks) => toks.some(t => MS_HEAD.has(t)) && toks.every(t => MS_HEAD.has(t) || MS_QUALIFIER.has(t) || /^\d+$/.test(t));

const writes = [];          // {id, work_id, work_title}
const clusters = new Map();  // work_id -> [book,...]
let skippedNoKey = 0, skippedAnon = 0, skippedEmptySlot = 0, containerUnique = 0;

for (const bk of gap) {
  const titleRaw = bk.display_title || bk.title || '';
  const toks = uniformTitle(titleRaw, bk.author, bk.title);   // sigla from full title
  const { part: authorPart, reason: noAuthorReason } = mintAuthorPart(bk);

  // an author that normalises to nothing (CJK/Arabic byline, "Ed.") would mint
  // `local:n::<title>` — title tokens only, and a guaranteed re-mint the day the
  // author is resolved. Refuse, even under --include-anon: this is not an
  // anonymous work, it is one whose key we cannot build yet (#4329).
  if (noAuthorReason === 'empty-slot') { skippedEmptySlot++; continue; }

  // anonymous (no author at all): only mint with a distinctive (>=2 token) title
  if (!authorPart) {
    if (!INCLUDE_ANON || toks.length < 2) { skippedAnon++; continue; }
  }
  if (toks.length < 1) { skippedNoKey++; continue; }

  // container-only title → unique per edition (don't fuse a whole author's corpus)
  // with or without a maker: 42 sheets titled "Calligraphy specimen" by one
  // calligrapher are 42 objects, and "Unknown"/"Not Traceable" arrive as author strings anyway
  const isContainer = toks.every(t => CONTAINER.has(t)) || isBareMsTitle(toks);
  if (isContainer) containerUnique++;
  const tslug = isContainer ? `${slug(toks)}-ed-${bk.id}` : slug(toks);
  const work_id = `local:${authorPart || 'anon'}:${tslug}`;
  const work_title = titleRaw.slice(0, 200);
  writes.push({ id: bk.id, work_id, work_title });
  if (!clusters.has(work_id)) clusters.set(work_id, []);
  clusters.get(work_id).push(bk);
}

const multi = [...clusters.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
const singletons = clusters.size - multi.length;
// under --remint-local the gap includes already-minted local-mint books, so they
// overlap `already` — don't double-count. Cap at total.
const newCoverage = Math.min(total, REMINT ? already : already + writes.length);

console.log('── Mint result ──');
console.log(`Mintable books: ${writes.length} (${skippedNoKey} no-distinctive-title, ${skippedEmptySlot} author-unnormalisable (refused: would mint an empty author slot), ${skippedAnon} anonymous skipped${INCLUDE_ANON ? '' : ' — pass --include-anon to mint distinctive anon titles'})`);
console.log(`Distinct local works minted: ${clusters.size} (${singletons} singletons, ${multi.length} multi-edition clusters)`);
console.log(`Coverage: ${already} -> ${newCoverage} / ${total}  (${(100*already/total).toFixed(1)}% -> ${(100*newCoverage/total).toFixed(1)}%)\n`);

console.log('── Multi-edition clusters found (the dedup candidates) ──');
console.log(`${multi.length} works with >1 edition; top by size:`);
for (const [wid, bks] of multi.slice(0, 14)) {
  console.log(`\n  ${wid}  (${bks.length})`);
  for (const x of bks.slice(0, 5)) console.log(`     ${(x.display_title || x.title || '?').slice(0, 64)}  [${x.language || '?'}${x.year ? ' ' + x.year : ''}]`);
}

console.log('\n── Sample singleton mints (sanity check the slug) ──');
let shown = 0;
for (const [wid, bks] of clusters) {
  if (bks.length !== 1) continue;
  console.log(`  ${(bks[0].display_title || bks[0].title || '?').slice(0, 50).padEnd(52)} -> ${wid}`);
  if (++shown >= 10) break;
}

const outDir = new URL('../output/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}local-work-mint-proposals.json`, JSON.stringify({
  total, alreadyCovered: already, minted: writes.length, distinctWorks: clusters.size,
  multiEditionClusters: multi.length, singletons,
  newCoverage, newCoveragePct: +(100*newCoverage/total).toFixed(1),
  clusters: multi.map(([wid, bks]) => ({ work_id: wid, size: bks.length, books: bks.map(x => ({ id: x.id, title: x.display_title || x.title, language: x.language, year: x.year })) })),
}, null, 2));
console.log(`\nProposal -> ${outDir}local-work-mint-proposals.json`);

if (APPLY) {
  // SINGLETONS_ONLY: write only books whose mint is unique (cluster size 1) —
  // zero merge risk. Multi-edition clusters are held for the human-gated merge.
  let toWrite = SINGLETONS_ONLY ? writes.filter(w => clusters.get(w.work_id).length === 1) : writes;
  // hold ambiguous multi-volume / series / periodical clusters unless --include-parts
  let heldParts = 0;
  if (!INCLUDE_PARTS) {
    const before = toWrite.length;
    toWrite = toWrite.filter(w => !clusterHasParts(clusters.get(w.work_id)));
    heldParts = before - toWrite.length;
  }
  // Under --remint-local most books re-derive the id they already carry. Writing
  // those anyway rewrote all ~410K local mints for a 78K-book change (2026-10-28,
  // #3780), too heavy to run nightly. Write only the ids that move.
  let unchanged = 0;
  if (REMINT) {
    const currentOf = new Map(gap.map(bk => [bk.id, bk.work_id]));
    const before = toWrite.length;
    toWrite = toWrite.filter(w => currentOf.get(w.id) !== w.work_id);
    unchanged = before - toWrite.length;
  }
  const heldClusters = writes.length - toWrite.length - unchanged;
  // A re-mint MOVES an id that queue rows, /work URLs and citations already
  // hold. Where a whole cluster moves to one new id, keep the old id as an
  // alias so those references still resolve (#4329); splits and partial moves
  // get none — see scripts/lib/work-id-remint.mjs.
  const { aliasFor, tally: aliasTally, moves } = REMINT
    ? await remintAliasPlan(b, toWrite)
    : { aliasFor: new Map(), tally: null, moves: [] };
  const priorOf = new Map(moves.map(m => [m.id, m.from]));
  const backup = `${outDir}local-work-mint-backup-${toWrite.length}.json`;
  fs.writeFileSync(backup, JSON.stringify({ when: 'apply', singletonsOnly: SINGLETONS_ONLY, holdParts: !INCLUDE_PARTS, heldParts, count: toWrite.length,
    writes: toWrite.map(w => ({ ...w, ...(REMINT ? { old_work_id: priorOf.get(w.id) ?? null, alias_added: aliasFor.get(w.id) ?? null } : {}) })) }, null, 2));
  if (aliasTally) console.log(`re-mint trail: ${aliasTally.renamed} old ids kept as aliases (${aliasFor.size} books); ${aliasTally.split} split and ${aliasTally.partial} partially-moved ids get no alias`);
  console.log(`\n--apply${SINGLETONS_ONLY ? ' --singletons-only' : ''}${INCLUDE_PARTS ? ' --include-parts' : ''}: writing ${toWrite.length} work_ids${heldClusters ? ` (holding ${heldClusters} for review${heldParts ? `, of which ${heldParts} are volume/series-marked` : ''})` : ''} (backup ${backup})${unchanged ? `; ${unchanged} unchanged, not rewritten` : ''}`);
  // A moved id is a change to a join key that queue rows, /work URLs and the
  // translation joins hold, and the book keeps only the new value. Log every move
  // as a sweep_log row BEFORE writing, so "why did this book's work change, and
  // from what?" is answerable from the database, not from a backup on one disk.
  if (REMINT) {
    const run = `work-id-remint-${new Date().toISOString().slice(0, 10)}`;
    const rows = toWrite.filter(w => priorOf.get(w.id) && priorOf.get(w.id) !== w.work_id).map(w => ({ sweep: run, book_id: w.id, action: 'work-id-reminted',
      detail: { from: priorOf.get(w.id), to: w.work_id, alias_kept: aliasFor.get(w.id) ?? null, backup } }));
    if (rows.length) await recordSweepActions(mc.db('bookstore'), rows);
    console.log(`sweep_log: ${rows.length} moves recorded under ${run}`);
  }
  let done = 0;
  for (const w of toWrite) {
    const idFilter = REMINT
      ? { id: w.id, $or: [{ work_id: { $in: [null, undefined] } }, { work_id_source: 'local-mint' }] }
      : { id: w.id, work_id: { $in: [null, undefined] } };
    const alias = aliasFor.get(w.id);
    const r = await b.updateOne(
      // the alias was planned against the id read a moment ago; if another
      // writer moved the book since, skip it rather than alias the wrong id
      alias ? { ...idFilter, work_id: alias } : idFilter,
      { $set: { work_id: w.work_id, work_title: w.work_title, work_id_source: 'local-mint', work_id_confidence: 'deterministic', updated_at: new Date() },
        ...(alias ? { $addToSet: { work_id_aliases: alias } } : {}) }
    );
    done += r.modifiedCount;
    if (done % 1000 === 0) console.log(`  ${done}/${toWrite.length}`);
  }
  console.log(`applied: ${done} modified`);
}

await mc.close();
