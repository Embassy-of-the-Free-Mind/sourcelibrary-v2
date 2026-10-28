#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/additive-mint-authors-3780.mjs — the writer this feeds (its verdict JSONL, its guards);
// scripts/maintenance/apply-byline-proposals-3894.mjs — the per-book writer this feeds; scripts/maintenance/
// reconcile-authors-grounded.mjs — anchors EXISTING docs to Wikidata by model; none starts from a library's GND id.
/**
 * #7660 stage 0, second half: turn the harvested catalogue authority
 * (`catalogue_authority_harvest`, written by harvest-catalogue-authority.mjs) into
 * author records KEYED BY GND ID, and then into per-book links.
 *
 *   --stage=resolve-names   for harvested authors the record names WITHOUT a GND id (SBB never
 *                      gives one): lobid by exact heading (preferredName, else variantName),
 *                      DifferentiatedPerson only, the book's year inside the life (born+10 …
 *                      died+30), and exactly ONE candidate left (Derek, 2026-10-28). Writes
 *                      `author_gnd_resolved` on the harvest row only; the next stages read it.
 *   --stage=verdicts   one verdict per GND id, for additive-mint-authors-3780.mjs:
 *                      lobid.org/gnd gives the preferred name, the type (Person →
 *                      person, CorporateBody/Conference → institution) and the
 *                      Wikidata/VIAF ids. A GND id already on a doc (gnd_ids), or
 *                      whose Wikidata id is on a doc, becomes a `link_to` append;
 *                      otherwise a standalone mint (a duplicate of an unanchored
 *                      doc is the cheap error, adopting a namesake the dear one).
 *                      UndifferentiatedPerson records (GND "Tn": a NAME that may
 *                      cover several people) are refused.
 *   --stage=books      after the mint: a proposals file for apply-byline-proposals-3894
 *                      for every harvested book whose author the backfill cannot
 *                      reach by its string — placeholder bylines (author := the
 *                      GND preferred name) and strings that name different GND
 *                      people on different books (author kept, author_id set).
 *
 * A catalogue STRING becomes a variant of a GND person only when every harvested
 * book carrying it names that same GND id, and (BSB, which is sampled) at least two
 * books agree or the string has one book. A string that already belongs to another
 * doc is never added, so the backfill's exactly-one-doc rule stays decidable.
 *
 *   node --env-file=.env.production.local scripts/maintenance/authors-from-catalogue-authority.mjs --stage=verdicts --out=<verdicts.jsonl>
 *   node --env-file=.env.production.local scripts/maintenance/authors-from-catalogue-authority.mjs --stage=books --out=<proposals.json>
 * Read-only: both stages only write the file they are given.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { norm, authorSlug } from '../lib/author-name-key.mjs';

const val = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const STAGE = val('stage');
const OUT = val('out');
if (!['resolve-names', 'verdicts', 'books'].includes(STAGE) || (!OUT && STAGE !== 'resolve-names')) { console.error('--stage=resolve-names | --stage=verdicts|books --out=<file>'); process.exit(2); }
const LOBID_UA = { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; #7660)' };
async function lobidSearch(q, size = 100) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://lobid.org/gnd/search?q=${encodeURIComponent(q)}&format=json&size=${size}`, { signal: AbortSignal.timeout(60_000), headers: LOBID_UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (attempt === 3) { console.error(`lobid failed: ${e.message} for ${q.slice(0, 80)}`); return null; } await new Promise((res) => setTimeout(res, 3000 * (attempt + 1))); }
  }
  return null;
}

const PLACEHOLDER = /^\s*(?:unknown|\[?s\.\s?n\.?\]?|not known|not traceable|n\/?a|not available|anonym\w*(?: \w+)?|anon\.?|none|-+)?\s*$/i;
const isPlaceholder = (s) => PLACEHOLDER.test(s ?? '');
const SAMPLED = new Set(['bsb', 'mdz']);

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');

const rows = await db.collection('catalogue_authority_harvest').find({ error: null }, { projection: { names: 0, statement: 0 } }).toArray();
// A GND id the record names wins; one resolved by name (--stage=resolve-names) is used where it names none.
for (const r of rows) if (r.author && !r.author.gnd && r.author_gnd_resolved?.gnd) r.author = { ...r.author, gnd: r.author_gnd_resolved.gnd, gnd_via: 'lobid-name' };
const withGnd = rows.filter((r) => r.author?.gnd);
console.log(`harvested rows ${rows.length}; naming one author ${rows.filter((r) => r.author).length}; with a GND id ${withGnd.length}`);

if (STAGE === 'resolve-names') {
  const todo = rows.filter((r) => r.author && !r.author.gnd && !r.author_gnd_resolved && r.author.type !== 'corporate' && /,/.test(r.author.name));
  const years = new Map();
  const ids = todo.map((r) => r.book_id);
  for (let i = 0; i < ids.length; i += 5000) {
    for (const b of await db.collection('books').find({ id: { $in: ids.slice(i, i + 5000) } }, { projection: { id: 1, year: 1, published: 1 } }).toArray()) {
      years.set(b.id, Number(String(b.year ?? b.published ?? '').match(/\d{4}/)?.[0]) || null);
    }
  }
  const names = [...new Set(todo.map((r) => r.author.name.replace(/"/g, '')))];
  console.log(`rows naming an author without GND: ${todo.length}; distinct headings ${names.length}`);
  const hits = new Map();   // heading -> [lobid members]
  const clean = (s) => s.replace(/"/g, '');
  for (let i = 0; i < names.length; i += 10) {
    const chunk = names.slice(i, i + 10);
    const or = chunk.map((n) => `"${clean(n)}"`).join(' OR ');
    let d = await lobidSearch(`(preferredName:(${or}) OR variantName:(${or})) AND type:DifferentiatedPerson`, 100);
    let members = d?.member || [];
    if (d && d.totalItems > 100) {
      members = [];
      for (const n of chunk) { const e = await lobidSearch(`(preferredName:"${clean(n)}" OR variantName:"${clean(n)}") AND type:DifferentiatedPerson`, 100); members.push(...(e?.member || [])); }
    }
    for (const n of chunk) {
      const want = norm(n);
      const pref = members.filter((m) => norm(m.preferredName || '') === want);
      hits.set(n, pref.length ? pref : members.filter((m) => (m.variantName || []).some((v) => norm(v) === want)));
    }
    if (i % 2000 === 0) console.log(`  lobid names ${i}/${names.length}`);
    await new Promise((res) => setTimeout(res, 300));
  }
  const year = (d) => Number(String(d || '').slice(0, 4)) || null;
  const tally = {};
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
  const col = db.collection('catalogue_authority_harvest');
  for (const r of todo) {
    const cands = hits.get(r.author.name.replace(/"/g, '')) || [];
    const y = years.get(r.book_id);
    if (!cands.length) { count('no exact heading in GND'); continue; }
    if (!y) { count('book has no year'); continue; }
    const alive = cands.filter((m) => {
      const b = year(m.dateOfBirth?.[0]), dd = year(m.dateOfDeath?.[0]);
      return (b || dd) && (!b || y >= b + 10) && (!dd || y <= dd + 30);
    });
    if (alive.length !== 1) { count(alive.length ? 'several candidates fit the year' : 'no candidate fits the year'); continue; }
    count('resolved');
    await col.updateOne({ _id: r._id }, { $set: { author_gnd_resolved: { gnd: alive[0].gndIdentifier, via: 'lobid exact heading + year in life + single candidate', heading: alive[0].preferredName, candidates: cands.length, book_year: y, at: new Date() } } });
  }
  console.log('name-only resolution:', tally);
  await mc.close();
  process.exit(0);
}

// ── strings: which GND ids does each catalogue string name? ─────────────────
const stringGnds = new Map();   // string -> Map(gnd -> rows)
for (const r of rows) {
  if (!r.author || isPlaceholder(r.catalogue_author)) continue;
  const s = r.catalogue_author;
  if (!stringGnds.has(s)) stringGnds.set(s, new Map());
  const k = r.author.gnd || '\u0000none';
  stringGnds.get(s).set(k, [...(stringGnds.get(s).get(k) || []), r]);
}
// Total books per string among the SAMPLED providers, to know when one sample is the whole string.
const sampledTotals = new Map();
for (const x of await db.collection('books').aggregate([
  { $match: { 'image_source.provider': { $in: [...SAMPLED] }, author: { $in: [...stringGnds.keys()] } } },
  { $group: { _id: '$author', n: { $sum: 1 } } },
], { allowDiskUse: true }).toArray()) sampledTotals.set(x._id, x.n);

/** The GND id a string can be keyed to, or null with why. */
function stringKey(s) {
  const m = stringGnds.get(s);
  if (!m || m.size !== 1) return { gnd: null, why: m ? 'names several people (or one without GND)' : 'unharvested' };
  const [[gnd, rs]] = [...m.entries()];
  if (gnd === '\u0000none') return { gnd: null, why: 'no GND id' };
  const sampled = rs.filter((r) => SAMPLED.has(r.provider)).length;
  if (sampled && sampled < 2 && (sampledTotals.get(s) || 0) > 1 && rs.length < 2) return { gnd: null, why: 'one BSB sample of a multi-book string' };
  return { gnd, why: null };
}

