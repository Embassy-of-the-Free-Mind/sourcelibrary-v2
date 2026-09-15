#!/usr/bin/env node
/**
 * PRIOR ART: none — `scripts/audit/search-tenant-purity.mjs` probes ONE surface
 * across tenants; nothing walked the whole set of surfaces that can serve a
 * page's text. Looked in `scripts/audit/`, and for existing MCP probes.
 *
 * Does any surface still serve this page's translation? (#4523)
 *
 * Run it BEFORE a takedown and AFTER. The BEFORE run is not optional: a probe
 * that finds nothing before the change proves nothing after it. Both runs print
 * FOUND/absent per surface and write a JSON record.
 *
 * Two lessons are built into the checks themselves, because both of them made
 * an earlier version of this file certify the wrong thing:
 *
 *  - The SEARCH routes echo the query back in their JSON envelope, so matching
 *    on the phrase reads FOUND whether or not the page is in the results. They
 *    match on the PAGE ID only. A probe that cannot fail is not a probe.
 *  - MCP `get_book_text`/`get_quote` spend a shared anonymous page budget
 *    (500/24h per IP) that one full-book `/api/books/:id/text` call exhausts.
 *    They run FIRST, and a budget refusal prints BUDGET EXHAUSTED rather than
 *    passing as "absent".
 *
 * Phrases are read from the page, or — once it is withheld — from its
 * `page_revisions` snapshot, so the AFTER run searches for the same words the
 * BEFORE run did instead of searching for nothing.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/withheld-translation-surfaces.mjs before --only=http
 *   node --env-file=.env.production.local scripts/audit/withheld-translation-surfaces.mjs after  --only=db
 *
 * --only=http  request-path surfaces. Run from a machine whose IP has not spent
 *              the anonymous page budget.
 * --only=db    Mongo + Supabase. Needs SUPABASE_DB_URL (Hetzner).
 * --book/--arm1/--arm2  override the sample book and the two probe pages; the
 *              defaults are the #4523 pair, one page per predicate arm.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const LABEL = process.argv[2] || 'run';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '--only=all').split('=')[1];
const OUT = process.env.PROBE_OUT || `scripts/output/withheld-surfaces-${LABEL}-${ONLY}.json`;
const BASE = process.env.PROBE_BASE || 'https://sourcelibrary.org';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const BOOK = ARG('--book', '69e78a8a4a6785cfd60d3a96');
const SLUG = ARG('--slug', 'rdo-rje-gling-pa-i-bka-bum-collection');
// One page per arm of the predicate: a re-OCR'd page whose translation predates
// the new reading, and a page whose transcription is flagged unreadable.
const ARM1 = { page_id: ARG('--arm1', '69e78a8a4a6785cfd60d3a97'), page_number: Number(ARG('--arm1-page', '1')) };
const ARM2 = { page_id: ARG('--arm2', '69e78a8a4a6785cfd60d3a99'), page_number: Number(ARG('--arm2-page', '3')) };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (surface, found, detail) => {
  results.push({ surface, found, detail });
  console.log(`${found ? 'FOUND   ' : 'absent  '} ${surface}  ${detail}`);
};
async function get(path, opts = {}) {
  await sleep(1500); // the edge bot limiter is 10 req/60s
  try {
    const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(180000) });
    return { status: r.status, body: await r.text() };
  } catch (e) { return { status: 0, body: `FETCH-ERROR ${e.message}` }; }
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const pages = mongo.db('bookstore').collection('pages');
const revisions = mongo.db('bookstore').collection('page_revisions');
const phraseFor = async (pid) => {
  const p = await pages.findOne({ id: pid }, { projection: { translation: 1, translation_withheld: 1 } });
  // After the withhold the text is not on the page at all — it is in
  // page_revisions. The probe has to search for the text that WAS served, so it
  // reads the archive rather than reporting "nothing to look for" as a pass.
  const rev = p?.translation?.data ? null : await revisions
    .find({ page_id: pid, field: 'translation', reason: 'withhold-stale-translation-4523' })
    .sort({ created_at: -1 }).limit(1).next();
  const t = p?.translation?.data || p?.translation_withheld?.data || rev?.data || '';
  // Clause probe: keep line breaks so a clause never spans a tag boundary —
  // a flattened phrase that merges a <margin> label into the body sentence
  // matches nothing in the tag-bearing served text, and the probe then reads
  // as "absent" before the change, certifying nothing.
  const clauses = t.replace(/<[^>]*>/g, ' ').split(/[.\n]/).map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 55 && s.length < 130 && !/^[A-Z ]+$/.test(s));
  return {
    phrase: clauses[0] || t.slice(0, 90),
    // The SEO description is built from the START of the page, so the deep
    // clause above cannot probe it. This is the opening instead.
    opening: norm(t).slice(0, 60),
    live: !!p?.translation?.data,
    withheld: !!p?.translation_withheld,
    from: p?.translation?.data ? 'page' : (rev ? 'page_revisions snapshot' : 'none'),
  };
};

/** One normalizer for both sides of the SEO-description comparison. */
function norm(s) {
  return s
    .replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const a1 = await phraseFor(ARM1.page_id);
const a2 = await phraseFor(ARM2.page_id);
console.log(`\n=== ${LABEL} (${ONLY}) ===`);
console.log(`arm1 (stale_after_reocr) "${a1.phrase}"  mongo live=${a1.live} withheld=${a1.withheld} phrase-from=${a1.from}`);
console.log(`arm2 (ocr_unreadable)    "${a2.phrase}"  mongo live=${a2.live} withheld=${a2.withheld} phrase-from=${a2.from}`);
const key1 = a1.phrase.split(/\s+/).slice(0, 7).join(' ');
const key2 = a2.phrase.split(/\s+/).slice(0, 7).join(' ');

if (ONLY === 'db' || ONLY === 'all') {
  record('0-mongo pages.translation.data (arm1)', a1.live, a1.live ? 'served field present' : 'field absent');
  record('0-mongo pages.translation.data (arm2)', a2.live, a2.live ? 'served field present' : 'field absent');

  // 3. Semantic lane. Instead of hoping a text query ranks the page top-15,
  // query the RPC with the page's OWN stored vector: self-similarity is 1.0, so
  // if the row is reachable at all it is the first hit. Costs no Gemini call
  // and cannot fail for ranking reasons — the failure mode a text query has.
  if (process.env.SUPABASE_DB_URL) {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const rows = await c.query(
      `select page_id, embedding is not null as has_vec,
              length(coalesce(translation,'')) as snip,
              withheld_at is not null as marked
         from page_translations where page_id = any($1::text[])`, [[ARM1.page_id, ARM2.page_id]]);
    for (const row of rows.rows) {
      const arm = row.page_id === ARM1.page_id ? 'arm1' : 'arm2';
      record(`3-supabase page_translations row (${arm})`, row.has_vec && row.snip > 0,
        `has_vec=${row.has_vec} snippet_chars=${row.snip} withheld_marked=${row.marked}`);
    }
    if (!rows.rows.length) record('3-supabase page_translations row', false, 'no rows for either page');

    for (const [arm, t] of [['arm1', ARM1], ['arm2', ARM2]]) {
      const vec = await c.query('select embedding from page_translations where page_id = $1 and embedding is not null', [t.page_id]);
      if (!vec.rows.length) { record(`3b-match_pages_in_books RPC (${arm})`, false, 'no vector to query with — row already unreachable'); continue; }
      const hit = await c.query(
        `select page_id, length(coalesce(translation,'')) as snip from match_pages_in_books($1::vector, $2::text[], 0.3, 5)`,
        [vec.rows[0].embedding, [BOOK]]);
      const self = hit.rows.find((r) => r.page_id === t.page_id);
      record(`3b-match_pages_in_books RPC (${arm})`, !!self && self.snip > 0,
        `${hit.rows.length} hits, self ${self ? `returned with ${self.snip} chars` : 'not returned'}`);
    }
    await c.end();
  } else {
    record('3-supabase page_translations', false, 'UNKNOWN — SUPABASE_DB_URL not set, NOT CHECKED');
  }
}

if (ONLY === 'http' || ONLY === 'all') {
  // 8. MCP FIRST: get_book_text / get_quote spend a shared anonymous page
  // budget (500/24h) that a full-book /text call below would exhaust. Order is
  // load-bearing — the first run of this probe reported them "absent" purely
  // because /api/books/:id/text had already spent the budget.
  async function mcp(name, args) {
    await sleep(1500);
    try {
      const r = await fetch(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': UA },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      return { status: r.status, body: await r.text() };
    } catch (e) { return { status: 0, body: `FETCH-ERROR ${e.message}` }; }
  }
  const budgetHit = (b) => b.includes('Daily page budget reached');
  {
    const a = await mcp('get_book_text', { book_id: BOOK, from: 1, to: 6 });
    record('8-MCP get_book_text', a.body.includes(key1) || a.body.includes(key2),
      budgetHit(a.body) ? 'BUDGET EXHAUSTED — probe invalid' : `HTTP ${a.status}, ${a.body.length}b`);
    const b = await mcp('get_quote', { book_id: BOOK, page: ARM1.page_number });
    record('8b-MCP get_quote (arm1)', b.body.includes(key1),
      budgetHit(b.body) ? 'BUDGET EXHAUSTED — probe invalid' : `HTTP ${b.status}, ${b.body.slice(0, 100).replace(/\n/g, ' ')}`);
    const b2 = await mcp('get_quote', { book_id: BOOK, page: ARM2.page_number });
    record('8c-MCP get_quote (arm2)', b2.body.includes(key2),
      budgetHit(b2.body) ? 'BUDGET EXHAUSTED — probe invalid' : `HTTP ${b2.status}, ${b2.body.slice(0, 100).replace(/\n/g, ' ')}`);
    // Page id only, for the same reason as the HTTP search lanes above: these
    // tools echo the query in their result envelope.
    const c = await mcp('search_translations', { query: key1 });
    record('8d-MCP search_translations (arm1)', c.body.includes(ARM1.page_id), `HTTP ${c.status}, ${c.body.length}b`);
    const d = await mcp('search_within_book', { book_id: BOOK, query: key2 });
    record('8e-MCP search_within_book (arm2)', d.body.includes(ARM2.page_id), `HTTP ${d.status}, ${d.body.length}b`);
    const e = await mcp('search_concept', { query: key1 });
    record('8f-MCP search_concept (arm1)', e.body.includes(ARM1.page_id), `HTTP ${e.status}, ${e.body.length}b`);
  }

  // 1. Reader page HTML + the reader's data route
  for (const [arm, t, k] of [['arm1', ARM1, key1], ['arm2', ARM2, key2]]) {
    const r = await get(`/book/${SLUG}/page/${t.page_id}`);
    record(`1-reader HTML (${arm})`, r.body.includes(k), `HTTP ${r.status}, ${r.body.length}b`);
    const j = await get(`/api/pages/${t.page_id}`);
    record(`1b-/api/pages/:id (${arm})`, j.body.includes(k), `HTTP ${j.status}, ${j.body.length}b`);
  }

  // 2. Full-text search lanes.
  // Match on the PAGE ID, never on the phrase: every one of these routes echoes
  // the query back in its JSON (`{"query": "..."}`), so a phrase match is FOUND
  // whether or not the page is in the results — a probe that cannot fail proves
  // nothing in either direction, and this one read as a clean positive control
  // before the change and as a leak after it.
  {
    const r = await get(`/api/search?q=${encodeURIComponent(`"${key1}"`)}`);
    record('2-/api/search (arm1)', r.body.includes(ARM1.page_id), `HTTP ${r.status}, ${r.body.length}b`);
    const r2 = await get(`/api/books/${BOOK}/search?q=${encodeURIComponent(key1)}`);
    record('2b-/api/books/:id/search (arm1)', r2.body.includes(ARM1.page_id), `HTTP ${r2.status}, ${r2.body.length}b`);
    const r3 = await get(`/api/books/${BOOK}/search?q=${encodeURIComponent(key2)}`);
    record('2c-/api/books/:id/search (arm2)', r3.body.includes(ARM2.page_id), `HTTP ${r3.status}, ${r3.body.length}b`);
  }

  // 4. Quote API (the shortlink /q/ resolves to the same route)
  for (const [arm, t, k] of [['arm1', ARM1, key1], ['arm2', ARM2, key2]]) {
    const r = await get(`/api/books/${BOOK}/quote?page=${t.page_number}`);
    record(`4-/api/books/:id/quote (${arm})`, r.body.includes(k), `HTTP ${r.status}, ${r.body.slice(0, 80).replace(/\n/g, ' ')}`);
  }

  // 7. IIIF annotation lists
  for (const [arm, t, k] of [['arm1', ARM1, key1], ['arm2', ARM2, key2]]) {
    const r = await get(`/api/iiif/${BOOK}/canvas/${t.page_number}/translation`);
    record(`7-IIIF canvas translation (${arm})`, r.body.includes(k), `HTTP ${r.status}, ${r.body.length}b`);
  }

  // 9. SEO: the JSON-LD excerpt in the reader <head>, and the /es twin
  {
    const r = await get(`/book/${SLUG}/page/${ARM1.page_id}`);
    const ld = [...r.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    const meta = [...r.body.matchAll(/<meta[^>]+(?:name="description"|property="og:description")[^>]*>/gi)].join('\n');
    // The description is entity-escaped, tag-bearing and markdown-stripped;
    // compare through the same normalizer as the source or the match is
    // guaranteed to miss and the probe would certify a leak as clean.
    const head = norm(ld + meta);
    record('9-reader meta/OG description (arm1)', head.includes(a1.opening.slice(0, 45)),
      `HTTP ${r.status}, head text ${head.length}b`);
    const es = await get(`/es/book/${SLUG}/page/${ARM1.page_id}`);
    record('9b-/es localized reader (arm1)', es.body.includes(key1), `HTTP ${es.status}, ${es.body.length}b`);
  }

  // 6. Exports. /text is the open one; downloads are sign-in gated, so the
  // probe records the gate rather than pretending to have read the file — the
  // download route reads `page.translation` from Mongo (grep-verified, no
  // second copy), so the move covers it by construction.
  {
    const r = await get(`/api/books/${BOOK}/text?from=1&to=6`);
    record('6-/api/books/:id/text', r.body.includes(key1) || r.body.includes(key2), `HTTP ${r.status}, ${r.body.length}b`);
    const r2 = await get(`/api/books/${BOOK}/download?format=translation`);
    record('6b-/api/books/:id/download', r2.body.includes(key1), `HTTP ${r2.status} (401 = sign-in gate, reads pages.translation)`);
  }
}

const found = results.filter((r) => r.found).length;
console.log(`\n${LABEL} (${ONLY}): ${found}/${results.length} probes reached the text`);
fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, only: ONLY, at: new Date().toISOString(), arm1: a1, arm2: a2, results }, null, 2));
console.log('wrote ' + OUT);
await mongo.close();
