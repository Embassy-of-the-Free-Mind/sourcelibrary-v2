#!/usr/bin/env node
/**
 * Phase 11 — one WORK graph over USTC editions, Source Library books AND
 * external English translations, for one language (--lang, default Latin).
 * Issue #7751. Replaces the cluster unit for the gap arithmetic.
 *
 * Why: `ustc_editions.work_cluster_id` is NOT USTC's grouping — build.mjs mints
 * it as `surname::first-6-title-words`, so every variant title page is a new
 * "work" (Imitatio Christi: 255 editions in 69 clusters; Aeneid 322 in 144).
 * books.work_id is no better for Latin (145K of 160K ids are singletons). The
 * most-printed works — the translated ones — fragment most, so cluster counts
 * mis-state both sides of the gap.
 *
 * PRIOR ART: scripts/catalog-coverage/build.mjs `workClusterId` (prefix key —
 * the thing being replaced); scripts/maintenance/merge-work-clusters.mjs (merges
 * books.work_id via canon seeds + identical titles, writes Mongo — too strict for
 * title-page variance, and USTC-blind); 10-sl-coverage.mjs (best-cluster links,
 * inherits the fragmentation). This phase is read-only and free.
 *
 * Method. Nodes = USTC 1400-1700 editions in LANG (u) + SL books in LANG with
 * pages (s) + external translated works whose original is LANG (x, see below).
 *   - direct: an SL book with books.ustc_id = sn (or named by
 *     ustc_editions.source_library_id) takes that edition's work.
 *   - anonymous nodes join only on an identical first-6-token key.
 *   - everything else: LEADER clustering within an author (surname-stem anchor).
 *     Titles are compared on their first K distinctive tokens (u/v, i/j folded,
 *     author-name tokens stripped). Visited lightest first, each title joins the
 *     best leader it matches directly — IDF-weighted containment
 *         shared_weight / min(weight_leader, weight_title) ≥ CONTAIN
 *     plus the specificity gate (≥1 STRONG or ≥2 MID shared tokens) — or
 *     becomes a leader. Single-linkage union-find was tried first and chained
 *     whole oeuvres through omnibus title pages (all of Cicero became one work);
 *     a two-pass density merge and a hub guard did not stop it. Leader membership
 *     cannot chain. K=6, not 10: author epithets and dedicatees sit late in
 *     early-modern titles (Javelli "Canapicii"), and at K=10 they merged distinct
 *     works (7/40 sampled multi-edition works wrong; 2-3/40 at K=6). An
 *     author-frequency epithet rule (WG_EPITHETS=1) was tried and shattered
 *     single-work authors (Consolatio 9 → 88 works) — off by default.
 * Works = the resulting components. External prior = the work holds an x node,
 * or (Latin) a phase-3 prior cluster; SL status = best member book status. The
 * external channel never takes SL evidence.
 *
 * Reads:  Supabase ustc_editions (cached to scripts/output/ustc-<lang>-editions.jsonl),
 *         the external-works file (below), scripts/output/cluster-external-priors.jsonl
 *         (Latin), Mongo books (language or ISO code)
 * Writes: scripts/output/work-graph[-<lang>].jsonl, work-graph-report[-<lang>].json
 *
 * --lang <name> (#7769): build the graph over USTC editions whose language_1 is
 * that language (latin, german, french, italian, dutch, spanish, greek,
 * portuguese) and SL books in it. Non-Latin outputs carry the language in the
 * file name; Latin keeps the original names.
 *
 * External works as x NODES (#7769): every work in the external-works file
 * (default external-translation-works-staging.jsonl, from `01 --staging`;
 * override --external <file>) whose orig_lang is this language is matched AFTER
 * the leader pass, against every clustered node, by the same containment + specificity
 * rule. An x node never becomes a leader and never joins two works, so the
 * external side cannot change the clustering it is measured against. A work's
 * external prior is then (phase-3 cluster prior, Latin only) ∪ (an attached x
 * node), and the report counts, per source, x works landing on a USTC work and
 * USTC works carrying a prior — before (non-staged sources) vs after (all).
 *
 * Newspapers (#7751): the issues of one newspaper are ONE work, flagged
 * newspaper:true (rows carry ustc_ids, since issues have no sn); the report's
 * `newspapers` block gives works with each newspaper as one beside works
 * excluding newspapers. See NEWS_* below.
 *
 * Usage: node --env-file=.env.production.local scripts/translation-layer/11-work-graph.mjs [--refresh] [--lang german] [--external <file>]
 *        WG_NEWSPAPERS=0 … → the old one-work-per-issue count
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, distinctiveTokens, extractSurname, normTitle, supa } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const LANG = (argOf('--lang') || 'latin').toLowerCase();
const LANG_NAME = LANG[0].toUpperCase() + LANG.slice(1); // ustc_editions.language_1 and books.language
const SUFFIX = LANG === 'latin' ? '' : `-${LANG}`;
const EDITIONS = path.join(OUT, `ustc-${LANG}-editions.jsonl`);
const LANG_CODES = { latin: ['la'], german: ['de'], french: ['fr'], italian: ['it'], dutch: ['nl'], spanish: ['es'], greek: ['el', 'grc'], portuguese: ['pt'] };
const EPI_MIN = process.env.WG_EPITHETS === "1" ? 10 : Infinity, EPI_SHARE = 0.3, EPI_OWN = 0.5; // epithet = in ≥30% of a ≥10-node author's titles AND ≥50% of the token's corpus occurrences
const EXTERNAL = argOf('--external') || path.join(OUT, 'external-translation-works-staging.jsonl');
// sources written by `01 --staging` (#7769); everything else in the file is the pre-existing external side
const STAGED_SOURCES = new Set(['loc_marc_041', 'openlibrary_translated_from', 'wikidata_p629']);
const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const orth = (s) => (s || '').replace(/[vV]/g, 'u').replace(/[jJ]/g, 'i');

const K = Number(process.env.WG_K ?? 6);            // leading distinctive tokens compared (title pages run on; the head names the work)
const CONTAIN = Number(process.env.WG_CONTAIN ?? 0.6); // IDF-weighted containment needed to join a leader (shared / lighter title)
const STRONG_IDF = 6.0, MID_IDF = 5.0, FLOOR_IDF = 3.0;
const X_FULL_IDF = 4.0;  // x nodes only: summed idf a fully-contained external title needs (#7769)

// NEWSPAPERS (#7751). USTC catalogues every newspaper ISSUE as its own record
// (type Issue, no sn), and phase 11 made each one a work: 31% of German works,
// 28% of Dutch. A newspaper is one work. Issues are recognised by USTC's own
// classification_1 = 'Newspapers' — not by a missing sn, which also marks
// periodical numbers and single volumes ("Pars secunda", "Tome II"), and misses
// the Gaceta de Madrid issues that carry an sn. They are grouped by place +
// the title with issue numbers, dates and years stripped, kept out of the
// title passes, and flagged newspaper:true. WG_NEWSPAPERS=0 restores the old
// one-work-per-issue count (the "before" column).
const GROUP_NEWS = process.env.WG_NEWSPAPERS !== '0';
const isNews = (e) => e.classification_1 === 'Newspapers';
const NEWS_NOISE = new Set(('num numb numer numero nummer nr no nro n an anno ao a ad vol volume tom tome stuck stueck stück woche week semaine '
  + 'den der des dem vom von de du le la les el of the et und and y en het van vor pour par date day jour datum '
  + 'januar januarius januarii janvier january enero januari jenner jaenner februar februarius februarii fevrier février february febrero februari hornung '
  + 'martius martii mars mertz maerz märz march marzo maart april aprilis aprilii avril abril mai maius maii may mayo mei meye junius junii juin june junio juni '
  + 'julius julii juillet july julio juli augustus augusti aout août august agosto augusti september septembris septembre settembre septiembre '
  + 'october octobris octobre ottobre octubre oktober october octobr novembre november novembris noviembre novemb december decembris decembre décembre diciembre dezember decemb '
  + 'jan febr mart apr jun jul aug sept sep oct okt nov dec dez '
  + 'au aus auss auff auf iahr iahrs iahres dises dieses deß dess das littera prima secunda tertia quarta stuck stucke fol uon uom page places correspondence').split(' '));
// The head of the title names the paper; what follows is the issue (number,
// date, the datelines "Auß Wien/ Turin/ Ceuta"). So the key is place + the
// first NEWS_HEAD content tokens, each folded to a consonant skeleton so that
// Erzaehlung/Erzehlung and Zeitung/Zeitungen agree:
// "Num: 40. An: 1646. Post/ Hamburger und Reichs-Zeitung." and
// "Num: 4 An: 1644. Post, Hambürger …" → one key.
const NEWS_HEAD = 3;
const skel = (t) => t.replace(/(en|n|e|s)$/, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
function newsKey(e) {
  const toks = normTitle(e.title).split(' ') // bracket content stays: "[Gazette de Paris (Rouen), 07.05.1667]" is the supplied title
    .filter((t) => t.length >= 3 && !/\d/.test(t) && !/^[ivxlcdm]+$/.test(t) && !/^(.)\1+$/.test(t)) // numbers, roman numerals, signatures "Ttt"
    .filter((t) => !NEWS_NOISE.has(t) && !NEWS_NOISE.has(orth(t)) && !/^(extra)?ordin/.test(t)) // ordinari / extraordinari issues are the same paper
    .map((t) => orth(t));
  const head = toks.slice(0, NEWS_HEAD).map(skel).filter(Boolean);
  return head.length ? `${newsPlace(e)}|${head.sort().join(' ')}` : null;
}
const newsPlace = (e) => normTitle(orth(e.place || '')) || '?';
// The earliest papers title each issue by its news ("No 88. Extraordinaire du
// XXVII. Juillet … Contenant …", Verhoeven's Antwerp Tijdinghen, Butter's
// London corantos), and an issue titled only "No. 14." has no head at all, so
// an issue whose title key is held by fewer than NEWS_MIN issues joins its
// printer's series at that place instead. Never an unnamed printer: s.n.
// in London is 84 unrelated sheets.
const NEWS_MIN = 3;
const newsPrinter = (e) => { const p = normTitle(orth(e.printer_1 || '')); return p && !/^(s n|sn|sine nomine|n n|unknown)$/.test(p) ? p : null; };

async function pullEditions() {
  if (fs.existsSync(EDITIONS) && !process.argv.includes('--refresh')) {
    const cached = readJsonl(EDITIONS);
    if (cached.length && 'classification_1' in cached[0]) return cached;
    console.log('  cache predates the newspaper fields (#7751): refreshing');
  }
  const sb = supa();
  const out = [];
  let last = 0;
  while (true) {
    const { data, error } = await sb.from('ustc_editions')
      .select('id,sn,work_cluster_id,author_1,title,year,source_library_id,type,classification_1,place,printer_1')
      .eq('language_1', LANG_NAME).gte('year', 1400).lte('year', 1700)
      .gt('id', last).order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    out.push(...data);
    last = data[data.length - 1].id;
    if (out.length % 50000 < 1000) console.log(`  editions ${out.length}…`);
    if (data.length < 1000) break;
  }
  fs.writeFileSync(EDITIONS, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return out;
}

function bookStatus(b) {
  const translatable = Math.max(1, (b.pages_count || 0) - (b.pages_blank || 0));
  const t = b.pages_translated || 0;
  return t >= 0.9 * translatable ? 'readable' : t > 0 ? 'partial' : 'none';
}

async function main() {
  console.log(`Loading USTC ${LANG_NAME} editions…`);
  const eds = await pullEditions();
  console.log(`  ${eds.length} editions`);
  // phase-3 priors are matched against the LATIN cluster denominator only
  const priorFile = path.join(OUT, 'cluster-external-priors.jsonl');
  const priorClusters = new Set(LANG === 'latin' && fs.existsSync(priorFile) ? readJsonl(priorFile).map((r) => r.work_cluster_id) : []);
  if (LANG === 'latin' && !priorClusters.size) console.warn('⚠️  no cluster-external-priors.jsonl: phase-3 priors absent, x nodes only');
  const extWorks = fs.existsSync(EXTERNAL) ? readJsonl(EXTERNAL).filter((w) => (w.orig_lang || '').toLowerCase() === LANG) : [];
  console.log(`  ${extWorks.length} external works in ${LANG} from ${path.basename(EXTERNAL)}${fs.existsSync(EXTERNAL) ? '' : ' (file absent)'}`);

  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const langs = [LANG_NAME, ...(LANG_CODES[LANG] || [])];
  const books = await c.db('bookstore').collection('books').find(
    { $or: [{ language: { $in: langs } }, { languages: { $in: langs } }], pages_count: { $gt: 0 } },
    { projection: { id: 1, slug: 1, title: 1, author: 1, ustc_id: 1, visible: 1, pages_count: 1, pages_blank: 1, pages_translated: 1 } },
  ).toArray();
  await c.close();
  console.log(`  ${books.length} SL ${LANG_NAME} books`);

  // --- nodes ---
  const nodes = [];
  for (const e of eds) nodes.push({ k: 'u', ref: e, author: e.author_1 || '', title: e.title || '' });
  for (const b of books) nodes.push({ k: 's', ref: b, author: b.author || '', title: b.title || '' });
  // uniform titles carry editor/version parentheticals ("Tischreden (Aurifaber)") that only dilute containment
  for (const w of extWorks) nodes.push({ k: 'x', ref: w, author: w.author || w.surname || '', title: (w.title || '').replace(/\([^)]*\)/g, ' ') });

  // IDF over USTC edition titles only (the population whose works we count)
  const df = new Map();
  const U = eds.length;
  for (const n of nodes) {
    n.stems = surnameStems(orth(n.k === 'u' ? (extractSurname(n.author) || n.author) : n.author));
    const toks = [...new Set(distinctiveTokens(orth(n.title)))]
      .filter((t) => !n.stems.some((s) => s.length >= 3 && t.startsWith(s)));
    // an external title that is the author's own name ("Albrecht Dürer" — a
    // catalogue of his woodcuts) must not land through the given name
    if (n.k === 'x') { const own = new Set(normTitle(orth(n.author)).split(' ')); n.toks = toks.filter((t) => !own.has(t)); continue; }
    n.toks = toks;
    if (n.k === 'u') for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => Math.log((U + 1) / ((df.get(t) || 0) + 1));
  // EPITHETS: a token in most of a prolific author's titles that hardly occurs
  // elsewhere names the AUTHOR, not a work (Javelli's "Canapicii", "Abelii
  // Sammarthani Scaevolae filii") — it merged distinct works. Dropped from that
  // author's comparisons. Authors with < EPI_MIN nodes are untouched, so
  // single-work authors still merge.
  const bucket = new Map(); // stem → { n, cnt: Map(token → nodes) }
  for (const n of nodes) if (n.k !== 'x') for (const s of n.stems) {
    if (!bucket.has(s)) bucket.set(s, { n: 0, cnt: new Map() });
    const b = bucket.get(s); b.n++;
    for (const t of n.toks.slice(0, K)) b.cnt.set(t, (b.cnt.get(t) || 0) + 1);
  }
  let epithets = 0;
  const epi = new Map(); // stem → Set(token)
  for (const [s, b] of bucket) {
    if (b.n < EPI_MIN) continue;
    for (const [t, c] of b.cnt) if (c / b.n >= EPI_SHARE && c / Math.max(1, df.get(t) || 0) >= EPI_OWN) {
      if (!epi.has(s)) epi.set(s, new Set());
      epi.get(s).add(t); epithets++;
    }
  }
  for (const n of nodes) {
    const drop = (t) => n.stems.some((s) => epi.get(s)?.has(t));
    n.head = n.toks.slice(0, K).filter((t) => idf(t) >= FLOOR_IDF && !drop(t));
    n.w = n.head.reduce((s, t) => s + idf(t), 0);
    n.set = new Set(n.head);
  }
  console.log(`  epithet tokens suppressed: ${epithets}`);

  // --- union-find (direct links, anonymous keys, leader membership) ---
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a < b ? b : a] = a < b ? a : b; };

  // direct edges: an SL book with a USTC link takes that edition's work, and is
  // kept out of title clustering so it cannot pull a second work in.
  const bySn = new Map(), bySl = new Map();
  nodes.forEach((n, i) => { if (n.k === 'u') { if (n.ref.sn) bySn.set(String(n.ref.sn), i); if (n.ref.source_library_id) bySl.set(String(n.ref.source_library_id), i); } });
  let direct = 0;
  const linked = new Set();
  nodes.forEach((n, i) => {
    if (n.k !== 's') return;
    const j = [bySn.get(String(n.ref.ustc_id)), bySl.get(String(n.ref.id)), bySl.get(String(n.ref._id))].find((x) => x !== undefined);
    if (j !== undefined) { union(i, j); linked.add(i); direct++; }
  });

  // newspapers: every issue of one paper (place + stripped title) is one work
  let newsIssues = 0;
  if (GROUP_NEWS) {
    const keyOf = new Map(), held = new Map();
    nodes.forEach((n, i) => {
      if (n.k !== 'u' || !isNews(n.ref)) return;
      n.news = true; newsIssues++;
      const k = newsKey(n.ref);
      keyOf.set(i, k);
      if (k) held.set(k, (held.get(k) || 0) + 1);
    });
    const newsKeyIdx = new Map();
    for (const [i, k0] of keyOf) {
      const p = newsPrinter(nodes[i].ref);
      const key = (!k0 || held.get(k0) < NEWS_MIN) && p ? `${newsPlace(nodes[i].ref)}|#${p}` : k0;
      if (!key) continue; // no title head and no printer: an issue of its own
      if (newsKeyIdx.has(key)) union(i, newsKeyIdx.get(key)); else newsKeyIdx.set(key, i);
    }
  }

  // anonymous: identical first-6 key
  const anonKey = new Map();
  let anon = 0;
  nodes.forEach((n, i) => {
    if (n.stems.length || linked.has(i) || n.k === 'x' || n.news) return;
    const key = normTitle(orth(n.title)).split(' ').slice(0, 6).join(' ');
    if (key.split(' ').length < 3) return;
    anon++;
    if (anonKey.has(key)) union(i, anonKey.get(key)); else anonKey.set(key, i);
  });

  // LEADER clustering, within an author. Titles are visited lightest first (the
  // bare work name — "De officiis libri tres" — before the omnibus page that
  // contains it); each joins the best existing leader it matches DIRECTLY, or
  // becomes a leader. Membership needs similarity to the leader itself, so no
  // chain can form: single-linkage union-find fused all 4,772 Aquinas editions,
  // and all of Cicero, through omnibus title pages — do not revert to it. An
  // omnibus edition joins ONE of its works (the best-scoring), never bridges two.
  const order = nodes.map((n, i) => i).filter((i) => nodes[i].k !== 'x' && !nodes[i].news && nodes[i].w > 0 && nodes[i].stems.length && !linked.has(i));
  order.sort((a, b) => nodes[a].w - nodes[b].w || nodes[b].k.localeCompare(nodes[a].k));
  const leaderIdx = new Map(); // "stem|token" → leader node ids
  let leaders = 0, joins = 0, scored = 0;
  // xMode: an external work is a short uniform title ("Il principe", "Essais"), so
  // containment is measured on the x side, and a title whose EVERY head token sits
  // in the leader passes on a lower bar (X_FULL_IDF) — the author anchor already
  // holds, and corpus-wide IDF is too strict for one-word titles ("principe" is
  // in 1,481 Italian editions, idf 4.31, below MID).
  let xIdx = null; // stem|token → every clustered node, over every head token (built once, for the x pass)
  function bestLeader(a, xMode = false) {
    let best = -1, bestScore = 0, bestSw = 0;
    const seen = new Set();
    const idx = xMode ? xIdx : leaderIdx;
    for (const s of a.stems) for (const t of a.head) {
      const lst = idx.get(s + '|' + t); if (!lst) continue;
      for (const L of lst) {
        if (seen.has(L)) continue;
        seen.add(L); scored++;
        const l = nodes[L];
        let sw = 0, nS = 0, nM = 0;
        for (const x of l.head) if (a.set.has(x)) { const v = idf(x); sw += v; if (v >= STRONG_IDF) nS++; if (v >= MID_IDF) nM++; }
        const score = Math.max(sw / Math.min(l.w, a.w), xMode ? sw / a.w : 0);
        const specific = nS >= 1 || nM >= 2 || (xMode && score >= 0.999 && sw >= X_FULL_IDF);
        if (!specific) continue;
        if (score < CONTAIN) continue;
        // x pass: on a tie, a USTC edition beats an SL book (an SL "Il principe" left
        // outside the USTC work would otherwise swallow every external Prince)
        const tie = Math.abs(score - bestScore) < 1e-9;
        const uBeats = xMode && tie && l.k === 'u' && best >= 0 && nodes[best].k !== 'u';
        const uLoses = xMode && tie && l.k !== 'u' && best >= 0 && nodes[best].k === 'u';
        if (score > bestScore + 1e-9 || uBeats || (tie && !uLoses && sw > bestSw)) { best = L; bestScore = score; bestSw = sw; }
      }
    }
    return best;
  }
  for (let o = 0; o < order.length; o++) {
    if (o % 100000 === 0 && o) console.log(`  leader pass ${o}/${order.length}…`);
    const i = order[o], a = nodes[i];
    const best = bestLeader(a);
    if (best >= 0) { union(i, best); joins++; continue; }
    leaders++;
    for (const s of a.stems) for (const t of a.head) if (idf(t) >= MID_IDF) {
      const key = s + '|' + t;
      if (!leaderIdx.has(key)) leaderIdx.set(key, []);
      leaderIdx.get(key).push(i);
    }
  }
  // x pass: external works attach to ONE node's work each, after the graph is fixed
  if (extWorks.length) {
    xIdx = new Map();
    // members too, not only leaders: "Il principe … La vita di Castruccio" joined
    // the Castruccio leader, and an x node must still be able to land on it
    for (let L = 0; L < nodes.length; L++) if (nodes[L].k !== 'x') for (const s of nodes[L].stems) for (const t of nodes[L].head) {
      const key = s + '|' + t;
      if (!xIdx.has(key)) xIdx.set(key, []);
      xIdx.get(key).push(L);
    }
  }
  let xJoined = 0;
  const xUnmatched = { no_author: 0, no_title_tokens: 0, no_leader: 0 };
  nodes.forEach((n, i) => {
    if (n.k !== 'x') return;
    if (!n.stems.length) { xUnmatched.no_author++; return; }
    if (!(n.w > 0)) { xUnmatched.no_title_tokens++; return; }
    const L = bestLeader(n, true);
    if (L < 0) { xUnmatched.no_leader++; return; }
    union(i, L); xJoined++;
  });
  console.log(`direct ${direct} | anon nodes ${anon} | leaders ${leaders} | joins ${joins} | x joined ${xJoined} ${JSON.stringify(xUnmatched)} | leader comparisons ${scored}`);
  const root = (i) => find(i);

  // --- components ---
  const comp = new Map();
  nodes.forEach((n, i) => { const r = root(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); });
  const rank = { readable: 2, partial: 1, none: 0 };
  const works = [];
  for (const [r, mem] of comp) {
    const u = mem.filter((i) => nodes[i].k === 'u'), s = mem.filter((i) => nodes[i].k === 's');
    const x = mem.filter((i) => nodes[i].k === 'x');
    if (!u.length && !s.length) continue; // an unmatched external work is not a work of this graph
    const xSources = new Set(x.flatMap((i) => nodes[i].ref.sources || []));
    const extBefore = u.some((i) => priorClusters.has(nodes[i].ref.work_cluster_id)) || [...xSources].some((src) => !STAGED_SOURCES.has(src));
    const ext = extBefore || xSources.size > 0;
    const sl = s.reduce((a, i) => (rank[bookStatus(nodes[i].ref)] > rank[a] ? bookStatus(nodes[i].ref) : a), s.length ? 'none' : null);
    const years = u.map((i) => nodes[i].ref.year).filter(Boolean);
    const newspaper = u.some((i) => nodes[i].news);
    works.push({ r, u: u.length, s: s.length, x, xSources, extBefore, ext, sl, newspaper, year_min: years.length ? Math.min(...years) : null,
      old_clusters: new Set(u.map((i) => nodes[i].ref.work_cluster_id)).size,
      title: nodes[(u[0] ?? s[0])].title.slice(0, 140), author: nodes[(u[0] ?? s[0])].author, mem });
  }
  const ustcWorks = works.filter((w) => w.u > 0);

  // --- external landing (#7769): per source, x works on a USTC work; USTC works with a prior ---
  const xLanding = {};
  const bump = (src, key) => { xLanding[src] ??= { x_works: 0, landed_on_ustc_work: 0, ustc_works_with_prior: 0, ustc_works_only_this_source: 0 }; xLanding[src][key]++; };
  nodes.forEach((n) => { if (n.k === 'x') for (const src of new Set(n.ref.sources || [])) bump(src, 'x_works'); });
  for (const w of ustcWorks) {
    for (const i of w.x) for (const src of new Set(nodes[i].ref.sources || [])) bump(src, 'landed_on_ustc_work');
    for (const src of w.xSources) bump(src, 'ustc_works_with_prior');
    if (w.xSources.size === 1 && !w.extBefore) bump([...w.xSources][0], 'ustc_works_only_this_source');
  }
  const staged = [...STAGED_SOURCES];
  const external_landing = {
    ustc_works: ustcWorks.length,
    with_prior_before: ustcWorks.filter((w) => w.extBefore).length,
    with_prior_after: ustcWorks.filter((w) => w.ext).length,
    with_staged_prior: ustcWorks.filter((w) => staged.some((src) => w.xSources.has(src))).length,
    by_source: xLanding,
  };
  console.log('external landing:', JSON.stringify(external_landing));
  console.log(`works with ≥1 USTC edition: ${ustcWorks.length} (was ${new Set(eds.map((e) => e.work_cluster_id)).size} clusters) | SL-only works: ${works.length - ustcWorks.length}`);
  const bookWorks = ustcWorks.filter((w) => !w.newspaper);
  const newsWorks = ustcWorks.filter((w) => w.newspaper);
  console.log(`newspapers${GROUP_NEWS ? '' : ' (NOT grouped: WG_NEWSPAPERS=0)'}: ${newsIssues} issues → ${newsWorks.length} works | works with newspapers as one each ${ustcWorks.length} | excluding newspapers ${bookWorks.length}`);

  // --- gold fragmentation tests ---
  const gold = [
    ['Imitatio Christi', /kempis/i, /imitat/i], ['Moriae encomium', /erasm/i, /mori|stultit/i], ['Adagia', /erasm/i, /adag/i],
    ['Consolatio', /boet/i, /consolat/i], ['De occulta philosophia', /agrippa/i, /occult/i], ['Aeneid', /vergil|virgil/i, /aene/i],
    ['Pimander', /trismeg|mercur|hermes/i, /pimand|poemand/i], ['Utopia', /morus|more/i, /utopi/i],
  ];
  const goldOut = {};
  for (const [label, ar, tr] of gold) {
    const hit = eds.map((e, i) => i).filter((i) => ar.test(nodes[i].author) && tr.test(nodes[i].title));
    const comps = new Map(); for (const i of hit) { const r = root(i); comps.set(r, (comps.get(r) || 0) + 1); }
    const top = [...comps.values()].sort((a, b) => b - a);
    goldOut[label] = { editions: hit.length, old_clusters: new Set(hit.map((i) => eds[i].work_cluster_id)).size, works: comps.size, largest_work_share: hit.length ? Number((top[0] / hit.length).toFixed(2)) : null };
  }
  console.log('gold fragmentation:', goldOut);

  // --- the 2x2 at WORK level ---
  const grid = (subset, min) => {
    const ok = (w) => w.sl && rank[w.sl] >= rank[min];
    let both = 0, slFirst = 0, extOnly = 0, gap = 0;
    for (const w of subset) { const s = ok(w); if (s && w.ext) both++; else if (s) slFirst++; else if (w.ext) extOnly++; else gap++; }
    const n = subset.length, pc = (x) => Number((100 * x / n).toFixed(2));
    return { works: n, sl: both + slFirst, sl_pct: pc(both + slFirst), external: both + extOnly, external_pct: pc(both + extOnly),
      grid: { sl_and_external: both, sl_first: slFirst, external_only: extOnly, open_gap: gap } };
  };
  const byCentury = (min) => Object.fromEntries([[1400, 1499], [1500, 1599], [1600, 1700]].map(([a, z]) => [`${a}s`, grid(ustcWorks.filter((w) => w.year_min >= a && w.year_min <= z), min)]));
  const sizes = { 1: 0, '2-5': 0, '6-20': 0, '21-100': 0, '101+': 0 };
  for (const w of ustcWorks) { const n = w.u; sizes[n === 1 ? 1 : n <= 5 ? '2-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '101+']++; }
  const biggest = [...bookWorks].sort((a, b) => b.u - a.u).slice(0, 25).map((w) => ({ editions: w.u, sl: w.s, old_clusters: w.old_clusters, author: w.author, title: w.title }));

  // over-merge audit sample: random multi-edition works, two member titles each
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const multi = bookWorks.filter((w) => w.old_clusters >= 2);
  const sample = [];
  for (let k = 0; k < 40 && multi.length; k++) {
    const w = multi[Math.floor(rnd() * multi.length)];
    const tt = [...new Set(w.mem.filter((i) => nodes[i].k !== 'x').map((i) => nodes[i].title.slice(0, 110)))];
    sample.push({ author: w.author, editions: w.u, titles: [tt[0], tt[Math.floor(rnd() * tt.length)]] });
  }

  const report = {
    generated: new Date().toISOString().slice(0, 10), issue: '#7751',
    params: { K, CONTAIN, STRONG_IDF, MID_IDF, FLOOR_IDF, X_FULL_IDF },
    nodes: { ustc_editions: eds.length, sl_books: books.length, external_works: extWorks.length },
    edges: { direct, leaders, joins, anon_nodes: anon },
    works_with_ustc: ustcWorks.length, old_clusters: new Set(eds.map((e) => e.work_cluster_id)).size,
    sl_only_works: works.length - ustcWorks.length,
    // works_with_ustc counts each newspaper as ONE work; excluding_newspapers drops them (#7751)
    newspapers: { grouped: GROUP_NEWS, rule: "classification_1 = 'Newspapers'; key = place + title minus numbers/dates", issues: newsIssues, works: newsWorks.length,
      works_with_newspapers_as_one: ustcWorks.length, works_excluding_newspapers: bookWorks.length,
      held_excluding: grid(bookWorks, 'none'), readable_excluding: grid(bookWorks, 'readable'),
      biggest: [...newsWorks].sort((a, b) => b.u - a.u).slice(0, 25).map((w) => ({ issues: w.u, years: [w.year_min, Math.max(...w.mem.filter((i) => nodes[i].k === 'u').map((i) => nodes[i].ref.year || 0))], place: nodes[w.mem.find((i) => nodes[i].k === 'u')].ref.place, title: w.title })) },
    editions_per_work: sizes, gold: goldOut,
    lang: LANG, external_file: path.basename(EXTERNAL), external_landing,
    held: grid(ustcWorks, 'none'), translated_any: grid(ustcWorks, 'partial'), readable: grid(ustcWorks, 'readable'),
    readable_by_century: byCentury('readable'),
    biggest_works: biggest, over_merge_sample: sample,
  };
  fs.writeFileSync(path.join(OUT, `work-graph-report${SUFFIX}.json`), JSON.stringify(report, null, 2));
  const w1 = fs.createWriteStream(path.join(OUT, `work-graph${SUFFIX}.jsonl`));
  for (const w of works) w1.write(JSON.stringify({ work: w.r, ustc_sns: w.mem.filter((i) => nodes[i].k === 'u').map((i) => nodes[i].ref.sn), sl_books: w.mem.filter((i) => nodes[i].k === 's').map((i) => nodes[i].ref.id), ext_refs: w.x.flatMap((i) => nodes[i].ref.staged_refs || nodes[i].ref.sources || []).slice(0, 200), ext_before: w.extBefore, ext: w.ext, sl: w.sl, ...(w.newspaper ? { newspaper: true, ustc_ids: w.mem.filter((i) => nodes[i].k === 'u').map((i) => nodes[i].ref.id) } : {}), year_min: w.year_min, author: w.author, title: w.title }) + '\n');
  w1.end();
  for (const [k, g] of Object.entries({ held: report.held, translated_any: report.translated_any, readable: report.readable, ...Object.fromEntries(Object.entries(report.readable_by_century).map(([a, b]) => [`readable ${a}`, b])) })) {
    console.log(`${k}: of ${g.works} works — SL ${g.sl} (${g.sl_pct}%), external ${g.external} (${g.external_pct}%), grid ${JSON.stringify(g.grid)}`);
  }
  console.log('editions/work:', sizes);
  console.log(`wrote work-graph${SUFFIX}.jsonl + work-graph-report${SUFFIX}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
