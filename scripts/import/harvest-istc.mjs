#!/usr/bin/env node
/**
 * Harvest the ISTC (Incunabula Short Title Catalogue) into import_candidates.
 *
 * Parses the ISTC bulk YAML release (30,587 records of pre-1501 printed books)
 * from the British Library and stores them in MongoDB import_candidates.
 *
 * Data source: https://bl.iro.bl.uk/concern/datasets/30c74386-fc34-41b8-a9e5-d27ba96b0625
 * License: CC BY-NC 4.0
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/harvest-istc.mjs
 *
 * Options:
 *   --dry-run        Show what would be harvested without writing
 *   --limit N        Max records to process
 *   --scope-only     Only insert records matching Source Library's scope (author allowlist + keyword filter)
 *   --stats          Print stats and exit without inserting
 */

import { MongoClient } from 'mongodb';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STATS_ONLY = args.includes('--stats');
const SCOPE_ONLY = args.includes('--scope-only');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

const YAML_PATH = new URL('../data/istc/istc_clean_1.0.yaml', import.meta.url).pathname;
const SOURCE = 'istc';

// ── Scope filter: authors and keywords relevant to Source Library ────

const SCOPE_AUTHORS = new Set([
  'albertus magnus', 'agrippa', 'albumasar', 'al-kindi', 'aquinas',
  'aristotle', 'arnaldus de villa nova', 'avicenna', 'bacon, roger',
  'boethius', 'bruno, giordano', 'cardanus', 'cicero', 'cusanus',
  'dioscurides', 'euclid', 'ficinus', 'galenus', 'geber',
  'hermes trismegistus', 'hippocrates', 'isidorus',
  'lullus', 'manilius', 'marsilio ficino', 'nicolaus copernicus',
  'nicolaus cusanus', 'paracelsus', 'petrus de abano',
  'pico della mirandola', 'plato', 'plinius', 'plotinus',
  'pomponazzi', 'proclus', 'ptolemaeus', 'pythagoras',
  'raimundus lullus', 'regiomontanus', 'reuchlin', 'sacrobosco',
  'seneca', 'thomas aquinas', 'trithemius',
  // Broader natural philosophy / medicine authors
  'avenzoar', 'averroes', 'bartholomaeus anglicus', 'constantinus africanus',
  'dioscorides', 'galen', 'haly abenragel', 'hippocrates',
  'honorius augustodunensis', 'hrabanus maurus', 'hugo de sancto victore',
  'john of sacrobosco', 'leopold of austria', 'marbodus',
  'michael scotus', 'peter lombard', 'peter of spain',
  'richardus anglicus', 'vincentius bellovacensis',
]);

const SCOPE_TITLE_KEYWORDS = [
  'alchem', 'alchim', 'astrolog', 'astronom', 'cabala', 'chiromant',
  'daemon', 'divinat', 'geomant', 'hermetic', 'horoscop', 'kabbal',
  'lapid', 'magic', 'natural', 'necromant', 'nigromant', 'occult',
  'onirocrit', 'pharmacop', 'philosoph', 'phytognom', 'prognostic',
  'propheti', 'secret', 'sphaer', 'talisman', 'theurgi', 'transmut',
  'de mineralibus', 'de natura rerum', 'de proprietatibus rerum',
  'de secretis', 'de virtutibus', 'liber de', 'opus majus',
  'picatrix', 'speculum', 'tabula smaragdina', 'turba philosophorum',
  'hortus sanitatis', 'ortus sanitatis', 'herbarius', 'fasciculus medicinae',
  'problemata', 'physiognomia', 'somniorum', 'de anima',
];

const SCOPE_KEYWORDS_RE = new RegExp(SCOPE_TITLE_KEYWORDS.join('|'), 'i');

function matchesScope(author, title) {
  const authorLower = (author || '').toLowerCase();
  for (const scopeAuthor of SCOPE_AUTHORS) {
    if (authorLower.includes(scopeAuthor)) return true;
  }
  if (SCOPE_KEYWORDS_RE.test(title || '')) return true;
  return false;
}

// ── Parse YAML stream (multi-document YAML separated by ---) ────────

