# Can AI Read Leonardo da Vinci's Secret Notebooks?

*We tested five frontier AI models on Leonardo's mirror-script manuscripts. The answer is surprising — and reveals something important about how AI "reads."*

---

In February 2022, one of us encountered a 1497 edition of Ficino's *De Mysteriis* at the Embassy of the Free Mind in Amsterdam. Bound within it was his *Liber de Voluptate* — a Latin dialogue on pleasure, never translated into English. This encounter led to Source Library, a project that has since OCR'd and translated over 17,000 historical books using multimodal AI.

The pipeline works remarkably well on printed text. A 1521 Latin book yields clean, consistent transcriptions with near-human accuracy — no training data, no fine-tuning, just a frontier model and a good prompt.

Then we tried Leonardo da Vinci's notebooks.

## The Discovery

Leonardo wrote in mirror-script — right to left with reversed letterforms, probably because he was left-handed. When we ran our OCR pipeline on his manuscripts, something unsettling happened: the AI produced fluent, plausible Italian text about the right topics (optics on optics pages, water dynamics on water pages), but the *specific text changed completely between runs*. Same model, same image, same prompt — different words every time.

We call this **informed confabulation**: the model knows what Leonardo writes *about*, but cannot read what he actually *wrote*.

## Measuring the Problem

How do you measure something like this without ground truth? We adapted an idea from hallucination detection research (SelfCheckGPT): run the same OCR multiple times and measure agreement. If the model is genuinely reading, independent runs should produce the same text. If it's generating from priors, they'll diverge.

We tested three metrics across N=5 independent runs:

| Metric | Printed Latin | Leonardo Mirror-Script |
|--------|:---:|:---:|
| **Embedding similarity** | **99.0%** | **82-84%** |
| Jaccard word overlap | 55-62% | 6-8% |
| Character error rate | 5-15% | 73-80% |

Embedding similarity is the key number. It measures semantic equivalence — whether two transcriptions say the same *thing*, even if they use different exact words. At 99%, the printed text runs are essentially identical. At 82-84%, the Leonardo runs discuss the same topics but with different specific text.

The Jaccard score tells the rest of the story: at 6-8% word overlap, the runs don't even share vocabulary. And the wildly varying output lengths (314 to 2,939 characters for the same page!) show the model can't even decide how much text to produce.

## Five Models, Same Result

We tested five frontier models — Gemini Flash, Gemini Pro, Gemini Lite, Claude Sonnet, and Claude Opus. On printed text, all score 93-99%. On manuscripts, all converge to the same range:

| Model | Manuscript Consistency |
|-------|:---:|
| Gemini Lite | 36.7%* |
| Claude Opus | 27.3% |
| Gemini Pro | 27.0% |
| Gemini Flash | 26.8% |
| Claude Sonnet | 21.5% |

*Gemini Lite scores highest but produces pseudo-Latin nonsense — consistency without accuracy.

The convergence is striking. Models spanning different architectures, training data, and parameter counts all hit the same wall. The bottleneck isn't language modeling — it's visual perception.

## Can Image Processing Help?

We tested 10 image preprocessing methods. The winner: horizontally flipping the mirror-script to normal orientation, combined with contrast enhancement.

| Method | Embedding Consistency |
|--------|:---:|
| Original | 84.0% |
| **Flip + contrast** | **94.4%** |
| Contrast only | 90.4% |
| Binarization | 80.7% |
| Denoising | 76.1% |

Flipping closes about half the gap to printed text. This confirms the model can partially read Leonardo's letterforms — it just struggles with their reversed orientation. But 94% embedding with 18% Jaccard means the text is still topically correct but textually unfaithful.

## Does Reasoning Help?

We tested Gemini Pro with extended "thinking" — the idea being that step-by-step letter decomposition might help decode mirror-script. The result: **reasoning makes it worse**.

| Condition | Embedding |
|-----------|:---:|
| Flash (no reasoning) | 86.0% |
| Pro (standard) | 74.1% |
| Pro (reasoning prompt) | 65.0% |
| Pro (thinking=4096) | 64.2% |

The reasoning model over-constrains itself. Recognizing that it can't confidently decode individual reversed letterforms, it produces almost nothing — sometimes zero characters. This is arguably more honest (the model "knows what it doesn't know"), but it doesn't produce useful transcriptions.

