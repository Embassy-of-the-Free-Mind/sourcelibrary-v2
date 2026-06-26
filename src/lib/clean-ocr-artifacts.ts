/**
 * Read-time OCR artifact cleaners (#2764).
 *
 * Two classes of OCR artifact reach readers / search / quotes as garbage text:
 *
 *  1. Runaway dot/lacuna walls — degenerate model repetition that emits
 *     hundreds–thousands of "." (papyrus / critical-edition lacunae), or long
 *     dash/underscore rules. The OCR prompt (v14) prevents most at write time,
 *     but legacy pages and any residual loop still need a read-time guard.
 *  2. LaTeX math leakage — literal `$\frac{a}{b}$`, `\sqrt{x}`, stray `\times`
 *     etc. rendered raw to readers (~thousands of pages).
 *
 * These run at READ time (zero re-OCR cost). They are deliberately separate
 * from `stripEditorialWrappers` (which flattens markdown tables — wrong for the
 * reader, which keeps real markdown): the two transforms here are safe for BOTH
 * the reader and the snippet/quote surfaces, so both import from one place.
 */

/**
 * Collapse a run of ≥12 repeated dot / ellipsis / middot / dash / underscore
 * "units" (each optionally followed by a few spaces, so ". . . ." and a solid
 * "............" both match) down to a single `[…]` lacuna marker.
 *
 * Threshold 12 so ordinary ellipses ("…", "...") and short rules ("---") are
 * untouched; only genuine walls collapse. `[ \t]` (not `\s`) between units so a
 * wall never swallows a newline and merges two lines.
 */
export function collapseLacunaWalls(input: string): string {
  if (!input) return input;
  return input
    .replace(/(?:[.․‧·…_-][ \t]{0,3}){12,}/g, ' […] ')
    // tidy only the runs of 3+ spaces the marker insertion can create; leave
    // ordinary single/double spacing alone.
    .replace(/ {3,}/g, ' ');
}

// Common LaTeX symbol commands → Unicode. Greek is included so the snippet
// path (which has no other Greek handling) renders \alpha as α; the reader
// already converts Greek before this runs, so those are no-ops there.
const LATEX_SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  ll: '≪', gg: '≫', approx: '≈', equiv: '≡', cong: '≅', sim: '∼', propto: '∝',
  infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫',
  pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  ldots: '…', cdots: '…', dots: '…', to: '→', rightarrow: '→', leftarrow: '←',
};

/**
 * Convert stray LaTeX math leakage to a readable plain-text form. Handles the
 * reported cases (`$\frac{a}{b}$`, `\sqrt{x}`) plus common symbols and inline
 * math delimiters. NOT a full LaTeX renderer — unknown `\commands` are left
 * intact rather than risk mangling legitimate text.
 *
 * Order matters: strip math *delimiters* first (so `$\frac{a}{b}$` becomes
 * `\frac{a}{b}`), then expand commands. Delimiter stripping is guarded to only
 * fire when the inner text actually looks like math (contains `\`, `^`, `_` or
 * `{`), so historical currency like "$5 and $10" survives.
 */
export function latexToReadable(input: string): string {
  if (!input || (input.indexOf('\\') === -1 && input.indexOf('$') === -1)) return input;
  let t = input;

  // Display + inline math delimiters → keep inner. `\(...\)` / `\[...\]` always;
  // `$$...$$` always; `$...$` only when the inner looks like math.
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, '$1');
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, '$1');
  t = t.replace(/\$([^$\n]*?[\\^_{][^$\n]*?)\$/g, '$1');

  // \frac{a}{b} → a/b (two passes cover one level of nesting). Includes \dfrac/\tfrac.
  const fracRe = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
  t = t.replace(fracRe, '$1/$2').replace(fracRe, '$1/$2');
  // \sqrt{x} → √(x)
  t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  // Font/box commands → inner content.
  t = t.replace(
    /\\(?:text(?:bf|it|rm|sf|tt)?|math(?:bf|it|rm|bb|cal|frak|sf)?|operatorname|boldsymbol|overline|underline)\s*\{([^{}]*)\}/g,
    '$1',
  );
  // Sizing/spacing commands → drop.
  t = t.replace(/\\(?:left|right|big|Big|bigg|Bigg|displaystyle|quad|qquad)\b/g, '');
  t = t.replace(/\\[,;:! ]/g, ' ');
  // Symbol commands → Unicode (unknown names left untouched).
  t = t.replace(/\\([a-zA-Z]+)/g, (m, name: string) => LATEX_SYMBOLS[name] ?? m);
  // Braced super/subscripts → readable parenthesized form.
  t = t.replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/_\{([^{}]*)\}/g, '_($1)');

  return t;
}

/**
 * Both read-time cleaners in sequence: LaTeX first, then lacuna-wall collapse.
 * Use on plain-text snippet/quote surfaces. (The reader applies the two pieces
 * individually so they slot around its existing Greek/superscript handling.)
 */
export function cleanOcrArtifacts(input: string): string {
  if (!input) return input;
  return collapseLacunaWalls(latexToReadable(input));
}
