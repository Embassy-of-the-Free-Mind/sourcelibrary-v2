#!/usr/bin/env node
// PRIOR ART: scripts/import/derge-tengyur-import.mjs wrote the pages and `catalog_ids.tohoku` (the
// flat list of ids per volume) but no per-text structure; scripts/works-catalog/ingest-bdrc.mjs
// harvests BDRC instances into Supabase `works` and never reads outline O23703 or a text's place in a
// volume; scripts/maintenance/seed-contents-works.mjs derives `contents_works` FROM chapters. None
// builds the chapters. Pure helpers: scripts/lib/tengyur-catalogue.mjs.
//
// Layer 1 of #6145: the Derge Tengyur text list per volume — $0, no model.
//
//   1. --fetch   cache BDRC's outline of the Derge Tengyur (bdr:O23703) and, for every text in it, the
//                rKTs work record, its Indic parallel (IAST title) and every creator agent. BDRC metadata
//                is CC0; the rKTs work records say so per record (adm:metadataLegal bda:LD_rKTs_CC0).
//                Polite: 4 at a time, disk cache, never re-fetched.
//   2. (default) DRY RUN → $OUT/dry-run.jsonl (one row per volume) + $OUT/summary.json. Reads the
//                213 books and their pages (ocr.data / text_edition.tohoku), builds each volume's text
//                list from the {D####} markers, joins the catalogue on the Tohoku number, and checks
//                our opening page against BDRC's own image number for the text.
//   3. --apply   writes `chapters` (one level-1 entry per text) with `chapters_method`,
//                `chapters_extracted_at` and `field_provenance.chapters`, and one sweep_log row per
//                book. Refuses a book whose `chapters` were written by anything else.
//                --clear --apply removes what this script wrote (and only that).
//
// What is written per text (all from the two sources above; nothing is generated):
//   title       the Tibetan title the text gives itself ("bod skad du …"), else BDRC's EWTS title
//   titleEn     the reader-facing line: IAST Sanskrit title — author(s) (Toh N). The field is
//               rendered by every TOC as the label; it is not an English translation of the title.
//   pageId/pageNumber/endPage/level:1, and a `catalogue` object: tohoku, titles (bo/ewts/sa),
//               authors/translators [{name, name_ewts, bdrc, author_id}], work_id, bdrc ids, source.
//
// Usage (Hetzner):
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-catalogue-6145.mjs --fetch
//   node --env-file=… scripts/maintenance/tengyur-catalogue-6145.mjs            # dry run
//   node --env-file=… scripts/maintenance/tengyur-catalogue-6145.mjs --apply [--volume=96]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import {
  volumeTexts, openingTitles, parseOutline, parseWork, parsePerson, displayIast, ewtsName,
  AUTHOR_ROLES, TRANSLATOR_ROLES, matchAuthor, buildAuthorIndex, fold,
} from '../lib/tengyur-catalogue.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { parseVolume } from '../lib/derge-tengyur.mjs';
import { execFileSync } from 'node:child_process';

const ETEXT = '/root/derge-tengyur';

const ISSUE = 6145;
const SWEEP = 'tengyur-catalogue-6145';
const METHOD = 'catalogue:esukhia-tohoku-markers+bdrc-O23703';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const has = (k) => process.argv.includes(`--${k}`);
const OUT = arg('out', '/root/tengyur-enrich-6145');
const CACHE = path.join(OUT, 'bdrc');
const APPLY = has('apply');
const CLEAR = has('clear');
const ONLY_VOL = arg('volume') ? Number(arg('volume')) : null;
const UA = { 'User-Agent': 'SourceLibrary-Tengyur-Catalogue/1.0 (#6145; derek@sourcelibrary.org)' };

const SOURCE = {
  outline: 'https://purl.bdrc.io/graph/O23703.jsonld',
  name: 'BDRC outline of the Derge Tengyur (bdr:O23703) with rKTs work records (Vienna) and BDRC person records',
  licence: 'CC0 — BDRC releases its metadata under CC0; the rKTs work records carry adm:metadataLegal bda:LD_rKTs_CC0',
  ids: 'Tohoku numbers from the Esukhia digital Derge Tengyur {D####} markers (public domain)',
};

