/**
 * Write-time repair: OCR that spells Greek out as LaTeX math instead of
 * transcribing it (#4580).
 *
 * THE FAILURE THIS FIXES
 * ----------------------
 * Handed a Greek word inside an otherwise Latin page, the model sometimes
 * renders the SHAPE of the word as TeX rather than reading it as Greek:
 *
 *   $\dot{\alpha}\pi\text{o}\tau\epsilon\lambda\acute{\epsilon}\sigma\mu\alpha\tau\text{o}\varsigma$
 *
 * That is ἀποτελέσματος. Note `\text{o}` for omicron — it is drawing the letters,
 * not reading them. Reported from a live page of the 1616 *Fama Remissa*, and
 * found in at least 19 more books through the public search index alone
 * (*Palaeographia Graeca*, Diophantus, Heron, Aeschylus, *Koptisch-gnostische
 * Schriften*), all of them visible and readable.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS
 * A Greek word stored as TeX is unsearchable (nobody types the markup, and the
 * real word is no longer in the index), uncitable (quotes carry the markup into
 * citations), and poisonous to the embedding lane, which indexes a math string.
 * It also survives INTO the translation phase — the reported corpus includes
 * English sentences with a TeX blob where a Greek term should be.
 *
 * WHY REPAIR RATHER THAN REFUSE
 * Unlike the blank-page guard, which can only veto because a fabricated page has
 * no correct version to recover, this markup is a lossless encoding of a real
 * reading. `\alpha` is α and nothing else. So the honest move is to decode it,
 * not to throw the page away and re-OCR — the model DID read the word; it wrote
 * the answer in the wrong alphabet.
 *
 * The same function therefore serves both callers: the collector normalises on
 * the way in, and the repair sweep normalises what already landed.
 *
 * DESIGN DECISIONS
 *
 *   Only touches what it fully understands. A math span is rewritten only when
 *   EVERY token in it decodes to a Greek letter, an accent, or plain text. A
 *   span containing real mathematics ($x^2 + \frac{a}{b}$) is left exactly as
 *   found — Heron and Diophantus contain both, sometimes on one page, and
 *   mangling genuine equations to fix Greek words would be a worse defect.
 *
 *   Accents are composed, then normalised to NFC, so the output is the same
 *   codepoint sequence a human transcriber would type. `\acute{\epsilon}` is έ
 *   (U+03AD), not ε followed by a combining acute.
 *
 *   Final sigma is preserved. `\varsigma` is ς, distinct from σ — collapsing it
 *   would corrupt every word-final sigma in the corpus.
 */

/** TeX command → Greek letter. */
const LETTERS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'π',
  rho: 'ρ', varrho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ',
  Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν',
  Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ',
  Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
};

/**
 * TeX accent → combining mark. The polytonic set as the model actually emits it:
 * `\acute` for oxia, `\grave` for varia, `\tilde` for perispomeni, `\dot` for
 * the smooth breathing (which is what it reaches for, lacking a psili command).
 */
const ACCENTS = {
  acute: '́',      // ́  oxia
  grave: '̀',      // ̀  varia
  tilde: '͂',      // ͂  perispomeni
  hat: '͂',
  breve: '̆',
  bar: '̄',
  ddot: '̈',       // ̈  dialytika
  dot: '̓',        // ̓  psili (smooth breathing) — see note above
  mathring: '̓',
  check: '̌',
};

/**
 * Commands that are not Greek-letter names but stand in for one, or for a
 * character inside a Greek word. All observed in the corpus:
 *
 *   \circ   — the ring/degree glyph, used as omicron (ἀθάνατον, πήχυιον)
 *   \imath  — dotless i, which is what a model reaches for under an accent
 *   \cdot   — used as the Greek ano teleia (·), the colon of Greek punctuation
 */
const STANDINS = {
  circ: 'ο',
  imath: 'ι',
  jmath: 'ι',
  cdot: '·',
};

