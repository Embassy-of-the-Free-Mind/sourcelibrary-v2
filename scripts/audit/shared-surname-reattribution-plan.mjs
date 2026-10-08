#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/merge-person-entity-clusters.mjs + scripts/lib/entity-merge-plan.mjs
// — merge whole records that are ONE person; they refuse a cluster with two Wikidata ids, which is
// exactly this case. scripts/maintenance/repair-entity-page-attribution.mjs — checks that a page
// prints the name, never whose name it is. scripts/audit/person-entity-name-collisions.mjs — counts
// colliding names. None splits one catch-all record's mentions between the people who share it.
/**
 * Which person does each mention on a bare-surname record belong to? (#5950)
 *
 * Takes the bare record ("Bacon") and, for every book entry and every page it claims, proposes
 * a move to one of the configured bearers of the name — or leaves it. Without `--apply` it writes
 * NOTHING to Mongo: the output is a plan file and counts.
 *
 * `--apply --undo-out <file>` (Derek, #5950, 2026-10-06: Bacon only) moves the proposed mentions
 * from the bare record to each person's full-name record. It writes three `entities` documents in
 * one transaction, after: the old `books[]` of each is in the undo file; the entities interlock
 * (scripts/audit/entities-sweep-active.mjs) exits 0; none of the three changed since it was read.
 * Counters come from `entityCounters`. One `sweep_log` row per book and person records what moved
 * and why. `--undo <file>` puts the three `books[]` back. Check that no production build is
 * running before either (deploy-and-caching.md): this script cannot see Vercel.
 *
 * Evidence, strongest first; a page is decided by the first tier that names exactly one person:
 *   1 printed    the page's own text has a cue for one person only ("Rogerius", "Verulam", a
 *                title of theirs). Editorial notes, summaries and keywords are stripped first:
 *                they are the translator's guess, not the page.
 *   2 date       the book was printed before one of them could be cited. This EXCLUDES a person;
 *                it does not prove the other. Checked by eye on 5 such pages, 2 were neither man
 *                (a serjeant named Bacon in a 1329 year book). So a page decided by date alone is
 *                listed as `needs_reader` and is NOT a proposed move.
 *   3 same-book  elsewhere in the same book, `entities` has one of them by full name and not the other.
 *   4 note       the translation's editorial note or keywords on the page name one of them.
 * Tiers 1 and 2 disagreeing, or a tier naming both, leaves the page unresolved.
 *
 * A by-eye verdict in the surname's `byEye` table comes before all four. It is there because tier 3
 * is weaker than its first check said (5 of 5): after the Bacon apply every same-book move was
 * read, and 143 of 163 were right, 15 wrong, 5 undecidable. The wrong ones cluster by book: a
 * history of logic that names Roger Bacon once in full and means Francis on seven other pages.
 * Tier 4, read in full: 61 of 63 right, 2 undecidable. Tier 1 was sampled only (12 of 12).
 * So: READ EVERY same-book and note proposal before an apply, and enter what was read here.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/shared-surname-reattribution-plan.mjs --surname Bacon [--out plan.json] [--check verdicts.tsv --sample sample.jsonl]
 *   … --surname Bacon --apply --undo-out undo.json [--out plan.json]
 *   … --undo undo.json
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { entityCounters } from '../lib/entity-page-match.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'shared-surname-reattribution-5950';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : dflt; };

/**
 * One block per surname. `cues` are tested on folded text (lowercase, no diacritics, j→i, v→u);
 * `citedFrom` is the first year a book could cite the person by surname. A surname without a
 * block is not planned: the cues are a by-eye judgement, never generated.
 */
