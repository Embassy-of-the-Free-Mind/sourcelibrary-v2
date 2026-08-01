#!/usr/bin/env node
/**
 * Clear work titles and bibliographic placeholders sitting in `books.author`
 * (#3483, the second wave of the #3434 class).
 *
 * WHY THESE, AND WHY BY STRING. #3434's repair keyed on a literal list of book
 * ids because the defect was a *person's* name on the wrong book — the name is
 * valid, only the pairing is wrong, so each pairing had to be judged. Here the
 * defect is the string itself: "Iamblichus De Mysteriis" is a work title, "S.n"
 * is `sine nomine`, "? (s.l.)" is `sine loco`. None is a personal name in any
 * context, on any book, so the verified unit is the STRING and matching on it
 * cannot widen the blast radius the way a heuristic would. Every string below
 * was read against every book wearing it (see the audit dump in #3483).
 *
 * Two mechanisms are represented, and both end at "this is not an author":
 *
 *   1. SEARCH-TERM CONTAMINATION — the 2026-03-14 BSB run stamped its query into
 *      `books.author`, so full-text hits on a title landed catalogues that merely
 *      LIST that title. "Fludd Medicina" wears a 1723 rare-book catalogue;
 *      "Kabbala Denudata" wears a description of German libraries; "Chaldaean
 *      Oracles" wears three volumes of Collectanea de Rebus Hibernicis.
 *
 *   2. TITLE-AS-AUTHOR ON ITS OWN WORK — the book really is the named work, but
 *      the work is anonymous or compiled, so the title is still not the author.
 *      The 1616 *Fama Fraternitatis*, the 1500 *Rosarium Philosophorum*, and the
 *      1661 *Theatrum Chemicum* volume six are these. Zetzner compiled the
 *      Theatrum; naming the book as its own author states something false about
 *      how it was made.
 *
 * UNSET, NOT REPLACED — same reasoning as #3434. These are anonymous and
 * corporate works; inventing a personal name would substitute a second
 * fabrication for the first. An unset author renders as unattributed, which is
 * what these records honestly are. The books stay visible: they are genuine
 * primary sources, and only the attribution was wrong.
 *
 * DELIBERATELY EXCLUDED — each needs a curatorial decision this script must not
 * make for it:
 *   - "Splendor Solis" on 13 Wikimedia Commons ARTWORK records. These are plates
 *     from the Splendor Solis manuscript, so the string names their true source
 *     rather than a spurious match. Only the 7 Bayerische Staatsbibliothek BOOK
 *     records under that string (Golden Fleece editions, a 1749 news weekly) are
 *     the #3434 contamination, and they are listed by id below.
 *   - "Corpus juris civilis" (12 books). The books are genuinely Justinian's
 *     codices, so the answer is probably to CORRECT the author to Justinian I,
 *     not to clear it. Correcting is not this script's job.
 *   - "Elzevir Respublica Series" (14). A publisher's series name; each volume
 *     has its own author to be resolved individually.
 *   - Institutions and "Anonymous"/"Unknown" (~18 thesaurus docs). These are
 *     legitimate corporate and anonymous attributions, not errors. They are
 *     handled on the READ side by the non-person rendering (#3483), not here.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-work-title-authors-3483.mjs            # dry-run
 *   node scripts/maintenance/repair-work-title-authors-3483.mjs --apply
 *   node scripts/maintenance/repair-work-title-authors-3483.mjs --revert   # from backup
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/work-title-authors-3483-backup.json';

/**
 * Author strings that are never a personal name. Cleared on EVERY book wearing
 * the string exactly — visible and hidden alike. Hidden matters: 612 of the
 * `[s.n.]` records sit in `launch_curation`, so leaving them would reintroduce a
 * false byline the moment any of them is made visible.
 */
