#!/usr/bin/env node
/**
 * Acquisition tier survey (#7294): language × interest tier × (candidates, survivors).
 *
 * PRIOR ART: scripts/import/enumerate-dedupe-source.ts — the IA enumerate+dedupe
 * tool; its held index (fingerprint + edition-key title) is reused here, widened to
 * the `source_fingerprints` SET and the edition key's title|surname|year veto, and
 * it reads `import_candidates` (or a sample file) instead of an IA query.
 * scripts/iiif-discovery/analyze-candidates.mjs ranks by language/date only and
 * writes skip flags; classify-candidates.mjs tags script/record type. Neither ranks
 * by subject, and this must stay READ-ONLY, so neither fits.
 *
 * The rule from the issue: count EVERYTHING public domain, rank it, never filter it
 * out. A = core (alchemy, Hermetica, Kabbalah, Rosicrucianism, magic, mysticism,
 * astrology), B = adjacent (science, medicine, natural philosophy, secrets,
 * emblems, classical/patristic translations), C = every other pre-1900 record.
 * The term lists live in scripts/audit/acquisition-tier-terms.json so a regex fix
 * is a re-run, not a rewrite. Keyword tiers are a RANKING, not a subject verdict:
 * a human still subject-filters a batch before import (import-workflow.md step 3).
 *
 * Dedupe (survivors = not held):
 *   HELD          — any of the candidate's digital-object ids (sourceFingerprints)
 *                   is on a book, or the candidate row is already `imported`.
 *   SAME_EDITION  — a held book's edition key shares title|surname and the years
 *                   do not disagree (missing year = assume duplicate, dedup.ts rule).
 *   OTHER_EDITION — same title|surname, different year: a survivor, flagged.
 *   NEW           — survivor.
 * A candidate with no author is matched on title|year only when the held side has
 * no author either; that under-dedupes a little, so survivors are an upper bound.
 *
 * Excluded from the counts, and reported: rows `skipped` (cross-source duplicates
 * marked by dedupe-candidates.mjs) and `record_type: serial` (newspaper issues).
 *
 * Read-only. Writes nothing to the database.
 *
 * Usage:
 *   npx tsx --env-file=.env.production.local scripts/audit/candidate-tier-survey.ts --out $JOB_SCRATCH/survey
 *   … --source bsb                    one import_candidates source
 *   … --exclude-source a,b           every source except these (e.g. a fresh harvest)
 *   … --emit-tiers ABC               survivor file for these tiers (default AB)
 *   … --input sample.jsonl --label x  dedupe + tier a probe sample (one JSON record
 *                                     per line: title, author, language, year,
 *                                     manifest_url?, source_url?, subjects?)
 */

import { MongoClient } from 'mongodb';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { sourceFingerprints } from '../../src/lib/dedup';
import { buildEditionKey } from '../../src/lib/edition-key';

function arg(name: string, def: string | null = null) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const OUT = arg('--out', '/tmp/candidate-tier-survey')!;
const SOURCE = arg('--source');
const EXCLUDE = (arg('--exclude-source') || '').split(',').filter(Boolean);
const INPUT = arg('--input');
const LABEL = arg('--label', INPUT ? path.basename(INPUT).replace(/\..*$/, '') : (SOURCE || 'import_candidates'))!;
const PD_BEFORE = parseInt(arg('--pd-before', '1900')!, 10);
// Which tiers' survivors go to the survivor file. AB by default; the lazy-pages
// import of tier C (#7343) needs ABC.
const EMIT_TIERS = arg('--emit-tiers', 'AB')!.toUpperCase();
const SURVIVOR_FILE = `${LABEL}-survivors-${EMIT_TIERS}.jsonl.gz`;
const TERMS_FILE = arg('--terms', path.join(__dirname, 'acquisition-tier-terms.json'))!;

