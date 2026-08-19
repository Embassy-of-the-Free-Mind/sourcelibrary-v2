#!/usr/bin/env node
/**
 * Replays the real MCP feedback session against the live connector.
 *
 * On 2026-08-05 an agent spent a session verifying ~25 circulating Aristotle
 * quotations through the MCP tools and filed four reports (#3652, #3653). These
 * are its actual complaints, turned into assertions — so the question is not
 * "do my synthetic queries look better" but "would that session go differently
 * now".
 *
 *   node scripts/audit/mcp-feedback-scenarios.mjs [baseUrl]
 *
 * Scenarios still marked OPEN are expected to fail; they are the unfixed items,
 * kept here so the backlog is measured rather than remembered.
 *
 * ## Pointing this at a preview does NOT test the preview
 *
 * `src/app/api/mcp/route.ts` sets `API_BASE = 'https://sourcelibrary.org/api'`,
 * hardcoded. So an MCP tool running on a preview deploy executes the preview's
 * *tool* code but calls **production's** REST API underneath.
 *
 * The practical consequence, learned the confusing way: a change inside the MCP
 * route (say the get_quote continuity flags) shows up on a preview immediately,
 * while a change to a downstream route (say search ranking in
 * /api/books/library) does not show up here until it is merged — the preview's
 * MCP is still asking production. If a row fails on a preview but its
 * equivalent passes in scripts/audit/greek-name-search.mjs (which calls the
 * REST API directly on whatever host you gave it), that is this, not a
 * regression.
 */

const BASE = (process.argv[2] || 'https://sourcelibrary.org').replace(/\/$/, '');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; SourceLibrary-Scenarios/1.0)' };

async function tool(name, args) {
  const r = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = JSON.parse((t.split('\n').find((l) => l.startsWith('data:')) || 'data:{}').slice(5)); }
  const txt = b?.result?.content?.[0]?.text;
  try { return JSON.parse(txt); } catch { return { __raw: txt }; }
}

