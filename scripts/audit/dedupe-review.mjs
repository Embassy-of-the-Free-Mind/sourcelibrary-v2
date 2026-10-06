#!/usr/bin/env node
/**
 * Dedupe process review (#6019 part 3) — the numbers behind
 * scripts/eval/experiments/2026-10-06-dedupe-review-6019.md.
 *
 * PRIOR ART: scripts/maintenance/duplicate-integrity-check.mjs (#3102 step 5)
 * validates the `duplicate_of` graph but resolves targets by `id` only, has a
 * repair mode, and does not look at stranded OCR/translation;
 * scripts/audit/duplicate-fingerprint-groups.mjs lists same-fingerprint groups
 * but proposes no keeper and no per-page delta; tests/unit/dedup-normalizer-forks.test.ts
 * pins the normalizer census but does not measure how often the forks DISAGREE
 * on real titles. This script reuses their definitions (and imports the
 * normalizers themselves — it defines none) and adds only the measurements the
 * review asks for. It is a one-question audit, not a standing detector.
 *
 * THIS SCRIPT READS AND REPORTS. IT NEVER WRITES TO THE DATABASE.
 * No merge, no hide, no `duplicate_of`, no delete. Output goes to local files.
 *
 * Usage (tsx, because measurement 1 and 4 import the TypeScript libs):
 *   npx tsx --env-file=.env.production.local scripts/audit/dedupe-review.mjs snapshot
 *   npx tsx --env-file=.env.production.local scripts/audit/dedupe-review.mjs m1   # needs src/lib/holdings-check.ts (#6028)
 *   npx tsx … scripts/audit/dedupe-review.mjs m2 | m3 | m4 | m6
 *   --out <dir>    working directory for the snapshot and results (default /tmp/dedupe-review-6019)
 *   --seed <n>     sample seed (default 6019)
 *
 * `snapshot` makes ONE projected pass over `books` and caches it; every other
 * step reads the cache, so nothing here runs a regex or an unindexed filter
 * against the live collection. m3 additionally reads `pages` by `book_id`
 * (indexed) for the copies that carry work.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('--')) || 'help';
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = flag('out', '/tmp/dedupe-review-6019');
const SEED = parseInt(flag('seed', '6019'), 10);
fs.mkdirSync(OUT, { recursive: true });
const SNAP = path.join(OUT, 'books-snapshot.jsonl');

// ---------------------------------------------------------------- helpers

/** Wilson 95% interval for k of n. */
export function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}
const pct = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return `${k}/${n} = ${((100 * k) / (n || 1)).toFixed(1)}% [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]`;
};

/** mulberry32 — a seeded PRNG so the sample can be redrawn. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, seed) {
  const r = rng(seed), a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const idOf = (b) => String(b.id || b._id);
const isLive = (b) => b.visible === true && (b.pages_count || 0) > 0;
const write = (name, obj) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 1));
  return p;
};

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    return await fn(client.db(process.env.MONGODB_DB || 'bookstore'));
  } finally {
    await client.close();
  }
}

async function loadSnapshot() {
  if (!fs.existsSync(SNAP)) throw new Error(`no snapshot at ${SNAP} — run the "snapshot" step first`);
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(SNAP) });
  for await (const line of rl) if (line) rows.push(JSON.parse(line));
  return rows;
}

/** Index every book under BOTH its `id` and its `_id` (16K books have a re-minted `_id`). */
function indexBooks(books) {
  const byId = new Map(), byOid = new Map();
  for (const b of books) {
    if (b.id) byId.set(String(b.id), b);
    byOid.set(String(b._id), b);
  }
  return { byId, byOid, resolve: (ref) => byId.get(String(ref)) || byOid.get(String(ref)) || null };
}

// ---------------------------------------------------------------- snapshot

async function snapshot() {
  await withDb(async (db) => {
    const proj = {
      _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1,
      visible: 1, hidden: 1, hidden_reason: 1, duplicate_of: 1, work_id: 1, edition_key: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, source_fingerprints: 1, created_at: 1,
      'image_source.provider': 1, 'image_source.source_url': 1,
    };
    const out = fs.createWriteStream(SNAP + '.tmp');
    let n = 0;
    for await (const b of db.collection('books').find({}, { projection: proj })) {
      b._id = String(b._id);
      out.write(JSON.stringify(b) + '\n');
      n++;
    }
    await new Promise((r) => out.end(r));
    fs.renameSync(SNAP + '.tmp', SNAP);
    console.log(`snapshot: ${n} books -> ${SNAP}`);
  });
}

