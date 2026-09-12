#!/usr/bin/env node
/**
 * Acquisition batch for issue #4578 — gaps found by auditing the corpus against
 * an EXTERNALLY defined subject list (the 14 culture-areas of *Lost Cities with
 * Albert Lin*), submitted via MCP feedback 2026-09-01.
 *
 * Three absences were verified against production before this list was built:
 *   - `search=Cieza` → 0 results
 *   - *Periplus Maris Erythraei* → we hold Arrian's and Hanno's periploi, not this
 *   - `Nan Madol` → 0 relevant, `Ponape` → 0
 *
 * Curation notes (step 3 of .claude/docs/import-workflow.md — the manual
 * subject-filter — was done by hand over the enumerate output):
 *   - Every identifier below was picked from `enumerate-dedupe-source.ts` output
 *     or a targeted IA search, and each has a REAL page count from IA's index.
 *     Nothing here is UNKNOWN_SIZE, so no import can silently land a 2-page stub.
 *   - Preference is first-edition scans of the original publication. Modern
 *     reprints and re-uploads (`bwb_*`, `*_2025*`, "University of Illinois Press
 *     2001") were rejected on sight — a PD label describes the WORK, not the
 *     scanned object, and those objects are in copyright.
 *   - Breasted vol. 1 (`ancientrecordsof01brea`) is ALREADY HELD; the enumerate
 *     run flagged it. Only vols 2–5 are here. The reporter listed the whole set.
 *   - Rejected in bulk: the 40-odd `mobotbca_*` volumes. That is the whole
 *     Biologia Centrali-Americana natural-history series (beetles, ferns,
 *     Odonata) — Maudslay's ARCHAEOLOGY volumes are the ones that serve the Maya
 *     subject, and they are the `BiologiaCentral00Maud*` / `gri_*` items below.
 *
 * Everything imports HIDDEN (`hidden: true, visible: false` — the route's own
 * default). Nothing here is published by this script.
 *
 * ACTUATION NOTICE: imageful books auto-enroll in the OCR→translation pipeline.
 * This batch is ~10,600 pages. At the measured 30-day rate ($0.0267/page) full
 * translation would be ~$280 — but the pipeline runs behind the $5/day dial, so
 * this joins a rate-limited queue rather than spending at once. It will draw
 * down that dial for roughly two months if left unscoped.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/archaeology-gaps-4578.mjs --dry-run
 *   node scripts/import/archaeology-gaps-4578.mjs
 */