// The Sanskrit originals we hold (the Nālandā shelf), matched BY HAND to their Tohoku number from the
// book's title and author, and confirmed against BDRC's IAST title for that Tohoku number in the dry
// run. The Tengyur text takes the book's existing work_id so the two cluster; nothing on the Sanskrit
// book is changed. Left out on purpose: books whose work_id names a container or a commentary the
// Tengyur does not hold (Pramāṇavārttika with Manorathanandin's Vṛtti; Tattvasaṃgraha with the
// Pañjikā; Viṃśatikā & Triṃśikā in one book), and the Bodhicaryāvatāra book, whose work_id
// `local:a:santideva:light-path` does not name the work.
const SANSKRIT_HELD = {
  D3824: { book: '69e8b28a2ff2a8dc09e77ff4', note: 'Mūlamadhyamakakārikā (Nāgārjuna)' },
  D3828: { book: '6a3067e0c4fd77fb5b9f87ea', note: 'Vigrahavyāvartanī (Nāgārjuna), ed. Johnston & Kunst' },
  D3846: { book: '6a308278558372a29b370f39', note: 'Catuḥśataka (Āryadeva), ed. V. Bhattacharya (hidden)' },
  D3860: { book: '6a3067d0c4fd77fb5b9f8378', note: 'Prasannapadā (Candrakīrti), ed. La Vallée Poussin' },
  D3940: { book: '6a30881fbd425508b0edad49', note: 'Śikṣāsamuccaya (Śāntideva), ed. Bendall' },
  D4020: { book: '6a3067c9c4fd77fb5b9f8143', note: 'Mahāyānasūtrālaṃkāra, ed. Lévi' },
  D4090: { book: '6955831757e3b773024f76ae', note: 'Abhidharmakośabhāṣya (Vasubandhu) (hidden)' },
  D4155: { book: '69bc7feb9615ef57a9cec2bc', note: 'Avadānakalpalatā (Kṣemendra), ed. Sarat Chandra Das' },
  D4158: { book: '6a3067e4c4fd77fb5b9f882d', note: 'Ratnāvalī (Nāgārjuna), ed. Mishra & Goswami (hidden)' },
  D4231: { book: '6a308263675ed2bdbe36f2e5', note: "Nyāyabinduṭīkā (Dharmottara), with Dharmakīrti's Nyāyabindu" },
};

// BDRC person → `authors` doc. Every deterministic name match the dry run proposed (14), read by hand
// against the thesaurus doc's own books and Wikidata id (2026-10-07). Accepted:
const REVIEWED_AUTHOR_LINKS = {
  P4954: 'nagarjuna', // Nāgārjuna, Q171195
  P6119: 'vasubandhu', // Vasubandhu, Q316343
  P6161: 'santideva', // Śāntideva, Q445460
  P7612: 'asvaghosa', // Aśvaghoṣa
  P8058: 'kalidasa', // Kālidāsa — the Meghadūta is D4302
  P5787: 'dandin', // Daṇḍin — the Kāvyādarśa is D4301; the doc holds his Daśakumāracarita
  P7374: 'harsha', // Harṣa — the Nāgānanda is D4154; the doc holds the Sanskrit Nāgānanda
  P0AT0254: 'vagbhata', // Vāgbhaṭa — the Aṣṭāṅgahṛdaya; the doc holds it
  P6951: 'vagbhata',
  P4CZ16888: 'kautilya', // Cāṇakya — the doc is Q9045 (Chanakya)
};
const REJECTED_AUTHOR_LINKS = {
  P4CZ10559: 'the doc is the Jain Samantabhadra (Ratnakaraṇḍaśrāvakācāra), not the Buddhist tantric author',
  P4CZ15437: 'the doc is Nīlakaṇṭha Somayājī, the 15th-c. Kerala astronomer; BDRC marks this name reconstructed (*)',
  P7588: 'BDRC names this person "Āryaśūra?" (uncertain) and matched only through an alternative name',
  P3217: 'matched only through an alternative name (Jagaddarpaṇa) on a record whose primary name is garbled',
};

// ── fetch ────────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cached(name, url) {
  const f = path.join(CACHE, `${name}.jsonld`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: UA }).catch(() => null);
    if (res && res.ok) {
      const body = await res.text();
      const doc = JSON.parse(body); // truncation guard
      fs.writeFileSync(f, body);
      return doc;
    }
    if (res && res.status === 404) { fs.writeFileSync(path.join(CACHE, `${name}.404`), ''); return null; }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}
