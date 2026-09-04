import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
import { CONSENSUS_TARGET } from '@/lib/review-candidates';

export const maxDuration = 15;
export const revalidate = 300;

/**
 * GET /api/review/translation-check/summary
 *
 * What readers of the original languages have found, per language.
 *
 * This is the read side the queue was missing. A rating store nothing reads is
 * a suggestion box: three "this is not a page" notes sat unread in this very
 * system for a month, and 104 ratings changed nothing in the library because no
 * consumer existed. A queue earns its asking only if the answers surface.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not average the verdicts into a
 * single "quality score". The whole point of the split vocabulary is that
 * `transcription_off` is an OCR defect and `translation_drift` is a translation
 * defect, and folding them together reproduces the confusion the queue exists
 * to remove. `faithful_pct` is therefore reported over PAGES WHOSE
 * TRANSCRIPTION HELD — the only population where the question "is the English
 * faithful?" is even well-posed — and the transcription failures are reported
 * separately and prominently rather than buried in a denominator.
 *
 * HONEST SMALL NUMBERS. `target` is 35, the sample size that buys +/-10% at 95%
 * confidence. Below `CONSENSUS_TARGET` judgments a page is one person's opinion,
 * so `decided` counts pages that reached it and `checked` counts pages seen at
 * all; both are reported, because reporting only the larger one would overstate
 * what we know.
 */

type Row = { item_id: string; rating: string | null; detail: unknown };

const VERDICTS = [
  'both_sound',
  'translation_drift',
  'transcription_off',
  'both_off',
  'unclear',
] as const;

/** supabase-js silently truncates a select at 1,000 rows. Page explicitly. */
async function allRatings(): Promise<Row[]> {
  if (!supabaseAdmin) return [];
  const out: Row[] = [];
  for (let page = 0; page < 20; page++) {
    const from = page * 1000;
    const { data, error } = await supabaseAdmin
      .from('volunteer_ratings')
      .select('item_id,rating,detail')
      .eq('queue', 'translation-check')
      .range(from, from + 999);
    if (error) {
      console.error('[translation-check/summary] read failed:', error.message);
      break;
    }
    out.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

export async function GET() {
  const rows = await allRatings();

  // The language lives on the candidate, not the rating — read it from the
  // pool so a rating can never carry a language the sample did not stratify on.
  const db = await getReadDb();
  const pool = (await db
    .collection('review_candidates')
    .find({ queue: 'translation-check' }, { projection: { _id: 0, item_id: 1, stratum: 1 } })
    .toArray()) as unknown as { item_id: string; stratum?: { language?: string } }[];

  const langOf = new Map(pool.map(p => [p.item_id, p.stratum?.language ?? 'unknown']));

  const byLang = new Map<string, {
    queued: number;
    seen: Set<string>;
    votes: Map<string, string[]>;
  }>();
  for (const p of pool) {
    const lang = p.stratum?.language ?? 'unknown';
    const e = byLang.get(lang) ?? { queued: 0, seen: new Set<string>(), votes: new Map() };
    e.queued++;
    byLang.set(lang, e);
  }
  for (const r of rows) {
    if (!r.rating) continue; // note-only row: a report, not a vote
    const lang = langOf.get(r.item_id);
    if (!lang) continue;
    const e = byLang.get(lang);
    if (!e) continue;
    e.seen.add(r.item_id);
    const v = e.votes.get(r.item_id) ?? [];
    v.push(r.rating);
    e.votes.set(r.item_id, v);
  }

  const languages = [...byLang.entries()]
    .map(([language, e]) => {
      // A page counts as decided once CONSENSUS_TARGET people agree on a verdict.
      const tally: Record<string, number> = Object.fromEntries(VERDICTS.map(v => [v, 0]));
      let decided = 0;
      for (const verdicts of e.votes.values()) {
        const counts = new Map<string, number>();
        for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
        const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
        if (n >= CONSENSUS_TARGET && top in tally) {
          tally[top]++;
          decided++;
        }
      }
      // Faithfulness is only well-posed where the transcription held.
      const transcriptionHeld = tally.both_sound + tally.translation_drift;
      return {
        language,
        queued: e.queued,
        checked: e.seen.size,
        decided,
        target: 35,
        verdicts: tally,
        transcription_failed: tally.transcription_off + tally.both_off,
        faithful_pct:
          transcriptionHeld > 0
            ? Math.round((tally.both_sound / transcriptionHeld) * 1000) / 10
            : null,
        faithful_basis: transcriptionHeld,
      };
    })
    .sort((a, b) => b.checked - a.checked || a.language.localeCompare(b.language));

  return NextResponse.json({
    consensus_target: CONSENSUS_TARGET,
    note:
      'faithful_pct is computed over pages whose transcription held — the only population ' +
      'where "is the English faithful?" is a well-posed question. Transcription failures are ' +
      'reported separately, not folded in.',
    languages,
  });
}
