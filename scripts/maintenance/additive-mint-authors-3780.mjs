#!/usr/bin/env node
/**
 * Stage 3 of #3780 — ADDITIVE minting for classified author strings.
 *
 * Input: a classification file (one JSON object per line):
 *   {"string": "...", "verdict": "person"|"institution"|..., "canonical_name": "...", "note": "..."}
 * produced by the stage-2 review of enumerate-unmatched-author-strings.mjs
 * output (heuristic buckets + per-string classification by Claude agents, with
 * the person/institution calls being the only ones acted on here).
 *
 * WHY ADDITIVE, NOT A REBUILD. build-authors-collection.mjs over all books
 * would re-cluster the whole thesaurus and can silently relink live books
 * (#3780's stated non-goal). This script only ever:
 *   - APPENDS a variant to an existing doc when the string's cluster key
 *     (the builder's canonicalKey) already belongs to a canonical person —
 *     extending recall without reshaping anything; or
 *   - MINTS a new doc when the key matches nothing — a new person cannot
 *     reshape existing clusters by construction.
 * Institutions are minted with is_person: false (the read-path gate, #3483)
 * so they render as Organization, never as a portrait-slot person.
 *
 * Strings whose key lands on a QUARANTINED doc (is_person: false) or a
 * tombstone (merged_into) are skipped and reported — a person string keying
 * into a non-person cluster needs eyes, not automation.
 *
 * POISON-FORM GUARD (added 2026-08-28 after #4313). A variant is a MATCH KEY:
 * `backfill-author-canonical-links.mjs` links every book whose author string
 * equals it. So a BARE FORENAME variant is not a weak match, it is a trapdoor
 * onto the wrong person — the `jan-hus` doc carried the bare variant
 * "Johannes" and thereby claimed 115 books by Chrysostom, Sacrobosco, Duns
 * Scotus and John of Salisbury. Uniqueness is not validity: the string matched
 * exactly one doc, which is precisely why the backfill trusted it.
 * The mechanical tell is measurable in our own corpus — count the DISTINCT
 * people (canonicalKey) whose author string extends the candidate:
 *   Johannes 77 · Thomas 67 · Alexander 31 · Petrus 19 · Leo 13
 *   vs Aristoteles 1 · Cicero 4 · Boethius 5 · Paracelsus 6
 * Single-token candidates at or above POISON_MIN_EXTENDERS are refused and
 * reported rather than minted or appended. It is a NET, not a verdict: a
 * bare forename below the threshold is still a bad variant, which is why the
 * classification step must call bare forenames `uncertain` in the first place.
 *
 * After applying, run:
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --include-backlog --apply
 * which links books by exact NFD variant match to exactly one doc (its own
 * safety rules, provenance, and --undo).
 *
 * AUTHORITY IDS (added 2026-10-07 for the Tengyur, #6145). A verdict may carry
 * `authority: { bdrc: "P6120" }` — the person's id in an external authority that
 * already separates namesakes. canonicalKey folds "Dharmakīrti I", "Dharmakīrti
 * II" and the translator BDRC also labels "Dharmakīrti" onto ONE key
 * (`dharmakirt`), and the same-run convergence below would have merged three
 * men into one doc. With an authority id the id decides, not the key:
 *   - two verdicts with different ids never converge — each mints its own doc;
 *   - an existing doc that already carries a DIFFERENT id is never appended to;
 *   - minted docs carry `bdrc_ids: [id]`, and appends add the id to the doc,
 *     so a resolver can join on the id instead of a name.
 * Further optional verdict fields: `slug` (explicit doc id, still clash-checked),
 * `extra_variants` (other catalogue forms of the SAME person, e.g. the Wylie
 * name), `link_to` (a hand-reviewed existing doc: append there, no key match),
 * and `standalone: true` (a reviewed REJECTED match: mint, never append).
 * Run with `--source=<tag> --backup=<path>` so a batch reverts on its own.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/additive-mint-authors-3780.mjs --input <verdicts.jsonl>           # dry-run
 *   node --env-file=.env.production.local scripts/maintenance/additive-mint-authors-3780.mjs --input <verdicts.jsonl> --apply
 *   node --env-file=.env.production.local scripts/maintenance/additive-mint-authors-3780.mjs --revert   # remove minted docs + appended variants
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const INPUT = (process.argv.find(a => a.startsWith('--input=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--input') + 1];
const argv = (k) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || null;
const BACKUP = argv('backup') || 'scripts/output/additive-mint-3780-backup.json';
const SOURCE = argv('source') || 'additive-mint-3780';
const PLAN_OUT = argv('plan');   // optional: write the full plan (mints, appends, skips, notes) as JSON

// The builder's clustering + slug rules — shared via scripts/lib/author-name-key.mjs.
import { norm, canonicalKey, authorSlug } from '../lib/author-name-key.mjs';

// See POISON-FORM GUARD above. Threshold chosen from the measured corpus
// separation, and deliberately loose — a false positive costs one review line,
// a false negative costs a wrong byline on every book carrying the string.
const POISON_MIN_EXTENDERS = 5;

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const authors = db.collection('authors');

// ── revert ───────────────────────────────────────────────────────────────────
if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP}.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const del = await authors.deleteMany({ _id: { $in: saved.minted }, source: SOURCE });
  let pulls = 0;
  for (const ap of saved.appended) {
    const r = await authors.updateOne({ _id: ap.doc }, { $pull: { variants: { $in: [ap.variant, ...(ap.extra_variants || [])] }, variant_slugs: ap.variant_slug || '__none__', ...(ap.bdrc ? { bdrc_ids: ap.bdrc } : {}) } });
    pulls += r.modifiedCount;
  }
  console.log(`Reverted: deleted ${del.deletedCount} minted docs, pulled variants from ${pulls} docs.`);
  console.log('NOTE: if the backfill already linked books to these, run its --undo too.');
  await mc.close();
  process.exit(0);
}

if (!INPUT || !existsSync(INPUT)) { console.error('Pass --input <verdicts.jsonl>'); process.exit(1); }
const verdicts = readFileSync(INPUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const actionable = verdicts.filter(v => (v.verdict === 'person' && v.canonical_name) || v.verdict === 'institution');
console.log(`${verdicts.length} verdicts; acting on ${actionable.length} (person-with-name + institution). Others (compound/editor/defect/placeholder/uncertain) untouched.`);

// ── index existing docs: normalized variant -> doc, cluster key -> doc ───────
const byVariant = new Map();
const byKey = new Map();
const usedIds = new Set();
const byId = new Map();
const byQid = new Map();
for await (const a of authors.find({}, { projection: { canonical_name: 1, variants: 1, merged_into: 1, is_person: 1, bdrc_ids: 1, wikidata_id: 1 } })) {
  byId.set(a._id, a);
  if (a.wikidata_id) byQid.set(a.wikidata_id, a._id);
  usedIds.add(a._id);
  for (const v of new Set([...(a.variants || []), a.canonical_name].filter(Boolean))) {
    if (!byVariant.has(norm(v))) byVariant.set(norm(v), a);
    const k = canonicalKey(v);
    if (k && !byKey.has(k)) byKey.set(k, { ...a, viaVariant: v });
  }
}
console.log(`existing docs indexed: ${usedIds.size}`);

// Hand-reviewed exclusions (2026-08-09): key collisions that are NOT the same
// person. Each routes to the review report instead of writing.
const EXCLUDE_APPEND = new Set([
  'marbode-of-rennes|Pictorius, Georg',        // Pictorius EDITED Marbode's De lapidibus; doc carries a pre-existing conflated variant
  'saint-jerome|Osius, Hieronymus',            // Hieronymus Osius, 16th-c. Wittenberg poet — not Jerome
  'wang-gai|王珪 Wang Gui (Yuan)',              // Wang Gai (Mustard Seed Garden) ≠ Wang Gui
  'rhumelius-johann-conrad-ii|Rhumel, Johann Conrad', // Nuremberg physician father/son — conflation risk
  // 2026-08-28, verified against each doc's own books:
  'leo|Leo (I., Papst)',        // the `leo` doc is a trailing-comma artifact ("Leo,") holding one book catalogued Unknown — not Pope Leo I
  'george-more|Mor, Georgius',  // Q5542611 is the English clergyman of the 1600 possession tract, not a Latin academic byline
]);

// ── poison-form index: how many DISTINCT people extend each candidate form? ──
// Built from books.author because that is the population the backfill matches
// against — the thesaurus cannot show us a trapdoor it does not yet contain.
// Both the source string AND the display name are candidates: the string
// becomes a variant, and so does the display unless buildDoc withholds it —
// which it can only do if this index scored it.
const candidateForms = new Set(
  actionable.flatMap(v => [v.string, v.canonical_name, ...(v.extra_variants || [])])
    .map(s => norm(s || '').trim())
    .filter(s => s && !/[\s,]/.test(s)),
);
const extenders = new Map();    // bare form -> Set of canonicalKey of extending strings
const stemOwners = new Map();   // single stem -> Set of full canonicalKeys containing it
{
  const strings = await db.collection('books').aggregate([
    { $match: { author: { $type: 'string', $nin: ['', null] }, content_type: { $ne: 'artwork' } } },
    { $group: { _id: '$author' } },
  ], { allowDiskUse: true }).toArray();
  for (const form of candidateForms) extenders.set(form, new Set());
  // Index by first token so this stays linear in the corpus, not forms × corpus.
  for (const r of strings) {
    const n = norm(r._id).trim();
    const key = canonicalKey(r._id);
    for (const stem of key.split(' ')) {
      if (!stem) continue;
      if (!stemOwners.has(stem)) stemOwners.set(stem, new Set());
      stemOwners.get(stem).add(key);
    }
    const head = n.split(/[\s,]+/)[0];
    if (!head || head === n) continue;          // the bare form itself is not its own extender
    const bucket = extenders.get(head);
    if (bucket) bucket.add(canonicalKey(r._id));
  }
  const flagged = [...extenders.entries()].filter(([, k]) => k.size >= POISON_MIN_EXTENDERS);
  console.log(`poison-form scan: ${candidateForms.size} single-token candidates, ${flagged.length} at or above ${POISON_MIN_EXTENDERS} distinct extending people`);
}

/**
 * Is this cluster key too thin to identify a person on its own?
 *
 * canonicalKey strips Latin case endings and then drops anything under three
 * characters, which can annihilate a short surname outright: "Hus, Johannes"
 * keys to `iohannes` — the bare forename — because `hus` loses its `us` and
 * falls under the length floor. That is the structural root of #4313, one layer
 * beneath the bare variant that was pulled: even with the variant gone, Jan Hus
 * and Pope John XXI still share a cluster key. Same shape collapses "G.U. Pope"
 * and "Pius V, Pope" onto `pop`.
 *
 * So a key of a single stem is only trustworthy when few distinct people in the
 * corpus carry that stem. This gates MATCHING onto an existing doc, never
 * minting: a new doc for a mononym is safe, adopting someone else's is not.
 */
