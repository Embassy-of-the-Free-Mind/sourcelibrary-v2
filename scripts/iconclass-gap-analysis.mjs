#!/usr/bin/env node
/**
 * Iconclass Gap Analysis — GitHub Issue #904
 *
 * Reads the pre-computed `system_config.iconclass_tree` and analyzes coverage gaps
 * relevant to Source Library's esoteric/early modern collection.
 *
 * Outputs a markdown report with:
 *   - Thin categories (< 10 items)
 *   - Missing categories (zero items for known-important codes)
 *   - Gallery vs artwork imbalances
 *   - Suggested acquisitions to fill gaps
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/iconclass-gap-analysis.mjs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

// ── Top-level divisions ──────────────────────────────────────────────
const TOP_DIVISIONS = {
  '0': 'Abstract Art',
  '1': 'Religion & Magic',
  '2': 'Nature',
  '3': 'Human Figure',
  '4': 'Society & Culture',
  '5': 'Ideas & Concepts',
  '6': 'History',
  '7': 'Bible',
  '8': 'Literature',
  '9': 'Classical Mythology',
};

// ── Domain-relevant categories we EXPECT a well-curated collection to cover ──
// Code → human-readable label + ideal minimum count for a ~25K-item collection
const DOMAIN_CATEGORIES = {
  // Religion & Magic
  '11': { label: 'Christian Religion', min: 50 },
  '11H': { label: 'Saints', min: 30 },
  '11I': { label: 'Mary', min: 20 },
  '12': { label: 'Non-Christian Religions', min: 30 },
  '13': { label: 'Magic, Witchcraft, Occult', min: 40 },
  '14': { label: 'Astrology', min: 40 },

  // Nature
  '21': { label: 'Four Elements', min: 20 },
  '22': { label: 'Natural Phenomena (weather, seasons)', min: 15 },
  '23': { label: 'Time, Calendar', min: 10 },
  '24': { label: 'Sky, Celestial Bodies', min: 30 },
  '25': { label: 'Earth, Geology, Landscape', min: 20 },
  '25F': { label: 'Animals', min: 40 },
  '25FF': { label: 'Fabulous Creatures', min: 20 },
  '25G': { label: 'Plants', min: 20 },

  // Human figure & body
  '31': { label: 'Human Body', min: 15 },
  '31A': { label: 'Anatomy', min: 15 },

  // Society & Culture
  '41': { label: 'Material Culture & Everyday Life', min: 20 },
  '43': { label: 'Recreation, Amusement', min: 10 },
  '44': { label: 'State, Government, Law', min: 15 },
  '46': { label: 'Social & Economic Life', min: 15 },
  '48': { label: 'Art', min: 20 },
  '48A': { label: 'Art & Artist', min: 15 },
  '48C': { label: 'Emblems, Heraldry', min: 40 },

  // Ideas & Concepts
  '49': { label: 'Technology & Science', min: 30 },
  '49C': { label: 'Chemistry', min: 20 },
  '49E': { label: 'Trades & Crafts', min: 15 },
  '49E39': { label: 'Alchemy', min: 30 },
  '52': { label: 'Knowledge, Science, Learning', min: 30 },

  // History
  '61': { label: 'Historical Events', min: 15 },

  // Bible
  '71': { label: 'Old Testament', min: 30 },
  '73': { label: 'New Testament', min: 30 },

  // Literature
  '83': { label: 'Specific Works of Literature', min: 15 },

  // Classical Mythology
  '91': { label: 'Myths of Creation', min: 10 },
  '92': { label: 'Classical Gods & Deities', min: 40 },
  '92B': { label: 'Jupiter (Zeus)', min: 10 },
  '92C': { label: 'Apollo', min: 10 },
  '92D': { label: 'Mercury (Hermes)', min: 10 },
  '92L': { label: 'Venus (Aphrodite)', min: 10 },
  '94': { label: 'Heroes & Demigods', min: 20 },
  '95': { label: 'Trojan War', min: 10 },
  '97': { label: 'Metamorphoses', min: 20 },
};

// Priority tiers for acquisition suggestions
const PRIORITY_DOMAINS = [
  { codes: ['13', '14', '49E39', '49C'], domain: 'Alchemy, Magic & Astrology' },
  { codes: ['92', '94', '97', '91', '95'], domain: 'Classical Mythology' },
  { codes: ['48C', '48A', '48'], domain: 'Emblems & Visual Arts' },
  { codes: ['12', '11H'], domain: 'Religious Iconography' },
  { codes: ['21', '24', '25F', '25FF', '25G'], domain: 'Natural Philosophy' },
  { codes: ['52', '49'], domain: 'Science & Knowledge' },
  { codes: ['71', '73'], domain: 'Biblical Illustration' },
  { codes: ['31A', '31'], domain: 'Anatomy & the Human Body' },
];

// ── Helpers ──────────────────────────────────────────────────────────

function getNode(nodes, code) {
  return nodes[code] || null;
}

function pct(n, total) {
  if (!total) return '0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function bar(count, max) {
  const width = 20;
  const filled = Math.min(width, Math.round((count / Math.max(max, 1)) * width));
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const treeDoc = await db.collection('system_config').findOne({ _id: 'iconclass_tree' });
  if (!treeDoc) {
    console.error('No iconclass_tree found in system_config. Run compute-iconclass-tree.mjs first.');
    await client.close();
    process.exit(1);
  }

  const { nodes, total_codes, total_items, updated_at } = treeDoc;

  const lines = [];
  const ln = (s = '') => lines.push(s);

  // ── Header ───────────────────────────────────────────────────────
  ln('# Iconclass Gap Analysis — Source Library');
  ln();
  ln(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  ln(`**Tree computed:** ${updated_at ? new Date(updated_at).toISOString().slice(0, 10) : 'unknown'}`);
  ln(`**Total unique codes:** ${total_codes?.toLocaleString() ?? '?'}`);
  ln(`**Total tagged items:** ${total_items?.toLocaleString() ?? '?'}`);
  ln();

  // ── 1. Top-level distribution ────────────────────────────────────
  ln('## 1. Top-Level Distribution');
  ln();
  ln('| Division | Total | Gallery | Artworks | Sub-cats |');
  ln('|----------|------:|--------:|---------:|---------:|');

  const maxTop = Math.max(...Object.keys(TOP_DIVISIONS).map(c => nodes[c]?.count || 0));
  for (const [code, label] of Object.entries(TOP_DIVISIONS)) {
    const n = nodes[code];
    if (!n) {
      ln(`| **${code}** ${label} | 0 | 0 | 0 | 0 |`);
    } else {
      ln(`| **${code}** ${label} | ${n.count.toLocaleString()} | ${n.gallery_count.toLocaleString()} | ${n.artwork_count.toLocaleString()} | ${(n.children?.length || 0)} |`);
    }
  }
  ln();

  // ── 2. Domain categories: thin or missing ────────────────────────
  ln('## 2. Domain-Relevant Categories: Coverage Status');
  ln();

  const missing = [];   // expected but count = 0
  const thin = [];       // count > 0 but below minimum
  const healthy = [];    // meets or exceeds minimum
  const galleryOnly = [];
  const artworkOnly = [];

  for (const [code, spec] of Object.entries(DOMAIN_CATEGORIES)) {
    const n = getNode(nodes, code);
    const count = n?.count || 0;
    const gc = n?.gallery_count || 0;
    const ac = n?.artwork_count || 0;

    if (count === 0) {
      missing.push({ code, ...spec, count, gc, ac });
    } else if (count < spec.min) {
      thin.push({ code, ...spec, count, gc, ac });
    } else {
      healthy.push({ code, ...spec, count, gc, ac });
    }

    // Imbalance detection
    if (gc > 0 && ac === 0) galleryOnly.push({ code, label: spec.label, gc, ac });
    if (ac > 0 && gc === 0) artworkOnly.push({ code, label: spec.label, gc, ac });
  }

  // Sort thin by how far below target they are
  thin.sort((a, b) => (a.count / a.min) - (b.count / b.min));

  ln('### Missing Categories (zero items)');
  ln();
  if (missing.length === 0) {
    ln('None! All domain-relevant categories have at least one item.');
  } else {
    ln(`**${missing.length} expected categories have no items at all:**`);
    ln();
    ln('| Code | Category | Expected Min |');
    ln('|------|----------|-------------:|');
    for (const m of missing) {
      ln(`| \`${m.code}\` | ${m.label} | ${m.min} |`);
    }
  }
  ln();

  ln('### Thin Categories (below target)');
  ln();
  if (thin.length === 0) {
    ln('All populated categories meet their targets.');
  } else {
    ln(`**${thin.length} categories are below their expected minimum:**`);
    ln();
    ln('| Code | Category | Have | Target | Fill Rate | Gallery | Artworks |');
    ln('|------|----------|-----:|-------:|----------:|--------:|---------:|');
    for (const t of thin) {
      const fill = pct(t.count, t.min);
      ln(`| \`${t.code}\` | ${t.label} | ${t.count} | ${t.min} | ${fill} | ${t.gc} | ${t.ac} |`);
    }
  }
  ln();

  ln('### Healthy Categories (meeting targets)');
  ln();
  healthy.sort((a, b) => b.count - a.count);
  ln('| Code | Category | Count | Target | Gallery | Artworks |');
  ln('|------|----------|------:|-------:|--------:|---------:|');
  for (const h of healthy) {
    ln(`| \`${h.code}\` | ${h.label} | ${h.count.toLocaleString()} | ${h.min} | ${h.gc.toLocaleString()} | ${h.ac.toLocaleString()} |`);
  }
  ln();

  // ── 3. Gallery vs Artwork imbalances ─────────────────────────────
  ln('## 3. Gallery vs Artwork Imbalances');
  ln();
  ln('Categories where coverage is lopsided (one source type only):');
  ln();

  if (galleryOnly.length > 0) {
    ln('### Gallery-only (no artworks)');
    ln();
    ln('| Code | Category | Gallery Count |');
    ln('|------|----------|-------------:|');
    for (const g of galleryOnly.sort((a, b) => b.gc - a.gc)) {
      ln(`| \`${g.code}\` | ${g.label} | ${g.gc} |`);
    }
    ln();
  }

  if (artworkOnly.length > 0) {
    ln('### Artwork-only (no gallery images)');
    ln();
    ln('| Code | Category | Artwork Count |');
    ln('|------|----------|-------------:|');
    for (const a of artworkOnly.sort((a, b) => b.ac - a.ac)) {
      ln(`| \`${a.code}\` | ${a.label} | ${a.ac} |`);
    }
    ln();
  }

  // Broader imbalance: ratio across all nodes
  ln('### Largest imbalances across all tree nodes');
  ln();
  const imbalanced = [];
  for (const [code, n] of Object.entries(nodes)) {
    if (n.count < 5) continue;
    const gc = n.gallery_count || 0;
    const ac = n.artwork_count || 0;
    if (gc === 0 || ac === 0) continue;
    const ratio = Math.max(gc, ac) / Math.min(gc, ac);
    if (ratio > 5) {
      imbalanced.push({ code, label: n.label || code, gc, ac, ratio, total: n.count });
    }
  }
  imbalanced.sort((a, b) => b.ratio - a.ratio);

  if (imbalanced.length > 0) {
    ln('| Code | Total | Gallery | Artworks | Ratio |');
    ln('|------|------:|--------:|---------:|------:|');
    for (const im of imbalanced.slice(0, 20)) {
      ln(`| \`${im.code}\` | ${im.total} | ${im.gc} | ${im.ac} | ${im.ratio.toFixed(1)}:1 |`);
    }
  } else {
    ln('No significant imbalances found (all categories with 5+ items have <5:1 ratio).');
  }
  ln();

  // ── 4. All nodes with fewer than 10 items ────────────────────────
  ln('## 4. All Tree Nodes with < 10 Items');
  ln();
  const smallNodes = Object.entries(nodes)
    .filter(([, n]) => n.count > 0 && n.count < 10)
    .sort((a, b) => a[1].count - b[1].count);

  ln(`**${smallNodes.length} nodes** have fewer than 10 items:`);
  ln();
  if (smallNodes.length > 0) {
    ln('| Code | Count | Gallery | Artworks |');
    ln('|------|------:|--------:|---------:|');
    for (const [code, n] of smallNodes.slice(0, 50)) {
      ln(`| \`${code}\` | ${n.count} | ${n.gallery_count} | ${n.artwork_count} |`);
    }
    if (smallNodes.length > 50) {
      ln(`| ... | | | |`);
      ln(`| *(${smallNodes.length - 50} more)* | | | |`);
    }
  }
  ln();

  // ── 5. Acquisition Suggestions ───────────────────────────────────
  ln('## 5. Acquisition Suggestions');
  ln();
  ln('Priority acquisitions to fill the biggest gaps, organized by domain:');
  ln();

  for (const pd of PRIORITY_DOMAINS) {
    const gaps = pd.codes
      .map(code => {
        const spec = DOMAIN_CATEGORIES[code];
        const n = getNode(nodes, code);
        const count = n?.count || 0;
        const min = spec?.min || 20;
        const deficit = min - count;
        return { code, label: spec?.label || code, count, min, deficit };
      })
      .filter(g => g.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit);

    if (gaps.length === 0) continue;

    ln(`### ${pd.domain}`);
    ln();
    for (const g of gaps) {
      const urgency = g.count === 0 ? 'MISSING' : g.count < g.min / 2 ? 'CRITICAL' : 'LOW';
      ln(`- **\`${g.code}\` ${g.label}**: have ${g.count}, need ~${g.min} (${urgency}) — deficit: ${g.deficit}`);
    }
    ln();

    // Suggest concrete book types
    const suggestions = getAcquisitionSuggestions(pd.domain, gaps);
    if (suggestions) {
      ln(`  *Suggested sources:* ${suggestions}`);
      ln();
    }
  }

  // ── 6. Summary stats ────────────────────────────────────────────
  ln('## 6. Summary');
  ln();
  ln(`| Metric | Value |`);
  ln(`|--------|------:|`);
  ln(`| Domain categories tracked | ${Object.keys(DOMAIN_CATEGORIES).length} |`);
  ln(`| Missing (zero items) | ${missing.length} |`);
  ln(`| Thin (below target) | ${thin.length} |`);
  ln(`| Healthy (at target) | ${healthy.length} |`);
  ln(`| Tree nodes < 10 items | ${smallNodes.length} |`);
  ln(`| Gallery-only categories | ${galleryOnly.length} |`);
  ln(`| Artwork-only categories | ${artworkOnly.length} |`);
  ln();
  ln('---');
  ln('*Generated by `scripts/iconclass-gap-analysis.mjs` for GitHub issue #904*');

  // Output
  const report = lines.join('\n');
  console.log(report);

  await client.close();
}

function getAcquisitionSuggestions(domain, gaps) {
  const suggestions = {
    'Alchemy, Magic & Astrology':
      'Emblem books (Maier *Atalanta Fugiens*, Mylius *Philosophia Reformata*), grimoires (Agrippa, Dee), astrological treatises (Albumasar, Bonatti), alchemical scrolls (Ripley Scroll reproductions)',
    'Classical Mythology':
      'Ovid illustrated editions (Virgil Solis, Tempesta), mythographic compendia (Cartari, Conti), Homer illustration sets (Flaxman), Metamorphoses print series',
    'Emblems & Visual Arts':
      'Alciato *Emblemata* editions, Ripa *Iconologia*, Camerarius *Symbola*, Dutch emblem books (Cats, Roemer Visscher), printer marks collections',
    'Religious Iconography':
      'Legenda Aurea illustrated editions, Eastern Orthodox icon collections, Buddhist/Hindu manuscript art, Islamic geometric pattern books, Kabbalistic diagrams (Knorr von Rosenroth)',
    'Natural Philosophy':
      'Bestiaries (Aberdeen type), herbals (Fuchs, Brunfels), cosmographies (Apian, Sacrobosco), monster books (Aldrovandi, Gesner), element allegories (Beham)',
    'Science & Knowledge':
      'Encyclopedias (Kircher *Mundus Subterraneus*), scientific instruments (Tycho), memory arts (Bruno, Fludd), classification systems (Linnaeus early eds)',
    'Biblical Illustration':
      'Biblia Pauperum, Koberger Bible, Cranach/Luther Bible woodcuts, Doré Bible illustrations, Armenian illuminated Gospels',
    'Anatomy & the Human Body':
      'Vesalius *De Humana Corporis Fabrica*, anatomical fugitive sheets, surgical treatises (Paré), physiognomy (della Porta), proportion studies (Dürer)',
  };
  return suggestions[domain] || null;
}

main().catch(err => { console.error(err); process.exit(1); });
