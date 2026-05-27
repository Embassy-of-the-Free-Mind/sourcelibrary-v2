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

    // Find collection slug: three patterns observed on Morgan record pages.
    // Skip generic Morgan-wide collection links that aren't per-MS viewers.
    const SKIP_SLUGS = new Set([
      'curatorial-departments','medieval-and-renaissance-manuscripts','coptic-manuscripts',
      'coptic-bindings','indian-miniatures','the-morgan-library-museum',
      'collection-highlights',
    ]);
    let slug = null;
    const patterns = [
      new RegExp(`/collection/([^"'/]+)/${bibId}`),
      /\/collection\/([^"'/]+)\/thumbs/,
      /\/collection\/([^"'/?]+)["?]/g,
    ];
    for (const re of patterns) {
      if (re.global) {
        let m;
        while ((m = re.exec(recordHtml)) !== null) {
          if (!SKIP_SLUGS.has(m[1])) { slug = m[1]; break; }
        }
      } else {
        const m = recordHtml.match(re);
        if (m && !SKIP_SLUGS.has(m[1])) slug = m[1];
      }
      if (slug) break;
    }
    rec.collection_slug = slug;

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

    // 2. Fetch all paginated thumbs pages and aggregate filenames in order
    if (rec.collection_slug) {
      // Try both URL conventions; whichever returns a non-empty page wins
      let thumbsBase = null;
      for (const url of [
        `https://www.themorgan.org/collection/${rec.collection_slug}/${bibId}/thumbs`,
        `https://www.themorgan.org/collection/${rec.collection_slug}/thumbs`,
      ]) {
        try {
          const html = await fetchText(url);
          if (html.length > 1000) { thumbsBase = url; break; }
        } catch {}
      }
      // Try /thumbs first (fast path: 12 filenames per HTTP fetch, 20 pages max)
      let fnames = [];
      if (thumbsBase) {
        rec.thumbs_url = thumbsBase;
        const seen = new Set();
        const filenameRe = new RegExp(`/facsimile/${bibId}/([^"'?\\s]+\\.jpg)`, 'g');
        for (let p = 0; p < 200; p++) {
          let html;
          try { html = await fetchText(`${thumbsBase}?page=${p}`); } catch { break; }
          const before = fnames.length;
          let m;
          while ((m = filenameRe.exec(html)) !== null) {
            if (!seen.has(m[1])) { seen.add(m[1]); fnames.push(m[1]); }
          }
          if (fnames.length === before) break;
        }
        rec.page_filenames = fnames;
        rec.page_count = fnames.length;
        rec.discovery_method = 'thumbs';
      }

      // Fallback: walk individual viewer pages /collection/<slug>/<bibId>/<N>.
      // Used for MSS with no /thumbs page (e.g. M.788 Felicity, M.890 Fountains).
      // Slow (one HTTP fetch per page) but reliable. Concurrency=8.
      if (fnames.length === 0) {
        console.error(`  ${bibId}: /thumbs unavailable — walking viewer pages /collection/${rec.collection_slug}/${bibId}/N...`);
        const walked = [];
        const CONCURRENCY = 8;
        let cursor = 1, consecutiveMisses = 0, stopped = false;
        const HARD_MAX = 2000;
        async function worker() {
          while (!stopped) {
            const vp = cursor++;
            if (vp > HARD_MAX) return;
            const vurl = `https://www.themorgan.org/collection/${rec.collection_slug}/${bibId}/${vp}`;
            let vhtml;
            try { vhtml = await fetchText(vurl); }
            catch { consecutiveMisses++; if (consecutiveMisses >= 8) stopped = true; continue; }
            const dirRe = new RegExp(`/sites/default/files/facsimile/([\\d.]+)/([^"?\\s]+\\.jpg)`);
            const fm = vhtml.match(dirRe);
            if (fm) {
              consecutiveMisses = 0;
              walked.push({ vp, file: fm[2], dir: fm[1] });
              if (!rec.image_dir_override && fm[1] !== bibId) rec.image_dir_override = fm[1];
            } else {
              consecutiveMisses++;
              if (consecutiveMisses >= 8) stopped = true;
            }
          }
        }
        await Promise.all(Array(CONCURRENCY).fill(0).map(worker));
        walked.sort((a, b) => a.vp - b.vp);
        if (walked.length > 0) {
          rec.page_filenames = walked.map(w => w.file);
          rec.page_count = walked.length;
          rec.discovery_method = 'walked_viewer_pages';
          fnames = rec.page_filenames;
        } else if (!rec.error) {
          rec.error = 'no viewer pages responded';
        }
      }

      // Last-ditch: scan /thumbs for any other facsimile directory.
      if (fnames.length === 0 && thumbsBase) {
        const html0 = await fetchText(`${thumbsBase}?page=0`).catch(() => '');
        const altRe = /\/facsimile\/([\d.]+)\/([^"'?\s]+\.jpg)/g;
        const dirs = new Map();
        let am;
        while ((am = altRe.exec(html0)) !== null) {
          if (!dirs.has(am[1])) dirs.set(am[1], []);
          if (!dirs.get(am[1]).includes(am[2])) dirs.get(am[1]).push(am[2]);
        }
        if (dirs.size > 0) {
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
