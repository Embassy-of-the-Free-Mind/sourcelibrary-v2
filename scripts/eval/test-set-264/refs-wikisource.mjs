#!/usr/bin/env node
// #264 stage 2: Wikisource proofread pages of the SAME edition as the frame's drawn French, Italian and Latin rows,
// and one coverage line for every such row that was looked for.
// PRIOR ART: scripts/eval/harvest-wikisource-gt.mjs (draws Wikisource pages first and looks for our book after,
// which is the selection #264 exists to avoid) and lib/wikisource-text.mjs cleanPageText() (the wikitext cleaner,
// used here unchanged, after the two hyphenation templates below). This goes the other way: from a sealed frame
// row to the Wikisource page of its edition, or a recorded reason there is none.
//
// How the rows were searched (2026-11-13, logs in $JOB_SCRATCH): (1) Wikimedia Commons, insource: the scan's
// IA/BSB identifier, then globalusage of every hit file on any Wikisource; (2) a title search of the Index
// namespace of fr (Livre), it (Indice) and la (Liber) Wikisource for every row; (3) for each plausible index, the
// page located by a full-text search of a phrase read on our page image, and the index's edition read from its
// metadata. A page is used only at proofread level 3 or 4 (quality 1 is unproofread OCR, not a reference).
//   node scripts/eval/test-set-264/refs-wikisource.mjs --out=$JOB_SCRATCH/ws-cands.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { readFrame, wsNorm } from './refs-lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUT = argOf('out');
const UA = { 'user-agent': 'SourceLibrary-eval/1.0 (internal reference search)' };

// Located and same setting. `edition` is what the index page says, and why it is the same setting as our scan.
const FOUND = {
  'ts264-d6d26aa5f3fd': { host: 'fr.wikisource.org', page: 'Page:Zola - Nana.djvu/323', edition: 'fr.wikisource transcribes Charpentier, Paris 1881 (BnF bpt6k80468b); our scan is the Charpentier 1893 issue. Same setting: page 323 opens on the same broken word ("ments de silence") and closes on the same line ("en le laissant"), printed page = djvu page throughout' },
  'ts264-21e6c998e393': { host: 'fr.wikisource.org', page: 'Page:Bergson - Essai sur les données immédiates de la conscience.djvu/144', edition: 'fr.wikisource transcribes Alcan, Paris 1908 (6th ed.), IA essaisurlesdonn00berg; our scan is the Google copy of the same 1908 edition (essaisurlesdonn00berggoog). Printed page 132 on both' },
  'ts264-7773ef22bf87': { host: 'fr.wikisource.org', page: 'Page:Sade - Philosophie dans le boudoir, Tome I, 1795.djvu/161', edition: 'fr.wikisource transcribes "Londres, aux dépens de la Compagnie, 1795" (BnF Enfer 535); our scan is a copy of the same 1795 printing (ECCO). Printed page 151 on both, every line break the same' },
  'ts264-ec9ea4c601a9': { host: 'it.wikisource.org', page: 'Pagina:Dubbi amorosi.djvu/62', edition: 'it.wikisource transcribes our own scan: its index names IA dubbjamorosialt00aretgoog (Roma, "Stamperia vaticana", 1792). Printed page 54' },
};
// Looked at and rejected, with the reason (rows not named here: no Wikisource index of the work was found).
const REJECTED = {
  'ts264-2f2c73eb4f8e': ['unproofread', 'it.wikisource "Galilei - Discorsi … 1638.djvu" (the 1638 Elsevier edition) has this page at quality 1, and the text pasted there is the modernised Edizione Nazionale, not a transcription of the 1638 page'],
  'ts264-6d3c66c6897d': ['unproofread', 'fr.wikisource "Ronsard - Les Amours, 1553.djvu" is our scan (bub_gb_kfK3I2KHZ6QC) but the page is at quality 1 (raw OCR)'],
  'ts264-dd40169223e2': ['unproofread', 'fr.wikisource "D\'Hervey de Saint-Denys - Les Rêves …, 1867.djvu" is from our scan (IA lesrvesetlesmoye00herv) but pages 413-416 are at quality 1 (raw OCR)'],
  'ts264-793248e7d0c7': ['other-edition', 'fr.wikisource "Mirabeau - Le Rideau levé …, 1882.djvu" is another 1882 setting: the passage on our printed p.169 is on its p.141'],
  'ts264-c3ef260a3c81': ['no-etext', 'fr.wikisource "Voltaire - Candide, 1759.djvu" has 2 pages transcribed, not this one (and 1759 had some 17 settings)'],
  'ts264-f8991c35cb3f': ['no-etext', 'fr.wikisource "Voltaire - Candide, 1759.djvu" has 2 pages transcribed, not this one (and 1759 had some 17 settings)'],
  'ts264-5e42efcf55d1': ['other-edition', 'fr.wikisource has the Pagnerre 1848 (12th ed., 4 tomes); our scan is the 1850 edition'],
  'ts264-35e8bf182d9a': ['no-etext', 'fr.wikisource has Mesmer\'s Mémoire; our page is from another work bound in the volume ("Recherches", p.102)'],
  'ts264-4af5bd322869': ['no-etext', 'it.wikisource "Bruno - Cena de le ceneri.djvu" exists, but our page is a full-page woodcut with only the running head (DIALOGO TERZO 79): no body text to reference'],
  'ts264-036e9efb86f1': ['no-etext', 'Commons holds "Basile - Il pentamerone, 1925, Vol.2.djvu" (our scan) but no Wikisource transcribes it (it.wikisource has Vol. I only)'],
  'ts264-532a65816dbc': ['no-etext', 'Commons holds "Aretino - I ragionamenti. 2, 1920.djvu" (our scan) but no Wikisource index uses it'],
  'ts264-351f4bd87d11': ['other-edition', 'la.wikisource has De occulta philosophia 1533; our scan is the 1550 edition'],
  'ts264-9b99bee0d6ba': ['other-edition', 'la.wikisource has De occulta philosophia 1533; our scan is a 1531 printing of Book II'],
};

