#!/usr/bin/env -S npx tsx
/**
 * PRIOR ART: scripts/maintenance/hide-named-books.mjs hid these books (reason `<class>_<issue>`), and
 * unhide-best-partners.mjs re-publishes by a partner rule. Neither asks the question #6199 needs answered before a
 * quality-hidden book returns: does it now carry a warning a reader will see? POST /api/books/[id]/visibility does
 * one book at a time for a signed-in curator; this goes through the same writer (setPublication).
 *
 * republish-quality-hidden — bring back the books hidden for TEXT QUALITY, each with its warning (#6199).
 * "Warn, don't hide": a quality finding is shown to the reader with a link to the evidence; it no longer hides the
 * book. Rights holds are not quality and are never touched (the reason filter below cannot match them, and the
 * publication writer refuses to leave `takedown` without an explicit override this script never passes).
 *
 * For every book hidden with a quality reason it derives the warnings the reader and book page would show
 * (src/lib/book-warnings.ts — the same function, not a copy) and prints one line per book. With --apply, a book is
 * made public only when it CARRIES a warning. A book with none is left hidden and listed with the reason, because
 * publishing it would put text a reviewer found broken in front of a reader with nothing said.
 *
 *   npx tsx --env-file=.env.production.local scripts/maintenance/republish-quality-hidden.ts            # dry run
 *   npx tsx --env-file=.env.production.local scripts/maintenance/republish-quality-hidden.ts --apply
 *   … --json <file>   also write the per-book result (for the issue comment)
 * Afterwards: node scripts/workers/sync-books-catalog.mjs (the Supabase mirror keys on updated_at).
 *
 * Who runs it: a session or Derek, once, from a machine with the production env, after the PR that renders the
 * warnings is live. It fails closed: a Mongo error stops the run; a book already public is reported and skipped.
 */
import { writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
// @ts-expect-error — plain-JS module, no declarations
import { setPublication } from '../lib/publication.mjs';
import { loadBookChecks, deriveWarnings, ownChecks } from '../../src/lib/book-warnings';

/** Hide reasons that are text-quality findings. Anything else (rights_*, duplicate, curation…) is out of scope. */
const QUALITY_REASON = /^(broken_text|fabricated_ocr|broken_structure|broken_images|qa)_/;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

// Wrapped in main(): tsx runs a .ts script as CommonJS here, which has no top-level await.
async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const books = await db.collection('books')
    .find({ visible: false, hidden_reason: { $regex: QUALITY_REASON.source } }, { projection: { id: 1, slug: 1, title: 1, display_title: 1, hidden_reason: 1, publication: 1, pages_count: 1 } })
    .sort({ hidden_reason: 1, title: 1 })
    .toArray();

  const out: Record<string, unknown>[] = [];
  let ready = 0, published = 0;
  for (const b of books) {
    const id = (b.id ?? String(b._id)) as string;
    const state = (b.publication as { state?: string } | undefined)?.state ?? null;
    const { rows, stamps } = await loadBookChecks(db, [id]);
    const w = deriveWarnings(rows, stamps);
    const pageWarnings = Object.values(w.pages);
    const carries = !!w.book || pageWarnings.length > 0;
    const why = carries ? null
      : rows.length === 0 ? 'no check of this book is recorded'
        : ownChecks(rows).some((r) => r.page_findings?.length || r.verdict === 'fix') ? 'the text of every page with a finding has changed since the check'
          : 'no recorded check found a serious error';
    const warning = w.book
      ? `book: serious errors on ${w.book.pagesSerious ?? '?'} of ${w.book.pagesRead} pages read (${w.book.methodId}, ${w.book.date.slice(0, 10)}); page warnings: ${pageWarnings.length}`
      : pageWarnings.length ? `page warnings only: ${pageWarnings.length}` : null;
    const title = String(b.display_title || b.title || '').slice(0, 60);
    let action = carries ? 'would publish' : 'left hidden';
    if (state === 'takedown') { action = 'left hidden (takedown state)'; }
    else if (carries) {
      ready++;
      if (APPLY) {
        const r = await setPublication(db, id, { state: 'public', by: 'script:republish-quality-hidden', issue: 6199 });
        action = `published (${r.status})`;
        published++;
      }
    }
    console.log(`${action.padEnd(16)} ${String(b.hidden_reason).padEnd(24)} ${id}  ${title}\n${' '.repeat(17)}${warning ?? `NO WARNING — ${why}`}`);
    out.push({ id, slug: b.slug ?? null, title, hidden_reason: b.hidden_reason, action, warning, why, url: `https://sourcelibrary.org/book/${b.slug || id}` });
  }
  console.log(`\n${books.length} books hidden for text quality; ${ready} carry a warning${APPLY ? `; ${published} published` : ' and would be published with --apply'}; ${books.length - ready} left hidden.`);
  if (!APPLY) console.log('[DRY RUN] nothing written.');
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
