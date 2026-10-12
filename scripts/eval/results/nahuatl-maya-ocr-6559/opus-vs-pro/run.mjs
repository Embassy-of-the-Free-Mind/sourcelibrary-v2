// Blinded Gemini 3.1 Pro (high) judge: Opus read vs 3.1 Pro-low read, per page, via agy CLI.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const D = process.env.D || '/tmp/es-acq/ocrtest'; const OUT = `${D}/gjudge`;
const pages = JSON.parse(readFileSync(`${D}/pages.json`, 'utf8'));
const key = JSON.parse(readFileSync(`${OUT}/key.json`,'utf8')); const results = [];
for (const p of pages) {
  const opus = existsSync(`${D}/opus-5-5/${p.page}.txt`) ? readFileSync(`${D}/opus-5-5/${p.page}.txt`, 'utf8') : '';
  const pro = existsSync(`${D}/gemini-3.1-pro-low/${p.page}.txt`) ? readFileSync(`${D}/gemini-3.1-pro-low/${p.page}.txt`, 'utf8') : '';
  const flip = key[p.page].X === 'pro-3.1'; const X = flip ? pro : opus; const Y = flip ? opus : pro;
  const ws = `${OUT}/ws-${p.page}`; mkdirSync(ws, { recursive: true }); if (!existsSync(`${ws}/page.jpg`)) copyFileSync(`${D}/gemini-3.8-flash-low/ws-${p.page}/${p.page}.jpg`, `${ws}/page.jpg`);
  const prompt = `You are an expert paleographer judging two OCR transcriptions of the attached historical page image (@./page.jpg). Languages may include Nahuatl, Yucatec Maya, Kaqchikel, Spanish, Latin. Look at the image yourself. Score each transcription 0-5 for FIDELITY to the image (5 essentially exact; 4 minor word errors, no lost lines; 3 several misread words or one dropped line; 2 many errors or several lines lost; 1 mostly wrong; 0 invented). Count per transcription: dropped_lines, invented_lines (text not on the page), misread_words (approximate), normalisations (original spellings or special letters changed toward Spanish/Latin/modern forms). An empty transcription is "failed". Answer with ONLY a JSON object: {"X":{"failed":bool,"score":n,"dropped_lines":n,"invented_lines":n,"misread_words":n,"normalisations":n,"worst_error":"..."},"Y":{...},"better":"X"|"Y"|"tie"}.\n\n=== TRANSCRIPTION X ===\n${X || '(empty)'}\n\n=== TRANSCRIPTION Y ===\n${Y || '(empty)'}\n`;
  const t0 = Date.now();
  let r; for (let a = 0; a < 40; a++) { r = spawnSync('agy', ['-p', prompt, '--model', 'gemini-3.1-pro-high', '--mode', 'plan', '--print-timeout', '240s', '--output-format', 'json'], { cwd: ws, encoding: 'utf8', timeout: 300000, maxBuffer: 20e6, stdio: ['ignore','pipe','pipe'] }); if (!/RESOURCE_EXHAUSTED|quota reached/.test((r.stderr||'')+(r.stdout||''))) break; console.log('quota, waiting 60s'); spawnSync('sleep', ['60']); }
  let text = r.stdout || ''; try { const j = JSON.parse(text); text = j.result ?? j.response ?? j.text ?? text; } catch {}
  const m = String(text).match(/\{[\s\S]*\}/); let parsed = null; try { parsed = m ? JSON.parse(m[0]) : null; } catch {}
  results.push({ stderr: (r.stderr||'').slice(0,300), page_id: p.page, exit: r.status, secs: Math.round((Date.now() - t0) / 1000), parsed, raw: parsed ? undefined : String(text).slice(0, 2000) });
  console.log(p.page, r.status, parsed ? `${parsed.X?.score}/${parsed.Y?.score} better=${parsed.better}` : 'UNPARSED');
  writeFileSync(`${OUT}/judge-gemini.json`, JSON.stringify(results, null, 1));
}
writeFileSync(`${OUT}/done`, 'ALLDONE');
