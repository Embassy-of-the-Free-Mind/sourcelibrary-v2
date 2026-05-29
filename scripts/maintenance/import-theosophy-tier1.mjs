#!/usr/bin/env node
/**
 * Import batch — "Theosophy & the Wisdom Traditions", Tier 1
 *
 * Seeded by Reinout Spaink's Campbell Theosophical Research Library directory
 * (raw pages saved at .claude/docs/theosophical-import/). Reinout flagged the
 * AUSTHEOS "Links to Theosophical Texts Online" index — now dead on the live web,
 * surviving only via the Wayback Machine — as a high-value map of the wisdom
 * traditions. The importable layer it points at is the Internet Archive corpus.
 *
 * Tier 1 = Early Classics overlapping Source Library's core mission
 * (Hermetica / Gnostic / Kabbalah primaries), scanned public-domain originals.
 *
 * Deduped 2026-05-29 against the live collection. Already held (skipped):
 *   - Ficino 1481 Pimander (bib_fict_4102599)
 *   - Mead, Thrice-Greatest Hermes vols I-III (thricegreatesthe0{1,2,3}hermuoft)
 *   - Mead, Fragments of a Faith Forgotten (fragmentsoffaith00meaduoft)
 *
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
  // ---- Hermetica ----
  {
    ia_identifier: 'b30329619',
    title: 'The Divine Pymander of Hermes Mercurius Trismegistus, in XVII Books',
    author: 'Hermes Trismegistus (trans. John Everard)',
    year: 1650,
    original_language: 'English',
    note: 'Major 17th-c English translation of the Corpus Hermeticum — primary edition.',
  },
  {
    ia_identifier: 'hymnshermes00hermgoog',
    title: 'The Hymns of Hermes',
    author: 'G. R. S. Mead',
    year: 1907,
    original_language: 'English',
    note: 'Mead\'s edition of the Hermetic hymns; companion to Thrice-Greatest Hermes.',
  },
  // ---- Gnostic (public-domain Mead-era editions) ----
  {
    ia_identifier: 'pistissophiagnos00mead',
    title: 'Pistis Sophia: A Gnostic Gospel',
    author: 'G. R. S. Mead',
    year: 1896,
    original_language: 'English',
    note: 'Foundational Gnostic primary text — Mead\'s first English translation (1896).',
  },
  // ---- Kabbalah ----
  {
    ia_identifier: 'bub_gb_oDUgg6Xh8LgC',
    title: 'Kabbala Denudata seu Doctrina Hebraeorum Transcendentalis et Metaphysica',
    author: 'Christian Knorr von Rosenroth',
    year: 1677,
    original_language: 'Latin',
    work_id: 'knorr-kabbala-denudata',
    note: 'THE early-modern Christian Kabbalah primary; source for later Zohar translations.',
  },
  {
    ia_identifier: 'b24884443',
    title: 'The Kabbalah Unveiled, Containing the Following Books of the Zohar',
    author: 'S. L. MacGregor Mathers',
    year: 1887,
    original_language: 'English',
    work_id: 'knorr-kabbala-denudata',
    note: 'English translation of Zohar excerpts drawn from Knorr\'s Kabbala Denudata.',
  },
  {
    ia_identifier: 'cu31924075115380',
    title: 'The Kabbalah: Its Doctrines, Development, and Literature',
    author: 'Christian D. Ginsburg',
    year: 1865,
    original_language: 'English',
    note: 'FLAG: 19th-c scholarly study (secondary), kept for its survey value; lower fit.',
  },
];

async function importWithRetry(book) {
  const { note, ...payload } = book;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res, text;
    try {
      res = await fetch(`${BASE}/api/import/ia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH },
        body: JSON.stringify(payload),
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
  console.log(`[${tag}] ${book.ia_identifier} — ${book.title}`);
  if (!r.ok && r.status !== 409) console.log(`        ${r.text.slice(0, 200)}`);
  results.push({ id: book.ia_identifier, tag });
}

const ok = results.filter((r) => r.tag === 'OK').length;
const exists = results.filter((r) => r.tag === 'EXISTS').length;
const fail = results.filter((r) => r.tag.startsWith('FAIL')).length;
console.log(`\nSummary: ${ok} imported, ${exists} already existed, ${fail} failed (of ${BOOKS.length}).`);
