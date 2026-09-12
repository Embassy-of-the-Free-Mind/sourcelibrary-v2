#!/usr/bin/env node
/**
 * #4394 — one work, 109 unlinked live records: normalise the Sancai Tuhui ingest.
 *
 * The 三才圖會 (Wang Qi & Wang Siyi, 1609) ingest arrived as ~108 independent
 * juan volumes with no work-level relationship holding them together: 5 author
 * strings, 91 distinct english_titles, 5 slug families, 4 years, 11 work_ids.
 * No single query returns the whole work, author browse is broken three ways,
 * and any year filter silently drops the volumes catalogued "Unknown".
 *
 * This normalises the *identity* layer only. Juan-level PART modeling — a
 * parent work record with ordered children — is #4246 and is deliberately NOT
 * done here; what this script guarantees is that when part modeling lands, the
 * juan number is already recoverable from every record.
 *
 * ANCHORS (verified against Wikidata 2026-08-30, per the verify-every-QID rule):
 *   Q1761479  三才圖會 / Sancai Tuhui — P31 = Q47461344 (written work, NOT an
 *             edition item), P50 = Q3503402, P577 = 1609.
 *   Q3503402  王圻 / Wang Qi — P31 = Q5 (human), 1529–1612. This is already the
 *             QID on our authors/wang-qi doc, so the two layers agree.
 * The 1609 date is therefore not a plurality vote: it is the work's published
 * date at the authority, and the 1607/Unknown/1609 scatter in our records is
 * noise inside a single IA ingest (juan 3, 7, 9 say 1607; juan 30–39 say 1609;
 * juan 70–75 say Unknown — the same print run, dated three ways at random).
 *
 * WHAT IT DOES NOT TOUCH: the three 和漢三才図会 (Wakan Sansai Zue) records.
 * That is Terajima Ryōan's 1712 Japanese derivative — a different work by a
 * different author in a different language, and it is correct as it stands.
 *
 * SLUGS: renaming a slug changes a public URL, so every old slug is preserved
 * in `slug_aliases` in the SAME update. findBookByIdOrSlug resolves aliases on
 * a would-be 404 and 301s to the canonical slug, so existing links keep working
 * (same mechanism as scripts/maintenance/repair-book-slugs.ts).
 *
 * WORK IDS: the 11 retired ids are kept on every record in `work_id_aliases`
 * (indexed; /work/[id] 307s an alias to the survivor via src/lib/work-alias.ts)
 * and the merge is logged to `work_id_merges`, matching merge-work-clusters.mjs.
 * Nothing becomes uncitable.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/normalize-sancai-tuhui-4394.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/normalize-sancai-tuhui-4394.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/normalize-sancai-tuhui-4394.mjs --revert
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/sancai-tuhui-4394-backup.json';
const SWEEP = 'sancai-tuhui-normalise-4394';

const CANON = {
  work_id: 'Q1761479',
  author: '王圻, 王思義',
  author_id: 'wang-qi',
  language: 'Chinese',
  published: '1609',
  english_base: 'Collected Illustrations of the Three Realms',
  slug_base: 'sancai-tuhui',
};

// ── juan number from a CJK title ────────────────────────────────────────────
// Titles run 三才圖會(一) … 三才圖會(一百六) — the work has 106 juan, and the
// corpus maximum is 106, which is what fixes the reading of the abbreviated
// hundreds form: 一百一 is juan 101, not 110.
const DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function parseJuan(title) {
  const m = String(title || '').match(/[（(]([一二三四五六七八九十百零]+)[）)]/);
  if (!m) return null;
  const s = m[1];
  let n = 0;
  if (s.startsWith('一百') || s.startsWith('百')) {
    const rest = s.replace(/^一?百/, '');
    n = 100;
    if (rest) {
      const sub = parseTens(rest.replace(/^零/, ''));
      if (sub == null) return null;
      n += sub;
    }
  } else {
    const sub = parseTens(s);
    if (sub == null) return null;
    n = sub;
  }
  return n >= 1 && n <= 106 ? n : null;
}

// Pull a subject label out of an old display_title:
//   "Collected Illustrations of the Three Realms: Astronomy"        → Astronomy
//   "Collected Illustrations of the Three Realms (Volume 3: Astronomy)" → Astronomy
// Anything that is merely a volume restatement is not a subject.
export function extractSubject(displayTitle) {
  const t = String(displayTitle || '');
  const m = t.match(/:\s*([A-Z][A-Za-z ]{2,30})\)?\s*$/);
  if (!m) return null;
  const s = m[1].trim();
  if (/^(vol|volume|part|juan)\b/i.test(s)) return null;
  if (/^\d+$/.test(s)) return null;
  return s;
}

function parseTens(s) {
  if (!s) return null;
  if (!s.includes('十')) {
    // bare unit: 一 … 九
    if (s.length === 1 && DIGITS[s]) return DIGITS[s];
    return null;
  }
  const [tensPart, onesPart] = s.split('十');
  const tens = tensPart === '' ? 1 : DIGITS[tensPart];
  if (!tens) return null;
  const ones = onesPart === '' ? 0 : DIGITS[onesPart];
  if (ones == null) return null;
  return tens * 10 + ones;
}

// ── cohort ─────────────────────────────────────────────────────────────────
// Selected on the Chinese title / slug families / english_title families, then
// the Japanese derivative is explicitly excluded. Keyed on book ids at write
// time (the records are verified individually), never re-derived from a regex.
const COHORT_QUERY = {
  $and: [
    { $or: [
      { title: { $regex: '三才圖會|三才图会|三才圖繪' } },
      { slug: { $regex: '^(sancai-tuhui|collected-illustrations-of-the-three-|illustrated-encyclopedia-of-the-three-)' } },
      { english_title: { $regex: 'Three (Realms|Powers|Talents)|Sancai', $options: 'i' } },
    ] },
    // the Wakan Sansai Zue derivative — different work, leave it alone
    { title: { $not: { $regex: '和漢三才' } } },
    { slug: { $not: { $regex: '^wakan-sansai' } } },
  ],
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  if (REVERT) return revert(client, db, books);

  const rows = await books.find(COHORT_QUERY).project({
    id: 1, title: 1, english_title: 1, author: 1, author_id: 1, slug: 1, slug_aliases: 1,
    language: 1, published: 1, work_id: 1, work_id_aliases: 1, work_id_source: 1, visible: 1,
  }).toArray();

  console.log(`cohort: ${rows.length} records (Wakan Sansai Zue excluded by construction)`);

  const retiredWorkIds = [...new Set(rows.map(r => r.work_id).filter(w => w && w !== CANON.work_id))];
  console.log(`work_ids to retire into ${CANON.work_id}: ${retiredWorkIds.length}`);

  // Plan every write before touching anything, and refuse to guess a slug.
  const plan = [];
  const unparsed = [];
  const slugSeen = new Map();
  for (const r of rows) {
    const juan = parseJuan(r.title);
    if (juan == null) { unparsed.push(r); }

    const slug = juan == null ? null : `${CANON.slug_base}-juan-${juan}`;
    if (slug) {
      if (!slugSeen.has(slug)) slugSeen.set(slug, []);
      slugSeen.get(slug).push(r);
    }
    plan.push({ r, juan, slug });
  }

  // A juan held by more than one witness is REAL (we hold two scans of juan 92),
  // so the slug must distinguish them rather than collide. Suffix by ordinal,
  // stable under re-runs because it is ordered by book id.
  for (const [slug, group] of slugSeen) {
    if (group.length < 2) continue;
    const ordered = group.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    ordered.forEach((r, i) => {
      if (i === 0) return;
      const p = plan.find(p => p.r.id === r.id);
      p.slug = `${slug}-${i + 1}`;
      p.duplicateJuan = true;
    });
    console.log(`  juan ${slug.split('-').pop()}: ${group.length} witnesses → ${ordered.map((r, i) => i === 0 ? slug : `${slug}-${i + 1}`).join(', ')}`);
  }

  if (unparsed.length) {
    console.log(`\n${unparsed.length} records carry no parseable juan number — slug and english_title left ALONE for these (identity fields still normalised):`);
    for (const r of unparsed) console.log(`  ${r.id} | ${r.title} | ${r.slug}`);
  }

  // ── backup (merge, never overwrite: a re-run must not shrink the restore set)
  const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { sweep: SWEEP, records: {} };
  for (const { r } of plan) {
    // earlier `before` wins — it is the true original
    if (!backup.records[r.id]) {
      backup.records[r.id] = {
        title: r.title, english_title: r.english_title, author: r.author, author_id: r.author_id,
        slug: r.slug, slug_aliases: r.slug_aliases, language: r.language, published: r.published,
        work_id: r.work_id, work_id_aliases: r.work_id_aliases, work_id_source: r.work_id_source,
      };
    }
  }

  let changed = 0;
  const ops = [];
  for (const { r, juan, slug } of plan) {
    const set = {};
    if (r.author !== CANON.author) set.author = CANON.author;
    if (r.author_id !== CANON.author_id) set.author_id = CANON.author_id;
    if (r.language !== CANON.language) set.language = CANON.language;
    if (String(r.published) !== CANON.published) set.published = CANON.published;
    if (r.work_id !== CANON.work_id) { set.work_id = CANON.work_id; set.work_id_source = 'wikidata-verified'; }
    if (juan != null) {
      // The SUBJECT carried by some old display_titles ("…: Astronomy") is real
      // editorial content — Sancai Tuhui's juan are grouped into subject
      // sections — and the juan number cannot regenerate it. Preserve it.
      const subject = extractSubject(r.display_title);
      const et = `${CANON.english_base}, juan ${juan}${subject ? `: ${subject}` : ''}`;
      if (r.english_title !== et) set.english_title = et;
      // display_title is what the READER sees (i18n.md: it IS the English
      // gloss). Normalising english_title alone fixes search and leaves the
      // scatter on the page — 90 distinct display_titles over 108 records.
      if (r.display_title !== et) set.display_title = et;
    }

    const addToSet = {};
    if (slug && r.slug !== slug) {
      set.slug = slug;
      if (r.slug) addToSet.slug_aliases = r.slug;   // old URL keeps resolving
    }
    if (r.work_id && r.work_id !== CANON.work_id) {
      addToSet.work_id_aliases = r.work_id;          // old /work/ URL keeps resolving
    }

    if (!Object.keys(set).length && !Object.keys(addToSet).length) continue;
    changed++;
    const update = {};
    if (Object.keys(set).length) update.$set = { ...set, updated_at: new Date() };
    if (Object.keys(addToSet).length) update.$addToSet = addToSet;
    ops.push({ id: r.id, before: { slug: r.slug, work_id: r.work_id, published: r.published, author: r.author }, update });
  }

  console.log(`\n${changed} of ${rows.length} records need a change.`);
  const sample = ops.slice(0, 6);
  for (const o of sample) {
    console.log(`  ${o.id}: ${JSON.stringify(o.update.$set || {})} ${o.update.$addToSet ? '+alias ' + JSON.stringify(o.update.$addToSet) : ''}`);
  }
  if (ops.length > sample.length) console.log(`  … and ${ops.length - sample.length} more`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await client.close();
    return;
  }

  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(BACKUP, JSON.stringify(backup, null, 1));
  console.log(`\nbackup: ${BACKUP} (${Object.keys(backup.records).length} records)`);

  let written = 0;
  for (const o of ops) {
    const res = await books.updateOne({ id: o.id }, o.update);
    if (res.modifiedCount !== 1) {
      console.error(`  WARN ${o.id}: modifiedCount=${res.modifiedCount} (expected 1)`);
      continue;
    }
    written++;
    await recordSweepAction(db, {
      sweep: SWEEP,
      book_id: o.id,
      action: 'normalised-work-identity',
      detail: { before: o.before, set: o.update.$set, aliases: o.update.$addToSet || null },
    });
  }
  console.log(`applied: ${written}/${ops.length} records modified`);

  if (retiredWorkIds.length) {
    await db.collection('work_id_merges').insertOne({
      survivor: CANON.work_id,
      retired: retiredWorkIds,
      book_count: written,
      reason: '#4394 — one work ingested as N unlinked juan volumes; anchored on Wikidata Q1761479',
      resolver: 'manual-verified',
      created_at: new Date(),
    });
    console.log(`work_id_merges: logged ${retiredWorkIds.length} retired ids → ${CANON.work_id}`);
  }

  console.log('\nNEXT (not done by this script):');
  console.log('  1. node scripts/workers/sync-books-catalog.mjs   # books_catalog carries work_id + slug');
  console.log('  2. revalidate the renamed /book/<slug> paths + purge Cloudflare');
  await client.close();
}

async function revert(client, db, books) {
  if (!existsSync(BACKUP)) { console.error(`no backup at ${BACKUP}`); process.exit(1); }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const ids = Object.keys(backup.records);
  console.log(`reverting ${ids.length} records from ${BACKUP}`);
  if (!APPLY) { console.log('DRY RUN — add --apply to write.'); await client.close(); return; }
  let n = 0;
  for (const id of ids) {
    const b = backup.records[id];
    const set = {};
    for (const [k, v] of Object.entries(b)) if (v !== undefined) set[k] = v;
    const unset = {};
    for (const [k, v] of Object.entries(b)) if (v === undefined) unset[k] = '';
    const update = { $set: { ...set, updated_at: new Date() } };
    if (Object.keys(unset).length) update.$unset = unset;
    const res = await books.updateOne({ id }, update);
    if (res.modifiedCount === 1) n++;
  }
  console.log(`reverted ${n}/${ids.length}`);
  await client.close();
}

// Only run when invoked directly — parseJuan is imported by the juan-coverage
// check, and importing a module must not start writing to production.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