const BOGUS_AUTHOR_STRINGS = [
  // ── work titles, 2026-03-14 BSB search-term contamination ──
  { s: 'Iamblichus De Mysteriis', why: 'work title; wears 5 bookseller/library catalogues 1682-1796' },
  { s: 'Confessio Fraternitatis', why: 'work title; wears 16 editions of the Augsburg Confession ("Confessio" collision)' },
  { s: 'Porta Magia Naturalis', why: 'work title; wears 7 vols of Storia letteraria d\'Italia + a print catalogue' },
  { s: 'Philosophia Reformata', why: 'work title; wears banned-book indexes and library catalogues 1667-1799' },
  { s: 'Fludd Medicina', why: 'search string; wears rare-book and Aulic Commission catalogues 1723-1793' },
  { s: 'Theatrum Sympatheticum', why: 'work title; wears Ortelius-style geographies and a 1733 Reichstag theatre' },
  { s: 'Chaldaean Oracles', why: 'work title; wears 3 vols of Collectanea de Rebus Hibernicis' },
  { s: 'John Dee Monas', why: 'search string; wears 3 bookseller catalogues 1592-1807' },
  { s: 'Kabbala Denudata', why: 'work title; wears 2 German library descriptions and an Upanishads edition' },
  { s: 'Albertus Secrets', why: 'search string; wears 3 bookshop catalogues 1681-1819' },
  { s: 'Viridarium Chymicum', why: 'work title; wears a poets\' anthology and a Marian devotional garden' },
  { s: 'Tripus Aureus', why: 'work title; wears 2 library catalogues 1622/1698' },
  { s: 'Kircher Ars Magna', why: 'search string; wears the 1783 Göttingische Anzeigen' },
  { s: 'Kircher Oedipus', why: 'search string; wears 6 German and Italian literary periodicals 1781-1814' },
  { s: 'Kircher Musurgia', why: 'search string; wears the 1817 Allgemeine musikalische Zeitung' },
  { s: 'Kircher Mundus', why: 'search string; wears a 1711 deed of gift to found the Bologna institute' },
  { s: 'Museum Hermeticum', why: 'work title; wears an 1820 catalogue of Old German paintings' },
  // ── title-as-author on the work itself (anonymous / compiled works) ──
  { s: 'Fama Fraternitatis', why: 'anonymous Rosicrucian manifesto; the title is not its author' },
  { s: 'Rosarium Philosophorum', why: 'anonymous compilation; also wears 2 unrelated catalogues' },
  { s: 'Theatrum Chemicum', why: 'compiled by Zetzner; also wears the 1614 Frankfurt fair catalogue' },
  { s: 'Turba Philosophorum', why: 'anonymous work; also wears 4 Theatrum Chemicum vols and a 1706 satire' },
  { s: 'Statuta', why: 'first word of the title of 2 e-rara Savoy statute books' },
  // ── bibliographic placeholders: sine nomine / sine loco, never a name ──
  { s: '[s.n.]', why: 'sine nomine — cataloguer placeholder for an unnamed publisher (e-rara)' },
  { s: 'S.n', why: 'sine nomine (Allard Pierson)' },
  { s: '? (s.l.)', why: 'sine loco — unknown author and place (Allard Pierson)' },
  { s: '? (s.l. [Rotterdam])', why: 'sine loco with a conjectured place' },
  { s: '? (s.l. [Groningen])', why: 'sine loco with a conjectured place' },
  { s: '? (s.l. [Amsterdam?])', why: 'sine loco with a conjectured place' },
  { s: '? (Amsterdam)', why: 'place-only placeholder in the author field' },
  { s: 'AnonymousUnknown author', why: 'two placeholders concatenated by an importer; Wikimedia artwork records' },
  { s: 'UnknownUnknown', why: 'placeholder doubled by an importer; a Wikimedia artwork record' },
];

/**
 * "Splendor Solis" is cleared only on these 7 Bayerische Staatsbibliothek BOOK
 * records — the search-term contamination. The 13 Wikimedia artwork records
 * under the same string are plates from the manuscript and are left alone.
 */
const SPLENDOR_SOLIS_BOOKS = [
  { id: '69b51cee47b06ecd58182536', year: 1598, why: 'Golden Fleece (Aureum Vellus) — different work' },
  { id: '69b51cf447b06ecd58182733', year: 1599, why: 'Golden Fleece (Aureum Vellus) — different work' },
  { id: '69b51cf647b06ecd58182836', year: 1599, why: 'Golden Fleece (Aureum Vellus) — different work' },
  { id: '69b51db2cf111105c428e461', year: 1599, why: 'Golden Fleece (Aureum Vellus) — different work' },
  { id: '69b51de5efd8df28f2dac9dd', year: 1718, why: "Opened Secrets of the Philosopher's Stone — different work" },
  { id: '69b51de8efd8df28f2dad0b9', year: 1723, why: 'Royal Hermetic Special Concordance — different work' },
  { id: '69b51df1cf111105c4293bbc', year: 1749, why: 'Weekly News of Learned Matters 1749 — a periodical' },
];

// Fields that carry or derive from the wrong attribution.
const ATTRIBUTION_FIELDS = ['author', 'author_id', 'author_entity_id', 'normalized_author'];

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

// ── revert ───────────────────────────────────────────────────────────────────
if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP} — nothing to revert.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const row of saved.records) {
    const restore = {};
    for (const f of ATTRIBUTION_FIELDS) if (row.before[f] !== undefined) restore[f] = row.before[f];
    if (!Object.keys(restore).length) continue;
    const r = await books.updateOne({ id: row.id }, { $set: restore });
    n += r.modifiedCount;
  }
  console.log(`Reverted attribution fields on ${n} of ${saved.records.length} records from ${saved.created_at}.`);
  await mc.close();
  process.exit(0);
}

// ── collect targets ──────────────────────────────────────────────────────────
const PROJECTION = {
  id: 1, title: 1, display_title: 1, author: 1, author_id: 1, author_entity_id: 1,
  normalized_author: 1, year: 1, visible: 1, content_type: 1,
};

/** @type {{ b: any, why: string, wrong: string }[]} */
const targets = [];

