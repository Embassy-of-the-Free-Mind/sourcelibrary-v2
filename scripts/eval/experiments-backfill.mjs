#!/usr/bin/env node
/**
 * Backfill the #5939 header onto experiment write-ups that predate it: rules first,
 * then a list of the files the rules are unsure of, for a person or agent to read.
 *
 * PRIOR ART: scripts/eval/build-experiments.mjs adoptOrphans() — the only other
 * writer into experiments/, and it creates files, never edits one. The header
 * reader/writer is lib/experiment-header.mjs (reused, not copied). Nothing else
 * derives fields from the write-ups' prose.
 *
 * THE INVARIANT: a file's body is never changed. `apply` writes header + the exact
 * old bytes and re-reads the file to prove it; a file that already has a header is
 * skipped, so a re-run is a no-op.
 *
 *   node scripts/eval/experiments-backfill.mjs propose
 *       → results/experiments-backfill-5939/proposals.json (rule header + confidence per file)
 *         and uncertain.txt (the files to read, one per line)
 *   node scripts/eval/experiments-backfill.mjs apply [reviewed.json …] [--dry-run]
 *       → writes the header to every file that is confident in proposals.json or has a
 *         reviewed header in one of the given files (a JSON object: { "<file>.md": {header} })
 *
 * A rule header is CONFIDENT only when each field came from an explicit statement:
 * an issue number in the heading or file name, a `measure:` line, a stage keyword
 * that outscores the others twofold, a status phrase with no contrary phrase, and a
 * verdict under a **Verdict.** / **Decision.** / **Answer.** label. Everything else
 * is read. $0: no model call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExperiment, serializeHeader, splitHeader, canonIds } from './lib/experiment-header.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'experiments');
const OUT = path.join(HERE, 'results', 'experiments-backfill-5939');
const DATED = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

// Language words → ISO 639; the script that follows when it is unambiguous.
const LANGS = [
  [/\blatin\b/i, 'la', 'Latn'], [/\bgreek\b/i, 'grc', 'Grek'], [/\benglish\b(?! (?:translation|we serve|served))/i, 'en', 'Latn'],
  [/\bgerman\b|\bfraktur\b/i, 'de', 'Latn'], [/\bfrench\b/i, 'fr', 'Latn'], [/\bitalian\b/i, 'it', 'Latn'],
  [/\bspanish\b/i, 'es', 'Latn'], [/\bdutch\b|\bVOC\b/, 'nl', 'Latn'], [/\btibetan\b|\btengyur\b|\bkangyur\b|\byigdzin\b/i, 'bo', 'Tibt'],
  [/\bclassical chinese\b|\bchinese\b|\bCBETA\b|\bSKQS\b/i, 'lzh', 'Hani'], [/\bjapanese\b|\bNDL\b/i, 'ja', 'Jpan'],
  [/\bsanskrit\b/i, 'sa', null], [/\bpali\b/i, 'pi', null], [/\bhebrew\b|\bsefaria\b/i, 'he', 'Hebr'],
  [/\barabic\b/i, 'ar', 'Arab'], [/\bpersian\b|\bganjoor\b/i, 'fa', 'Arab'], [/\bsyriac\b/i, 'syc', 'Syrc'],
  [/\bcoptic\b/i, 'cop', 'Copt'], [/\bmongol(ian)?\b/i, 'mn', 'Mong'], [/\bhieroglyph/i, 'egy', 'Egyp'],
];
const CANONS = [
  [/\btengyur\b/i, 'derge-tengyur'], [/\bkangyur\b|\bkanjur\b/i, 'derge-kangyur'], [/\bmongol(ian)? kan[jg]yur\b/i, 'mongolian-kanjur'],
  [/\bCBETA\b|\bTaish[oō]\b/i, 'cbeta'], [/\bpali\b|\bSuttaCentral\b/i, 'pali'], [/\bGRETIL\b/i, 'sanskrit'],
  [/\bsefaria\b|\bzohar\b/i, 'kabbalah'], [/\bganjoor\b/i, 'ganjoor'], [/\bopeniti\b|\bsufi\b/i, 'sufi'], [/\bkanripo\b/i, 'chinese-classics'],
];
const STAGE_WORDS = {
  ocr: /\bocr\b|transcri|\bkraken\b|\bpaddle|\bmineru\b|\bolmocr\b|\bloghi\b|\bCER\b|\bengine\b|\bblank\b|show-?through|reads? the page/gi,
  translation: /translat|\bnotes?\b|\bseam\b|page[- ]break|\bfidelity\b|\binvention\b|\breversal/gi,
  image: /\bimages?\b|\bpicture|\bbox(es)?\b|\bcrop|illustrat|\bmatcher\b|contact[- ]sheet|\bclip\b|\bspread/gi,
  metadata: /\bmetadata\b|\bcatalogu|\bdates?\b|\blangid\b|\blanguage id|\btypeface\b|\bbook[- ]class/gi,
  pipeline: /\bbatch\b|\blane\b|\bpipeline\b|\bduplicate[- ]run\b|\bmirror\b|\brepair\b|\bcleanup\b|\bbackfill\b/gi,
};
const MEASURE_MAP = [
  [/judged against a (human |published )?reference|judged_vs_reference|vs[ -]reference/i, 'judged_vs_reference'],
  [/^\W*accuracy/i, 'accuracy'], [/^\W*agreement/i, 'agreement'], [/^\W*stability/i, 'stability'],
  [/^\W*preference/i, 'preference'], [/^\W*(judged|by eye)/i, 'judged'],
];

const firstSentence = (s) => {
  const t = s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,240}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 240)).trim();
};

/** Propose a header for one file from its text. Returns { header, confident, why[] }. */
export function proposeHeader(name, text, canonSet = null) {
  const why = [];
  const body = splitHeader(text).body;
  const heading = (body.match(/^## .*$/m) || [''])[0];
  const question = (body.match(/\*\*Question\.?\*\*\.?\s*(.*)/) || [, ''])[1];
  const lead = `${heading}\n${question}`;
  const h = {};

  // issue: the file name's suffix, then every #NNNN in the heading
  const issues = [];
  const fm = name.match(/-(\d{4})(?:-[a-z0-9]+)?\.md$/);
  if (fm) issues.push(Number(fm[1]));
  for (const m of heading.matchAll(/#(\d{3,5})\b/g)) if (!issues.includes(Number(m[1]))) issues.push(Number(m[1]));
  if (issues.length) h.issue = issues.length === 1 ? issues[0] : issues.slice(0, 4);
  else why.push('no issue number');

  // stage: keyword counts over heading + question
  const scores = Object.entries(STAGE_WORDS).map(([s, re]) => [s, (lead.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  h.stage = scores[0][1] ? scores[0][0] : 'ocr';
  if (!scores[0][1] || scores[1][1] * 2 > scores[0][1]) why.push(`stage unclear (${scores.map((s) => s.join(' ')).join(', ')})`);

  // measure: an explicit `measure:` statement
  const ms = [...body.matchAll(/`?\*{0,2}\*?measure\*{0,2}\*?:?\*{0,2}\*?`?:?\s*`?([^`\n]{0,80})/gi)].map((m) => m[1]);
  const measures = [];
  for (const s of ms) for (const [re, v] of MEASURE_MAP) if (re.test(s)) { if (!measures.includes(v)) measures.push(v); break; }
  if (measures.length) h.measure = measures.length === 1 ? measures[0] : measures;
  else { h.measure = 'judged'; why.push('no measure: line'); }

  // languages / scripts / canons from heading + question
  const langs = [], scripts = [];
  for (const [re, code, script] of LANGS) if (re.test(lead)) { langs.push(code); if (script && !scripts.includes(script)) scripts.push(script); }
  h.languages = langs;
  h.scripts = scripts;
  const canons = [];
  for (const [re, id] of CANONS) if (re.test(lead) && !canons.includes(id) && (!canonSet || canonSet.has(id))) canons.push(id);
  if (canons.includes('mongolian-kanjur')) canons.splice(canons.indexOf('derge-kangyur'), canons.includes('derge-kangyur') ? 1 : 0);
  h.canons = canons;
  if (langs.length || canons.length) why.push('languages/canons are word matches'); // always read: "English" is often the output, not the source

  // n
  const nb = body.match(/\b(\d[\d,]*) (?:\w+ ){0,2}books\b/i);
  const np = body.match(/\b(\d[\d,]*) (?:\w+ ){0,2}pages\b/i);
  h.n_books = nb ? Number(nb[1].replace(/,/g, '')) : null;
  h.n_pages = np ? Number(np[1].replace(/,/g, '')) : null;
  why.push('n is the first count in the text');

  // verdict
  const v = body.match(/\*\*(?:Verdict|Decision|Answer)[^*]{0,40}\*\*\s*:?\s*(.+)/i);
  const r = body.match(/\*\*Result\.?\*\*\.?\s*(.+)/i);
  if (v) h.verdict = firstSentence(v[0].replace(/^\*\*(Verdict|Decision|Answer)\.?\*\*\s*:?/i, '')) || firstSentence(v[1]);
  else { h.verdict = r ? firstSentence(r[1]) : firstSentence(heading.replace(/^## [\d-]+ · /, '')); why.push('verdict not under a Verdict/Decision/Answer label'); }

  // status
  const low = body.toLowerCase();
  const said = {
    superseded: /\bsuperseded\b|\bretract/.test(heading.toLowerCase()),
    adopted: /\b(adopted|in production|promoted|shipped|now the production|is the production)\b/.test(low),
    rejected: /\b(rejected|not adopted|do not adopt|don't adopt|not worth|dropped|abandon)/.test(low),
    undecided: /\b(derek'?s call|decision (is )?pending|undecided|awaiting|not yet decided)\b/.test(low),
  };
  const hits = Object.entries(said).filter(([, x]) => x).map(([k]) => k);
  h.status = hits.length === 1 ? hits[0] : 'informational';
  if (hits.length !== 1) why.push(`status unclear (${hits.join(', ') || 'no status phrase'})`);
  if (h.status === 'superseded') { h.superseded_by = null; why.push('superseded_by must be found by reading'); }
  h.decision = null;
  if (['adopted', 'rejected'].includes(h.status)) why.push('decision must be written by reading');

  return { header: h, confident: why.length === 0, why };
}

function propose() {
  const canonSet = canonIds();
  const names = fs.readdirSync(DIR).filter((n) => DATED.test(n)).sort();
  const out = {};
  const uncertain = [];
  let had = 0;
  for (const n of names) {
    const text = fs.readFileSync(path.join(DIR, n), 'utf8');
    if (splitHeader(text).header != null) { had++; continue; }
    const p = proposeHeader(n, text, canonSet);
    out[n] = p;
    if (!p.confident) uncertain.push(n);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'proposals.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'uncertain.txt'), uncertain.join('\n') + '\n');
  const conf = Object.keys(out).length - uncertain.length;
  console.log(`${names.length} dated entries: ${had} already have a header, ${conf} confident by rule, ${uncertain.length} to read`);
}

function apply(files, dry) {
  const proposals = JSON.parse(fs.readFileSync(path.join(OUT, 'proposals.json'), 'utf8'));
  const chosen = {};
  for (const [n, p] of Object.entries(proposals)) if (p.confident) chosen[n] = { header: p.header, by: 'rule' };
  for (const f of files) for (const [n, h] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) chosen[n] = { header: h, by: 'read' };
  const names = fs.readdirSync(DIR);
  const exists = (x) => names.includes(x);
  const canons = canonIds();
  const tally = { rule: 0, read: 0, skipped: 0, invalid: 0 };
  for (const [n, { header, by }] of Object.entries(chosen).sort()) {
    const p = path.join(DIR, n);
    if (!fs.existsSync(p)) { console.error(`${n}: no such file`); tally.invalid++; continue; }
    const old = fs.readFileSync(p, 'utf8');
    if (splitHeader(old).header != null) { tally.skipped++; continue; }
    const next = serializeHeader(header) + old;
    const { problems } = readExperiment(next, { name: n, exists, canons });
    if (problems.length) { console.error(`${n}: ${problems.join('; ')}`); tally.invalid++; continue; }
    if (!dry) {
      fs.writeFileSync(p, next);
      const back = fs.readFileSync(p, 'utf8');
      if (splitHeader(back).body !== old) throw new Error(`${n}: body changed on write — stopping`);
    }
    tally[by]++;
  }
  console.log(`${dry ? '[dry run] ' : ''}headers written: ${tally.rule} by rule, ${tally.read} by reading; ${tally.skipped} already had one; ${tally.invalid} invalid (not written)`);
  if (tally.invalid) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'propose') propose();
  else if (cmd === 'apply') apply(rest.filter((a) => !a.startsWith('--')), rest.includes('--dry-run'));
  else { console.error('usage: experiments-backfill.mjs propose | apply [reviewed.json …] [--dry-run]'); process.exit(2); }
}
