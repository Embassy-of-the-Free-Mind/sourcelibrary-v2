#!/usr/bin/env node
/**
 * Import ONE ETCSL composition (composite + translation) as a text-edition book,
 * in the same shape as the 373 ETCSL books imported 2026-03-10: one page per
 * translation paragraph, `ocr` = the composite lines that paragraph translates
 * ("N. transliteration"), `translation` = ETCSL's own English paragraph.
 *
 * PRIOR ART: the 2026-03 bulk ETCSL importer was never committed (git log has no
 * add/delete of it); scripts/etcsl/fetch-cdli-witnesses.mjs and
 * harvest-gilgamesh-tablets.mjs enrich existing ETCSL books but create none.
 * Written for #4391 — ETCSL 2.1.1 (The Sumerian king list) was the only gap in
 * section 2.1. Its HTML wraps the text in a `<body id="c211.ver1">` version
 * container that its siblings lack, the likely reason the bulk run skipped it.
 *
 *   node --env-file=.env.production.local scripts/etcsl/import-etcsl-text.mjs 2.1.1 \
 *     --title "The Sumerian king list" --category "Royal and Court Poetry" \
 *     --subcategory "Early dynastic" [--write]
 *
 * Dry run by default (prints the pages). --write inserts through insertBookIfNew(),
 * so a second run is declined by the source fingerprint `etcsl:etcsl-<id>`.
 */
import { createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { initialPublication } from '../lib/publication.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const BASE = 'https://etcsl.orinst.ox.ac.uk/cgi-bin/etcsl.cgi';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const SUP = { d: 'ᵈ', ki: 'ᵏⁱ', f: 'ᶠ', m: 'ᵐ', jic: 'ĝeš', '?': '(?)', '!': '(!)' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
}

/** Remove every `<span class="cls">…</span>`, nested spans included. */
function dropSpans(html, cls) {
  const open = `<span class="${cls}">`;
  let i;
  while ((i = html.indexOf(open)) !== -1) {
    let depth = 0, j = i;
    const re = /<span\b[^>]*>|<\/span>/g;
    re.lastIndex = i;
    let m;
    while ((m = re.exec(html))) {
      depth += m[0] === '</span>' ? -1 : 1;
      if (depth === 0) { j = re.lastIndex; break; }
    }
    html = html.slice(0, i) + html.slice(j);
  }
  return html;
}

/** One composite line → plain transliteration, in the sibling books' form
 *  (word forms only: no editorial notes, variants, or damage brackets). */
function lineText(td) {
  let h = td;
  h = h.replace(/\{\(<span class="note">[\s\S]*?<\/span>\)[\s\S]*?\}/g, ''); // variant readings
  h = dropSpans(h, 'note');
  h = dropSpans(h, 'biblio');
  h = h.replace(/\(\s*\)/g, '');
  h = h.replace(/<sup>\s*([^<]*?)\s*<\/sup>/g, (_, s) => SUP[s] ?? `^${s}`);
  h = h.replace(/<sub>([^<]*)<\/sub>/g, '$1');
  h = decode(h.replace(/<[^>]+>/g, ''));
  return h.replace(/[[\]{}⸢⸣\\/]/g, '').replace(/\s+/g, ' ').trim();
}