// ── existing docs ────────────────────────────────────────────────────────────
const byQid = new Map(), byGnd = new Map(), variantOwner = new Map(), ids = new Set();
const docs = new Map();
for await (const a of db.collection('authors').find({}, { projection: { canonical_name: 1, variants: 1, wikidata_id: 1, gnd_ids: 1, merged_into: 1, is_person: 1 } })) {
  ids.add(a._id);
  docs.set(a._id, a);
  if (a.merged_into) continue;
  if (a.wikidata_id) byQid.set(a.wikidata_id, a._id);
  for (const g of a.gnd_ids || []) byGnd.set(g, a._id);
  for (const v of new Set([...(a.variants || []), a.canonical_name].filter(Boolean))) {
    const k = norm(v);
    if (!variantOwner.has(k)) variantOwner.set(k, new Set());
    variantOwner.get(k).add(a._id);
  }
}
const ownedElsewhere = (form, docId) => [...(variantOwner.get(norm(form)) || [])].some((d) => d !== docId);

if (STAGE === 'verdicts') {
  const byG = new Map();
  for (const r of withGnd) {
    if (!byG.has(r.author.gnd)) byG.set(r.author.gnd, { rows: [], headings: new Set(), strings: new Set() });
    const g = byG.get(r.author.gnd);
    g.rows.push(r);
    g.headings.add(r.author.name);
    if (!isPlaceholder(r.catalogue_author) && stringKey(r.catalogue_author).gnd === r.author.gnd) g.strings.add(r.catalogue_author);
  }
  console.log(`distinct GND ids ${byG.size}`);

  // lobid, 100 ids a request, about one request a second.
  const lobid = new Map();
  const all = [...byG.keys()];
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    const q = `gndIdentifier:(${chunk.map((g) => `"${g}"`).join(' OR ')})`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(`https://lobid.org/gnd/search?q=${encodeURIComponent(q)}&format=json&size=100`, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; #7660)' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        for (const m of (await r.json()).member || []) lobid.set(m.gndIdentifier, m);
        break;
      } catch (e) { if (attempt === 3) console.error(`lobid chunk ${i} failed: ${e.message}`); else await new Promise((res) => setTimeout(res, 3000 * (attempt + 1))); }
    }
    await new Promise((res) => setTimeout(res, 500));
    if (i % 5000 === 0) console.log(`  lobid ${i}/${all.length}`);
  }

  // A string keyed to one GND person is still a NAME, and the backfill will link every
  // unlinked book that carries it — including books no library record speaks for.
  // "Ziegler, Jacob" keyed to the 1591–1670 Ziegler would have pulled in the
  // geographer's (1470–1549) books. So every unharvested book carrying the string must
  // be dated inside the person's life (+30 years posthumous); else the string is not
  // added, and only the harvested books are linked, one by one, in --stage=books.
  const harvested = new Set(rows.map((r) => r.book_id));
  const candidates = [...new Set([...byG.entries()].flatMap(([gnd, g]) => [...g.strings, ...g.headings, lobid.get(gnd)?.preferredName].filter(Boolean)))];
  const carriers = new Map();
  for (let i = 0; i < candidates.length; i += 2000) {
    for (const b of await db.collection('books').find({ author: { $in: candidates.slice(i, i + 2000) }, author_id: { $in: [null, undefined] } }, { projection: { id: 1, author: 1, year: 1, published: 1 } }).toArray()) {
      if (harvested.has(b.id)) continue;
      if (!carriers.has(b.author)) carriers.set(b.author, []);
      carriers.get(b.author).push(Number(String(b.year ?? b.published ?? '').match(/\d{4}/)?.[0]) || null);
    }
  }
  const year = (d) => Number(String(d || '').slice(0, 4)) || null;
  const lifeFits = (s, m) => {
    const others = carriers.get(s) || [];
    if (!others.length) return true;
    const born = year(m.dateOfBirth?.[0]), died = year(m.dateOfDeath?.[0]);
    if (!born && !died) return false;
    return others.every((y) => y && (!born || y >= born + 10) && (!died || y <= died + 30));
  };

  const out = [], tally = {};
  const usedSlugs = new Set(ids);
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
  for (const [gnd, g] of byG) {
    const m = lobid.get(gnd);
    if (!m) { count('not in lobid'); continue; }
    const types = m.type || [];
    if (types.includes('UndifferentiatedPerson')) { count('undifferentiated name (Tn)'); continue; }
    const person = types.includes('Person') || types.includes('DifferentiatedPerson');
    const corporate = types.includes('CorporateBody') || types.includes('ConferenceOrEvent');
    if (!person && !corporate) { count(`other type ${types.join('/')}`); continue; }
    const same = (m.sameAs || []).map((x) => x.id || '');
    const qid = (same.find((x) => /wikidata\.org\/entity\/Q\d+/.test(x)) || '').match(/Q\d+/)?.[0] || null;
    const viaf = (same.find((x) => /viaf\.org\/viaf\/\d+/.test(x)) || '').match(/\d+$/)?.[0] || null;
    let link = byGnd.get(gnd) || (qid && byQid.get(qid)) || null;
    if (link && (docs.get(link)?.is_person === false) !== corporate) { count('existing doc of the other kind'); link = null; continue; }
    const pref = m.preferredName;
    const safe = [...g.strings].filter((x) => lifeFits(x, m));
    if (safe.length < g.strings.size) tally['strings held back: other books outside the life'] = (tally['strings held back: other books outside the life'] || 0) + g.strings.size - safe.length;
    // Headings and the preferred name are added only when no unharvested book carries them either.
    const forms = [...safe, ...[pref, ...g.headings].filter((x) => x && (g.strings.has(x) ? safe.includes(x) : lifeFits(x, m)))].filter(Boolean);
    const free = [...new Set(forms)].filter((f) => !ownedElsewhere(f, link));
    if (!free.length) { count('every form already belongs to another doc'); continue; }
    const v = {
      string: free[0], verdict: corporate ? 'institution' : 'person', canonical_name: pref,
      authority: { gnd }, extra_variants: free.slice(1), books: g.rows.length,
      note: `GND ${gnd} (${types.filter((t) => t !== 'AuthorityResource').join('/')}) ${m.dateOfBirth?.[0] ?? ''}–${m.dateOfDeath?.[0] ?? ''}; harvested from ${[...new Set(g.rows.map((r) => r.provider))].join(',')}`,
    };
    if (link) { v.link_to = link; count('append to existing doc'); }
    else {
      v.standalone = true;
      if (qid) v.wikidata_id = qid;
      if (viaf) v.viaf_id = viaf;
      // A name two GND people share must not mint two docs on one slug: add the life years, then the id.
      let slug = authorSlug(corporate ? pref : pref) || `gnd-${gnd.toLowerCase()}`;
      if (usedSlugs.has(slug)) {
        const yrs = [m.dateOfBirth?.[0], m.dateOfDeath?.[0]].map((d) => (d || '').slice(0, 4)).filter(Boolean).join('-');
        slug = yrs && !usedSlugs.has(`${slug}-${yrs}`) ? `${slug}-${yrs}` : `${slug}-gnd-${gnd.toLowerCase()}`;
      }
      usedSlugs.add(slug);
      v.slug = slug;
      count(corporate ? 'mint institution' : 'mint person');
    }
    out.push(v);
  }
  writeFileSync(OUT, out.map((v) => JSON.stringify(v)).join('\n') + '\n');
  console.log(`verdicts ${out.length} -> ${OUT}`, tally);
  const keyed = [...stringGnds.keys()].map(stringKey);
  const why = {};
  for (const k of keyed) why[k.why || 'keyed to one GND'] = (why[k.why || 'keyed to one GND'] || 0) + 1;
  console.log('catalogue strings:', why);
}

