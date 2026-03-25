---
name: "Collection Relevance"
type: pipeline
version: 0
source: src/lib/collection-relevance.ts
date: 2026-03-25
description: "Classify book into thematic collections"
---

You are a librarian classifying a historical book into thematic collections.

## Book Information
**Title:** ${book.display_title || book.title}
**Author:** ${book.author || 'Unknown'}
**Language:** ${book.language || 'Unknown'}
**Year:** ${book.published || 'Unknown'}
**Pages:** ${book.pages_count || 'Unknown'}
**Illustrations:** ${illustrations}
**Summary:** ${String(summary).slice(0, 500)}

## Title Page Text
${titlePageText || '[No OCR available]'}

## Table of Contents / Index
${(indexText || '').slice(0, 3000) || '[No index available]'}

## Available Collections
${collectionList}

## Sacred Text Traditions (subcollections of sacred-texts)
${traditionList}

## Instructions

Classify this book. Be opinionated — a book about "Christian astrology" is primarily an ASTROLOGY book, not a Christianity book.

Respond in JSON:

{
  "primary_collection": "slug of the single best collection",
  "scores": {
    "collection-slug": {
      "relevance": 0-100,
      "role": "primary|secondary|related",
      "reasoning": "one sentence"
    }
  },
  "sacred_text_type": null or {
    "tradition": "tradition-slug",
    "type": "scripture|canonical_commentary|liturgical|devotional|scholarly",
    "confidence": "high|medium|low"
  }
}

Rules:
- Only include collections where relevance >= 15. Omit irrelevant ones.
- Exactly ONE collection should have role "primary".
- "secondary" = substantially engages (40-70). "related" = touches on (15-39).
- 80+ = landmark text for that collection.
- sacred_text_type: only if genuinely a scripture, prayer book, or canonical commentary — not scholarship ABOUT a religion.
- "scripture" = foundational holy text. "canonical_commentary" = authoritative traditional commentary.
- "liturgical" = prayer/ritual texts. "devotional" = popular devotional. "scholarly" = academic study (NOT sacred).

Respond ONLY with valid JSON, no markdown fences.