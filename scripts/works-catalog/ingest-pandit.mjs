#!/usr/bin/env node
/**
 * Pandit work spine for the works catalog (#2453, Frame B census).
 *
 * Pandit (panditproject.org) is a prosopographical database of Indic texts —
 * the richest Sanskrit work authority (work-level entities + authors + dates +
 * manuscripts). It is behind Cloudflare and has no public API/dump, so the data
 * arrives as a manual CSV export ("Works" search page → Export as CSV; CC-BY-NC-SA).
 * This ingests that CSV.
 *
 * Column-detecting by design: Pandit's exact Works headers aren't documented,
 * so we detect the id/title/author/language/date columns from the header row
 * and print the mapping under --dry-run for verification before any write.
 *
 * Authority id = `pandit:<EntityID>`, source_catalog = 'pandit'. Sanskrit-only
 * by default (a Works export may be pan-Indic); pass --all to keep every row,
 * tagging tradition from the language column.
 *
 * Run on Hetzner (SUPABASE_DB_URL). Idempotent upsert.
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/ingest-pandit.mjs path/to/work_search-*.csv --dry-run
 *   node scripts/works-catalog/ingest-pandit.mjs path/to/work_search-*.csv
 *
 * Options:
 *   --dry-run   detect columns, print mapping + sample, write nothing
 *   --all       keep non-Sanskrit rows too (tradition from language column)
 */
import { readFileSync } from 'fs';
import { pgClient, upsertWorks } from './lib.mjs';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');
const KEEP_ALL = args.includes('--all');
if (!csvPath) { console.error('Usage: ingest-pandit.mjs <works.csv> [--dry-run] [--all]'); process.exit(1); }

// ── Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines/quotes) ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = readFileSync(csvPath, 'utf8');
const table = parseCsv(raw).filter(r => r.some(c => c.trim() !== ''));
if (!table.length) { console.error('Empty CSV'); process.exit(1); }
const header = table[0].map(h => h.trim());
const dataRows = table.slice(1);

// ── Column detection ──────────────────────────────────────────────────────
const findCol = (...patterns) => {
  for (const pat of patterns) {
    const i = header.findIndex(h => pat.test(h));
    if (i >= 0) return i;
  }
  return -1;
};
const idCol = findCol(/^entity\s*id$/i, /^id$/i, /entity\s*id/i);
// Title: prefer an exact "Title"/"Name"; avoid columns that are clearly references.
const titleCol = findCol(/^title$/i, /^name$/i, /work.*title/i, /title/i, /name/i);
// Author NAME column (not the *_id pair). Pandit emits an "Author (person IDs)"
// column then "Authors (person)"; take the one with NO "id" anywhere in the
// header (the earlier /id$/ test missed the "IDs)" suffix and grabbed the
// numeric-id column).
const authorCol = (() => {
  const cands = header.map((h, i) => ({ h, i })).filter(x => /author|creator|composed by/i.test(x.h));
  const named = cands.find(x => !/\bid|ids?\b/i.test(x.h));
  return (named || cands[1] || cands[0])?.i ?? -1;
})();
const langCol = findCol(/language/i, /^lang/i);
const dateCol = findCol(/century/i, /\bdate\b/i, /\btime\b/i, /period/i, /\byear\b/i, /flourish|floruit|fl\b/i);
const wdCol = findCol(/wikidata/i, /\bqid\b/i);

const mapping = {
  id: idCol >= 0 ? header[idCol] : '(MISSING)',
  title: titleCol >= 0 ? header[titleCol] : '(MISSING)',
  author: authorCol >= 0 ? header[authorCol] : '(none)',
  language: langCol >= 0 ? header[langCol] : '(none)',
  date: dateCol >= 0 ? header[dateCol] : '(none)',
  wikidata: wdCol >= 0 ? header[wdCol] : '(none)',
};
console.log(`\n=== Pandit ingest — ${csvPath} ===`);
console.log(`Rows: ${dataRows.length} | Columns: ${header.length}`);
console.log('Detected column mapping:');
for (const [k, v] of Object.entries(mapping)) console.log(`  ${k.padEnd(10)} -> ${v}`);
if (idCol < 0 || titleCol < 0) {
  console.error('\nFATAL: could not detect id or title column. Headers were:\n  ' + header.join(' | '));
  process.exit(1);
}

