// Sends payloads/*.json to the AI worker and saves results/<label>/*.json.
// node send.mjs <worker URL | local> <label>   (deployed: needs env ACCURACY_TEST_KEY; local: runs ../../ai-worker/worker.js
// in-process with env GEMINI_API_KEY, same code as deployed)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
const [target, label] = process.argv.slice(2);
const HERE = new URL('.', import.meta.url).pathname;
mkdirSync(`${HERE}results/${label}`, { recursive: true });
const worker = target === 'local' ? (await import('../../ai-worker/worker.js')).default : null;
for (const f of readdirSync(`${HERE}payloads`).filter(n => n.endsWith('.json'))) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Key': process.env.ACCURACY_TEST_KEY || 'x' }, body: readFileSync(`${HERE}payloads/${f}`) };
  const t = Date.now();
  const r = worker ? await worker.fetch(new Request('https://local/extract', init), { GEMINI_API_KEY: process.env.GEMINI_API_KEY, ACCURACY_TEST_KEY: 'x' })
    : await fetch(target, init);
  const d = await r.json();
  console.log(f, r.status, d.engine || d.error, (d.people || []).length, 'people', ((Date.now() - t) / 1000).toFixed(1) + 's');
  writeFileSync(`${HERE}results/${label}/${f}`, JSON.stringify(d, null, 1));
}