export const SURNAMES = {
  Bacon: {
    needle: /\bbac(c?h?o|on)/,
    // book id → page → who the page means, read by eye on 2026-10-06. 'stay' = neither can be
    // shown (or it is a third Bacon), so the mention stays on the bare record.
    byEye: {
      // Rozanov, O ponimanii (1886): "the logic of Bacon" against Aristotle's, induction.
      '69af41912a17c2103c8205a5': { 113: 'francis', 120: 'francis', 122: 'francis', 332: 'francis', 457: 'francis', 475: 'francis', 541: 'francis' },
      // Kittredge, Witchcraft (1929): "the deadliest poisons practised by the West Indians" (Sylva sylvarum).
      '699069ee1cf6ed5fbc8f4589': { 155: 'francis' },
      // Dutens, Recherches (1766): "Ramus, Bacon, Gassendi, Descartes, Newton".
      '69c73f1a6a0f3d112faf7a97': { '-13': 'francis' },
      // Blavatsky, Isis Unveiled (1877): p.459 Balfour Stewart quoting Bacon; p.107 "conviction
      // comes not through arguments but through experiments", which could be either man.
      '69528a4fab34727b1f04eab6': { 459: 'francis', 107: 'stay' },
      // Ennemoser, History of Magic II (1854): the same saying.
      '699069e81cf6ed5fbc8f3f00': { 29: 'stay' },
      // Picard, Superstitions (1733): Bacon on garlic and the lodestone; not decidable from the page.
      '69c828ae6c6f3cc53c84c46c': { 164: 'stay' },
      // Wirdig, Nova medicina spirituum (1673): the powers of phantasy "according to Bacon".
      '69bd9f35f6d63c919747fc30': { 179: 'stay', 191: 'stay' },
      // Theatrum sympateticum (1709): recipes "from the Physician Bacon", a third man.
      '69c8597a6c6f3cc53c8545c9': { '-275': 'stay', '-229': 'stay', 367: 'stay', 456: 'stay' },
      // Francis Bacon, Scripta (1653), Temporis partus masculus: "qualis est Bacon" is Francis on Roger.
      '69b2ff88a1a4246ddb45b1e1': { 496: 'roger' },
      // Raynaud, Theologia naturalis (1622): a scholastic "Bacon" on the Intelligences, probably
      // John Baconthorpe; the translator's note says Roger.
      '69c7faaf6c6f3cc53c842b61': { 185: 'stay', 187: 'stay' },
    },
    persons: [
      {
        key: 'roger', name: 'Roger Bacon', wikidata_id: 'Q171677', citedFrom: 1260,
        cues: [
          /\brog(er|ier)\w*\s+bac/, /\bbac\w*,?\s+rog(er|ier)/, /\bfr(iar|ater|atris|atrem|ere)\s+(rog\w+\s+)?bac/,
          /\bdoctor\w*\s+mirabil/, /\bopus\s+(mai|min|tert)/, /\bopere\s+(mai|min|tert)/, /\bspecul\w+\s+alch[eiy]m/,
          /\bbac\w+\s+in\s+epist\w*\.?\s+ad\s+clement/, /\bde\s+secretis\s+operibus/, /\bde\s+mirabili\s+potestate/,
          /\bde\s+nullitate\s+magiae/, /\bradix\s+mundi/, /\bbrazen\s+head/,
        ],
      },
      {
        key: 'francis', name: 'Francis Bacon', wikidata_id: 'Q37388', citedFrom: 1597,
        cues: [
          /\bfranc(is|iscus|isci|isco|iscum|ois|esco|esc)\w*\s+bac/, /\bbac\w*,?\s+franc/, /\buerulam/, /\b(lord|chancellor|kanzler|chancelier)\s+bac/,
          /\bcancellar\w+\s+bac/, /\bbac\w+\s+(of|de|uon|a|baron\w*\s+de)\s+uerulam/, /\bnou\w+\s+organ/, /\bsylua\s+syluarum/, /\bhis\s+sylua\b/,
          /\binstaurati/, /\bde\s+augmentis/, /\baduancement\s+of\s+learning/, /\bnou\w*\s+atlanti/, /\bnew\s+atlantis/,
          /\bs(t|aint)\.?\s+albans?\b/, /\bsapientia\s+ueterum/, /\bwisdom\s+of\s+the\s+ancients/, /\bhistoria\s+uitae\s+et\s+mortis/, /\bpromus\b/,
        ],
      },
    ],
  },
};

