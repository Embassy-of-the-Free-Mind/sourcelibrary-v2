#!/usr/bin/env node
/**
 * Banned books → USTC → Source Library cross-reference.
 *
 * Uses Source Library's 1.6M USTC edition records (Supabase) as the bibliographic
 * spine. For each Bujanda 1946 Index CSV entry, finds matching USTC editions by
 * author surname + title-token overlap, then checks whether any Source Library
 * book has that USTC sn as its `ustc_id`.
 *
 * Outputs three lists:
 *   - have: banned USTC editions that ARE in Source Library (ustc_id match)
 *   - missing_in_sl: banned USTC editions in USTC but not in our library
 *     → acquisition targets with precise USTC URLs
 *   - no_ustc: Bujanda entries that don't resolve to a USTC sn (modern, manuscript, etc.)
 *
 * Prerequisite: scripts/ustc-link-batch.mjs has been run so most Source Library
 * books have ustc_id set.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/banned-books-via-ustc.mjs
 *   set -a; source .env.production.local; set +a; node scripts/banned-books-via-ustc.mjs --tag
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV_PATH = join(ROOT, '.claude/docs/index-librorum-1946-bujanda.csv');
const REPORT_JSON = join(ROOT, '.claude/docs/banned-books-via-ustc.json');
const REPORT_MD = join(ROOT, '.claude/docs/banned-books-via-ustc.md');

const TAG = process.argv.includes('--tag');
const SLUG = 'index-librorum-prohibitorum';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_ANON_KEY;

// ── CSV parser ───────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {} else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const h = rows.shift();
  return rows.filter(r => r.length === h.length).map(r => {
    const o = {};
    for (let i = 0; i < h.length; i++) o[h[i]] = r[i];
    return o;
  });
}

const STOP = new Set([
  'libri','liber','libro','tres','duo','sive','seu','oder','over','quam','est',
  'das','ist','und','von','dans','dell','della','dello','this','that','sopra',
  'opera','omnia','tomus','editio','epistola','epistolae','tractatus','dialogo',
  'oeuvres','works','traite','schriften','memoires','schrift','dialogus',
]);

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s,'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function surname(a) {
  if (!a) return '';
  const c = a.replace(/\[[^\]]*\]/g, '').trim();
  if (c.includes(',')) return norm(c.split(',')[0]);
  const p = norm(c).split(/\s+/);
  return p[p.length - 1] || '';
}
function titleTokens(t) {
  return norm(t).split(/\s+/).filter(w => w.length >= 5 && !STOP.has(w));
}

// ── Supabase paginated query ─────────────────────────────────────────
async function supaQuery(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Fetch USTC editions where author_1 starts with the surname.
// USTC stores authors as "Surname, Forename" (occasionally "Surname Forename"),
// so an anchored prefix `ilike.${surname}*` is index-efficient (b-tree on author_1)
// — the unanchored `ilike.*${s}*` form times out on the 1.6M-row table.
// Trade-off: misses cases where the surname is in author_2/3 or mid-string.
async function ustcEditionsBySurname(s) {
  // Capitalize the way USTC stores it. ilike is case-insensitive but
  // sending normalized lowercase to PostgREST `like.` operator works either way.
  const enc = encodeURIComponent(s);
  const editions = [];
  let offset = 0;
  while (true) {
    const path = `ustc_editions?author_1=ilike.${enc}*&select=sn,source_library_id,title,author_1,year,country,classification_1&limit=1000&offset=${offset}`;
    let r;
    try {
      r = await supaQuery(path);
    } catch (e) {
      // If still timing out, surname is too common (e.g. single common word). Bail.
      if (String(e).includes('57014')) return editions;
      throw e;
    }
    editions.push(...r);
    if (r.length < 1000 || offset >= 5000) break; // cap pagination at 5000 per surname
    offset += 1000;
  }
  return editions;
}

async function main() {
  console.log(`Banned books via USTC cross-reference`);
  console.log(`Mode: ${TAG ? 'APPLY (tag matched books)' : 'DRY-RUN'}\n`);

  const text = readFileSync(CSV_PATH, 'utf8');
  const csvRows = parseCSV(text);
  const entries = csvRows.map(r => ({
    id: r.ID, title: r.title, author: r.author,
    period: r.period, publication_date: r.publication_date,
    author_surname: surname(r.author),
    title_tokens: titleTokens(r.title),
    is_opera_omnia: /opera omnia|works|oeuvres compl|sämmtliche werke|complete works/i.test(r.title || ''),
  }));
  console.log(`Loaded ${entries.length} Bujanda CSV entries.`);

  // Distinct surnames
  const surnames = [...new Set(entries.map(e => e.author_surname).filter(s => s.length >= 4))];
  console.log(`Distinct surnames: ${surnames.length}`);

  // For each surname, fetch USTC editions
  console.log(`\nFetching USTC editions per surname (this is the slow part)…`);
  const editionsBySurname = new Map();
  let i = 0;
  for (const s of surnames) {
    try {
      const eds = await ustcEditionsBySurname(s);
      editionsBySurname.set(s, eds);
    } catch (e) {
      console.error(`  surname "${s}" → ${e.message}`);
      editionsBySurname.set(s, []);
    }
    i++;
    if (i % 50 === 0) process.stdout.write(`\r  ${i}/${surnames.length} surnames fetched`);
  }
  console.log(`\n  done.`);

  // Match each Bujanda entry to USTC editions
  const matches = [];  // {entry, ustcEdition, confidence}
  for (const e of entries) {
    const eds = editionsBySurname.get(e.author_surname) || [];
    if (!eds.length) continue;
    for (const ed of eds) {
      const edTitle = norm(ed.title);
      let hits = 0;
      for (const t of e.title_tokens) if (edTitle.includes(t)) hits++;
      let confidence = null;
      if (e.is_opera_omnia) confidence = 'opera_omnia';
      else if (e.title_tokens.length && hits >= Math.max(1, Math.min(3, e.title_tokens.length - 1))) confidence = hits >= 3 ? 'high' : 'medium';
      if (confidence) {
        // Year proximity: ±50 years was previously ±100 — too loose. The
        // tighter window catches cases like David Lipsii's 1678 dissertation
        // accidentally matching Justus Lipsius's 1613 banned Orationes via
        // shared 17c. academic boilerplate ("in gratiam studiosae iuventutis").
        const bujandaYear = parseInt((e.period || '').match(/\d{4}/)?.[0] || '0');
        const edYear = ed.year || 0;
        const yearOk = !bujandaYear || !edYear || Math.abs(bujandaYear - edYear) <= 50;
        if (yearOk) matches.push({ entry: e, edition: ed, confidence });
      }
    }
  }
  console.log(`USTC editions matched to Bujanda entries: ${matches.length}`);

  // Connect Mongo to check ustc_id presence
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Distinct USTC SNs from matches
  const ustcSns = [...new Set(matches.map(m => m.edition.sn).filter(Boolean))];
  console.log(`Distinct USTC SNs from banned matches: ${ustcSns.length}`);

  // Which of those are in Source Library (via ustc_id)?
  const slMatches = await books.find(
    { ustc_id: { $in: ustcSns }, visible: { $ne: false } },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, author: 1, year: 1, ustc_id: 1, collections: 1 } },
  ).toArray();
  const slByUstc = new Map(slMatches.map(b => [b.ustc_id, b]));
  console.log(`Source Library books matched via ustc_id: ${slMatches.length}`);

  // Build the three lists
  const have = [];        // ustc edition in SL
  const missingInSl = []; // ustc edition not in SL (acquisition target)
  const seenSns = new Set();
  for (const m of matches) {
    const sn = m.edition.sn;
    if (!sn || seenSns.has(sn)) continue;
    seenSns.add(sn);
    const sl = slByUstc.get(sn);
    const item = {
      ustc_sn: sn,
      ustc_url: `https://www.ustc.ac.uk/editions/${sn}`,
      ustc_title: m.edition.title,
      ustc_author: m.edition.author_1,
      ustc_year: m.edition.year,
      ustc_country: m.edition.country,
      bujanda_id: m.entry.id,
      bujanda_title: m.entry.title,
      bujanda_author: m.entry.author,
      bujanda_period: m.entry.period,
      confidence: m.confidence,
    };
    if (sl) {
      have.push({ ...item, sl_book: { id: sl.id, slug: sl.slug, title: sl.title, year: sl.year, _id: String(sl._id), already_tagged: (sl.collections || []).includes(SLUG) } });
    } else {
      missingInSl.push(item);
    }
  }

  const report = {
    compiled: new Date().toISOString(),
    csv_entries: entries.length,
    distinct_ustc_sns_matched: ustcSns.length,
    sl_books_matched: slMatches.length,
    have: have.length,
    missing_in_sl: missingInSl.length,
    no_ustc_match: entries.length - new Set(matches.map(m => m.entry.id)).size,
    items_have: have.slice(0, 200),    // limit for readability
    items_missing: missingInSl.slice(0, 500),
  };
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  // Markdown summary
  let md = `# Banned Books via USTC — Cross-Reference Report\n\n_Generated ${new Date().toISOString()}_\n\n`;
  md += `Joined the Bujanda 1946 Vatican Index (4,327 entries) against Source Library's 1.6M USTC edition records, then checked which USTC editions are linked to Source Library books via \`ustc_id\`.\n\n`;
  md += `- **CSV entries scored:** ${entries.length}\n`;
  md += `- **Distinct USTC SNs identified:** ${ustcSns.length}\n`;
  md += `- **Source Library books matched (already in catalog):** ${have.length}\n`;
  md += `- **USTC editions in Bujanda but NOT in Source Library (acquisition targets):** ${missingInSl.length}\n\n`;

  md += `## ✓ Have (Source Library books matching banned USTC editions)\n\n`;
  for (const h of have.slice(0, 60)) {
    md += `- [${h.bujanda_author?.slice(0, 30) || '?'}] **${h.ustc_title?.slice(0, 70) || ''}** (${h.ustc_year ?? '?'}) — `;
    md += `SL: \`${h.sl_book.slug || h.sl_book.id}\`${h.sl_book.already_tagged ? ' ✓ tagged' : ' ◇ NOT tagged yet'}, `;
    md += `[USTC ${h.ustc_sn}](${h.ustc_url})\n`;
  }
  if (have.length > 60) md += `\n_(+${have.length - 60} more in JSON)_\n`;

  md += `\n## ✗ Acquisition shortlist (banned USTC editions not in Source Library)\n\n`;
  for (const m of missingInSl.slice(0, 100)) {
    md += `- **${m.ustc_title?.slice(0, 70) || ''}** by ${m.ustc_author?.slice(0, 40) || '?'} (${m.ustc_year ?? '?'}, ${m.ustc_country || '?'}) — [USTC ${m.ustc_sn}](${m.ustc_url})\n`;
  }
  if (missingInSl.length > 100) md += `\n_(+${missingInSl.length - 100} more in JSON)_\n`;

  writeFileSync(REPORT_MD, md);
  console.log(`\nWrote: ${REPORT_JSON}`);
  console.log(`Wrote: ${REPORT_MD}`);

  // Tag matched books
  if (TAG) {
    const toTag = have.filter(h => !h.sl_book.already_tagged);
    if (toTag.length === 0) {
      console.log(`\nNo new books to tag.`);
    } else {
      console.log(`\nTagging ${toTag.length} new books with '${SLUG}'…`);
      const { ObjectId } = await import('mongodb');
      const oids = toTag.map(h => new ObjectId(h.sl_book._id));
      const result = await books.updateMany(
        { _id: { $in: oids } },
        { $addToSet: { collections: SLUG } },
      );
      console.log(`Tagged ${result.modifiedCount} books.`);
      const totalTagged = await books.countDocuments({ collections: SLUG });
      await db.collection('collections').updateOne(
        { slug: SLUG },
        { $set: { book_count: totalTagged, updated_at: new Date() } },
      );
      console.log(`Collection '${SLUG}' book_count = ${totalTagged}`);
    }
  } else {
    console.log(`\n(dry run — pass --tag to apply.)`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