const keyTooThinToMatch = (key) => {
  const stems = key.split(' ').filter(Boolean);
  if (stems.length !== 1) return 0;
  const owners = stemOwners.get(stems[0])?.size || 0;
  return owners >= POISON_MIN_EXTENDERS ? owners : 0;
};

/**
 * Hand-adjudicated overrides of the thin-key guard (2026-08-28). Each is an
 * honorific, dated, or other-language form of the doc's OWN mononym, so the
 * append is the same person: "Athanasius, St" onto `athanasius`.
 *
 * Everything the guard flags that is NOT listed here mints its own doc, which
 * is the right outcome — Pope John XXI, Pope Paul III, Pius V, Jacob Reiß,
 * Alberto Pio and Paulus Buis are separate people who were being appended onto
 * jan-hus, n-c-paul, g-u-pope, jacobus-du-bois and albertus-magnus purely
 * because a stemmed surname collapsed. Do not add an entry without checking
 * that the doc is the same human, not merely a similar-looking key.
 */
const ALLOW_APPEND = new Set([
  'athanasius|Athanasius, St',
  'saint-jerome|Hieronymus, St',          // Hieronymus IS Jerome
  'bonaventura|Bonaventura, St',
  'ambrose-of-milan|Ambrosius, St',
  'anselm|Anselm, St',
  'erasmus|Érasme',                       // French form
  'vitruvius|Vitruvius, ca. v1. Jh.',
  'galen|Galenus, 129-199',
  'thomas-aquinas|Thomas (von Aquin, Heiliger)',
]);