const API_BASE = 'https://sourcelibrary.org/api/import/ia';
const CRON_SECRET = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const books = [
  // ─── 1. Periplus Maris Erythraei ────────────────────────────────────────
  // Serves Petra, Oman/Magan and Kush/Adulis at once. The central text for
  // ancient Indian Ocean trade, and the #1 item on the reporter's ranked list.
  {
    ia_identifier: 'periplusoferythr00schouoft',
    title: 'The Periplus of the Erythraean Sea: Travel and Trade in the Indian Ocean by a Merchant of the First Century',
    author: 'Schoff, Wilfred H. (translator)',
    year: 1912,
    language: 'English',
    original_language: 'Greek',
    pages: 344,
  },

  // ─── 2. Cieza de León ───────────────────────────────────────────────────
  // Confirmed absent: `search=Cieza` returned 0. Serves Inca, Chachapoya and
  // Andean flood traditions. Taking both the English translation and a 16th-c.
  // edition — ad fontes, the Italian 1550s printing is far closer to the source
  // than Markham's Victorian Hakluyt volume.
  {
    ia_identifier: '10465852bsb',
    title: 'The Travels of Pedro de Cieza de León, A.D. 1532–50, contained in the First Part of his Chronicle of Peru',
    author: 'Cieza de León, Pedro de',
    year: 1864,
    language: 'English',
    original_language: 'Spanish',
    pages: 541,
  },
  {
    ia_identifier: 'hin-wel-all-00000225-001',
    title: "La prima parte dell'istorie del Perù",
    author: 'Cieza de León, Pedro de',
    year: 1556,
    language: 'Italian',
    original_language: 'Spanish',
    pages: 469,
  },

  // ─── 3. Breasted, Ancient Records of Egypt (1906) ───────────────────────
  // Kushite royal inscriptions in translation. Vol. 1 already held.
  {
    ia_identifier: 'ancientrecordsof02brea',
    title: 'Ancient Records of Egypt, Volume II: The Eighteenth Dynasty',
    author: 'Breasted, James Henry',
    year: 1906,
    language: 'English',
    pages: 464,
  },
  {
    ia_identifier: 'ancientrecordsof03brea',
    title: 'Ancient Records of Egypt, Volume III: The Nineteenth Dynasty',
    author: 'Breasted, James Henry',
    year: 1906,
    language: 'English',
    pages: 318,
  },
  {
    ia_identifier: 'ancientrecordsof04brea',
    title: 'Ancient Records of Egypt, Volume IV: The Twentieth to the Twenty-Sixth Dynasties',
    author: 'Breasted, James Henry',
    year: 1906,
    language: 'English',
    pages: 270,
  },
  {
    ia_identifier: 'ancientrecordsof05brea',
    title: 'Ancient Records of Egypt, Volume V: Indices',
    author: 'Breasted, James Henry',
    year: 1906,
    language: 'English',
    pages: 226,
  },

  // ─── 4. Cooke, North-Semitic Inscriptions (1903) ────────────────────────
  // Nabataean, Phoenician and Moabite with translations — serves Petra AND the
  // Canaanites, the two subjects the audit found richest in external testimony
  // and emptiest of internal voice.
  {
    ia_identifier: 'textbookofnorths00cookuoft',
    title: 'A Text-Book of North-Semitic Inscriptions: Moabite, Hebrew, Phoenician, Aramaic, Nabataean, Palmyrene, Jewish',
    author: 'Cooke, George Albert',
    year: 1903,
    language: 'English',
    pages: 470,
  },

  // ─── 5. Knudtzon, Die El-Amarna-Tafeln (1915) ──────────────────────────
  // The Canaanite city-kings in their own words. The audit found the Amarna
  // letters DISCUSSED in three books we hold (Rogers, Jastrow, King) and held
  // in none.
  {
    ia_identifier: 'dieelamarnatafel01knud',
    title: 'Die El-Amarna-Tafeln, mit Einleitung und Erläuterungen, Band 1: Die Texte',
    author: 'Knudtzon, J. A.',
    year: 1915,
    language: 'German',
    original_language: 'Akkadian',
    pages: 1028,
  },
  {
    ia_identifier: 'dieelamarnatafel02knud',
    title: 'Die El-Amarna-Tafeln, mit Einleitung und Erläuterungen, Band 2: Anmerkungen und Register',
    author: 'Knudtzon, J. A.',
    year: 1915,
    language: 'German',
    original_language: 'Akkadian',
    pages: 626,
  },

  // ─── 6. Christian, The Caroline Islands (1899) ─────────────────────────
  // The first survey of Nan Madol, and the only route into a subject the audit
  // found entirely void. Our sole prior trace of this book was a publisher's
  // advertisement bound into the back matter of a book about Medici Florence.
  {
    ia_identifier: 'cu31924023239506',
    title: 'The Caroline Islands: Travel in the Sea of the Little Lands',
    author: 'Christian, F. W.',
    year: 1899,
    language: 'English',
    pages: 559,
  },

  // ─── 7. Frazer, Folk-Lore in the Old Testament (1918) ──────────────────
  // The global flood-myth catalogue. We hold The Golden Bough and not this.
  {
    ia_identifier: 'cu31924032331435',
    title: 'Folk-Lore in the Old Testament: Studies in Comparative Religion, Legend and Law, Volume I',
    author: 'Frazer, James George',
    year: 1918,
    language: 'English',
    pages: 604,
  },
  {
    ia_identifier: 'folkloreintheold02frazuoft',
    title: 'Folk-Lore in the Old Testament: Studies in Comparative Religion, Legend and Law, Volume II',
    author: 'Frazer, James George',
    year: 1918,
    language: 'English',
    pages: 608,
  },
  {
    ia_identifier: 'folkloreintheol03frazuoft',
    title: 'Folk-Lore in the Old Testament: Studies in Comparative Religion, Legend and Law, Volume III',
    author: 'Frazer, James George',
    year: 1918,
    language: 'English',
    pages: 600,
  },

  // ─── 8. Mesopotamian royal inscriptions ────────────────────────────────
  // The reporter's "also worth queueing" tier. These are the inscription
  // corpora behind the structural diagnosis: we hold arguments ABOUT antiquity
  // and not antiquity, because epigraphy publishes as academy plates rather
  // than trade books.
  {
    ia_identifier: 'ancient_records_assyria1',
    title: 'Ancient Records of Assyria and Babylonia, Volume I: Historical Records of Assyria from the Earliest Times to Sargon',
    author: 'Luckenbill, Daniel David',
    year: 1926,
    language: 'English',
    original_language: 'Akkadian',
    pages: 313,
  },
  {
    ia_identifier: 'ancient_records_assyria2',
    title: 'Ancient Records of Assyria and Babylonia, Volume II: Historical Records of Assyria from Sargon to the End',
    author: 'Luckenbill, Daniel David',
    year: 1927,
    language: 'English',
    original_language: 'Akkadian',
    pages: 513,
  },
  {
    ia_identifier: 'diesumerischenun00thuruoft',
    title: 'Die sumerischen und akkadischen Königsinschriften (Vorderasiatische Bibliothek I)',
    author: 'Thureau-Dangin, François',
    year: 1907,
    language: 'German',
    original_language: 'Sumerian',
    pages: 308,
  },
  {
    ia_identifier: 'royalinscription00bart',
    title: 'The Royal Inscriptions of Sumer and Akkad',
    author: 'Barton, George Aaron',
    year: 1929,
    language: 'English',
    original_language: 'Sumerian',
    pages: 440,
  },

  // ─── 9. Picts ──────────────────────────────────────────────────────────
  // The audit found us good on Roman/Anglo-Saxon outsiders (Bede, Tacitus,
  // Ammianus, Claudian) and missing every insular source.
  {
    ia_identifier: 'chroniclesofpict00sken',
    title: 'Chronicles of the Picts, Chronicles of the Scots, and Other Early Memorials of Scottish History',
    author: 'Skene, William F.',
    year: 1867,
    language: 'English',
    pages: 716,
  },
  {
    ia_identifier: 'lifeofsaintcolum00adamuoft',
    title: 'Life of Saint Columba, Founder of Hy, Written by Adamnan',
    author: 'Adamnan of Iona',
    year: 1874,
    language: 'English',
    original_language: 'Latin',
    pages: 589,
  },

  // ─── 10. Kush / Meroë ──────────────────────────────────────────────────
  // "Not one Kushite word" was the audit's finding. Meroitic epigraphy is the
  // narrowest available fix.
  {
    ia_identifier: 'karanogmeroitici00grif',
    title: 'Karanòg: The Meroitic Inscriptions of Shablûl and Karanòg',
    author: 'Griffith, F. Ll.',
    year: 1911,
    language: 'English',
    original_language: 'Meroitic',
    pages: 262,
  },

  // ─── 11. Maya ──────────────────────────────────────────────────────────
  // We already hold all three surviving codices, Landa, Popol Vuh and Brinton.
  // These are the named gaps.
  {
    ia_identifier: 'b2935030x_0001',
    title: 'Incidents of Travel in Central America, Chiapas, and Yucatan, Volume I',
    author: 'Stephens, John Lloyd',
    year: 1841,
    language: 'English',
    pages: 520,
  },
  {
    ia_identifier: 'b2935030x_0002',
    title: 'Incidents of Travel in Central America, Chiapas, and Yucatan, Volume II',
    author: 'Stephens, John Lloyd',
    year: 1841,
    language: 'English',
    pages: 644,
  },
  {
    ia_identifier: 'BiologiaCentral00MaudA',
    title: 'Biologia Centrali-Americana: Archaeology, Volume I (Plates)',
    author: 'Maudslay, Alfred Percival',
    year: 1889,
    language: 'English',
    pages: 220,
  },
  {
    ia_identifier: 'BiologiaCentral00MaudB',
    title: 'Biologia Centrali-Americana: Archaeology, Volume II (Plates)',
    author: 'Maudslay, Alfred Percival',
    year: 1889,
    language: 'English',
    pages: 186,
  },

  // ─── 12. Stonehenge ────────────────────────────────────────────────────
  // The best-served subject we hold — the full 17th–19th c. dispute as a running
  // argument. Geoffrey's Historia is the one named absence (we hold only his
  // Prophetia Merlini). San-Marte's 1854 edition carries the Latin text.
  {
    ia_identifier: 'historiaregumbr00schugoog',
    title: 'Historia Regum Britanniae',
    author: 'Geoffrey of Monmouth',
    year: 1854,
    language: 'Latin',
    original_language: 'Latin',
    pages: 717,
  },
];