// ---------------------------------------------------------------- m1

async function m1() {
  const books = await loadSnapshot();
  const live = books.filter(isLive).map(idOf).sort();
  const N = parseInt(flag('n', '80'), 10);
  const sampleIds = shuffled(live, SEED).slice(0, N);
  const { resolve } = indexBooks(books);
  let checkHoldings;
  try {
    ({ checkHoldings } = await import('../../src/lib/holdings-check.ts'));
  } catch (e) {
    throw new Error(`src/lib/holdings-check.ts is not on this checkout (PR #6028): ${e.message}`);
  }
  const rows = [];
  await withDb(async (db) => {
    for (const id of sampleIds) {
      const b = resolve(id);
      const input = { title: b.title || b.display_title || '', author: b.author || '', year: typeof b.year === 'number' ? b.year : null, published: b.published || null };
      let res, error = null;
      try {
        res = await checkHoldings(db, input);
      } catch (e) {
        error = String(e.message || e);
      }
      const self = new Set([String(b.id), String(b._id)]);
      const foundSelf = !!res?.candidates.some((c) => self.has(c.book_id));
      const others = (res?.candidates || []).filter((c) => !self.has(c.book_id));
      rows.push({
        id, title: b.title, author: b.author, year: b.year, pages_count: b.pages_count, provider: b.image_source?.provider || null,
        error, found_self: foundSelf, limits: res?.limits || [],
        top: others[0] || null, n_candidates: others.length,
        candidates: others.slice(0, 8).map(({ book_id, reason, title, author, year, visible, duplicate_of, pages_count, pages_translated, provider }) =>
          ({ book_id, reason, title, author, year, visible, duplicate_of, pages_count, pages_translated, provider })),
      });
    }
  });
  const byReason = {};
  for (const r of rows) byReason[r.top?.reason || 'none'] = (byReason[r.top?.reason || 'none'] || 0) + 1;
  write('m1-sample.json', { seed: SEED, live_population: live.length, n: rows.length, by_top_reason: byReason, rows });
  console.log(`m1: live population ${live.length}, sampled ${rows.length} (seed ${SEED})`);
  console.log('top non-self candidate, by reason:', byReason);
  console.log('self found by its own title/author/year:', pct(rows.filter((r) => r.found_self).length, rows.length));
  console.log('errors:', rows.filter((r) => r.error).length);
}

// ---------------------------------------------------------------- m2