const mints = [];      // { _id, doc }
const appends = [];    // { doc, variant, variant_slug }
const skips = [];
const notes = [];      // decisions worth reading even though they are not skips
const claimedKeys = new Map();   // key -> minted doc id, so same-person strings in one run converge
const claimedAuthority = new Map(); // minted doc id -> its authority id (bdrc), so different ids never converge
const authorityOf = (v) => v.authority?.bdrc || null;
// Does an existing doc already belong to a DIFFERENT authority id?
const otherAuthority = (doc, v) => Boolean(authorityOf(v) && doc?.bdrc_ids?.length && !doc.bdrc_ids.includes(authorityOf(v)));
const mintedBySlug = new Map();  // slug -> { source } for docs minted THIS run, to resolve slug clashes

// The CJK characters of a string, in order — the part romanization throws away.
const cjkOf = (s) => ((s || '').match(/[㐀-䶿一-鿿豈-﫿]/g) || []).join('');

/**
 * Do two CJK name forms denote different people? Only when NEITHER contains the
 * other. Catalogue forms routinely wrap the same name in qualifiers — a dynasty
 * marker （宋）邵雍, a monastic prefix 釋行均, a role verb 撰 — and those must
 * still read as one person. Plain inequality calls 邵雍 and （宋）邵雍 two men.
 */
