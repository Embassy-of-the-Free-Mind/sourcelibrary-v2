/**
 * ft-render-diff — what does the Tier 3 render swap actually change? (#3726)
 *
 * READ-ONLY. For every badged visible book, compares:
 *   BEFORE — what every card surface rendered until this branch: the claim
 *            defaulted to 'candidate', so the label was always the search
 *            statement ("No prior translation found" / in-progress variant).
 *   AFTER  — ftRenderProps on the Atlas doc (verdict-first with legacy
 *            fallback), which is exactly what cards render once the catalog
 *            columns are populated and this branch deploys.
 *
 * Writes a transition report to scripts/output/ so the label changes can be
 * reviewed before the apply (the discipline the July demotion runs set).
 *
 * Usage: set -a; source .env.production.local; set +a; npx tsx scripts/eval/ft-render-diff.ts
 */
import { writeFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { ftRenderProps } from '@/lib/first-translation/render';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import { isTranslationReadable } from '@/lib/first-translation/derive';

async function main() {
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set');

const client = await MongoClient.connect(uri);
const books = client.db('bookstore').collection('books');

const cursor = books.find(
  { is_first_translation: true, visible: true },
  {
    projection: {
      _id: 0, id: 1, slug: 1, title: 1, display_title: 1, language: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1,
      'first_translation.verdict': 1, 'first_translation.evidence_strength': 1,
      'first_translation.our_completeness': 1,
      'translation_verification.disposition': 1,
      'source_language_screen.verdict': 1, 'translator_author_screen.verdict': 1,
    },
  },
);

const transitions = new Map<string, { count: number; sample: Array<{ id: string; title: string }> }>();
let total = 0;
let confirmedAfter = 0;

for await (const b of cursor) {
  total++;
  const inProgress = !isTranslationReadable(b);
  const before = firstTranslationBadge(undefined, b.language, inProgress); // claim defaults to candidate
  const ft = ftRenderProps(b);
  const after = firstTranslationBadge(ft.disposition, b.language, inProgress, ft.claim);
  if (ft.claim === 'confirmed') confirmedAfter++;
  if (before === after) continue;
  const key = `${before} → ${after}`;
  const t = transitions.get(key) ?? { count: 0, sample: [] };
  t.count++;
  if (t.sample.length < 5) t.sample.push({ id: b.id, title: b.display_title || b.title });
  transitions.set(key, t);
}

const changed = [...transitions.values()].reduce((s, t) => s + t.count, 0);
const report = {
  measured_at: new Date().toISOString(),
  scope: 'is_first_translation: true, visible: true',
  total_badged_visible: total,
  labels_changed: changed,
  labels_unchanged: total - changed,
  confirmed_register_after: confirmedAfter,
  transitions: Object.fromEntries(
    [...transitions.entries()].sort((a, b) => b[1].count - a[1].count),
  ),
};

const out = `scripts/output/ft-render-diff-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, transitions: undefined }, null, 2));
for (const [k, v] of [...transitions.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`\n${v.count}× ${k}`);
  for (const s of v.sample) console.log(`   e.g. ${s.id} — ${s.title}`);
}
console.log(`\nFull report: ${out}`);
await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
