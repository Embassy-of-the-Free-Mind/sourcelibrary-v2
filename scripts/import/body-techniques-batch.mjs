#!/usr/bin/env node
/**
 * Acquisition batch: techniques of the body — the Western and other-tradition
 * instruction manuals the corpus lacks (Map of the Body thread, 2026-09-14).
 *
 * PRIOR ART: scripts/import/greek-five-authors-batch.mjs — same shape (a hand-
 *   checked IA id list posted to /api/import/ia, dupes 409); copied rather than
 *   generalised because the list IS the review. scripts/import/ia-bundle-import.mjs
 *   does not fit (multi-file bundle items, not single IA items).
 *
 * Why these: the Chinese and Sanskrit manuals we hold are prescriptive (named
 * posture, count, hour). Nothing Western in the corpus is — the body is written
 * down inside rubrics, regimens and fencing books. These are the Western
 * prescriptive manuals that exist as public-domain scans, plus the two
 * non-Western gaps the thread surfaced (Abulafia's breath-and-letter method as a
 * manuscript; the Hopi and Mexica ceremony accounts with step-by-step movement).
 *
 * Every item was probed against archive.org/metadata on 2026-09-14: none is
 * lending-restricted, all carry a _jp2.zip. Two candidates from themes/body/GAPS.md
 * were DROPPED on probing: `HEKC185502/05/07` is 遐邇貫珍 (a Hong Kong missionary
 * serial), not the Yijin jing — the earlier trigram probe matched noise; and
 * `dephilostratili00cobegoog` (Philostratus, Gymnasticus) is PDF-only (no jp2).
 * Not on IA at all: Caroso, Negri, Fiore, Capo Ferro, Meyer.
 *
 * Imports land HIDDEN (the route sets visible:false + hidden:true). Flip to
 * visible only after an OCR/translation QA pass — see .claude/docs/import-workflow.md.
 * Spend is metered by the `body-techniques-2026-09` scope envelope
 * (scripts/maintenance/set-scope.mjs --show); add the returned bookIds to it.
 *
 * `lang` is the EDITION's language, `orig` the SOURCE WORK's — two fields, both
 * wanted by the route (see greek-five for the incident when they were confused).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/body-techniques-batch.mjs --dry-run
 *   node scripts/import/body-techniques-batch.mjs --commit
 */

const COMMIT = process.argv.includes('--commit');
const CRON_SECRET = process.env.CRON_SECRET;
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }
const BASE = 'https://sourcelibrary.org/api/import/ia';

const BOOKS = [
  // ── DANCE ──────────────────────────────────────────────────────────────────
  // The first dance manual to tabulate steps against the music, bar by bar.
  { id: 'danceman219', title: 'Orchésographie, et traicté en forme de dialogue, par lequel toutes personnes peuvent facilement apprendre & practiquer l’honneste exercice des dances', author: 'Thoinot Arbeau (Jehan Tabourot)', year: 1589, lang: 'French', orig: null },

  // ── FENCING — the named position, the foot, the count ──────────────────────
  // Held already: Thibault, Académie de l'espée (1630), 341/448 pp translated.
  { id: 'bub_gb_63s8AAAAcAAJ', title: 'Opera nova de l’arte de l’armi', author: 'Achille Marozzo', year: 1550, lang: 'Italian', orig: null },
  { id: 'scienzaepraticad00fabr', title: 'Scienza e pratica d’arme (Leipzig edition, Italian with German)', author: 'Salvator Fabris (ed. Johann Joachim Hynitzsch)', year: 1677, lang: 'Italian', orig: 'Italian' },
  { id: 'talhoffersfechtb00talhuoft', title: 'Talhoffers Fechtbuch aus dem Jahre 1467: gerichtliche und andere Zweikämpfe darstellend (Hergsell facsimile)', author: 'Hans Talhoffer (ed. Gustav Hergsell)', year: 1887, lang: 'German', orig: 'German' },

  // ── KABBALAH — the breath, the letters, the movements of the head ──────────
  // Held already: Abulafia, Collection of kabbalistic works (sefirotic commentary,
  // no technique) and the Complete Writings (50/2,707 pp OCR — in bucket A).
  // This is a manuscript of the technique text itself (Braginsky BC 251).
  { id: 'AbulafiaLifeOfTheWorldToCome', title: 'Ḥayyei ha-ʿOlam ha-Ba (Life of the World to Come) — Braginsky Collection MS BC 251', author: 'Abraham Abulafia', year: 1280, lang: 'Hebrew', orig: 'Hebrew' },

  // ── CEREMONY — movement written down by witnesses ──────────────────────────
  // English: no translation will run; OCR only.
  { id: 'hopikatcinasdraw00fewk', title: 'Hopi Katcinas Drawn by Native Artists (BAE Annual Report 21)', author: 'Jesse Walter Fewkes', year: 1903, lang: 'English', orig: null },
  { id: 'oraibipowamucere32voth', title: 'The Oraibi Powamu Ceremony (Field Columbian Museum, Anthropological Series III.2)', author: 'H. R. Voth', year: 1901, lang: 'English', orig: null },
  { id: 'oraibisoyalcerem31dors', title: 'The Oraibi Soyal Ceremony (Field Columbian Museum, Anthropological Series III.1)', author: 'George A. Dorsey and H. R. Voth', year: 1901, lang: 'English', orig: null },
  // Spanish, 1581 text in the 1867–80 Mexico edition: the chapter on the dances.
  { id: 'historiadelasind01dur', title: 'Historia de las Indias de Nueva España y islas de Tierra Firme, tomo I', author: 'Diego Durán (ed. José F. Ramírez)', year: 1867, lang: 'Spanish', orig: 'Spanish' },
  { id: 'historiadelasind02dur', title: 'Historia de las Indias de Nueva España y islas de Tierra Firme, tomo II', author: 'Diego Durán (ed. José F. Ramírez)', year: 1880, lang: 'Spanish', orig: 'Spanish' },
];