const cjkDiffers = (a, b) => {
  const x = cjkOf(a), y = cjkOf(b);
  return Boolean(x && y) && !x.includes(y) && !y.includes(x);
};

/** Distinct people in the corpus whose author string extends this bare form. */
const poisonScore = (form) => extenders.get(norm(form || '').trim())?.size || 0;

const buildDoc = (id, display, s, v) => {
  // canonical_name is for READING; variants[] is what resolvers MATCH on. When
  // the display name is a bare forename ("Albinus" for "Albinus, Platonicus,
  // ca. 2. Jh.") the two must part company: keep the readable name, but leave
  // it out of the match surface, or this doc claims every other Albinus. The
  // source string stays a variant — it is specific, and it is what the books
  // actually carry.
  const displayPoison = display !== s && poisonScore(display) >= POISON_MIN_EXTENDERS;
  if (displayPoison) notes.push(`${JSON.stringify(display)} kept as canonical_name of ${id} but NOT as a variant — ${poisonScore(display)} distinct people extend it`);
  const extra = (v.extra_variants || []).filter(x => x && poisonScore(x) < POISON_MIN_EXTENDERS);
  const variants = [...new Set([...(displayPoison ? [s] : [s, display]), ...extra])];
  return {
    _id: id,
    canonical_name: display,
    slug: id,
    variants,
    variant_slugs: [...new Set(variants.map(authorSlug).filter(Boolean))],
    book_count: v.books ?? null,
    viaf_id: v.viaf_id || null,
    wikidata_id: v.wikidata_id || null,
    entity_ids: [],
    ...(v.verdict === 'institution' ? { is_person: false } : {}),
    ...(authorityOf(v) ? { bdrc_ids: [authorityOf(v)] } : {}),
    source: SOURCE,
    built_at: new Date(),
  };
};

const appendOf = (doc, v, extra = {}) => ({
  doc, variant: v.string, variant_slug: authorSlug(v.string) || null,
  ...(authorityOf(v) ? { bdrc: authorityOf(v) } : {}),
  ...(v.extra_variants?.length ? { extra_variants: v.extra_variants.filter(x => x && poisonScore(x) < POISON_MIN_EXTENDERS) } : {}),
  ...extra,
});