for (const { s, why } of BOGUS_AUTHOR_STRINGS) {
  const found = await books.find({ author: s }, { projection: PROJECTION }).toArray();
  for (const b of found) targets.push({ b, why, wrong: s });
}

for (const { id, why } of SPLENDOR_SOLIS_BOOKS) {
  const b = await books.findOne({ id }, { projection: PROJECTION });
  if (!b) { console.warn(`  ! Splendor Solis target ${id} not found — skipping`); continue; }
  // Guard: refuse to touch a record whose author is no longer what we verified.
  // An absent author means a previous run already cleared it — this script is
  // re-run as the audit surfaces more strings, so that is the normal case and
  // must not read as an alarm. A DIFFERENT author means someone corrected it by
  // hand since verification, and a blind unset would destroy that work.
  if (b.author == null || String(b.author).trim() === '') continue;
  if (String(b.author).trim() !== 'Splendor Solis') {
    console.warn(`  ! ${id} author is now "${b.author}" (expected "Splendor Solis") — skipping, re-verify`);
    continue;
  }
  targets.push({ b, why, wrong: 'Splendor Solis' });
}

const visible = targets.filter((t) => t.b.visible === true);
const hidden = targets.filter((t) => t.b.visible !== true);

// ── report ───────────────────────────────────────────────────────────────────
const byString = new Map();
for (const t of targets) {
  if (!byString.has(t.wrong)) byString.set(t.wrong, { vis: 0, hid: 0, why: t.why });
  const row = byString.get(t.wrong);
  if (t.b.visible === true) row.vis++; else row.hid++;
}
console.log('author string                          visible  hidden   why');
console.log('─'.repeat(110));
for (const [s, r] of byString) {
  console.log(`${`"${s}"`.padEnd(38)} ${String(r.vis).padStart(7)} ${String(r.hid).padStart(7)}   ${r.why}`);
}
console.log('─'.repeat(110));
console.log(`${'TOTAL'.padEnd(38)} ${String(visible.length).padStart(7)} ${String(hidden.length).padStart(7)}   ${targets.length} records`);

if (!APPLY) {
  console.log(`\nDRY-RUN. ${targets.length} records would have ${ATTRIBUTION_FIELDS.join(', ')} unset.`);
  console.log('Re-run with --apply to write.');
  await mc.close();
  process.exit(0);
}

// ── back up BEFORE writing, then write ───────────────────────────────────────
// MERGE into any existing backup rather than overwriting it. This script is
// re-run as new bogus strings surface from the audit, and each run only sees
// the books still wearing a listed string — the ones cleared last time no
// longer match. A plain overwrite would therefore replace a backup of 770
// records with one of 15, silently stranding --revert for everything already
// repaired. On a collision the EARLIER `before` wins: it is the true original.
mkdirSync(dirname(BACKUP), { recursive: true });
const priorRecords = existsSync(BACKUP)
  ? (JSON.parse(readFileSync(BACKUP, 'utf8')).records ?? [])
  : [];
const merged = new Map(priorRecords.map((r) => [r.id, r]));
let freshCount = 0;
for (const { b, why, wrong } of targets) {
  if (merged.has(b.id)) continue;   // keep the original pre-repair state
  freshCount++;
  merged.set(b.id, {
    id: b.id,
    title: b.display_title || b.title,
    visible: b.visible === true,
    wrong,
    why,
    before: Object.fromEntries(ATTRIBUTION_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])),
  });
}
writeFileSync(BACKUP, JSON.stringify({
  issue: 3483,
  related: 3434,
  created_at: new Date().toISOString(),
  note: 'Pre-repair attribution fields, accumulated across runs. Restore with --revert.',
  records: [...merged.values()],
}, null, 2));
console.log(`\nBackup: ${BACKUP} — ${freshCount} new, ${merged.size} total records`);

let modified = 0;
for (const { b, why, wrong } of targets) {
  const r = await books.updateOne(
    { id: b.id, author: wrong },   // re-assert the guard at write time
    {
      $unset: Object.fromEntries(ATTRIBUTION_FIELDS.map((f) => [f, ''])),
      $set: {
        updated_at: new Date(),
        'field_provenance.author': {
          source: 'maintenance',
          method: 'manual-verification',
          script: 'repair-work-title-authors-3483.mjs',
          issue: 3483,
          date: new Date(),
          action: 'cleared',
          previous_value: wrong,
          note: why,
        },
      },
    },
  );
  modified += r.modifiedCount;
}
console.log(`APPLIED: cleared attribution on ${modified} of ${targets.length} records.`);
if (modified !== targets.length) {
  console.error(`WARNING: ${targets.length - modified} writes did not match — re-run the audit before assuming success.`);
}

console.log(`\nNext: ${visible.length} of these are VISIBLE, so refresh the Supabase catalogue`);
console.log('mirror (scripts/maintenance/sync-books-catalog.mjs) and revalidate the affected');
console.log('/book and /author pages, then purge Cloudflare (see CLAUDE.md).');
await mc.close();