export function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/j/g, 'i').replace(/v/g, 'u').replace(/\s+/g, ' ');
}

const EDITORIAL = /<(note|summary|keywords|meta|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** The page as printed (OCR + translation, editorial apparatus removed) and the apparatus alone. */
export function splitPageText(page) {
  const raw = `${page?.translation?.data || ''}\n${page?.ocr?.data || ''}`;
  const editorial = (raw.match(EDITORIAL) || []).join('\n');
  return { printed: fold(raw.replace(EDITORIAL, ' ')), editorial: fold(editorial) };
}

const cued = (persons, text) => persons.filter(p => p.cues.some(re => re.test(text))).map(p => p.key);

/**
 * Decide one page. Pure.
 * @returns {{ person: string|null, tier: string, detail?: string }}
 */
export function decidePage(rule, { printed, editorial, bookYear, sameBook }) {
  const possible = rule.persons.filter(p => !(Number.isFinite(bookYear) && bookYear < p.citedFrom)).map(p => p.key);
  const t1 = cued(rule.persons, printed);
  if (t1.length === 1) {
    if (!possible.includes(t1[0])) return { person: null, tier: 'conflict', detail: `printed cue for ${t1[0]}, book of ${bookYear}` };
    return { person: t1[0], tier: 'printed' };
  }
  if (t1.length > 1) return { person: null, tier: 'both-on-page' };
  if (possible.length === 1) return { person: possible[0], tier: 'date' };
  if (possible.length === 0) return { person: null, tier: 'too-early-for-anyone' };
  const sb = (sameBook || []).filter(k => possible.includes(k));
  if (sb.length === 1) return { person: sb[0], tier: 'same-book' };
  const t4 = cued(rule.persons, editorial).filter(k => possible.includes(k));
  if (t4.length === 1) return { person: t4[0], tier: 'note' };
  return { person: null, tier: sb.length > 1 || t4.length > 1 ? 'both-in-book' : 'no-evidence' };
}

/**
 * Turn the plan's rows into the new `books[]` of the bare record and of each target. Pure.
 *
 * A moved page leaves the bare entry and joins the person's entry for the same book; a bare entry
 * with no page left is dropped. A section-precision entry moves whole. On the target, verified
 * pages join an entry that is already page-precise and REPLACE a section range (as
 * `dedupeEntityBooks` does). An unmarked legacy entry with pages is refused: merging into it would
 * mark its unverified pages as verified (entity-page-attribution.md).
 *
 * @param {{ bareBooks: object[], targetBooks: Record<string, object[]>, rows: object[] }} input
 * @returns {{ bare: object[], targets: Record<string, object[]>, moves: object[] }}
 */
export function applyPlanToBooks({ bareBooks, targetBooks, rows }) {
  const seen = new Set();
  for (const b of bareBooks) {
    if (seen.has(b.book_id)) throw new Error(`bare record lists book ${b.book_id} twice: dedupe it first`);
    seen.add(b.book_id);
  }
  const byBook = new Map();
  for (const r of rows) {
    if (!r.person) continue;
    if (!(r.person in targetBooks)) throw new Error(`no target record for "${r.person}"`);
    const perPerson = byBook.get(r.book_id) ?? new Map();
    const m = perPerson.get(r.person) ?? { pages: new Set(), whole: false, tiers: new Set() };
    if (r.page === null) m.whole = true; else m.pages.add(r.page);
    m.tiers.add(r.tier);
    perPerson.set(r.person, m);
    byBook.set(r.book_id, perPerson);
  }

  const targets = Object.fromEntries(Object.entries(targetBooks).map(([k, list]) => [k, list.map(b => ({ ...b }))]));
  const bare = [];
  const moves = [];
  for (const entry of bareBooks) {
    const perPerson = byBook.get(entry.book_id);
    if (!perPerson) { bare.push(entry); continue; }
    const whole = [...perPerson].filter(([, m]) => m.whole);
    if (whole.length > 0 && (perPerson.size > 1 || (entry.pages || []).length > 0)) {
      throw new Error(`book ${entry.book_id}: a whole-entry move beside page moves`);
    }
    const gone = new Set();
    for (const [person, m] of perPerson) {
      const pages = m.whole ? [] : [...m.pages].filter(n => (entry.pages || []).includes(n)).sort((a, b) => a - b);
      if (!m.whole && pages.length === 0) continue;
      for (const n of pages) gone.add(n);
      const list = targets[person];
      const at = list.findIndex(b => b.book_id === entry.book_id);
      const { pages: _p, page_precision: _pp, page_range: _pr, ...meta } = entry;
      if (m.whole) {
        // A section claim adds nothing to an entry the person already has for this book.
        if (at === -1) list.push({ ...entry });
      } else if (at === -1) {
        list.push({ ...meta, pages, page_precision: 'page' });
      } else {
        const cur = list[at];
        if (cur.page_precision === 'page') {
          list[at] = { ...cur, pages: [...new Set([...(cur.pages || []), ...pages])].sort((a, b) => a - b) };
        } else if (cur.page_precision === 'section' || (cur.pages || []).length === 0) {
          const { page_range: _r, ...rest } = cur;
          list[at] = { ...rest, pages, page_precision: 'page' };
        } else {
          throw new Error(`book ${entry.book_id}: the ${person} record has an unmarked legacy entry with pages; repair it first`);
        }
      }
      moves.push({ book_id: entry.book_id, person, pages, whole: m.whole, tiers: [...m.tiers].sort(), target_had_book: at !== -1, bare_entry_before: entry });
    }
    const left = (entry.pages || []).filter(n => !gone.has(n));
    if (whole.length === 0 && left.length > 0) bare.push({ ...entry, pages: left });
  }
  return { bare, targets, moves };
}

const toId = (s) => (typeof s === 'string' && ObjectId.isValid(s) ? new ObjectId(s) : s);
/** `_id` is an ObjectId on most `entities` rows and a string on some. */
const byAnyId = (id) => ({ _id: { $in: [toId(String(id)), String(id)] } });

/** Exit code of the entities interlock, run bare (a piped exit code was misread twice, #5711). */
function interlockClear() {
  const script = fileURLToPath(new URL('./entities-sweep-active.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
  return res.status === 0;
}

async function applyPlan({ client, db, surname, rule, bare, targets, rows, undoOut }) {
  const entities = db.collection('entities');
  const targetDocs = {};
  for (const p of rule.persons) {
    const named = (targets.get(p.key) || []).filter(t => fold(t.name) === fold(p.name));
    if (named.length !== 1) throw new Error(`expected one record named "${p.name}" with ${p.wikidata_id}, found ${named.length}`);
    targetDocs[p.key] = await entities.findOne(byAnyId(named[0]._id));
    if (targetDocs[p.key]?.wikidata_id !== p.wikidata_id) throw new Error(`"${p.name}" no longer carries ${p.wikidata_id}`);
  }
  const next = applyPlanToBooks({
    bareBooks: bare.books || [],
    targetBooks: Object.fromEntries(rule.persons.map(p => [p.key, targetDocs[p.key].books || []])),
    rows,
  });
  const now = new Date();
  const writes = [
    { doc: bare, books: next.bare },
    ...rule.persons.map(p => ({ doc: targetDocs[p.key], books: next.targets[p.key] })),
  ].map(w => ({ ...w, counters: entityCounters(w.books) }));

  // The undo file exists before anything is written.
  fs.writeFileSync(undoOut, JSON.stringify({
    sweep: SWEEP, surname, applied_at: now.toISOString(),
    docs: writes.map(w => ({
      _id: String(w.doc._id), name: w.doc.name, updated_at_after: now.toISOString(),
      before: { books: w.doc.books || [], book_count: w.doc.book_count ?? null, total_mentions: w.doc.total_mentions ?? null, updated_at: w.doc.updated_at ?? null },
      after: w.counters,
    })),
  }, null, 1) + '\n');
  console.log(`undo file: ${undoOut}`);

  if (!interlockClear()) throw new Error('entities interlock is not clear (exit != 0): nothing written');

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const w of writes) {
        // Unchanged since it was read, or nothing is written: an index writer may have added a book.
        const res = await entities.updateOne(
          { _id: w.doc._id, updated_at: w.doc.updated_at },
          { $set: { books: w.books, ...w.counters, updated_at: now } },
          { session },
        );
        if (res.matchedCount !== 1) throw new Error(`"${w.doc.name}" changed since it was read: nothing written, run again`);
      }
    });
  } finally {
    await session.endSession();
  }

  const targetOf = Object.fromEntries(rule.persons.map(p => [p.key, { _id: String(targetDocs[p.key]._id), name: p.name, wikidata_id: p.wikidata_id }]));
  await recordSweepActions(db, next.moves.map(m => ({
    sweep: SWEEP, book_id: m.book_id, action: 'entity-mention-moved',
    detail: { surname, from: { _id: String(bare._id), name: bare.name }, to: targetOf[m.person], pages: m.pages, whole_entry: m.whole, tiers: m.tiers, target_had_book: m.target_had_book, bare_entry_before: m.bare_entry_before },
  })));
  for (const w of writes) {
    console.log(`  ${w.doc.name}: books ${w.doc.books?.length ?? 0} -> ${w.counters.book_count}, mentions ${w.doc.total_mentions ?? '?'} -> ${w.counters.total_mentions}`);
  }
  console.log(`APPLIED: ${next.moves.length} book moves, ${next.moves.reduce((n, m) => n + (m.whole ? 1 : m.pages.length), 0)} mentions; ${next.moves.length} sweep_log rows (${SWEEP}).`);
}

