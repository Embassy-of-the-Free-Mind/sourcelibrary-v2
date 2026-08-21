/**
 * Mail-domain typo suggestions for the sign-in / sign-up email field.
 *
 * Why this exists: a magic-link signup only becomes an account when the person
 * clicks the link in the email. A mistyped domain mints a `verification_tokens`
 * row, hard-bounces at Resend, and leaves an orphan forever — the person simply
 * never hears from us and has no idea why. Measured on 2026-07-21, 14 of the 357
 * organic signups that failed to complete in the previous 30 days were plain
 * domain typos: `gamil.com`, `gmail.con`, `gmailcom`, `gmailo.com`, `yahoo.cok`,
 * `hotmail.com1`, `gmail` (no TLD at all), and friends.
 *
 * Design rules, both learned from the same failing set:
 *
 * 1. SUGGEST, NEVER BLOCK. Valid addresses live on domains no list will ever
 *    contain. Our audience is heavily Spanish-speaking (Argentina is the #2
 *    country), so `hotmail.es`, `yahoo.com.ar`, `hotmail.com.ar` and
 *    `yahoo.com.mx` are all real and common here. Rejecting "unknown" domains
 *    would break more signups than typos do.
 * 2. REGIONAL VARIANTS MUST NOT TRIGGER A SUGGESTION. `hotmail.co.uk` is 3 edits
 *    from `hotmail.com`, so the distance-2 cutoff already spares it — but the
 *    KNOWN list below carries the common regional forms explicitly so they exit
 *    early and can never be "corrected" into the wrong country.
 */

/**
 * Domains we treat as certainly-correct. Anything here exits early with no
 * suggestion. Includes regional variants precisely so they are never "fixed".
 */
const KNOWN = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.es', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.it',
  'hotmail.com.ar', 'hotmail.com.mx', 'hotmail.de', 'hotmail.nl',
  'outlook.com', 'outlook.es', 'outlook.fr', 'outlook.de', 'outlook.com.br',
  'yahoo.com', 'yahoo.es', 'yahoo.co.uk', 'yahoo.com.ar', 'yahoo.com.mx',
  'yahoo.com.br', 'yahoo.fr', 'yahoo.de', 'yahoo.co.jp', 'yahoo.co.in',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'live.com', 'live.nl', 'live.com.ar', 'live.co.uk',
  'aol.com', 'msn.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de',
  'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'naver.com',
  'zoho.com', 'fastmail.com', 'hey.com', 'tutanota.com',
  'orange.fr', 'free.fr', 'wanadoo.fr', 'libero.it', 'terra.com.br', 'uol.com.br',
]);

/**
 * The subset we will actively correct *towards*. Deliberately small: only the
 * giants, where a near-miss is overwhelmingly likely to be a typo rather than a
 * genuine small provider that merely resembles one.
 */
const CORRECT_TO = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'live.com',
  'aol.com',
];

/** Levenshtein distance, bailing out as soon as it exceeds `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1; // whole row already too far — stop
    prev = row;
  }
  return prev[b.length];
}

/**
 * Suggest a corrected address, or null when the input looks fine (or is too
 * far gone to guess at). Never throws; safe to call on every keystroke.
 *
 * @example suggestEmailFix('ada@gamil.com') === 'ada@gmail.com'
 * @example suggestEmailFix('ada@hotmail.es') === null  // real domain, left alone
 */
export function suggestEmailFix(email: string): string | null {
  const trimmed = (email || '').trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain) return null;
  if (KNOWN.has(domain)) return null;

  // A bare provider name with no TLD ("gmail", "hotmail") is unambiguous.
  // Note the fall-through: "gmailcom" has no dot either, but it is a dropped-dot
  // typo rather than a bare name, so it must reach the distance check below.
  if (!domain.includes('.')) {
    const hit = CORRECT_TO.find((d) => d.startsWith(`${domain}.`));
    if (hit) return `${local}@${hit}`;
  }

  // Too short to judge: "a.co" is 2 edits from half the list.
  if (domain.length < 5) return null;

  let best: string | null = null;
  let bestDist = 3; // strictly less than 3 → at most 2 edits
  for (const candidate of CORRECT_TO) {
    const d = distance(domain, candidate, 2);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best ? `${local}@${best}` : null;
}
