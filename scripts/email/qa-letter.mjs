/**
 * Pre-send QA for a newsletter body: the checks that past letters failed.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/email/qa-letter.mjs scripts/email/<letter>.body.html
 *
 * Exit 1 on any FAIL. WARNs are for the author to judge. The last section lists
 * every destination to open BY EYE in a signed-out browser, because a script on
 * the laptop cannot see what a reader sees: Cloudflare challenges it, and the
 * terms card and the metered reader only show to a real, signed-out browser.
 *
 * Where each check comes from (.claude/skills/send-newsletter/SKILL.md has the list):
 * - Preview line: the Nov 2026 letter set none, so inboxes previewed "Leer en español →".
 * - Book-page links past the free sample: the Nov 2026 Drebbel link (page 62 of 69)
 *   showed signed-out readers the scan with no English for the first hours.
 * - *.vercel.app links: the Spanish link still pointed at a retired standalone page.
 * - Bare URLs, more than three destinations, a P.S. with no link: the Nov 2026 letter.
 * - Numbers: corpus counts drift between draft and send (19,420 → 22,069, Aug 2026).
 *
 * Needs MONGODB_URI only for the free-sample check; without it that check is skipped
 * with a WARN, never silently passed.
 */
import { readFileSync } from 'node:fs';

const bodyPath = process.argv[2];
if (!bodyPath) {
  console.error('Usage: qa-letter.mjs <body.html>');
  process.exit(1);
}
const raw = readFileSync(bodyPath, 'utf8');
const header = (raw.match(/^\s*<!--([\s\S]*?)-->/) || [, ''])[1];
const body = raw.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
const field = (name) => (header.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'mi')) || [, ''])[1].trim();

const results = [];
const fail = (msg) => results.push(['FAIL', msg]);
const warn = (msg) => results.push(['WARN', msg]);
const ok = (msg) => results.push(['ok', msg]);

const visible = body
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&rarr;/g, '→').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

// --- Inbox view: subject and preview line ---------------------------------
const subject = field('Subject');
const preview = field('Preview');
if (!subject) fail('No "Subject:" line in the header comment.');
else {
  if (subject.length > 60) warn(`Subject is ${subject.length} characters; phones cut it near 40–60.`);
  if (/^(new|update|news(letter)?)\b/i.test(subject)) warn(`Subject opens with "${subject.split(' ')[0]}": say what the reader gets, not that something is new.`);
  ok(`Subject: ${subject}`);
}
if (!preview) {
  fail(`No "Preview:" line. Without one the inbox shows the first words of the body: "${visible.slice(0, 80)}…"`);
} else {
  if (preview.length < 35 || preview.length > 110) warn(`Preview is ${preview.length} characters; aim for 40–100.`);
  ok(`Preview: ${preview}`);
}

