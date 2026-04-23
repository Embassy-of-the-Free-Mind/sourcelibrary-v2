/**
 * QA-Eval Report Generator
 *
 * Outputs evaluation results as JSON and markdown blog posts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '..', 'results');

// ── Save / load results ────────────────────────────────────────────

export function saveResults(name, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${name}-${date}.json`;
  const filepath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Results saved: ${filepath}`);
  return filepath;
}

export function loadLatestResults(prefix) {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[0]), 'utf8'));
}

export function listResults() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
}

// ── Markdown report generation ─────────────────────────────────────

export function generateConsistencyReport(results) {
  const { corpus, pages, summary, meta } = results;
  const comboData = summary.byCombo || summary.byModel || {};
  const lines = [];

  lines.push(`# OCR Consistency Report: ${corpus}`);
  lines.push(`*Generated ${meta.date} — ${meta.totalCalls} API calls, $${meta.totalCostUsd.toFixed(3)} USD*\n`);
  lines.push('---\n');

  // Summary table
  lines.push('## Summary\n');
  lines.push('| Model | Temp | MCR | Avg Char Similarity | Avg Syllable Similarity | Pages |');
  lines.push('|-------|------|-----|--------------------|-----------------------|-------|');
  for (const [key, stats] of Object.entries(comboData)) {
    const temp = stats.temp ?? '0';
    const label = stats.model || key;
    lines.push(`| ${label} | ${temp} | ${(stats.avgMcr * 100).toFixed(1)}% | ${(stats.avgCharSim * 100).toFixed(1)}% | ${(stats.avgSylSim * 100).toFixed(1)}% | ${stats.pages} |`);
  }
  lines.push('');

  // Cross-model agreement
  if (summary.crossModel && summary.crossModel.length > 0) {
    lines.push('## Cross-Model Agreement\n');
    lines.push('| Model A | Model B | Char Similarity | Syllable Similarity |');
    lines.push('|---------|---------|----------------|-------------------|');
    for (const cm of summary.crossModel) {
      lines.push(`| ${cm.modelA} | ${cm.modelB} | ${(cm.charSimilarity * 100).toFixed(1)}% | ${(cm.syllableSimilarity * 100).toFixed(1)}% |`);
    }
    lines.push('');
  }

  // Output length analysis (hallucination signal)
  const comboLengths = {};
  for (const page of pages) {
    for (const [key, result] of Object.entries(page.results)) {
      if (!comboLengths[key]) comboLengths[key] = [];
      const validLengths = result.outputLengths.filter(l => l > 0);
      if (validLengths.length > 0) comboLengths[key].push(...validLengths);
    }
  }
  const allKeys = Object.keys(comboLengths);
  if (allKeys.length > 1) {
    lines.push('## Output Length Analysis\n');
    lines.push('Large length disparities between models suggest hallucination (the longer model may be generating text not on the page).\n');
    lines.push('| Model | Temp | Avg Chars | Min | Max | Length Ratio |');
    lines.push('|-------|------|----------|-----|-----|-------------|');
    const avgLengths = {};
    for (const [key, lengths] of Object.entries(comboLengths)) {
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      avgLengths[key] = avg;
    }
    const minAvg = Math.min(...Object.values(avgLengths));
    for (const [key, stats] of Object.entries(comboData)) {
      const lengths = comboLengths[key] || [];
      const avg = avgLengths[key] || 0;
      const min = Math.min(...lengths);
      const max = Math.max(...lengths);
      const ratio = minAvg > 0 ? (avg / minAvg).toFixed(1) + 'x' : '—';
      const temp = stats.temp ?? '0';
      const label = stats.model || key;
      lines.push(`| ${label} | ${temp} | ${Math.round(avg)} | ${min} | ${max} | ${ratio} |`);
    }
    lines.push('');
  }

  // Per-page details
  lines.push('## Per-Page Results\n');
  for (const page of pages) {
    lines.push(`### ${page.bookTitle} — Page ${page.pageNumber}\n`);
    for (const [model, result] of Object.entries(page.results)) {
      const m = result.mcr;
      lines.push(`**${model}**: MCR ${(m.rate * 100).toFixed(0)}% (${m.modeCount}/${m.totalRuns} identical), ${m.uniqueOutputs} unique outputs, avg ${Math.round(result.outputLengths.filter(l => l > 0).reduce((a, b) => a + b, 0) / Math.max(1, result.outputLengths.filter(l => l > 0).length))} chars`);
      if (result.pairwise) {
        lines.push(`  Pairwise: char=${(result.pairwise.avgCharSimilarity * 100).toFixed(1)}% syl=${(result.pairwise.avgSyllableSimilarity * 100).toFixed(1)}%`);
      }
    }
    lines.push('');
  }

  // Cost breakdown
  lines.push('## Cost Breakdown\n');
  lines.push(`- Total API calls: ${meta.totalCalls}`);
  lines.push(`- Total cost: $${meta.totalCostUsd.toFixed(4)} USD`);
  lines.push(`- Duration: ${(meta.totalDurationMs / 1000).toFixed(1)}s`);
  for (const [model, cost] of Object.entries(meta.costByModel)) {
    lines.push(`- ${model}: $${cost.toFixed(4)}`);
  }
  lines.push('');

  return lines.join('\n');
}

export function generateEmbeddingReport(results) {
  const { corpus, pages, summary, meta } = results;
  const lines = [];

  lines.push(`# Embedding-Space Evaluation: ${corpus}`);
  lines.push(`*Generated ${meta.date}*\n`);
  lines.push('---\n');

  // Summary
  lines.push('## Summary\n');
  lines.push(`- Pages evaluated: ${pages.length}`);
  lines.push(`- Embedding model: ${meta.embeddingModel}`);
  lines.push(`- Mean OCR→Translation distance: ${summary.meanOcrToTranslation.toFixed(4)}`);
  lines.push(`- Std dev: ${summary.stdOcrToTranslation.toFixed(4)}`);
  if (summary.meanOcrToHuman !== undefined) {
    lines.push(`- Mean OCR→Human distance: ${summary.meanOcrToHuman.toFixed(4)}`);
    lines.push(`- Mean AI→Human distance: ${summary.meanAiToHuman.toFixed(4)}`);
  }
  lines.push('');

  // Flagged pages (potential hallucination)
  if (summary.flagged && summary.flagged.length > 0) {
    lines.push('## Flagged Pages (Potential Hallucination)\n');
    lines.push('Pages where OCR→Translation embedding distance exceeds 2σ from mean:\n');
    for (const f of summary.flagged) {
      lines.push(`- **${f.bookTitle} p${f.pageNumber}**: distance ${f.distance.toFixed(4)} (${f.sigmas.toFixed(1)}σ)`);
    }
    lines.push('');
  }

  // Per-page table
  lines.push('## Per-Page Distances\n');
  lines.push('| Book | Page | OCR→AI Trans | OCR→Human | AI→Human | Flag |');
  lines.push('|------|------|-------------|-----------|----------|------|');
  for (const p of pages) {
    const flag = p.flagged ? 'yes' : '';
    const ocrToHuman = p.distances.ocrToHuman?.toFixed(3) || '—';
    const aiToHuman = p.distances.aiToHuman?.toFixed(3) || '—';
    lines.push(`| ${p.bookTitle.slice(0, 30)} | ${p.pageNumber} | ${p.distances.ocrToAiTranslation.toFixed(3)} | ${ocrToHuman} | ${aiToHuman} | ${flag} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export function generateMatrixReport(results) {
  const { corpora, meta } = results;
  const lines = [];

  lines.push('# Script/Language Benchmarking Matrix');
  lines.push(`*Generated ${meta.date}*\n`);
  lines.push('---\n');

  lines.push('| Script | Corpus | MCR (best) | Cross-Model | Embedding Div | Readiness |');
  lines.push('|--------|--------|-----------|-------------|---------------|-----------|');
  for (const c of corpora) {
    lines.push(`| ${c.script} | ${c.label} | ${(c.bestMcr * 100).toFixed(0)}% | ${(c.crossModelAgreement * 100).toFixed(0)}% | ${c.embeddingDivergence?.toFixed(3) || '—'} | **${c.readiness}** |`);
  }
  lines.push('');

  // Readiness legend
  lines.push('### Readiness Criteria\n');
  lines.push('- **high**: MCR ≥ 90% AND cross-model ≥ 85%');
  lines.push('- **medium**: MCR ≥ 70% AND cross-model ≥ 70%');
  lines.push('- **low**: below medium thresholds');
  lines.push('');

  return lines.join('\n');
}

export function saveBlogPost(corpus, markdown) {
  const date = new Date().toISOString().slice(0, 10);
  const docsDir = path.resolve(__dirname, '..', '..', '..', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const filepath = path.join(docsDir, `qa-eval-${corpus}-${date}.md`);
  fs.writeFileSync(filepath, markdown);
  console.log(`Blog post saved: ${filepath}`);
  return filepath;
}