function paraText(html) {
  let h = html.replace(/^\s*<a [^>]*>[^<]*<\/a><a name='[^']*'><\/a>/, '');
  // Editorial gaps ("2 lines missing", manuscript notes) are set apart, not prose.
  h = h.replace(/<span class="gap">([\s\S]*?)<\/span>/g, ' ($1) ');
  h = decode(h.replace(/<[^>]+>/g, ''));
  return h.replace(/[{}]/g, '').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const etcslId = process.argv[2];
  const write = process.argv.includes('--write');
  const title = arg('title');
  const category = arg('category');
  const subcategory = arg('subcategory');
  if (!etcslId || !/^\d+(\.\w+)+$/.test(etcslId) || !title || !category || !subcategory) {
    console.error('usage: import-etcsl-text.mjs <etcsl-id> --title T --category C --subcategory S [--write]');
    process.exit(1);
  }
  const short = etcslId.replace(/\./g, '');
  const compositeUrl = `${BASE}?text=c.${etcslId}`;
  const [chtml, thtml] = await Promise.all([fetchText(compositeUrl), fetchText(`${BASE}?text=t.${etcslId}`)]);

  // Composite: each row links the line to its translation paragraph.
  const lines = new Map(); // paragraph id → ["N. text"]
  const rowRe = new RegExp(`<tr><td[^>]*><a href='[^']*lineid=(t${short}\\.p\\d+)'>([^<]+)\\.</a><a name='c${short}\\.[^']*'></a></td><td>([\\s\\S]*?)</td></tr>`, 'g');
  let m, nLines = 0;
  while ((m = rowRe.exec(chtml))) {
    const [, pid, num, td] = m;
    const text = lineText(td);
    if (!lines.has(pid)) lines.set(pid, []);
    lines.get(pid).push({ num, text });
    nLines++;
  }

  // Translation: one <p> per paragraph, opened by its line-range link.
  const paras = [];
  const pRe = new RegExp(`<p><a href='[^']*'>([^<]+)\\.</a><a name='(t${short}\\.p\\d+)'></a>([\\s\\S]*?)</p>`, 'g');
  while ((m = pRe.exec(thtml))) paras.push({ range: m[1], pid: m[2], text: paraText(m[3]) });

  if (paras.length === 0 || nLines === 0) throw new Error(`parsed ${paras.length} paragraphs / ${nLines} lines — refusing`);
  const orphanLines = [...lines.keys()].filter((pid) => !paras.some((p) => p.pid === pid));
  const emptyParas = paras.filter((p) => !lines.has(p.pid));
  if (orphanLines.length || emptyParas.length) {
    throw new Error(`line/paragraph mismatch: lines without paragraph ${orphanLines}, paragraphs without lines ${emptyParas.map((p) => p.pid)}`);
  }
  console.log(`ETCSL ${etcslId}: ${nLines} composite lines, ${paras.length} translation paragraphs`);

  const now = new Date();
  const bookOid = new ObjectId();
  const bookId = bookOid.toHexString();
  const pages = paras.map((p, i) => {
    const oid = new ObjectId();
    const ls = lines.get(p.pid);
    const ocr = ls.map((l) => `${l.num}. ${l.text}`).join('\n');
    return makePageDoc({
      _id: oid, id: oid.toHexString(), book_id: bookId, page_number: i + 1,
      photo: null, photo_original: null,
      ocr: { data: ocr, language: 'Sumerian', model: 'etcsl-corpus', source: 'corpus', prompt_version: 'etcsl-import', updated_at: now, content_hash: sha256(ocr) },
      translation: { data: p.text, language: 'English', model: 'etcsl-corpus', source: 'corpus', updated_at: now, content_hash: sha256(p.text) },
      etcsl_line_range: p.range, etcsl_paragraph_id: p.pid,
      created_at: now, updated_at: now,
    });
  });

  if (process.argv.includes('--json')) { console.log(JSON.stringify(pages)); return; } // machine-readable dry run
  for (const p of pages) {
    console.log(`\n— p.${p.page_number} [${p.etcsl_paragraph_id} ${p.etcsl_line_range}] ${p.ocr.data.split('\n').length} lines`);
    console.log(p.ocr.data.split('\n').slice(0, 3).join('\n'));
    console.log(`  EN: ${p.translation.data.slice(0, 160)}…`);
  }
  if (!write) { console.log('\n(dry run — pass --write to insert)'); return; }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db('bookstore');
    const slugBase = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slugTaken = await db.collection('books').countDocuments({ slug: slugBase });
    const fields = {
      _id: bookOid, id: bookId, slug: slugTaken ? `${slugBase}-etcsl-${short}` : slugBase,
      title, display_title: title, author: 'Anonymous Sumerian',
      language: 'Sumerian', original_language: 'Sumerian',
      published: 'Ur III / Old Babylonian (c. 2100–1600 BCE)', year: -2000,
      categories: [category, subcategory].map((s) => s.toLowerCase().replace(/\s+/g, '-')),
      description: `Sumerian literary composition from the Electronic Text Corpus of Sumerian Literature (ETCSL ${etcslId}). ${category}: ${subcategory}.`,
      image_source: {
        provider: 'etcsl', provider_name: 'Electronic Text Corpus of Sumerian Literature',
        source_url: compositeUrl, identifier: `etcsl-${etcslId}`,
        license: 'Open access (University of Oxford)',
        attribution: 'Electronic Text Corpus of Sumerian Literature, University of Oxford',
        access_date: now.toISOString().slice(0, 10),
        contributing_library: 'University of Oxford (ETCSL)',
      },
      contributing_library: 'ETCSL (University of Oxford)',
      dublin_core: {
        dc_source: 'Electronic Text Corpus of Sumerian Literature (ETCSL)', dc_identifier: `etcsl-${etcslId}`,
        dc_publisher: 'Oriental Institute, University of Oxford', dc_rights: 'Open access',
        dc_language: 'Sumerian', dc_type: 'Text', dc_format: 'text/xml', dc_subject: [category, subcategory],
      },
      etcsl_id: etcslId, etcsl_category: category,
      pages_count: pages.length, pages_ocr: pages.length, pages_translated: pages.length,
      pipeline_auto: { status: 'images_complete', source: 'import', queued_at: now, started_at: now, completed_at: now, chapters_needed: true },
      thumbnail: null,
      ...initialPublication({ state: 'public', by: 'script:etcsl-import', issue: 4391, now }),
      created_at: now, updated_at: now,
    };
    const r = await insertBookIfNew(db, fields, { importer: 'script:etcsl-import', sourceIdentifier: `etcsl-${etcslId}`, sourceUrl: compositeUrl });
    if (!r.inserted) { console.log(`skip: ${r.message}`); return; }
    try {
      await db.collection('pages').insertMany(pages, { ordered: true });
    } catch (err) {
      console.error(`pages insert failed for book ${bookId} — the book row exists without pages; fix by hand`);
      throw err;
    }
    console.log(`\ninserted book ${bookId} (/book/${fields.slug}) with ${pages.length} pages`);
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
