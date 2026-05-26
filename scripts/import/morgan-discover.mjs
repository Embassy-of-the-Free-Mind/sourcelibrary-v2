#!/usr/bin/env node
/**
 * Morgan manuscript discovery helper.
 *
 * For each bibId, fetches the record page, finds the canonical collection
 * slug, then fetches /collection/<slug>/thumbs to extract the exact image
 * filenames in viewer order. Outputs a manifest record using the `custom`
 * filename_pattern with `page_filenames: [...]` — works for any Morgan MS
 * regardless of how the underlying filenames are numbered (sequential,
 * folio-keyed, openings like 77019v_2006-2007.jpg, etc.).
 *
 * Usage:
 *   node scripts/import/morgan-discover.mjs --bibIds=110814,77153,110800,77026
 *   node scripts/import/morgan-discover.mjs --bibIds=110814 --out=path.json
 */

import fs from 'fs';

const args = process.argv.slice(2);
const getArg = (n, d = null) => {
  const m = args.find(a => a.startsWith(`--${n}=`));
  return m ? m.split('=').slice(1).join('=') : d;
};

const BIB_IDS = (getArg('bibIds') || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = getArg('out');
if (BIB_IDS.length === 0) { console.error('--bibIds=N1,N2,N3 required'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org)';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '')
             .replace(/<style[\s\S]*?<\/style>/g, '')
             .replace(/<[^>]+>/g, '\n');
}

async function discover(bibId) {
  const rec = { bibId };
  try {
    // 1. Fetch the record page to extract metadata + collection slug
    let recordUrl, recordHtml;
    for (const root of ['/manuscript', '/incunables', '/drawings/item']) {
      try {
        recordUrl = `https://www.themorgan.org${root}/${bibId}`;
        recordHtml = await fetchText(recordUrl);
        rec.record_url = recordUrl;
        rec.record_root = root;
        break;
      } catch {}
    }
    if (!recordHtml) throw new Error('no record page found');

    // Extract collection slug from any link of form /collection/<slug>/thumbs or .../<bibId>
    const slugMatch = recordHtml.match(/\/collection\/([^"'\/]+)\/thumbs/);
    rec.collection_slug = slugMatch ? slugMatch[1] : null;

    // Extract bibliographic fields by scanning labeled sections in the rendered text
    const text = stripTags(recordHtml)
      .replace(/\n\s*\n+/g, '\n').replace(/[ \t]+/g, ' ');
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    function valueAfter(label) {
      const i = lines.findIndex(l => l === label);
      return i >= 0 && i + 1 < lines.length ? lines[i + 1] : null;
    }
    rec.accession = valueAfter('Accession number');
    rec.object_title = valueAfter('Object title');
    rec.created = valueAfter('Created');
    rec.binding = valueAfter('Binding');
    rec.credit_line = valueAfter('Credit line');
    rec.description = valueAfter('Description');
    rec.script = valueAfter('Script');
    rec.language = valueAfter('Language');
    rec.century = valueAfter('Century');
    rec.provenance = valueAfter('Provenance');
    rec.notes_block = valueAfter('Notes');

    // 2. Fetch /collection/<slug>/thumbs and parse all filenames
    if (rec.collection_slug) {
      const thumbsUrl = `https://www.themorgan.org/collection/${rec.collection_slug}/thumbs`;
      rec.thumbs_url = thumbsUrl;
      const thumbsHtml = await fetchText(thumbsUrl);
      const filenameRe = new RegExp(`/facsimile/${bibId}/([^"'?\\s]+\\.jpg)`, 'g');
      const seen = new Set();
      const fnames = [];
      let m;
      while ((m = filenameRe.exec(thumbsHtml)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); fnames.push(m[1]); }
      }
      rec.page_filenames = fnames;
      rec.page_count = fnames.length;

      // Also try alternative directory IDs in case files live elsewhere
      if (fnames.length === 0) {
        const altRe = /\/facsimile\/(\d+(?:\.\d+)?)\/([^"'?\s]+\.jpg)/g;
        const dirs = new Map();
        while ((m = altRe.exec(thumbsHtml)) !== null) {
          if (!dirs.has(m[1])) dirs.set(m[1], []);
          if (!dirs.get(m[1]).includes(m[2])) dirs.get(m[1]).push(m[2]);
        }
        if (dirs.size > 0) {
          // Pick the dir with the most filenames
          const [bestDir, bestFiles] = [...dirs.entries()].sort((a, b) => b[1].length - a[1].length)[0];
          rec.image_dir_override = bestDir;
          rec.page_filenames = bestFiles;
          rec.page_count = bestFiles.length;
        }
      }
    } else {
      rec.error = 'no /collection/<slug>/thumbs link found on record page';
    }

    // 3. Probe ICA thumbs page for description count
    try {
      const icaHtml = await fetchText(`http://ica.themorgan.org/manuscript/thumbs/${bibId}`);
      // ICA "(N of M)" indicators or anchor counts
      const m1 = icaHtml.match(/\(1 of (\d+)\)/);
      if (m1) {
        rec.ica_page_count = parseInt(m1[1], 10);
        rec.ica_thumbs_url = `http://ica.themorgan.org/manuscript/thumbs/${bibId}`;
      } else {
        const m2 = icaHtml.match(/of (\d+)\)/);
        if (m2) {
          rec.ica_page_count = parseInt(m2[1], 10);
          rec.ica_thumbs_url = `http://ica.themorgan.org/manuscript/thumbs/${bibId}`;
        } else {
          rec.ica_page_count = 0;
        }
      }
    } catch {
      rec.ica_page_count = 0;
    }
  } catch (e) {
    rec.error = e.message;
  }
  return rec;
}

(async () => {
  const results = await Promise.all(BIB_IDS.map(discover));
  // Build the manifest records in our standard shape
  const manifest = results.map(r => {
    if (r.error && !r.page_filenames) {
      return { bibId: r.bibId, error: r.error, partial_data: r };
    }
    // accession_slug = lowercased accession with no spaces/punctuation, prefix removed
    const acc = (r.accession || '').replace(/^MS\s+/i, '').replace(/^PML\s+/i, 'pml');
    const accession_slug = acc.toLowerCase().replace(/[^a-z0-9]/g, '');
    return {
      bibId: r.bibId,
      accession: r.accession,
      accession_slug,
      title: r.object_title?.replace(/\s*\(MS\s+[^)]+\)\.?$/, '').replace(/\.$/, '') || null,
      display_title: r.object_title || null,
      author: null, // not exposed in a single labeled field — needs human review
      place: r.created || null,
      date: r.created || null,
      language: r.language || null,
      categories: ['medieval-manuscripts', 'illuminated-manuscripts'],
      page_count: r.page_count,
      filename_pattern: 'custom',
      page_filenames: r.page_filenames,
      image_dir_override: r.image_dir_override || null,
      filename_prefix: null,
      image_offset: null,
      ica_thumbs_url: r.ica_thumbs_url || null,
      ica_page_count: r.ica_page_count || 0,
      record_url: r.record_url,
      collection_slug: r.collection_slug,
      iiif_manifest_url: null,
      _raw: {
        binding: r.binding,
        credit_line: r.credit_line,
        description: r.description,
        script: r.script,
        century: r.century,
        provenance: r.provenance,
        notes_block: r.notes_block,
      },
    };
  });

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${OUT}`);
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }

  // Summary
  console.error(`\nSummary (${manifest.length}):`);
  for (const m of manifest) {
    if (m.error) {
      console.error(`  ${m.bibId}: ERROR ${m.error}`);
    } else {
      console.error(`  ${m.bibId} ${m.accession}: ${m.page_count} pages, ${m.ica_page_count} ICA, slug=${m.collection_slug}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
