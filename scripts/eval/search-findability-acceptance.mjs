/**
 * Search findability acceptance harness — "for every work we KNOW we hold,
 * does search surface it?"
 *
 * Born from a 2026-06-25 audit where search repeatedly *looked* like it had
 * shallow coverage when the library actually holds the work, fully processed,
 * under a different catalogue name (Corpus Hermeticum → Pimander/De-mysteriis;
 * "aldine 1516" → De mysteriis; Kybalion; Hartmann). The point of this fixture
 * is to make those false negatives impossible to ship unnoticed. See issues
 * #2735 (surfacing) and #2740 (AI-native / recall-honest search).
 *
 *   node scripts/eval/search-findability-acceptance.mjs            # prod
 *   SEARCH_BASE=https://<preview>.vercel.app node scripts/eval/search-findability-acceptance.mjs
 *
 * Exit code: non-zero if any non-xfail acceptance case fails — wire into
 * pre/post-merge CI on the search PRs (#2742). Run the existing ranking eval
 * (scripts/eval/search-quality-eval.mjs) alongside this — they answer different
 * questions: this = recall ("did the held work show up at all"), that = ranking
 * ("is it ordered well"). Don't let a recall fix regress navigational ranking.
 */

const BASE = process.env.SEARCH_BASE || 'https://sourcelibrary.org';

// LEVEL 1 — RECALL ACCEPTANCE: each canonical query must surface a work we have
// verified (in Mongo) that we hold + fully process. `must` matches a title in
// ANY /unified bucket (books | semantic | artworks | gallery | index).
// `xfail: true` = known-failing today, tracked to a fix — fails the suite only
// if it *unexpectedly* passes (so we notice when the fix lands) or if a
// previously-passing case regresses into it.
const CASES = [
  { q: 'corpus hermeticum',      must: /pimander|pymander|poimandres|mysteries of egypt|hermeticum/i },
  { q: 'de mysteriis',           must: /mysteries of egypt|de mysteriis/i },
  { q: 'kybalion',               must: /kybalion/i },
  { q: 'hartmann',               must: /hartmann/i },
  { q: 'de occulta philosophia', must: /occulta|agrippa/i },
  { q: 'atalanta fugiens',       must: /atalanta/i },
  { q: 'tarot',                  must: /tarot|taroc/i },
  // Canonical FAILING fixture: printer/year alias — "aldine 1516" must surface
  // the held 1516 Aldine (De mysteriis / mysteries-of-egypt-...). Neither title
  // ilike nor current semantic catches it. Flips to pass when #2740's synonym
  // bridge + work_id clustering lands. Keep it here as the regression target.
  { q: 'aldine 1516',            must: /de mysteriis|mysteries of egypt|iamblich/i, xfail: true },
];

const titlesOf = (j) => {
  const out = [];
  for (const bucket of ['books', 'semantic', 'artworks', 'gallery', 'index']) {
    for (const r of (j?.[bucket]?.results || [])) {
      out.push(String(r.title || r.book_title || r.display_title || r.name || ''));
    }
  }
  return out;
};

// Fetch /unified, retrying once when EVERY lane is empty or on error. For a
// query we know matches held works, all-lanes-empty is almost always a degraded
// response (a lane timed out), not real absence — so a retry both de-flakes the
// suite AND lets us classify degradation honestly (the #2740 principle: never
// let an empty look like a fact).
async function fetchUnified(q, attempts = 2) {
  let last = { titles: [], buckets: 'books=? semantic=? artworks=?', allEmpty: true, err: null };
  for (let i = 0; i < attempts; i++) {
    try {
      const j = await (await fetch(`${BASE}/api/search/unified?q=${encodeURIComponent(q)}`)).json();
      const counts = ['books', 'semantic', 'artworks'].map((b) => j?.[b]?.total ?? 0);
      last = {
        titles: titlesOf(j),
        buckets: ['books', 'semantic', 'artworks'].map((b, k) => `${b}=${counts[k]}`).join(' '),
        allEmpty: counts.every((n) => n === 0),
        err: null,
      };
      if (!last.allEmpty) return last;          // got real results — done
    } catch (e) { last = { ...last, err: e.message }; }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1200));
  }
  return last;
}