if (STAGE === 'books') {
  const proposals = [];
  const tally = {};
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
  const bookIds = withGnd.map((r) => r.book_id);
  const current = new Map();
  for (let i = 0; i < bookIds.length; i += 5000) {
    for (const b of await db.collection('books').find({ id: { $in: bookIds.slice(i, i + 5000) } }, { projection: { id: 1, author: 1, author_id: 1, title: 1 } }).toArray()) current.set(b.id, b);
  }
  for (const r of withGnd) {
    const b = current.get(r.book_id);
    if (!b) { count('book gone'); continue; }
    if (b.author_id) { count('already linked'); continue; }
    const doc = byGnd.get(r.author.gnd);
    if (!doc) { count('no doc for this GND (not minted)'); continue; }
    const placeholder = isPlaceholder(b.author);
    // The backfill links by exact variant; only books it cannot reach are proposed here.
    if (!placeholder && (variantOwner.get(norm(b.author || '')) || new Set()).has(doc) && variantOwner.get(norm(b.author)).size === 1) { count('backfill will link by string'); continue; }
    proposals.push({
      book_id: b.id, status: 'READY', current: { author: b.author ?? null }, title: String(b.title ?? '').slice(0, 160),
      proposed: { author: placeholder ? docs.get(doc).canonical_name : b.author, author_id: doc, catalogued_role: placeholder ? 'placeholder' : 'catalogue-string' },
      evidence: { page: null, quoted_line: `${r.author.name}${r.author.dates ? `, ${r.author.dates}` : ''} (GND ${r.author.gnd}, role ${r.author.roles?.join('/') || 'primary'})`, as_printed: r.author.name, wikidata: null, record: r.url },
    });
    count(placeholder ? 'placeholder -> GND person' : 'string names several GND people -> author_id only');
  }
  writeFileSync(OUT, JSON.stringify({
    run: 'catalogue-authority-gnd-7660', provenance_source: 'catalogue-authority-gnd-v1',
    method: "holding library's catalogue record (IIIF manifest / METS): the one author-role name and its GND id, keyed to the authors doc carrying that gnd_id (#7660)",
    generated_at: new Date().toISOString(), proposals,
  }, null, 1));
  console.log(`proposals ${proposals.length} -> ${OUT}`, tally);
}
await mc.close();