**The bottleneck is perceptual, not cognitive.** No amount of reasoning about what the text should say can compensate for the inability to decode reversed letterforms from pixels.

## The Printed Leonardo Control

Here's the clincher: Leonardo's *Trattato della pittura* was published in printed form in 1651. Same content, standard typeface. Result: **98-99.6% embedding consistency**. The model reads printed Leonardo perfectly.

The failure is pure handwriting perception. The model understands Leonardo's topics, knows his vocabulary, and can read his ideas — as long as someone else wrote them down.

## Not a Single Reliable Sentence

We built a consensus tool that takes 5 OCR runs and annotates each sentence as green (reliable), yellow (approximate), or red (uncertain).

| Source | Trust Score | Green | Yellow | Red |
|--------|:---:|:---:|:---:|:---:|
| Vitruvius (printed) | 95.5% | 14 | 1 | 0 |
| Leonardo (mirror-script) | 82.9% | **0** | 14 | 1 |

On printed text, 14 of 15 sentences are reliably transcribed. On Leonardo, **not a single sentence is consistently reproduced across runs**. The 82.9% trust score is misleading — it reflects topical coherence, not textual fidelity.

## The Strongest Evidence Yet: A Copying Confound

We turned to *Les Manuscrits de Léonard de Vinci* by Ravaisson-Mollien (Paris, 1881), the gold-standard scholarly edition. Ravaisson-Mollien transcribed all of Leonardo's Institut de France manuscripts and published them as facing-page editions: facsimile on the left, printed Italian transcription on the right — sometimes on the same page.

This gave us an unplanned experiment.

**The copying confound test**: Ravaisson-Mollien pages often show both the manuscript facsimile *and* the printed transcription on the same page. When we asked the model to transcribe only the handwritten portion, something unexpected happened: on pages where the printed answer was visible, the model achieved 97% word overlap with the transcription — but when we forced it to use only the manuscript facsimile, it produced descriptions like "dense cursive handwriting in sepia-toned ink" rather than actual Italian text.

The model wasn't reading the mirror-script. It was reading the printed answer.

**Stylistic mismatch**: Even setting aside the confound, the stylistic evidence is damning. Leonardo actually wrote:
> *"Prosspectiua. eragione. dimostratiua, perla quale. lassperientia chonferma"*
> (periods between words, archaic spelling, unique orthography)

The AI produces:
> *"Ogn' azione ne' nostri sensi è fatta per via d'alcuna linia"*
> (normalized modern Italian, correct grammar, wrong words)

A model genuinely decoding pixels would reproduce Leonardo's idiosyncratic periods-between-words style and archaic spellings. Instead it generates Italian *about* Leonardo's topics, in the style of texts *about* Leonardo. This is the clearest evidence that training data priors, not visual perception, are driving the output.

## What This Means for Digital Libraries

For Source Library's 17,000+ books, these findings have immediate implications:

1. **Printed books (the majority) are highly reliable.** Self-consistency scores confirm what we already suspected: AI OCR on printed historical text is production-quality.

2. **Manuscripts need trust labels.** A reader should know whether they're looking at a reliable transcription or an AI's best guess. Our green/yellow/red system makes this transparent.

3. **Consistency varies by text density, not topic.** Across eight Leonardo codices (optics, anatomy, botany, geometry, physiognomy), consistency depends on how much handwritten text the page contains, not what the text is about. Diagram pages score 98-100%. Text-heavy pages score 83-90%.

4. **Multi-run consensus extracts signal.** Rather than discarding unreliable transcriptions entirely, keeping 5 runs and highlighting the consistent parts preserves what the model *can* read while honestly marking what it cannot.

## The Bigger Picture

Leonardo's notebooks are among the most important scientific manuscripts in existence — and they remain, for now, beyond the reach of automated transcription. But our methods work for a wide range of historical documents. For every unreadable Leonardo page, there are thousands of printed books that AI can transcribe reliably and translate for the first time.

The key contribution isn't reading Leonardo — it's knowing when you can't.

---

*This research is being conducted at [Source Library](https://sourcelibrary.org), a digital library of 17,000+ historical books from the 15th-18th centuries. The full paper, "How Much Can You Trust This Page? Consistency-Based Trust Scoring for AI-Transcribed Historical Manuscripts," is in preparation.*

*GitHub Issue: [#990](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/990)*
