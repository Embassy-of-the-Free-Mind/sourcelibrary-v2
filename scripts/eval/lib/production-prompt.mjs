/**
 * Load the LIVE production OCR prompt, from the same place the pipeline reads it.
 *
 * WHY THIS EXISTS. `scripts/eval/prompts/ablation/B-current.txt` was named
 * "current" and was not: diffed against the live prompt it was missing ~2,800
 * characters including the entire **Output contract** block (the #3108
 * instruction forbidding untagged commentary). Every ablation that called it
 * "current production" was measuring a v10-era reconstruction. On a blank page
 * it emitted 47,813 characters of looping `[...]` where the real prompt emits
 * none — an alarming "fabrication" finding that was purely an artifact of the
 * harness. The file is now `B-v10-legacy.txt`, kept only so earlier results
 * stay reproducible.
 *
 * A pinned copy of a live artifact drifts silently and always flatters whoever
 * pinned it. Read the source of truth instead.
 *
 * The pipeline's own loader is `getOcrPromptFromDb` in
 * scripts/workers/pipeline-orchestrator.mjs — this mirrors its query and its
 * placeholder substitution. If that changes, change this. The returned
 * `version` / `content_hash` should be recorded in any result file so a run can
 * be tied to the exact prompt it used.
 */

const LANGUAGE_INSTRUCTION =
  '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<{text:string, version:string, name:string, content_hash:string|undefined}>}
 */
export async function getProductionOcrPrompt(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB (prompts: type=ocr, is_default=true)');
  return {
    text: prompt.content
      .replace('{language_instruction}', LANGUAGE_INSTRUCTION)
      .replace('{language}', ''),
    version: String(prompt.version ?? 1),
    name: prompt.name,
    content_hash: prompt.content_hash,
  };
}

/**
 * Apply an intervention to the live prompt by inserting text before an anchor
 * that must already be present. Throws if the anchor is gone — an intervention
 * silently appended to the end of a prompt is not the intervention that was
 * designed, and a drifted anchor is exactly how that happens.
 */
export function withIntervention(promptText, anchor, insertion) {
  if (!promptText.includes(anchor)) {
    throw new Error(`Anchor not found in production prompt: ${JSON.stringify(anchor.slice(0, 40))}. The prompt changed — re-site the intervention rather than appending it.`);
  }
  return promptText.replace(anchor, `${insertion}\n\n${anchor}`);
}
