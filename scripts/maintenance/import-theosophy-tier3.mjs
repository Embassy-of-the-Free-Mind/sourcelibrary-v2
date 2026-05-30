#!/usr/bin/env node
/**
 * Import batch — "Theosophy & the Wisdom Traditions", Tier 3 (gap-fill + widen)
 *
 * Sourced from the Campbell Theosophical Research Library gap report
 * (.claude/docs/theosophical-import/campbell-gap-report.md), which diffed the
 * AUSTHEOS index of online theosophical texts against the SL catalog. These are
 * verified gaps — confirmed absent in SL and present as scans on IA.
 *
 * Two groups:
 *   - GAPS: notable works by authors we already hold (high confidence)
 *   - WIDEN: notable works by authors SL had nothing by
 *
 * Auth via CRON_SECRET bearer (import routes require editor+). Additive, hidden,
 * reversible via /api/books/restore/[id]. Fingerprint dedup → 409 = skip.
 */

const BASE = process.env.SL_BASE || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) { console.error('Missing CRON_SECRET — source .env.production.local first.'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${CRON_SECRET}` };

const BOOKS = [
  // ---- GAPS (authors we already hold) ----
  { ia_identifier: 'theosophic-correspondence', title: 'Theosophic Correspondence (with Kirchberger)', author: 'Louis-Claude de Saint-Martin', year: 1792, original_language: 'English' },
  { ia_identifier: 'idyllofwhitelotu00colliala', title: 'The Idyll of the White Lotus', author: 'Mabel Collins', year: 1890, original_language: 'English' },
  { ia_identifier: 'throughgatesofgo00coll', title: 'Through the Gates of Gold: A Fragment of Thought', author: 'Mabel Collins', year: 1890, original_language: 'English' },
  { ia_identifier: 'in.ernet.dli.2015.201929', title: 'An Outline of Occult Science', author: 'Rudolf Steiner', year: 1914, original_language: 'English' },
  { ia_identifier: 'outlineofvedanta00deus', title: 'Outline of the Vedanta System of Philosophy according to Shankara', author: 'Paul Deussen', year: 1906, original_language: 'English' },
  { ia_identifier: 'elementarytheoso00rogerich', title: 'Elementary Theosophy', author: 'L. W. Rogers', year: 1917, original_language: 'English' },
  { ia_identifier: 'theosophicalmove00unse', title: 'The Theosophical Movement 1875–1925: A History and a Survey', author: 'Anonymous', year: 1925, original_language: 'English' },
  { ia_identifier: 'gnosticjohnbapti00mead', title: 'The Gnostic John the Baptizer: Selections from the Mandæan John-Book', author: 'G. R. S. Mead', year: 1924, original_language: 'English' },
  { ia_identifier: 'manfragmentsfor00socigoog', title: 'Man: Fragments of Forgotten History', author: 'Two Chelas (Mohini Chatterji & Laura C. Holloway)', year: 1885, original_language: 'English' },
  // ---- WIDEN (authors SL had nothing by) ----
  { ia_identifier: 'lightofasiaorgre00arnouoft', title: 'The Light of Asia; or, The Great Renunciation', author: 'Edwin Arnold', year: 1879, original_language: 'English' },
  { ia_identifier: 'ult.ancientegyptligh0000gera_v7d9vol1', title: 'Ancient Egypt: The Light of the World — Vol. I', author: 'Gerald Massey', year: 1907, original_language: 'English' },
  { ia_identifier: 'clothedwithsunbe00king', title: 'Clothed with the Sun: Being the Book of the Illuminations of Anna Bonus Kingsford', author: 'Anna Bonus Kingsford', year: 1889, original_language: 'English' },
  { ia_identifier: 'theoccultworld00sinn', title: 'The Occult World', author: 'A. P. Sinnett', year: 1883, original_language: 'English' },
  { ia_identifier: 'dli.ernet.237113', title: 'First Principles of Theosophy', author: 'C. Jinarajadasa', year: 1928, original_language: 'English' },
];

async function importWithRetry(book) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res, text;
    try {
      res = await fetch(`${BASE}/api/import/ia`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: JSON.stringify(book) });
      text = await res.text();
    } catch (e) {
      if (attempt === 4) return { ok: false, status: 0, text: String(e) };
      await new Promise((r) => setTimeout(r, 10000)); continue;
    }
    if (res.ok || res.status === 409) return { ok: res.ok, status: res.status, text };
    const transient = res.status >= 500 && /Timeout|timed out|fetch failed/i.test(text);
    if (!transient || attempt === 4) return { ok: false, status: res.status, text };
    await new Promise((r) => setTimeout(r, 10000));
  }
}

const results = [];
for (const book of BOOKS) {
  const r = await importWithRetry(book);
  const tag = r.status === 409 ? 'EXISTS' : r.ok ? 'OK' : `FAIL(${r.status})`;
  console.log(`[${tag}] ${book.ia_identifier} — ${book.title.slice(0, 50)}`);
  if (!r.ok && r.status !== 409) console.log(`        ${r.text.slice(0, 180)}`);
  results.push({ id: book.ia_identifier, tag });
}
const ok = results.filter((r) => r.tag === 'OK').length;
const exists = results.filter((r) => r.tag === 'EXISTS').length;
const fail = results.filter((r) => r.tag.startsWith('FAIL')).length;
console.log(`\nSummary: ${ok} imported, ${exists} already existed, ${fail} failed (of ${BOOKS.length}).`);