async function m2() {
  const books = await loadSnapshot();
  const { resolve, byId } = indexBooks(books);
  const all = books.filter((b) => b.duplicate_of != null && b.duplicate_of !== '');

  /** The `duplicate_of` graph over one subset of the marked books. */
  const graph = (dups) => {
    const s = {
      with_duplicate_of: dups.length, visible: 0, hidden: 0, neither_flag: 0,
      self_reference: 0, target_missing: 0, target_found_by_id: 0, target_found_by_oid_only: 0,
      target_visible: 0, target_live: 0, target_not_visible: 0, target_hidden_chain: 0, target_hidden_other: 0,
      chain_ends_visible: 0, chain_cycle: 0,
      stranded_any: 0, stranded_target_visible: 0, stranded_ocr: 0, stranded_translation: 0,
      stranded_ocr_pages: 0, stranded_translation_pages: 0,
      by_hidden_reason: {}, target_hidden_reasons: {},
    };
    const stranded = [], missing = [], hiddenKeepers = [], visibleMarked = [], chains = [];
    for (const d of dups) {
      if (d.visible === true) { s.visible++; visibleMarked.push({ id: idOf(d), duplicate_of: d.duplicate_of, title: String(d.title || '').slice(0, 100) }); }
      else if (d.hidden === true) s.hidden++;
      else s.neither_flag++;
      const hr = reasonBucket(d.hidden_reason);
      s.by_hidden_reason[hr] = (s.by_hidden_reason[hr] || 0) + 1;
      const t = resolve(d.duplicate_of);
      if (!t) { s.target_missing++; missing.push({ id: idOf(d), duplicate_of: d.duplicate_of, title: d.title }); continue; }
      if (t === d) { s.self_reference++; continue; }
      if (byId.get(String(d.duplicate_of)) === t) s.target_found_by_id++;
      else s.target_found_by_oid_only++;
      if (t.visible === true) s.target_visible++;
      else s.target_not_visible++;
      if (isLive(t)) s.target_live++;
      if (t.visible !== true) {
        if (t.duplicate_of) {
          s.target_hidden_chain++;
          // Follow the chain to its end.
          const seen = new Set([d, t]);
          let cur = t, cycle = false;
          while (cur && cur.duplicate_of) {
            const nx = resolve(cur.duplicate_of);
            if (!nx || seen.has(nx)) { cycle = !!nx; cur = null; break; }
            seen.add(nx);
            cur = nx;
          }
          if (cycle) s.chain_cycle++;
          if (cur && cur.visible === true) s.chain_ends_visible++;
          chains.push({ id: idOf(d), target: idOf(t), target_points_at: t.duplicate_of, cycle, ends_visible: !!(cur && cur.visible === true), title: String(d.title || '').slice(0, 100) });
        } else {
          s.target_hidden_other++;
          const thr = reasonBucket(t.hidden_reason);
          s.target_hidden_reasons[thr] = (s.target_hidden_reasons[thr] || 0) + 1;
          hiddenKeepers.push({ id: idOf(d), target: idOf(t), target_hidden_reason: t.hidden_reason || null, target_pages: t.pages_count || 0, title: String(d.title || '').slice(0, 100) });
        }
      }
      const dOcr = (d.pages_ocr || 0) - (t.pages_ocr || 0), dTr = (d.pages_translated || 0) - (t.pages_translated || 0);
      if (dOcr > 0 || dTr > 0) {
        s.stranded_any++;
        if (t.visible === true) s.stranded_target_visible++;
        if (dOcr > 0) { s.stranded_ocr++; s.stranded_ocr_pages += dOcr; }
        if (dTr > 0) { s.stranded_translation++; s.stranded_translation_pages += dTr; }
        stranded.push({
          copy: idOf(d), target: idOf(t), title: String(d.title || '').slice(0, 120), target_visible: t.visible === true,
          copy_pages: d.pages_count || 0, target_pages: t.pages_count || 0,
          copy_ocr: d.pages_ocr || 0, target_ocr: t.pages_ocr || 0,
          copy_translated: d.pages_translated || 0, target_translated: t.pages_translated || 0,
          ocr_ahead: Math.max(0, dOcr), translated_ahead: Math.max(0, dTr),
        });
      }
    }
    stranded.sort((a, b) => b.translated_ahead - a.translated_ahead || b.ocr_ahead - a.ocr_ahead);
    s.stranded_translated_ahead_20plus = stranded.filter((x) => x.translated_ahead >= 20).length;
    s.stranded_same_page_count = stranded.filter((x) => x.copy_pages === x.target_pages).length;
    s.stranded_target_has_no_translation = stranded.filter((x) => x.translated_ahead > 0 && x.target_translated === 0).length;
    return { summary: s, stranded, target_missing: missing, hidden_keepers: hiddenKeepers, visible_but_marked: visibleMarked, chains };
  };

  // A `books` row with pages_count 0 is an artwork record (15.7K of them), not a readable book.
  const withPages = graph(all.filter((b) => (b.pages_count || 0) > 0));
  const artwork = graph(all.filter((b) => !((b.pages_count || 0) > 0)));
  const total = graph(all);

  // Hidden copies with NO pointer, beside a live book. Three routes, strongest
  // first: the same source fingerprint; the same complete edition key (with a
  // year); the same work_id + year + page count within 5% (a candidate only).
  const liveByKey = new Map(), liveByFp = new Map(), liveByWorkYear = new Map();
  for (const b of books) {
    if (!isLive(b)) continue;
    if (b.edition_key) liveByKey.set(b.edition_key, b);
    for (const fp of b.source_fingerprints || []) liveByFp.set(fp, b);
    if (b.work_id && typeof b.year === 'number') {
      const k = `${b.work_id}|${b.year}`;
      if (!liveByWorkYear.has(k)) liveByWorkYear.set(k, []);
      liveByWorkYear.get(k).push(b);
    }
  }
  const hasYear = (k) => { const seg = String(k).split('|'); return seg.length >= 4 && seg[seg.length - 2] !== ''; };
  const unlinked = [];
  for (const b of books) {
    if (b.visible === true || b.duplicate_of || (b.pages_count || 0) === 0) continue;
    const viaFp = (b.source_fingerprints || []).map((fp) => liveByFp.get(fp)).find(Boolean);
    const viaKey = b.edition_key && hasYear(b.edition_key) ? liveByKey.get(b.edition_key) : null;
    const viaWork = b.work_id && typeof b.year === 'number'
      ? (liveByWorkYear.get(`${b.work_id}|${b.year}`) || []).find((t) => Math.abs((t.pages_count || 0) - b.pages_count) <= 0.05 * b.pages_count)
      : null;
    const t = viaFp || viaKey || viaWork;
    if (!t) continue;
    unlinked.push({
      copy: idOf(b), live: idOf(t), via: viaFp ? 'source_fingerprint' : viaKey ? 'edition_key' : 'work_id+year+pages', hidden_reason: b.hidden_reason || null,
      title: String(b.title || '').slice(0, 100), copy_pages: b.pages_count || 0, live_pages: t.pages_count || 0,
      copy_ocr: b.pages_ocr || 0, live_ocr: t.pages_ocr || 0, copy_translated: b.pages_translated || 0, live_translated: t.pages_translated || 0,
    });
  }
  const u = { total: unlinked.length, by_route: {}, ahead_of_live_by_route: {}, by_hidden_reason: {} };
  for (const x of unlinked) {
    u.by_route[x.via] = (u.by_route[x.via] || 0) + 1;
    if (x.copy_ocr > x.live_ocr || x.copy_translated > x.live_translated) u.ahead_of_live_by_route[x.via] = (u.ahead_of_live_by_route[x.via] || 0) + 1;
    const k = reasonBucket(x.hidden_reason);
    u.by_hidden_reason[k] = (u.by_hidden_reason[k] || 0) + 1;
  }
  const kircher = unlinked.find((x) => x.copy === '69b69e6c080b19f98fd0d6c3');
  u.kircher_known_positive = kircher ? { found: true, via: kircher.via, live: kircher.live } : { found: false };

  write('m2-duplicate-of.json', { books_total: books.length, all: total.summary, with_pages: withPages, artwork_records: { summary: artwork.summary, visible_but_marked: artwork.visible_but_marked, chains: artwork.chains } });
  write('m2-unlinked-hidden-copies.json', { summary: u, rows: unlinked });
  console.log('ALL', JSON.stringify(total.summary));
  console.log('WITH PAGES', JSON.stringify(withPages.summary, null, 1));
  console.log('ARTWORK (0 pages)', JSON.stringify(artwork.summary));
  console.log('UNLINKED', JSON.stringify(u, null, 1));
}