/** Put back each document's `books[]` from an undo file, unless it changed after the apply. */
async function undo(file) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    if (!interlockClear()) throw new Error('entities interlock is not clear (exit != 0): nothing written');
    const force = process.argv.includes('--force');
    for (const d of saved.docs) {
      const filter = { ...byAnyId(d._id), ...(force ? {} : { updated_at: new Date(d.updated_at_after) }) };
      const res = await db.collection('entities').updateOne(filter, {
        $set: { books: d.before.books, ...entityCounters(d.before.books), updated_at: new Date() },
      });
      console.log(`${d.name}: ${res.matchedCount === 1 ? `restored ${d.before.books.length} book entries` : 'NOT restored: changed since the apply (re-run with --force to overwrite)'}`);
    }
    // The move rows of the undone apply stay in sweep_log; this row marks them as undone.
    await recordSweepActions(db, [{ sweep: SWEEP, book_id: `entity:${saved.docs[0]._id}`, action: 'entity-moves-undone', detail: { surname: saved.surname, undo_file: file } }]);
  } finally {
    await client.close();
  }
}

/**
 * A page read by eye outranks every tier. Pure.
 * @returns {{ person: string|null, tier: 'by-eye' } | null} null when nobody has read this page
 */
export function byEyeVerdict(rule, bookId, page) {
  const verdict = rule.byEye?.[bookId]?.[String(page)];
  if (!verdict) return null;
  if (verdict !== 'stay' && !rule.persons.some(p => p.key === verdict)) throw new Error(`byEye ${bookId} p.${page}: unknown person "${verdict}"`);
  return { person: verdict === 'stay' ? null : verdict, tier: 'by-eye' };
}

