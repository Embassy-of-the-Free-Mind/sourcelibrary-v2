// PRIOR ART: scripts/import/ia-ocr-ingest.mjs `iaLeaves()` + `leafTexts()` — copied here verbatim
// (2026-09-30) so the off-leaf detector (scripts/audit/ia-model-ocr-off-leaf.mjs, #5309) reads the
// Archive's leaves through the SAME fetch, file-name rule and parser as the lane that writes them.
// The ingester keeps its inline copy for now (it was being edited in #5361); switching it to import
// from here is a follow-up. Keep the two in lockstep until then.
// scripts/lib/ia-ocr-meta.mjs — the rate-limited fetch and the item's `_djvu.xml` file list.
//
// ia-djvu-leaves — the Internet Archive's own per-leaf text for an item, from its `_djvu.xml`.
//
// ALIGNMENT PROPERTY (#4790, measured 2026-09-13): the XML's <OBJECT> sequence and the IIIF
// `/page/n<k>` index skip the same scandata-excluded leaves, so OBJECT[k] IS leaf `/page/n<k>`.
// The raw `*_jp2.zip` does NOT skip them (scripts/lib/ia-access-leaves.mjs) — never index these
// leaves by a zip ordinal.
import fs from 'node:fs';
import path from 'node:path';
import { iaFetch } from './ia-ocr-meta.mjs';

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

/** OBJECT[k] → plain text: words joined by spaces, lines by \n, paragraphs by a blank line. */
export function leafTexts(xml) {
  const out = [];
  const objs = xml.split(/<OBJECT\b/).slice(1);
  for (const o of objs) {
    const paras = [];
    for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
      const lines = [];
      for (const l of p.split(/<LINE\b/).slice(1)) {
        const words = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
        if (words.length) lines.push(words.join(' '));
      }
      if (lines.length) paras.push(lines.join('\n'));
    }
    out.push(paras.join('\n\n'));
  }
  return out;
}

/**
 * Leaf texts for an item → `{ leaves }` or `{ leaves: null, reason }`. The cache stores the PARSED
 * leaves (`<id>.leaves.json`, ~1/10 the size of the word-boxed XML): the 2,076-book English run
 * filled 23 GB of XML on a 150 GB disk, and the Latin shelf is four times larger. Legacy
 * `<id>_djvu.xml` files are still read. `writeCache: false` reads the cache but never adds to it
 * (a corpus-wide walk would add ~1 MB per book).
 */
export async function iaLeaves(id, xmlFiles = [], { cacheDir = null, writeCache = true } = {}) {
  const cachedJson = cacheDir ? path.join(cacheDir, `${id}.leaves.json`) : null;
  const cachedXml = cacheDir ? path.join(cacheDir, `${id}_djvu.xml`) : null;
  if (cachedJson && fs.existsSync(cachedJson)) return { leaves: JSON.parse(fs.readFileSync(cachedJson, 'utf8')), cached: true };
  let xml;
  if (cachedXml && fs.existsSync(cachedXml)) xml = fs.readFileSync(cachedXml, 'utf8');
  else {
    // XML FILE NAME (2026-09-13). The derivative is named after the uploaded file, not the item:
    // `<id>_djvu.xml` is the common case, not the rule. The metadata's file list is the authority.
    // One XML → that is the scan the IIIF `/page/n<k>` index runs over, same alignment property as
    // ever (the gate still verifies it per book). Several XMLs → several scans in one item; which
    // one our page URLs index is not knowable here, so the item is refused rather than guessed.
    if (xmlFiles.length > 1) return { leaves: null, reason: `${xmlFiles.length} _djvu.xml files on the item (ambiguous): ${xmlFiles.slice(0, 3).join(' | ')}` };
    const name = xmlFiles[0] || `${id}_djvu.xml`;
    const res = await iaFetch(`https://archive.org/download/${id}/${encodeURIComponent(name)}`);
    if (!res.ok) return { leaves: null, reason: `HTTP ${res.status} for ${name}${xmlFiles.length ? '' : ' (metadata lists no _djvu.xml)'}` };
    xml = await res.text();
  }
  const leaves = leafTexts(xml);
  if (cachedJson && writeCache) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cachedJson, JSON.stringify(leaves)); }
  return { leaves };
}
