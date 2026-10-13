# PRIOR ART: scripts/lib/cli-chatter.mjs (OCR_SENTINEL_INSTRUCTION, unwrapSentinels) and PR #6578's TRANSLATE_SUFFIX /
# TRANSLATION_SENTINEL_INSTRUCTION (the fixed CLI translation runner, #6523, unmerged on 2026-10-12): copied verbatim
# so the Pro, Opus and 3.8-with-suffix arms get exactly what that runner will send. The correction and edit-contract
# prompts are new (#6545); they never mention how many errors a draft has, or that any were planted.
import re

TRANSLATION_SENTINEL_INSTRUCTION = ('Write the translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the '
                                    'markers: no preamble, no plan, no summary, no offers, no questions.')
TRANSLATE_SUFFIX = f'\n\nDo not open, read or write any file and do not use any tool: the text is above. {TRANSLATION_SENTINEL_INSTRUCTION}\n'

SENT = re.compile(r'<<<\s*BEGIN\s*>>>([\s\S]*?)(<<<\s*END\s*>>>|$)')


def unwrap(raw):
    """(text inside the markers, problem or None). No marker → the whole reply and 'no marker'."""
    raw = (raw or '').strip()
    m = SENT.search(raw)
    if not m:
        return raw, ('no marker' if raw else 'empty')
    inside = m.group(1).strip()
    outside = (raw[:m.start()] + raw[m.end():]).strip()
    # Opus sometimes puts the house <summary>/<keywords> blocks after <<<END>>>: they are part of the translation's format.
    after = raw[m.end():].strip()
    if after and not raw[:m.start()].strip() and not re.sub(r'<(\w+)[^>]*>[\s\S]*?</\1>', '', after).strip():
        return inside + '\n\n' + after, ('tags after <<<END>>>' if inside else 'empty')
    prob = 'reply cut before <<<END>>>' if not m.group(2) else ('text outside the markers' if outside else None)
    return inside, (prob if inside else 'empty')


def correction_prompt(lang, source, draft, image_hint):
    return f"""You are checking a draft English translation of ONE page of a historical book written in {lang}.

You have three things:
1. SOURCE: the page's text in {lang}, transcribed by OCR. It can contain OCR errors.
2. The page image ({image_hint}). Where the OCR is garbled or doubtful, the image is the authority on what the page says.
3. DRAFT: an English translation of the page.

Your task: return the corrected English translation.
- Fix errors of MEANING against the source: a wrong sense, a negation added or lost, a wrong name, number or date, a wrong
  subject or speaker, a condition turned around, a sentence or clause of the source left out, or content the source does not have.
- Change nothing that is right. Do not restyle, rephrase, modernise or polish wording that already says what the source says.
  Do not change spelling conventions, transliteration or terminology choices unless they are wrong.
- Keep the draft's format exactly: its markdown, line breaks, headings and every tag (<summary>, <keywords>, <note>, <term>,
  <gloss>, <meta>, <warning>, <page-num>, <heading>, ->centred<- and the like). Keep notes and summaries unless what they
  say is wrong about this page.
- If the draft has no error of meaning, return it unchanged.

Write the corrected translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers:
no preamble, no plan, no list of changes, no summary, no questions.

SOURCE:
{source}

DRAFT:
{draft}
"""


def contract_prompt(lang, source, draft, spans, image_hint):
    sp = '\n'.join(f'[{i + 1}] "{s["quote"]}" — {s["why"]}' for i, s in enumerate(spans))
    return f"""You are repairing a draft English translation of ONE page of a historical book written in {lang}.

You have: SOURCE (the page's text in {lang}, transcribed by OCR; it can contain OCR errors), the page image ({image_hint};
the authority where the OCR is doubtful), the DRAFT English, and a list of FLAGGED SPANS: passages of the draft that two
reviewers marked as possibly wrong in meaning, each with the reviewers' reason.

EDIT CONTRACT: you may change ONLY the flagged spans. Everything else in the draft stays exactly as it is.
For each flagged span, read the source (and the image) and decide:
- if the span is wrong in meaning, give a corrected replacement that says what the source says, in the draft's style;
- if the span is in fact right, keep it unchanged.

Answer with one JSON object, between two marker lines <<<BEGIN>>> and <<<END>>>, and nothing outside them:
{{"edits": [{{"span": 1, "old": "<the exact text of the draft you replace, copied character for character; it must lie inside flagged span 1>", "new": "<the replacement>"}}, ...]}}
Leave a span out of "edits" if it is right. "old" must be an exact substring of the DRAFT.

FLAGGED SPANS:
{sp}

SOURCE:
{source}

DRAFT:
{draft}
"""