// --- Links -----------------------------------------------------------------
const hrefs = [...body.matchAll(/href=(["'])(.*?)\1/gi)].map((m) => m[2].replace(/&amp;/g, '&'));
const dest = [...new Set(hrefs.filter((h) => /^https?:/i.test(h)).map((h) => h.split('#')[0]))];

for (const h of dest) {
  if (/\.vercel\.app/i.test(h)) fail(`Link to a *.vercel.app host: ${h}. Point it at sourcelibrary.org.`);
  if (/^http:\/\//i.test(h)) warn(`Plain http link: ${h}`);
}
if (dest.length > 3) warn(`${dest.length} distinct destinations. One main action, one secondary, works better than several.`);

const bare = visible.match(/https?:\/\/\S+/g) || [];
if (bare.length) warn(`${bare.length} bare URL(s) shown as text (${bare.slice(0, 2).join(', ')}…). Link words instead.`);

const ps = visible.match(/\bP\.?\s?S\.?[\s:][\s\S]*$/);
if (ps) {
  const psHtml = body.slice(body.search(/P\.?\s?S\.?[\s:]/));
  if (!/href=/i.test(psHtml)) warn('The P.S. has no link. It is one of the most-read lines: give it something to do, or cut it.');
}

for (const m of body.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
  if (/espa(ñ|&ntilde;|n)ol/i.test(m[3]) && !/sourcelibrary\.org/i.test(m[2])) {
    fail(`The Spanish link goes to ${m[2]}, not sourcelibrary.org.`);
  }
}

// --- Images ----------------------------------------------------------------
for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
  const tag = m[0];
  const src = (tag.match(/src=(["'])(.*?)\1/i) || [, , ''])[2];
  if (!/^https:\/\//i.test(src)) fail(`Image src is not an absolute https URL: ${src || '(none)'}`);
  if (!/\balt=(["']).+?\1/i.test(tag)) warn(`Image without alt text: ${src}`);
}

// --- Numbers to re-measure -------------------------------------------------
const numbers = [...new Set(visible.match(/\b\d{1,3}(?:[,.]\d{3})+\b|\b\d{4,}\b/g) || [])]
  .filter((n) => !/^(1[4-9]|20)\d\d$/.test(n)); // years are not counts
if (numbers.length) warn(`Re-measure on send day: ${numbers.join(', ')}`);

// --- Book-page links past the free sample (metered reader, #4357) ----------
const bookLinks = dest
  .map((h) => h.match(/^https?:\/\/(?:www\.)?sourcelibrary\.org\/book\/([^/?#]+)\/page\/([^/?#]+)/i))
  .filter(Boolean);
if (bookLinks.length && !process.env.MONGODB_URI) {
  warn('MONGODB_URI not set: book-page links were NOT checked against the free sample.');
} else if (bookLinks.length) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db('bookstore');
    for (const [url, bookKey, pageKey] of bookLinks) {
      const book = await db.collection('books').findOne(
        { $or: [{ id: bookKey }, { slug: bookKey }] },
        { projection: { id: 1, pages_count: 1, visible: 1 } },
      );
      if (!book) { fail(`Book not found for ${url}`); continue; }
      if (book.visible === false) fail(`Book is hidden: ${url}`);
      const { ObjectId } = await import('mongodb');
      const pageQuery = /^\d+$/.test(pageKey)
        ? { book_id: book.id, page_number: Number(pageKey) }
        : ObjectId.isValid(pageKey) ? { _id: new ObjectId(pageKey) } : { id: pageKey };
      const page = await db.collection('pages').findOne(pageQuery, {
        projection: { page_number: 1, seo_indexable: 1, 'translation.data': 1 },
      });
      if (!page) { fail(`Page not found for ${url}`); continue; }
      const freeMax = Math.max(1, Math.floor((book.pages_count || 0) * 0.2));
      const free = page.seo_indexable === true || page.page_number == null || page.page_number <= freeMax;
      if (!free) {
        fail(`${url} is page ${page.page_number} of ${book.pages_count}; signed-out readers get pages 1–${freeMax} and see no English here. Link a free page, or flag the passage (seo_indexable) and purge it.`);
      } else ok(`Free to signed-out readers: ${url}`);
      if (!page.translation?.data) warn(`No English translation on ${url}`);
    }
  } finally {
    await client.close();
  }
}

// --- Report ----------------------------------------------------------------
for (const [level, msg] of results) console.log(`${level.padEnd(4)}  ${msg}`);
console.log('\nOpen BY EYE in a signed-out browser (an isolated/incognito window), on a phone if you can:');
for (const h of dest) console.log(`  - ${h}`);
console.log('  A deep link opened from a mail app first shows the terms card ("Welcome, reader"); check the page behind it too.');
const fails = results.filter(([l]) => l === 'FAIL').length;
console.log(`\n${fails} FAIL, ${results.filter(([l]) => l === 'WARN').length} WARN`);
process.exit(fails ? 1 : 0);
