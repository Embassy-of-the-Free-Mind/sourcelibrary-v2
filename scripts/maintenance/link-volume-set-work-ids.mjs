#!/usr/bin/env npx tsx
/**
 * link-volume-set-work-ids.mjs — give the volumes of one multi-volume set a
 * shared work_id (#7528).
 *
 * PRIOR ART: scripts/maintenance/merge-work-clusters.mjs — the work_id merge
 * writer (winner via pickWinner, losers rewritten, loser ids kept in
 * work_id_aliases, a work_id_merges provenance row). Its identical-title lane
 * deliberately EXCLUDES volume-marked titles, and its containment lane only
 * queues, so it never links "Vol. 1" to "Vol. 2". This script reuses its
 * winner rule and its write shape for exactly that missing lane.
 * scripts/analysis/mint-local-work-ids.mjs — minted one id PER VOLUME (the
 * volume number sits inside the slug, `local:a:katsushika-hokusai:1-manga-vol`),
 * which is the fragmentation this script repairs; it has no merge path.
 *
 * WHY. A reader on one volume should reach the others; the "Other printings"
 * rail and the volumes strip read books.work_id. ~440 public sets had one
 * work_id per volume, so their volumes could not find each other.
 *
 * WHAT IT DOES. Groups public books (visible && pages_count > 0) whose titles
 * carry a volume marker by (title with the marker removed, author), and keeps
 * groups of >= 2 whose members do not already share one work_id. Each group
 * must pass every gate, or it is reported and left alone:
 *   author      same author_id on every member, or the same normalised byline
 *               with no conflicting author_id; empty author only with a single
 *               provider and a non-series title
 *   language    one `language`
 *   provider    one image_source.provider (or fingerprint prefix)
 *   year        span of known years <= MAX_YEAR_SPAN (container titles such as
 *               "Opera"/"Works": all known and span <= 10)
 *   volumes     every member has a parsed volume number, all distinct
 *               (a repeat = a duplicate or a second edition)
 *   series      periodical/series titles and Tibetan canon volumes are out:
 *               there each volume is a different work
 *   reach       every work_id in the group is carried ONLY by books inside
 *               the group, hidden books included — otherwise the merge would
 *               pull in another work, or rewrite a hidden book
 *   authority   at most one non-`local:` id in the group
 *   unminted    a member with no work_id at all → group left for a person
 *               (no id to join; we do not mint here)
 *   dedup-veto  a member whose edition_key has no volume slot and which still
 *               needs OCR (the Phase-2 work-copy dedup would skip it)
 *   ft-card     a member's id carries a settled Translation Card (a public
 *               first-translation statement would move)
 *
 * WRITES (with --apply), per group, merge-work-clusters' shape:
 *   - one sweep_log row per book (sweep `volume-sets-work-id-2026-10`,
 *     detail {from, to, set_size}) written BEFORE that book's update
 *   - books on a loser id → { work_id: winner, updated_at } + $addToSet
 *     work_id_aliases (loser ids), filtered on the id read at plan time
 *   - work_id_source 'work-merge:volume-set' on every moved book and every
 *     'local-mint' winner book: left as 'local-mint', a later
 *     `mint-local-work-ids.mjs --remint-local` would re-derive the per-volume
 *     ids from the titles and split the set again
 *   - books already on the winner id → $addToSet work_id_aliases
 *   - one work_id_merges provenance doc
 *   - work_slug made uniform across each linked set (the /work route and the
 *     rail's "View this work" link resolve work_slug first), logged per book
 * Nothing else changes: not visibility, titles, work_title, or hidden books.
 * Revert: replay the plan file (each book's prior work_id + work_id_source).
 * The incremental books_catalog sync picks the rows up via updated_at.
 *
 *   npx tsx --env-file=.env.production.local scripts/maintenance/link-volume-set-work-ids.mjs           # dry run
 *   npx tsx --env-file=.env.production.local scripts/maintenance/link-volume-set-work-ids.mjs --sample 15
 *   npx tsx --env-file=.env.production.local scripts/maintenance/link-volume-set-work-ids.mjs --apply
 * Plan + excluded groups are written to --out (default scripts/output/).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { pickWinner } from '../lib/work-merge-lib.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { deacc, slug, authorTokens } from '../lib/work-id-remint.mjs';
import { editionKeyVolume, hasFullText } from '../workers/lib/work-copy-dedup.mjs';

const { normalizeEditionTitle } = await import(new URL('../../src/lib/edition-key.ts', import.meta.url).href);
const { extractVolume, editionYear } = await import(new URL('../../src/lib/dedup.ts', import.meta.url).href);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = Number(argVal('--sample', 0));
const OUT_DIR = argVal('--out', path.join(process.cwd(), 'scripts', 'output'));
const SWEEP = 'volume-sets-work-id-2026-10';
const MAX_YEAR_SPAN = 80; // a set can be printed over decades (Hokusai Manga 1814–1878)
const ISSUE = 7528;

// ── volume parsing ─────────────────────────────────────────────────────────
const CJK_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cjkNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in CJK_DIGIT) cur = CJK_DIGIT[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
    else return null;
  }
  return total + cur || null;
}
const CJK_N = '[〇零一二两三四五六七八九十百千\\d]+';
// Volume-marker spans removed to form the set key. Order matters only for parsing.
const MARKER_RXS = [
  /[\s,.;:([]*\b(?:vol(?:ume)?s?|tom(?:us|o|e)?|band|bd|part|pt|pars|liber|livre|libro|deel|teil|theil|buch)\b\.?\s*\(?\s*(?:\d{1,3}|[ivxlcdm]{1,6}|primus|prima|secundus|secunda|tertius|tertia|quartus|quarta|quintus|quinta|sextus|sexta|septimus|septima|octavus|octava|nonus|nona|decimus|decima)\b\)?/giu,
  /[\s,.;:([]*\bv(?:\.\s*|\s+)0*\d{1,3}\b\)?/giu,
  new RegExp(`[\\s·・,]*第?${CJK_N}\\s*[卷巻冊册輯辑編编]`, 'gu'),
  new RegExp(`[\\s·・,]*[卷巻冊册](?:之)?${CJK_N}(?:\\s*[~〜～至-]\\s*[卷巻冊册]?${CJK_N})?`, 'gu'),
  /[\s·・,]*[(（]\s*[上中下]\s*[)）]|[\s·・,]+[上中下](?:巻|卷|冊)?$/gu,
];
const UMD = { 上: 1, 中: 2, 下: 3 };
const ORD = { primus: 1, prima: 1, secundus: 2, secunda: 2, tertius: 3, tertia: 3, quartus: 4, quarta: 4, quintus: 5, quinta: 5,
  sextus: 6, sexta: 6, septimus: 7, septima: 7, octavus: 8, octava: 8, nonus: 9, nona: 9, decimus: 10, decima: 10 };
function romanInt(r) {
  const map = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < r.length; i++) { const a = map[r[i]], b = map[r[i + 1]] || 0; total += a < b ? -a : a; }
  return total || null;
}
function parseVolume(title) {
  if (!title) return null;
  const v = extractVolume(title);
  if (v != null) return v;
  const t = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let m = t.match(/\b(?:pars|theil|livre|libro|buch|bd)\.?\s*(\d{1,3}|[ivxlcdm]{1,6}|primus|prima|secundus|secunda|tertius|tertia|quartus|quarta|quintus|quinta|sextus|sexta|septimus|septima|octavus|octava|nonus|nona|decimus|decima)\b/);
  if (m) { const n = ORD[m[1]] ?? (/^\d+$/.test(m[1]) ? parseInt(m[1], 10) : romanInt(m[1])); if (n) return n; }
  m = title.match(/\bv(?:\.\s*|\s+)0*(\d{1,3})\b/i);
  if (m) return parseInt(m[1], 10);
  m = title.match(new RegExp(`第?(${CJK_N})\\s*[卷巻冊册輯辑編编]`, 'u'));
  if (m) { const n = cjkNum(m[1]); if (n) return n; }
  m = title.match(new RegExp(`[卷巻冊册](?:之)?(${CJK_N})`, 'u'));
  if (m) { const n = cjkNum(m[1]); if (n) return n; }
  m = title.match(/[(（]\s*([上中下])\s*[)）]|\s([上中下])(?:巻|卷|冊)?$/u);
  if (m) return UMD[m[1] || m[2]];
  return null;
}
function setTitle(title) {
  let t = String(title || '');
  for (const rx of MARKER_RXS) t = t.replace(rx, ' ');
  return normalizeEditionTitle(t);
}
const hasMarker = (title) => MARKER_RXS.some((rx) => { rx.lastIndex = 0; const r = rx.test(title || ''); rx.lastIndex = 0; return r; });

// ── other keys ─────────────────────────────────────────────────────────────
const normByline = (a) => [...new Set(String(a || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1))].sort().join(' ');
const GENERIC_BYLINE = /^(?:various|unknown|anonymous|anon|anonym|collection|multiple|divers|n a|na|[a-z ]*collection)$/u;
const provider = (b) => b.image_source?.provider || (b.source_fingerprint ? String(b.source_fingerprint).split(':')[0] : null) || (b.held_by?.[0] ?? null);
const SERIES_RX = /\b(journal|transactions|proceedings|magazine|review|bulletin|annal|annales|jahrbuch|zeitschrift|archiv|archives|memoirs?|memoires|acta|berichte|abhandlungen|sitzungsber|revue|rivista|gazette|quarterly|monthly|weekly|almanac|calendar|sacred books|patrologia|patrologiae|monumenta|scriptores|series|reports?|papers|studies|studien|beitrage|mitteilungen|verhandlungen|kangyur|tengyur|kanjur|tanjur|tripitaka|bka gyur|bstan gyur)\b|大藏|大正|藏經|藏经|叢書|丛书|全書|全书|雜誌|杂志|学報|學報|紀要/iu;
// With no author, these titles usually name a series of different works.
const WEAK_SERIES_RX = /\b(corpus|bibliotheca|collectio|collection|sammlung|library|scriptores|opuscula|tractatus|texts)\b/iu;
// "Vol. 1 No. 6", "Heft 3", "Issue 2": a periodical — each issue is its own work.
const ISSUE_RX = /\b(?:no|nos|nr|num|number|issue|heft|fasc|fascicule)\.?\s*\d/iu;
const CONTAINER_RX = /^(?:works?|opera|opera omnia|werke|samtliche werke|oeuvres|oeuvres completes|collected works|complete works|writings|schriften|obras|opere)$/u;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const pub = await books.find({ visible: true, pages_count: { $gt: 0 } }, {
    projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, author_id: 1, language: 1, year: 1, published: 1,
      work_id: 1, work_id_source: 1, source_fingerprint: 1, held_by: 1, 'image_source.provider': 1,
      edition_key: 1, pages_ocr: 1, pages_count: 1 },
  }).toArray();

  // group by set title + byline
  const groups = new Map();
  for (const b of pub) {
    const title = b.title || b.display_title || '';
    if (!hasMarker(title)) continue;
    const st = setTitle(title);
    if (!st || st.length < 2) continue;
    const key = `${st}|${normByline(b.author)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...b, _title: title, _vol: parseVolume(title), _year: editionYear(b), _prov: provider(b) });
  }
  const multi = [...groups.entries()].filter(([, v]) => v.length >= 2);
  const shared = multi.filter(([, v]) => v.every((x) => x.work_id) && new Set(v.map((x) => x.work_id)).size === 1);
  const unlinked = multi.filter(([, v]) => !(v.every((x) => x.work_id) && new Set(v.map((x) => x.work_id)).size === 1));
  const partly = unlinked.filter(([, v]) => {
    const c = new Map(); for (const x of v) if (x.work_id) c.set(x.work_id, (c.get(x.work_id) || 0) + 1);
    return [...c.values()].some((n) => n >= 2);
  });
  console.log(`public books: ${pub.length} | volume-marked groups >=2: ${multi.length} | already one work_id: ${shared.length} | not linked: ${unlinked.length} (of which partly linked: ${partly.length})`);

  // carriers of every work_id in candidate groups, across the WHOLE collection (hidden too)
  const ids = [...new Set(unlinked.flatMap(([, v]) => v.map((x) => x.work_id).filter(Boolean)))];
  const carriers = new Map();
  for (let i = 0; i < ids.length; i += 2000) {
    const agg = await books.aggregate([{ $match: { work_id: { $in: ids.slice(i, i + 2000) } } },
      { $group: { _id: '$work_id', n: { $sum: 1 }, bids: { $push: '$id' } } }]).toArray();
    for (const a of agg) carriers.set(a._id, a);
  }

  // Translation Cards are keyed by work_id and the book page renders its work's
  // card (src/lib/first-translation/card.ts). A settled card on a per-volume id
  // would vanish from that volume's page — or, as winner, spread its claim to
  // the other volumes. Either changes a public first-translation statement.
  const settledCard = new Set((await db.collection('work_translation_history')
    .find({ _id: { $in: ids }, status: { $ne: 'under_review' } }, { projection: { _id: 1 } }).toArray()).map((c) => c._id));

  const gateCounts = {};
  const excluded = [];
  const plan = [];
  const mintedThisRun = new Set();
  for (const [key, v] of unlinked) {
    const fail = (gate, note) => { gateCounts[gate] = (gateCounts[gate] || 0) + 1; excluded.push({ gate, note, key, books: v.map(slim) }); };
    const st = key.split('|')[0];
    const aids = new Set(v.map((x) => x.author_id).filter(Boolean));
    const rawByline = key.split('|')[1];
    const byline = GENERIC_BYLINE.test(rawByline) ? '' : rawByline;
    const provs = new Set(v.map((x) => x._prov || 'unknown'));
    if (aids.size > 1) { fail('author'); continue; }
    if (!byline && !aids.size && (provs.size > 1 || provs.has('unknown'))) { fail('author', 'no author and no single provider'); continue; }
    if (new Set(v.map((x) => x.language || '')).size > 1) { fail('language'); continue; }
    if (v.some((x) => /tibetan/i.test(x.language || ''))) { fail('series', 'Tibetan canon volume'); continue; }
    if (SERIES_RX.test(st) || SERIES_RX.test(v[0]._title)) { fail('series'); continue; }
    if (!byline && !aids.size && WEAK_SERIES_RX.test(st)) { fail('series', 'authorless corpus/library title'); continue; }
    if (v.some((x) => ISSUE_RX.test(x._title))) { fail('series', 'periodical issue numbering'); continue; }
    if (provs.size > 1) { fail('provider'); continue; }
    const yrs = v.map((x) => x._year).filter((y) => y != null);
    const span = yrs.length ? Math.max(...yrs) - Math.min(...yrs) : 0;
    if (CONTAINER_RX.test(st)) {
      if (yrs.length < v.length || span > 10) { fail('year', `container title, span ${span}, ${v.length - yrs.length} unknown`); continue; }
    } else if (span > MAX_YEAR_SPAN) { fail('year', `span ${span}`); continue; }
    if (v.some((x) => x._vol == null)) { fail('volumes', 'unparsed volume number'); continue; }
    if (new Set(v.map((x) => x._vol)).size < v.length) { fail('volumes', 'repeated volume number'); continue; }
    if (v.some((x) => !x.work_id)) { fail('unminted'); continue; }
    // Phase-2 OCR dedup (scripts/workers/lib/work-copy-dedup.mjs) treats a
    // full-text sibling with the same work_id as a completed copy unless the
    // edition_key volume slots differ. A member with no volume slot that still
    // needs OCR would be skipped once it shares the set's id.
    if (v.some((x) => !editionKeyVolume(x.edition_key) && !hasFullText(x))) { fail('dedup-veto', 'member without an edition_key volume still needs OCR'); continue; }
    if (v.some((x) => settledCard.has(x.work_id))) { fail('ft-card', 'a per-volume id carries a settled Translation Card'); continue; }
    const mine = new Set(v.map((x) => x.id));
    const wids = [...new Set(v.map((x) => x.work_id))];
    const reach = wids.filter((w) => { const c = carriers.get(w); return !c || c.bids.some((bid) => !mine.has(bid)); });
    if (reach.length) { fail('reach', `${reach.length} id(s) carried outside the set: ${reach.slice(0, 3).join(', ')}`); continue; }
    if (wids.filter((w) => !w.startsWith('local:')).length > 1) { fail('authority'); continue; }
    const inbound = new Map(wids.map((w) => [w, carriers.get(w).n]));
    const winner = setLevelId(v, pickWinner(wids, inbound), carriers, mintedThisRun);
    if (winner.emptySlot) { fail('empty-author-slot', `winner ${winner.id} has an empty author slot (#4329)`); continue; }
    plan.push({ key, winner: winner.id, derived: winner.derived, fallback: winner.fallback,
      losers: wids.filter((w) => w !== winner.id), set_size: v.length,
      books: v.sort((a, b) => a._vol - b._vol).map(slim) });
  }
  // a derived set id must not already be carried by any book (it would merge a stranger)
  const derived = plan.filter((p) => p.derived).map((p) => p.winner);
  const taken = new Set((await books.distinct('work_id', { work_id: { $in: derived } })));
  for (const p of plan) {
    if (p.derived && taken.has(p.winner)) {
      p.winner = p.fallback; p.derived = false;
      p.losers = [...new Set(p.books.map((b) => b.work_id))].filter((w) => w !== p.winner);
    }
  }
  console.log(`set-level ids derived: ${plan.filter((p) => p.derived).length}; kept an existing id: ${plan.filter((p) => !p.derived).length}`);
  console.log('excluded per gate:', JSON.stringify(gateCounts));
  console.log(`ACCEPTED sets: ${plan.length} (${plan.reduce((s, p) => s + p.set_size, 0)} books; ${plan.reduce((s, p) => s + p.books.filter((b) => b.work_id !== p.winner).length, 0)} to rewrite)`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const planPath = path.join(OUT_DIR, `volume-sets-work-id-plan-${stamp}.json`);
  fs.writeFileSync(planPath, JSON.stringify({ generated: new Date().toISOString(), apply: APPLY, counts: {
    multi: multi.length, shared: shared.length, unlinked: unlinked.length, partly: partly.length, gateCounts, accepted: plan.length,
  }, plan, excluded }, null, 1));
  console.log(`plan -> ${planPath}`);

  if (SAMPLE) {
    const pick = [...plan].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
    for (const p of pick) {
      console.log(`\n[${p.set_size}] -> ${p.winner}`);
      for (const b of p.books) console.log(`   v${b.vol}  ${b.title.slice(0, 70)} | ${b.author || '-'} | ${b.year ?? '?'} | ${b.provider} | ${b.id} | ${b.work_id}`);
    }
  }

  if (!APPLY) {
    const slugPlan = await planSlugAlignment(books);
    console.log(`work_slug alignment pending on ${slugPlan.length} linked sets (applied with --apply)`);
    console.log('\nDRY RUN — pass --apply to write.'); await client.close(); return;
  }

  const now = new Date();
  let rewritten = 0, aliased = 0, skipped = 0;
  for (const p of plan) {
    for (const b of p.books) {
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: b.work_id === p.winner ? 'alias-stamped' : 'work-id-linked',
        detail: { from: b.work_id, to: p.winner, set_size: p.set_size, issue: ISSUE } });
      const moved = b.work_id !== p.winner;
      // a `local-mint` source would let `mint-local-work-ids.mjs --remint-local`
      // re-derive the per-volume ids and split the set again
      const stamp = moved || b.work_id_source === 'local-mint'
        ? { work_id_source: 'work-merge:volume-set', work_id_confidence: 'deterministic' } : {};
      const res = await books.updateOne({ id: b.id, work_id: b.work_id, visible: true },
        { $set: { ...(moved ? { work_id: p.winner } : {}), ...stamp, updated_at: now }, $addToSet: { work_id_aliases: { $each: p.losers } } });
      if (!res.matchedCount) skipped++;
      else if (b.work_id === p.winner) aliased += res.modifiedCount; else rewritten += res.modifiedCount;
    }
    await db.collection('work_id_merges').insertOne({ winner: p.winner, losers: p.losers, sources: ['volume-set'],
      books_rewritten: p.books.filter((b) => b.work_id !== p.winner).length, issue: ISSUE, sweep: SWEEP, backup: planPath, applied_at: now });
  }
  console.log(`APPLIED — ${rewritten} books moved to the set's work_id, ${aliased} winner books alias-stamped, ${skipped} skipped (changed since plan).`);

  // work_slug: the /work/<slug> route resolves work_slug BEFORE work_id, and the
  // "Other printings" rail links to a sibling's work_slug. Each volume still
  // carries its own per-volume slug, so that link would open a one-volume page.
  const slugPlan = await planSlugAlignment(books);
  let slugged = 0;
  for (const sp of slugPlan) {
    for (const b of sp.books) {
      if (b.work_slug === sp.slug) continue;
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'work-slug-aligned',
        detail: { from: b.work_slug ?? null, to: sp.slug, work_id: sp.work_id, set_size: sp.books.length, issue: ISSUE } });
      const r = await books.updateOne({ id: b.id, work_id: sp.work_id, visible: true }, { $set: { work_slug: sp.slug, updated_at: new Date() } });
      slugged += r.modifiedCount;
    }
  }
  console.log(`work_slug aligned on ${slugged} books across ${slugPlan.length} sets.`);
  await client.close();
}

// One work_slug per linked set, built the way scripts/analysis/assign-work-slugs.mjs
// builds it (author surname + slugified uniform title), from the lowest volume's
// title with its volume marker removed. If that slug is carried by any book
// outside the set, keep the lowest volume's existing slug instead.
const slugify = (x) => deacc(x).replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
function slugSurname(author) {
  const a = deacc(author).replace(/\(.*?\)/g, '').replace(/[^a-z ,]/g, ' ').trim();
  if (a.includes(',')) return a.split(',')[0].trim().split(/\s+/).pop() || '';
  const p = a.split(/\s+/).filter(Boolean);
  return p[p.length - 1] || '';
}
async function planSlugAlignment(books) {
  const rows = await books.find({ work_id_source: 'work-merge:volume-set', visible: true },
    { projection: { _id: 0, id: 1, title: 1, author: 1, work_id: 1, work_slug: 1 } }).toArray();
  const byWork = new Map();
  for (const r of rows) { if (!byWork.has(r.work_id)) byWork.set(r.work_id, []); byWork.get(r.work_id).push({ ...r, _vol: parseVolume(r.title) ?? 9999 }); }
  const out = [];
  const usedSlugs = new Set();
  for (const [work_id, bks] of byWork) {
    if (bks.length < 2 || new Set(bks.map((b) => b.work_slug || '')).size === 1) continue;
    bks.sort((a, b) => a._vol - b._vol);
    let stripped = String(bks[0].title || '');
    for (const rx of MARKER_RXS) stripped = stripped.replace(rx, ' ');
    const sn = slugSurname(bks[0].author);
    const titleSlug = slugify(stripped);
    let slug = titleSlug;
    if (titleSlug && sn && !slug.includes(slugify(sn))) slug = `${slugify(sn)}-${slug}`.slice(0, 80).replace(/-+$/, '');
    const mine = new Set(bks.map((b) => b.id));
    // a title that slugifies to nothing (CJK outside the parentheses) or a slug
    // another book or another set already holds → keep the lowest volume's own slug
    const clash = !/[a-z]{3,}/.test(titleSlug) || usedSlugs.has(slug)
      || (await books.find({ work_slug: slug }, { projection: { _id: 0, id: 1 } }).toArray()).some((x) => !mine.has(x.id));
    if (clash) slug = bks[0].work_slug;
    if (!slug || usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);
    out.push({ work_id, slug, books: bks });
  }
  if (SAMPLE) for (const sp of out.slice(0, SAMPLE)) console.log(`  slug ${sp.slug}  <- ${sp.books[0].title.slice(0, 60)} (${sp.books.length})`);
  return out;
}

// ── the set's id ───────────────────────────────────────────────────────────
// Per-volume local mints carry the volume number inside the slug
// (`local:a:katsushika-hokusai:1-manga-vol`). The set's id is the same mint
// with the volume tokens removed (`local:a:katsushika-hokusai:manga`) — what
// mint-local-work-ids.mjs would have produced for the set's title — so the
// /work URL is not named after one arbitrary volume. Falls back to the
// pickWinner() choice when the winner is an authority id (QID, kr:…), when the
// stripped slug is empty or generic, or when the id is already taken.
const VOL_WORDS = new Set(['vol', 'vols', 'volume', 'volumes', 'v', 'pt', 'part', 'pars', 'band', 'bd', 'tome', 'tomus', 'tomo', 'teil', 'theil', 'livre', 'libro', 'liber', 'buch', 'deel']);
function toRoman(n) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
}
const CONTAINER_WORDS = new Set(['works', 'work', 'opera', 'omnia', 'opuscula', 'dialogues', 'collected', 'writings',
  'miscellanea', 'collection', 'anthology', 'compendium', 'corpus', 'complete', 'st']);
const TITLE_STOP = new Set(['the', 'an', 'of', 'and', 'or', 'with', 'to', 'in', 'for', 'on', 'de', 'von', 'di', 'le', 'la', 'les',
  'des', 'du', 'der', 'die', 'das', 'el', 'los', 'las', 'et', 'ou', 'und']);
function titleTokens(title, author) {
  let t = String(title || '');
  for (const rx of MARKER_RXS) t = t.replace(rx, ' ');
  const at = author ? authorTokens(author) : new Set();
  const toks = deacc(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !TITLE_STOP.has(w) && !VOL_WORDS.has(w) && !at.has(w));
  return [...new Set(toks)].sort().slice(0, 12);
}
function setLevelId(members, fallback, carriers, minted) {
  const keep = { id: fallback, derived: false, fallback };
  if (!fallback.startsWith('local:')) return keep;
  const prefix = fallback.split(':').slice(0, 3).join(':');
  // tokens common to every same-prefix member's slug (drops each volume's own
  // number, ordinal or series number), minus volume words and the numbers of
  // the volume the shortest slug came from
  const mints = members.filter((m) => m.work_id?.startsWith(prefix + ':'));
  const tokSets = mints.map((m) => new Set(m.work_id.slice(prefix.length + 1).split('-').filter(Boolean)));
  const base = mints.reduce((a, m) => (!a || m.work_id.length < a.work_id.length ? m : a), null);
  if (!base) return keep;
  const drop = new Set([String(base._vol), String(base._vol).padStart(2, '0'), toRoman(base._vol)]);
  if (/^local:n:$/.test(prefix + ':') || prefix.endsWith(':')) return { ...keep, emptySlot: true };
  let toks = base.work_id.slice(prefix.length + 1).split('-')
    .filter((t) => t && tokSets.every((ts) => ts.has(t)) && !drop.has(t) && !VOL_WORDS.has(t));
  // per-volume CJK mints kept only the number ("local:a:liezi:1-vol"): build the
  // slug from the title's romanised words instead, the way the minter does
  // (distinctive tokens, author words out, alphabetical)
  if (!toks.some((t) => /[a-z]{3,}/.test(t))) toks = titleTokens(base._title, base.author);
  if (!toks.some((t) => /[a-z]{3,}/.test(t))) return keep;
  // a collected-works title names a container, not one work: keep it unique to
  // this set, as mint-local-work-ids.mjs does ("-ed-<book id>")
  const tail = toks.every((t) => CONTAINER_WORDS.has(t)) ? `${slug(toks)}-ed-${base.id}` : slug(toks);
  const best = `${prefix}:${tail}`;
  if (carriers.has(best) || minted.has(best)) return keep;
  minted.add(best);
  return { id: best, derived: true, fallback };
}

function slim(x) {
  return { id: x.id, title: x._title, author: x.author || null, author_id: x.author_id || null, language: x.language || null,
    year: x._year, provider: x._prov, vol: x._vol, work_id: x.work_id || null, work_id_source: x.work_id_source || null };
}

main().catch((e) => { console.error(e); process.exit(1); });
