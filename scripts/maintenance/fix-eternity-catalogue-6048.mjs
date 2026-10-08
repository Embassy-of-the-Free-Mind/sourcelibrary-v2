#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/apply-titlepage-bylines-3982.mjs (writes `books.author` from a
 * measured title-page reader over a frozen pool; author only, and its pool excludes non-Latin
 * books) and scripts/maintenance/recatalogue-magliabechiano-4164.mjs (one manuscript family).
 * Neither fits seven unrelated books whose date, language, author or editor was each checked by
 * a person against the title leaf; what they share is the shape, which is reused here: a
 * declared list, dry run by default, identity fields recomputed by the shared helper, one
 * `sweep_log` row per book carrying before, after and the evidence.
 *
 * Catalogue corrections from the Eternity spot check (#6048).
 *
 * Each entry names the page whose IMAGE was opened and what it shows. `books.language` is the
 * EDITION's language and `published` / `year` are the EDITION's date (`language-fields.md`,
 * `edition-identity.md`): four of these carried the work's composition date or a Hijri year
 * read as Gregorian. Nothing is deleted; every prior value is in the `sweep_log` row, and
 * `--revert` puts it back from there.
 *
 * WHAT READS THESE FIELDS. `books.updated_at` is bumped, so `sync-books-catalog.mjs`
 * (incremental, Hetzner cron) copies the new values to the Supabase `books_catalog` grid on its
 * next pass, and the identity worker sees the same `edition_key` this writes. No paid lane
 * selects on any field written here.
 *
 * Usage (dry run by default):
 *   node --env-file=.env.production.local scripts/maintenance/fix-eternity-catalogue-6048.mjs
 *   … --apply
 *   … --revert --apply      restore the `before` values recorded by the last apply
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const SWEEP = 'eternity-catalogue-6048';
const page = (id, n) => `https://sourcelibrary.org/book/${id}?page=${n}`;

const FIXES = [
  {
    id: '6a3c61ce879008ba7e160a56',
    label: 'Zazen yōjinki',
    set: {
      author: 'Keizan Jōkin (瑩山紹瑾)',
      language: 'Classical Chinese', languages: ['Classical Chinese'], language_multi: false,
      published: '2008', year: 2008,
      publisher: 'Taiwan: 蓮因寺大專學生齋戒學會 (Lianyin Temple)',
    },
    // The "origin: Isfahan" pin was derived from the wrong language tag.
    dropLocations: (l) => l?.source === 'tradition' && l?.country === 'Iran',
    evidence: `Read from image: the title leaf (${page('6a3c61ce879008ba7e160a56', 1)}) and the text (p3) are Chinese characters, 坐禪用心記, a kanbun work; nothing on any leaf is Persian. The colophon (${page('6a3c61ce879008ba7e160a56', 17)}) reads 蓮因寺大專學生齋戒學會恭印, 民國九十七年 (2008). The author is NOT on a leaf: the Internet Archive record (2008_20240319) gives 日本 瑩山紹瑾 著, and the opening line is Keizan's text.`,
  },
  {
    id: '69e7934980b52390feb1853b',
    label: 'ʿAṭṭār, Ilāhī-Nāma',
    set: {
      published: '1940', year: 1940,
      publisher: 'Istanbul: Maṭbaʿa-i Maʿārif (Nashriyāt-i Islāmiyya 12, Deutsche Morgenländische Gesellschaft)',
      editor: 'Hellmut Ritter',
    },
    evidence: `Read from image: the title page (${page('69e7934980b52390feb1853b', 1)}) reads الهی نامه از گفتار فریدالدین عطّار بتصحیح ه. ریتر, استانبول: مطبعهٔ معارف ١٩٤٠. 1200 was the approximate date of composition.`,
  },
  {
    id: '69d5abbf4dc55b8478ddcfa6',
    label: 'Ibn ʿArabī, Fuṣūṣ al-ḥikam (BnF Arabe 1341)',
    set: { published: '16th century', year: 1550, year_earliest: 1501, year_latest: 1600 },
    evidence: `Read from image: the shelfmark label (${page('69d5abbf4dc55b8478ddcfa6', 2)}) reads ARABE 1341. From the BnF record for that shelfmark (ark:/12148/btv1b110007190): "Copie anonyme et non datée", date 1501-1600, Ottoman hand. From OCR text: the closing formula on p130 carries no date. 1229 is when the work was composed, not when this copy was made.`,
  },
  {
    id: '69e7299ba409200ea79f0b56',
    label: 'Rūmī, Masnavī (Bulaq 1851)',
    set: { languages: ['Persian', 'Ottoman Turkish'], language_multi: true },
    evidence: `Read from image: ${page('69e7299ba409200ea79f0b56', 150)} is set in four columns, the right pair the Persian couplets and the left pair an Ottoman Turkish verse rendering of the same couplets (اولدی, ایدی, ایله). \`language\` stays Persian, the principal text.`,
  },
  {
    id: '6a3067e0c4fd77fb5b9f87ea',
    label: 'Vigrahavyāvartanī (JBORS 1937)',
    set: {
      title: 'Vigrahavyāvartanī (Sanskrit, ed. Jayaswal & Sāṅkṛtyāyana)',
      year: 1937,
      editor: 'K. P. Jayaswal; Rāhula Sāṅkṛtyāyana',
      publisher: 'Patna: Bihar and Orissa Research Society (Appendix to JBORS vol. XXIII, part III)',
    },
    evidence: `Read from image: the wrapper (${page('6a3067e0c4fd77fb5b9f87ea', 1)}) reads Journal of the Bihar and Orissa Research Society, vol. XXIII part III, September 1937, Patna; the title page (${page('6a3067e0c4fd77fb5b9f87ea', 3)}) reads "Edited by K. P. Jayaswal and Rāhula Sāṅkṛityāyana". Johnston & Kunst is the 1951 edition, a different book. \`published\` was already 1937.`,
  },
  {
    id: '69e77ab60fc6fc955e3618ce',
    label: 'Mi la ras pa, mGur ʼbum (Gangtey MS, EAP039/1/4/249)',
    set: { author: 'Milarepa; Tsangnyon Heruka (compiler)', author_id: 'milarepa' },
    evidence: `Read from image: the title leaf (${page('69e77ab60fc6fc955e3618ce', 1)}) reads rje btsun mi la ras paʼi rnam thar rgyas par phye ba mgur ʼbum, and the first text folio carries a miniature of the cotton-clad yogin with his hand to his ear. It does NOT name Longchenpa's Sems nyid ngal gso: that title exists only in the withheld Gemini reading of this page. "Gangtey Monastery Collection" is the holding collection, not an author; the compiler is not named on the leaf and follows the form this catalogue already uses for the same work.`,
  },
  {
    id: '69e8b2a72ff2a8dc09e7860d',
    label: 'al-Ghazālī, Iḥyāʾ (Beirut)',
    set: { published: '1982', year: 1982 },
    evidence: `Read from image: the title page (${page('69e8b2a72ff2a8dc09e7860d', 3)}) reads دار المعرفة، بيروت — لبنان، ١٤٠٢ هـ — ١٩٨٢ م. 1402 is the Hijri year.`,
  },
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await withMongo(async (db) => {
  const B = db.collection('books');

  if (REVERT) {
    for (const f of FIXES) {
      const row = await db.collection('sweep_log').find({ sweep: SWEEP, book_id: f.id, action: 'catalogue-corrected' }).sort({ _id: -1 }).limit(1).next();
      if (!row) { console.log(`${f.label}: no applied row — nothing to revert`); continue; }
      const set = {}; const unset = {};
      for (const [k, v] of Object.entries(row.detail.before)) { if (v === null) unset[k] = ''; else set[k] = v; }
      console.log(`${f.label}: revert ${Object.keys(row.detail.before).join(', ')}`);
      if (!APPLY) continue;
      await B.updateOne({ id: f.id }, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      await recordSweepAction(db, { sweep: SWEEP, book_id: f.id, action: 'catalogue-reverted', detail: { restored: row.detail.before } });
    }
    return;
  }

  let changed = 0;
  for (const f of FIXES) {
    const book = await B.findOne({ id: f.id });
    if (!book) { console.log(`${f.label}: NOT FOUND ${f.id}`); continue; }
    const set = { ...f.set };
    if (f.dropLocations && Array.isArray(book.locations)) set.locations = book.locations.filter((l) => !f.dropLocations(l));
    Object.assign(set, computeIdentityFields({ ...book, ...set }));

    const before = {}; const after = {};
    for (const [k, v] of Object.entries(set)) {
      if (same(book[k], v)) continue;
      before[k] = book[k] === undefined ? null : book[k];
      after[k] = v;
    }
    if (!Object.keys(after).length) { console.log(`${f.label}: already as corrected`); continue; }

    // An edition key is an identity claim: say so if the corrected one lands on another book.
    const clash = after.edition_key
      ? await B.find({ edition_key: after.edition_key, id: { $ne: f.id } }, { projection: { id: 1, title: 1 } }).limit(3).toArray()
      : [];
    console.log(`\n${f.label}  ${f.id}`);
    for (const k of Object.keys(after)) console.log(`  ${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
    if (clash.length) console.log(`  !! edition_key now shared with ${clash.map((c) => c.id).join(', ')}`);
    if (!APPLY) continue;

    const now = new Date();
    const update = { $set: { ...after, updated_at: now } };
    if (after.author_id) {
      update.$push = { author_link_provenance: { run: SWEEP, method: 'title-page-by-eye', matched: after.author ?? book.author, authors_slug: after.author_id, at: now.toISOString() } };
    }
    await B.updateOne({ id: f.id }, update);
    await recordSweepAction(db, {
      sweep: SWEEP, book_id: f.id, action: 'catalogue-corrected',
      detail: { issue: 6048, before, after, evidence: f.evidence, edition_key_shared_with: clash.map((c) => c.id) },
    });
    changed++;
  }
  console.log(`\n${APPLY ? 'applied' : 'dry run'}: ${APPLY ? changed : FIXES.length} book(s)`);
});
