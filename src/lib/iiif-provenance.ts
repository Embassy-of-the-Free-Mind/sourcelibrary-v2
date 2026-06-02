/**
 * Provenance for AI-generated IIIF annotation bodies.
 *
 * Our OCR transcriptions and English translations are machine-generated and,
 * unless explicitly reviewed, NOT human-verified. When we expose them as IIIF
 * `supplementing` annotations a viewer (Mirador, Universal Viewer, Clover)
 * overlays them on the original page image — visually indistinguishable from a
 * scholarly transcription. Attaching a `generator` agent makes the machine
 * origin explicit and citable, so a reader never mistakes AI output for a
 * faithful human transcript.
 *
 * `generator` is the W3C Web Annotation field for the software that produced
 * the annotation body (https://www.w3.org/TR/annotation-model/#agents).
 */

type AnnotationKind = 'ocr' | 'translation';

/**
 * Build a `generator` Software agent for an AI-produced annotation body.
 * Pass the concrete model name (e.g. `pages.ocr.model`) when known so the
 * provenance is specific rather than generic.
 */
export function aiGenerator(kind: AnnotationKind, model?: string) {
  const what =
    kind === 'ocr'
      ? 'AI OCR transcription — machine-generated, not human-verified'
      : 'AI translation — machine-generated, not human-verified';
  const label = model ? `${what} (${model})` : what;

  return {
    id: 'https://sourcelibrary.org/about/processing',
    type: 'Software',
    label: { en: [label] },
  };
}
