// PRIOR ART: scripts/eval/continuation-probe-7271/probe.mjs (the no-image continuation wording, adapted from "next 200
// words" to "the rest of this page"); scripts/lib/cli-chatter.mjs OCR_SENTINEL_INSTRUCTION (the marker sentence, reused);
// scripts/lib/agy-cli.mjs OCR_READ_FILE_INSTRUCTION (how agy is pointed at the image, #7558).
/**
 * prompts.mjs — every prompt the read-or-recall pilot (#7570) sends. Fixed before any model call (preregistered).
 *
 *   KEY       the blind reader: image only, no work named; page classification lines, then the transcription.
 *   A         image + work named (catalogue title, author, year).
 *   B         image only.
 *   C         work named, NO image: the page's first words (the anchor, from the key) and its length; reproduce the rest.
 *   P         positive control, no image: a famous passage named by work and locus.
 * The image sentence differs by CLI only in how the file is opened (claude: the Read tool; agy: read_file/view_file).
 */
import { OCR_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';

export const IMAGE_FILE = 'page.jpg';
const CORE = `Transcribe the main text of this page exactly as it is printed or written, in its original language and script. Keep the original spelling and word order. Expand abbreviations and contractions, and write long s as s. Do not translate, modernise, correct or complete anything: write only what is on the page, and where a word cannot be read write [...]. Leave out running heads, page numbers, signatures, catchwords, marginal notes, and footnotes or critical apparatus set below the main text.`;
const imageSentence = (cli) => (cli === 'claude'
  ? `The page image is the file ./${IMAGE_FILE} in this directory. Open it with the Read tool: that is the only tool available.`
  : `The page image is the file ./${IMAGE_FILE} in this directory. Open it with read_file (or view_file): that is the only tool available here, and running commands, cropping or any other tool is disabled.`);
export const named = (w) => `${w.title}${w.author ? `, by ${w.author}` : ''}${w.year ? `, printed ${w.year}` : ''}`;

export const KEY = (cli) => `${imageSentence(cli)}

First, answer four questions about the page, one per line, before the markers:
SCRIPT: the main script of the page's main text (Latin, Greek, Hebrew, Chinese, Devanagari, or name another)
SHARE: roughly what percentage of the main text is in that script (0-100)
KIND: print or manuscript
PAGE: one of running-prose, verse, text-with-commentary, index-or-table, title-page, plate-or-illustration, blank

Then: ${CORE} Read every word from the image itself, even where it differs from a text you may know.

${OCR_SENTINEL_INSTRUCTION}`;

export const A = (cli, w) => `This page is from ${named(w)}. ${imageSentence(cli)}

${CORE}

${OCR_SENTINEL_INSTRUCTION}`;

export const B = (cli) => `${imageSentence(cli)}

${CORE}

${OCR_SENTINEL_INSTRUCTION}`;

export const C = (w, anchor, chars) => `A page of ${named(w)} begins with these words:

${anchor}

Write the main text of this page from where those words stop, as it stands in that edition, in its original language and script, word for word. The page's main text is about ${chars} characters long in all. Do not translate, summarise, modernise or comment. If you do not know the text, write your best reconstruction of how the page continues.

Write only the continuation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.`;

export const P = (item) => `Write out ${item.ask}, word for word, in the original ${item.lang_name}. Do not translate or comment.

Write only the text between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.`;

/** The anchor: the key's first 12 words (Chinese: first 12 Han characters, punctuation kept). */
export function anchorOf(keyText, script) {
  const t = String(keyText || '').replace(/\s+/g, ' ').trim();
  if (script === 'chinese') { let n = 0, i = 0; for (const ch of t) { i += ch.length; if (/\p{Script=Han}/u.test(ch) && ++n >= 12) break; } return t.slice(0, i); }
  return t.split(' ').slice(0, 12).join(' ');
}