// ── century parse: "12th century", "fl. 1150", "1100-1150", "c. 1200 CE" ──
// Year first (a 3-4 digit number → its century); fall back to an explicit
// "Nth century" phrase. Requiring "cent" avoids mistaking the "C" in "CE"/"CA"
// for a century marker (the "c. 1000 CE" -> 0 bug).
function centuryOf(s) {
  if (!s) return null;
  const bce = /bce|\bbc\b/i.test(s);
  const ym = s.match(/\d{3,4}/);
  if (ym) { const c = Math.ceil(parseInt(ym[0]) / 100); return bce ? -c : c; }
  const cm = s.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*cent/i);
  if (cm) { const c = parseInt(cm[1]); return bce ? -c : c; }
  return null;
}

// Sanskrit-script signal: Devanagari, or IAST romanization (the diacritics
// Sanskrit transliteration uses and Chinese/pinyin does not). Used to keep the
// ingest precise when the export has NO language column (e.g. a year-filtered
// Pandit export mixes Sanskrit with Chinese Buddhist texts like "Anban shouyi
// jing"). NB: misses diacritic-less Sanskrit (Arjunacarita) — precision over
// recall, since the alternative is mislabeling Chinese as Sanskrit.
const SANSKRIT_SCRIPT = /[ऀ-ॿ]|[āīūṛṝḷḹṅñṭḍṇśṣṃḥ]/;

const works = [];
let skippedNonSkt = 0, skippedNoTitle = 0;
for (const r of dataRows) {
  const id = (r[idCol] || '').trim();
  const title = (r[titleCol] || '').trim();
  if (!id || !title) { skippedNoTitle++; continue; }
  const language = langCol >= 0 ? (r[langCol] || '').trim() : '';
  // With a language column, trust it. Without one, require a Sanskrit script
  // signal in the title (unless --all) so non-Sanskrit rows aren't mislabeled.
  const isSanskrit = langCol >= 0
    ? /sanskrit|sa\b|saṃskṛta|samskrita/i.test(language)
    : SANSKRIT_SCRIPT.test(title);
  if (!KEEP_ALL && !isSanskrit) { skippedNonSkt++; continue; }
  const author = authorCol >= 0 ? (r[authorCol] || '').trim().split(',')[0] || null : null;
  const wd = wdCol >= 0 ? (r[wdCol] || '').trim().match(/Q\d+/)?.[0] : null;
  const tradition = isSanskrit ? 'sanskrit' : (language.toLowerCase().split(/[,;]/)[0].trim() || 'sanskrit');
  works.push({
    id: `pandit:${id}`,
    tradition,
    // keep language consistent with tradition: a no-language-signal Pandit row
    // defaults tradition to 'sanskrit' (above), so language should too — else
    // tradition='sanskrit' + original_language=null (was 344 such rows)
    original_language: tradition === 'sanskrit' ? 'san' : null,
    title,
    title_romanized: /[a-zA-Z]/.test(title) ? title : null,
    author: author || null,
    century: centuryOf(dateCol >= 0 ? r[dateCol] : ''),
    wikidata_qid: wd || null,
    authority_ids: { pandit: id },
    corpus_tags: ['pandit'],
    source_catalog: 'pandit',
    extra: langCol >= 0 && language ? { pandit_language: language } : {},
  });
}

console.log(`\nMapped ${works.length} works (skipped ${skippedNonSkt} non-Sanskrit, ${skippedNoTitle} no-id/title)`);
console.log('Sample mapped rows:');
for (const w of works.slice(0, 8)) console.log(`  ${w.id} | ${(w.title || '').slice(0, 40).padEnd(40)} | auth: ${(w.author || '-').slice(0, 22)} | c: ${w.century ?? '-'}`);

if (DRY_RUN) { console.log('\nDRY RUN — nothing written. Verify the mapping above, then re-run without --dry-run.'); process.exit(0); }

const client = pgClient();
await client.connect();
const inserted = await upsertWorks(client, works);
const stats = (await client.query(
  `select count(*) total, count(*) filter (where source_catalog='pandit') from_pandit
   from works where tradition='sanskrit'`)).rows[0];
await client.end();
console.log(`\nUpserted ${inserted}; Sanskrit works now ${stats.total} (${stats.from_pandit} from pandit)`);
