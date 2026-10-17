// Translates the English of an authored HTML document (a blog "made document" such as
// src/app/blog/techniques-of-the-body/document.json) into another language, for a thin
// /es/... twin route. Reads {body}, writes {body, generated, lang, source_generated}.
//
// What is translated: English text and the alt / aria-label / title attributes.
// What is NOT: every original (any element with a lang attribute), tags, classes,
// hrefs, image srcs, numbers. An original printed in English (p.orig lang=en) is kept and
// gets a translation added after it, as <p class="en" data-added="tr">. Each chunk goes to Claude (`claude -p`, the subscription;
// never the API) and is accepted only if (a) its sequence of tags is identical, attribute
// for attribute, apart from the three translatable attributes, and (b) every
// original-language element comes back byte for byte. A chunk that fails is retried
// once; then the script stops and writes nothing.
//
// Chunks are cached by content in scripts/output/, so re-running after the English
// changes re-translates only the changed sections.
//
// Run:
//   node scripts/maintenance/translate-html-document.mjs \
//     --in src/app/blog/techniques-of-the-body/document.json \
//     --out src/app/blog/techniques-of-the-body/document.es.json --lang es
//
// PRIOR ART: scripts/maintenance/localize-metadata.mjs — glosses titles and collection
// copy into books/collections.localized via Gemini; it handles short metadata strings,
// not an HTML document whose originals must survive byte for byte. Adapted from the
// atlas's scripts/translate-body.mjs (same verification), generalised to any document.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const IN = args.in, OUT = args.out, LANG = args.lang || 'es';
const CONCURRENCY = Number(args.concurrency || 4);
const MAX_CHUNK = 12000;
if (!IN || !OUT) { console.error('usage: --in <document.json> --out <document.xx.json> [--lang es]'); process.exit(1); }

const LANG_NAME = { es: 'Spanish (neutral, for an educated general reader; the register of a good museum catalogue)' };
if (!LANG_NAME[LANG]) { console.error(`no prompt for --lang ${LANG}`); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const CACHE = path.join('scripts', 'output', `translate-html-cache-${LANG}.json`);
fs.mkdirSync(path.dirname(CACHE), { recursive: true });
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

// ---- chunking: section boundaries, then sub-section boundaries if still large ----
function chunk(html) {
  const out = [];
  for (const sec of html.split(/(?=<section class="sec")/)) {
    if (sec.length <= MAX_CHUNK) { out.push(sec); continue; }
    let cur = '';
    for (const part of sec.split(/(?=<div class="sub")/)) {
      if (cur && cur.length + part.length > MAX_CHUNK) { out.push(cur); cur = ''; }
      cur += part;
    }
    if (cur) out.push(cur);
  }
  return out;
}

// ---- verification -------------------------------------------------------------
function tags(html) {
  return [...html.matchAll(/<\/?[a-zA-Z][^>]*>/g)].map((m) => m[0].replace(/\s(alt|aria-label|title)="[^"]*"/g, ' $1'));
}
function originals(html) {
  return [...html.matchAll(/<(\w+)[^>]*\blang="[^"]+"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
}
// The model's only permitted addition: a translation after an original printed in English.
const ADDED = /\s*<p class="en" data-added="tr">[\s\S]*?<\/p>/g;
function verify(src, tr) {
  const added = (tr.match(ADDED) || []).length, expected = (src.match(/<p class="orig" lang="en">/g) || []).length;
  if (added !== expected) return `added translations ${added}, expected ${expected}`;
  tr = tr.replace(ADDED, '');
  const a = tags(src), b = tags(tr);
  if (a.length !== b.length) return `tag count ${a.length} → ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `tag ${i}: ${a[i].slice(0, 80)} → ${b[i].slice(0, 80)}`;
  const oa = originals(src), ob = originals(tr);
  if (oa.length !== ob.length) return `originals ${oa.length} → ${ob.length}`;
  for (let i = 0; i < oa.length; i++) if (oa[i] !== ob[i]) return `original ${i} changed: ${oa[i].slice(0, 40)}`;
  return null;
}

// ---- translation ----------------------------------------------------------------
const PROMPT = `You are translating one piece of an HTML document from English into ${LANG_NAME[LANG]}.

The document quotes historical books that prescribe postures, breathing and movement (Chinese, Sanskrit, Tibetan, Greek, Latin, Hebrew, Arabic, French, English, Nahuatl and others), each original beside an English translation. Translate ONLY the English.

Hard rules:
- Return the SAME HTML: every tag, attribute, class, id, href, src and HTML comment unchanged, in the same order. Do not add, remove, merge or split elements.
- Translate English text content and the values of alt, aria-label and title attributes. Nothing else.
- Never touch the content of any element that has a lang attribute — those are the originals. Copy them byte for byte.
- One exception adds an element: an original printed in English, <p class="orig" lang="en">…</p>, stays exactly as it is, and IMMEDIATELY after it you add <p class="en" data-added="tr">its translation</p>. Add nothing else anywhere.
- Keep transliterated terms (haṭha, siddhāsana, qi, daoyin, juan, 'khrul 'khor), personal names and book titles as they are, with their diacritics. A title that is itself an English rendering (e.g. "Essence of the Taoist Canon") may be translated.
- Keep numbers, dates and page references as they are. "Read the page →" becomes "Leer la página →".
- Keep curly quotes “…” as they are.
- Plain, exact prose; no flourishes, nothing added or explained.

Output ONLY the translated HTML, with no code fence and no commentary.

HTML:
`;

function claude(input) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', 'opus', '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(out.trim().replace(/^```html?\s*/, '').replace(/\s*```$/, '')) : reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))));
    p.stdin.end(PROMPT + input);
  });
}

const pieces = chunk(doc.body);
const results = new Array(pieces.length);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
let failed = false, next = 0;

async function worker() {
  while (next < pieces.length && !failed) {
    const i = next++;
    const src = pieces[i];
    const k = hash(src);
    if (cache[k] && !verify(src, cache[k])) { results[i] = cache[k]; console.error(`chunk ${i}: cached`); continue; }
    let tr, err;
    for (let attempt = 1; attempt <= 2 && !failed; attempt++) {
      // Leading/trailing whitespace is restored from the source, not trusted to the model.
      tr = src.match(/^\s*/)[0] + (await claude(src.trim())) + src.match(/\s*$/)[0];
      err = verify(src, tr);
      if (!err) break;
      console.error(`chunk ${i} attempt ${attempt} failed verification: ${err}`);
    }
    if (err) { failed = true; console.error(`chunk ${i}: giving up`); return; }
    cache[k] = tr;
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    results[i] = tr;
    console.error(`chunk ${i + 1}/${pieces.length}: ok (${src.length} → ${tr.length} chars)`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (failed) process.exit(1);

const body = results.join('');
const whole = verify(doc.body, body);
if (whole) { console.error(`whole-document verification failed: ${whole}`); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), lang: LANG, source_generated: doc.generated, body }, null, 0) + '\n');
console.error(`wrote ${OUT} (${pieces.length} chunks, ${(body.length / 1024).toFixed(0)} KB)`);
