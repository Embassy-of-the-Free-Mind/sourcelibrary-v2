// PRIOR ART: scripts/eval/experiments/*cli* name these files one by one; nothing lists every stored CLI arm in one place.
/**
 * Every stored Gemini-CLI (`agy -p`) output this rescue covers (#6523), with where the raw reply lives and, for the
 * translation arms, the copy the judges actually read (the rejudge test compares the rescue to THAT, not to the raw).
 * kind: 'ocr' | 'translation' | 'qa' (a second-reader verdict, JSON).
 * Paths outside the repo are the boxes' job folders on this Hetzner volume; they are read, never written.
 */
const J = '/mnt/HC_Volume_105839809/jobs';
const R = 'scripts/eval/results';

const pareto = (engine, model) => ({
  id: `pareto-6293:${engine}`, issue: 6293, kind: 'ocr', model, path: `${R}/ocr-pareto-6293/outputs-${engine}.jsonl`,
  key: (r) => `${r.stratum}|${r.slug}`, text: (r) => r.text,
});

export const ARMS = [
  // OCR Pareto (#6293): every Gemini CLI tier. 6523c's rescore-extract.mjs already re-scored these with the same extractor.
  pareto('gemini-3.6-flash+antigravity-cli', 'gemini-3.6-flash-low'),
  pareto('gemini-3.7-flash+antigravity-cli', 'gemini-3.7-flash-low'),
  pareto('gemini-3.8-flash+antigravity-cli', 'gemini-3.8-flash-low'),
  pareto('gemini-3.8-flash+antigravity-cli-rep', 'gemini-3.8-flash-low'),
  pareto('gemini-3.8-flash-high+antigravity-cli', 'gemini-3.8-flash-high'),
  // Syriac print (#6295): OCR and translation, 3.6/3.7/3.8 low. `judged` = the stripped copy that was scored/judged.
  ...['C36-ocr', 'C36-ocr-b', 'C37-ocr', 'C37-ocr-b', 'C38-ocr', 'C38-ocr-b'].map((a) => ({
    id: `syriac-6295:${a}`, issue: 6295, kind: 'ocr', model: `gemini-3.${a[2]}-flash-low`,
    path: `${J}/syriac-pareto-6295/arms/${a}.jsonl`, judged: `${J}/syriac-pareto-6295/cli-results/${a}.clean.jsonl`,
    key: (r) => r.uid, text: (r) => r.text,
  })),
  ...['T-C36-K', 'T-C36-R', 'T-C37-K', 'T-C37-R', 'T-C38-K', 'T-C38-R'].map((a) => ({
    id: `syriac-6295:${a}`, issue: 6295, kind: 'translation', model: `gemini-3.${a[4]}-flash-low`,
    path: `${J}/syriac-pareto-6295/arms/${a}.jsonl`, judged: `${J}/syriac-pareto-6295/cli-results/${a}.clean.jsonl`,
    key: (r) => r.uid, text: (r) => r.text,
  })),
  // Latin CLI pilot (#6375): 3.7 low OCR on 299 pages.
  { id: 'latin-pilot-6375:C37-ocr', issue: 6375, kind: 'ocr', model: 'gemini-3.7-flash-low', path: `${J}/latin-cli-pilot-6375/work/cli.jsonl`, key: (r) => r.uid, text: (r) => r.text },
  // OCR preregistered routing (#6388): arm G is 3.8 low through agy.
  { id: 'ocr-prereg-6388:G', issue: 6388, kind: 'ocr', model: 'gemini-3.8-flash-low', path: 'scripts/eval/ocr-prereg-6388/reads/G.jsonl.gz', key: (r) => r.uid, text: (r) => r.text },
  // Tengyur C38 (#6182): first 58 ref sides, then the 113 ref sides + 365 xl pages (#6331) in one file.
  { id: 'tengyur-6182:C38-ref58', issue: 6182, kind: 'translation', model: 'gemini-3.8-flash-low', path: '/root/tlev/arms/C38-ref.jsonl', key: (r) => r.page_id, text: (r) => r.text },
  { id: 'cli38-6182-6331:C38-full', issue: 6331, kind: 'translation', model: 'gemini-3.8-flash-low', path: '/root/cli38-6182/C38-full.jsonl', key: (r) => r.uid, text: (r) => r.text },
  // Second reader (#6338): page/book QA verdicts in JSON, three CLI arms.
  ...['f38h', 'f38l', 'pro'].flatMap((m) => ['page', 'book', 'book4'].map((s) => ({
    id: `second-reader-6338:${m}-${s}`, issue: 6338, kind: 'qa',
    model: { f38h: 'gemini-3.8-flash-high', f38l: 'gemini-3.8-flash-low', pro: 'gemini-3.1-pro-high' }[m],
    path: `${R}/spot-check/second-reader-pilot-6338/raw/${m}-${s}.jsonl`, key: (r) => r.uid, text: (r) => r.text,
  }))),
];
