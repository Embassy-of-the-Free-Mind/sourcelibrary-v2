import { readFileSync } from 'fs';

const d = JSON.parse(readFileSync('_tmp-apple-episodes-raw.json','utf8'));
const eps = d.results.filter(r => r.trackId !== 1295957854);

const types = {};
eps.forEach(e => {
  const t = e.trackName;
  if (t.includes('Storytime')) types['Storytime'] = (types['Storytime']||0)+1;
  else if (t.includes('Oddcast') || t.includes('oddcast')) types['Oddcast'] = (types['Oddcast']||0)+1;
  else if (t.toLowerCase().includes('members')) types['Members'] = (types['Members']||0)+1;
  else types['Regular'] = (types['Regular']||0)+1;
});
console.log('Counts:', types);

console.log('\n--- Oddcasts ---');
eps.filter(e => e.trackName.includes('Oddcast') || e.trackName.includes('oddcast'))
  .forEach(e => console.log(`  ${e.trackName} (${e.releaseDate?.slice(0,10)})`));

console.log('\n--- Storytime ---');
eps.filter(e => e.trackName.includes('Storytime'))
  .forEach(e => console.log(`  ${e.trackName} (${e.releaseDate?.slice(0,10)})`));

// Check our TS data for episode numbers > 200 that aren't storytime
const ts = readFileSync('src/data/shwep-episodes.ts', 'utf8');
const epRe = /\{ number: (\d+), title: ["'](.*?)["'],/g;
let m;
const highEps = [];
while ((m = epRe.exec(ts)) !== null) {
  const num = parseInt(m[1]);
  if (num >= 200) highEps.push({ number: num, title: m[2] });
}

console.log('\n--- Episodes >= 200 in our data ---');
highEps.forEach(e => {
  const type = e.title.includes('Storytime') ? 'STORYTIME' : 'REGULAR';
  console.log(`  ${e.number}: [${type}] ${e.title}`);
});

// Build date map from Apple: title -> date
const dateMap = {};
eps.forEach(e => { dateMap[e.trackName] = e.releaseDate; });
console.log('\n--- Sample dates ---');
for (const e of highEps.slice(0, 10)) {
  // Try to match
  const match = eps.find(a => a.trackName.includes(e.title.slice(0, 30)));
  console.log(`  ${e.number}: ${match ? match.releaseDate?.slice(0,10) : 'NO MATCH'} — ${e.title.slice(0,60)}`);
}