/**
 * Non-Greek glyphs the same OCR pass writes as TeX. Included because a page
 * repaired for Greek alone comes out INCONSISTENT: an alchemical recipe reads
 * "aquam $\nabla$ … Nota quod Δ" — half markup, half glyph, worse than either.
 * All unambiguous single characters.
 */
const GLYPHS = {
  nabla: '\u2207', triangle: '\u25b3', square: '\u25a1', odot: '\u2609',
  oplus: '\u2295', ominus: '\u2296', otimes: '\u2297',
  dagger: '\u2020', ddagger: '\u2021', degree: '\u00b0',
  prime: '\u2032', textprime: '\u2032',
  Box: '\u25a1', Diamond: '\u25c7', Triangle: '\u25b3',
  textrecipe: '\u211e',   // ℞ — 'take', the opening word of a recipe
  textdegree: '\u00b0', textbullet: '\u2022',
};

/** A whole math span, $…$ or \(…\). */
const MATH_SPAN = /\$([^$]{1,4000})\$|\\\(([\s\S]{1,4000}?)\\\)/g;

/**
 * Decode one math span's body. Returns null when anything in it is not a Greek
 * letter, an accent, plain text or trivial spacing — i.e. when it might be real
 * mathematics.
 */
function decodeSpan(body) {
  let out = '';
  let i = 0;
  let sawGreek = false;
  let sawGlyph = false;

  while (i < body.length) {
    const rest = body.slice(i);

    // \text{...} / \mathrm{...} — literal text, usually a letter the model
    // could not name (\text{o} for omicron).
    // \text{\textsf{A}} — a nested text group, and \text{\&} an escaped char
    // inside one. Both appear on alchemical pages beside the Greek.
    let m = rest.match(/^\\(?:text|mathrm|textrm|mathit|mathbf|textbf)\{\s*\\(?:textsf|textrm|mathrm|text|mathbf)\{([^{}]*)\}\s*\}/);
    if (m) {
      if (!/^[A-Za-z0-9&]*$/.test(m[1])) return null;
      out += m[1];
      i += m[0].length;
      continue;
    }
    m = rest.match(/^\\(?:text|mathrm|textrm|mathit|mathbf|textbf)\{\s*\\([&%#_])\s*\}/);
    if (m) {
      out += m[1];
      sawGlyph = true;
      i += m[0].length;
      continue;
    }
    m = rest.match(/^\\(?:text|mathrm|textrm|mathit|mathbf|textbf)\{([^{}]*)\}/);
    if (m) {
      if (!/^[A-Za-z0-9 ,.;:'’\-]*$/.test(m[1])) return null;
      out += m[1];
      i += m[0].length;
      continue;
    }

    // \acute{\epsilon} — accent applied to a letter (or to another accent).
    m = rest.match(/^\\([a-zA-Z]+)\{\s*\\([a-zA-Z]+)\s*\}/);
    if (m && ACCENTS[m[1]] && (LETTERS[m[2]] || STANDINS[m[2]])) {
      // STANDINS as well as LETTERS: \acute{\imath} is ί, and dotless i is
      // exactly what a model reaches for when it needs to put an accent on an
      // iota it is spelling out.
      out += (LETTERS[m[2]] || STANDINS[m[2]]) + ACCENTS[m[1]];
      if (LETTERS[m[2]]) sawGreek = true;
      i += m[0].length;
      continue;
    }

    // \acute{} — an accent with an empty argument. The mark belongs to the
    // letter just emitted, which is what the model meant.
    m = rest.match(/^\\([a-zA-Z]+)\{\s*\}/);
    if (m && ACCENTS[m[1]]) {
      out += ACCENTS[m[1]];
      i += m[0].length;
      continue;
    }

    // \text{\textrecipe} — a named glyph wrapped in a text group.
    m = rest.match(/^\\(?:text|mathrm|textrm|mathit|mathbf|textbf)\{\s*\\([a-zA-Z]+)\s*\}/);
    if (m && GLYPHS[m[1]]) {
      out += GLYPHS[m[1]];
      sawGlyph = true;
      i += m[0].length;
      continue;
    }

    // \unicode{x2609} — an explicit codepoint. Unambiguous by construction.
    m = rest.match(/^\\unicode\{x([0-9a-fA-F]{2,6})\}/);
    if (m) {
      const cp = parseInt(m[1], 16);
      if (!(cp > 0 && cp <= 0x10ffff)) return null;
      out += String.fromCodePoint(cp);
      sawGlyph = true;
      i += m[0].length;
      continue;
    }

    // \nabla, \odot — a non-Greek glyph command.
    m = rest.match(/^\\([a-zA-Z]+)(?![a-zA-Z])/);
    if (m && GLYPHS[m[1]]) {
      out += GLYPHS[m[1]];
      sawGlyph = true;
      i += m[0].length;
      continue;
    }

    // \grave\alpha — accent with NO braces around its argument. TeX accepts
    // this and the model emits it; matching only the braced form missed them all.
    m = rest.match(/^\\([a-zA-Z]+)\s*\\([a-zA-Z]+)/);
    if (m && ACCENTS[m[1]] && (LETTERS[m[2]] || STANDINS[m[2]])) {
      out += (LETTERS[m[2]] || STANDINS[m[2]]) + ACCENTS[m[1]];
      if (LETTERS[m[2]]) sawGreek = true;
      i += m[0].length;
      continue;
    }

    // \acute{\mathrm{o}} — accent over a \text/\mathrm group.
    m = rest.match(/^\\([a-zA-Z]+)\{\s*\\(?:text|mathrm|textrm|mathit)\{([^{}]*)\}\s*\}/);
    if (m && ACCENTS[m[1]] && /^[A-Za-z0-9]$/.test(m[2])) {
      out += m[2] + ACCENTS[m[1]];
      i += m[0].length;
      continue;
    }

    // \acute{a} — accent applied to a literal character.
    m = rest.match(/^\\([a-zA-Z]+)\{\s*([^\\{}])\s*\}/);
    if (m && ACCENTS[m[1]]) {
      out += m[2] + ACCENTS[m[1]];
      i += m[0].length;
      continue;
    }

    // \alpha — a bare letter command.
    m = rest.match(/^\\([a-zA-Z]+)/);
    if (m) {
      if (LETTERS[m[1]]) {
        out += LETTERS[m[1]];
        sawGreek = true;
        i += m[0].length;
        continue;
      }
      if (STANDINS[m[1]]) {
        out += STANDINS[m[1]];
        i += m[0].length;
        continue;
      }
      if (m[1] === ' ' || m[1] === 'quad' || m[1] === 'qquad' || m[1] === ' ') {
        out += ' ';
        i += m[0].length;
        continue;
      }
      return null; // an unknown command — could be real maths
    }

    // \& \% \# — escaped punctuation, literal in the output.
    m = rest.match(/^\\([&%#_])/);
    if (m) { out += m[1]; i += m[0].length; continue; }

    // \, \; \! \  — TeX spacing
    m = rest.match(/^\\[,;:!> ]/);
    if (m) { out += ' '; i += m[0].length; continue; }

    const ch = body[i];
    // Whitespace in TeX math mode is a token separator and carries no meaning:
    // `\mu o \nu` is one word, not three. Dropping it is what makes
    // "$\mu o \nu \acute{\alpha} \varsigma$" decode to μονάς rather than
    // "μ o ν ά ς". Explicit spacing commands above still emit a space.
    if (/\s/.test(ch)) { i += 1; continue; }
    // Bare characters that can legitimately sit inside a transcribed word.
    if (/[A-Za-z0-9.,;:'’()\-Ͱ-Ͽἀ-῿]/.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    // ^ _ { } = + / etc. mean this is mathematics, not a word.
    return null;
  }

  if (!sawGreek && !sawGlyph) return null;

  // TeX has no \omicron (it would render identically to a Latin o), so a model
  // spelling a Greek word out reaches for `\text{o}` or a bare `o` instead —
  // that is literally what the reported page does: \pi\text{o}\tau... for
  // ποτ.... A Latin o flanked by Greek is omicron; one standing alone is left
  // as it was found.
  // Map the Latin o BEFORE composing accents, and allow combining marks between
  // it and its Greek neighbour. `\acute{o}` decodes to "o" + combining acute; if
  // we composed first, the result would be a precomposed Latin ó that the bare-o
  // rule can no longer see, leaving a Latin letter inside a Greek word
  // (δóξαις instead of δόξαις). Mapping first lets NFC compose ο + acute → ό.
  const GREEK = '\\u0370-\\u03ff\\u1f00-\\u1fff';
  const MARKS = '\\u0300-\\u036f';
  const mapped = out
    .replace(new RegExp(`(?<=[${GREEK}][${MARKS}]*)o`, 'g'), '\u03bf')
    .replace(new RegExp(`o(?=[${MARKS}]*[${GREEK}])`, 'g'), '\u03bf')
    .replace(new RegExp(`(?<=[${GREEK}][${MARKS}]*)O`, 'g'), '\u039f')
    .replace(new RegExp(`O(?=[${MARKS}]*[${GREEK}])`, 'g'), '\u039f');

  return mapped.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Rewrite TeX-encoded Greek in `text` to Unicode Greek.
 *
 * @returns {{ text: string, replacements: number }} the repaired text and how
 *   many math spans were decoded. `replacements === 0` means nothing changed.
 */
const GREEK_CHAR = /[\u0370-\u03ff\u1f00-\u1fff]/g;

/**
 * Rewrite TeX-encoded Greek in `text` to Unicode Greek.
 *
 * By default only WORD-LIKE spans are touched — two or more Greek letters, which
 * is the defect #4580 reports: a Greek word spelled out as TeX, unsearchable and
 * uncitable.
 *
 * A span holding exactly ONE letter (`$\Delta$`, `$\psi$`) is deliberately left
 * alone. Measured over 4,000 matching pages, single-letter spans outnumber
 * word-like ones (21,223 vs 17,474) and cluster in alchemical and astrological
 * texts, where `$\Delta$` is a SYMBOL rather than a mangled word. Rendering
 * those as Δ may well be an improvement, but it is a different decision about
 * far more pages, and quietly making it while fixing something else is how a
 * narrow fix turns into an unreviewed corpus-wide edit.
 *
 * Pass `{ symbolsToo: true }` to include them, deliberately.
 *
 * @returns {{ text: string, replacements: number }}
 */
export function repairTexGreek(text, { symbolsToo = true } = {}) {
  if (!text || typeof text !== 'string' || !text.includes('\\')) {
    return { text: text ?? '', replacements: 0 };
  }
  let replacements = 0;
  const repaired = text.replace(MATH_SPAN, (whole, dollarBody, parenBody) => {
    const body = dollarBody !== undefined ? dollarBody : parenBody;
    const decoded = decodeSpan(body);
    if (decoded === null || decoded === '') return whole;
    if (!symbolsToo) {
      const letters = (decoded.match(GREEK_CHAR) || []).length;
      if (letters < 2) return whole; // a lone symbol, not a word
    }
    replacements++;
    return decoded;
  });
  return { text: repaired, replacements };
}

/** Cheap pre-check: does this text contain TeX Greek/accent commands at all? */
export function hasTexGreek(text) {
  if (!text || typeof text !== 'string') return false;
  return /\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)\b/i.test(text);
}

/** Kill switch, matching the blank-page guard's convention. */
export function texGreekRepairEnabled() {
  return String(process.env.TEX_GREEK_REPAIR || '').toLowerCase() !== 'off';
}
