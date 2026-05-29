#!/usr/bin/env node
/**
 * Import batch — "Theosophy & the Wisdom Traditions", Tier 2
 *
 * The public-domain Blavatsky / Theosophical Society canon. Follows the Tier 1
 * Early-Classics batch (see import-theosophy-tier1.mjs and
 * .claude/docs/theosophical-import/), both seeded by Reinout Spaink's pointer
 * to the (now-dead) AUSTHEOS Campbell Theosophical Research Library index.
 *
 * Prefers first editions / clean uoft+Cornell scans. Dedup is enforced at the
 * import endpoint (fingerprint → HTTP 409); the ?ia_identifier= audit filter is
 * unreliable, so we just attempt all and treat 409 as "already held."
 *
 * Auth: /api/import/* requires editor+; we use the CRON_SECRET bearer bypass.
 * Imports are additive and start hidden; reversible via /api/books/restore/[id].
 */

const BASE = process.env.SL_BASE || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('Missing CRON_SECRET — source .env.production.local first.');
  process.exit(1);
}
const AUTH = { Authorization: `Bearer ${CRON_SECRET}` };

const BOOKS = [
  // ---- H. P. Blavatsky ----
  { ia_identifier: 'secretdoctrinesy01blav', title: 'The Secret Doctrine: The Synthesis of Science, Religion, and Philosophy — Vol. I (Cosmogenesis)', author: 'H. P. Blavatsky', year: 1888, original_language: 'English', work_id: 'blavatsky-secret-doctrine' },
  { ia_identifier: 'secretdoctrinesy02blav', title: 'The Secret Doctrine: The Synthesis of Science, Religion, and Philosophy — Vol. II (Anthropogenesis)', author: 'H. P. Blavatsky', year: 1888, original_language: 'English', work_id: 'blavatsky-secret-doctrine' },
  { ia_identifier: 'cu31924092304579', title: 'Isis Unveiled: A Master-Key to the Mysteries of Ancient and Modern Science and Theology — Vol. I', author: 'H. P. Blavatsky', year: 1877, original_language: 'English', work_id: 'blavatsky-isis-unveiled' },
  { ia_identifier: 'cu31924092304587', title: 'Isis Unveiled: A Master-Key to the Mysteries of Ancient and Modern Science and Theology — Vol. II', author: 'H. P. Blavatsky', year: 1877, original_language: 'English', work_id: 'blavatsky-isis-unveiled' },
  { ia_identifier: 'thekeytotheosoph00blavuoft', title: 'The Key to Theosophy', author: 'H. P. Blavatsky', year: 1889, original_language: 'English' },
  // ---- Henry Steel Olcott ----
  { ia_identifier: 'cu31924029168008', title: 'Old Diary Leaves: The True Story of the Theosophical Society (First Series)', author: 'Henry Steel Olcott', year: 1895, original_language: 'English' },
  // ---- Annie Besant ----
  { ia_identifier: 'esotericchristia00besa', title: 'Esoteric Christianity; or, The Lesser Mysteries', author: 'Annie Besant', year: 1902, original_language: 'English' },
  { ia_identifier: 'ancientwisdomout00besa', title: 'The Ancient Wisdom: An Outline of Theosophical Teachings', author: 'Annie Besant', year: 1897, original_language: 'English' },
  // ---- William Quan Judge ----
  { ia_identifier: 'theoceanoftheo00judguoft', title: 'The Ocean of Theosophy', author: 'William Quan Judge', year: 1893, original_language: 'English' },
  // ---- C. W. Leadbeater ----
  { ia_identifier: 'theastralplane00leaduoft', title: 'The Astral Plane: Its Scenery, Inhabitants, and Phenomena', author: 'C. W. Leadbeater', year: 1900, original_language: 'English' },
  { ia_identifier: 'manvisibleinvis00lead', title: 'Man Visible and Invisible', author: 'C. W. Leadbeater', year: 1903, original_language: 'English' },
];

async function importWithRetry(book) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res, text;
    try {
      res = await fetch(`${BASE}/api/import/ia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH },
        body: JSON.stringify(book),
      });
      text = await res.text();
    } catch (e) {
      if (attempt === 4) return { ok: false, status: 0, text: String(e) };
      await new Promise((r) => setTimeout(r, 10000));
      continue;
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
  console.log(`[${tag}] ${book.ia_identifier} — ${book.title.slice(0, 55)}`);
  if (!r.ok && r.status !== 409) console.log(`        ${r.text.slice(0, 200)}`);
  results.push({ id: book.ia_identifier, tag });
}

const ok = results.filter((r) => r.tag === 'OK').length;
const exists = results.filter((r) => r.tag === 'EXISTS').length;
const fail = results.filter((r) => r.tag.startsWith('FAIL')).length;
console.log(`\nSummary: ${ok} imported, ${exists} already existed, ${fail} failed (of ${BOOKS.length}).`);