// ── Language: one canonical name per record ─────────────────────────────────
const LANG: Record<string, string> = {
  lat: 'Latin', la: 'Latin', latino: 'Latin', latin: 'Latin',
  ger: 'German', deu: 'German', de: 'German', gmh: 'German', goh: 'German', gsw: 'German', nds: 'German',
  fre: 'French', fra: 'French', fr: 'French', frm: 'French', fro: 'French',
  ita: 'Italian', it: 'Italian', spa: 'Spanish', es: 'Spanish', osp: 'Spanish', lad: 'Ladino',
  por: 'Portuguese', pt: 'Portuguese', glg: 'Galician', cat: 'Catalan', ca: 'Catalan', baq: 'Basque', eus: 'Basque',
  dut: 'Dutch', nld: 'Dutch', nl: 'Dutch', dum: 'Dutch', fry: 'Frisian',
  swe: 'Swedish', sv: 'Swedish', dan: 'Danish', da: 'Danish', nor: 'Norwegian', nob: 'Norwegian', nno: 'Norwegian', no: 'Norwegian',
  ice: 'Icelandic', isl: 'Icelandic', is: 'Icelandic', non: 'Icelandic', fao: 'Faroese', fin: 'Finnish', fi: 'Finnish', smi: 'Sami', est: 'Estonian',
  cze: 'Czech', ces: 'Czech', cs: 'Czech', slo: 'Slovak', slk: 'Slovak', pol: 'Polish', pl: 'Polish', hun: 'Hungarian', hu: 'Hungarian',
  slv: 'Slovenian', hrv: 'Croatian', scr: 'Croatian', srp: 'Serbian', bos: 'Bosnian', bul: 'Bulgarian', rum: 'Romanian', ron: 'Romanian',
  lit: 'Lithuanian', lav: 'Latvian', ukr: 'Ukrainian', bel: 'Belarusian', rus: 'Russian', ru: 'Russian', chu: 'Church Slavonic',
  wel: 'Welsh', cym: 'Welsh', gle: 'Irish', iri: 'Irish', ga: 'Irish', gla: 'Scottish Gaelic', bre: 'Breton', cor: 'Cornish',
  yid: 'Yiddish', heb: 'Hebrew', he: 'Hebrew', arc: 'Aramaic', syr: 'Syriac', syc: 'Syriac',
  ota: 'Ottoman Turkish', tur: 'Turkish', ara: 'Arabic', ar: 'Arabic', per: 'Persian', fas: 'Persian', urd: 'Urdu',
  eng: 'English', en: 'English', enm: 'English', ang: 'English', en_us: 'English', sco: 'Scots',
  grc: 'Greek', gre: 'Greek', ell: 'Greek', el: 'Greek', arm: 'Armenian', hye: 'Armenian', geo: 'Georgian', kat: 'Georgian',
  cop: 'Coptic', gez: 'Ge\'ez', eth: 'Ge\'ez', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', jpn: 'Japanese', kor: 'Korean',
  san: 'Sanskrit', hin: 'Hindi', tib: 'Tibetan', bod: 'Tibetan',
  und: 'Unknown', zxx: 'Unknown', 'no linguistic content': 'Unknown', undetermined: 'Unknown', other: 'Unknown', mul: 'Multiple', unknown: 'Unknown', null: 'Unknown', '': 'Unknown',
};
function canonLang(raw: unknown, iso?: unknown): string {
  const pick = (v: unknown) => {
    if (Array.isArray(v)) v = v[0];
    if (typeof v !== 'string') return null;
    const first = v.split(/[;,/|]/)[0].trim();
    if (!first) return null;
    const k = first.toLowerCase().replace(/-/g, '_');
    if (LANG[k] === undefined && LANG[k.replace(/_/g, ' ')]) return LANG[k.replace(/_/g, ' ')];
    if (LANG[k]) return LANG[k];
    // Already a name ("Spanish", "Old Norse")
    if (/^[a-z][a-z' ]{3,}$/i.test(first)) return first[0].toUpperCase() + first.slice(1).toLowerCase();
    return null;
  };
  const a = pick(raw);
  if (a && a !== 'Unknown') return a;
  return pick(iso) || a || 'Unknown';
}

// ── Tiers ────────────────────────────────────────────────────────────────────
type Terms = { A: Record<string, string[]>; B: Record<string, string[]>; A_authors: string[]; B_authors: string[] };
const terms: Terms = JSON.parse(readFileSync(TERMS_FILE, 'utf8'));
const fold = (s: string) => s.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const re = (list: string[] = []) => list.length ? new RegExp(list.map(fold).join('|'), 'u') : null;
const tierRe = {
  A: Object.fromEntries(Object.entries(terms.A).map(([k, v]) => [k, re(v)])),
  B: Object.fromEntries(Object.entries(terms.B).map(([k, v]) => [k, re(v)])),
  Aa: re(terms.A_authors), Ba: re(terms.B_authors),
};
// The first term that fires, for the survivor file — so a reviewer can see WHY a
// row ranked A and fix the term list instead of the verdict.
const termRe = (tier: 'A' | 'B', lang: string) => [...(terms[tier].universal || []), ...(terms[tier][lang] || [])].map(t => [t, new RegExp(fold(t), 'u')] as const);
function matchedTerm(tier: 'A' | 'B', lang: string, text: string, author: string): string {
  const t = fold(text), a = fold(author);
  for (const [src, r] of termRe(tier, lang)) if (r.test(t)) return src;
  for (const src of terms[`${tier}_authors` as 'A_authors' | 'B_authors']) if (new RegExp(fold(src), 'u').test(a)) return `author:${src}`;
  return '';
}
function tierOf(lang: string, text: string, author: string): 'A' | 'B' | 'C' {
  const t = fold(text), a = fold(author);
  if (tierRe.A.universal?.test(t) || tierRe.A[lang]?.test(t) || tierRe.Aa?.test(a)) return 'A';
  if (tierRe.B.universal?.test(t) || tierRe.B[lang]?.test(t) || tierRe.Ba?.test(a)) return 'B';
  return 'C';
}

// ── Held index ───────────────────────────────────────────────────────────────
// Early-modern spelling folded for a SECOND, survey-only lookup: u/v, i/j, y/i,
// long s, ph/f, ae/oe ligatures, doubled consonants, final -e. The gate's own
// key does not fold these (Chymische ≠ Chymisch, Philosophia ≠ Filosofia), so a
// match found ONLY under this fold is reported as unresolved, never as a duplicate.
// Latin-script letters only; any other script passes through unchanged.
function orthoFold(title: string): string {
  return title.normalize('NFKC').toLowerCase()
    .replace(/ph/g, 'f').replace(/[æ]/g, 'e').replace(/[œ]/g, 'e').replace(/ae/g, 'e').replace(/oe/g, 'e')
    .replace(/v/g, 'u').replace(/[jy]/g, 'i').replace(/w/g, 'uu').replace(/th/g, 't').replace(/c([kh])/g, '$1')
    .replace(/([b-df-hj-np-tv-z])\1/g, '$1').replace(/e\b/g, '').replace(/\s+/g, ' ').trim();
}
type HeldEntry = { years: Set<string> };
type Held = { fps: Set<string>; byTitleSurname: Map<string, HeldEntry>; byFolded: Set<string>; authorLangs: Map<string, Set<string>>; total: number };
async function loadHeld(db): Promise<Held> {
  const fps = new Set<string>();
  const byTitleSurname = new Map<string, HeldEntry>();
  const byFolded = new Set<string>();
  const authorLangs = new Map<string, Set<string>>();
  let total = 0;
  const cur = db.collection('books').find({}, { projection: { _id: 0, source_fingerprints: 1, source_fingerprint: 1, ia_identifier: 1, edition_key: 1, title: 1, author: 1, year: 1, published: 1, language: 1 } }).batchSize(5000);
  for await (const d of cur) {
    total++;
    for (const f of d.source_fingerprints || []) fps.add(String(f).split('#')[0]);
    if (d.source_fingerprint) fps.add(String(d.source_fingerprint).split('#')[0]);
    if (d.ia_identifier) fps.add(`ia:${d.ia_identifier}`);
    let key: string | null = d.edition_key || null;
    if (!key) key = buildEditionKey({ title: d.title, author: d.author, year: d.year, published: d.published }).key;
    if (!key) continue;
    const [t, sn, y] = key.split('|');
    const k = `${t}|${sn}`;
    if (!byTitleSurname.has(k)) byTitleSurname.set(k, { years: new Set() });
    byTitleSurname.get(k)!.years.add(y || '');
    byFolded.add(`${orthoFold(t)}|${sn}`);
    if (sn && sn.length >= 4) {
      if (!authorLangs.has(sn)) authorLangs.set(sn, new Set());
      authorLangs.get(sn)!.add(canonLang(d.language));
    }
  }
  return { fps, byTitleSurname, byFolded, authorLangs, total };
}

// Buckets, by the key quality the match rests on (Derek, 2026-10-24 inbox note):
//   DUP_OBJECT   the same digital object (fingerprint), or the row is `imported`
//   DUP_FULL     same title|surname|year, candidate key FULL — a duplicate
//   PARTIAL      matched only on a partial key (a year or author missing on
//                either side): NOT final, unresolved until a catalogue date or
//                second token settles it
//   SPELLING     matched only after the early-modern orthography fold: unresolved
//   UNKEYED      title too short or generic to key: unjudgeable, not "new"
//   OTHER_ED     same title|surname, both years known and different: a survivor
//   NEW          a survivor
type Verdict = 'DUP_OBJECT' | 'DUP_FULL' | 'PARTIAL' | 'SPELLING' | 'UNKEYED' | 'OTHER_ED' | 'NEW';
const SURVIVOR = new Set<Verdict>(['NEW', 'OTHER_ED']);
const UNRESOLVED = new Set<Verdict>(['PARTIAL', 'SPELLING', 'UNKEYED']);
function classify(c: Cand, held: Held): { v: Verdict; key: string | null; full: boolean; surname: string } {
  if (c.status === 'imported') return { v: 'DUP_OBJECT', key: null, full: false, surname: '' };
  const fpIn: Record<string, unknown> = {
    ia_identifier: c.ia_identifier || null,
    image_source: { iiif_manifest: c.manifest_url || undefined, source_url: c.source_url || undefined },
  };
  for (const f of sourceFingerprints(fpIn as never)) if (held.fps.has(f)) return { v: 'DUP_OBJECT', key: null, full: false, surname: '' };
  for (const f of c.extra_fps) if (held.fps.has(f)) return { v: 'DUP_OBJECT', key: null, full: false, surname: '' };
  const built = buildEditionKey({ title: c.title, author: c.author, year: c.year });
  if (!built.key) return { v: 'UNKEYED', key: null, full: false, surname: '' };
  const { title, author, year } = built.parts;
  const full = built.quality === 'full';
  const r = (v: Verdict) => ({ v, key: built.key, full, surname: author });
  const entry = held.byTitleSurname.get(`${title}|${author}`);
  if (!entry) return r(held.byFolded.has(`${orthoFold(title)}|${author}`) ? 'SPELLING' : 'NEW');
  if (full && entry.years.has(String(year))) return r('DUP_FULL');
  if (!full || entry.years.has('')) return r('PARTIAL');
  return r('OTHER_ED');
}

// ── Candidates ───────────────────────────────────────────────────────────────
type Cand = {
  source: string; title: string; author: string; language: string; year: number | null; subjects: string;
  manifest_url?: string; source_url?: string; ia_identifier?: string; status?: string; extra_fps: string[];
  id?: string;
};
const str = (v: unknown): string => (Array.isArray(v) ? str(v[0]) : typeof v === 'string' ? v : v == null ? '' : String(v));
function fromCandidateRow(d): Cand {
  const subj = [d.subjects, d.metadata?.subjects, d.categories, d.subtitle].flat().filter(x => typeof x === 'string').join(' ; ');
  const extra: string[] = [];
  if (d.ppn) extra.push(`ppn:${String(d.ppn).startsWith('PPN') ? d.ppn : 'PPN' + d.ppn}`);
  if (d.metadata?.ark_id) extra.push(`gallica:${d.metadata.ark_id}`);
  return {
    source: d.source, title: str(d.title) || str(d.display_title), author: str(d.author),
    language: canonLang(d.language, d.classification?.language_iso),
    year: typeof d.date_earliest === 'number' ? d.date_earliest : null, subjects: subj,
    manifest_url: d.manifest_url, source_url: d.source_url || d.viewer_url,
    ia_identifier: d.metadata?.ia_identifier, status: d.status, extra_fps: extra, id: d.source_id || d.oai_id || d.manifest_url,
  };
}
function fromSampleRow(d): Cand {
  return {
    source: d.source || LABEL, title: d.title || '', author: d.author || '', language: canonLang(d.language),
    year: typeof d.year === 'number' ? d.year : (parseInt(d.year, 10) || null),
    subjects: [d.subjects].flat().filter(Boolean).join(' ; '),
    manifest_url: d.manifest_url, source_url: d.source_url, ia_identifier: d.ia_identifier, extra_fps: d.extra_fps || [], id: d.id,
  };
}

async function* candidates(db): AsyncGenerator<{ c: Cand; excluded: string | null }> {
  if (INPUT) {
    const rl = createInterface({ input: createReadStream(INPUT) });
    for await (const line of rl) if (line.trim()) yield { c: fromSampleRow(JSON.parse(line)), excluded: null };
    return;
  }
  const filter = SOURCE ? { source: SOURCE } : EXCLUDE.length ? { source: { $nin: EXCLUDE } } : {};
  const proj = { _id: 0, source: 1, title: 1, display_title: 1, author: 1, language: 1, 'classification.language_iso': 1, 'classification.record_type': 1, date_earliest: 1, subjects: 1, 'metadata.subjects': 1, 'metadata.ia_identifier': 1, 'metadata.ark_id': 1, categories: 1, subtitle: 1, manifest_url: 1, source_url: 1, viewer_url: 1, ppn: 1, status: 1, source_id: 1, oai_id: 1 };
  const cur = db.collection('import_candidates').find(filter, { projection: proj }).batchSize(5000);
  for await (const d of cur) {
    const excluded = d.status === 'skipped' ? 'skipped' : d.classification?.record_type === 'serial' ? 'serial' : null;
    yield { c: fromCandidateRow(d), excluded };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI!, { maxPoolSize: 2 });
  await client.connect();
  const db = client.db('bookstore');
  const held = await loadHeld(db);
  console.error(`held index: ${held.total} books, ${held.fps.size} fingerprints, ${held.byTitleSurname.size} title|surname keys`);

  // counts[lang|source][tier] = Cell. Tier key: 'A'|'B'|'C' (dated < PD_BEFORE),
  // 'A?'|'B?'|'C?' (undated), 'post' (dated later).
  type Cell = { n: number; survivors: number; dup_object: number; dup_full: number; partial: number; spelling: number; unkeyed: number; other_ed: number; other_copy: number; transl_flag: number };
  const blank = (): Cell => ({ n: 0, survivors: 0, dup_object: 0, dup_full: 0, partial: 0, spelling: 0, unkeyed: 0, other_ed: 0, other_copy: 0, transl_flag: 0 });
  const byLang: Record<string, Record<string, Cell>> = {};
  const bySource: Record<string, Record<string, Cell>> = {};
  const excluded: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  // Cross-source copies: the first survivor holding a FULL edition key keeps it;
  // a later row with the same key is another copy of that edition (two libraries
  // scanned one printing), counted as other_copy and never as a second survivor.
  // Which copy is the better scan is an import-time choice, not made here.
  const keptKeys = new Map<string, string>();
  const outA = createGzip(); outA.pipe(createWriteStream(path.join(OUT, SURVIVOR_FILE)));
  let seen = 0;
  for await (const { c, excluded: ex } of candidates(db)) {
    seen++;
    if (seen % 250000 === 0) console.error(`  …${seen}`);
    if (ex) { excluded[ex] = (excluded[ex] || 0) + 1; continue; }
    const bucket = c.year == null ? 'undated' : c.year < PD_BEFORE ? 'pd' : 'post';
    const tier = tierOf(c.language, `${c.title} ; ${c.subjects}`, c.author);
    const cls = classify(c, held);
    let v: Verdict | 'OTHER_COPY' = cls.v;
    if (SURVIVOR.has(cls.v) && cls.full && cls.key) {
      const keeper = keptKeys.get(cls.key);
      if (keeper && keeper !== `${c.source}:${c.id}`) v = 'OTHER_COPY';
      else keptKeys.set(cls.key, `${c.source}:${c.id}`);
    }
    // A survivor whose author we hold in a DIFFERENT language: a candidate
    // translation of a held work (same work, other edition) — high interest.
    // 'unknown'/'anon' is a placeholder author, not a person: it would flag every
    // anonymous survivor whose language differs from some anonymous held book.
    const person = cls.surname && !/^(unknown|anon\w*|unbekannt|inconnu|ignoto|s n)$/.test(cls.surname);
    const langs = person ? held.authorLangs.get(cls.surname) : null;
    const transl = (v === 'NEW' || v === 'OTHER_ED') && !!langs && !langs.has(c.language) && c.language !== 'Unknown';
    const key = bucket === 'pd' ? tier : bucket === 'undated' ? `${tier}?` : 'post';
    for (const [table, k] of [[byLang, c.language], [bySource, c.source]] as const) {
      table[k] ??= {};
      const cell = (table[k][key] ??= blank());
      cell.n++;
      if (v === 'NEW' || v === 'OTHER_ED') cell.survivors++;
      if (v === 'DUP_OBJECT') cell.dup_object++;
      if (v === 'DUP_FULL') cell.dup_full++;
      if (v === 'PARTIAL') cell.partial++;
      if (v === 'SPELLING') cell.spelling++;
      if (v === 'UNKEYED') cell.unkeyed++;
      if (v === 'OTHER_ED') cell.other_ed++;
      if (v === 'OTHER_COPY') cell.other_copy++;
      if (transl) cell.transl_flag++;
    }
    if ((v === 'NEW' || v === 'OTHER_ED' || UNRESOLVED.has(v as Verdict)) && EMIT_TIERS.includes(tier) && bucket !== 'post') {
      outA.write(JSON.stringify({ tier, verdict: v, translation_of_held_author: transl, key: cls.key, matched: tier === 'C' ? '' : matchedTerm(tier, c.language, `${c.title} ; ${c.subjects}`, c.author), dated: bucket === 'pd', ...c }) + '\n');
      const sk = `${c.language}|${tier}`;
      samples[sk] ??= [];
      if (samples[sk].length < 5 && SURVIVOR.has(v as Verdict)) samples[sk].push(`${c.year ?? '?'} ${c.author.slice(0, 30)} — ${c.title.slice(0, 80)}`);
    }
  }
  outA.end();
  await client.close();

  const summary = { label: LABEL, buckets: 'see classify()', generated_at: new Date().toISOString(), pd_before: PD_BEFORE, held_books: held.total, rows_seen: seen, excluded, byLang, bySource, samples };
  writeFileSync(path.join(OUT, `${LABEL}-summary.json`), JSON.stringify(summary, null, 1));

  // Readable table: languages by tier-A survivors.
  // Dated pre-PD_BEFORE only in the tier columns; undated rows (manuscripts, but
  // also modern IA uploads with no date) are a separate column, never summed in.
  const g = (cells: Record<string, Cell>, k: string, f: keyof Cell) => cells[k]?.[f] || 0;
  const line = (name: string, cells: Record<string, Cell>) => {
    const t = (k: string) => `${g(cells, k, 'n')} / ${g(cells, k, 'survivors')} / ${g(cells, k, 'dup_object') + g(cells, k, 'dup_full')} / ${g(cells, k, 'partial') + g(cells, k, 'spelling') + g(cells, k, 'unkeyed')}`;
    const und = ['A?', 'B?', 'C?'].reduce((n, k) => n + g(cells, k, 'n'), 0);
    const copies = ['A', 'B', 'C'].reduce((n, k) => n + g(cells, k, 'other_copy'), 0);
    const transl = ['A', 'B'].reduce((n, k) => n + g(cells, k, 'transl_flag'), 0);
    return `${name} | ${t('A')} | ${t('B')} | ${t('C')} | ${copies} | ${transl} | ${und} | ${cells.post?.n || 0}`;
  };
  console.log(`rows ${seen}; excluded ${JSON.stringify(excluded)}; held books ${held.total}`);
  console.log(`cells: rows / survivors / duplicates (object + full key) / unresolved (partial key + spelling-only + unkeyable)`);
  console.log(`language | A | B | C | other copies (A+B+C) | A+B translation flag | undated | ${PD_BEFORE}+`);
  const order = (t: Record<string, Record<string, Cell>>) => Object.entries(t).sort((a, b) => g(b[1], 'A', 'survivors') - g(a[1], 'A', 'survivors') || g(b[1], 'B', 'survivors') - g(a[1], 'B', 'survivors'));
  for (const [k, cells] of order(byLang).slice(0, 40)) console.log(line(k, cells));
  console.log('source | A | B | C | other copies | translation flag | undated | post');
  for (const [k, cells] of order(bySource)) console.log(line(k, cells));
  console.error(`wrote ${path.join(OUT, `${LABEL}-summary.json`)} and ${SURVIVOR_FILE}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
