#!/usr/bin/env node
// #264 stage 2: candidate references from TEI e-text of the SAME edition (Deutsches Textarchiv, EEBO-TCP) for the
// sealed frame's drawn rows, and one coverage line for every drawn row of the cell's language that was looked for.
// PRIOR ART: scripts/eval/typed-refs-6012/ (match.mjs, align.mjs: the book-level DTA/CAMENA/EEBO pairing of
// 2026-10-06, whose aligned-pages files say which of our pages sit on which <pb>; lib.mjs teiPages() is the TEI
// parser used here, unchanged). #6012 paired books with stored OCR only and wrote no per-page record; this reads its
// pairs for the frame's books, adds a title/year match of every drawn row against the DTA manifest (the rows #6012
// never paired), fetches the TEI of each same-edition hit and cuts the <pb> page the frame row is on.
//   node scripts/eval/test-set-264/refs-tei.mjs --out=$JOB_SCRATCH/tei-cands.jsonl
// The output feeds leaf-packets.mjs / refs-write.mjs (--source=dta | eebo-tcp).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readFrame } from './refs-lib.mjs';
import { teiPages } from '../typed-refs-6012/lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUT = argOf('out');
const CACHE = path.join(process.env.JOB_SCRATCH || '/tmp', 'dl', 'tei');
fs.mkdirSync(CACHE, { recursive: true });
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const P6012 = 'scripts/eval/output/typed-refs-6012-2026-10-06';

const drawn = readFrame().filter((r) => r.drawn);
const isGerman = (r) => /^german-/.test(r.frame_cell) || /german/i.test(r.catalogue.language || '');
const isEnglish = (r) => /^english-/.test(r.frame_cell) || /english/i.test(r.catalogue.language || '');

// Hand-checked title matches of the DTA manifest title/year screen that #6012 never paired (a row whose book has
// a re-minted id or no stored OCR in October). Each was opened against our page: same title is not same edition.
const DTA_SCREENED = {
  'ts264-66cdd937c9af': { source_id: 'valentin_hochzeit_1616', outcome: 'other-edition', why: 'DTA transcribes another 1616 Zetzner setting (HAB A: 134.13 Phys.): its p.29 opens "bringt. Dort äffet", ours opens "deßwegen Männiglich"; #6012 aligned it with congruent=false' },
  'ts264-fda6cf3adff0': { source_id: 'loeber_heuschrecken_1693', outcome: 'no-etext', why: 'DTA holds Loeber\'s Jena account of the same 1693 swarm, a different text from this anonymous Heer-Zug' },
  'ts264-142317adf617': { source_id: 'magirus_antwort_1593', outcome: 'no-etext', why: 'DTA holds Magirus\'s reply in the Marx zum Lamm controversy, not Holder\'s Antwort' },
  'ts264-d02e4c41be8b': { source_id: '523706', outcome: 'no-etext', why: 'DTA\'s 1614 Klag- und Trostpredigt is Neomenius on Säbisch, a different sermon from Rachel plorans' },
};

const SOURCES = {
  dta: {
    aligned: gz(`${P6012}.dta.aligned-pages.jsonl.gz`), pairs: gz(`${P6012}.dta.pairs.jsonl.gz`), rows: drawn.filter(isGerman),
    url: (id) => `https://www.deutschestextarchiv.de/book/download_xml/${id}`, page_url: (id, facs) => `https://www.deutschestextarchiv.de/book/view/${id}?p=${Number(String(facs).replace(/\D/g, ''))}`,
    cookie: 'verified=1', // the site answers a script with a cookie-setting page first
    none: 'no DTA work matches this title and year (manifest screen of 5,481 DTA works, 2026-02-10 release)',
  },
  'eebo-tcp': {
    aligned: gz(`${P6012}.eebo-tcp.aligned-pages.jsonl.gz`), pairs: gz(`${P6012}.eebo-tcp.pairs.jsonl.gz`), rows: drawn.filter(isEnglish),
    url: (id) => `https://raw.githubusercontent.com/textcreationpartnership/${id}/master/${id}.xml`, page_url: (id) => `https://github.com/textcreationpartnership/${id}/blob/master/${id}.xml`,
    none: 'no EEBO-TCP text of this edition (#6012 STC/Wing and title match over the released TCP texts)',
  },
};

