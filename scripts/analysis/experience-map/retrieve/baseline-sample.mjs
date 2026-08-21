#!/usr/bin/env node
/**
 * Draw a random-ish sample of translated pages to give the map a DENOMINATOR.
 *
 * v1 could say "59.6% of retrieved passages were experiential" but not "x% of the
 * library is", because it never looked at pages the probes did not select. Without
 * that baseline there is no way to tell whether retrieval found most of the
 * experiential material or a sliver of it, and no way to say whether the probes
 * are actually selective (if a random page is experiential just as often, the
 * probes are doing nothing).
 *
 * Sampling method: page_id is a Mongo ObjectId hex string whose trailing bytes are
 * a counter plus random component, so filtering on a fixed 2-hex-character suffix
 * takes an arbitrary ~1/256 slice that is uncorrelated with book, language or date.
 * Several different suffixes are used so the sample does not rest on one slice.
 * This is a hash sample, not a true uniform draw — stated plainly rather than
 * dressed up as random.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { createClient } = require('@supabase/supabase-js');
const { stripEditorialWrappers } = await import(
  '/Users/dereklomas/sourcelibrary/scripts/lib/strip-editorial-wrappers.mjs'
);

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const req = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing ${n}`); return v; };
const supabase = createClient(req('SUPABASE_URL'), req('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const SUFFIXES = ['1c', '4e', '7b', 'a3', 'd6', 'f0'];
const PER = 180;

const { count: total } = await supabase
  .from('page_translations').select('page_id', { count: 'exact', head: true });
console.log(`page_translations total rows: ${total}`);

const out = [];
for (const sfx of SUFFIXES) {
  const { data, error } = await supabase
    .from('page_translations')
    .select('page_id,book_id,page_number,translation,book_title,book_author,book_language,book_year')
    .like('page_id', `%${sfx}`)
    .limit(PER);
  if (error) { console.error(`  ${sfx}: ${error.message}`); continue; }
  let kept = 0;
  for (const r of data || []) {
    const text = stripEditorialWrappers(r.translation || '').trim();
    if (text.length < 150) continue;          // same length gate as retrieval
    out.push({
      page_id: r.page_id, book_id: r.book_id, page_number: r.page_number,
      book_title: r.book_title, book_author: r.book_author,
      book_language: r.book_language, book_year: r.book_year,
      dim: 'RANDOM_BASELINE', probe: null, slice: `baseline:${sfx}`,
      similarity: null, text: text.slice(0, 3000),
    });
    kept++;
  }
  console.log(`  suffix ${sfx}: ${data ? data.length : 0} rows, ${kept} kept after length gate`);
}

writeFileSync(`${HERE}/baseline-hits.jsonl`, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\nbaseline sample: ${out.length} pages -> baseline-hits.jsonl`);
const byLang = {};
out.forEach((r) => { byLang[r.book_language || '?'] = (byLang[r.book_language || '?'] || 0) + 1; });
console.log('languages:', Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 12)
  .map(([l, n]) => `${l}:${n}`).join('  '));
