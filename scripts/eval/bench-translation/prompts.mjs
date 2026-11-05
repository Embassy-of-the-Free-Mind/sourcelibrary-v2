// PRIOR ART: scripts/eval/plain-6728/prompts.mjs — PLAIN_EDITS (anchored in-memory edits to the live v13 text, each
// found exactly once or throw), plainSeed() and bodyOf() are used from there unchanged, so PLAIN and the scored body
// are byte-identical to #6728's. What is new here: V20_EDITS, the four defect fixes of #7499 row 2, in the same form.
/**
 * The three arms of the #7499 translation benchmark, built from the LIVE default prompt text:
 *   v13    the live default, unchanged
 *   v20    v13 + ONLY the four #7499 defect fixes (V20_EDITS); the text is also written to
 *          prompts/translation/standard-translation-v20-candidate.md (a file, not a prompts row)
 *   plain  #6728's PLAIN (plain-6728/prompts.mjs PLAIN_EDITS)
 */
import { plainPrompt, plainSeed, bodyOf, tagChars, md5 } from '../plain-6728/prompts.mjs';

export { plainPrompt, plainSeed, bodyOf, tagChars, md5 };

export const V13_MD5 = '516510147237b6a79d9d3f6e797bba7f';

// Each [find, replace] must match exactly once in the live v13 text.
export const V20_EDITS = [
  // (d) the prompt also translates printed books.
  ['You are translating a manuscript transcription into accessible English.',
    'You are translating a transcription of a printed book or manuscript into accessible English.'],
  // (a) the continuity marker alone: byte-identical to prompts row v18 (6adc3d59c15cc42265ee2f59, #7085).
  ['  - Context from previous page → <meta>continues from previous page: ...</meta>\n',
    '  - Context from previous page → <meta>continues from previous page</meta>, the marker alone. Write nothing after it inside the tag: every word of this page belongs in the translation itself.\n'],
  // (b) the pelican example describes; it no longer interprets.
  ['  Translation: <note>A woodcut depicts a pelican feeding her young from her own breast, a symbol of self-sacrifice in alchemical tradition.</note>\n',
    '  Translation: <note>A woodcut of a pelican feeding her young.</note>\n'],
  // (c) the duplicated 8 and 9 become 10 and 11.
  ['9. Preserve the voice and spirit of the original.\n8. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.\n9. END with <summary>',
    '9. Preserve the voice and spirit of the original.\n10. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.\n11. END with <summary>'],
];

export function v20Prompt(v13) {
  if (md5(v13) !== V13_MD5) throw new Error(`base is not v13 ${V13_MD5} (got ${md5(v13)}): re-check V20_EDITS`);
  let t = v13;
  for (const [find, rep] of V20_EDITS) {
    if (t.split(find).length !== 2) throw new Error(`v20 anchor not found exactly once: ${find.slice(0, 70)}`);
    t = t.replace(find, () => rep);
  }
  if (/self-sacrifice/.test(t)) throw new Error('v20 still interprets the pelican');
  return t;
}

/** The prompt document of one arm, in buildTranslationPrompt's `prompts` shape. */
export function armPrompts(arm, live) {
  if (live.translation.ref.version !== 13 || md5(live.translation.text) !== V13_MD5) throw new Error(`live default is v${live.translation.ref.version} ${md5(live.translation.text)}, not v13 ${V13_MD5}`);
  if (arm === 'v13' || arm === 'v13b') return live;
  const text = arm === 'v20' ? v20Prompt(live.translation.text) : arm === 'plain' ? plainPrompt(live.translation.text) : null;
  if (!text) throw new Error(`unknown arm ${arm}`);
  const name = arm === 'v20' ? 'Standard Translation v20 candidate (v13 + #7499 fixes) [in memory]' : 'Standard Translation v13, interpretive instructions removed [in memory, #6728]';
  return { translation: { text, ref: { id: null, name, version: arm === 'v20' ? 20 : 13, content_hash: md5(text) } }, english: live.english };
}

/** The seed (previous page's stored English) as each arm's pipeline would hold it. */
export const seedFor = (arm, seed) => (arm === 'plain' ? plainSeed(seed) : seed);