async function getPage(host, title) {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(`https://${host}/w/api.php?action=query&prop=revisions|proofread&rvprop=content|ids|timestamp&rvslots=main&format=json&formatversion=2&titles=${encodeURIComponent(title)}`, { headers: UA });
      const p = JSON.parse(await r.text()).query.pages[0];
      return { q: p.proofread?.quality ?? null, rev: p.revisions[0].revid, ts: p.revisions[0].timestamp, content: p.revisions[0].slots.main.content };
    } catch { await new Promise((res) => setTimeout(res, 20000)); }
  }
  throw new Error(`${host} ${title}: no answer`);
}

const rows = readFrame().filter((r) => r.drawn && /^(french|italian|latin)-/.test(r.frame_cell));
const out = [];
for (const r of rows) {
  const base = { row: r.row, frame_cell: r.frame_cell, source: 'wikisource', image_url: r.image?.url ?? null, script: r.observed?.script ?? null };
  const f = FOUND[r.row];
  if (!f) {
    const [outcome, why] = REJECTED[r.row] ?? ['no-etext', 'no Wikisource index of this edition (Commons search on the scan id, Index-namespace title search on fr/it/la Wikisource)'];
    out.push({ ...base, outcome, why }); continue;
  }
  const p = await getPage(f.host, f.page);
  if (!(p.q >= 3)) { out.push({ ...base, outcome: 'unproofread', why: `${f.page} at quality ${p.q}` }); continue; }
  const body = p.content.replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, '');
  const text = wsNorm(p.content);
  const words = text.replace(/\s+/g, ' ').trim();
  out.push({ ...base, outcome: 'located', host: f.host, ws_page: f.page, quality: p.q, revid: p.rev, rev_ts: p.ts, edition_note: f.edition,
    loc: { rule: 'phrase search + index metadata, read against our page image' },
    raw: p.content, text, head: words.slice(0, 90), tail: words.slice(-90), body_chars: body.length,
    source_url: `https://${f.host}/w/index.php?title=${encodeURIComponent(f.page.replace(/ /g, '_'))}&oldid=${p.rev}` });
  await new Promise((res) => setTimeout(res, 3000));
}
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = out.reduce((t, o) => { const k = `${o.frame_cell}|${o.outcome}`; t[k] = (t[k] || 0) + 1; return t; }, {});
console.log(JSON.stringify(tally, null, 1));
