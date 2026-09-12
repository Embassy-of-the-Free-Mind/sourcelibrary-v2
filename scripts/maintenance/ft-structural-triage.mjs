/**
 * Structural triage of the public "First Translation" badges (#2876 follow-up).
 *
 * The 16-book manual spot-check (issue #2876) found that the dominant badge
 * error is NOT a missed prior translation — it is a STRUCTURAL mismatch: the
 * badge sits on something that isn't a single translatable work. Three classes,
 * with THREE DIFFERENT correct actions — conflating them is how mass-demotes go
 * wrong (Kircher's Musurgia volumes and Wubei Zhi are genuine firsts; blanket
 * demotion would destroy them):
 *
 *   A. ARTWORK / image-only            → demote to `not_applicable` (nothing to
 *                                         translate). The one class Derek
 *                                         approved excluding.
 *   B. MULTI-WORK CONTAINER            → `not_applicable` at the container level
 *      (Opera Omnia, Sammelband,         (the claim belongs to the constituent
 *       florilegium, collected works)     works, resolved separately).
 *   C. SUB/SUPRA-WORK granularity      → WORK-RESOLUTION, *not* a demote. A
 *      (volume N of a multi-vol work;     volume or a `thor bu` miscellany is a
 *       Tibetan `thor bu` miscellany)     part/whole of a real work; cluster it
 *                                         under its work_id and badge the work
 *                                         (the #2318 / #2453 layer).
 *
 * REPORT-ONLY. It writes NO verdicts and flips NO flags. It emits:
 *   - a human report (.md) with per-class counts + samples,
 *   - a BACKUP of the current flag/verdict state for every flagged book,
 *   - `…-demote-verdicts.json`  — class A+B, shaped for `ft-ingest-verdicts.ts`
 *     (the verdict-only writer). Apply ONLY after Derek's sign-off, then run
 *     `reconcile-first-translation-flag.ts [RETIRED #4536: the badge is card-governed now — propose a Translation Card edit instead] --apply` (the single flag writer).
 *   - `…-workresolve.json`      — class C, for the work-identity layer. NEVER a
 *     demote — these are real works at the wrong granularity.
 *
 * Container patterns adapted from the Stage-A pre-filter in #2796
 * (`scripts/eval/ft-structural-prefilter.mjs`); this adds the sub/supra-work and
 * non-Western-miscellany detectors that spot-check #2876 showed it lacked.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ft-structural-triage.mjs            # full report
 *   node scripts/maintenance/ft-structural-triage.mjs --limit=40 # sample
 */
import { withMongo } from '../lib/mongo.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const LIMIT = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const DATE = new Date().toISOString().slice(0, 10);
const OUT = 'scripts/output';

// ── Detectors (conservative; precedence applied in classify) ────────────────

// A. Artwork / image-only. content_type/resource_type is authoritative; the
// title markers are a SECONDARY, lower-confidence signal because illustrated
// texts ("Alchemical Texts with 20 Colored Plates") legitimately mention plates.
const ARTWORK_TITLE = /\b(atlas|engravings?|gravures?|\bprenten?\b|copper ?plates?|\d{2,}\s+plates?|map of|landkaart|land-?kaart|\bkaart\b|portraits?|tafelwerk|plate volume|album of)\b/i;
const ARTWORK_AUTHOR = /(prentgraveur|engraver|graveur|cartograph|kaartmaker)/i;
// Strong text-work signals that VETO a title-only artwork guess.
const TEXT_VETO = /\b(texts?|treatise|tractatus|liber|libri|sermons?|commentary|commentaria|dialogu?e|epistol)/i;

// B. Multi-work container (adapted from #2796).
const CONTAINER = [
  /\bopera\s+(omnia|quae\s+supersunt|quae\s+exstant|posthuma|theologica|philosophica|chymica|chemica|medica|mathematica|moralia)\b/i,
  /\bomnia\s+opera\b/i,
  /\bges(ammelte|amte)\s+(werke|schriften|briefe)\b/i,
  /\bs[äa]mtliche\s+(werke|schriften|briefe)\b/i,
  /\b(collected|complete|selected)\s+(works|writings|letters|poems|treatises|essays)\b/i,
  /\bflorileg/i, /\bmiscellan(y|ies|ea|eous)\b/i, /\bantholog(y|ie|ia)\b/i,
  /\bopuscula\b/i,
];