const missing = (name) => fs.existsSync(path.join(CACHE, `${name}.404`));
async function pool(items, n, fn) {
  const q = [...items]; let done = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (let x; (x = q.shift()) !== undefined;) { await fn(x); if (++done % 250 === 0) console.log(`  ${done}/${items.length}`); } }));
}
const resource = (rid) => (missing(rid) ? null : cached(rid, `https://purl.bdrc.io/resource/${rid}.jsonld`));

async function fetchAll() {
  fs.mkdirSync(CACHE, { recursive: true });
  const outline = parseOutline(await cached('O23703', SOURCE.outline));
  console.log(`outline: ${outline.size} texts with a Tohoku id`);
  const works = [...new Set([...outline.values()].map((r) => r.work).filter(Boolean))];
  console.log(`works: ${works.length}`);
  await pool(works, 4, (w) => resource(w));
  const parallels = new Set(); const agents = new Set();
  for (const w of works) {
    const doc = missing(w) ? null : JSON.parse(fs.readFileSync(path.join(CACHE, `${w}.jsonld`), 'utf8'));
    const p = doc && parseWork(doc, w);
    if (!p) continue;
    p.parallels.forEach((x) => parallels.add(x));
    p.creators.forEach((c) => agents.add(c.agent));
  }
  console.log(`indic parallels: ${parallels.size}`);
  await pool([...parallels], 4, (w) => resource(w));
  for (const w of parallels) {
    const doc = missing(w) ? null : JSON.parse(fs.readFileSync(path.join(CACHE, `${w}.jsonld`), 'utf8'));
    parseWork(doc || {}, w)?.creators.forEach((c) => agents.add(c.agent));
  }
  console.log(`agents: ${agents.size}`);
  await pool([...agents], 4, (p) => resource(p));
  const roles = new Set();
  for (const w of [...works, ...parallels]) {
    if (missing(w)) continue;
    parseWork(JSON.parse(fs.readFileSync(path.join(CACHE, `${w}.jsonld`), 'utf8')), w)?.creators.forEach((c) => roles.add(c.role));
  }
  for (const r of roles) await resource(r);
  console.log('roles:', [...roles].map((r) => `${r}=${roleLabel(r)}`).join(' '));
}

const read = (rid) => (missing(rid) || !fs.existsSync(path.join(CACHE, `${rid}.jsonld`)) ? null : JSON.parse(fs.readFileSync(path.join(CACHE, `${rid}.jsonld`), 'utf8')));
function roleLabel(rid) {
  const d = read(rid); if (!d) return null;
  const g = d['@graph'] ?? [d];
  const n = g.find((x) => x['@id'] === `bdr:${rid}`) || {};
  const l = [n['skos:prefLabel']].flat().find((x) => x?.['@language'] === 'en');
  return l?.['@value'] || null;
}

// ── catalogue join ───────────────────────────────────────────────────────────────────────────────
function catalogue(outline, authorIndex) {
  const people = new Map();
  const person = (rid) => {
    if (!people.has(rid)) {
      const p = read(rid) ? parsePerson(read(rid), rid) : null;
      const m = p ? matchAuthor(p, authorIndex) : { author_id: null, reason: 'no BDRC record' };
      // A name match is a CANDIDATE; only a reviewed pairing is written (author-identity.md: a name
      // is safe to match on only if it is specific — Samantabhadra the Jain author is not the tantric one).
      const reviewed = REVIEWED_AUTHOR_LINKS[rid];
      const ok = reviewed && reviewed === m.author_id;
      people.set(rid, { bdrc: rid, name: p?.iast || null, name_ewts: ewtsName(p?.ewts), author_id: ok ? m.author_id : null,
        candidate: m.author_id && !ok ? m.author_id : undefined,
        match: m.author_id ? `folded name = ${m.via.join(', ')}${ok ? ' (reviewed)' : REJECTED_AUTHOR_LINKS[rid] ? ` — rejected: ${REJECTED_AUTHOR_LINKS[rid]}` : ' — unreviewed, not written'}` : m.reason });
    }
    return people.get(rid);
  };
  const byToh = new Map();
  for (const [toh, r] of outline) {
    const w = r.work && read(r.work) ? parseWork(read(r.work), r.work) : null;
    const indic = (w?.parallels || []).map((x) => (read(x) ? { id: x, ...parseWork(read(x), x) } : null)).find((x) => x && x.language !== 'LangBo') || null;
    const creators = [...(w?.creators || []), ...(indic?.creators || [])];
    const uniq = (list) => [...new Map(list.map((c) => [c.agent, c])).values()];
    const authors = uniq(creators.filter((c) => AUTHOR_ROLES.has(c.role))).map((c) => ({ ...person(c.agent), role: c.role }));
    const translators = uniq(creators.filter((c) => TRANSLATOR_ROLES.has(c.role))).map((c) => ({ ...person(c.agent), role: c.role }));
    const other = uniq(creators.filter((c) => !AUTHOR_ROLES.has(c.role) && !TRANSLATOR_ROLES.has(c.role))).map((c) => ({ bdrc: c.agent, role: c.role }));
    byToh.set(toh, {
      ...r,
      title_sa: displayIast(indic?.iast?.[0] || null),
      indic_work: indic?.id || null,
      rkts: (w?.sameAs || []).find((s) => /rkts/.test(s)) || null,
      authors, translators, other_creators: other,
    });
  }
  return { byToh, people };
}

