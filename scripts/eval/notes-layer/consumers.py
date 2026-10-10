#!/usr/bin/env python3
# PRIOR ART: the census in #3825 listed the five surfaces that hand-rolled "notes off"; .claude/docs/system-map.md
# lists collections and key files. Neither lists who reads pages.translation.data. scripts/audit/new-field-writes.mjs
# finds WRITES of unknown book fields, not readers of a page field.
"""Inventory every file on origin/main that names pages.translation.data (#5942 phase 2).

  python3 scripts/eval/notes-layer/consumers.py      # writes results/notes-layer-2026-10/consumers.tsv and prints the table

Reads tracked files only, through `git grep` / `git show` on origin/main (never the working tree, never worktrees).
A file that reaches the string through a destructured variable with no "translation.data" on any line is not found;
that limit is stated in the write-up.
"""
import collections, os, re, subprocess

REF = 'origin/main'
OUT = os.path.join(os.path.dirname(__file__), '..', 'results', 'notes-layer-2026-10', 'consumers.tsv')
PAT = r"""translation\??\.data\b|['"`]translation\.data['"`]"""
git = lambda *a: subprocess.run(['git', *a], capture_output=True, text=True).stdout
lines = collections.defaultdict(list)
for l in git('grep', '-n', '-P', PAT, REF, '--', 'src', 'scripts', 'mcp-server', 'infrastructure', 'tests', 'e2e').splitlines():
    _, path, no, text = l.split(':', 3)
    lines[path].append((int(no), text.strip()))

HELPERS = ['prepareNotesMarkdown', 'NotesRenderer', 'applyNotesOff', 'separateTermDefinitions', 'stripEditorialWrappers', 'stripEditorialWrapperBlocks',
           'cleanOcrArtifacts', 'stripMarkupTags', 'getQuoteText', 'quoteText', 'cleanPageText', 'stripTags', 'stripXml', 'toPlainText', 'plainText',
           'markdownToHtml', 'normalizeAnnotationSpans', 'pageTextForExport', 'cleanText', 'sanitizeTranslationTags', 'stripForEmbedding', 'cleanForEmbedding']
# A test of presence or size only: the words themselves are not used.
EXISTS = re.compile(r"""\$exists|\$ne\b|\$type|\$nin\b|\$gt\b|['"`]translation\.data['"`]\s*:\s*(?:[10]\b|\{|null|''|"")|translation\??\.data\??\.(?:length|trim\(\)\.length)|!!\s*[\w.?]*translation\??\.data|Boolean\([\w.?]*translation\??\.data\)""")

def surface(p):
    rules = [
        (r'^src/components/reader|^src/app/book/|^src/components/text/|^src/lib/edition-reader|^src/lib/local-mode', 'reader'),
        (r'^src/app/api/(mcp|librarian)|^mcp-server|^src/lib/embassy|^src/app/librarian|^src/lib/search/librarian', 'MCP / Librarian'),
        (r'search|atlas-search|page-rollup', 'search'),
        (r'quote|og-page-card|/og/', 'quotes / share cards'),
        (r'embed|semantic|alignment', 'embeddings / alignment'),
        (r'epub|pdf|export|download|kdp|typst|/text/|dts|iiif|git-sync|git-texts|snapshot|corpus', 'exports (EPUB, PDF, text, DTS, git)'),
        (r'chapter|book-index|entity|index-from|summar|modern|digest|seo|guide', 'derived metadata (chapters, index, summaries, entities)'),
        (r'^src/app/api/(translate|process|jobs|batch|pipeline|cron|admin|pages|books)|^src/workers|^src/lib/(translate-write|job-completion|page-counts|adaptive-limits|provenance)|^scripts/(workers|batch|lib)/', 'pipeline (writers, counters, gates)'),
        (r'^src/app/(admin|platform|developers)|^src/components/pipeline|^src/app/api', 'admin / other API'),
        (r'^scripts/eval|^scripts/semantic-consistency|^scripts/qa|^scripts/analysis|^scripts/analytics|^scripts/catalog-coverage', 'eval / analysis scripts'),
        (r'^scripts/audit', 'audit scripts'),
        (r'^scripts/(maintenance|migration|import|_archived)|^scripts/[^/]+$', 'maintenance / migration / import scripts'),
        (r'^tests|^e2e', 'tests'),
    ]
    for rx, name in rules:
        if re.search(rx, p): return name
    return 'other'

rows = []
for path in sorted(lines):
    body = git('show', f'{REF}:{path}')
    hits = lines[path]
    exists = sum(1 for _, t in hits if EXISTS.search(t))
    content = len(hits) - exists
    helpers = [h for h in HELPERS if re.search(r'\b' + h + r'\b', body)]
    # Writes are not classified: most go through a nested `translation: { data }` object that no line pattern sees.
    kind = ' + '.join(k for k, n in (('uses the words', content), ('tests presence or size', exists)) if n)
    rows.append({'surface': surface(path), 'file': path, 'lines': len(hits), 'kind': kind, 'helpers': ','.join(helpers), 'first': f'{hits[0][0]}: {hits[0][1][:110]}'})

AFTER = {
    'reader': 'translation.text + annotations through renderTranslationLayers (old path as fallback when text is absent)',
    'MCP / Librarian': 'translation.text; annotations only when the tool is asked for notes, labelled as ours',
    'search': 'translation.text (annotations indexed separately or not at all)',
    'quotes / share cards': 'translation.text only: a quote can then never contain a note',
    'embeddings / alignment': 'translation.text',
    'exports (EPUB, PDF, text, DTS, git)': 'translation.text, plus annotations when the export has notes on',
    'derived metadata (chapters, index, summaries, entities)': 'translation.text',
    'pipeline (writers, counters, gates)': 'writers keep writing translation.data and add text + annotations in the same write; counters keep testing translation.data',
    'admin / other API': 'case by case: editors keep translation.data (raw), displays move to text',
    'eval / analysis scripts': 'translation.data, unchanged: they study the model output itself',
    'audit scripts': 'translation.data, unchanged; one new audit compares text with a fresh parse of data',
    'maintenance / migration / import scripts': 'translation.data, unchanged; any that REWRITES data must re-run the parser (one helper)',
    'tests': 'unchanged',
    'other': 'case by case',
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write('surface\tfile\tlines\twhat it does with translation.data\tcleaning helpers in the file\tfirst hit\tafter phase 3\n')
    for r in sorted(rows, key=lambda r: (r['surface'], r['file'])):
        f.write('\t'.join([r['surface'], r['file'], str(r['lines']), r['kind'], r['helpers'], r['first'].replace('\t', ' '), AFTER[r['surface']]]) + '\n')
by = collections.defaultdict(lambda: collections.Counter())
for r in rows:
    c = by[r['surface']]; c['files'] += 1
    for k in ('uses the words', 'tests presence or size'): c[k] += int(k in r['kind'])
    c['only'] += int(r['kind'] == 'tests presence or size')
    c['bare'] += int('uses the words' in r['kind'] and not r['helpers'])
    c['src'] += int(r['file'].startswith('src/'))
print('| surface | files | of which src/ | use the words | …with no cleaning helper in the file | only test presence | after phase 3 |\n|---|---:|---:|---:|---:|---:|---|')
print(f'{len(rows)} files, {sum(r["lines"] for r in rows)} lines on {REF} ({git("rev-parse", "--short", REF).strip()})')
for s, c in sorted(by.items(), key=lambda kv: -kv[1]['files']): print(f"| {s} | {c['files']} | {c['src']} | {c['uses the words']} | {c['bare']} | {c['only']} | {AFTER[s]} |")