// C1. Volume-of-a-set (a real multi-volume work badged per volume).
const VOLUME = /(\bvol\.?\s*[ivxlcdm\d]|\bvolume\s+\d|\btomus\b|\btomi\b|\btome\s+\d|\bband\s+\d|\bbd\.?\s*\d|\bteil\s+\d|\bpart\s+\d|\bdeel\s+\d|\bpt\.?\s*\d|第[一二三四五六七八九十百\d]+[冊册卷]|[（(]\s*[一二三四五六七八九十百千\d]+\s*[)）]\s*$|卷[一二三四五六七八九十百\d])/;

// C2. Tibetan / non-Western miscellany or liturgical compilation (constituent-
// level work; collection-level "first" is ill-posed). Conservative: specific
// genre markers, NOT a blanket "Tibetan" match.
const TIB_MISC = /(^\s*thor\s*bu\b|\bgsung\s*'?bum\b|\bbka'?\s*'?bum\b|\bchos\s+spyod\b|\bphyag\s+len\b|\bzhal\s*'?don\b|\bbe'?u\s*bum\b)/i;

function classify(b) {
  const t = b.title || '';
  const a = b.author || '';
  // Precedence: authoritative artwork > container > volume > miscellany >
  // title-only artwork guess > ok.
  if (b.content_type === 'artwork' || (b.resource_type != null && b.resource_type !== '')) {
    return { cls: 'artwork', tier: 'high', action: 'demote_not_applicable',
      reason: `content_type/resource_type marks this an image object, not a text` };
  }
  if (CONTAINER.some((re) => re.test(t))) {
    return { cls: 'container', tier: 'high', action: 'demote_not_applicable',
      reason: `title marks a multi-work container; claim belongs to constituents` };
  }
  if (VOLUME.test(t)) {
    return { cls: 'volume_of_set', tier: 'high', action: 'work_resolve',
      reason: `single volume of a multi-volume work; cluster under work_id, badge the work` };
  }
  if (TIB_MISC.test(t) || TIB_MISC.test(a)) {
    return { cls: 'tib_miscellany', tier: 'medium', action: 'work_resolve',
      reason: `non-Western miscellany/liturgy; constituent-level claim, not collection-level` };
  }
  if ((ARTWORK_TITLE.test(t) || ARTWORK_AUTHOR.test(a)) && !TEXT_VETO.test(t)) {
    return { cls: 'artwork_likely', tier: 'low', action: 'review',
      reason: `title/author suggest an image work, but has translatable text — needs a look` };
  }
  return { cls: 'single_work_ok', tier: '', action: 'keep', reason: '' };
}

await withMongo(async (db) => {
  const Q = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } };
  const cursor = db.collection('books').find(Q, {
    projection: {
      title: 1, author: 1, language: 1, original_language: 1, content_type: 1,
      resource_type: 1, work_id: 1, is_first_translation: 1,
      'translation_verification.disposition': 1, first_translation: 1,
    },
  });
  if (LIMIT) cursor.limit(LIMIT);
  const docs = await cursor.toArray();

  const byClass = {};
  const samples = {};
  const demoteVerdicts = []; // class A+B → ft-ingest-verdicts.ts shape
  const workResolve = [];    // class C → work-identity layer
  const reviewQueue = [];    // artwork_likely → human look
  const backup = [];         // reversible snapshot of every flagged book

  for (const d of docs) {
    const c = classify(d);
    byClass[c.cls] = (byClass[c.cls] || 0) + 1;
    if (c.cls === 'single_work_ok') continue;
    (samples[c.cls] ??= []).push({ id: String(d._id), title: (d.title || '').slice(0, 70), language: d.language });

    backup.push({
      _id: String(d._id), id: String(d._id),
      prev_is_first_translation: d.is_first_translation ?? null,
      prev_first_translation: d.first_translation ?? null,
      prev_disposition: d.translation_verification?.disposition ?? null,
    });

    if (c.action === 'demote_not_applicable') {
      demoteVerdicts.push({
        book_id: String(d._id),
        verdict: 'not_applicable',
        evidence_strength: 'strong',
        our_completeness: 'unknown',
        match_key: 'none',
        confidence: c.tier,
        sources_checked: ['structural_triage'],
        reasoning: `[structural:${c.cls}] ${c.reason}`,
        model: 'ft-structural-triage',
      });
    } else if (c.action === 'work_resolve') {
      workResolve.push({ book_id: String(d._id), class: c.cls, work_id: d.work_id ?? null,
        title: (d.title || '').slice(0, 100), author: (d.author || '').slice(0, 60),
        language: d.language, reason: c.reason });
    } else if (c.action === 'review') {
      reviewQueue.push({ book_id: String(d._id), title: (d.title || '').slice(0, 100),
        author: (d.author || '').slice(0, 60), language: d.language, reason: c.reason });
    }
  }

  mkdirSync(OUT, { recursive: true });
  const stamp = `${OUT}/ft-structural-triage-${DATE}`;
  writeFileSync(`${stamp}-backup.json`, JSON.stringify(backup, null, 1));
  writeFileSync(`${stamp}-demote-verdicts.json`, JSON.stringify(demoteVerdicts, null, 1));
  writeFileSync(`${stamp}-workresolve.json`, JSON.stringify(workResolve, null, 1));
  writeFileSync(`${stamp}-review.json`, JSON.stringify(reviewQueue, null, 1));

  // ── Report ────────────────────────────────────────────────────────────────
  const L = [];
  L.push(`# First-Translation Structural Triage — ${DATE}`);
  L.push('');
  L.push(`Report-only. Scanned **${docs.length}** public first-translation badges (\`is_first_translation + visible + pages_translated>0\`). No flags changed.`);
  L.push('');
  L.push('| class | action | n |');
  L.push('|---|---|---|');
  const order = ['artwork', 'container', 'volume_of_set', 'tib_miscellany', 'artwork_likely', 'single_work_ok'];
  const ACTION = { artwork: 'demote → not_applicable', container: 'demote → not_applicable', volume_of_set: 'WORK-RESOLVE (not a demote)', tib_miscellany: 'WORK-RESOLVE (not a demote)', artwork_likely: 'human review', single_work_ok: 'keep' };
  for (const k of order) if (byClass[k]) L.push(`| ${k} | ${ACTION[k]} | ${byClass[k]} |`);
  L.push('');
  L.push(`**Demote queue (artwork + container):** ${demoteVerdicts.length} → \`${stamp}-demote-verdicts.json\` (apply via \`ft-ingest-verdicts.ts --apply-verdicts\` AFTER sign-off, then \`reconcile-first-translation-flag.ts --apply\`).`);
  L.push(`**Work-resolution queue (volumes + miscellanies):** ${workResolve.length} → \`${stamp}-workresolve.json\` — NEVER demote; cluster under work_id and badge the work (#2318 / #2453).`);
  L.push(`**Review queue (illustrated-text borderline):** ${reviewQueue.length} → \`${stamp}-review.json\`.`);
  L.push(`**Backup of all flagged books:** \`${stamp}-backup.json\` (restore source if any apply is reverted).`);
  L.push('');
  for (const k of order.filter((x) => x !== 'single_work_ok')) {
    if (!samples[k]?.length) continue;
    L.push(`### ${k} — samples`);
    for (const s of samples[k].slice(0, 8)) L.push(`- \`${s.id}\` [${s.language || '?'}] ${s.title}`);
    L.push('');
  }
  L.push('## Why three actions, not one');
  L.push('- **Artwork** has no source text → the badge is meaningless; demote.');
  L.push('- **Containers** bundle distinct works → the claim belongs to each constituent, not the binding; demote the container, resolve constituents separately.');
  L.push('- **Volumes & miscellanies are REAL works at the wrong granularity** (Kircher *Musurgia* Vol. II, Wubei Zhi vol. 58, a `thor bu` of one terma cycle). Demoting them would erase genuine firsts — they need work-level clustering, not a flag flip.');
  writeFileSync(`${stamp}.md`, L.join('\n') + '\n');

  console.log(L.join('\n'));
  console.error(`\n✓ wrote ${stamp}.md (+ -backup/-demote-verdicts/-workresolve/-review .json)`);
});
