#!/usr/bin/env node
/**
 * Match the curated banned-books dataset against the Atlas catalog.
 *
 * Outputs:
 *   .claude/docs/banned-books-match.json     — structured match data
 *   .claude/docs/banned-books-match.md       — human-readable report
 *
 * DRY RUN by default. Pass --tag to $addToSet 'banned-books' onto matched books'
 * collections arrays and upsert the collection document.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/banned-books-match.mjs
 *   set -a; source .env.production.local; set +a; node scripts/banned-books-match.mjs --tag
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_PATH = join(ROOT, 'data/banned-books/index.json');
const REPORT_JSON = join(ROOT, '.claude/docs/banned-books-match.json');
const REPORT_MD = join(ROOT, '.claude/docs/banned-books-match.md');

const TAG = process.argv.includes('--tag');
const SLUG = 'index-librorum-prohibitorum';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeName(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasesToRegexes(aliases) {
  return aliases.map(a => {
    const n = normalizeName(a);
    return new RegExp(`(^|[^a-z])${escapeRegex(n)}([^a-z]|$)`, 'i');
  });
}

function authorMatchesEntry(book, entry) {
  const authorFields = [book.author, book.author_normalized, book.canonical_author_normalized, book.normalized_author]
    .filter(Boolean)
    .map(s => typeof s === 'string' ? normalizeName(s) : '');
  if (authorFields.length === 0) return false;
  for (const f of authorFields) {
    for (const a of entry._aliasNorm) {
      if (f.includes(a)) {
        return { matched: a };
      }
    }
  }
  return false;
}

const STOP = new Set(['libri','liber','tres','duo','sive','oder','over','aussi','bien','quam','seu','iuxta','est','das','ist','und','von','dans','dell','della','dello','dieci','iuris','generis','prima','seconda','autem','etiam']);

function titleMatchesWork(book, entry) {
  if (!entry.works || entry.works.length === 0 || entry.works[0] === '*') return null;
  const title = normalizeName(book.title || '');
  for (const w of entry.works) {
    // 1) Whole-work substring (strip parens/colons)
    const variants = [
      normalizeName(w),
      normalizeName(w.split('(')[0].trim()),
      normalizeName(w.split(':')[0].trim()),
      normalizeName(w.replace(/\([^)]*\)/g, '').trim()),
    ];
    for (const v of variants) {
      if (v.length >= 6 && title.includes(v)) return w;
    }
    // 2) Distinctive tokens (>= 6 chars, not stopwords) — need ≥2 hits to avoid
    //    one-shared-word false matches like Kant's "Kritik der praktischen Vernunft"
    //    matching the banned "Critik der reinen Vernunft" on "Vernunft" alone.
    //    Single-token match is only allowed if the work title has exactly one token.
    const tokens = normalizeName(w.replace(/\([^)]*\)/g, ' '))
      .split(/\s+/)
      .filter(t => t.length >= 6 && !STOP.has(t));
    let longHits = 0;
    for (const t of tokens) if (title.includes(t)) longHits++;
    if (tokens.length === 1 && longHits >= 1) return w;
    if (longHits >= 2) return w;
    // 3) Two short distinctive tokens (>= 4 chars, not stopwords)
    const short = normalizeName(w.replace(/\([^)]*\)/g, ' '))
      .split(/\s+/)
      .filter(t => t.length >= 4 && !STOP.has(t));
    let hits = 0;
    for (const t of short) if (title.includes(t)) hits++;
    if (hits >= 3) return w;
  }
  return null;
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const entries = dataset.entries
    .filter(e => !e.exclude)
    .map(e => ({
      ...e,
      _aliasNorm: [e.author, ...(e.aliases || [])].map(normalizeName),
    }));

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Build a single $or regex query across all aliases — much faster than per-entry queries
  const allAliases = [...new Set(entries.flatMap(e => [e.author, ...(e.aliases || [])]))];
  const orRegex = allAliases.map(a => ({
    $or: [
      { author: { $regex: escapeRegex(a), $options: 'i' } },
      { author_normalized: { $regex: escapeRegex(normalizeName(a)), $options: 'i' } },
      { canonical_author_normalized: { $regex: escapeRegex(normalizeName(a)), $options: 'i' } },
    ],
  }));

  console.log(`Querying ${allAliases.length} aliases across books collection…`);
  // Exclude non-book resource types: artwork, emblem (extracted illustrations), etc.
  const NON_BOOK_TYPES = ['artwork', 'emblem', 'image', 'illustration', 'manuscript-fragment'];
  const candidates = await books
    .find(
      { $or: orRegex, visible: { $ne: false }, resource_type: { $nin: NON_BOOK_TYPES } },
      { projection: { id: 1, slug: 1, title: 1, author: 1, author_normalized: 1, canonical_author_normalized: 1, year: 1, language: 1, collections: 1, cover_image: 1, thumbnail: 1 } }
    )
    .toArray();
  console.log(`Found ${candidates.length} candidate books to score.`);

  // Bucket candidates per entry
  const matches = new Map(); // entry.author → [{book, work_match, confidence}]
  const allMatchedIds = new Set();      // STRICT — tagged in DB
  const allCandidateIds = new Set();    // ANY author match — for reporting only

  for (const entry of entries) {
    matches.set(entry.author, []);
  }

  for (const book of candidates) {
    for (const entry of entries) {
      const am = authorMatchesEntry(book, entry);
      if (!am) continue;

      let confidence;
      let work_match = null;

      if (entry.scope === 'opera_omnia') {
        // Every work by this author is on the Index — strict tag
        confidence = 'opera_omnia';
        allMatchedIds.add(book._id);
      } else if (entry.scope === 'selected' || entry.scope === 'single_work') {
        work_match = titleMatchesWork(book, entry);
        if (work_match) {
          confidence = 'work+author';
          allMatchedIds.add(book._id);
        } else {
          // Author wrote a banned work but THIS book is something else
          confidence = 'author-only';
        }
      } else {
        confidence = 'author-only';
      }

      allCandidateIds.add(book._id);
      matches.get(entry.author).push({ book, work_match, confidence });
    }
  }

  // Build report
  const report = {
    compiled: new Date().toISOString(),
    total_entries: entries.length,
    total_candidate_books: candidates.length,
    total_books_matched_strict: allMatchedIds.size,
    total_books_author_matched: allCandidateIds.size,
    have: [],
    missing_specific_work: [],
    missing_entirely: [],
  };

  for (const entry of entries) {
    const ms = matches.get(entry.author);
    const strict = ms.filter(m => m.confidence !== 'author-only');
    if (strict.length > 0) {
      report.have.push({
        author: entry.author,
        scope: entry.scope,
        condemned: entry.condemned,
        category: entry.category,
        priority: entry.priority,
        in_scope: entry.in_scope,
        books: strict.map(m => ({
          id: m.book.id || String(m.book._id),
          title: m.book.title,
          author: m.book.author,
          year: m.book.year,
          language: m.book.language,
          confidence: m.confidence,
          work_match: m.work_match,
        })),
        also_in_library_not_banned: ms.filter(m => m.confidence === 'author-only').length,
      });
    } else if (ms.length > 0) {
      // Author present in catalog, but the specific banned work is missing
      report.missing_specific_work.push({
        author: entry.author,
        scope: entry.scope,
        works: entry.works || [],
        condemned: entry.condemned,
        index: entry.index,
        category: entry.category,
        priority: entry.priority,
        in_scope: entry.in_scope,
        notes: entry.notes || '',
        author_books_in_library: ms.length,
        sample_titles: ms.slice(0, 3).map(m => m.book.title),
      });
    } else {
      report.missing_entirely.push({
        author: entry.author,
        scope: entry.scope,
        works: entry.works || [],
        condemned: entry.condemned,
        index: entry.index,
        category: entry.category,
        priority: entry.priority,
        in_scope: entry.in_scope,
        notes: entry.notes || '',
      });
    }
  }

  // Sort
  report.have.sort((a, b) => (a.priority - b.priority) || a.author.localeCompare(b.author));
  const sortByPrio = (a, b) => {
    if (a.in_scope !== b.in_scope) return a.in_scope ? -1 : 1;
    return (a.priority - b.priority) || a.author.localeCompare(b.author);
  };
  report.missing_specific_work.sort(sortByPrio);
  report.missing_entirely.sort(sortByPrio);

  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  // Markdown summary
  let md = `# Banned Books — Source Library Match Report\n\n`;
  md += `_Generated ${new Date().toISOString()}_\n\n`;
  md += `- **Index entries scored:** ${report.total_entries}\n`;
  md += `- **Candidate books fetched:** ${report.total_candidate_books}\n`;
  md += `- **Books matched STRICT (to tag):** ${report.total_books_matched_strict}\n`;
  md += `- **Books matched by author only (NOT tagged):** ${report.total_books_author_matched - report.total_books_matched_strict}\n`;
  md += `- **Authors WE HAVE the banned work for:** ${report.have.length}\n`;
  md += `- **Authors WE HAVE in catalog but MISSING the specific banned work (in-scope):** ${report.missing_specific_work.filter(e => e.in_scope).length}\n`;
  md += `- **Authors COMPLETELY MISSING (in-scope):** ${report.missing_entirely.filter(e => e.in_scope).length}\n`;
  md += `- **Authors COMPLETELY MISSING (out-of-scope):** ${report.missing_entirely.filter(e => !e.in_scope).length}\n\n`;

  md += `## ✓ Have (will be tagged \`banned-books\`)\n\n`;
  for (const h of report.have) {
    md += `### ${h.author} _(${h.scope}, condemned ${h.condemned ?? 'n/a'}, P${h.priority})_\n\n`;
    for (const b of h.books) {
      md += `- **${b.title}** — _${b.author}_ (${b.year ?? '?'}, ${b.language ?? '?'}) [${b.confidence}]${b.work_match ? ` → matched work: _${b.work_match}_` : ''} — \`${b.id}\`\n`;
    }
    if (h.also_in_library_not_banned) {
      md += `\n  _(${h.also_in_library_not_banned} other works by this author are in the library but were not on the Index — not tagged)_\n`;
    }
    md += `\n`;
  }

  md += `## ◐ Have the author but MISSING the specific banned work (in-scope)\n\n`;
  for (const m of report.missing_specific_work.filter(e => e.in_scope)) {
    md += `### ${m.author} _(P${m.priority}, ${m.category})_\n`;
    md += `- Banned work needed: ${m.works.join('; ') || '—'}\n`;
    md += `- Condemned: ${m.condemned ?? '—'} _(${m.index})_\n`;
    md += `- Already in library: ${m.author_books_in_library} other works by this author. Sample: ${m.sample_titles.map(t => `_${t?.slice(0, 50) || '—'}_`).join(', ')}\n`;
    if (m.notes) md += `- ${m.notes}\n`;
    md += `\n`;
  }

  md += `## ✗ Author COMPLETELY MISSING — Acquisition Shortlist (in-scope)\n\n`;
  for (const m of report.missing_entirely.filter(e => e.in_scope)) {
    md += `### ${m.author} _(P${m.priority}, ${m.category})_\n`;
    md += `- Scope: ${m.scope}${m.works.length ? ` — ${m.works.join('; ')}` : ''}\n`;
    md += `- Condemned: ${m.condemned ?? '—'} _(${m.index})_\n`;
    if (m.notes) md += `- ${m.notes}\n`;
    md += `\n`;
  }

  md += `## ✗ Missing — Out-of-scope (lower priority for Source Library)\n\n`;
  for (const m of [...report.missing_specific_work, ...report.missing_entirely].filter(e => !e.in_scope)) {
    md += `- **${m.author}** _(P${m.priority}, ${m.category})_${m.works.length ? ` — ${m.works.join('; ')}` : ''}\n`;
  }

  writeFileSync(REPORT_MD, md);
  console.log(`Wrote: ${REPORT_JSON}`);
  console.log(`Wrote: ${REPORT_MD}`);

  // --tag: actually write to DB
  if (TAG) {
    console.log(`\n--tag flag set — applying writes to DB…`);
    const collections = db.collection('collections');

    if (allMatchedIds.size > 0) {
      const result = await books.updateMany(
        { _id: { $in: [...allMatchedIds] } },
        { $addToSet: { collections: SLUG } }
      );
      console.log(`Tagged ${result.modifiedCount} books with collection '${SLUG}'`);
    }

    // Build featured_images — top books with covers, prioritized by priority
    const featured = [];
    for (const h of report.have) {
      for (const b of h.books) {
        const book = candidates.find(c => (c.id || String(c._id)) === b.id);
        if (book && (book.cover_image || book.thumbnail) && featured.length < 8) {
          featured.push({
            extracted_url: book.cover_image || book.thumbnail,
            thumbnail_url: book.thumbnail || book.cover_image,
            title: book.title,
            author: book.author,
            book_id: b.id,
          });
        }
      }
      if (featured.length >= 8) break;
    }

    const desc = `Books that were condemned, prohibited, expurgated, or burned — survivors of organized suppression. The core of this collection is the Roman *Index Librorum Prohibitorum* (1559–1948), where Hermetic, alchemical, Kabbalistic, and natural-philosophical works appear alongside Reformation theology, political philosophy, and Enlightenment thought. Some authors were executed for their books: Bruno burned at Campo de' Fiori, Servetus at Geneva, Vanini at Toulouse. Others — Galileo, Campanella, Spinoza — lived under censorship that shaped what they could publish.\n\nSource Library preserves these works because suppression is itself part of their meaning. To read Bruno or Khunrath today is to read across a four-century gap kept open by people who hid books, smuggled manuscripts, and printed in cities beyond the Index's reach.`;

    await collections.updateOne(
      { slug: SLUG },
      {
        $set: {
          slug: SLUG,
          name: 'Banned Books',
          subtitle: 'Books condemned, suppressed, or burned',
          description: desc,
          color: '#7c1d1d',
          order: 40,
          book_count: allMatchedIds.size,
          featured_images: featured,
          collection_type: 'curated',
          type: 'curated',
          published: true,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    console.log(`Upserted collection '${SLUG}' (${allMatchedIds.size} books, ${featured.length} featured)`);
  } else {
    console.log(`\n(dry run — no DB writes. Pass --tag to apply.)`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
