/**
 * Safe serialization of JSON-LD into a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` does not escape `<`, and the HTML parser ends a `<script>`
 * element at the first `</script` it sees — inside a string literal or not. So
 * any payload containing that sequence terminates the tag early, dumps the rest
 * of the JSON into the document as text, and can execute whatever follows.
 *
 * This is not hypothetical for us. The reader page's JSON-LD carries a 500-char
 * excerpt of page text, and our OCR metadata envelope literally contains a
 * `<script>` tag — it records the writing system, e.g.
 * `<script>printed</script>`. `stripEditorialWrappers()` removes that envelope,
 * so the excerpt is normally clean; this function is the belt to that braces,
 * and it also covers every other schema component, whose titles, descriptions
 * and author names come from imported catalogue data we do not control.
 *
 * Escaping `<` is sufficient and is the standard fix: it defeats both
 * `</script` and `<!--`. `<` is a valid JSON escape, so consumers
 * (Google, schema validators) parse it back to `<` transparently.
 *
 * Pinned by tests/unit/json-ld-escape.test.ts.
 */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
