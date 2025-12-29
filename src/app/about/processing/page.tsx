import Link from 'next/link';
import { ArrowLeft, FlaskConical, Zap, Link2, CheckCircle2, XCircle } from 'lucide-react';

export const metadata = {
  title: 'How Processing Works | Source Library',
  description: 'Learn how Source Library processes OCR and translation with experiment-validated settings.',
};

export default function ProcessingPage() {
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
            How Processing Works
          </h1>
          <p className="text-stone-600 mt-2">
            Experiment-validated settings for OCR and translation
          </p>
        </div>

        {/* OCR Section */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Zap className="w-5 h-5 text-amber-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">OCR (Optical Character Recognition)</h2>
          </div>

          <p className="text-stone-600 mb-4">
            OCR extracts text from page images using AI vision. Pages are processed in batches of 5,
            with multiple batches running in parallel for speed.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical className="w-4 h-4 text-amber-600" />
              <span className="font-medium text-amber-800">Experiment Finding</span>
            </div>
            <p className="text-amber-900 text-sm">
              <strong>Batch sizes 1, 5, and 10 show no significant quality difference.</strong> Quality only
              degrades at batch size 20 (30-1 loss vs batch 10, p &lt; 0.0001).
            </p>
          </div>

          <h3 className="font-medium text-stone-800 mb-3">Experiment Details</h3>
          <div className="space-y-3 text-sm text-stone-600 mb-6">
            <p>
              We ran an OCR quality experiment on 31 pages from a Latin manuscript, testing 8 conditions:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Batch sizes: 1, 5, 10, 20</li>
              <li>Prompt types: Simple vs Elaborate</li>
            </ul>
            <p>
              An AI judge compared outputs pairwise across all conditions. Results were analyzed using
              ELO ratings and statistical significance testing.
            </p>
          </div>

          <h3 className="font-medium text-stone-800 mb-3">Results</h3>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="text-left py-2 pr-4 font-medium text-stone-700">Comparison</th>
                  <th className="text-center py-2 px-4 font-medium text-stone-700">Winner</th>
                  <th className="text-center py-2 px-4 font-medium text-stone-700">Score</th>
                  <th className="text-center py-2 pl-4 font-medium text-stone-700">Significant?</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 text-stone-600">Batch 1 vs 5</td>
                  <td className="py-2 px-4 text-center text-stone-600">Batch 1</td>
                  <td className="py-2 px-4 text-center font-mono text-stone-600">17-14</td>
                  <td className="py-2 pl-4 text-center">
                    <XCircle className="w-4 h-4 text-stone-400 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 text-stone-600">Batch 5 vs 10</td>
                  <td className="py-2 px-4 text-center text-stone-600">Batch 5</td>
                  <td className="py-2 px-4 text-center font-mono text-stone-600">18-13</td>
                  <td className="py-2 pl-4 text-center">
                    <XCircle className="w-4 h-4 text-stone-400 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b border-stone-100 bg-red-50">
                  <td className="py-2 pr-4 text-stone-800 font-medium">Batch 10 vs 20</td>
                  <td className="py-2 px-4 text-center text-stone-800 font-medium">Batch 10</td>
                  <td className="py-2 px-4 text-center font-mono text-red-600 font-medium">30-1</td>
                  <td className="py-2 pl-4 text-center">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mx-auto" />
                  </td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4 text-stone-600">Simple vs Elaborate prompt</td>
                  <td className="py-2 px-4 text-center text-stone-600">Tie</td>
                  <td className="py-2 px-4 text-center font-mono text-stone-600">17-14</td>
                  <td className="py-2 pl-4 text-center">
                    <XCircle className="w-4 h-4 text-stone-400 mx-auto" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-medium text-stone-800 mb-3">ELO Rankings</h3>
          <div className="space-y-2 mb-6">
            {[
              { label: 'Batch 1 + Simple', elo: 1630 },
              { label: 'Batch 1 + Elaborate', elo: 1601 },
              { label: 'Batch 10 + Simple', elo: 1592 },
              { label: 'Batch 5 + Elaborate', elo: 1571 },
              { label: 'Batch 5 + Simple', elo: 1523 },
            ].map((item, i) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="w-6 h-6 flex items-center justify-center bg-stone-100 rounded text-xs font-medium text-stone-600">
                  {i + 1}
                </span>
                <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full"
                    style={{ width: `${((item.elo - 1400) / 300) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-stone-600 w-40">{item.label}</span>
                <span className="text-sm font-mono text-stone-500 w-12">{item.elo}</span>
              </div>
            ))}
          </div>

          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
            <p className="text-sm text-stone-700">
              <strong>Recommendation:</strong> Use 10 parallel batches for maximum speed. Quality is
              statistically equivalent to sequential processing (batch 1). Only batch 20 shows degradation.
            </p>
          </div>
        </section>

        {/* Translation Section */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">Translation</h2>
          </div>

          <p className="text-stone-600 mb-4">
            Translation converts OCR text to English. Unlike OCR, translation benefits from context
            because it needs to maintain:
          </p>

          <ul className="list-disc list-inside space-y-1 text-stone-600 mb-6 ml-2">
            <li>Consistent terminology across pages</li>
            <li>Sentence continuity at page breaks</li>
            <li>Proper handling of incomplete thoughts</li>
          </ul>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-4 h-4 text-blue-600" />
              <span className="font-medium text-blue-800">Context Chain</span>
            </div>
            <p className="text-blue-900 text-sm">
              Pages are processed sequentially in batches of 5. After each batch, the last page&apos;s
              translation is passed as context to the next batch, creating continuity.
            </p>
          </div>

          <div className="font-mono text-xs bg-stone-800 text-stone-300 rounded-lg p-4 overflow-x-auto">
            <div className="space-y-1">
              <div><span className="text-amber-400">Batch 1</span> (pages 1-5) → translate → <span className="text-green-400">page 5 translation</span></div>
              <div className="text-stone-500">↓ context passed</div>
              <div><span className="text-amber-400">Batch 2</span> (pages 6-10) + context → translate → <span className="text-green-400">page 10 translation</span></div>
              <div className="text-stone-500">↓ context passed</div>
              <div><span className="text-amber-400">Batch 3</span> (pages 11-15) + context → translate → ...</div>
            </div>
          </div>
        </section>

        {/* Why These Settings */}
        <section className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="text-xl font-semibold text-stone-900 mb-4">Why Different Settings?</h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-amber-50 rounded-lg p-4">
              <h3 className="font-medium text-amber-800 mb-2">OCR: Parallel OK</h3>
              <p className="text-sm text-amber-900">
                OCR is image-based. Each page is processed independently using visual recognition.
                Context from previous pages doesn&apos;t significantly improve accuracy.
              </p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <h3 className="font-medium text-blue-800 mb-2">Translation: Sequential Required</h3>
              <p className="text-sm text-blue-900">
                Translation is text-based. The AI needs context from previous pages to maintain
                consistency in terminology, style, and handling of cross-page sentences.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-stone-500">
          <p>
            Experiment conducted on{' '}
            <Link href="/book/694bf8d2343422769f237558" className="text-amber-600 hover:underline">
              a Latin manuscript
            </Link>{' '}
            using AI-assisted judging.
          </p>
        </div>
      </div>
    </div>
  );
}
