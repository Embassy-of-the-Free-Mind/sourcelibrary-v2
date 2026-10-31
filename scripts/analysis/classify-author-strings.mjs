#!/usr/bin/env node
// PRIOR ART: scripts/analysis/enumerate-unmatched-author-strings.mjs — the regex net whose `person?` bucket this reads
// (author-identity.md: a pattern is a NET, never a VERDICT); scripts/maintenance/additive-mint-authors-3780.mjs — the
// writer this feeds, whose stage-2 verdicts were made by Claude agents by hand in 2026-08. Nothing classified the
// strings in batch, on a subscription, with every read kept.
/**
 * #7660 stage 2 — classify unmatched catalogue author strings with agy Flash low,
 * ~200 strings a call, JSON out, every read kept (candidate-reads, field 'metadata').
 *
 * Verdicts (the additive mint acts only on person-with-name and institution):
 *   person         one named individual; canonical_name in reading order ("Ludvig Holberg")
 *   institution    a body that issues or authors (a council, a university, a monastery)
 *   placeholder    names nobody (Unknown, Anonymus, ethnonyms, "Several authors"), or only a digitiser/funder
 *   bare-forename  a given or regnal name alone ("Johannes", "Thomas", "Friedrich, II.") —
 *                  refused, it would claim every namesake (#4313)
 *   editor         a role other than author is marked in the string ("(ed.)", "Hrsg.", "translator")
 *   compound       several people in one string
 *   title          a work title, a place, a subject, a search string — not an author
 *   defect         markup, numbers, truncation
 *   uncertain      cannot tell
 *
 * The model never merges: each string is one verdict. Under-merge is the policy
 * ("Mayer, Johann F." and "Mayer, Johann Friedrich" stay apart); the additive mint's
 * cluster key is the only thing that joins strings.
 *
 *   AGY_HOME=/root/.agy-james node --env-file=.env.production.local scripts/analysis/classify-author-strings.mjs \
 *     --in=<enumerate --out file> --out=<verdicts.jsonl> [--scope=no-harvest|harvest|all] [--skip=<file of strings>] [--limit=N] [--batch=200]
 * Resumable: strings already in --out are skipped. Stops at the first quota reply.
 */
import fs from 'node:fs';
import os from 'node:os';
import { gatedTextCall, firstJson } from '../lib/agy-cli.mjs';
import { keepRead, findRead, reuseHash } from '../lib/candidate-reads.mjs';
import { unwrapSentinels } from '../lib/cli-chatter.mjs';

const val = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const IN = val('in'), OUT = val('out');
const SCOPE = val('scope', 'no-harvest');
const BATCH = Number(val('batch', 200));
const LIMIT = Number(val('limit', 0));
const SKIP = val('skip');
const MODEL = 'gemini-3.8-flash-low';
const PROMPT_VERSION = 'author-strings-v2';
const HARVEST = new Set(['bsb', 'mdz', 'erara', 'e-rara', 'sbb', 'goettingen']);
if (!IN || !OUT) { console.error('--in=<file> --out=<file>'); process.exit(2); }

const { rows } = JSON.parse(fs.readFileSync(IN, 'utf8'));
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).string) : []);
const skip = new Set(SKIP ? fs.readFileSync(SKIP, 'utf8').split('\n').filter(Boolean) : []);
const inScope = (r) => SCOPE === 'all' || (SCOPE === 'no-harvest' ? !r.providers?.some((p) => HARVEST.has(p)) : r.providers?.some((p) => HARVEST.has(p)));
let todo = rows.filter((r) => r.bucket !== 'placeholder' && r.bucket !== 'defect' && inScope(r) && !done.has(r.string) && !skip.has(r.string));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`${rows.length} strings; in scope and not yet classified: ${todo.length} (${Math.ceil(todo.length / BATCH)} calls of ${BATCH})`);

