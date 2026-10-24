#!/usr/bin/env node
/**
 * Six LoC books adjudicated BY HAND from their own pages (#6660). The "March Chinese:
 * Jesuit-Era Science" import (2026-03-09) attached hand-supplied Jesuit titles to LoC
 * LCCNs (the 202166xxxx series) that hold other works. Each record's own LoC
 * `description`, stored since import, names the real work, and the pages agree with it,
 * so the errors are OURS. Per-book evidence is in BOOKS below (page + characters read,
 * and the LoC sentence). Approved by Derek 2026-10-24 (apply the #6661 shape to them).
 *
 * Out of the table, on purpose:
 *   69af12750092756351e44aac (LoC 2021666380, was 乾坤體義) — already re-catalogued as
 *     李卓吾先生批評三國志 by scripts/maintenance/repair-catalogue-7144.mjs (#7144, 2026-10-22).
 *
 * PRIOR ART: scripts/maintenance/repair-xiuruji-identity-5620.mjs (#5620/#6661) — the
 * shape copied here: book-keyed hand repair, derived-lane $unset, book_indexes.bookSummary,
 * authors mint, Supabase books_catalog, gallery captions, field_provenance, sweep_log with
 * `before`, --revert. It hard-codes ONE book (constants, one gallery cut regex), so it
 * cannot take six; this is the same writes driven by a per-book table. Also looked at
 * scripts/maintenance/repair-catalogue-7144.mjs (PLAN-table shape, newer libs); it keeps
 * its backup in a gitignored file, while #5620's sweep_log `before` survives the worktree,
 * so #5620's revert path is the one kept. Two additions over #5620, both because the
 * stored values were derived from the wrong (Jesuit) identity:
 *   - source_work_dates(_meta) unset (they are Ricci's/Aleni's lifespans);
 *   - place/publisher set from LoC where the enrichment guessed them, and topical
 *     collections the wrong title earned (geography, mathematics, art of memory) dropped.
 *
 * Writes, per book:
 *   books          title, display_title, english_title, author, author_id, published,
 *                  year, tradition, normalized_*, [place_of_publication, publisher],
 *                  [collections]; $unset the derived lane (summary, summary_candidate,
 *                  reading_summary, quality_assessment, quality_score, faceted_tags,
 *                  locations, author_entity_id, source_work_dates*) and the wrong
 *                  work_id/edition_key (minted from the wrong title+author: WRONG, not moved).
 *   book_indexes   $unset bookSummary (it summarises the Jesuit work).
 *   authors        mint the new author where none exists (additive; ricci/aleni untouched).
 *   books_catalog  (Supabase) the mirrored columns.
 *   gallery_images book_title/book_author/book_year mirrors; captions naming the wrong
 *                  work withheld (museum_description) — mirrored onto pages.detected_images.
 *   field_provenance + sweep_log rows.
 * Left alone: slugs (links), chapters/index (read from the pages), translations, and the
 * first-translation fields — two books carry FT claims resolved against the wrong title
 * (123e0 confirmed_first_legacy, 12630 first_complete); those go through their own
 * resolver (first-translation-claims.md), reported on #6660.
 *
 * After --apply, per book: restamp the edition key
 *   npx tsx scripts/maintenance/materialize-edition-keys.ts --book-id=<id> --apply
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-loc-jesuit-misfiles-6660.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-loc-jesuit-misfiles-6660.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-loc-jesuit-misfiles-6660.mjs --revert [--apply]
 *   (--book=<id> limits any mode to one book)
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { normalizeTitle, normalizeAuthor } from '../lib/dedup-normalize.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';
import { IMPRINT_FIELDS } from '../lib/catalogue-fields.mjs';

const RUN = 'repair-loc-jesuit-misfiles-6660';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const ONLY = process.argv.find((a) => a.startsWith('--book='))?.slice(7);

// `published` carries no digits unless `year` says the same thing: sync-books-catalog's
// deriveYear() reads any number there as the year (#5620). Where LoC gives only a reign,
// the reign is written and `year` stays null — no guessed year.
const BOOKS = [
  {
    id: '69af12350092756351e44760', lccn: '2021666344',
    from: { title: '交友論 (On Friendship)', author: 'Matteo Ricci' },
    to: {
      title: '新刻出相音註勸善目連救母行孝戲文 (Mulian Rescues His Mother)',
      display_title: 'Mulian Rescues His Mother', english_title: 'Mulian Rescues His Mother',
      author: 'Zheng Zhizhen (鄭之珍)', author_id: 'zheng-zhizhen',
      published: 'Wanli era, Ming dynasty', year: null, tradition: ['Chinese'],
    },
    author_variants: ['Zheng Zhizhen', '鄭之珍'],
    wrongRx: /Ricci|Friendship|Jiaoyou|Jesuit/i,
    why: 'p.2 「新刻出相音註勸善目連救母行孝戲文卷一 新安 鄭之珍 編 金陵 富春堂 梓」; p.14 header 「新刊目連記卷上冊三」; LoC: "Xin ke chu xiang yin zhu Quan shan Mulian jiu mu xing xiao xi wen (Mulian rescues his mother) is a drama by Ming playwright Zheng Zhizhen (1518--95) ... printed by Tang Fuchun at Fuchun Tang, his workshop in Nanjing during the Wanli era"; #6660',
  },
  {
    id: '69af12380092756351e4478a', lccn: '2021666467',
    from: { title: '天主實義 (The True Meaning of the Lord of Heaven)', author: 'Matteo Ricci' },
    // LoC's record is the five-play set 五種傳奇; these 178 pages hold the set's general
    // commentary and one play, 浣紗記, complete (scenes 1-45, p.174 第四十五齣).
    to: {
      title: "李卓吾先生批評浣紗記 (The Tale of Washing Silk, with Li Zhuowu's Commentary)",
      display_title: "The Tale of Washing Silk, with Li Zhuowu's Commentary",
      english_title: "The Tale of Washing Silk, with Li Zhuowu's Commentary",
      author: 'Liang Chenyu (梁辰魚)', author_id: 'liang-chenyu',
      published: 'Ming dynasty', year: null, tradition: ['Chinese'],
    },
    author_variants: ['Liang Chenyu', '梁辰魚'],
    wrongRx: /Ricci|Lord of Heaven|Tianzhu shiyi|Jesuit/i,
    why: 'p.2 heading 「二刻五種傳奇總評」; p.6 「李卓吾先生批評浣紗記目錄」; p.15 「李卓吾先生批評浣紗記卷上 第一齣」; p.174 「第四十五齣」; LoC: "This work contains five southern dramas: Huan sha ji (The tale of washing silk) ... written by Ming dramatist Liang Chenyu (circa 1519-circa 1591) ... The play has 45 scenes"; #6660',
  },
  {
    id: '69af123e0092756351e44874', lccn: '2021666479',
    from: { title: '職方外紀 (Record of Places Outside the Tributaries)', author: 'Giulio Aleni' },
    to: {
      title: '新鐫節義鴛鴦塚嬌紅記 (The Story of Jiaoniang and Feihong)',
      display_title: 'The Story of Jiaoniang and Feihong', english_title: 'The Story of Jiaoniang and Feihong',
      author: 'Meng Chengshun (孟稱舜)', author_id: 'meng-chengshun',
      published: 'Chongzhen era, Ming dynasty', year: null, tradition: ['Chinese'],
      // Enrichment read the collector's slip on p.1 (蘇州吳梅…藏書, Wu Mei 1884-1939) as the imprint.
      place_of_publication: null, publisher: null,
    },
    dropCollections: ['chinese-history-statecraft', 'geography-exploration'],
    author_variants: ['Meng Chengshun', '孟稱舜'],
    wrongRx: /Aleni|Zhifang|Outside the Tributaries|Jesuit/i,
    why: 'p.1 「嬌紅記 四册一」 (+ slip 「蘇州吳梅…藏書」); p.15 header 「新鐫節義鴛鴦塚嬌紅記」, 「崇禎戊寅仲夏會稽孟稱舜題」; p.17 「古越孟稱舜著 陳洪綬評點」; LoC: "Jiao hong ji ... The drama was written by Ming playwright Meng Chengshun ... The copy presented here is a Ming Chongzhen edition ... with commentary and illustrations by Chen Hongshou"; #6660',
  },
  {
    id: '69af12510092756351e44992', lccn: '2021666482',
    from: { title: '坤輿萬國全圖 (Complete Map of All Lands)', author: 'Matteo Ricci & Li Zhizao' },
    to: {
      title: '重校韓夫人題紅記 (The Story of the Poem on the Red Leaf)',
      display_title: 'The Story of the Poem on the Red Leaf', english_title: 'The Story of the Poem on the Red Leaf',
      author: 'Wang Jide (王驥德)', author_id: 'wang-jide',
      published: 'late Wanli era, Ming dynasty', year: null, tradition: ['Chinese'],
    },
    dropCollections: ['geography-exploration', 'chinese-history-statecraft', 'picturing-the-world-1450-1750'],
    author_variants: ['Wang Jide', '王驥德'],
    wrongRx: /Ricci|Li Zhizao|Kunyu|Map of All|world map|Jesuit/i,
    why: 'p.2 label 「重校韓夫人題紅記」; p.3 「題紅記敘」; p.4 「稽王生伯良」 (Wang Jide, courtesy name Boliang); p.7 「重校韓夫人題紅記上卷 第一齣 家門梗槩」; LoC: "Ti hong ji (Story of the poem written on the red leaf) was written by Wang Jide (died 1623) ... printed by Jizhizhai ... in Nanjing during the late Wanli period"; #6660',
  },
  {
    id: '69af12630092756351e449f9', lccn: '2021666476',
    from: { title: '同文算指 (Guide to Calculation)', author: 'Matteo Ricci & Li Zhizao' },
    to: {
      title: '墨子 (Mozi)', display_title: 'Mozi', english_title: 'Mozi',
      author: 'Mozi', author_id: 'mozi',
      published: '1552', year: 1552, tradition: ['Chinese'],
      // Enrichment took Huzhou from 「吳興陸穩」 (the base edition's editor's home); LoC
      // and the colophon place the copper-type printing at Zhicheng.
      place_of_publication: 'Zhicheng (芝城)', publisher: null,
    },
    dropCollections: ['mathematics'],
    author_variants: null, // authors/mozi exists
    wrongRx: /Ricci|Li Zhizao|Tongwen|Guide to Calculation|Jesuit/i,
    why: 'p.2 「讀墨子 昌黎韓愈撰」; pp.3-4 contents of 墨子, 「明刑部河南清吏司郎中吳興北川陸穩校行 墨子序目終」; p.87 colophon 「嘉靖三十一年歲次壬子季夏之吉芝城銅板活字」; p.175 「復翁黃丕烈識」; LoC: "This important edition is a blue-ink Ming edition, printed with a copper movable type, in the 31st year (1552) of the Jianjing reign in Zhicheng. At the end is a postscript, handwritten by ... Huang Pilie"; #6660',
  },
  {
    id: '69af124b0092756351e44955', lccn: '2021666340',
    from: { title: '西國記法 (Western Methods of Memorization)', author: 'Matteo Ricci' },
    // LoC's record also describes 名理探; it does not occur in these 118 pages.
    to: {
      title: '寰有詮 (On Heaven and Earth)', display_title: 'On Heaven and Earth', english_title: 'On Heaven and Earth',
      author: 'Francisco Furtado (傅汎際) & Li Zhizao (李之藻)', author_id: 'francisco-furtado',
      published: '1628', year: 1628, tradition: ['Chinese', 'Renaissance & Early Modern Europe'],
    },
    dropCollections: ['art-of-memory'],
    author_variants: ['Francisco Furtado', 'Fu Fanji', '傅汎際'],
    wrongRx: /Ricci|Memoriz|Xiguo jifa|memory palace/i,
    why: 'pp.3-4 「譯寰有詮序」; p.19 「崇禎元年戊辰…李之藻盟手謹識」 then 「寰有詮目錄」; p.27 「寰有詮卷之一 波爾杜曷後學 傅汎際 譯義 西湖存園寄叟 李之藻 達辭」; 名理探 0 pages, 記法 0 pages; LoC: "Fu Fanji (Francisco Furtado, 1587--1653) translated ... Huan you quan (On heaven and Earth), a translation ... of Aristotle\'s De Coelo ... the completion date of the translation (1625) and that of the printing (1628)"; #6660',
  },
];

const UNSET = ['summary', 'summary_candidate', 'reading_summary', 'quality_assessment', 'quality_score',
  'faceted_tags', 'locations', 'author_entity_id', 'source_work_dates', 'source_work_dates_meta',
  'work_id', 'work_id_confidence', 'work_id_source', 'work_title', 'work_slug',
  'edition_key', 'edition_key_quality'];
const BASE_SET = ['title', 'display_title', 'english_title', 'author', 'author_id', 'published', 'year',
  'tradition', 'normalized_title', 'normalized_author'];
// Every field a book's repair may touch: what `before` snapshots and --revert restores.
const ALL_FIELDS = [...BASE_SET, 'place_of_publication', 'publisher', 'collections', ...UNSET];

const cleanEnv = (v) => (v || '').replace(/\\n/g, '').trim();
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
async function supabasePatch(id, patch) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(b) ? b.length : 0 };
}
// Mongo field -> books_catalog column, for the fields that are mirrored.
function catalogPatch(v) {
  const p = { title: v.title, display_title: v.display_title, author: v.author, year: v.year ?? null,
    published: v.published ?? null, work_id: v.work_id ?? null };
  if ('place_of_publication' in v) p.place_published = v.place_of_publication ?? null; // imprint-write-ok: Supabase mirror patch, not a books write (the books write is stamped below)
  if ('publisher' in v) p.publisher = v.publisher ?? null; // imprint-write-ok: Supabase mirror patch, not a books write
  if ('collections' in v) p.collections = v.collections ?? [];
  return p;
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const plan = BOOKS.filter((b) => !ONLY || b.id === ONLY);
if (ONLY && !plan.length) { console.error(`--book=${ONLY} is not in the table`); process.exit(1); }

if (REVERT) {
  for (const P of plan) {
    const log = await db.collection('sweep_log').findOne({ sweep: RUN, book_id: P.id, action: 'identity-repaired-by-hand' }, { sort: { _id: 1 } });
    if (!log) { console.log(`${P.id}: no sweep_log row — nothing to revert`); continue; }
    const { before, before_book_index_summary: idxBefore, touched } = log.detail;
    const set = {}; const unset = {};
    for (const f of touched) (before[f] === undefined ? (unset[f] = '') : (set[f] = before[f]));
    console.log(`${P.id}: would restore ${Object.keys(set).length} field(s), unset ${Object.keys(unset).length}`);
    if (!APPLY) continue;
    const r = await books.updateOne({ id: P.id }, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (idxBefore) await db.collection('book_indexes').updateOne({ book_id: P.id }, { $set: { bookSummary: idxBefore } });
    const mirrorKeys = [...BASE_SET, 'work_id', ...['place_of_publication', 'publisher', 'collections'].filter((f) => touched.includes(f))];
    const s = await supabasePatch(P.id, catalogPatch(Object.fromEntries(mirrorKeys.map((f) => [f, before[f]]))));
    const glogs = await db.collection('sweep_log').find({ sweep: RUN, book_id: P.id, action: 'gallery-caption-repaired' }).sort({ _id: -1 }).toArray();
    for (const g of glogs) {
      const { image_id, page_id, detection_index, before: gb } = g.detail;
      await db.collection('gallery_images').updateOne({ id: image_id }, { $set: gb });
      const pageSet = {};
      if (gb.museum_description !== undefined) pageSet[`detected_images.${detection_index}.museum_description`] = gb.museum_description;
      if (Object.keys(pageSet).length) await db.collection('pages').updateOne({ id: page_id }, { $set: pageSet });
    }
    console.log(`  reverted book: ${r.modifiedCount}; gallery images: ${glogs.length}; supabase ${JSON.stringify(s)} (summary_text re-mirrors on the next catalog sync)`);
  }
  if (!APPLY) console.log('(add --apply)');
  await mc.close(); process.exit(0);
}

// Gallery lane: each illustration mirrors the book's title/author/year, and captions were
// written knowing the wrong identity. The $0 part only (reground-captions.mjs is paid):
//   - mirrors follow the repaired book;
//   - a `museum_description` naming the wrong work is withheld (original -> sweep_log);
//   - a pixel `description` naming it is NOT auto-edited: the run stops and names it, since
//     no generic cut is known to leave a true sentence (#5620 had a hand-written one);
//   - subject tags naming it are dropped.
async function repairGallery(P) {
  const imgs = await db.collection('gallery_images').find({ book_id: P.id }).toArray();
  let changed = 0;
  for (const img of imgs) {
    const set = { book_title: P.to.display_title, book_author: P.to.author, book_year: P.to.year ?? null };
    const unset = {};
    const before = { book_title: img.book_title, book_author: img.book_author, book_year: img.book_year };
    if (typeof img.description === 'string' && P.wrongRx.test(img.description)) {
      throw new Error(`${img.id}: pixel description names the wrong work — hand-edit needed: ${img.description}`);
    }
    if (typeof img.museum_description === 'string' && P.wrongRx.test(img.museum_description)) {
      unset.museum_description = ''; before.museum_description = img.museum_description;
    }
    const subjects = img.metadata?.subjects;
    if (Array.isArray(subjects) && subjects.some((s) => P.wrongRx.test(s))) {
      set['metadata.subjects'] = subjects.filter((s) => !P.wrongRx.test(s)); before['metadata.subjects'] = subjects;
    }
    const noop = img.book_title === set.book_title && img.book_author === set.book_author && (img.book_year ?? null) === set.book_year
      && Object.keys(set).length === 3 && !Object.keys(unset).length;
    if (noop) continue;
    changed++;
    const extra = [...Object.keys(set).slice(3), ...Object.keys(unset).map((k) => `-${k}`)];
    if (extra.length) console.log(`    gallery ${img.id} p${img.page_number}: mirrors + ${extra.join(', ')}`);
    if (!APPLY) continue;
    await recordSweepAction(db, {
      sweep: RUN, book_id: P.id, action: 'gallery-caption-repaired',
      detail: { image_id: img.id, page_id: img.page_id, detection_index: img.detection_index, before },
    });
    await db.collection('gallery_images').updateOne({ id: img.id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (unset.museum_description !== undefined) {
      await db.collection('pages').updateOne({ id: img.page_id }, { $unset: { [`detected_images.${img.detection_index}.museum_description`]: '' } });
    }
  }
  console.log(`  gallery images ${APPLY ? 'repaired' : 'to repair'}: ${changed} of ${imgs.length}`);
}

let failures = 0;
for (const P of plan) {
  const book = await books.findOne({ id: P.id });
  if (!book) { console.error(`!! ${P.id} not found`); failures++; continue; }
  console.log(`\n=== ${P.id}  (LoC ${book.loc_lccn})`);
  if (book.loc_lccn !== P.lccn) { console.error(`!! LCCN ${book.loc_lccn} != ${P.lccn}`); failures++; continue; }
  if (book.title !== P.from.title || book.author !== P.from.author) {
    console.log(`  no longer carries the wrong identity (title="${book.title}", author="${book.author}") — book fields skipped`);
    await repairGallery(P);
    continue;
  }
  const to = { ...P.to, normalized_title: normalizeTitle(P.to.title), normalized_author: normalizeAuthor(P.to.author) };
  if (P.dropCollections) to.collections = (book.collections || []).filter((c) => !P.dropCollections.includes(c));
  const setFields = Object.keys(to);
  const unsetHere = UNSET.filter((f) => book[f] !== undefined);
  // `null` in the table means "remove the guessed value": unset rather than store null.
  const nullUnset = setFields.filter((f) => to[f] === null && !['year'].includes(f));
  for (const f of nullUnset) delete to[f];
  for (const f of Object.keys(to)) if (JSON.stringify(book[f]) !== JSON.stringify(to[f])) console.log(`  set    ${f}: ${JSON.stringify(book[f])} -> ${JSON.stringify(to[f])}`);
  for (const f of nullUnset) if (book[f] !== undefined) console.log(`  unset  ${f}: ${JSON.stringify(book[f])}`);
  for (const f of unsetHere) console.log(`  unset  ${f}: ${JSON.stringify(book[f]).slice(0, 80)}`);
  const idx = await db.collection('book_indexes').findOne({ book_id: P.id }, { projection: { bookSummary: 1 } });
  console.log(`  book_indexes.bookSummary: ${idx?.bookSummary ? 'unset (describes the wrong work)' : 'absent'}`);
  const existing = await db.collection('authors').findOne({ _id: P.to.author_id });
  if (!existing && !P.author_variants) { console.error(`!! authors/${P.to.author_id} missing and no variants to mint`); failures++; continue; }
  console.log(`  authors/${P.to.author_id}: ${existing ? `exists (${existing.canonical_name})` : 'mint'}`);
  if (!APPLY) { await repairGallery(P); continue; }

  // Backup first, as a sweep_log row: the record of the action AND what --revert reads.
  const touched = [...new Set([...Object.keys(to), ...nullUnset, ...unsetHere])].filter((f) => ALL_FIELDS.includes(f));
  const before = {};
  for (const f of touched) if (book[f] !== undefined) before[f] = book[f];
  await recordSweepAction(db, {
    sweep: RUN, book_id: P.id, action: 'identity-repaired-by-hand',
    detail: { why: P.why, before, touched, before_book_index_summary: idx?.bookSummary ?? null, to },
  });
  const now = new Date();
  let minted = { upsertedCount: 0 };
  if (!existing) {
    minted = await db.collection('authors').updateOne({ _id: P.to.author_id }, {
      $setOnInsert: {
        canonical_name: P.author_variants[0], slug: P.to.author_id,
        variants: [...new Set([P.to.author, ...P.author_variants])], variant_slugs: [P.to.author_id],
        viaf_id: null, wikidata_id: null, entity_ids: [],
        source: 'hand-adjudicated', built_at: now.toISOString(), note: P.why,
      },
    }, { upsert: true });
  }
  const unset = Object.fromEntries([...unsetHere, ...nullUnset].map((f) => [f, '']));
  const r = await books.updateOne({ id: P.id, title: P.from.title }, { $set: { ...to, updated_at: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  console.log(`  authors minted: ${minted.upsertedCount}  book modified: ${r.modifiedCount}`);
  if (r.modifiedCount !== 1) { console.error('  !! book not modified'); failures++; continue; }
  // Imprint fields carry a field_provenance stamp with the value they replaced (#6327). Written right after the
  // books write rather than through setCatalogueFields, because that helper cannot also $unset the derived lane.
  const imprint = touched.filter((f) => IMPRINT_FIELDS.includes(f));
  if (imprint.length) {
    const pset = {}, ppush = {};
    for (const f of imprint) {
      const prov = provenanceUpdate(f, { source: 'hand-adjudicated', script: 'scripts/maintenance/repair-loc-jesuit-misfiles-6660.mjs',
        date: now, previous_value: before[f] ?? null, evidence: { rationale: P.why } });
      Object.assign(pset, prov.$set); Object.assign(ppush, prov.$push);
    }
    await books.updateOne({ id: P.id }, { $set: pset, $push: ppush });
  }
  const ix = await db.collection('book_indexes').updateOne({ book_id: P.id }, { $unset: { bookSummary: '' } });
  console.log(`  book_indexes modified: ${ix.modifiedCount}`);
  await db.collection('field_provenance').insertMany(['title', 'author'].map((field) => ({
    book_id: P.id, field, value: to[field], previous_value: P.from[field], source: 'hand-adjudicated', run: RUN,
    evidence: { rationale: P.why, adjudicated_by: 'pages read against the LoC description, no model verdict used' },
    created_at: now.toISOString(),
  })));
  // The book page reads title and "About this book" from the Supabase mirror first.
  const mirror = catalogPatch({ ...to, work_id: null, ...Object.fromEntries(nullUnset.map((f) => [f, null])) });
  const s = await supabasePatch(P.id, { ...mirror, summary_text: null, quality_score: 0, source_work_dates: null });
  console.log(`  supabase: ${JSON.stringify(s)}`);
  await repairGallery(P);
}
console.log(APPLY
  ? `\nDone (${failures} failure(s)). Next, per book: materialize-edition-keys --book-id=<id> --apply, then revalidate /book/<id>.`
  : `\n-- dry run (${failures} problem(s)); add --apply --`);
await mc.close();
if (failures) process.exitCode = 1;