async function* parseIstcYaml(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });

  let currentRecord = null;
  let currentKey = null;
  let lines = [];

  for await (const line of rl) {
    if (line === '---') {
      if (lines.length > 0) {
        yield parseSimpleYaml(lines);
      }
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (lines.length > 0) {
    yield parseSimpleYaml(lines);
  }
}

// Simple YAML parser for the ISTC structure (avoids js-yaml dependency)
function parseSimpleYaml(lines) {
  const record = { _id: null, data: {} };
  let inData = false;
  let inMeta = false;
  let currentSection = null;
  let currentArray = null;
  let currentArrayKey = null;
  let currentObj = null;

  for (const line of lines) {
    // Top-level _id
    if (line.startsWith('_id:')) {
      record._id = line.slice(5).trim();
      continue;
    }

    // Section markers
    if (line === 'data:') { inData = true; inMeta = false; continue; }
    if (line === 'meta:') { inData = false; inMeta = true; continue; }

    if (!inData) continue; // We only care about data section

    // Simple key: value pairs at data level (2-space indent)
    const simpleMatch = line.match(/^  (\w[\w_]*): (.+)$/);
    if (simpleMatch) {
      const [, key, val] = simpleMatch;
      currentArray = null;
      record.data[key] = cleanYamlValue(val);
      continue;
    }

    // Array start at data level
    const arrayItemMatch = line.match(/^  (\w[\w_]*):$/);
    if (arrayItemMatch) {
      currentArrayKey = arrayItemMatch[1];
      record.data[currentArrayKey] = record.data[currentArrayKey] || [];
      currentArray = currentArrayKey;
      continue;
    }

    // Array item with dash
    if (line.match(/^    - /)) {
      if (currentArray === 'related_resources' || currentArray === 'holdings' ||
          currentArray === 'imprint' || currentArray === 'references' ||
          currentArray === 'notes') {
        const kvMatch = line.match(/^    - (\w[\w_]*): (.+)$/);
        if (kvMatch) {
          currentObj = { [kvMatch[1]]: cleanYamlValue(kvMatch[2]) };
          if (!record.data[currentArray]) record.data[currentArray] = [];
          record.data[currentArray].push(currentObj);
        } else {
          // Simple array value
          const val = line.replace(/^    - /, '').trim();
          if (!record.data[currentArray]) record.data[currentArray] = [];
          if (typeof val === 'string' && val) {
            record.data[currentArray].push(cleanYamlValue(val));
          }
        }
      }
      continue;
    }

    // Continuation of array object
    if (currentObj && line.match(/^      \w/)) {
      const kvMatch = line.match(/^      (\w[\w_]*): (.+)$/);
      if (kvMatch) {
        currentObj[kvMatch[1]] = cleanYamlValue(kvMatch[2]);
      }
    }
  }

  return record;
}

function cleanYamlValue(val) {
  if (!val) return null;
  val = val.trim();
  if (val === '~' || val === 'null') return null;
  // Remove surrounding quotes
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1);
  }
  // Try number
  if (/^\d{4}$/.test(val)) return parseInt(val, 10);
  return val;
}

// ── Extract digital URLs ────────────────────────────────────────────

function extractDigitalUrls(record) {
  const urls = [];
  const resources = record.data.related_resources;
  if (!Array.isArray(resources)) return urls;
  for (const r of resources) {
    if (r.resource_type === 'digital' && r.resource_url) {
      urls.push({
        url: r.resource_url,
        institution: r.resource_name?.replace(/^Electronic facsimile\s*:\s*/, '').trim() || null,
      });
    }
  }
  return urls;
}

// ── Extract GW number from references ───────────────────────────────

function extractGwNumber(record) {
  const refs = record.data.references;
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    if (r.reference_name === 'GW' && r.reference_location_in_source) {
      return r.reference_location_in_source;
    }
  }
  return null;
}

// ── Map language codes ──────────────────────────────────────────────

const LANG_MAP = {
  lat: 'Latin', eng: 'English', ger: 'German', dut: 'Dutch', fre: 'French',
  ita: 'Italian', spa: 'Spanish', gre: 'Greek', heb: 'Hebrew', por: 'Portuguese',
  cat: 'Catalan', cze: 'Czech', pol: 'Polish', swe: 'Swedish', dan: 'Danish',
  hun: 'Hungarian', pro: 'Provençal', ara: 'Arabic', arm: 'Armenian',
  chu: 'Church Slavonic', grc: 'Ancient Greek', eth: 'Ethiopic',
};