for (const v of actionable) {
  const s = v.string;
  // A hand-reviewed link to an existing doc: append there and nothing else.
  if (v.link_to) {
    const d = byId.get(v.link_to);
    if (!d || d.merged_into || d.is_person === false || otherAuthority(d, v)) { skips.push({ s, why: `link_to ${v.link_to} is missing, a tombstone, quarantined, or another authority's doc` }); continue; }
    appends.push(appendOf(v.link_to, v, { via: 'hand-reviewed link_to' }));
    continue;
  }
  // No two docs may share a wikidata_id (the merge-by-QID discipline): a QID
  // already on a doc means the person is there — review it into link_to.
  if (v.wikidata_id && byQid.has(v.wikidata_id)) { skips.push({ s, why: `wikidata ${v.wikidata_id} is already on doc ${byQid.get(v.wikidata_id)} — review, then set link_to` }); continue; }
  if (byVariant.has(norm(s))) {
    const d = byVariant.get(norm(s));
    if (!authorityOf(v)) { skips.push({ s, why: 'already a variant (matched since enumeration)' }); continue; }
    // With an authority id, an exact string hit is a CANDIDATE, not a match: the
    // string "Samantabhadra" is already on the Jain author's doc. Only a reviewed
    // link_to adopts an existing doc; otherwise mint, and say so.
    if (!v.standalone) { skips.push({ s, why: `exact variant of existing doc ${d._id} — review, then set link_to or standalone` }); continue; }
  }
  const ext = extenders.get(norm(s).trim());
  if (ext && ext.size >= POISON_MIN_EXTENDERS) {
    skips.push({ s, why: `POISON FORM — bare name extended by ${ext.size} distinct people in our own corpus (e.g. ${[...ext].slice(0, 3).join(', ')}); as a variant it would claim all of them` });
    continue;
  }
  const display = v.verdict === 'institution' ? s : v.canonical_name;
  const key = canonicalKey(s);
  // The lookup falls back to the DISPLAY name's key, and that fallback is its
  // own trapdoor: a bare display ("Johannes" for "Qqxtest, Johannes, ca. 9.
  // Jh.") keys straight onto jan-hus even though the source string is specific.
  // Remember which key actually matched, so the thin-key test below judges the
  // key that did the matching rather than the one that happened to be first.
  const displayKey = canonicalKey(display);
  const keyHit = byKey.get(key) || byKey.get(displayKey) || (claimedKeys.has(key) ? { _id: claimedKeys.get(key), minted: true } : null);
  const matchedKey = byKey.has(key) ? key : byKey.has(displayKey) ? displayKey : key;

  // Romanization is lossy, and canonicalKey falls back to the folded raw string
  // for non-Latin names — so two different people can key together on a shared
  // pinyin. 智顗 (Tiantai patriarch, d. 597) keys onto 盧之頤 (Ming physician)
  // because both read "Zhiyi"; 王珪 onto 王槩 because both read "Wang Gui" —
  // that pair was caught by hand and pinned in EXCLUDE_APPEND below. Compare
  // the characters romanization discarded, and refuse the match when they
  // disagree. This guards the APPEND path especially: an append writes a
  // variant onto someone else's doc, which then claims their books.
  // Compare against every CJK form the doc carries, not just the variant that
  // happened to match: the matching variant is often a bare romanization
  // ("Wang Gai") with no characters to compare, while another variant on the
  // same doc holds the original 王槩. Without this, 王朴 appends onto Wang Gai.
  const hitCjk = keyHit && !keyHit.minted
    ? [...(keyHit.variants || []), keyHit.canonical_name, keyHit.viaVariant].filter(Boolean).map(cjkOf).filter(Boolean)
    : [];
  // Both refusals below reject the MATCH, not the person: the classifier already
  // judged this string to be a real named individual, so the right outcome is a
  // doc of their own, not silence. Minting cannot corrupt an existing cluster —
  // at worst it duplicates one, which is the cheap error. Adopting the wrong
  // doc mis-attributes every book wearing the string, which is the dear one.
  let standalone = null;
  if (keyHit && v.standalone) standalone = `reviewed: not the same person as ${keyHit._id}`;
  if (!standalone && keyHit?.minted && authorityOf(v) && claimedAuthority.get(keyHit._id) !== authorityOf(v)) {
    standalone = `same cluster key as ${keyHit._id} minted this run, but a different authority id (${claimedAuthority.get(keyHit._id)} vs ${authorityOf(v)})`;
  }
  if (!standalone && keyHit && !keyHit.minted && otherAuthority(keyHit, v)) {
    standalone = `cluster key matches ${keyHit._id}, which carries a different authority id (${keyHit.bdrc_ids.join(',')})`;
  }
  if (!standalone && keyHit && !keyHit.minted && authorityOf(v)) {
    // An authority-backed person adopts an existing doc only through a reviewed link_to.
    skips.push({ s, why: `cluster key matches existing doc ${keyHit._id} via ${JSON.stringify(keyHit.viaVariant)} — review, then set link_to or standalone` });
    continue;
  }
  if (!standalone && keyHit && !keyHit.minted && EXCLUDE_APPEND.has(`${keyHit._id}|${s}`)) {
    standalone = `hand-excluded: key collision with ${keyHit._id} is NOT the same person`;
  }
  if (!standalone && cjkOf(s) && hitCjk.length && hitCjk.every(c => cjkDiffers(s, c))) {
    standalone = `romanization homophone of ${keyHit._id} (${hitCjk.join('/')}) — same reading, different characters`;
  }
  const thin = !standalone && keyHit && !keyHit.minted && !ALLOW_APPEND.has(`${keyHit._id}|${s}`) ? keyTooThinToMatch(matchedKey) : 0;
  if (thin) {
    standalone = `cluster key ${JSON.stringify(matchedKey)} is a single stem shared by ${thin} distinct people — too thin to adopt ${keyHit._id}'s identity`;
  }
  if (standalone) notes.push(`${JSON.stringify(s)}: ${standalone}; minting separately`);

  if (keyHit && !keyHit.minted && !standalone) {
    if (keyHit.merged_into) { skips.push({ s, why: `key lands on tombstone ${keyHit._id} -> ${keyHit.merged_into}` }); continue; }
    if (keyHit.is_person === false) { skips.push({ s, why: `key lands on QUARANTINED doc ${keyHit._id} — needs eyes` }); continue; }
    if (v.verdict === 'institution') { skips.push({ s, why: `institution string keys onto person doc ${keyHit._id} — needs eyes` }); continue; }
    if (EXCLUDE_APPEND.has(`${keyHit._id}|${s}`)) { skips.push({ s, why: `hand-excluded: key collision with ${keyHit._id} is NOT the same person` }); continue; }
    appends.push(appendOf(keyHit._id, v, { via: keyHit.viaVariant }));
    continue;
  }
  if (keyHit?.minted && !standalone) {
    // same cluster key as a doc minted earlier THIS run — append there
    appends.push(appendOf(keyHit._id, v));
    continue;
  }

  // An institution displays its own heading, which for a CJK body (司農司, the
  // Yuan Bureau of Agriculture) slugs to nothing. Fall back to the classifier's
  // romanization for the id only — the heading stays the canonical_name.
  const id = v.slug || authorSlug(display) || authorSlug(v.canonical_name || '');
  if (!id) { skips.push({ s, why: 'canonical_name slugs to empty — needs a romanization' }); continue; }
  // A slug clash used to mint `<slug>-2` silently, which decides a question it
  // has not asked: is this the same person under another spelling, or a
  // different person with the same name? Guessing produced 31 split pairs
  // (`x` and `x-2`, one person's books divided between them). Split by the
  // distinction that actually separates the two cases:
  if (usedIds.has(id)) {
    const twin = mintedBySlug.get(id);
    if (twin && authorityOf(v) && twin.authority !== authorityOf(v)) {
      skips.push({ s, why: `slug "${id}" was minted this run for authority ${twin.authority}; this is ${authorityOf(v)} — give it a distinct name` });
      continue;
    }
    if (!twin) {
      // Clash with a PRE-EXISTING doc: its books, its history, no safe default.
      skips.push({ s, why: `slug "${id}" belongs to an existing doc — same person the key missed, or a homonym; needs eyes, not a "-2" doc` });
      continue;
    }
    // Clash with a doc minted earlier THIS run. Both came from the same
    // classification pass and carry the same display name, so the usual case is
    // one person written two ways — a Latin/vernacular pair (Hozjusz/Hosius,
    // Hospinianus/Hospinian) or an orthographic one (Wolfgang/Wolffgang).
    // EXCEPT when romanization is doing the collapsing: pinyin is lossy, so
    // 陳植 and 陳直 both render "Chen Zhi", and 周祈/周琦 both "Zhou Qi" — two
    // different men each time. Compare the ORIGINAL scripts, not the display.
    if (cjkDiffers(s, twin.source)) {
      let alt = id; for (let n = 2; usedIds.has(alt); n++) alt = `${id}-${n}`;
      notes.push(`romanization homophone: ${JSON.stringify(s)} and ${JSON.stringify(twin.source)} both display "${display}" — distinct people, minting ${alt}`);
      usedIds.add(alt);
      claimedKeys.set(key, alt);
      mintedBySlug.set(alt, { source: s, authority: authorityOf(v) });
      if (authorityOf(v)) claimedAuthority.set(alt, authorityOf(v));
      mints.push({ _id: alt, doc: buildDoc(alt, display, s, v) });
      continue;
    }
    appends.push(appendOf(id, v, { via: `same-run spelling twin of ${JSON.stringify(twin.source)}` }));
    continue;
  }
  usedIds.add(id);
  mintedBySlug.set(id, { source: s, authority: authorityOf(v) });
  if (authorityOf(v)) claimedAuthority.set(id, authorityOf(v));
  // A standalone mint must NOT claim the shared key: the key is exactly what it
  // was refused for, and claiming it would hand the next homophone the same bad
  // match, this time pointing at a doc minted moments ago.
  if (!standalone) claimedKeys.set(key, id);
  mints.push({ _id: id, doc: buildDoc(id, display, s, v) });
}

