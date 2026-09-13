#!/usr/bin/env node
// PRIOR ART: scripts/audit/greek-name-search.mjs — same shape (a probe term that must return a
// known record, run against the live search surface, exit 1 on miss), but its subject is Greek
// name folding in the `books_search` Atlas index and it queries that index directly. This one
// tests the ARTWORK lanes, which cannot use `books_search` at all: that index filters
// `pages_count > 0` and every artwork has 0 pages, so artwork search is a regex lane over
// `books`. No other audit covers artwork inscriptions.
/**
 * artwork-inscription-search.mjs — can a reader find an artwork by the words written on it?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `enrichment.inscriptions` holds text transcribed off the artwork itself (the caption
 * engraved under a Sadeler view, the Latin titulature around a portrait). 8,304 visible
 * artworks carry some. It renders in `ArtworkInfo`, and until 2026-09-14 it was matched by
 * no query at all — measured live: "hypotyposin" returned an anatomy plate and two copies of
 * Progymnasmata, while the engraving whose caption contains the word sat unreturned.
 *
 * ── The probes ─────────────────────────────────────────────────────────────
 * Each probe word was verified to occur ONLY in `enrichment.inscriptions` — not in the title,
 * display_title, description, museum_description or enrichment.subject of its artwork. So a
 * hit can only come from the inscription lane.
 *
 * ── The positive control is the point ──────────────────────────────────────
 * A "not found" is worthless until the same harness returns "found" for something that must
 * match (lesson: a probe needs a positive control). CONTROL searches a title phrase; if the
 * control fails, the search surface is down or the shape changed, and the probe results say
 * nothing about inscriptions.
 *
 * Usage:
 *   node scripts/audit/artwork-inscription-search.mjs                    # live production
 *   node scripts/audit/artwork-inscription-search.mjs --base http://localhost:3000
 */

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'https://sourcelibrary.org');

/** Each probe: a word found only in an inscription, and a fragment of the title it must return. */
const PROBES = [
  { term: 'hypotyposin', expect: 'vladislav', what: "Sadeler's engraved caption, Vladislav Hall" },
  { term: 'BETTHLEMFAVVA', expect: 'thurz', what: 'the titulature around the Thurzó portrait' },
];
const CONTROL = { term: 'Vladislav Hall', expect: 'vladislav', what: 'a plain title match' };

async function search(term) {
  const url = `${BASE}/api/gallery?q=${encodeURIComponent(term)}&limit=40&_v=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const items = body.items || body.results || [];
  return items.map(i => `${i.bookTitle || ''} ${i.description || ''}`.toLowerCase());
}

const hit = (rows, expect) => rows.some(r => r.includes(expect.toLowerCase()));

let failures = 0;

try {
  const controlRows = await search(CONTROL.term);
  if (!hit(controlRows, CONTROL.expect)) {
    console.log(`CONTROL FAILED — "${CONTROL.term}" (${CONTROL.what}) returned ${controlRows.length} items, none matching "${CONTROL.expect}".`);
    console.log('The search surface is not answering as expected; probe results below would be meaningless. Not testing inscriptions.');
    process.exit(1);
  }
  console.log(`control ok       "${CONTROL.term}" → ${controlRows.length} items, expected title present`);

  for (const p of PROBES) {
    const rows = await search(p.term);
    const ok = hit(rows, p.expect);
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}             "${p.term}" (${p.what}) → ${rows.length} items, "${p.expect}" ${ok ? 'present' : 'ABSENT'}`);
  }
} catch (err) {
  console.log(`ERROR — ${err.message}`);
  process.exit(1);
}

if (failures) {
  console.log(`\n${failures}/${PROBES.length} inscription probes failed: the words written on an artwork do not find it.`);
  process.exit(1);
}
console.log(`\nAll ${PROBES.length} inscription probes passed against ${BASE}.`);
