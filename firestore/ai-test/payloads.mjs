// Turns the 3 test files into exactly what the app sends to the worker, using the app's own readListFile()
// in a phone-size browser (pdf.js / mammoth / SheetJS served from node_modules). Output: payloads/*.json
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOT = new URL('../..', import.meta.url).pathname, HERE = new URL('.', import.meta.url).pathname;
const NM = join(ROOT, 'firestore', 'node_modules');
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  try { const b = readFileSync(join(ROOT, p)); res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript' }[extname(p)] || 'text/plain' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(5056, '127.0.0.1');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route(/^https:\/\/(?!127)/, r => {
  const u = r.request().url();
  const map = { 'cdn.jsdelivr.net/npm/': '' };
  if (u.includes('cdn.jsdelivr.net/npm/')) return r.fulfill({ path: join(NM, u.split('/npm/')[1].replace(/@[\d.]+/, '')), contentType: 'text/javascript' });
  if (u.includes('cdn.tailwindcss.com')) return r.fulfill({ path: join(NM, '@tailwindcss/browser/dist/index.global.js'), contentType: 'text/javascript' });
  if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ path: join(NM, 'firebase', u.split('/').pop()), contentType: 'text/javascript' });
  return r.fulfill({ status: 404, body: '' });
});
await page.goto('http://127.0.0.1:5056/?emulator=1');
await page.waitForFunction(() => typeof readListFile === 'function');
mkdirSync(join(HERE, 'payloads'), { recursive: true });
for (const f of ['members-list.docx', 'members-table.pdf', 'members-photo.jpg']) {
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'tmpf'; document.body.append(i); });
  await page.setInputFiles('#tmpf', join(HERE, f));
  const payload = await page.evaluate(async () => { const f = document.getElementById('tmpf').files[0]; document.getElementById('tmpf').remove(); return readListFile(f); });
  console.log(f, '->', payload.how, payload.text ? payload.text.length + ' chars' : Math.round(payload.file.length / 1024) + ' KB base64');
  delete payload.how;
  writeFileSync(join(HERE, 'payloads', f + '.json'), JSON.stringify(payload));
  if (payload.text) writeFileSync(join(HERE, 'payloads', f + '.txt'), payload.text);
}
await browser.close(); server.close();
