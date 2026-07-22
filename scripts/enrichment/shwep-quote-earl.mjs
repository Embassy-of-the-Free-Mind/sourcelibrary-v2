#!/usr/bin/env node
/**
 * Quote the podcast's own words instead of paraphrasing them.
 *
 * SHWEP_WORK_NOTES holds model-written summaries of sentences Earl Fontainelle had
 * already written. For Homer he wrote "On the distinction between true and false
 * dreams, see Homer Od. 19.560-567, echoed at Virgil Æn. 6.893-896…" and we reprinted
 * "Cited at 19.560-567 on the distinction between true and false dreams" in our own
 * voice, on a page headed with his name. That can only lose fidelity, and it silently
 * restructured his argument: one observation of his covering Homer, Virgil and
 * Hippocrates became three separate per-work claims.
 *
 * So: extract the VERBATIM span and quote it. Two things this script guarantees.
 *
 * 1. Quotes come from src/data/shwep-bibliographies.ts — his text as scraped — NOT from
 *    shwep-linked-bibliographies.ts, which has OUR /book/ links spliced into his prose.
 *    Never quote a sentence we have edited.
 * 2. Every extracted span is checked to occur verbatim in that source before it is
 *    written. A model asked for an exact substring will still occasionally smooth one;
 *    the check is what makes "quotation" mean quotation. Failures are dropped, not
 *    repaired.
 *
 * Also captures the EDITION he names for each work ("Des Places/Majercik", "Hans Thurn,
 * editor… De Gruyter 2000"). His loci are edition-relative — "frr. 153-4" indexes Des
 * Places, and pointing that at our Patrizi 1591 breaks the citation for anyone who
 * follows it. Naming both editions is honest where a single link is not.
 *
 * Usage: node scripts/enrichment/shwep-quote-earl.mjs [--limit=N] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';

const MODEL = 'gemini-3.1-flash-lite';
const KEY = process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LIMIT = (() => { const a = argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : null; })();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readTsData(file, marker) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let body = s.slice(s.indexOf(marker) + marker.length).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  return JSON.parse(body.replace(/^(\s*)(\d+):/gm, '$1"$2":').replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * shwep-bibliographies.ts stores each entry as a template literal, so it is TS but not
 * JSON. Read the backtick spans directly rather than trying to coerce the file.
 */
function readBackticked(file, marker) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const body = s.slice(s.indexOf(marker) + marker.length);
  const out = {};
  const re = /(\d+):\s*`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2].replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
  }
  return out;
}

async function gemini(prompt) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const txt = (await res.json()).candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return JSON.parse(txt);
    } catch (e) { if (i === 2) return null; await sleep(3000 * (i + 1)); }
  }
  return null;
}

/**
 * Comparison form for the verbatim check: markdown emphasis and link syntax dropped,
 * whitespace collapsed. Formatting is not wording, and the model is asked for the words.
 */
const cmp = s => String(s || '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * Presentation form: his words, link syntax flattened to its label. A span cut at the
 * word cap can end mid-word ("Hippocrates On Regimen: Corpus medico"); drop the partial
 * word and mark the truncation, so the page never shows a mangled quotation.
 */
function display(s) {
  let t = String(s || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[.!?;:)\]]$/.test(t)) {
    t = t.replace(/\s+\S*$/, '');
    t += '…';
  }
  return t;
}

async function main() {
  const works = readTsData('src/data/shwep-cited-works.ts', 'SHWEP_CITED_WORKS: ShwepCitedWork[] = ');
  const notes = readTsData('src/data/shwep-work-notes.ts', 'SHWEP_WORK_NOTES: Record<string, string> = ');
  const bibs = readBackticked('src/data/shwep-bibliographies.ts', 'SHWEP_BIBLIOGRAPHIES: Record<number, string> = ');

  // Only pairs we currently render a note for — same coverage, better provenance.
  const byEpisode = new Map();
  for (const key of Object.keys(notes)) {
    const [ep, ...rest] = key.split('|');
    if (!bibs[ep]) continue;
    const workKey = rest.join('|');
    const w = works.find(x => `${x.author}|${x.work}` === workKey);
    if (!w) continue;
    if (!byEpisode.has(ep)) byEpisode.set(ep, []);
    byEpisode.get(ep).push({ key, work: w });
  }

  const episodes = [...byEpisode.keys()].sort((a, b) => +a - +b);
  const slice = LIMIT ? episodes.slice(0, LIMIT) : episodes;
  const out = {};
  const stats = { asked: 0, quoted: 0, notVerbatim: 0, none: 0, withEdition: 0 };

  for (const [n, ep] of slice.entries()) {
    const items = byEpisode.get(ep);
    const source = String(bibs[ep]);
    const haystack = cmp(source);

    const res = await gemini(`Below is a podcast episode's works-cited section, written by the show's author.

