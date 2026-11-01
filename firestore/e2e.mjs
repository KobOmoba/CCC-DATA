// Phone-size end-to-end test of the Parish Portal against the LOCAL Auth + Firestore
// emulators (project demo-ccc). Never touches the live project.
// Run: npm run test:e2e   (screenshots go to ./screenshots or $SHOTS_DIR)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = process.env.SHOTS_DIR || join(ROOT, 'firestore', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const PROJECT = 'demo-ccc';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const N = 20;

// Tiny static server for index.html / app.js / styles.css.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  let body;
  try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5055, '127.0.0.1');
const APP = 'http://127.0.0.1:5055/?emulator=1';

async function signUp(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await r.json()).localId;
}
async function seedDoc(path, fields) {
  const f = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }]));
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: f }) });
  assert.ok(r.ok, 'seed ' + path);
}

// Uses a preinstalled Chromium if CHROMIUM_PATH is set, else Playwright's own.
// CDN scripts (Tailwind, Firebase SDK) load through HTTPS_PROXY when one is set.
const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('dialog', d => d.accept());
// Serve the CDN files from local npm copies, so the test works offline / behind a strict proxy.
// (firebase 13 compat SDK stands in for 9.22.2; same compat API.)
const NM = join(ROOT, 'firestore', 'node_modules');
await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({ path: join(NM, '@tailwindcss/browser/dist/index.global.js'), contentType: 'text/javascript' }));
await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ path: join(NM, 'firebase', r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', r => {
  const rel = new URL(r.request().url()).pathname.split('/6.4.0/')[1];
  return r.fulfill({ path: join(NM, '@fortawesome/fontawesome-free', rel) });
});
page.on('pageerror', e => console.error('pageerror', e.message));
const shot = (name) => page.screenshot({ path: join(SHOTS, name + '.png') });
const rows = () => page.locator('#membersTable tr').count();

async function login(email) {
  await page.goto(APP);
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', 'Passw0rd!');
  await page.click('#accessBtn');
  await page.waitForSelector('#mainApp:not(.hidden)');
}
async function logout() { await page.evaluate(() => logout()); await page.waitForSelector('#landingPage:not(.hidden)'); }
async function search(term, expected) {
  await page.fill('#memberSearch', term);
  await page.waitForFunction(n => document.querySelectorAll('#membersTable tr').length === n, expected, { timeout: 10000 });
}

try {
  // 1. Seed a super_admin and an HQ user (in the emulator only).
  const superUid = await signUp('super@test.local', 'Passw0rd!');
  await seedDoc(`users/${superUid}`, { role: 'super_admin' });
  const hqUid = await signUp('hq@test.local', 'Passw0rd!');
  await seedDoc(`users/${hqUid}`, { role: 'hq' });

  // 2. Pilot parish admin registers through the app.
  await page.goto(APP);
  await page.click('text=+ Register New Parish');
  await page.fill('#regName', 'TEST Pilot Parish');
  await page.fill('#regEmail', 'pilot@test.local');
  await page.fill('#regPassword', 'Passw0rd!');
  await shot('01-register-pilot');
  await page.click('text=Submit License Request');
  await page.waitForTimeout(1500);

  // 3. Super admin approves the pilot parish.
  await login('super@test.local');
  await page.click('#nav-approvals');
  await page.waitForSelector('#requestsList button');
  await shot('02-super-approvals');
  await page.click('#requestsList button:has-text("Approve")');
  await page.waitForSelector('#requestsList >> text=No pending parish requests.');
  await logout();

  // 4. Pilot admin adds 20 TEST members on a phone-size screen.
  await login('pilot@test.local');
  await page.click('#nav-members');
  for (let i = 1; i <= N; i++) {
    const n = String(i).padStart(2, '0');
    await page.click('text=Register Member');
    await page.fill('#m_name', `TEST Member ${n}`);
    await page.selectOption('#m_gender', i % 2 ? 'Male' : 'Female');
    await page.fill('#m_rank', 'Brother');
    await page.fill('#m_phone', `0803 000 00${n}`);
    await page.fill('#m_joined', '2026-11-01');
    await page.fill('#m_household', `TEST Family ${n}`);
    await page.check('#m_consent');
    if (i === 1) await shot('03-add-member-form');
    await page.click('text=Save Member');
    await page.waitForSelector('#addMemberModal.hidden', { state: 'attached' });
    await page.waitForFunction(n => document.querySelectorAll('#membersTable tr').length >= n, Math.min(i, N));
  }
  assert.equal(await rows(), N, 'first page shows 20');
  await shot('04-members-list-20');

  // 5. Find: by name and by phone (own parish only).
  await search('test member 07', 1);
  await shot('05-search-name');
  await search('0803 000 0013', 1);
  await shot('06-search-phone');

  // 6. Edit member 07: new rank and phone, then find by the new phone.
  await search('TEST Member 07', 1);
  await page.click('#membersTable tr');
  await page.waitForSelector('#addMemberModal:not(.hidden)');
  assert.equal(await page.inputValue('#m_name'), 'TEST Member 07');
  await page.fill('#m_rank', 'Leader');
  await page.fill('#m_phone', '0809 999 9999');
  await shot('07-edit-member');
  await page.click('text=Save Member');
  await page.waitForSelector('#addMemberModal.hidden', { state: 'attached' });
  await page.click('#nav-members');
  await search('08099999999', 1);
  assert.match(await page.locator('#membersTable tr').innerText(), /Leader/);
  await shot('08-after-edit');

  // 7. Dashboard total kept by the summary doc.
  await page.click('#nav-dashboard');
  await page.waitForFunction(() => document.getElementById('metricMembers').textContent === '20');
  await shot('09-parish-dashboard');
  await logout();

  // 8. HQ sees totals, not members (NDPA).
  await login('hq@test.local');
  await page.waitForFunction(() => document.getElementById('metricMembers').textContent === '20');
  assert.ok(await page.locator('#nav-members').isHidden(), 'HQ has no members tab');
  const leak = await page.evaluate(async () => {
    try { await db.collection('parishes').doc(localState.currentParishId).collection('members').limit(1).get(); return 'READ'; }
    catch (e) { return e.code; }
  });
  assert.equal(leak, 'permission-denied', 'HQ blocked from member data');
  await shot('10-hq-totals-only');

  console.log(`E2E PASS: approved pilot, added ${N}, searched by name + phone, edited 1, HQ blocked from members.`);
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('E2E FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
