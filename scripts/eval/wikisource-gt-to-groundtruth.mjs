#!/usr/bin/env node
// PRIOR ART: build-reference-groundtruth.mjs writes ground-truth/ files by pinning a
// curated passage to a book we HOLD (book_id + page_number). Wikisource-harvested pages
// are pages we do not hold — the image comes from Commons, not our corpus — so that
// pinning path cannot express them. This converts the harvest into the same on-disk
// shape so score-transcripts.mjs / stats-cross-model.mjs work unchanged.
/**
 * wikisource-gt-to-groundtruth.mjs — convert harvest-wikisource-gt.mjs output into
 * ground-truth files the existing scorers read.
 *
 * Writes to ground-truth-ws/ (NOT ground-truth/), because these are a separate tier:
 * no book_id, image served by Commons, and fidelity varies per page. Keeping them in
 * their own directory means the pinned diplomatic set stays the strict reference and
 * nothing silently pools the two.
 *
 *   node scripts/eval/wikisource-gt-to-groundtruth.mjs [--glyph-only] [--min-chars=600]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const GLYPH_ONLY = process.argv.includes('--glyph-only');
const MIN_CHARS = parseInt(argOf('min-chars', '600'), 10);

const SCRIPT_BY_WIKI = { la: 'latin', de: 'latin', en: 'latin', fr: 'latin', it: 'latin', el: 'greek' };
const LANG_BY_WIKI = { la: 'Latin', de: 'German', en: 'English', fr: 'French', it: 'Italian', el: 'Greek' };

const srcDir = path.join(__dirname, 'ground-truth-wikisource');
const outDir = path.join(__dirname, 'ground-truth-ws');
fs.mkdirSync(outDir, { recursive: true });

let written = 0, skipped = 0;
const manifest = [];
for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  for (const p of d.pages) {
    if (GLYPH_ONLY && p.fidelity !== 'glyph') { skipped++; continue; }
    if (p.reference.length < MIN_CHARS) { skipped++; continue; }
    const gt = {
      work: `${p.work} (${p.year}) — ${p.wiki}.ws p${p.page_number}`,
      // No book_id: this page is not in our corpus. bench2-export.mjs falls back to
      // image_url, which Commons renders from the same scan the transcription describes.
      image_url: p.image_url,
      commons_file: p.commons_file,
      page_number: p.page_number,
      script: SCRIPT_BY_WIKI[p.wiki] || 'latin',
      language: LANG_BY_WIKI[p.wiki] || p.wiki,
      source: p.source,
      source_url: p.source_url,
      tier: 'wikisource',
      fidelity: p.fidelity,
      quality_level: p.quality_level,
      year: p.year,
      ocr_ground_truth: p.reference,
    };
    fs.writeFileSync(path.join(outDir, `${p.slug}.json`), JSON.stringify(gt, null, 2) + '\n');
    manifest.push({ slug: p.slug, language: gt.language, year: p.year, fidelity: p.fidelity, chars: p.reference.length });
    written++;
  }
}
fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify({
  generated_at: new Date().toISOString(), written, skipped, glyph_only: GLYPH_ONLY, pages: manifest,
}, null, 2) + '\n');

const byLang = manifest.reduce((a, m) => { (a[m.language] ||= []).push(m); return a; }, {});
for (const [lang, ms] of Object.entries(byLang)) {
  const glyph = ms.filter(m => m.fidelity === 'glyph').length;
  const years = ms.map(m => m.year);
  console.log(`${lang.padEnd(9)} ${String(ms.length).padStart(3)} pages  ${Math.min(...years)}-${Math.max(...years)}  glyph:${glyph}`);
}
console.log(`\nWrote ${written} ground-truth files to ground-truth-ws/ (${skipped} skipped)`);
