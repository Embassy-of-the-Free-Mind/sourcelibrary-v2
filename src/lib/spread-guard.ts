/**
 * Refuse to split an image that is not a two-page spread (#3593).
 *
 * The false-split class repaired in #3562 happened because `auto-split-ml`
 * selects pages by `crop: { $exists: false }` and splits every one the model
 * returns a position for. The model always returns a position, so an
 * individually-photographed leaf was cut in half — 470 pages across 45 books,
 * found only when a reader wrote in about a half-rendered frontispiece.
 *
 * WHY THIS TEST AND NOT ASPECT RATIO
 * Five aspect-ratio heuristics were tried while building the repair and four
 * were wrong, because leaf shape varies enormously between books: a spread of
 * two narrow folio leaves (1415x3106 each) is 2780x3105 — still taller than it
 * is wide, and indistinguishable by shape from a single squarish leaf. Shape
 * cannot answer "one leaf or two". Content can: a spread has a vertical
 * ink-free channel down its middle with text on BOTH sides. A single leaf has
 * text running through its centre.
 *
 * This is the same ink-valley signal as `scripts/lib/gutter-detect.mjs`
 * (`detectGutterPixel`), which the splitting pipeline already trusts to place
 * the cut. Here it is used one step earlier, to decide whether to cut at all.
 * Kept in parity by `tests/unit/spread-guard.test.ts`, which exercises the
 * behaviour on generated images rather than asserting on source text.
 *
 * FAILS OPEN BY DEFAULT, ON PURPOSE
 * BPH books genuinely are mostly spreads, so a guard that refuses too eagerly
 * stalls real work across the pipeline. `mode: 'report'` (the default) returns
 * the verdict and lets the caller log it without changing behaviour. Flip to
 * 'enforce' only after a real batch has been logged and the refusals confirmed
 * to be single leaves.
 */
import sharp from 'sharp';

export type SpreadVerdict = {
  /** true when a central ink-free channel flanked by text was found. */
  isSpread: boolean;
  /** 'high' only when the ink-valley test fired; never trust 'low' as proof of either answer. */
  confidence: 'high' | 'low';
  /** short label for logs and provenance */
  reason: string;
  /** width/height of the source, recorded so a later audit can re-derive the call */
  width: number;
  height: number;
};

/** Ink is min(R,G,B) < 120 — measuring content, not brightness, so coloured rubrication registers. */
const DARK = 120;
const SAMPLE_WIDTH = 800;

/**
 * Does this image look like a two-page spread?
 *
 * Returns `isSpread: false` with `confidence: 'low'` when it cannot tell. That
 * is deliberately NOT the same as "this is a single leaf" — a tightly bound
 * spread with no bright gutter also lands there. Callers enforcing on this must
 * treat low confidence as "don't know", never as grounds to act.
 */
export async function looksLikeSpread(buf: Buffer): Promise<SpreadVerdict> {
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(buf).metadata();
    width = meta.width || 0;
    height = meta.height || 0;

    const ratio = SAMPLE_WIDTH / width;
    const h = Math.max(1, Math.round(height * ratio));
    const raw = await sharp(buf)
      .resize(SAMPLE_WIDTH, h, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer();

    // Measure only the middle half vertically: headers, page numbers and
    // catchwords sit outside it and would blur the channel.
    const bandStart = Math.round(h * 0.25);
    const bandEnd = Math.round(h * 0.75);
    const rows = Math.max(1, bandEnd - bandStart);

    const ink = new Float32Array(SAMPLE_WIDTH);
    for (let x = 0; x < SAMPLE_WIDTH; x++) {
      let dark = 0;
      for (let y = bandStart; y < bandEnd; y++) {
        const i = (y * SAMPLE_WIDTH + x) * 3;
        if (Math.min(raw[i], raw[i + 1], raw[i + 2]) < DARK) dark++;
      }
      ink[x] = dark / rows;
    }

    // Light ±2px smoothing: bridges inter-character white without erasing a
    // 1-2px gutter, which is what over-smoothing did in the splitter's history.
    const smoothed = new Float32Array(SAMPLE_WIDTH);
    for (let x = 0; x < SAMPLE_WIDTH; x++) {
      const lo = Math.max(0, x - 2);
      const hi = Math.min(SAMPLE_WIDTH - 1, x + 2);
      let s = 0;
      for (let i = lo; i <= hi; i++) s += ink[i];
      smoothed[x] = s / (hi - lo + 1);
    }

    // Search the central third only. Two-column pages put their intra-page gap
    // near 25% and 75%, outside this window, so a valley here is the binding.
    const cs = Math.round(SAMPLE_WIDTH * 0.35);
    const ce = Math.round(SAMPLE_WIDTH * 0.65);
    const flank = Math.round(SAMPLE_WIDTH * 0.08);

    let minX = cs;
    let minInk = Infinity;
    for (let x = cs; x < ce; x++) {
      if (smoothed[x] < minInk) {
        minInk = smoothed[x];
        minX = x;
      }
    }
    let left = 0;
    let right = 0;
    for (let x = Math.max(0, minX - flank); x < minX; x++) left = Math.max(left, smoothed[x]);
    for (let x = minX + 1; x <= Math.min(SAMPLE_WIDTH - 1, minX + flank); x++) right = Math.max(right, smoothed[x]);

    // A spread: near-empty channel, with real text on both sides of it.
    if (minInk < 0.1 && left - minInk >= 0.1 && right - minInk >= 0.1) {
      return {
        isSpread: true,
        confidence: 'high',
        reason: `ink-valley-${Math.round(minInk * 100)}pct`,
        width,
        height,
      };
    }

    // Text runs through the middle → a single leaf. Still 'low': a tight or
    // shadowed gutter produces the same reading.
    return { isSpread: false, confidence: 'low', reason: `no-central-valley-${Math.round(minInk * 100)}pct`, width, height };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isSpread: false, confidence: 'low', reason: `error:${msg.slice(0, 60)}`, width, height };
  }
}

export type GuardMode = 'report' | 'enforce';

/**
 * Should this page be split? In 'report' mode always yes, with the verdict
 * attached for logging. In 'enforce' mode, refuse anything not confidently a
 * spread — a skipped book is recoverable, a silently halved one is not, and in
 * this pipeline a wrong split also runs `$unset: { ocr, translation }`.
 */
export async function allowSplit(
  buf: Buffer,
  mode: GuardMode = 'report',
): Promise<{ allow: boolean; verdict: SpreadVerdict }> {
  const verdict = await looksLikeSpread(buf);
  if (mode === 'report') return { allow: true, verdict };
  return { allow: verdict.isSpread && verdict.confidence === 'high', verdict };
}