const INSTRUCTIONS = `You classify AUTHOR fields from a library catalogue of early printed books and manuscripts.
Each numbered line is one author string exactly as catalogued, with one sample book (title, year, language) for context.
For EACH line return one object:
  {"i": <line number>, "v": <verdict>, "name": <canonical name or null>, "note": <at most 8 words or null>}
Verdicts:
  "person"        one named individual. "name" = the name in natural reading order, standard spelling of that
                  catalogue form, no dates or roles ("Holberg, Ludvig" -> "Ludvig Holberg"; "Mayer, Johann F." ->
                  "Johann F. Mayer"; "Cicero, Marcus Tullius" -> "Marcus Tullius Cicero"). Keep initials as given;
                  do not expand them, do not switch to another person's name.
  "institution"   a corporate body: a council, parliament, city, state, university, church, order, society, press
                  as issuing body. "name" = the string as given.
  "placeholder"   names nobody (unknown, anonymous, "several authors", an ethnonym, "Not Known"), OR names only
                  who DIGITISED, FUNDED or HOLDS the copy (a digitisation project, a vendor, a sponsor) — not an author.
  "editor"        one person or body marked in the string itself with a role other than author: "(ed.)",
                  "(editor)", "(trans.)", "Hrsg.", "translator", "printer", "publisher". "name" = null.
  "bare-forename" ONLY a given name, saint's name or regnal name with no surname or territory ("Johannes",
                  "Thomas", "Friedrich, II.", "Karl Theodor"). Never "person".
  "compound"      two or more people in one string.
  "title"         a work title, a subject, a place or a search phrase, not an author.
  "defect"        markup, numbers, truncation, garbage.
  "uncertain"     you cannot tell.
Judge from the string; use the sample book only to tell a person from a title or an institution.
Return a JSON array with one object per line, in order, between two marker lines <<<BEGIN>>> and <<<END>>>.
Output nothing outside the markers.`;

const out = fs.openSync(OUT, 'a');
const tmp = process.env.TMPDIR || os.tmpdir();
let calls = 0, written = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const lines = batch.map((r, k) => `${k + 1}. ${JSON.stringify(r.string)} | ${String(r.sample?.title ?? '').slice(0, 90)} | ${r.sample?.year ?? ''} | ${r.sample?.language ?? ''}`);
  const prompt = `${INSTRUCTIONS}\n\n${lines.join('\n')}\n`;
  const anchor = batch[0].sample?.id;
  const hash = reuseHash({ field: 'metadata', prompt: PROMPT_VERSION, input: prompt });
  const pageId = `author-strings-${hash}`;
  let text = null, meta = {};
  const hit = anchor ? await findRead({ page_id: pageId, book_id: anchor, field: 'metadata', model: MODEL, prompt_hash: hash }) : null;
  if (hit) { text = hit.text; meta = { reused_from: hit.key }; }
  else {
    const r = await gatedTextCall(prompt, { model: MODEL, task: 'author-strings', tmp });
    calls++;
    if (r.cls === 'quota') { console.error(`quota at batch ${i / BATCH}: ${r.err}`); break; }
    const u = unwrapSentinels(r.text);
    const arr = firstJson(u.inside ?? r.text, '[');
    if (!Array.isArray(arr)) { console.error(`batch ${i / BATCH}: no JSON array (${r.cls || r.problem || 'unparsed'}); skipped`); continue; }
    text = JSON.stringify(arr);
    meta = { model: MODEL, model_requested: MODEL, cli: 'agy', prompt_variant: PROMPT_VERSION, account: process.env.AGY_HOME ? 'second' : 'main', secs: r.secs, usage: r.usage, strings: batch.map((x) => x.string), finished_at: new Date().toISOString(), read_site: 'scripts/analysis/classify-author-strings.mjs', issue: 7660 };
    if (anchor) await keepRead({ page_id: pageId, book_id: anchor, field: 'metadata', text, model: MODEL, prompt_hash: hash, job: 'authors-7660', meta, prompt_text: prompt });
  }
  const arr = JSON.parse(text);
  for (const x of arr) {
    const r = batch[(x.i ?? 0) - 1];
    if (!r) continue;
    fs.writeSync(out, JSON.stringify({
      string: r.string, verdict: x.v, canonical_name: x.v === 'person' ? (x.name || null) : null, note: x.note ?? null,
      books: r.books, bucket: r.bucket, providers: r.providers, model: MODEL, prompt: PROMPT_VERSION, read: pageId, anchor,
    }) + '\n');
    written++;
  }
  console.log(`${new Date().toISOString()} batch ${i / BATCH + 1}/${Math.ceil(todo.length / BATCH)}: ${arr.length}/${batch.length} answered${hit ? ' (kept read reused)' : ''}; calls ${calls}`);
}
console.log(`DONE: ${written} verdicts, ${calls} model calls`);