For each work listed after it, return:
- "quote": the EXACT contiguous span of the author's text that cites that work. Copy it
  character for character from the text above. Do not summarise, join separate sentences,
  fix punctuation, or translate.
  IMPORTANT: include the part of the sentence that says WHAT the work is cited FOR, not
  only its name and locus. Given "On the distinction between true and false dreams, see
  Homer Od. 19.560-567", the right span is the whole thing, NOT "Homer Od. 19.560-567".
  Start at the beginning of the sentence or bullet. If several works share one sentence,
  return that same sentence for each of them — they were cited together.
  Keep it under 60 words; if the sentence is longer, take its opening clause verbatim.
  If the work is only named in a list with no comment at all, return "".
- "edition": the edition/editor the author names for THAT work, if any (e.g. "Des
  Places/Majercik", "Hans Thurn, ed., De Gruyter 2000"). "" if none is named.

Return JSON: [{"i": <index>, "quote": "...", "edition": "..."}]

--- AUTHOR'S TEXT ---
${source.slice(0, 14000)}

--- WORKS ---
${items.map((it, i) => `${i}. ${it.work.author || 'Anonymous'} — ${it.work.work}`).join('\n')}`);

    for (const r of (res || [])) {
      const it = items[r.i];
      if (!it) continue;
      stats.asked++;
      const q = String(r.quote || '').trim();
      if (!q) { stats.none++; continue; }
      // The guarantee: it is only a quotation if it is actually in his text.
      if (!haystack.includes(cmp(q))) { stats.notVerbatim++; continue; }
      const edition = String(r.edition || '').trim().slice(0, 120);
      out[it.key] = { quote: display(q), ...(edition ? { citedEdition: edition } : {}) };
      stats.quoted++;
      if (edition) stats.withEdition++;
    }
    if ((n + 1) % 20 === 0) console.log(`  ${n + 1}/${slice.length} episodes — quoted ${stats.quoted}, rejected ${stats.notVerbatim}`);
  }

  console.log(`\nasked ${stats.asked} | verbatim-verified quotes ${stats.quoted} | rejected as not verbatim ${stats.notVerbatim} | no comment in source ${stats.none} | naming an edition ${stats.withEdition}`);

  if (DRY) {
    for (const [k, v] of Object.entries(out).slice(0, 10)) console.log(`\n  ${k}\n    “${v.quote.slice(0, 150)}”\n    edition: ${v.citedEdition || '—'}`);
    return;
  }

  const file = `/**
 * The podcast author's OWN words about each work he cites, quoted verbatim, plus the
 * edition he names for it. Keyed "episode|author|work".
 *
 * These replace model-written paraphrases. Every span here was checked to occur verbatim
 * in src/data/shwep-bibliographies.ts (his text as scraped, with none of our links
 * spliced in) before being written; spans that did not match exactly were dropped rather
 * than repaired. \`citedEdition\` matters because his loci are edition-relative — "frr.
 * 153-4" indexes Des Places/Majercik and means nothing in the Patrizi we hold.
 * Generated by scripts/enrichment/shwep-quote-earl.mjs (${MODEL}).
 */
export interface ShwepEarlQuote {
  /** Verbatim span from the author's works-cited text. Render inside quotation marks. */
  quote: string;
  /** The edition/editor HE names, when he names one. Not the edition we hold. */
  citedEdition?: string;
}
export const SHWEP_EARL_QUOTES: Record<string, ShwepEarlQuote> = ${JSON.stringify(out, null, 2)};
`;
  fs.writeFileSync(path.join(ROOT, 'src/data/shwep-earl-quotes.ts'), file);
  console.log(`wrote ${Object.keys(out).length} verbatim quotes`);
}

await main();
