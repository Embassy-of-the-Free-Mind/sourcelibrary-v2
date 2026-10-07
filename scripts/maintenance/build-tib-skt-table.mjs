#!/usr/bin/env node
/**
 * PRIOR ART: /root/tibetan-reocr/fetch-84000.sh (Hetzner, #4742) fetched the 396 84000 Kangyur
 * TEI files for OCR evaluation and never parsed their glossaries; scripts/eval/tibetan-mt-ab/
 * uses the 84000 English as a translation reference, not the term pairs. `git grep -il glossary`
 * found no Tibetan↔Sanskrit table in the repo. scripts/lib/translit-skeleton.mjs romanises a
 * page; it knows no equivalences.
 *
 * Builds the Tibetan↔Sanskrit reference table for the note fact-check lane (#5647, stage 2a).
 *
 * LICENCES — the table is a LOOKUP kept on the box. It is never committed and never served.
 *   84000 TEI glossaries        CC BY-NC-ND 3.0 (stated in every file's <availability>)
 *   84000 via Steinert dump     same licence (christiansteinert/tibetan-dictionary 46-84000Skt)
 *   Mahāvyutpatti               9th-c. text; digital edition by the DILA glossaries team, no
 *                               licence stated in the mirror
 *   Rangjung Yeshe 3.0 (2003)   © Erik Pema Kunsang; no open licence
 * Using a single name equivalence as a fact to check a note is a lookup; redistributing the
 * files is not allowed, so the output lives outside the repo (default below) and every row
 * names its source and licence.
 *
 * Usage (Hetzner):
 *   node scripts/maintenance/build-tib-skt-table.mjs \
 *     [--tei /root/tibetan-reocr/84000-tei] [--refs /root/factcheck-lane/refs] \
 *     [--out /root/factcheck-lane/refs/tib-skt-table.jsonl]
 * Fetch the three dictionary files into --refs first:
 *   for d in 02-RangjungYeshe 21-Mahavyutpatti-Skt 46-84000Skt; do curl -sfL -o "$REFS/$d" \
 *     "https://raw.githubusercontent.com/christiansteinert/tibetan-dictionary/master/_input/dictionaries/public/$d"; done
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const TEI = arg('tei', '/root/tibetan-reocr/84000-tei');
const REFS = arg('refs', '/root/factcheck-lane/refs');
const OUT = arg('out', path.join(REFS, 'tib-skt-table.jsonl'));

if (path.resolve(OUT).startsWith(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'))) {
  console.error('refusing to write the table inside the repository (licences forbid redistribution)');
  process.exit(2);
}

export const LICENCES = {
  '84000-tei': 'CC BY-NC-ND 3.0 — 84000: Translating the Words of the Buddha; on-box lookup only',
  '84000-steinert': 'CC BY-NC-ND 3.0 — 84000 glossary via christiansteinert/tibetan-dictionary (46-84000Skt); on-box lookup only',
  'mahavyutpatti-dila': 'Mahāvyutpatti, digital edition by the DILA glossaries team (glossaries.dila.edu.tw) via christiansteinert/tibetan-dictionary; licence not stated; on-box lookup only',
  'rangjung-yeshe-3': '© Erik Pema Kunsang, Rangjung Yeshe Tibetan-English Dharma Dictionary 3.0 (2003); no open licence; on-box lookup only',
};

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
const rows = [];
const counts = {};
const add = (r) => {
  if (!r.wylie || !r.skt) return;
  r.wylie = r.wylie.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/[\s/]+$/, '').trim();
  r.skt = r.skt.replace(/\u00ad/g, '').replace(/^[*\s]+|[\s,;.]+$/g, '').trim();
  if (!r.wylie || r.skt.length < 2) return;
  r.licence = LICENCES[r.src];
  rows.push(r);
  counts[r.src] = (counts[r.src] || 0) + 1;
};

// 1. 84000 TEI glossaries (Kangyur, on the box)
if (fs.existsSync(TEI)) {
  for (const file of fs.readdirSync(TEI).filter((f) => f.endsWith('.xml'))) {
    const xml = fs.readFileSync(path.join(TEI, file), 'utf8');
    const toh = (file.match(/toh[0-9]+[a-z]?(?:[-,][0-9]+[a-z]?)*/i) || [''])[0];
    for (const g of xml.matchAll(/<gloss\b([^>]*)>([\s\S]*?)<\/gloss>/g)) {
      const type = (g[1].match(/type="([^"]+)"/) || [])[1] || 'term';
      const id = (g[1].match(/xml:id="([^"]+)"/) || [])[1] || '';
      const body = g[2].replace(/<note\b[\s\S]*?<\/note>/g, '');
      const terms = [...body.matchAll(/<term\b([^>]*)>([\s\S]*?)<\/term>/g)].map((t) => ({ a: t[1], v: decode(t[2]) }));
      const wy = terms.filter((t) => /xml:lang="Bo-Ltn"/.test(t.a)).map((t) => t.v).filter(Boolean);
      const sk = terms.filter((t) => /xml:lang="Sa-Ltn"/.test(t.a)).map((t) => ({ v: t.v, att: (t.a.match(/type="([^"]+)"/) || [])[1] || 'unspecified' })).filter((t) => t.v);
      const en = (terms.find((t) => /type="translationMain"/.test(t.a)) || terms.find((t) => !/xml:lang|type="definition"/.test(t.a)) || {}).v || null;
      for (const w of wy) for (const s of sk) add({ wylie: w, skt: s.v, type, src: '84000-tei', ref: `${toh}#${id}`, att: s.att, en });
    }
  }
}

// 2. 84000 via the Steinert dump: "wylie|<type> skt1, skt2"
const steinert = path.join(REFS, '46-84000Skt');
if (fs.existsSync(steinert)) {
  for (const line of fs.readFileSync(steinert, 'utf8').split('\n')) {
    const [w, rest] = line.split('|');
    if (!w || !rest) continue;
    const m = rest.match(/^<([a-z]+)>\s*(.*)$/);
    const type = m ? m[1] : 'term';
    for (const s of (m ? m[2] : rest).split(/\s*,\s*/)) add({ wylie: w, skt: s, type, src: '84000-steinert', ref: '46-84000Skt', att: 'unspecified' });
  }
}

// 3. Mahāvyutpatti: "wylie|skt"
const mvy = path.join(REFS, '21-Mahavyutpatti-Skt');
if (fs.existsSync(mvy)) {
  fs.readFileSync(mvy, 'utf8').split('\n').forEach((line, i) => {
    const [w, s] = line.split('|');
    if (!w || !s) return;
    for (const v of s.split(/\s*[,;]\s*/)) add({ wylie: w, skt: v.replace(/\(.*?\)/g, ''), type: 'term', src: 'mahavyutpatti-dila', ref: `mvy-line-${i + 1}`, att: 'dictionary' });
  });
}

// 4. Rangjung Yeshe: Sanskrit only where the entry marks it ("Skt. X", "[x-y]" with IAST or a
//    hyphenated compound), or where the whole definition is one capitalised name ("Priyasena").
const ry = path.join(REFS, '02-RangjungYeshe');
if (fs.existsSync(ry)) {
  fs.readFileSync(ry, 'utf8').split('\n').forEach((line, i) => {
    const bar = line.indexOf('|');
    if (bar < 1 || line.startsWith('#')) return;
    const w = line.slice(0, bar); const def = line.slice(bar + 1).trim();
    const ref = `ry-line-${i + 1}`;
    for (const m of def.matchAll(/\bSkt\.?\s+([A-Za-zĀāĪīŪūṚṛṢṣŚśṆṇḌḍṬṭÑñṂṃḤḥ' -]{3,60}?)(?=[.,;)\]]|$)/g)) {
      add({ wylie: w, skt: m[1], type: 'term', src: 'rangjung-yeshe-3', ref, att: 'skt-marked' });
    }
    for (const m of def.matchAll(/\[([a-zāīūṛṣśṇḍṭñṃḥ]+(?:-[a-zāīūṛṣśṇḍṭñṃḥ]+)+|[a-z]*[āīūṛṣśṇḍṭñṃḥ][a-zāīūṛṣśṇḍṭñṃḥ]*)\]/g)) {
      add({ wylie: w, skt: m[1], type: 'term', src: 'rangjung-yeshe-3', ref, att: 'bracketed' });
    }
    if (/^[A-ZĀĪŪṢŚ][a-zāīūṛṣśṇḍṭñṃḥ]{3,30}$/.test(def)) add({ wylie: w, skt: def, type: 'person', src: 'rangjung-yeshe-3', ref, att: 'bare-name' });
  });
}

// De-duplicate identical (wylie, skt, src) rows, keeping the first ref.
const seen = new Set();
const out = rows.filter((r) => { const k = `${r.wylie.toLowerCase()}|${r.skt.toLowerCase()}|${r.src}`; if (seen.has(k)) return false; seen.add(k); return true; });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const kept = {};
for (const r of out) kept[r.src] = (kept[r.src] || 0) + 1;
console.log(JSON.stringify({ out: OUT, rows: out.length, by_source: kept, raw: counts, built_at: new Date().toISOString() }, null, 1));
