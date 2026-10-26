#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/apply-page-correction.mjs — the volunteer span-edit path; it stamps the text
 * `source: 'volunteer-correction', model: 'human'` with an edited_by, which would be false provenance for an
 * editor's agent correcting the model's own notes, and it only applies proposals already in page_corrections.
 * scripts/lib/translate-core.mjs writePageTranslation — the sanctioned translation writer; this script is a thin
 * driver over it. src/app/api/pages/[id]/route.ts takes a whole replacement from a signed-in editor.
 *
 * Correct the translator's glosses and notes on named pages (#7458) — never the page around them.
 *
 * The aliveness reading (#7458) found the model's <gloss>/<note>/<term> apparatus calling qi, prāṇa, āyus, srog,
 * viriditas, the Archeus or Kant's bildende Kraft a "life force" / "vital energy" where the original says breath,
 * vapour, lifespan, greenness, a smith, a formative power. Each correction is a list of exact `{ find, replace }`
 * spans on the stored translation (`all: true` replaces every occurrence on that page), written by hand after
 * reading the original.
 *
 * Per page it refuses, and says why:
 *   - a human-edited translation (source 'manual' or edited_by): never overwritten here;
 *   - a STALE translation (translation_stale, or OCR newer than the translation): a write would date English made
 *     from an old transcription as new, and the stale lane is about to replace it anyway;
 *   - a book held under one of --skip-holds (a hold that names these translations for a person's decision);
 *   - a find that is missing, or (without `all`) not unique;
 *   - a result that writePageTranslation's sanitizers would change anywhere else (checked in the dry run, so the
 *     write is exactly the listed spans).
 * The write goes through writePageTranslation: page_revisions snapshot first (reason `gloss-correction-7458`),
 * provenance naming this call site, the human-edit guard. Then it re-reads the page and confirms both landed.
 * SEAM_GUARD is forced off: these are span edits, not a translation run, and the guard may call a model.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-gloss-corrections.mjs --edits=<file.json>
 *   ... --confirm --cli-version="$(claude --version)"   writes
 *   ... --skip-holds=tibetan-retranslation-awaits-derek,title-leaf-recitation-6297
 *
 * Edits file: [{ book_id, page_number, claim, edits: [{ find, replace, all?, reason? }] }]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { applySpanEdits } from '../lib/span-edits.mjs';
import { translationStaleness } from '../lib/stale-translation.mjs';
import { writePageTranslation, sanitizeTranslationTags, guardTranslationText } from '../lib/translate-core.mjs';
import { unwrapHiddenTranslation } from '../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../lib/stray-script.mjs';
import { geminiEngine, translationInput, notRecorded, codeVersion, host } from '../lib/write-provenance.mjs';

process.env.SEAM_GUARD = 'off';
export const NOTE = 'gloss-correction-7458';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const SKIP_HOLDS = new Set(String(args['skip-holds'] || '').split(',').map((s) => s.trim()).filter(Boolean));

/** The text writePageTranslation would store for `text` (its sanitizer chain, minus the refusals). */
export function storedForm(text, page, book) {
  const clean = unwrapHiddenTranslation({ ocr: page?.ocr?.data, tr: guardTranslationText(sanitizeTranslationTags(text)), type: page?.page_type }).text;
  return strayScriptVerdict(clean, { ocr: page?.ocr?.data, language: book?.language }).text;
}

/** Apply the edits in order; an `all` edit replaces every occurrence, any other must be unique (applySpanEdits). */
export function applyEdits(text, edits) {
  let out = text;
  for (const e of edits) {
    if (e.all) {
      if (!out.includes(e.find)) return { error: `not found: ${JSON.stringify(e.find.slice(0, 80))}` };
      out = out.split(e.find).join(e.replace);
      continue;
    }
    const r = applySpanEdits(out, [e]);
    if ('error' in r) return r;
    out = r.text;
  }
  return { text: out };
}

async function main() {
  const list = JSON.parse(fs.readFileSync(args.edits, 'utf8'));
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const tally = {};
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
  try {
    for (const item of list) {
      const tag = `${item.book_id} p${item.page_number} (${item.claim})`;
      const page = await db.collection('pages').findOne({ book_id: item.book_id, page_number: item.page_number },
        { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, translation_stale: 1 } });
      const book = await db.collection('books').findOne({ id: item.book_id }, { projection: { id: 1, language: 1, 'pipeline_auto.hold': 1 } });
      const current = page?.translation?.data;
      const skip = (why) => { console.log(`SKIP ${tag}: ${why}`); count(`skip: ${why.split(':')[0]}`); };
      if (!page || !current) { skip('no translation'); continue; }
      if (page.translation.source === 'manual' || page.translation.edited_by) { skip('human-edited'); continue; }
      if (page.translation_stale || translationStaleness(page).stale) { skip('stale translation'); continue; }
      const hold = book?.pipeline_auto?.hold?.reason;
      if (hold && SKIP_HOLDS.has(hold)) { skip(`held: ${hold}`); continue; }
      const res = applyEdits(current, item.edits);
      if (res.error) { skip(`edit failed: ${res.error}`); continue; }
      const next = res.text;
      if (storedForm(next, page, book) !== next) { skip('sanitizer would change other text'); continue; }
      console.log(`\n${args.confirm ? 'WRITE' : 'DRY'} ${tag}${hold ? ` [hold ${hold}]` : ''}`);
      for (const e of item.edits) console.log(`  - ${e.find.replace(/\n/g, '⏎').slice(0, 220)}${e.all ? '  (all)' : ''}\n  + ${e.replace.replace(/\n/g, '⏎').slice(0, 220)}`);
      if (!args.confirm) { count('would write'); continue; }

      const before = new Date();
      const w = await writePageTranslation(db, {
        page, book, text: next, model: 'claude-opus-5-5', jobId: 'aliveness-fixes', note: `${NOTE}: ${item.claim}`,
        promptRef: { id: NOTE, name: 'Hand correction of glosses and notes against the original (#7458)', version: '1' },
        // An Anthropic engine is recordable only as a subscription-CLI read: this is a Claude Code session making
        // span edits by hand, no generation call, so the settings are not-recorded and the prompt is the edit list.
        engine: geminiEngine({
          name: 'anthropic', call_site: 'scripts/maintenance/apply-gloss-corrections.mjs', api: 'cli',
          cli: { name: 'claude', version: args['cli-version'] || 'unknown' }, model: 'claude-opus-5-5',
          prompt: { id: NOTE, name: 'Hand correction of glosses and notes against the original (#7458)', version: '1', text: JSON.stringify(item.edits) },
          generationConfig: notRecorded('span edits written by hand in a Claude Code session; no generation call'),
          run: { code_version: await codeVersion(), host: host(), job_id: 'aliveness-fixes', issue: 7458, claim: item.claim },
          input: translationInput({ ocrText: page.ocr?.data ?? '', ocrUpdatedAt: page.ocr?.updated_at }),
        }),
      });
      if (!w.written) { console.log(`  NOT WRITTEN: ${w.protected ? 'protected (human-edited)' : w.reason}`); count('refused by writer'); continue; }
      const after = await db.collection('pages').findOne({ id: page.id }, { projection: { 'translation.data': 1 } });
      const rev = await db.collection('page_revisions').findOne({ page_id: page.id, field: 'translation', created_at: { $gte: before } }, { projection: { id: 1, data: 1 } });
      if (after?.translation?.data !== next) throw new Error(`${tag}: stored text differs from the edited text`);
      if (!rev || rev.data !== current) throw new Error(`${tag}: no page_revisions snapshot of the old text`);
      console.log(`  written; revision ${rev.id}`);
      count('written');
    }
  } finally {
    await client.close();
  }
  console.log('\n', tally);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; });