async function tei(source, id) {
  const f = path.join(CACHE, `${source}-${id}.xml`);
  if (!fs.existsSync(f)) {
    const r = await fetch(SOURCES[source].url(id), { headers: SOURCES[source].cookie ? { cookie: SOURCES[source].cookie } : {} });
    if (!r.ok) throw new Error(`${source} ${id}: ${r.status}`);
    const x = await r.text();
    if (!/<pb[\s/]/.test(x)) throw new Error(`${source} ${id}: no <pb> in the download`);
    fs.writeFileSync(f, x);
  }
  return fs.readFileSync(f, 'utf8');
}
// The raw unit is the TEI between this <pb> and the next, as the source encoded it.
function rawPage(xml, idx) {
  const at = [...xml.matchAll(/<pb[\s/][^>]*>/g)].map((m) => m.index);
  return xml.slice(at[idx - 1] ?? 0, at[idx] ?? xml.length);
}
const pageText = (p) => [p.text, ...p.notes].filter(Boolean).join('\n');

const out = [];
for (const [source, S] of Object.entries(SOURCES)) {
  const byKey = new Map(S.aligned.map((a) => [`${a.book_id}|${a.page_number}`, a]));
  const pairOf = new Map(S.pairs.map((p) => [p.book_id, p]));
  for (const r of S.rows) {
    const base = { row: r.row, frame_cell: r.frame_cell, source, image_url: r.image?.url ?? null, script: r.observed?.script ?? null };
    const scr = source === 'dta' ? DTA_SCREENED[r.row] : null;
    const a = byKey.get(`${r.book_id}|${r.page_number}`);
    const pair = pairOf.get(r.book_id);
    let id = null, offset = null;
    if (a && a.kind === 'same-edition' && a.congruent) id = a.source_id;
    else if (!a && pair?.kind === 'same-edition') {
      // Same edition by #6012, but this page was beyond the stretch it aligned: take the <pb> at the same offset
      // from the aligned stretch; the leaf check decides whether that holds this far in.
      const near = S.aligned.filter((x) => x.book_id === r.book_id).sort((x, y) => Math.abs(x.page_number - r.page_number) - Math.abs(y.page_number - r.page_number))[0];
      if (near) { id = pair.source_id; offset = { from_page: near.page_number, from_pb: near.ref_pb?.[0] ?? null }; }
    }
    if (!id) {
      if (scr) { out.push({ ...base, source_id: scr.source_id, outcome: scr.outcome, why: scr.why }); continue; }
      if (a) { out.push({ ...base, source_id: a.source_id, outcome: 'other-edition', why: `#6012 aligned this page as ${a.kind}, congruent=${a.congruent}` }); continue; }
      if (pair && pair.verdict !== 'text-not-found') { out.push({ ...base, source_id: pair.source_id, outcome: 'other-edition', why: `#6012 pair ${pair.kind ?? pair.verdict}: ${String(pair.why ?? '').slice(0, 140)}` }); continue; }
      out.push({ ...base, outcome: 'no-etext', why: S.none }); continue;
    }
    const xml = await tei(source, id);
    const pages = teiPages(xml);
    let i;
    if (offset) {
      const j = pages.findIndex((p) => p.n === offset.from_pb);
      i = j + (r.page_number - offset.from_page);
    } else {
      i = pages.findIndex((p) => (a.ref_facs ? p.facs === a.ref_facs : p.n === a.ref_pb?.[0]));
    }
    const p = pages[i];
    if (!p) { out.push({ ...base, source_id: id, outcome: 'unlocated', why: `no <pb> for ${JSON.stringify(a?.ref_pb ?? offset)}` }); continue; }
    // teiPages keeps an implicit page 0 only when it has text, so the raw slice is found by the pb's own index.
    const pbIdx = pages[0].n === null && pages[0].facs === null ? i : i + 1;
    const text = pageText(p);
    const ctl = pages[i + 1] && pageText(pages[i + 1]).length > 80 ? pages[i + 1] : pages[i - 1];
    const words = (t) => t.replace(/\s+/g, ' ').trim();
    out.push({ ...base, source_id: id, outcome: 'located', pb: p.n, facs: p.facs, gaps: p.gaps,
      loc: a ? { rule: '6012-aligned', overlap: a.overlap, vote_share: a.vote_share, edges: a.edges } : { rule: '6012-same-edition-offset', ...offset },
      raw: rawPage(xml, pbIdx), text, head: words(p.text).slice(0, 90), tail: words(p.text).slice(-90),
      control_head: ctl ? words(ctl.text).slice(0, 90) : null, control_tail: ctl ? words(ctl.text).slice(-90) : null,
      source_url: S.page_url(id, p.facs), licence_target: (xml.match(/<licence[^>]*target="([^"]+)"/) || [])[1] ?? null,
      edition_note: source === 'dta' ? (xml.match(/<msIdentifier>[\s\S]*?<\/msIdentifier>/) || [''])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null });
  }
}
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = out.reduce((t, o) => { const k = `${o.source}|${o.frame_cell}|${o.outcome}`; t[k] = (t[k] || 0) + 1; return t; }, {});
console.log(JSON.stringify(tally, null, 1));
