<!-- PRIOR ART: /root/sl-eval-archive/xlref-2026-10/xlref-t1/ALIGN-BRIEF.md and xlref-t2/align/ALIGN-PROMPT.md (#5695) cut ONE reference per page from a fixed draw. This brief cuts a SECOND, independent translation to pages whose first reference already exists, and adds the independence check and the anchor log #5762 asks for. -->
# Second-translator alignment brief — #5762 human ceiling, group {{G}}

For each page below we already hold the source page (OCR of a Greek or Latin book) and translation **A**, a published
English translation cut to that page. Your job: find a **second, independent, public-domain** English translation
**B** of the same passage and cut it to the same page. Two blind judges will then score B against A and A against B
to measure how far two professional translators differ, so a loose cut becomes a false "omission" by a human
translator. Precision matters more than count: skipping a page is a good outcome when B is not clean.

Input: `/data/scratch/sl/hc5762/align/in-{{G}}.jsonl` (one JSON line per page: `id`, `lang`, `work`, `a` — A's
translator, year, `located` passage and url — `b_hint`, `source_text`, `a_text`). Read it once with the Read tool.
Downloads go in `/data/scratch/sl/hc5762/src/{{G}}/` (create it). Output: `/data/scratch/sl/hc5762/align/out-{{G}}.jsonl`.

## Hard rules
- No database, no git, no repo edits, no subagents. You never need our own English and must not look for it.
- B must be public domain or openly licensed: EEBO-TCP (CC0), Project Gutenberg, Wikisource, CCEL texts of PD books,
  sacred-texts transcriptions of PD books, LacusCurtius/Perseus texts of PD books, archive.org scans published
  before 1931. An in-copyright B is a skip.
- **Independence.** B must be a different translator's own translation from the Greek/Latin. A revision of A, the
  translation A revised, or a retranslation through another language is not independent. Record `independent`:
  `true`, `"partial"` (a revision lineage, or made with A at the elbow — say which) or `false` (then skip). `b_hint`
  says where to look and what to check; if the hinted B fails, try the alternative it names, then skip.
- Downloads: `curl -sL -A "Mozilla/5.0"`. EEBO-TCP: `https://raw.githubusercontent.com/textcreationpartnership/<TCPID>/master/<TCPID>.xml`
  (find the id by searching the title + "EEBO TCP", or `https://quod.lib.umich.edu/e/eebo/`). archive.org full text:
  `https://archive.org/download/<identifier>/<identifier>_djvu.txt`; search with
  `https://archive.org/advancedsearch.php?q=<query>&fl[]=identifier,title,date&rows=20&output=json`. Gutenberg:
  `https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt`. WebSearch / WebFetch are available via ToolSearch
  (`select:WebSearch,WebFetch`) when you need to find a text.

## Cutting B (this is the whole job)
1. Read `source_text`. Its first and last words of RUNNING TEXT are the span (OCR tags such as `<header>`, `<note>`,
   `<margin>`, `<page-num>`, a Latin parallel column on a Greek page, and the critical apparatus are not running text).
2. Use A's `located` and `a_text` to find the passage in B. Then cut B against the SOURCE, not against A: A's cut can
   itself be a little wide or narrow. `b_text` = B's English for exactly the page's running text, first word to last
   word; cut mid-sentence where the page does. Do not add `[context]` lines.
3. Clean only transcription junk (page numbers, running heads, footnote markers, line-end hyphens, XML tags, long-s).
   Keep the translator's spelling, punctuation and bracketed additions. Do not repair, modernise or complete B.
4. **Anchors.** Record `anchors`: for the START, the MIDDLE and the END of the page, a ≤ 8-word phrase of the source
   and the ≤ 12-word phrase of B that renders it. If you cannot produce all three, skip the page.
5. If B omits, abridges or paraphrases away part of the page, say so in `coverage_note` with the share of the page
   covered. Under 80% covered → skip (an abridgement is not a second translation of the page).
6. Note the edition B translated from if known, and any place where B and A plainly follow different readings.
7. **Verbatim check.** Save the text you cut from as a file in your downloads dir and give its path in
   `b_meta.source_file`; `b_text` must be recoverable from that file apart from the cleaning in step 3.

## Output: one JSON line per page (append as soon as a page is done)
{"id":"…","b_text":"…","b_meta":{"title":"…","translator":"…","year":1614,"licence":"CC0 1.0 (EEBO-TCP)","private":false,
  "style":"early-modern|literal|free","located":"book/chapter/§ or page in B","url":"…exact URL you used…",
  "source_file":"/data/scratch/sl/hc5762/src/{{G}}/…","source_edition_used_by_translator":"…","coverage_note":"…"},
 "independent":true,"independence_note":"…one line: how you know…",
 "alignment_method":"…how you found and cut it…","anchors":[{"where":"start","source":"…","b":"…"},{"where":"middle","source":"…","b":"…"},{"where":"end","source":"…","b":"…"}],
 "alignment_confidence":"high|medium|low","variant_note":"…or empty…"}
and for a page you skipped: {"id":"…","skipped":true,"reason":"…","tried":["…"]}

style: `early-modern` = printed before 1800 (loose by modern standards); `literal` = a close 19th/20th-c. translation;
`free` = a loose, verse or paraphrastic later translation.

Work through every page of your input; spend at most ~10 tool calls searching for a B before skipping. When finished
print ONLY the counts, e.g. `{{G}}: 6 cut, 1 skipped`.
