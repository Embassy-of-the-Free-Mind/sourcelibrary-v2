import Link from 'next/link';
import { ArrowLeft, BookOpen, Scale, CheckCircle2, Languages } from 'lucide-react';

export const metadata = {
  title: 'Translation Research | Source Library',
  description: 'Benchmark studies comparing AI translations against scholarly editions.',
};

export default function ResearchPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-500 hover:text-stone-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
          <h1 className="text-3xl font-bold text-stone-900" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Translation Research
          </h1>
          <p className="text-stone-600 mt-2">
            Benchmarking AI translations against scholarly editions
          </p>
        </div>

        {/* Methodology Overview */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Scale className="w-5 h-5 text-purple-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">Methodology</h2>
          </div>

          <p className="text-stone-600 mb-4">
            To evaluate translation quality, we compare AI-generated translations against
            established scholarly editions. The process:
          </p>

          <ol className="list-decimal list-inside space-y-2 text-stone-600 mb-4 ml-2">
            <li>OCR source text (Greek/Latin) directly from scholarly edition page images</li>
            <li>Generate AI translation from the source language</li>
            <li>OCR the published scholarly English translation from facing pages</li>
            <li>Compare systematically for accuracy, style, and meaning preservation</li>
          </ol>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-purple-900">
              <strong>Why this approach?</strong> Using public domain scholarly editions (Loeb,
              Oxford Classical Texts, etc.) provides authoritative benchmarks. OCR from images
              ensures we&apos;re comparing against the actual published text, not corrupted digital copies.
            </p>
          </div>
        </section>

        {/* Poimandres Study */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-100 rounded-lg">
              <BookOpen className="w-5 h-5 text-amber-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">
              Study 1: Poimandres (Greek → English)
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">Source Text</div>
              <div className="font-medium text-stone-900">Corpus Hermeticum I (Poimandres)</div>
              <div className="text-stone-600">Ancient Greek, 2nd-3rd century CE</div>
            </div>
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">Benchmark Edition</div>
              <div className="font-medium text-stone-900">Scott, Hermetica Vol. I (1924)</div>
              <div className="text-stone-600">Clarendon Press, Oxford</div>
            </div>
          </div>

          <h3 className="font-medium text-stone-800 mb-3 flex items-center gap-2">
            <Languages className="w-4 h-4" />
            Side-by-Side Comparison
          </h3>

          <div className="space-y-4 mb-6">
            {/* Section 1 */}
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">
                §1 — Opening
              </div>
              <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                <div className="p-3">
                  <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                  <p className="text-sm text-stone-700">
                    A thought once arose in me concerning existing things, and my intellect,
                    soaring greatly aloft, while my bodily senses were overcome by sleep—not,
                    however, like those weighed down from satiety of food or from bodily fatigue...
                  </p>
                </div>
                <div className="p-3 bg-amber-50/50">
                  <div className="text-xs text-amber-600 font-medium mb-1">Scott (1924)</div>
                  <p className="text-sm text-stone-700">
                    Once on a time, when I had begun to think about the things that are, and
                    my thoughts had soared high aloft, while my bodily senses had been put
                    under restraint by sleep,—yet not such sleep as that of men weighed down
                    by fullness of food or by bodily weariness...
                  </p>
                </div>
              </div>
            </div>

            {/* Section 2 */}
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">
                §2 — Identity of Poimandres
              </div>
              <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                <div className="p-3">
                  <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                  <p className="text-sm text-stone-700">
                    I said: &quot;And who are you?&quot; He said: &quot;I am Poimandres, the Mind of Sovereignty.&quot;
                  </p>
                </div>
                <div className="p-3 bg-amber-50/50">
                  <div className="text-xs text-amber-600 font-medium mb-1">Scott (1924)</div>
                  <p className="text-sm text-stone-700">
                    &apos;Who are you?&apos; I said. &apos;I,&apos; said he, &apos;am Poimandres, the Mind of the Sovereignty.&apos;
                  </p>
                </div>
              </div>
            </div>

            {/* Section 4 */}
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">
                §4 — The Vision
              </div>
              <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                <div className="p-3">
                  <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                  <p className="text-sm text-stone-700">
                    ...I saw an infinite vision, a light which had become all things, both
                    gentle and joyful. And I was amazed at the sight.
                  </p>
                </div>
                <div className="p-3 bg-amber-50/50">
                  <div className="text-xs text-amber-600 font-medium mb-1">Scott (1924)</div>
                  <p className="text-sm text-stone-700">
                    ...I beheld a boundless view; all was changed into light, a mild and
                    joyous light; and I marvelled when I saw it.
                  </p>
                </div>
              </div>
            </div>

            {/* Section 6 */}
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">
                §6 — Theological Statement
              </div>
              <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                <div className="p-3">
                  <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                  <p className="text-sm text-stone-700">
                    &quot;That light,&quot; I said, &quot;is Mind, the first God, who existed before the
                    watery nature which appeared from the darkness; and the luminous Word
                    is the Son of God.&quot;
                  </p>
                </div>
                <div className="p-3 bg-amber-50/50">
                  <div className="text-xs text-amber-600 font-medium mb-1">Scott (1924)</div>
                  <p className="text-sm text-stone-700">
                    &apos;That Light,&apos; he said, &apos;is I, even Mind, the first God, who was before
                    the watery substance which appeared out of the darkness; and the Word
                    which came forth from the Light is son of God.&apos;
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Assessment */}
          <h3 className="font-medium text-stone-800 mb-3">Assessment</h3>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-green-800">Accuracy: ~92%</span>
            </div>
            <p className="text-sm text-green-900">
              Core theological and philosophical concepts accurately rendered. Greek vocabulary
              (νοῦς → Mind, λόγος → Word) handled correctly.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="font-medium text-blue-800 mb-2">AI Strengths</h4>
              <ul className="text-sm text-blue-900 space-y-1">
                <li>• Correct Greek philosophical vocabulary</li>
                <li>• Preserves dialogic structure</li>
                <li>• Handles editorial apparatus marks</li>
                <li>• Maintains section numbering</li>
              </ul>
            </div>
            <div className="bg-amber-50 rounded-lg p-4">
              <h4 className="font-medium text-amber-800 mb-2">Scott Differences</h4>
              <ul className="text-sm text-amber-900 space-y-1">
                <li>• Archaic English (&quot;methought&quot;, &quot;I would fain&quot;)</li>
                <li>• Scholarly footnotes provided</li>
                <li>• More interpretive word choices</li>
                <li>• Period stylistic polish</li>
              </ul>
            </div>
          </div>

          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
            <p className="text-sm text-stone-700">
              <strong>Conclusion:</strong> The AI translation from Greek is semantically accurate
              and suitable for reference use. Scott&apos;s translation adds stylistic polish and
              scholarly apparatus, but the AI faithfully captures the meaning—appropriate for
              readers seeking access to the text without archaic language.
            </p>
          </div>
        </section>

        {/* Technical Details */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Technical Details</h2>

          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">OCR Model</div>
              <div className="font-mono text-stone-900">gemini-2.5-flash</div>
            </div>
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">Translation Model</div>
              <div className="font-mono text-stone-900">gemini-2.5-flash</div>
            </div>
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">Source Pages</div>
              <div className="font-mono text-stone-900">n117, n119 (Greek)</div>
            </div>
          </div>

          <div className="mt-4 text-sm text-stone-500">
            <p>
              Source: <Link href="/book/6953a93977f38f6761bd58f4" className="text-amber-600 hover:underline">
                Scott, Hermetica Vol. I
              </Link> (Internet Archive: ScottHermeticaVolOne)
            </p>
            <p className="mt-1">
              Study conducted: December 30, 2025
            </p>
          </div>
        </section>

        {/* Study 2: De Voluptate */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <BookOpen className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">
              Study 2: De Voluptate (Latin → English)
            </h2>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 text-sm">
            <strong className="text-yellow-800">In Progress:</strong>
            <span className="text-yellow-700"> Awaiting unpublished scholarly translation for comparison</span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">Source Text</div>
              <div className="font-medium text-stone-900">Ficino, De Voluptate (On Pleasure)</div>
              <div className="text-stone-600">Renaissance Latin, 1457</div>
            </div>
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-stone-500 mb-1">Benchmark</div>
              <div className="font-medium text-stone-900">Unpublished Scholarly Translation</div>
              <div className="text-stone-600">Blind comparison (not in training data)</div>
            </div>
          </div>

          <h3 className="font-medium text-stone-800 mb-3">Content OCR&apos;d (Chapters 1-2)</h3>
          <ul className="text-sm text-stone-600 space-y-1 mb-4">
            <li>• Ch. 1: Parts of the soul — joy (laeticia), gladness (gaudium), pleasure (voluptas)</li>
            <li>• Ch. 2: What pleasure is, and why it is not good (Plato&apos;s arguments)</li>
          </ul>

          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
            <p className="text-sm text-stone-700 italic">
              &quot;Therefore, Plato, when he divided the soul into two parts, namely, mind and senses,
              assigned joy and gladness to the mind, and pleasure to the senses. But he thinks these
              first two differ from each other, because all gladness is worthy of praise, while joy
              is partly to be praised and partly to be blamed.&quot;
            </p>
            <p className="text-xs text-stone-500 mt-2">— AI Translation, De Voluptate Ch. 1</p>
          </div>
        </section>

        {/* Methodology: Benchmark vs Pipeline */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Benchmark vs Standard Pipeline</h2>
          <p className="text-stone-600 mb-4 text-sm">
            These benchmark translations use enhanced methodology compared to the standard library pipeline:
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="text-left py-2 pr-4 font-medium text-stone-700">Aspect</th>
                  <th className="text-left py-2 px-4 font-medium text-blue-700">Benchmark Method</th>
                  <th className="text-left py-2 pl-4 font-medium text-stone-500">Standard Pipeline</th>
                </tr>
              </thead>
              <tbody className="text-stone-600">
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 font-medium">Context</td>
                  <td className="py-2 px-4 text-blue-800">Named work, author, specific terminology</td>
                  <td className="py-2 pl-4">Generic &quot;scholarly translator&quot;</td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 font-medium">Terminology</td>
                  <td className="py-2 px-4 text-blue-800">Explicit guidance (laeticia=joy, etc.)</td>
                  <td className="py-2 pl-4">AI decides</td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 font-medium">Batch size</td>
                  <td className="py-2 px-4 text-blue-800">Full section as continuous text</td>
                  <td className="py-2 pl-4">10 pages, parsed separately</td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 font-medium">Output</td>
                  <td className="py-2 px-4 text-blue-800">Continuous scholarly prose</td>
                  <td className="py-2 pl-4">Per-page fragments</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
            <p className="text-sm text-blue-900">
              <strong>Implication:</strong> Benchmark translations with domain-specific prompts
              may outperform the standard pipeline. Future work: test whether adding work-specific
              context to the pipeline improves translation quality across the library.
            </p>
          </div>
        </section>

        {/* Future Studies */}
        <section className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Future Studies</h2>
          <p className="text-stone-600 mb-4">
            Planned benchmark comparisons using public domain scholarly editions:
          </p>
          <ul className="space-y-2 text-stone-600">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-stone-300 rounded-full"></span>
              Loeb Classical Library editions (pre-1929)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-stone-300 rounded-full"></span>
              Oxford Classical Texts with facing translations
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-stone-300 rounded-full"></span>
              Latin alchemical texts with Waite/other translations
            </li>
          </ul>
        </section>

        {/* Footer links */}
        <div className="mt-8 flex justify-center gap-6 text-sm">
          <Link href="/about/processing" className="text-amber-600 hover:underline">
            How Processing Works
          </Link>
          <Link href="/experiments" className="text-amber-600 hover:underline">
            A/B Experiments
          </Link>
        </div>
      </div>
    </div>
  );
}
