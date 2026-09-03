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

  while (i < body.length) {
    const rest = body.slice(i);

    // \text{...} / \mathrm{...} — literal text, usually a letter the model
    // could not name (\text{o} for omicron).
    let m = rest.match(/^\\(?:text|mathrm|textrm|mathit)\{([^{}]*)\}/);
    if (m) {
      if (!/^[A-Za-z0-9 ,.;:'’\-]*$/.test(m[1])) return null;
      out += m[1];
      i += m[0].length;
      continue;
    }

    // \acute{\epsilon} — accent applied to a letter (or to another accent).
    m = rest.match(/^\\([a-zA-Z]+)\{\s*\\([a-zA-Z]+)\s*\}/);
    if (m && ACCENTS[m[1]] && LETTERS[m[2]]) {
      out += LETTERS[m[2]] + ACCENTS[m[1]];
      sawGreek = true;
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
      if (m[1] === ' ' || m[1] === 'quad' || m[1] === 'qquad' || m[1] === ' ') {
        out += ' ';
        i += m[0].length;
        continue;
      }
      return null; // an unknown command — could be real maths
    }

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

  if (!sawGreek) return null;

  // TeX has no \omicron (it would render identically to a Latin o), so a model
  // spelling a Greek word out reaches for `\text{o}` or a bare `o` instead —
  // that is literally what the reported page does: \pi\text{o}\tau... for
  // ποτ.... A Latin o flanked by Greek is omicron; one standing alone is left
  // as it was found.
  let composed = out.normalize('NFC');
  const GREEK = '\\u0370-\\u03ff\\u1f00-\\u1fff';
  composed = composed
    .replace(new RegExp(`(?<=[${GREEK}])o`, 'g'), '\u03bf')
    .replace(new RegExp(`o(?=[${GREEK}])`, 'g'), '\u03bf')
    .replace(new RegExp(`(?<=[${GREEK}])O`, 'g'), '\u039f')
    .replace(new RegExp(`O(?=[${GREEK}])`, 'g'), '\u039f');

  return composed.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Rewrite TeX-encoded Greek in `text` to Unicode Greek.
 *
 * @returns {{ text: string, replacements: number }} the repaired text and how
 *   many math spans were decoded. `replacements === 0` means nothing changed.
 */
export function repairTexGreek(text) {
  if (!text || typeof text !== 'string' || !text.includes('\\')) {
    return { text: text ?? '', replacements: 0 };
  }
  let replacements = 0;
  const repaired = text.replace(MATH_SPAN, (whole, dollarBody, parenBody) => {
    const body = dollarBody !== undefined ? dollarBody : parenBody;
    const decoded = decodeSpan(body);
    if (decoded === null || decoded === '') return whole;
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
