#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/merge-person-entity-clusters.mjs + scripts/lib/entity-merge-plan.mjs
// — merge whole records that are ONE person; they refuse a cluster with two Wikidata ids, which is
// exactly this case. scripts/maintenance/repair-entity-page-attribution.mjs — checks that a page
// prints the name, never whose name it is. scripts/audit/person-entity-name-collisions.mjs — counts
// colliding names. None splits one catch-all record's mentions between the people who share it.
/**
 * READ-ONLY DRY RUN: which person does each mention on a bare-surname record belong to? (#5950)
 *
 * Takes the bare record ("Bacon") and, for every book entry and every page it claims, proposes
 * a move to one of the configured bearers of the name — or leaves it. It writes NOTHING to Mongo:
 * the output is a plan file and counts. Applying it is a hold-list decision (an `entities` write,
 * and a sweep over `entities` blocks production builds — deploy-and-caching.md).
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
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/shared-surname-reattribution-plan.mjs --surname Bacon [--out plan.json] [--check verdicts.tsv --sample sample.jsonl]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : dflt; };

/**
 * One block per surname. `cues` are tested on folded text (lowercase, no diacritics, j→i, v→u);
 * `citedFrom` is the first year a book could cite the person by surname. A surname without a
 * block is not planned: the cues are a by-eye judgement, never generated.
 */
export const SURNAMES = {
  Bacon: {
    needle: /\bbac(c?h?o|on)/,
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

async function main() {
  const surname = arg('--surname', 'Bacon');
  const rule = SURNAMES[surname];
  if (!rule) { console.error(`no rule block for "${surname}" — cues are written by hand, per surname`); process.exit(2); }
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, readPreference: 'secondaryPreferred' });
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
    const booksOf = new Map(rule.persons.map(p => [p.key, new Set()]));
    const targets = new Map(rule.persons.map(p => [p.key, []]));
    for (const r of full) {
      if (String(r._id) === String(bare._id) || r.merged_into) continue;
      const p = rule.persons.find(x => x.wikidata_id === r.wikidata_id);
      if (!p || fold(r.name) === fold(surname)) continue;
      targets.get(p.key).push({ _id: String(r._id), name: r.name, books: (r.book_ids || []).length });
      for (const id of r.book_ids || []) booksOf.get(p.key).add(id);
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
        const d = decidePage(rule, { ...text, bookYear, sameBook });
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
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