// ---------------------------------------------------------------- m3

/** Free-text hidden reasons, bucketed: "duplicate of <slug>" is one bucket, a date reason another. */
function reasonBucket(r) {
  const t = String(r || '(none)');
  if (/^duplicate of /i.test(t)) return 'duplicate of <slug> (prose)';
  if (/outside collection period/i.test(t)) return 'date outside collection period';
  return t.slice(0, 48);
}

const work = (b) => (b.pages_translated || 0) * 1e6 + (b.pages_ocr || 0);

async function m3() {
  const books = await loadSnapshot();
  const groups = new Map();
  for (const b of books) {
    for (const fp of b.source_fingerprints || []) {
      if (!fp.startsWith('e-rara:')) continue;
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp).push(b);
    }
  }
  const multi = [...groups.entries()].filter(([, g]) => g.length > 1);
  const s = {
    erara_fingerprints: groups.size, groups_with_copies: multi.length, books_in_groups: 0, extra_copies: 0,
    books_with_own_work: 0, groups_two_visible: 0, groups_none_visible: 0, groups_keeper_lacks_something: 0,
    groups_already_linked: 0, groups_page_count_differs: 0, pages_ocr_to_move: 0, pages_translated_to_move: 0,
  };
  const plan = [];
  for (const [fp, g] of multi) {
    s.books_in_groups += g.length;
    s.extra_copies += g.length - 1;
    s.books_with_own_work += g.filter((b) => (b.pages_ocr || 0) > 0 || (b.pages_translated || 0) > 0).length;
    const nVis = g.filter((b) => b.visible === true).length;
    if (nVis > 1) s.groups_two_visible++;
    if (nVis === 0) s.groups_none_visible++;
    // Keeper: visible first, then most work (translated, then OCR), then most pages, then oldest.
    const ranked = [...g].sort((a, b) => Number(b.visible === true) - Number(a.visible === true) || work(b) - work(a)
      || (b.pages_count || 0) - (a.pages_count || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const keeper = ranked[0];
    const state = (b) => ({
      id: idOf(b), _id: b._id, visible: b.visible === true, hidden_reason: b.hidden_reason || null, duplicate_of: b.duplicate_of || null,
      pages_count: b.pages_count || 0, pages_ocr: b.pages_ocr || 0, pages_translated: b.pages_translated || 0,
      source_url: b.image_source?.source_url || null, created_at: b.created_at || null,
    });
    const others = ranked.slice(1).map((b) => ({
      ...state(b),
      has_that_keeper_lacks: {
        ocr_pages: Math.max(0, (b.pages_ocr || 0) - (keeper.pages_ocr || 0)),
        translated_pages: Math.max(0, (b.pages_translated || 0) - (keeper.pages_translated || 0)),
      },
      points_at_keeper: b.duplicate_of != null && [String(keeper.id), String(keeper._id)].includes(String(b.duplicate_of)),
    }));
    const lacks = others.some((o) => o.has_that_keeper_lacks.ocr_pages > 0 || o.has_that_keeper_lacks.translated_pages > 0);
    if (lacks) s.groups_keeper_lacks_something++;
    if (others.every((o) => o.points_at_keeper)) s.groups_already_linked++;
    if (others.some((o) => o.pages_count !== (keeper.pages_count || 0))) s.groups_page_count_differs++;
    plan.push({
      fingerprint: fp, title: String(keeper.title || '').slice(0, 140), author: keeper.author || null,
      keeper: state(keeper), others,
      action: lacks ? 'MOVE_TEXT_THEN_LINK' : others.every((o) => o.points_at_keeper) ? 'ALREADY_LINKED' : nVis > 1 ? 'HIDE_AND_LINK' : 'LINK_ONLY',
      page_count_differs: others.some((o) => o.pages_count !== (keeper.pages_count || 0)),
    });
  }

  // Page-level delta for the groups where a non-keeper holds more: which
  // pages have text on the copy and none on the keeper. `pages.book_id` is indexed.
  const need = plan.filter((p) => p.action === 'MOVE_TEXT_THEN_LINK');
  await withDb(async (db) => {
    const pageState = async (bookId) => {
      const rows = await db.collection('pages').aggregate([
        { $match: { book_id: bookId } },
        { $project: { _id: 0, page_number: 1,
          ocr: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] },
          tr: { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] } } },
      ], { maxTimeMS: 60000 }).toArray();
      return new Map(rows.map((r) => [r.page_number, r]));
    };
    for (const p of need) {
      const k = await pageState(p.keeper.id);
      for (const o of p.others) {
        if (!(o.has_that_keeper_lacks.ocr_pages > 0 || o.has_that_keeper_lacks.translated_pages > 0)) continue;
        const c = await pageState(o.id);
        const ocrOnly = [], trOnly = [];
        for (const [n, r] of c) {
          const kr = k.get(n);
          if (r.ocr && !(kr && kr.ocr)) ocrOnly.push(n);
          if (r.tr && !(kr && kr.tr)) trOnly.push(n);
        }
        o.page_level = {
          copy_page_docs: c.size, keeper_page_docs: k.size,
          ocr_pages_keeper_lacks: ocrOnly.length, translated_pages_keeper_lacks: trOnly.length,
          page_numbers_align: c.size === k.size,
        };
        s.pages_ocr_to_move += ocrOnly.length;
        s.pages_translated_to_move += trOnly.length;
      }
    }
  });
  s.by_action = {};
  for (const p of plan) s.by_action[p.action] = (s.by_action[p.action] || 0) + 1;
  plan.sort((a, b) => a.action.localeCompare(b.action) || a.fingerprint.localeCompare(b.fingerprint));
  write('m3-erara-merge-plan.json', {
    note: 'PLAN ONLY — nothing here has been executed. Keeper = visible first, then most translated, most OCR, most pages, oldest. Any merge or hide is Derek\'s call (#6019).',
    generated: new Date().toISOString(), summary: s, plan,
  });
  console.log(JSON.stringify(s, null, 1));
}