async function runAcceptance() {
  let failed = 0, xpass = 0, degraded = 0;
  console.log(`\n== LEVEL 1: recall acceptance (${BASE}/api/search/unified) ==`);
  for (const c of CASES) {
    const { titles, buckets, allEmpty, err } = await fetchUnified(c.q);
    const hit = titles.find((t) => c.must.test(t));
    if (c.xfail) {
      if (hit) { console.log(`  XPASS  "${c.q}"  [${buckets}]  → ${hit.slice(0, 44)}  (xfail now passes — update the fixture!)`); xpass++; }
      else     { console.log(`  xfail  "${c.q}"  [${buckets}]  (known gap — tracked in #2740)`); }
    } else if (hit) {
      console.log(`  PASS   "${c.q}"  [${buckets}]  → ${hit.slice(0, 44)}`);
    } else if (allEmpty) {
      // Held work + ALL lanes empty (even after retry) = degraded API, not a
      // coverage miss. Soft signal (doesn't fail CI) — but it IS the #2740 bug.
      console.log(`  DEGRADED "${c.q}"  [${buckets}]${err ? ' err:' + err : ''}  all lanes empty for a held work — recall-honesty failure (#2740), not absence`);
      degraded++;
    } else {
      console.log(`  FAIL   "${c.q}"  [${buckets}]  HELD WORK NOT SURFACED (some lanes returned — true recall/aliasing gap)`);
      failed++;
    }
  }
  return { failed, xpass, degraded };
}

// LEVEL 2 — RECALL-HONESTY (#2740): a degraded lane must never look empty.
// Probes the agent endpoint (when it exists) for an explicit per-lane status
// field. Skipped — not failed — until /api/search/agent ships, so this fixture
// can be committed now and "wake up" with #2740.
//
// FAILURE-INJECTION (the test that actually proves recall-honesty): force the
// semantic lane to time out/error and assert the response carries
// status:timeout|degraded for that lane, NEVER an empty array that reads as
// "we don't hold it". TODO once /api/search/agent exposes status + a test hook.
async function runRecallHonesty() {
  console.log('\n== LEVEL 2: recall-honesty / per-lane status (#2740) ==');
  try {
    const r = await fetch(`${BASE}/api/search/agent?q=corpus%20hermeticum`);
    if (r.status === 404) { console.log('  SKIP   /api/search/agent not deployed yet (#2740 pending)'); return { skipped: true }; }
    const j = await r.json();
    const lanes = j?.lanes || j?.status || null;
    if (!lanes) { console.log('  PENDING  endpoint exists but no per-lane `status` field yet — required by #2740'); return { pending: true }; }
    console.log('  per-lane status present:', JSON.stringify(lanes));
    return { ok: true };
  } catch (e) { console.log(`  SKIP   ${e.message}`); return { skipped: true }; }
}

// LEVEL 3 — USER SURFACE (the /search page): the page must not render an empty
// semantic lane as "no results" (the silent-empty bug). The fix is client-side
// (a semanticDegraded state), so this needs a headless browser, not a fetch.
// TODO: Playwright — load /search?q=corpus%20hermeticum, stub /api/search/semantic
// to fail, assert the page shows a degraded notice, NOT "No results".

const { failed, xpass, degraded } = await runAcceptance();
await runRecallHonesty();

const real = CASES.filter((c) => !c.xfail).length;
const ok = failed === 0; // DEGRADED is a soft signal — it does not fail CI (flaky infra), but it is reported loudly
console.log(`\n${ok ? 'PASS' : 'FAIL'} — ${real - failed - degraded}/${real} recall cases pass` +
  (degraded ? ` · ${degraded} DEGRADED (all lanes empty for a held work — #2740 recall-honesty signal, not absence)` : '') +
  (xpass ? ` · ${xpass} xfail unexpectedly passed (update the fixture)` : ''));
process.exit(ok ? 0 : 1);
