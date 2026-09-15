#!/usr/bin/env node
/**
 * Use Gemini to relabel clusters with better names and assign tradition tags.
 * Reads cluster-results.json, outputs labeled-clusters.json
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'output');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function labelCluster(cid, cluster) {
  const themes = cluster.top_themes?.slice(0, 5).map(t => t.theme) || [];
  const terms = cluster.top_terms?.slice(0, 10).map(t => t.term) || [];
  const langs = cluster.languages?.slice(0, 5).map(l => `${l.lang} (${l.count})`) || [];
  const samples = cluster.sample_books?.slice(0, 8).map(b =>
    `"${b.title}" by ${b.author || '?'} (${b.year || '?'})`
  ) || [];

  const prompt = `You are helping classify a cluster of historical books from a digital rare book library.

CLUSTER DATA:
- ${cluster.size} books
- Median publication year: ${cluster.median_year || '?'}
- Year range: ${cluster.year_range ? cluster.year_range.join(' to ') : '?'}
- Languages: ${langs.join(', ')}
- Top themes: ${themes.join('; ')}
- Top index terms: ${terms.join(', ')}
- Sample titles: ${samples.join('; ')}

TASK: Give this cluster:

1. **name**: A concise, descriptive name (2-5 words). Should describe what these books are ABOUT, not a vague theme. Examples: "Paracelsian Medicine", "Solomonic Grimoires", "Vedic Astronomy", "Chinese Materia Medica", "Neoplatonic Theurgy", "Rosicrucian Manifestos".

2. **description**: One sentence (15-25 words) describing what unifies these books.

3. **tradition_tags**: 1-3 tags from this list (pick the most relevant):
   Western Alchemy, Hermeticism, Kabbalah, Rosicrucianism, Ceremonial Magic, Freemasonry, Mesmerism, Occult Revival,
   Neoplatonism, Pythagoreanism, Theurgy, Stoicism,
   Christian Mysticism, Christian Theology, Patristic Christianity, Eschatology,
   Chinese Medicine, Chinese Divination, Chinese Military Arts, Chinese Philosophy, Chinese Religion,
   Vedic Astrology, Tantra, Hindu Philosophy, Sanskrit Literature,
   Natural Philosophy, Botany, Medicine, Astronomy, Mathematics, Optics, Engineering,
   Classical Philosophy, Philology, Textual Criticism,
   Witchcraft & Demonology, Divination, Astrology,
   Islamic Mysticism, Islamic Philosophy,
   Political Philosophy, Economics,
   Freemasonry, Secret Societies

4. **period_tag**: One of: Ancient, Medieval, Renaissance, Early Modern, Enlightenment, 19th Century, Modern, Mixed

5. **is_single_work**: true if this cluster is really one book/encyclopedia in many volumes, false otherwise.

Respond in JSON only: {"name":"...","description":"...","tradition_tags":["..."],"period_tag":"...","is_single_work":false}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  try {
    return JSON.parse(response.text);
  } catch {
    console.error(`  Failed to parse response for C${cid}:`, response.text?.slice(0, 200));
    return { name: `Cluster ${cid}`, description: '(parse error)', tradition_tags: [], period_tag: 'Mixed', is_single_work: false };
  }
}

async function main() {
  const results = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'cluster-results.json'), 'utf-8'));

  const labeled = {};
  const clusterEntries = Object.entries(results.clusters)
    .filter(([k]) => k !== '-1')
    .sort((a, b) => b[1].size - a[1].size);

  console.log(`Labeling ${clusterEntries.length} clusters with Gemini...\n`);

  for (const [cid, cluster] of clusterEntries) {
    const label = await labelCluster(cid, cluster);
    labeled[cid] = {
      ...label,
      size: cluster.size,
      median_year: cluster.median_year,
      year_range: cluster.year_range,
      languages: cluster.languages?.slice(0, 5),
      sample_books: cluster.sample_books?.slice(0, 5),
    };
    console.log(`  C${cid.padEnd(3)} (${String(cluster.size).padStart(3)} books) → ${label.name}  [${label.tradition_tags?.join(', ')}]`);
  }

  // Also label noise
  const noise = results.clusters['-1'];
  if (noise) {
    labeled['-1'] = {
      name: 'Unclustered',
      description: 'Books spanning multiple traditions that resist single classification.',
      tradition_tags: [],
      period_tag: 'Mixed',
      is_single_work: false,
      size: noise.size,
      median_year: noise.median_year,
      languages: noise.languages?.slice(0, 5),
    };
  }

  const output = {
    total_books: results.total_books,
    n_clusters: results.n_clusters,
    n_noise: results.n_noise,
    clusters: labeled,
  };

  const outPath = path.join(OUTPUT_DIR, 'labeled-clusters.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);

  // Print summary table
  console.log(`\n${'='.repeat(90)}`);
  console.log(`${'Name'.padEnd(35)} ${'Size'.padStart(5)}  ${'Period'.padEnd(14)} Tags`);
  console.log(`${'='.repeat(90)}`);

  const sorted = Object.entries(labeled)
    .filter(([k]) => k !== '-1')
    .sort((a, b) => b[1].size - a[1].size);

  for (const [cid, c] of sorted) {
    const tags = c.tradition_tags?.join(', ') || '';
    console.log(`${c.name.padEnd(35)} ${String(c.size).padStart(5)}  ${(c.period_tag || '?').padEnd(14)} ${tags}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
