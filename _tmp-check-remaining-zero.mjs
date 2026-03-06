import { readFileSync } from 'fs';

const epTs = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const citedTs = readFileSync('src/data/shwep-cited-works.ts', 'utf8');

// Parse all episode numbers and tags
const episodes = [];
for (const m of epTs.matchAll(/\{ number: (\d+), title: "(.*?)",.*?tags: \[(.*?)\]/gs)) {
  const n = parseInt(m[1]);
  const title = m[2];
  const tags = m[3].trim() ? m[3].split(',').map(t => t.trim().replace(/^'|'$/g, '')) : [];
  episodes.push({ n, title, tags });
}

// Parse cited works
const epWorks = {};
for (const line of citedTs.split('\n')) {
  const m = line.match(/^\s+(\d+): \[(.*)\],$/);
  if (!m) continue;
  const n = parseInt(m[1]);
  const works = m[2].match(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)?.map(w => w.slice(1, -1)) || [];
  epWorks[n] = works;
}

// Find episodes with no tags AND no cited works
const zero = episodes.filter(ep => ep.tags.length === 0 && !(epWorks[ep.n]?.length > 0));
console.log(`Episodes with NO tags AND NO cited works: ${zero.length}`);
for (const ep of zero) {
  console.log(`  #${ep.n}: ${ep.title}`);
}

console.log();

// Find episodes with cited works but no tags
const hasWorksNoTags = episodes.filter(ep => ep.tags.length === 0 && (epWorks[ep.n]?.length > 0));
console.log(`Episodes with cited works but no tags: ${hasWorksNoTags.length}`);
for (const ep of hasWorksNoTags) {
  const works = epWorks[ep.n];
  console.log(`  #${ep.n}: ${ep.title} — ${works.length} cited works: ${works.slice(0, 3).join(', ')}${works.length > 3 ? '...' : ''}`);
}