// ---------------------------------------------------------------- m4

async function m4() {
  const books = await loadSnapshot();
  const dedupTs = await import('../../src/lib/dedup.ts');
  const ekTs = await import('../../src/lib/edition-key.ts');
  const dedupMjs = await import('../lib/dedup-normalize.mjs');
  const idf = await import('../lib/identity-fields.mjs');
  const wim = await import('../lib/work-identity-match.mjs');
  const awr = await import('../lib/artwork-work-resolver.mjs');
  const wiu = await import('../lib/work-identity-util.mjs');
  const ank = await import('../lib/author-name-key.mjs');
  let hc = null;
  try { hc = await import('../../src/lib/holdings-check.ts'); } catch { /* #6028 not merged */ }

  const TITLE = {
    'dedup.normalizeTitle (src/lib/dedup.ts)': dedupTs.normalizeTitle,
    'normalizeEditionTitle (src/lib/edition-key.ts)': ekTs.normalizeEditionTitle,
    'normaliseTitle (scripts/lib/work-identity-match.mjs)': wim.normaliseTitle,
    'normalizeTitle (scripts/lib/artwork-work-resolver.mjs)': awr.normalizeTitle,
    'norm (scripts/lib/work-identity-util.mjs)': wiu.norm,
  };
  if (hc) TITLE['rankingTokens (src/lib/holdings-check.ts, #6028)'] = (t) => [...hc.rankingTokens(t)].sort().join(' ');
  const TWINS = {
    'dedup.normalizeTitle ts vs scripts/lib/dedup-normalize.mjs': [dedupTs.normalizeTitle, dedupMjs.normalizeTitle],
    'normalizeEditionTitle ts vs scripts/lib/identity-fields.mjs': [ekTs.normalizeEditionTitle, idf.normalizeEditionTitle],
    'dedup.normalizeAuthor ts vs scripts/lib/dedup-normalize.mjs': [dedupTs.normalizeAuthor, dedupMjs.normalizeAuthor],
    'editionSurname ts vs scripts/lib/identity-fields.mjs': [ekTs.editionSurname, idf.editionSurname],
  };
  const AUTHOR = {
    'dedup.normalizeAuthor (src/lib/dedup.ts)': dedupTs.normalizeAuthor,
    'editionSurname (src/lib/edition-key.ts)': ekTs.editionSurname,
    'authorKey (scripts/lib/artwork-work-resolver.mjs)': awr.authorKey,
    'canonicalKey (scripts/lib/author-name-key.mjs)': ank.canonicalKey,
    'surname (scripts/lib/work-identity-util.mjs)': wiu.surname,
  };

  const live = books.filter(isLive).sort((a, b) => idOf(a).localeCompare(idOf(b)));
  const N = parseInt(flag('n', '2000'), 10);
  const sample = shuffled(live.map((_, i) => i), SEED + 4).slice(0, N);

  const run = (fns, field) => {
    const names = Object.keys(fns);
    // For each normalizer: key per live book, and key -> set of book indices.
    const keys = {}, groups = {};
    for (const n of names) {
      keys[n] = live.map((b) => { try { return fns[n](String(b[field] || '')) || ''; } catch { return ''; } });
      const g = new Map();
      keys[n].forEach((k, i) => { if (!k) return; if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
      groups[n] = g;
    }
    // "Same <field>" set of sampled book i under normalizer n: the other live
    // books with the same non-empty key. An empty key matches nothing.
    const sameSet = (n, i) => { const k = keys[n][i]; return k ? groups[n].get(k).filter((j) => j !== i) : []; };
    const per = {};
    for (const n of names) {
      const empty = sample.filter((i) => !keys[n][i]).length;
      const withTwin = sample.filter((i) => sameSet(n, i).length > 0).length;
      per[n] = { empty_key: empty, has_same_in_live_corpus: withTwin, distinct_keys_in_live: groups[n].size };
    }
    const pairs = [], examples = {};
    for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
      let disagree = 0, aOnly = 0, bOnly = 0;
      const ex = [];
      for (const i of sample) {
        const sa = new Set(sameSet(names[a], i)), sb = new Set(sameSet(names[b], i));
        const onlyA = [...sa].filter((j) => !sb.has(j)), onlyB = [...sb].filter((j) => !sa.has(j));
        if (onlyA.length || onlyB.length) {
          disagree++;
          if (onlyA.length) aOnly++;
          if (onlyB.length) bOnly++;
          if (ex.length < 12) {
            const j = (onlyA[0] ?? onlyB[0]);
            ex.push({ only: onlyA.length ? 'first' : 'second', a: String(live[i][field]).slice(0, 110), b: String(live[j][field]).slice(0, 110), a_id: idOf(live[i]), b_id: idOf(live[j]) });
          }
        }
      }
      pairs.push({ a: names[a], b: names[b], disagree, rate: pct(disagree, sample.length), only_first_says_same: aOnly, only_second_says_same: bOnly });
      examples[`${names[a]} | ${names[b]}`] = ex;
    }
    return { per_normalizer: per, pairs, examples };
  };

  const twins = {};
  for (const [name, [f, g]] of Object.entries(TWINS)) {
    const field = /Author|Surname/.test(name) ? 'author' : 'title';
    let diff = 0;
    for (const b of live) if (f(String(b[field] || '')) !== g(String(b[field] || ''))) diff++;
    twins[name] = { compared: live.length, differ: diff };
  }
  const title = run(TITLE, 'title');
  const author = run(AUTHOR, 'author');
  write('m4-normalizers.json', { seed: SEED + 4, live: live.length, sample: sample.length, twins, title, author });
  console.log('live', live.length, 'sample', sample.length);
  console.log('twins:', JSON.stringify(twins, null, 1));
  console.log('TITLE per normalizer:', JSON.stringify(title.per_normalizer, null, 1));
  for (const p of title.pairs) console.log(`  ${p.rate}  first-only ${p.only_first_says_same} second-only ${p.only_second_says_same}  ${p.a} | ${p.b}`);
  console.log('AUTHOR per normalizer:', JSON.stringify(author.per_normalizer, null, 1));
  for (const p of author.pairs) console.log(`  ${p.rate}  first-only ${p.only_first_says_same} second-only ${p.only_second_says_same}  ${p.a} | ${p.b}`);
}

// ---------------------------------------------------------------- m6

async function m6() {
  const books = await loadSnapshot();
  const byKey = new Map();
  for (const b of books) {
    if (!b.edition_key) continue;
    if (!byKey.has(b.edition_key)) byKey.set(b.edition_key, []);
    byKey.get(b.edition_key).push(b);
  }
  const multi = [...byKey.entries()].filter(([, g]) => g.length > 1);
  const visGroups = multi.filter(([, g]) => g.filter((b) => b.visible === true).length > 1);
  const liveGroups = multi.filter(([, g]) => g.filter(isLive).length > 1);
  const hasYear = (k) => { const seg = String(k).split('|'); return seg.length >= 4 && seg[seg.length - 2] !== ''; };
  const s = {
    books_with_edition_key: [...byKey.values()].reduce((n, g) => n + g.length, 0),
    groups_more_than_one_copy: multi.length, books_in_those_groups: multi.reduce((n, [, g]) => n + g.length, 0),
    groups_more_than_one_VISIBLE: visGroups.length, visible_books_in_them: visGroups.reduce((n, [, g]) => n + g.filter((b) => b.visible === true).length, 0),
    groups_more_than_one_LIVE: liveGroups.length, live_books_in_them: liveGroups.reduce((n, [, g]) => n + g.filter(isLive).length, 0),
    visible_groups_with_year: visGroups.filter(([k]) => hasYear(k)).length,
    visible_groups_zero_pages_only: visGroups.length - liveGroups.length,
    visible_groups_created_after_2026_10_01: visGroups.filter(([, g]) => g.some((b) => b.visible === true && String(b.created_at || '') >= '2026-10-01T12:24')).length,
  };
  write('m6-visible-edition-groups.json', {
    summary: s,
    groups: visGroups.map(([k, g]) => ({ edition_key: k.slice(0, 200), visible: g.filter((b) => b.visible === true).map((b) => ({
      id: idOf(b), pages_count: b.pages_count || 0, pages_translated: b.pages_translated || 0, provider: b.image_source?.provider || null,
      created_at: b.created_at || null, title: String(b.title || '').slice(0, 100) })) })),
  });
  console.log(JSON.stringify(s, null, 1));
}

// ---------------------------------------------------------------- main

const STEPS = { snapshot, m1, m2, m3, m4, m6 };
if (!STEPS[cmd]) {
  console.log('usage: dedupe-review.mjs <snapshot|m1|m2|m3|m4|m6> [--out dir] [--seed n]');
  process.exit(cmd === 'help' ? 0 : 1);
}
STEPS[cmd]().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(3); });