async function main() {
  const undoFile = arg('--undo', null);
  if (undoFile) return undo(undoFile);
  const apply = process.argv.includes('--apply');
  const undoOut = arg('--undo-out', null);
  if (apply && !undoOut) { console.error('--apply needs --undo-out <file>: the old books[] are saved before any write'); process.exit(2); }
  const surname = arg('--surname', 'Bacon');
  const rule = SURNAMES[surname];
  if (!rule) { console.error(`no rule block for "${surname}" — cues are written by hand, per surname`); process.exit(2); }
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
  // A transaction reads from the primary, so the apply run does too.
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, readPreference: apply ? 'primary' : 'secondaryPreferred' });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const entities = db.collection('entities');
    const bare = (await entities.find({ name: surname, type: 'person' }).toArray())
      .filter(r => !r.merged_into).sort((a, b) => (b.books?.length ?? 0) - (a.books?.length ?? 0))[0];
    if (!bare) { console.error(`no person record named ${surname}`); process.exit(2); }

    // Which books already name each person in full (Atlas `entities_search`, then by Wikidata id).
    const full = await entities.aggregate([
      { $search: { index: 'entities_search', compound: { must: [{ text: { query: surname, path: 'name' } }], filter: [{ equals: { path: 'type', value: 'person' } }] } } },
      { $limit: 300 },
      { $project: { name: 1, wikidata_id: 1, merged_into: 1, book_ids: '$books.book_id' } },
    ]).toArray();
    // A book that reached a person's record only through an earlier run of this plan is not
    // evidence for the same-book tier: counted, the plan would confirm itself (a dry run after
    // the first Bacon apply proposed 21 more moves on that ground alone).
    const sweepLog = db.collection('sweep_log');
    const lastUndo = await sweepLog.find({ sweep: SWEEP, action: 'entity-moves-undone', 'detail.surname': surname }).sort({ timestamp: -1 }).limit(1).next();
    const planMade = new Set((await sweepLog.find({
      sweep: SWEEP, action: 'entity-mention-moved', 'detail.surname': surname, 'detail.target_had_book': false,
      ...(lastUndo ? { timestamp: { $gt: lastUndo.timestamp } } : {}),
    }).project({ book_id: 1, 'detail.to._id': 1 }).toArray()).map(r => `${r.detail.to._id}:${r.book_id}`));
    const booksOf = new Map(rule.persons.map(p => [p.key, new Set()]));
    const targets = new Map(rule.persons.map(p => [p.key, []]));
    for (const r of full) {
      if (String(r._id) === String(bare._id) || r.merged_into) continue;
      const p = rule.persons.find(x => x.wikidata_id === r.wikidata_id);
      if (!p || fold(r.name) === fold(surname)) continue;
      targets.get(p.key).push({ _id: String(r._id), name: r.name, books: (r.book_ids || []).length });
      for (const id of r.book_ids || []) if (!planMade.has(`${r._id}:${id}`)) booksOf.get(p.key).add(id);
    }

    const byBook = new Map();
    for (const b of bare.books || []) if (b?.book_id && !byBook.has(b.book_id)) byBook.set(b.book_id, b);
    const bookDocs = await db.collection('books')
      .find({ id: { $in: [...byBook.keys()] } }, { projection: { _id: 0, id: 1, year: 1, published: 1, title: 1 } }).toArray();
    const yearOf = new Map(bookDocs.map(b => [b.id, Number.isFinite(b.year) ? b.year : parseInt(String(b.published ?? '').match(/\d{4}/)?.[0] ?? '', 10)]));

    const rows = [];
    for (const entry of byBook.values()) {
      const bookYear = yearOf.get(entry.book_id);
      const sameBook = rule.persons.filter(p => booksOf.get(p.key).has(entry.book_id)).map(p => p.key);
      const pages = entry.page_precision === 'page' && Array.isArray(entry.pages) ? entry.pages : [];
      if (pages.length === 0) {
        const d = decidePage(rule, { printed: '', editorial: '', bookYear, sameBook });
        rows.push({ book_id: entry.book_id, page: null, book_year: bookYear ?? null, ...d, precision: 'section' });
        continue;
      }
      const docs = await db.collection('pages')
        .find({ book_id: entry.book_id, page_number: { $in: pages } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
      const byNumber = new Map(docs.map(d => [d.page_number, d]));
      for (const n of pages) {
        const text = splitPageText(byNumber.get(n));
        const named = rule.needle.test(text.printed);
        const d = byEyeVerdict(rule, entry.book_id, n) ?? decidePage(rule, { ...text, bookYear, sameBook });
        rows.push({ book_id: entry.book_id, page: n, book_year: bookYear ?? null, ...d, name_printed: named, precision: 'page' });
      }
    }

    const tally = (list, key) => list.reduce((m, r) => { const k = key(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const moves = rows.filter(r => r.person && r.tier !== 'date');
    const needsReader = rows.filter(r => r.person && r.tier === 'date');
    for (const r of needsReader) { r.suggested = r.person; r.person = null; r.tier = 'date-only'; }
    const bookVerdict = new Map();
    for (const r of rows) {
      const cur = bookVerdict.get(r.book_id) ?? new Set();
      cur.add(r.person ?? 'stay');
      bookVerdict.set(r.book_id, cur);
    }
    const bookSplit = tally([...bookVerdict.values()], s => [...s].sort().join('+'));
    const summary = {
      surname, record_id: String(bare._id), record_wikidata_id: bare.wikidata_id ?? null,
      books: byBook.size, mentions: rows.length,
      proposed_moves: moves.length, needs_reader: needsReader.length, stay: rows.length - moves.length - needsReader.length,
      moves_by_person: tally(moves, r => r.person),
      moves_by_person_and_tier: tally(moves, r => `${r.person}/${r.tier}`),
      stay_by_reason: tally(rows.filter(r => !r.person && r.tier !== 'date-only'), r => r.tier),
      books_by_outcome: bookSplit,
      target_records: Object.fromEntries([...targets].map(([k, v]) => [k, v.sort((a, b) => b.books - a.books).slice(0, 3)])),
    };
    console.log(JSON.stringify(summary, null, 2));

    const out = arg('--out', null);
    if (out) fs.writeFileSync(out, JSON.stringify({ planned_at: new Date().toISOString(), summary, rows }, null, 1) + '\n');

    // Agreement with by-eye verdicts (scripts/eval/shared-name-mislinks/): the plan's precision.
    const check = arg('--check', null), sampleFile = arg('--sample', null);
    if (check && sampleFile) {
      const sample = fs.readFileSync(sampleFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(s => s.surname === surname);
      const verdicts = new Map(fs.readFileSync(check, 'utf8').trim().split('\n').slice(1).map(l => { const c = l.split('\t'); return [c[0], c[2]]; }));
      let agree = 0, wrong = 0, undecided = 0;
      for (const s of sample) {
        const row = rows.find(r => r.book_id === s.book_id && r.page === s.page_number);
        const eye = verdicts.get(s.key);
        const planQid = rule.persons.find(p => p.key === row?.person)?.wikidata_id ?? null;
        if (!planQid) undecided++; else if (planQid === eye) agree++; else wrong++;
        console.log(`${s.key}  by eye ${eye}  plan ${row?.person ?? 'stay'} (${row?.tier})`);
      }
      console.log(`against ${sample.length} by-eye verdicts: ${agree} agree, ${wrong} wrong, ${undecided} left in place`);
    }

    if (apply) await applyPlan({ client, db, surname, rule, bare, targets, rows, undoOut });
    else console.log('DRY RUN: nothing was written.');
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