const nameList = (ps) => ps.map((p) => p.name || p.name_ewts).filter(Boolean);
function label(c, toh) {
  const n = toh.replace(/^D/, '');
  const head = c?.title_sa?.replace(/-nāma$/i, '') || c?.title_ewts?.replace(/[\s/]+$/, '') || null;
  const by = c ? nameList(c.authors) : [];
  return `${head || `Toh ${n}`}${by.length ? ` — ${by.join(', ')}` : ''}${head ? ` (Toh ${n})` : ''}`;
}

function imageNumber(page) {
  const m = String(page?.source_ref || '').match(/::\d{4}(\d{4})\.\w+$/);
  return m ? Number(m[1]) : null;
}

// A text whose {D####} sits on a side we hold no page for (a title side) would be lost from the list.
// Find those sides in the e-text the pages were imported from (same commit), and open the text at the
// top of the next page we DO hold — which is where its own text begins.
let etextHead = null;
function injectUnheldOpenings(b, pages) {
  const inject = new Map();
  const onPages = new Set(pages.flatMap((p) => p?.ocr?.text_edition?.tohoku || []));
  const want = (b.catalog_ids?.tohoku || []).filter((t) => !onPages.has(t));
  if (!want.length) return inject;
  etextHead ??= execFileSync('git', ['-C', ETEXT, 'rev-parse', 'HEAD']).toString().trim();
  if (etextHead !== b.catalog_metadata?.etext_commit) throw new Error(`e-text at ${etextHead} but book ${b.id} was imported from ${b.catalog_metadata?.etext_commit}`);
  const sides = parseVolume(fs.readFileSync(path.join(ETEXT, b.catalog_metadata.etext_file), 'utf8'));
  // our page → side index, walking both forward by folio label (labels repeat when numbering restarts)
  const idxOf = new Map(); let ptr = 0;
  for (const p of pages) {
    const lab = p?.ocr?.text_edition?.folio; if (!lab) continue;
    for (let k = ptr; k < sides.length; k++) if (sides[k].label === lab) { idxOf.set(p.page_number, k); ptr = k + 1; break; }
  }
  for (const toh of want) {
    const s = sides.findIndex((x) => x.tohoku.includes(toh));
    if (s < 0) throw new Error(`${toh} not in ${b.catalog_metadata.etext_file}`);
    const next = pages.find((p) => (idxOf.get(p.page_number) ?? -1) > s);
    if (!next) throw new Error(`${toh}: no held page after side ${sides[s].label}`);
    if (!inject.has(next.page_number)) inject.set(next.page_number, []);
    inject.get(next.page_number).push(toh);
  }
  return inject;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (has('fetch')) { await fetchAll(); return; }
  const outline = parseOutline(read('O23703') || (() => { throw new Error('run --fetch first'); })());
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const books = db.collection('books');
  const authorDocs = await db.collection('authors').find({}, { projection: { canonical_name: 1, variants: 1, aliases: 1, merged_into: 1, is_person: 1 } }).toArray();
  const { byToh, people } = catalogue(outline, buildAuthorIndex(authorDocs));
  const held = {};
  for (const [toh, h] of Object.entries(SANSKRIT_HELD)) {
    const b = await books.findOne({ id: h.book }, { projection: { id: 1, title: 1, work_id: 1, visible: 1 } });
    if (!b?.work_id) throw new Error(`Sanskrit book ${h.book} (${toh}) has no work_id — refusing to guess`);
    held[toh] = { ...h, work_id: b.work_id, title: b.title };
  }

  const vols = await books.find({ 'catalog_ids.derge_tengyur_volume': ONLY_VOL ? ONLY_VOL : { $exists: true } },
    { projection: { id: 1, title: 1, slug: 1, chapters: 1, chapters_method: 1, 'catalog_ids.derge_tengyur_volume': 1, 'catalog_ids.tohoku': 1, 'catalog_metadata.etext_file': 1, 'catalog_metadata.etext_commit': 1, pages_count: 1, visible: 1 } })
    .sort({ 'catalog_ids.derge_tengyur_volume': 1 }).toArray();
  if (!ONLY_VOL && vols.length !== 213) throw new Error(`expected 213 Tengyur volumes, found ${vols.length}`);

  fs.mkdirSync(OUT, { recursive: true });
  const dry = fs.createWriteStream(path.join(OUT, APPLY ? 'applied.jsonl' : 'dry-run.jsonl'));
  const S = { volumes: 0, texts: 0, continued: 0, no_catalogue: [], with_authors: 0, author_linked: 0, people: 0, people_linked: 0, loc_checked: 0, loc_agree: 0, loc_disagree: [], with_sa_title: 0, with_bo_title: 0, work_id: 0, held_links: [], refused: [], written: 0, cleared: 0, injected: [], markers_in_catalog_ids_missing: [] };
  const sweepRows = [];
  let carried = null;
  // Carried text across a volume boundary: the previous volume's last text (by volume order).
  if (ONLY_VOL && ONLY_VOL > 1) {
    const prev = await books.findOne({ 'catalog_ids.derge_tengyur_volume': ONLY_VOL - 1 }, { projection: { 'catalog_ids.tohoku': 1 } });
    carried = prev?.catalog_ids?.tohoku?.at(-1) || null;
  }
  for (const b of vols) {
    const vol = b.catalog_ids.derge_tengyur_volume;
    if (CLEAR) {
      if (b.chapters_method === METHOD && APPLY) {
        await books.updateOne({ id: b.id, chapters_method: METHOD }, { $unset: { chapters: '', chapters_method: '', chapters_extracted_at: '', 'field_provenance.chapters': '' } });
        sweepRows.push({ sweep: SWEEP, book_id: b.id, action: 'chapters-cleared', detail: { volume: vol } });
        S.cleared++;
      }
      continue;
    }
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.tohoku': 1, 'ocr.text_edition.folio': 1, source_ref: 1 } }).sort({ page_number: 1 }).toArray();
    const inject = injectUnheldOpenings(b, pages);
    for (const [n, ids] of inject) S.injected.push({ vol, page: n, ids });
    const texts = volumeTexts(pages, { carriedToh: carried, inject });
    const byNo = new Map(pages.map((p) => [p.page_number, p]));
    const seenIds = new Set(texts.filter((t) => !t.continued).map((t) => t.toh));
    const missingIds = (b.catalog_ids.tohoku || []).filter((t) => !seenIds.has(t));
    if (missingIds.length) S.markers_in_catalog_ids_missing.push({ vol, ids: missingIds });
    const chapters = [];
    for (const t of texts) {
      const cat = byToh.get(t.toh) || null;
      if (!cat) S.no_catalogue.push({ vol, toh: t.toh });
      const open = t.continued ? { sa_bo: null, bo: null } : openingTitles(byNo.get(t.startPage)?.ocr?.data, t.toh);
      const img = imageNumber(byNo.get(t.startPage));
      let locCheck = null;
      if (cat?.location?.volume != null && !t.continued) {
        S.loc_checked++;
        const agree = cat.location.volume === vol && cat.location.page === img;
        locCheck = { bdrc_volume: cat.location.volume, bdrc_image: cat.location.page, our_image: img, agree };
        if (agree) S.loc_agree++; else S.loc_disagree.push({ vol, toh: t.toh, ...locCheck, page: t.startPage });
      }
      const heldLink = held[t.toh] || null;
      const workId = heldLink ? heldLink.work_id : cat?.indic_work ? `catalog:bdrc:${cat.indic_work}` : cat?.work ? `catalog:bdrc:${cat.work}` : null;
      if (heldLink && !t.continued) S.held_links.push({ toh: t.toh, vol, page: t.startPage, work_id: workId, book: heldLink.book });
      if (workId) S.work_id++;
      if (cat?.authors?.length) S.with_authors++;
      if (cat?.authors?.some((a) => a.author_id)) S.author_linked++;
      if (cat?.title_sa) S.with_sa_title++;
      if (open.bo) S.with_bo_title++;
      chapters.push({
        title: open.bo || cat?.title_ewts?.replace(/[\s/]+$/, '') || `Toh ${t.toh.replace(/^D/, '')}`,
        titleEn: (t.continued ? '(continued) ' : '') + label(cat, t.toh),
        pageId: t.startPageId,
        pageNumber: t.startPage,
        endPage: t.endPage,
        level: 1,
        confidence: 'high',
        catalogue: {
          tohoku: t.toh,
          ...(t.continued ? { continued_from_previous_volume: true } : {}),
          ...(t.opening_side_not_held ? { title_side_not_held: true } : {}),
          title_bo: open.bo, title_sa_as_written: open.sa_bo,
          title_ewts: cat?.title_ewts?.replace(/[\s/]+$/, '') || null, title_sa: cat?.title_sa || null,
          authors: (cat?.authors || []).map(({ role, match, ...a }) => a),
          translators: (cat?.translators || []).map(({ role, match, ...a }) => a),
          work_id: workId,
          bdrc: { part: cat?.part || null, work: cat?.work || null, indic_work: cat?.indic_work || null, rkts: cat?.rkts || null },
          ...(heldLink ? { sanskrit_held: heldLink.book } : {}),
          source: METHOD,
        },
      });
      if (!t.continued) S.texts++; else S.continued++;
      if (locCheck && !APPLY) chapters.at(-1)._check = { bdrc_location: locCheck };
    }
    const lastOpened = texts.filter((t) => !t.continued).at(-1)?.toh;
    if (lastOpened) carried = lastOpened;
    S.volumes++;
    const row = { vol, book: b.id, slug: b.slug, pages: pages.length, texts: chapters.length, chapters };
    dry.write(JSON.stringify(row) + '\n');

    if (APPLY) {
      if (Array.isArray(b.chapters) && b.chapters.length && b.chapters_method !== METHOD) { S.refused.push({ vol, reason: `chapters written by ${b.chapters_method || 'unknown'}` }); continue; }
      const now = new Date();
      const r = await books.updateOne(
        { id: b.id, $or: [{ chapters: { $exists: false } }, { chapters: { $size: 0 } }, { chapters_method: METHOD }] },
        { $set: {
          chapters, chapters_method: METHOD, chapters_extracted_at: now,
          'field_provenance.chapters': { source: SOURCE.name, url: SOURCE.outline, licence: SOURCE.licence, ids: SOURCE.ids, method: METHOD, model: null, confidence: 'catalogue', issue: ISSUE, date: now, texts: chapters.length },
        } },
      );
      if (r.modifiedCount) {
        S.written++;
        sweepRows.push({ sweep: SWEEP, book_id: b.id, action: 'chapters-from-catalogue', detail: { volume: vol, texts: chapters.length, tohoku: chapters.map((x) => x.catalogue.tohoku), prior_chapters: b.chapters?.length || 0, issue: ISSUE } });
      } else S.refused.push({ vol, reason: 'conditional write matched nothing (chapters changed underneath)' });
    }
  }
  dry.end();
  if (sweepRows.length) await recordSweepActions(db, sweepRows);
  S.people = people.size;
  S.people_linked = [...people.values()].filter((p) => p.author_id).length;
  S.people_matches = [...people.values()].filter((p) => p.author_id).map((p) => ({ bdrc: p.bdrc, name: p.name, author_id: p.author_id, via: p.match }));
  S.people_unlinked_sample = [...people.values()].filter((p) => !p.author_id).slice(0, 40).map((p) => `${p.bdrc} ${p.name || p.name_ewts} — ${p.match}`);
  fs.writeFileSync(path.join(OUT, APPLY ? 'applied-summary.json' : 'summary.json'), JSON.stringify(S, null, 1));
  console.log(JSON.stringify({ ...S, loc_disagree: S.loc_disagree.length, no_catalogue: S.no_catalogue.length, people_matches: S.people_matches.length, people_unlinked_sample: undefined, markers_in_catalog_ids_missing: S.markers_in_catalog_ids_missing.length }, null, 1));
  console.log(`sample BDRC location disagreements: ${JSON.stringify(S.loc_disagree.slice(0, 8))}`);
  await c.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