async function importBook(book, i) {
  const label = `[${String(i + 1).padStart(2)}/${books.length}] ${book.title.slice(0, 60)}`;
  if (DRY_RUN) {
    console.log(`${label}\n     ${book.ia_identifier} — ${book.pages}pp, ${book.year}, ${book.language}`);
    return { success: true, dryRun: true, title: book.title };
  }
  try {
    const { pages, ...payload } = book;
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`${label}\n     ✓ ${data.id || data._id} (${data.pages_count ?? '?'}pp)`);
      return { success: true, title: book.title, id: data.id || data._id, pages: data.pages_count };
    }
    // 409 is the dedup gate doing its job, not a failure.
    const why = data.error || data.message || `HTTP ${res.status}`;
    console.log(`${label}\n     ${res.status === 409 ? '=' : '✗'} ${why}`);
    return { success: false, duplicate: res.status === 409, title: book.title, error: why };
  } catch (err) {
    console.log(`${label}\n     ✗ ${err.message}`);
    return { success: false, title: book.title, error: err.message };
  }
}

async function main() {
  const totalPages = books.reduce((n, b) => n + (b.pages || 0), 0);
  console.log('=== Acquisition batch #4578: archaeological-subject gaps ===');
  console.log(`Books: ${books.length}   Pages: ~${totalPages.toLocaleString()}   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('All imports land HIDDEN (visible:false, hidden:true).\n');

  const results = [];
  for (let i = 0; i < books.length; i++) {
    results.push(await importBook(books[i], i));
    if (i < books.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  const ok = results.filter(r => r.success && !r.dryRun);
  const dupes = results.filter(r => r.duplicate);
  const failed = results.filter(r => !r.success && !r.duplicate);

  console.log('\n=== SUMMARY ===');
  console.log(`Imported:        ${ok.length}/${books.length}`);
  console.log(`Already held:    ${dupes.length}  (dedup gate)`);
  console.log(`Failed:          ${failed.length}`);
  if (ok.length) {
    const got = ok.reduce((n, r) => n + (r.pages || 0), 0);
    console.log(`Pages acquired:  ${got.toLocaleString()}`);
  }
  for (const f of failed) console.log(`  ✗ ${f.title.slice(0, 60)} — ${f.error}`);
  for (const d of dupes) console.log(`  = ${d.title.slice(0, 60)}`);
  if (ok.length) {
    console.log('\nNext: these are hidden and unprocessed. They auto-enroll in the');
    console.log('pipeline, which runs behind the $5/day dial — check scope before');
    console.log('expecting them to move (`set-dial.mjs --show`).');
  }
}

main().catch(console.error);