async function importOne(b, attempt = 1) {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ ia_identifier: b.id, title: b.title, author: b.author, year: b.year, language: b.lang, ...(b.orig ? { original_language: b.orig } : {}) }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await res.json();
    if (res.ok && data.success) return { id: b.id, ok: true, pages: data.pagesCreated, bookId: data.bookId };
    if (res.status === 409) return { id: b.id, ok: false, dupe: true, err: `already held (${data.bookId || data.existingId || '?'})` };
    if (attempt < 3 && /timed out|MongoNetwork|ECONN|502|504/i.test(JSON.stringify(data))) {
      await new Promise(r => setTimeout(r, 5000));
      return importOne(b, attempt + 1);
    }
    return { id: b.id, ok: false, err: data.error || data.details || JSON.stringify(data).slice(0, 140) };
  } catch (e) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 5000)); return importOne(b, attempt + 1); }
    return { id: b.id, ok: false, err: e.message };
  }
}

async function main() {
  console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${BOOKS.length} editions (techniques of the body: dance, fencing, Abulafia MS, ceremony)\n`);
  if (!COMMIT) { BOOKS.forEach(b => console.log(`  · ${String(b.year).padEnd(5)} ${b.lang.padEnd(8)} ${b.title.slice(0, 70)}`)); return; }
  const results = [];
  for (const b of BOOKS) {
    const r = await importOne(b);
    results.push(r);
    console.log(`  ${r.ok ? '✓' : '✗'} ${b.id.slice(0, 42).padEnd(42)} ${r.ok ? `${r.pages}p → ${r.bookId}` : (r.dupe ? 'DUPE ' : 'ERR ') + r.err}`);
    await new Promise(r => setTimeout(r, 2500));
  }
  const ok = results.filter(r => r.ok);
  console.log(`\nDone: ${ok.length}/${results.length} imported, ${ok.reduce((s, r) => s + (r.pages || 0), 0)} pages.`);
  // The envelope needs these ids — print them in the form set-scope.mjs --books takes.
  if (ok.length) console.log(`\nbook ids for set-scope --books:\n${ok.map(r => r.bookId).join(',')}`);
  const dupes = results.filter(r => r.dupe);
  if (dupes.length) console.log(`Already held (${dupes.length}): ${dupes.map(r => r.id).join(', ')}`);
  const failed = results.filter(r => !r.ok && !r.dupe);
  if (failed.length) console.log(`FAILED (${failed.length}): ${failed.map(r => `${r.id} — ${r.err}`).join('; ')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
