#!/usr/bin/env python3
"""
Generate word alignment using SimAlign (real mBERT embeddings).
One paragraph of Ficino, sentence-paired.
"""
import json
import os
from simalign import SentenceAligner

aligner = SentenceAligner(model='bert-base-multilingual-cased', token_type='bpe', matching_methods='mai')

# Ficino De Voluptate, Chapter 1 — first paragraph, manually sentence-paired
# Source: OCR from the 1457 Latin text
# Translation: Gemini translation from Source Library
sentences = [
    {
        "src": "PLATO igitur, ut ab eorum principe initium faciam, cum animum in duas partes distribuisset, mente scilicet ac sensum, menti laeticiam & gaudium attribuit, sensibus voluptatem.",
        "en": "Plato, therefore (to begin with him as the leader of these philosophers), when he had divided the soul into two parts — namely, the mind and the senses — attributed gladness and joy to the mind, pleasure to the senses."
    },
    {
        "src": "Verum prima duo haec inter se differre putat, quod omne gaudium laude sit dignum, laeticia vero partim laudanda, partim vituperanda sit.",
        "en": "He considers these first two to differ from each other in that all joy is worthy of praise, while gladness is partly to be praised and partly to be censured."
    },
    {
        "src": "Esse enim laeticiam in bonis alicuius possessione quandam mentis elationem, quae tamen modestiam excedere pariter, atque seruare queat.",
        "en": "For he defines gladness as a certain elevation of the mind in the possession of some good things, which is able to both exceed and preserve moderation."
    },
    {
        "src": "Gaudium vero illam ipsam, quae ex contē- platione, aut alio quopiam virtutum usu suscipitur iocunditatem.",
        "en": "Joy, however, is that very delight which is received from contemplation or from some other exercise of the virtues."
    },
]

results = []
for pair in sentences:
    src_tokens = pair["src"].split()
    en_tokens = pair["en"].split()

    alignment = aligner.get_word_aligns(src_tokens, en_tokens)
    # Use 'itermax' method (best quality)
    links = alignment.get('itermax', alignment.get('inter', []))

    words = []
    for si, ei in links:
        src_word = src_tokens[si]
        en_word = en_tokens[ei]
        # Skip punctuation-only alignments
        if len(src_word.strip('.,;:—–-()')) < 2 or len(en_word.strip('.,;:—–-()')) < 2:
            continue
        words.append({
            "src": src_word.rstrip('.,;:—–-()'),
            "en": en_word.rstrip('.,;:—–-()'),
            "weight": 1.0
        })

    results.append({
        "src": pair["src"],
        "en": pair["en"],
        "words": words
    })
    print(f"Sentence: {len(words)} word links")
    for w in words:
        print(f"  {w['src']:20s} → {w['en']}")

output = {
    "generated": "2026-04-16",
    "method": "simalign-mbert-inter",
    "pages": [{
        "id": "ficino-de-voluptate-p6",
        "book": "De Voluptate",
        "author": "Marsilio Ficino",
        "year": "1457",
        "sourceLanguage": "Latin",
        "sentences": results
    }]
}

outpath = os.path.join(os.path.dirname(__file__), "alignment-results.json")
with open(outpath, "w") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\nWritten to {outpath}")
print(f"Total: {sum(len(s['words']) for s in results)} word links across {len(results)} sentences")
