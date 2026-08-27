/**
 * llm-verify-work-merges.mjs — author-blocked LLM clustering for the divergent-
 * title tail (#1634 / #2264).
 *
 * The divergent-title cross-language case ("De occulta philosophia" ⇄ "Three
 * Books of Occult Philosophy") defeats every string/embedding method — the
 * bridge is *knowledge*, not computation. This is the scalable version of the
 * hand-adjudication: Gemini in "Compare" mode, blocked by canonical author,
 * proposes which of an author's works are the same intellectual work.
 *
 * Design (matches the field consensus — GLIMIR "merge-only, never split"):
 *  - Block by author_id (NEVER merge across authors).
 *  - Build one ITEM per distinct current work_id (+ one per unset book).
 *  - Ask Gemini to group items that are the SAME work (editions/translations),
 *    keeping distinct works / series volumes separate. HIGH-confidence only.
 *  - Apply: reassign all books in a merged group to one canonical work_id
 *    (prefer an existing Wikidata QID > existing local slug > mint). Never
 *    splits an existing cluster. Backup + reversible source tag.
 *
 *   node scripts/analysis/llm-verify-work-merges.mjs                 # dry-run (proposals + sample)
 *   node scripts/analysis/llm-verify-work-merges.mjs --limit-authors 40
 *   node scripts/analysis/llm-verify-work-merges.mjs --apply         # write HIGH merges (+backup)
 *   node scripts/analysis/llm-verify-work-merges.mjs --coverage-only # exclusion report + coverage, NO LLM calls (free)
 *   node scripts/analysis/llm-verify-work-merges.mjs --include-backlog # ALSO judge hidden/backlog books (#4246 Phase 1)
 *   node scripts/analysis/llm-verify-work-merges.mjs --mega            # judge ONLY the >50-item mega-author blocks,
 *                                                                     # hierarchically: title-sorted chunks of ≤40, then
 *                                                                     # rounds over surviving group representatives until
 *                                                                     # convergence. Writes llm-work-merge-proposals-mega.json.
 *
 * Env: MONGODB_URI, GEMINI_API_KEY_TIER3|GEMINI_API_KEY. Model: gemini-3.1-flash-lite.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const COVERAGE_ONLY = process.argv.includes('--coverage-only');
// Include hidden/backlog books in the judged universe (#4246 Phase 1). Work
// identity pays off most BEFORE a book is processed — "do we already hold
// this?" is an acquisition gate — and the visible-only default left 28.8K
// author-linked backlog books judge-blind (measured 2026-08-27). Off by
// default so the standing run's behavior is unchanged. Still requires
// pages_count > 0: metadata-only imports carry unverified titles.
const INCLUDE_BACKLOG = process.argv.includes('--include-backlog');
// Judge ONLY the mega-author blocks (>50 items) the normal pass skips. One LLM
// call cannot hold a 200-item author, so: sort clusters by de-accented title
// (same-work items land adjacent), judge chunks of ≤40, merge HIGH groups,
// repeat over the surviving representatives until no merges or one chunk holds
// everything. Cross-chunk merges happen in later rounds via representatives.
const MEGA = process.argv.includes('--mega');
const LIMIT_AUTHORS = parseInt((process.argv.find(a => a.startsWith('--limit-authors=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--limit-authors') + 1] || '0', 10) || 0;
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const GEN_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
if (!KEY) { console.error('GEMINI_API_KEY[_TIER3] not set'); process.exit(1); }

const deacc = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = s => deacc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const isQID = w => /^Q\d/.test(w || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          members: { type: 'array', items: { type: 'string' } },   // item refs
          canonical_title: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
        required: ['members', 'canonical_title', 'confidence', 'reason'],
      },
    },
  },
  required: ['groups'],
};

async function clusterAuthor(authorName, items) {
  const list = items.map(it => `${it.ref}: "${it.title}" [${[...it.langs].join('/')}${it.years ? ' ' + it.years : ''}]`).join('\n');
  const prompt = `You are a bibliographic cataloger applying FRBR Work-level identity. All items below are by the author "${authorName}". Group the items that are the SAME intellectual WORK — i.e. editions, printings, or translations of one work belong together, even when their titles differ across languages (e.g. "De occulta philosophia libri tres" and "Three Books of Occult Philosophy" are ONE work).

Rules:
- DIFFERENT works stay in their own group (even if they share a series title, a collected-edition title, or a preface).
- Separate VOLUMES or PARTS of a multi-volume set are DIFFERENT works — do NOT merge "Vol. 1" with "Vol. 2", or different dialogues/books of a collection.
- A commentary ON a work, or a single excerpt OF a work, is a different work from the whole — keep separate unless clearly the same text.
- Use your bibliographic knowledge of original-vs-translated titles. When you are NOT confident two items are the same work, keep them in separate groups (under-cluster — never guess a merge).
- Every item ref must appear in exactly one group. Singletons get their own one-member group.
- confidence: "high" only when you are sure; "medium"/"low" otherwise. Give a clean canonical (preferably original-language) uniform title per group.

Items:
${list}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 }, temperature: 0 },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(GEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (r.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
      if (!r.ok) { if (attempt === 3) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`); await sleep(2000); continue; }
      const j = await r.json();
      const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) { if (attempt === 3) return null; await sleep(1500); continue; }
      return JSON.parse(txt);
    } catch (e) { if (attempt === 3) { console.error(`  ! ${authorName}: ${e.message}`); return null; } await sleep(2000); }
  }
  return null;
}

// volume guard: reject a group whose member titles carry conflicting vol/band numbers
function hasVolumeConflict(titles) {
  const nums = new Set();
  for (const t of titles) {
    const m = (t || '').match(/\b(?:vol\.?|band|tome|part|teil|book)\s*\.?\s*(\d{1,3})\b/i);
    if (m) nums.add(m[1]);
  }
  return nums.size > 1;
}

const _afIdx = process.argv.indexOf('--apply-from');
const APPLY_FROM = (process.argv.find(a => a.startsWith('--apply-from=')) || '').split('=')[1]
  || (_afIdx !== -1 && process.argv[_afIdx + 1] && !process.argv[_afIdx + 1].startsWith('--') ? process.argv[_afIdx + 1] : '');

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const authorsCol = db.collection('authors');

// ── apply-from-file: no LLM spend — apply HIGH merges from a saved proposal ──
if (APPLY_FROM) {
  const data = JSON.parse(fs.readFileSync(APPLY_FROM, 'utf8'));
  const high = (data.proposals || []).filter(p => p.confidence === 'high');
  const outDir2 = new URL('../output/', import.meta.url).pathname;
  const writes = [];
  for (const p of high) {
    const wids = p.members.map(m => m.currentWorkId).filter(Boolean);
    const wid = wids.find(isQID) || wids.filter(w => w.startsWith('local:')).sort()[0] || `local:a:${p.author_id}:${slug(p.canonical_title)}`;
    for (const id of p.bookIds) writes.push({ id, work_id: wid, title: p.canonical_title });
  }
  fs.writeFileSync(`${outDir2}llm-work-merge-apply-backup.json`, JSON.stringify({ when: 'apply-from', source: APPLY_FROM, groups: high.length, writes }, null, 2));
  console.log(`apply-from ${APPLY_FROM}: ${high.length} HIGH merge groups → ${writes.length} book writes`);
  let mod = 0;
  for (const w of writes) {
    const r = await books.updateOne({ id: w.id }, { $set: { work_id: w.work_id, work_title: w.title, work_id_source: 'work-merge:llm-verified', work_id_confidence: 'high', updated_at: new Date() } });
    mod += r.modifiedCount;
  }
  console.log(`applied: ${mod} book records updated`);
  await mc.close();
  process.exit(0);
}

const TEXT = { ...(INCLUDE_BACKLOG ? {} : { visible: true }), pages_count: { $gt: 0 }, language: { $nin: ['Visual', 'Unknown', null] }, author_id: { $exists: true, $ne: null } };
const all = await books.find(TEXT, { projection: { id: 1, work_id: 1, title: 1, display_title: 1, language: 1, year: 1, author_id: 1 } }).toArray();

// ── Exclusion report + judged-coverage metric (#4246 Phase 0) ──────────────
// The selection gate above excludes silently, and a judge that never says what
// it cannot see reads as exhaustive (the #3769 shape: a backfill scanning
// 19,712 while 43,858 sat outside its filter). Each count below holds the
// OTHER gates satisfied, so every number is one actionable backlog, not
// overlap soup. Runs every invocation; --coverage-only stops after it.
{
  const textish = { pages_count: { $gt: 0 }, language: { $nin: ['Visual', 'Unknown', null] } };
  const noAuthorId = { $or: [{ author_id: { $exists: false } }, { author_id: null }] };
  const [hiddenWithAuthor, visibleNoAuthor, srcDist] = await Promise.all([
    books.countDocuments({ ...textish, author_id: { $exists: true, $ne: null }, visible: { $ne: true } }),
    books.countDocuments({ ...textish, visible: true, ...noAuthorId }),
    books.aggregate([{ $match: TEXT }, { $group: { _id: '$work_id_source', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
  ]);
  console.log(`Selected (${INCLUDE_BACKLOG ? 'ALL' : 'visible'} text books with author_id): ${all.length}`);
  console.log('EXCLUDED — populations this judge cannot reach:');
  console.log(`  hidden/backlog text books WITH author_id  : ${hiddenWithAuthor}${INCLUDE_BACKLOG ? '  (INCLUDED this run via --include-backlog)' : ''}`);
  console.log(`  visible text books MISSING author_id      : ${visibleNoAuthor}  <- #4246 Phase 1 backfill target`);
  console.log('Judged coverage of the selection, by work_id_source:');
  const judged = new Set(['work-merge:llm-verified', 'work-merge:hand-adjudicated', 'work-merge:identical-title-deterministic', 'wikidata:P50']);
  let judgedN = 0;
  for (const r of srcDist) {
    if (judged.has(r._id)) judgedN += r.n;
    console.log(`  ${String(r._id).padEnd(44)}: ${r.n}`);
  }
  console.log(`  => judged or authority-anchored: ${judgedN}/${all.length} (${Math.round(100 * judgedN / Math.max(1, all.length))}%) — the rest are unexamined mints/seeds`);
}

// group by author -> items (one per work_id, one per unset book)
const byAuthor = new Map();
for (const b of all) { if (!byAuthor.has(b.author_id)) byAuthor.set(b.author_id, []); byAuthor.get(b.author_id).push(b); }

// candidate authors: have a possible merge (>=2 distinct work_ids, OR an unset book alongside another item)
const candidates = [];
const megaCandidates = [];
let singleItemAuthors = 0, megaAuthors = 0, megaAuthorBooks = 0;
for (const [aid, bks] of byAuthor) {
  const items = new Map(); // key -> {ref,title,langs,years,currentWorkId,bookIds}
  for (const b of bks) {
    const key = b.work_id || `unset:${b.id}`;
    if (!items.has(key)) items.set(key, { key, title: b.display_title || b.title || '', langs: new Set(), years: [], currentWorkId: b.work_id || null, bookIds: [] });
    const it = items.get(key);
    it.bookIds.push(b.id);
    if (b.language) it.langs.add(b.language);
    if (typeof b.year === 'number') it.years.push(b.year);
    const t = b.display_title || b.title || '';
    if (t.length > it.title.length) it.title = t;   // representative = longest title
  }
  const arr = [...items.values()];
  if (arr.length < 2) { singleItemAuthors++; continue; }   // nothing to merge
  if (arr.length > 50) { megaAuthors++; megaAuthorBooks += bks.length; if (MEGA) megaCandidates.push({ aid, items: arr }); continue; } // skipped by the normal pass; --mega judges them hierarchically
  arr.forEach((it, i) => { it.ref = 'I' + i; it.years = it.years.length ? `${Math.min(...it.years)}${Math.max(...it.years) !== Math.min(...it.years) ? '-' + Math.max(...it.years) : ''}` : ''; });
  candidates.push({ aid, items: arr });
}
console.log(`Author blocks: ${byAuthor.size} — judgeable ${candidates.length}, single-item ${singleItemAuthors}, mega (>50 items, SKIPPED) ${megaAuthors} covering ${megaAuthorBooks} books`);

if (COVERAGE_ONLY) { console.log('\n--coverage-only: stopping before LLM calls.'); await mc.close(); process.exit(0); }

// resolve author names
const aids = (MEGA ? megaCandidates : candidates).map(c => c.aid);
const nameMap = new Map();
for (let i = 0; i < aids.length; i += 500) {
  const docs = await authorsCol.find({ _id: { $in: aids.slice(i, i + 500) } }, { projection: { name: 1 } }).toArray();
  for (const d of docs) nameMap.set(d._id, d.name);
}

let pool = MEGA ? [] : candidates;
if (LIMIT_AUTHORS) pool = pool.slice(0, LIMIT_AUTHORS);
if (!MEGA) console.log(`Candidate authors with a possible merge: ${candidates.length}${LIMIT_AUTHORS ? ` (processing ${pool.length})` : ''}`);

const proposals = [];
let processed = 0, mergeGroups = 0;
const CONC = 12;
async function runAuthor(c) {
  const authorName = nameMap.get(c.aid) || c.aid;
  const res = await clusterAuthor(authorName, c.items);
  processed++;
  if (processed % 20 === 0) process.stderr.write(`  ${processed}/${pool.length} authors...\n`);
  if (!res?.groups) return;
  const itemByRef = new Map(c.items.map(it => [it.ref, it]));
  for (const g of res.groups) {
    const mems = (g.members || []).map(r => itemByRef.get(r)).filter(Boolean);
    if (mems.length < 2) continue;                                   // singleton group = no merge
    // skip if all members already share one work_id (no-op)
    const cwids = new Set(mems.map(m => m.currentWorkId).filter(Boolean));
    const allBooks = mems.flatMap(m => m.bookIds);
    if (cwids.size <= 1 && !mems.some(m => !m.currentWorkId)) continue;
    if (hasVolumeConflict(mems.map(m => m.title))) continue;         // series guard
    mergeGroups++;
    proposals.push({
      author: authorName, author_id: c.aid, confidence: g.confidence, reason: g.reason,
      canonical_title: g.canonical_title,
      members: mems.map(m => ({ ref: m.ref, title: m.title, langs: [...m.langs], currentWorkId: m.currentWorkId, nBooks: m.bookIds.length })),
      bookIds: allBooks,
    });
  }
}

// concurrency pool
for (let i = 0; i < pool.length; i += CONC) {
  await Promise.all(pool.slice(i, i + CONC).map(runAuthor));
}

// ── Mega-author hierarchical pass (#4246): chunk → judge → merge reps → repeat ──
if (MEGA) {
  const fmtYears = ys => ys.length ? `${Math.min(...ys)}${Math.max(...ys) !== Math.min(...ys) ? '-' + Math.max(...ys) : ''}` : '';
  const MCONC = 4, CHUNK = 40, MAX_ROUNDS = 5;
  const megaPool = LIMIT_AUTHORS ? megaCandidates.slice(0, LIMIT_AUTHORS) : megaCandidates;
  console.log(`--mega: hierarchically judging ${megaPool.length}/${megaCandidates.length} mega-author blocks (${megaAuthorBooks} books total)`);
  let mdone = 0;
  async function runMega(c) {
    const authorName = nameMap.get(c.aid) || c.aid;
    // one cluster per item; clusters absorb each other as rounds progress
    let clusters = c.items.map(it => ({ title: it.title, langs: new Set(it.langs), years: [...it.years], items: [it], canonical: null, reason: null }));
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (clusters.length < 2) break;
      clusters.sort((a, b) => deacc(a.title).localeCompare(deacc(b.title)));
      const chunks = [];
      if (clusters.length <= 45) chunks.push(clusters.slice());
      else for (let i = 0; i < clusters.length; i += CHUNK) chunks.push(clusters.slice(i, i + CHUNK));
      const removed = new Set();
      let mergedThisRound = 0;
      for (const chunk of chunks) {
        if (chunk.length < 2) continue;
        chunk.forEach((cl, i) => { cl.ref = 'I' + i; });
        const res = await clusterAuthor(authorName, chunk.map(cl => ({ ref: cl.ref, title: cl.title, langs: cl.langs, years: fmtYears(cl.years) })));
        if (!res?.groups) continue;
        const byRef = new Map(chunk.map(cl => [cl.ref, cl]));
        for (const g of res.groups) {
          if (g.confidence !== 'high') continue;                       // only HIGH merges accumulate across rounds
          const mems = (g.members || []).map(r => byRef.get(r)).filter(cl => cl && !removed.has(cl));
          if (mems.length < 2) continue;
          if (hasVolumeConflict(mems.map(m => m.title))) continue;     // series guard
          const head = mems[0];
          for (const m of mems.slice(1)) {
            head.items.push(...m.items);
            m.langs.forEach(l => head.langs.add(l));
            head.years.push(...m.years);
            if (m.title.length > head.title.length) head.title = m.title;
            removed.add(m);
          }
          head.canonical = g.canonical_title; head.reason = g.reason;
          mergedThisRound++;
        }
      }
      clusters = clusters.filter(cl => !removed.has(cl));
      const coveredInOneCall = chunks.length === 1;
      process.stderr.write(`  [${authorName}] round ${round}: ${mergedThisRound} merges → ${clusters.length} clusters\n`);
      if (!mergedThisRound || coveredInOneCall) break;
    }
    for (const cl of clusters) {
      if (cl.items.length < 2) continue;
      const cwids = new Set(cl.items.map(m => m.currentWorkId).filter(Boolean));
      if (cwids.size <= 1 && !cl.items.some(m => !m.currentWorkId)) continue;  // already one cluster = no-op
      mergeGroups++;
      proposals.push({
        author: authorName, author_id: c.aid, confidence: 'high',
        reason: `${cl.reason || 'accumulated hierarchical merge'} [mega-chunked]`,
        canonical_title: cl.canonical || cl.title,
        members: cl.items.map(m => ({ ref: m.key, title: m.title, langs: [...m.langs], currentWorkId: m.currentWorkId, nBooks: m.bookIds.length })),
        bookIds: cl.items.flatMap(m => m.bookIds),
      });
    }
    mdone++;
    process.stderr.write(`  mega ${mdone}/${megaPool.length} done: ${authorName}\n`);
  }
  for (let i = 0; i < megaPool.length; i += MCONC) {
    await Promise.all(megaPool.slice(i, i + MCONC).map(runMega));
  }
}

const outDir = new URL('../output/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const proposalsFile = `${outDir}llm-work-merge-proposals${MEGA ? '-mega' : ''}.json`;
fs.writeFileSync(proposalsFile, JSON.stringify({ processed, candidateAuthors: MEGA ? megaCandidates.length : candidates.length, mergeGroups, proposals }, null, 2));

const high = proposals.filter(p => p.confidence === 'high');
const crossLang = high.filter(p => new Set(p.members.flatMap(m => m.langs)).size > 1);
console.log(`\n── Proposed merges ──`);
console.log(`groups: ${proposals.length} (HIGH ${high.length}, of which cross-language ${crossLang.length})`);
console.log(`\n── Sample HIGH cross-language merges (the divergent-title wins) ──`);
for (const p of crossLang.slice(0, 12)) {
  console.log(`\n  [${p.author}] → ${p.canonical_title}`);
  for (const m of p.members) console.log(`     "${m.title.slice(0, 56)}" [${m.langs.join('/')}]`);
  console.log(`     ${p.reason.slice(0, 120)}`);
}
console.log(`\nProposal → ${proposalsFile}`);

if (APPLY) {
  const backup = `${outDir}llm-work-merge-backup.json`;
  const writes = [];
  for (const p of high) {
    // canonical work_id: prefer existing QID > existing local slug (sorted) > mint
    const wids = p.members.map(m => m.currentWorkId).filter(Boolean);
    let wid = wids.find(isQID) || wids.filter(w => w.startsWith('local:')).sort()[0]
      || `local:a:${p.author_id}:${slug(p.canonical_title)}`;
    for (const id of p.bookIds) writes.push({ id, work_id: wid, title: p.canonical_title });
  }
  fs.writeFileSync(backup, JSON.stringify({ when: 'apply', groups: high.length, writes }, null, 2));
  console.log(`\n--apply: ${high.length} HIGH merges → ${writes.length} book writes (backup ${backup})`);
  let mod = 0;
  for (const w of writes) {
    // reassign even if already set (cross-slug unify) — but only within this LLM pass's books
    const r = await books.updateOne({ id: w.id }, { $set: { work_id: w.work_id, work_title: w.title, work_id_source: 'work-merge:llm-verified', work_id_confidence: 'high', updated_at: new Date() } });
    mod += r.modifiedCount;
  }
  console.log(`applied: ${mod} book records updated`);
}

await mc.close();