const rows = [];
const scenario = (state, name, ok, detail) => {
  rows.push({ state, name, ok });
  const tag = state === 'OPEN' ? (ok ? 'FIXED?' : 'open  ') : (ok ? 'PASS  ' : 'FAIL  ');
  console.log(`${tag} [${state}] ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── Reported: "list_books(search='Aristotle') returned The Faerie Queene,
//    Hooke's Posthumous Works, Della Porta's Magia Naturalis among the top 40.
//    This looks like a straightforward bug." (#3653 item 7)
{
  const r = await tool('list_books', { search: 'Aristotle', limit: 10 });
  const books = r.books || [];
  const rel = books.filter((b) => /aristot/i.test(`${b.title || ''} ${b.author || ''}`)).length;
  scenario('FIXED', 'list_books("Aristotle") returns Aristotle', rel >= 8, `${rel}/${books.length} relevant, #1 "${(books[0]?.title || '').slice(0, 34)}"`);
}

// ── Reported: "I found the Poetics passage by noticing Bekker vol. 2's scan
//    pages map onto Bekker numbers, deriving page ≈ 310 + (Bekker − 1094), and
//    guessing." The Bekker volume was hard to surface at all. (#3653 item 3)
{
  const r = await tool('list_books', { search: 'Aristotelis Opera', limit: 20 });
  const idx = (r.books || []).findIndex((b) => /bekker|opera/i.test(b.title || ''));
  scenario('FIXED', 'the Bekker/Opera volumes surface on the first page', idx >= 0 && idx < 10, idx >= 0 ? `rank #${idx + 1}` : 'not in top 20');
}

// ── Reported: "Two key findings were split across a page break: 'the prudent
//    man pursues a free-' / '-dom from pain'. I nearly missed both." (#3653 item 4)
{
  const q = await tool('get_quote', { book_id: '6a6be1c4b7e35edd8ad0421f', page: 46 });
  scenario('FIXED', 'a page breaking mid-word says so', q?.continuity?.hyphen_split_at_end === true, q?.continuity_hint ? 'hint present' : 'no hint');
}

// ── Reported: "translation_percent is inconsistent with pages_translated ... I
//    could not use it to decide whether a book was worth opening." (#3652 B)
{
  const r = await tool('list_books', { search: 'Aristotle', limit: 20 });
  const vals = (r.books || []).map((b) => b.translation_percent);
  const sane = vals.every((v) => typeof v === 'number' && v >= 0 && v <= 100);
  const informative = vals.filter((v) => v > 0).length;
  scenario('FIXED', 'translation_percent is usable for triage', sane && informative > 0, `${informative}/${vals.length} non-zero, all within 0–100`);
}

// ── NEW: can a classicist find a Greek author by their Greek name?
{
  for (const [q, expect] of [['Πλάτων', /plato/i], ['πλατων', /plato/i], ['Γαληνός', /galen/i]]) {
    const r = await tool('list_books', { search: q, limit: 5 });
    const hit = (r.books || []).some((b) => expect.test(`${b.author || ''} ${b.title || ''}`));
    scenario('FIXED', `search in Greek: ${q}`, hit, `${(r.books || []).length} results`);
  }
}

// ── Reported: "which book has the Poetics?" is unanswerable from metadata,
//    because four volumes advertise it and none contain it. (#3653 items 1-2,
//    #3652 A)
//
//    Deliberately NOT "does a search for Poetics return something titled
//    Poetics" — it does, and that is the very thing that misled the reporter.
//    The question is whether a record says WHICH PAGES hold the work.
{
  const BEKKER = '69937973b0a84a5763964d43'; // the volume that actually holds it
  const detail = await tool('get_book', { book_id: BEKKER });
  const cw = detail?.contains_works;
  const works = cw?.works || [];
  const poetics = works.find((w) => /ΠΟΙΗΤΙΚ/i.test(w.header || ''));
  scenario('FIXED', 'contains_works — which pages actually hold the Poetics',
    Boolean(poetics),
    poetics ? `ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ pp.${poetics.first_page}-${poetics.last_page}, ${works.length} works listed`
            : `no contains_works (${cw?.status || 'absent'})`);
}

// ── Reported: "Every semantic search on a 400+ page book returned ~45 pages of
//    front matter at match_count 6-12, with real hits buried ... one Politics
//    search put the passage I needed at result #52." (#3653 item 3)
//
//    The book is the one the reporter NAMED — the Taylor 1801 Metaphysics,
//    whose introduction runs to scan page ~64. An earlier version of this check
//    used the Bekker volume and counted "hits before page 60" as front matter.
//    That was wrong twice over: Bekker's body starts on scan page 7 and it has
//    no front matter at all, so the check reported a failure that did not exist
//    and would have justified burying 50+ pages of genuine Aristotle. Assert on
//    the flag the server returns, never on page position.
{
  const r = await tool('search_within_book', { book_id: '69d14a6c1c2a66dc094b41b2', query: 'being qua being and substance', limit: 12 });
  const hits = r.results || [];
  const firstFront = hits.findIndex((h) => h.is_front_matter);
  const frontCount = hits.filter((h) => h.is_front_matter).length;
  // Front matter must be ORDERED LAST, not removed: a reader asking what the
  // translator said about his own method is asking a real question.
  const ordered = firstFront === -1 || hits.slice(firstFront).every((h) => h.is_front_matter);
  scenario('FIXED', 'search_within_book puts front matter last', ordered,
    `${frontCount}/${hits.length} flagged, ${firstFront === -1 ? 'none present' : `first at position ${firstFront + 1}`}`);
}

const fixed = rows.filter((r) => r.state === 'FIXED');
const open = rows.filter((r) => r.state === 'OPEN');
console.log(`\nfixed scenarios passing: ${fixed.filter((r) => r.ok).length}/${fixed.length}`);
console.log(`known-open scenarios still open: ${open.filter((r) => !r.ok).length}/${open.length}`);
if (fixed.some((r) => !r.ok)) { console.log('\nREGRESSION — a scenario that was fixed has broken.'); process.exit(1); }
