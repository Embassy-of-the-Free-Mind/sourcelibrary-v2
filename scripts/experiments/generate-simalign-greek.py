#!/usr/bin/env python3
"""
Generate word alignment for Greek → Transliteration → English.
Uses SimAlign (mBERT embeddings) for Greek↔English alignment.
Transliteration is deterministic mapping.
"""
import json
import os
import unicodedata
from simalign import SentenceAligner

aligner = SentenceAligner(model='bert-base-multilingual-cased', token_type='bpe', matching_methods='mai')

# Greek transliteration table
TRANSLIT = {
    'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z',
    'η': 'ē', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm',
    'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's',
    'ς': 's', 'τ': 't', 'υ': 'u', 'φ': 'ph', 'χ': 'ch', 'ψ': 'ps',
    'ω': 'ō', 'ϊ': 'i', 'ϋ': 'u',
    'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z',
    'Η': 'Ē', 'Θ': 'Th', 'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M',
    'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P', 'Ρ': 'R', 'Σ': 'S',
    'Τ': 'T', 'Υ': 'U', 'Φ': 'Ph', 'Χ': 'Ch', 'Ψ': 'Ps', 'Ω': 'Ō',
}

def transliterate(text):
    result = []
    for ch in text:
        # Strip accents/diacritics first
        base = unicodedata.normalize('NFD', ch)
        base_char = ''.join(c for c in base if unicodedata.category(c) != 'Mn')
        if base_char in TRANSLIT:
            result.append(TRANSLIT[base_char])
        elif ch in TRANSLIT:
            result.append(TRANSLIT[ch])
        else:
            result.append(ch)
    return ''.join(result)

def transliterate_word(word):
    return transliterate(word)

# Aratus Phaenomena opening — manually sentence-paired
sentences = [
    {
        "src": "Ek Διὸς ἀρχώμεσθα, τὸν οὐδέποτ' ἄνδρες ἐῶμεν ἀῤῥητον·",
        "en": "From Zeus let us begin: him let no man leave unspoken."
    },
    {
        "src": "μεσταὶ δὲ Διὸς πᾶσαι μὲν ἀγυιαί, πᾶσαι δ' ἀνθρώπων ἀγοραί, μεστὴ δὲ θάλασσα καὶ λιμένες·",
        "en": "Full of Zeus are all the streets, all the marketplaces of men, full is the sea and the harbors."
    },
    {
        "src": "πάντη δὲ Διὸς κεχρήμεθα πάντες.",
        "en": "Everywhere we all make use of Zeus."
    },
    {
        "src": "τοῦ γὰρ καὶ γένος εἰμέν·",
        "en": "For we are also his offspring."
    },
    {
        "src": "ὁ δ' ἤπιος ἀνθρώποισιν δεξιὰ σημαίνει, λαοὺς δ' ἐπὶ ἔργον ἐγείρει μιμνήσκων βιότοιο·",
        "en": "He, being kind to men, gives favorable signs, and stirs the people to work, reminding them of life."
    },
]

results = []
for pair in sentences:
    src_tokens = pair["src"].split()
    en_tokens = pair["en"].split()
    translit_tokens = [transliterate_word(w) for w in src_tokens]

    alignment = aligner.get_word_aligns(src_tokens, en_tokens)
    links = alignment.get('itermax', [])

    words = []
    seen = set()
    for si, ei in links:
        s = src_tokens[si]
        e = en_tokens[ei]
        t = translit_tokens[si]
        # Skip punctuation-only
        if len(s.strip(".,;:·'—–-()")) < 2 or len(e.strip(".,;:·'—–-()")) < 2:
            continue
        key = (si, ei)
        if key in seen:
            continue
        seen.add(key)
        words.append({
            "src": s.rstrip(".,;:·'—–-()"),
            "translit": t.rstrip(".,;:·'—-()"),
            "en": e.rstrip(".,;:·'—–-()"),
            "weight": 1.0
        })

    results.append({
        "src": pair["src"],
        "translit": " ".join(translit_tokens),
        "en": pair["en"],
        "words": words
    })
    print(f"Sentence: {len(words)} links")
    for w in words:
        print(f"  {w['src']:20s}  {w['translit']:20s}  → {w['en']}")

# Load existing data and add Greek page
outpath = os.path.join(os.path.dirname(__file__), "alignment-results.json")
with open(outpath) as f:
    data = json.load(f)

# Remove any existing Aratus page
data["pages"] = [p for p in data["pages"] if p["id"] != "aratus-phaenomena-opening"]

data["pages"].append({
    "id": "aratus-phaenomena-opening",
    "book": "Phaenomena",
    "author": "Aratus of Soli",
    "year": "~270 BCE",
    "sourceLanguage": "Ancient Greek",
    "hasTransliteration": True,
    "sentences": results
})

with open(outpath, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"\nAdded to {outpath}")
print(f"Total: {sum(len(s['words']) for s in results)} word links across {len(results)} sentences")