console.log(`\nPlan: mint ${mints.length} new docs (${mints.filter(m => m.doc.is_person === false).length} institutions), append ${appends.length} variants to existing docs, skip ${skips.length}.`);
console.log('\nSample mints:');
for (const m of mints.slice(0, 15)) console.log(`  ${m._id.padEnd(40)} "${m.doc.canonical_name}"${m.doc.is_person === false ? '  [institution]' : ''}`);
console.log('\nVariant appends:');
for (const a of appends) console.log(`  ${a.doc.padEnd(40)} += "${a.variant}"  [via "${a.via || 'same-run mint'}"]`);
if (notes.length) { console.log('\nNotes:'); for (const n of notes) console.log(`  ${n}`); }
if (skips.length) {
  console.log('\nSkips:');
  for (const s of skips.slice(0, 30)) console.log(`  "${s.s.slice(0, 50)}" — ${s.why}`);
}

if (PLAN_OUT) writeFileSync(PLAN_OUT, JSON.stringify({ source: SOURCE, mints: mints.map(m => m.doc), appends, skips, notes }, null, 1));
if (!APPLY) { console.log('\nDRY-RUN. Re-run with --apply to write.'); await mc.close(); process.exit(0); }

// ── backup (merge on id — earlier entries win) then write ────────────────────
mkdirSync(dirname(BACKUP), { recursive: true });
const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { minted: [], appended: [] };
const havePrior = new Set(prior.minted);
const havePriorAppend = new Set(prior.appended.map(a => `${a.doc} ${a.variant}`));
for (const m of mints) if (!havePrior.has(m._id)) prior.minted.push(m._id);
for (const a of appends) if (!havePriorAppend.has(`${a.doc} ${a.variant}`)) prior.appended.push(a);
prior.issue = prior.issue || (SOURCE === 'additive-mint-3780' ? 3780 : SOURCE);
prior.created_at = prior.created_at || new Date().toISOString();
prior.last_run_at = new Date().toISOString();
writeFileSync(BACKUP, JSON.stringify(prior, null, 2));

let minted = 0;
for (const m of mints) {
  try { await authors.insertOne(m.doc); minted++; }
  catch (e) { if (e.code === 11000) skips.push({ s: m._id, why: 'id collided at write time' }); else throw e; }
}
let appended = 0;
for (const a of appends) {
  const r = await authors.updateOne(
    { _id: a.doc, merged_into: { $exists: false } },
    { $addToSet: { variants: { $each: [a.variant, ...(a.extra_variants || [])] }, ...(a.variant_slug ? { variant_slugs: a.variant_slug } : {}), ...(a.bdrc ? { bdrc_ids: a.bdrc } : {}) } },
  );
  appended += r.modifiedCount;
}
console.log(`\nAPPLIED: minted ${minted}/${mints.length}, appended variants on ${appended}/${appends.length} docs. Backup: ${BACKUP}`);
console.log('\nNext: node scripts/maintenance/backfill-author-canonical-links.mjs --include-backlog --apply');
await mc.close();