function mapLanguage(code) {
  if (!code) return null;
  return LANG_MAP[code] || code;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nISTc Harvester — parsing ${YAML_PATH}`);
  console.log(`Options: dry_run=${DRY_RUN}, scope_only=${SCOPE_ONLY}, limit=${LIMIT === Infinity ? 'none' : LIMIT}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection('import_candidates');

  // Stats
  let total = 0, inserted = 0, skipped = 0, outOfScope = 0, errors = 0;
  let withDigital = 0, withGw = 0;
  const langCounts = {};
  const decadeCounts = {};
  const scopeHits = [];

  // Build an index for fast dupe checking
  let existingIds = new Set();
  if (!STATS_ONLY) {
    console.log('Loading existing ISTC records for dupe check...');
    const cursor = col.find({ source: SOURCE }, { projection: { source_id: 1 } });
    for await (const doc of cursor) existingIds.add(doc.source_id);
    console.log(`Found ${existingIds.size} existing ISTC records\n`);
  }

  const BATCH_SIZE = 500;
  let batch = [];

  for await (const record of parseIstcYaml(YAML_PATH)) {
    if (!record._id) continue;
    total++;
    if (total > LIMIT) break;

    const author = record.data.author || null;
    const title = record.data.title || null;
    const year = record.data.date_of_item_single_date || null;
    const lang = record.data.language_of_item || null;
    const digitalUrls = extractDigitalUrls(record);
    const gwNumber = extractGwNumber(record);

    // Stats
    if (digitalUrls.length > 0) withDigital++;
    if (gwNumber) withGw++;
    const langKey = lang || 'unknown';
    langCounts[langKey] = (langCounts[langKey] || 0) + 1;
    if (year) {
      const decade = Math.floor(year / 10) * 10;
      decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
    }

    const inScope = matchesScope(author, title);
    if (inScope && scopeHits.length < 50) {
      scopeHits.push({ id: record._id, author, title, year, digital: digitalUrls.length > 0 });
    }

    if (SCOPE_ONLY && !inScope) {
      outOfScope++;
      continue;
    }

    if (STATS_ONLY) continue;

    // Skip existing
    if (existingIds.has(record._id)) { skipped++; continue; }

    // Extract imprint info
    const imprint = Array.isArray(record.data.imprint) ? record.data.imprint[0] : null;
    const place = imprint?.imprint_place || null;
    const printer = imprint?.imprint_name || null;
    const imprintDate = imprint?.imprint_date || null;

    const doc = {
      source: SOURCE,
      source_id: record._id,
      title,
      author,
      author_surname: author ? author.split(',')[0].trim() : null,
      language: mapLanguage(lang),
      language_code: lang,
      date_earliest: year || null,
      date_latest: year || null,
      date_raw: imprintDate,
      publisher: printer,
      place: place ? place.replace(/^\[/, '').replace(/\]$/, '') : null,
      format: record.data.dimensions || null,
      viewer_url: digitalUrls[0]?.url || null,
      digital_copies: digitalUrls.length > 0 ? digitalUrls : undefined,
      has_digital: digitalUrls.length > 0,
      scan_quality: digitalUrls.length > 0 ? 'high' : null,
      page_count: null, // Not in ISTC
      catalog_ids: {
        istc: record._id,
        gw: gwNumber,
      },
      in_scope: inScope,
      status: 'discovered',
      subjects: record.data.uncontrolled_term ? [record.data.uncontrolled_term] : [],
      rights: 'CC BY-NC 4.0 (ISTC metadata)',
      discovered_at: new Date(),
      harvested_at: new Date(),
    };

    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) {
        try {
          const result = await col.insertMany(batch, { ordered: false });
          inserted += result.insertedCount;
        } catch (e) {
          // Some may have succeeded in unordered insert
          inserted += e.result?.nInserted || 0;
          errors += batch.length - (e.result?.nInserted || 0);
          if (errors <= 5) console.error(`  Batch error: ${e.message}`);
        }
      } else {
        inserted += batch.length;
      }
      console.log(`  [${total}] inserted ${inserted}, skipped ${skipped}...`);
      batch = [];
    }
  }

  // Flush remaining batch
  if (batch.length > 0 && !STATS_ONLY) {
    if (!DRY_RUN) {
      try {
        const result = await col.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
      } catch (e) {
        inserted += e.result?.nInserted || 0;
        errors += batch.length - (e.result?.nInserted || 0);
      }
    } else {
      inserted += batch.length;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────

  console.log('\n════════════════════════════════════════════════');
  console.log('ISTC HARVEST SUMMARY');
  console.log('════════════════════════════════════════════════');
  console.log(`Total records parsed: ${total}`);
  if (!STATS_ONLY) {
    console.log(`Inserted: ${inserted}${DRY_RUN ? ' (dry run)' : ''}`);
    console.log(`Skipped (existing): ${skipped}`);
    if (SCOPE_ONLY) console.log(`Out of scope: ${outOfScope}`);
    console.log(`Errors: ${errors}`);
  }
  console.log(`With digital facsimile: ${withDigital} (${(withDigital/total*100).toFixed(1)}%)`);
  console.log(`With GW number: ${withGw} (${(withGw/total*100).toFixed(1)}%)`);

  console.log('\nLanguage breakdown (top 15):');
  const langSorted = Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [lang, count] of langSorted) {
    console.log(`  ${mapLanguage(lang) || lang}: ${count}`);
  }

  console.log('\nDecade distribution:');
  const decadeSorted = Object.entries(decadeCounts).sort((a, b) => a[0] - b[0]);
  for (const [decade, count] of decadeSorted) {
    console.log(`  ${decade}s: ${count}`);
  }

  if (scopeHits.length > 0) {
    const digitalScopeHits = scopeHits.filter(h => h.digital);
    console.log(`\nScope matches (first ${scopeHits.length}): ${scopeHits.length} total, ${digitalScopeHits.length} with digital`);
    console.log('\nSample scope matches with digital copies:');
    for (const h of digitalScopeHits.slice(0, 20)) {
      console.log(`  ${h.year || '?'} — ${h.author || '?'}: ${h.title?.substring(0, 70)}`);
    }
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
