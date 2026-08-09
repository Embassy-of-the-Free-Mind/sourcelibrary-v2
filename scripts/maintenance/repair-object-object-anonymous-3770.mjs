#!/usr/bin/env node
/**
 * The second half of #3770 — the 146 books whose MDZ manifest has NO Creator
 * field. Sampling shows why no automation may attribute them: the manifests'
 * Contributor field mixes true authors (Cardilucius on his own Magnalia) with
 * referenced authors (Schröder on an appendix TO his pharmacopoeia) and
 * translators (Lange, "übersetzet durch J. L.") — mapping Contributor to
 * author would recreate the editor-as-author trap (#3434: never guess).
 *
 * So: author is UNSET (an anonymous imprint honestly has no author), the
 * propagated pollution goes (slug regenerated title-only, local:n:object:
 * work_id unset, identity fields restamped), and everything recoverable is
 * PRESERVED in field_provenance.author for future human attribution:
 * the "By" statement of responsibility and the Contributor names verbatim.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-object-object-anonymous-3770.mjs            # dry-run
 *   node --env-file=.env.production.local scripts/maintenance/repair-object-object-anonymous-3770.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { appendFileSync, mkdirSync } from 'node:fs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/output/object-object-anonymous-3770-backup.jsonl';
const BAD = '[object Object]';

// Hand-reviewed 2026-08-09 against each manifest's statement of responsibility
// ("By") — books where the statement EXPLICITLY names the author, or the title
// itself is the attribution (Aureum Vellus "Von ... Salomone Trißmosino"). Not
// inferred from Contributor role, which mixes authors with translators and
// referenced authors. Everything not listed here — excerpt anthologies,
// Problemata compilations, academic funeral broadsides, pseudonymous
// initialisms — is honestly anonymous and gets the unset path.
const ATTRIBUTE = new Map([
  ['6a4a57fb9050f0b4342e381b', 'Wecker, Johann Jacob'],        // De secretis "digesti & aucti per Ioan. Iacobum Weckerum"
  ['6a4a58259050f0b4342e5c0d', 'Cardilucius, Johannes Hiskias'], // Magnalia continuata "publiciret von Johanne Hiskia Cardilucio"
  ['6a4a58759050f0b4342eaf71', 'Trismosin, Salomon'],          // Aureum Vellus "Von ... Salomone Trißmosino"
  ['6a4a5ac19050f0b434308ccc', 'Trismosin, Salomon'],          // Aureum Vellus (second printing)
  ['6a4a593b9050f0b4342f4d45', 'Dippel, Johann Conrad'],       // Microcosmische Vorspiele — sole contributor, standard attribution
  ['6a4a595c9050f0b4342f6e7a', 'Libavius, Andreas'],           // "autore Andrea Libavio"
  ['6a4a5bc79050f0b434314f6b', 'Emrich, Heinrich'],            // Mercurius catholicus "... Henrico Emrici"
  ['6a4a5cc29050f0b43431fdb7', 'Meier, David'],                // Oeconomie "von ..." + sole contributor
  ['6a504cde78825bd7fdd97325', 'Kazenberger, Kilian'],         // "Authore P. F. Kiliano Kazenberger"
  ['6a504ce678825bd7fdd9785f', 'Kazenberger, Kilian'],
  ['6a5075e078825bd7fde1d381', 'Possel, Johann'],              // Apophtegmata "autore Johanne Posselio"
  ['6a50890878825bd7fde8c7b2', 'Batteux, Charles'],            // Les quatre poétiques "Par M. l'Abbé Batteux"
  ['6a50890d78825bd7fde8ccac', 'Batteux, Charles'],
  ['6a5089f878825bd7fde9a067', 'Batteux, Charles'],
  ['6a508a3078825bd7fde9b92f', 'Batteux, Charles'],
  ['6a508cc078825bd7fdebab66', 'Vergerius, Petrus Paulus'],    // "Pauli Vergerii ... de ingenuorum educatione" — title names the author
  ['6a4a59759050f0b4342f9003', 'Collegium Medicum (Augsburg)'], // Pharmacopoeia Augustana — corporate author
  ['6a4a59759050f0b4342f9004', 'Collegium Medicum (Augsburg)'],
]);
// The Coimbra Jesuit commentaries: the TITLE is the corporate attribution, and
// the #3780 mint created the is_person:false doc for it.
const CONIMBRICENSE_RX = /colleg\w*\s+conimbricensis/i;
const CONIMBRICENSE = 'Collegium Conimbricense';

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

const slugify = (text, maxLength) => {
  let s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  if (s.length > maxLength) {
    s = s.substring(0, maxLength);
    const h = s.lastIndexOf('-');
    if (h > maxLength * 0.5) s = s.substring(0, h);
  }
  return s;
};
const enLabel = (l) => typeof l === 'string' ? l : Array.isArray(l) ? (l.find(x => x['@language'] === 'en')?.['@value'] || '') : (l?.['@value'] || '');
const vals = (v) => (Array.isArray(v) ? v : [v]).map(x => typeof x === 'string' ? x : x?.['@value'] || '').filter(Boolean);

const targets = await books.find(
  { author: BAD },
  { projection: { id: 1, title: 1, display_title: 1, slug: 1, published: 1, year: 1, visible: 1, work_id: 1, 'image_source.iiif_manifest': 1 } },
).toArray();
console.log(`${targets.length} books still carry ${JSON.stringify(BAD)} (expected: the 146 no-Creator set).`);

mkdirSync('scripts/output', { recursive: true });
const claimed = new Set();
let done = 0, failed = 0;
for (const b of targets) {
  let statement = null, contributors = [];
  try {
    const m = await (await fetch(b.image_source.iiif_manifest, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })).json();
    for (const md of m.metadata || []) {
      const l = enLabel(md.label);
      if (l === 'By') statement = vals(md.value).join(' | ') || null;
      if (l === 'Contributor') contributors.push(...vals(md.value).map(v => v.replace(/<[^>]+>/g, '')));
      if (l === 'Creator') { statement = `UNEXPECTED Creator present: ${vals(md.value).join('|')}`; }
    }
  } catch (e) { failed++; console.log(`  FETCH FAIL ${b.id} — ${e.message} (left untouched)`); continue; }

  const attributed = ATTRIBUTE.get(b.id)
    || (CONIMBRICENSE_RX.test(`${b.title} ${b.display_title || ''}`) ? CONIMBRICENSE : null);

  const identity = computeIdentityFields({ ...b, author: attributed || '' });
  const lastName = attributed
    ? (attributed.includes(',') ? attributed.split(',')[0].trim() : attributed.trim().split(/\s+/).pop())
    : '';
  const base = [slugify(b.display_title || b.title, 60), attributed ? slugify(lastName, 20) : '']
    .filter(Boolean).join('-') || 'untitled';
  let slug = base;
  for (let n = 2; claimed.has(slug) || await books.findOne({ slug, id: { $ne: b.id } }, { projection: { _id: 1 } }); n++) slug = `${base}-${n}`;
  claimed.add(slug);

  if (!APPLY) {
    console.log(`  ${b.id}  ${attributed ? `ATTRIBUTE "${attributed}"` : 'clear'}  slug -> ${slug}`);
    if (!attributed && statement) console.log(`      By: ${statement.slice(0, 100)}`);
    done++;
    continue;
  }
  appendFileSync(BACKUP, JSON.stringify({ id: b.id, before: { author: BAD, slug: b.slug, work_id: b.work_id ?? null }, action: attributed ? `attributed: ${attributed}` : 'cleared' }) + '\n');
  const provenance = {
    source: 'maintenance', script: 'repair-object-object-anonymous-3770.mjs', issue: 3770,
    date: new Date(), previous_value: BAD,
    action: attributed ? 'attributed' : 'cleared',
    note: attributed
      ? 'MDZ manifest has no Creator; author from the statement of responsibility / corporate title, human-reviewed 2026-08-09'
      : 'MDZ manifest has no Creator — anonymous/pseudonymous imprint; never guess (#3434)',
    ...(statement ? { statement_of_responsibility: statement } : {}),
    ...(contributors.length ? { manifest_contributors: contributors } : {}),
  };
  const update = attributed
    ? { $set: { author: attributed, slug, ...identity, updated_at: new Date(), 'field_provenance.author': provenance },
        $unset: { work_id: '', work_slug: '', work_title: '', work_id_confidence: '', work_id_source: '' } }
    : { $unset: { author: '', work_id: '', work_slug: '', work_title: '', work_id_confidence: '', work_id_source: '' },
        $set: { slug, ...identity, updated_at: new Date(), 'field_provenance.author': provenance } };
  const r = await books.updateOne({ id: b.id, author: BAD }, update);
  if (r.modifiedCount) done++;
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${done} cleared, ${failed} fetch failures (self-limiting — rerun covers them).${APPLY ? ` Backup: ${BACKUP}` : ''}`);
await mc.close();
