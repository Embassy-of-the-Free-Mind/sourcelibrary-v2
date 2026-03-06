// Fetch SHWEP episode descriptions from Apple Podcasts API
const PODCAST_ID = '1295957854';

const resp = await fetch(`https://itunes.apple.com/lookup?id=${PODCAST_ID}&media=podcast&entity=podcastEpisode&limit=300`);
const data = await resp.json();

const episodes = data.results.filter(r => r.trackId !== parseInt(PODCAST_ID));
console.log(`Total episodes from Apple: ${episodes.length}`);

// Extract episode number from title (e.g., "Episode 123: Title")
const descriptions = {};
for (const ep of episodes) {
  const name = ep.trackName || '';
  const desc = ep.shortDescription || ep.description || '';

  // Try to extract episode number from the title or from our episode data
  // SHWEP titles don't always have numbers, so we'll match by title
  if (desc) {
    descriptions[name] = desc.substring(0, 300);
  }
}

// Output as JSON for processing
const output = episodes.map(ep => ({
  title: ep.trackName,
  shortDescription: ep.shortDescription || '',
  description: (ep.description || '').substring(0, 500),
  releaseDate: ep.releaseDate,
}));

// Write to temp file
import { writeFileSync } from 'fs';
writeFileSync('_tmp-apple-episodes.json', JSON.stringify(output, null, 2));
console.log(`Wrote ${output.length} episodes to _tmp-apple-episodes.json`);

// Show a few
for (const ep of output.slice(0, 5)) {
  console.log(`\n--- ${ep.title}`);
  console.log(`  ${ep.shortDescription.substring(0, 150)}`);
}
