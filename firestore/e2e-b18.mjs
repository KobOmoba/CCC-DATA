// Batch 18: onboarding checklist + bulk member import (paste WhatsApp, CSV), end-to-end test (phone size 390x844)
// against the LOCAL Auth + Firestore emulators (project demo-ccc). Never touches the live project.
// Run: npm run test:e2e:b18
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
const PASS = 'Passw0rd!';

// Tiny static server for index.html / app.js / styles.css.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer((req, res) => {
  let path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  // Mirror vercel.json: /join -> /join/index.html
  if (path === '/join') path = '/join/index.html';
  let body;
  try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5069, '127.0.0.1');
const APP = 'http://127.0.0.1:5069/?emulator=1';

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

const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
// Dialogs: remember every message; answer prompts with promptAnswer.
const dialogs = [];
let promptAnswer = '';
page.on('dialog', d => { dialogs.push(d.message()); return d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept(); });
const NM = join(ROOT, 'firestore', 'node_modules');
await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({ path: join(NM, '@tailwindcss/browser/dist/index.global.js'), contentType: 'text/javascript' }));
await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ path: join(NM, 'firebase', r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', r => {
  const rel = new URL(r.request().url()).pathname.split('/6.4.0/')[1];
  return r.fulfill({ path: join(NM, '@fortawesome/fontawesome-free', rel) });
});
await page.route('https://cdn.jsdelivr.net/npm/**', r => r.fulfill({ path: join(NM, r.request().url().split('/npm/')[1].replace(/@[\d.]+/, '')), contentType: 'text/javascript' }));

const pageErrors = [];
page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text().slice(0, 600)); });
page.on('pageerror', e => { pageErrors.push(e.message); console.error('pageerror', e.message); });
const shot = (name) => page.screenshot({ path: join(SHOTS, name + '.png') });
const fullShot = (name) => page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true });

// A real, large picture to upload: a PNG screenshot drawn with a coloured canvas.
async function makeImage(label, color) {
  return page.evaluate(([label, color]) => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1500;
    const x = c.getContext('2d');
    for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${(i * 37) % 360},70%,${30 + (i % 50)}%)`; x.fillRect(Math.random() * 1200, Math.random() * 1500, 30, 30); }
    x.fillStyle = color; x.beginPath(); x.arc(600, 600, 380, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 160px sans-serif'; x.textAlign = 'center'; x.fillText(label, 600, 660);
    return c.toDataURL('image/png').split(',')[1];
  }, [label, color]).then(b64 => ({ name: label + '.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }));
}

async function login(email) {
  await page.goto(APP);
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', PASS);
  await page.click('#accessBtn');
  await page.waitForSelector('#mainApp:not(.hidden)');
}
async function logout() { await page.evaluate(() => logout()); await page.waitForSelector('#landingPage:not(.hidden)'); }
// Phase 10: optional parish extras sit in a collapsed <details>; tests open it to fill them.
const nav = async (id) => { await page.click('#nav-' + id); if (id === 'parishes' || id === 'settings') await page.evaluate(() => document.querySelectorAll('#np_extras, #s_extras').forEach(d => d.open = true)); };
const modalClosed = (id) => page.waitForSelector(`#${id}.hidden`, { state: 'attached', timeout: 15000 });

const noFail = (d0, re = /Not saved|not saved|failed|Not confirmed|Could not/) => assert.ok(!dialogs.slice(d0).some(m => re.test(m)), 'no failure dialog: ' + dialogs.slice(d0).join(' | '));
async function createParish(name, city, country, continent, cur, pl, cl, email) {
  await nav('parishes');
  await page.fill('#np_name', name); await page.evaluate(a => setLocationFields('np_', ...a), [country, '', city]);
  await page.selectOption('#np_continent', continent); await page.selectOption('#np_currency', cur);
  await page.fill('#np_pletters', pl); await page.fill('#np_cletters', cl); await page.fill('#np_email', email);
  await page.evaluate(() => { const r = document.getElementById('inviteResult'); r.innerHTML = ''; });
  await page.click('#createParishBtn');
  await page.waitForSelector('#inviteCode');
  return (await page.textContent('#inviteCode')).trim();
}
async function claim(email, code) {
  await page.click('#inviteToggle');
  await page.fill('#invEmail', email); await page.fill('#invCode', code); await page.fill('#invPassword', PASS);
  await page.click('#claimBtn');
  await page.waitForSelector('#mainApp:not(.hidden)');
}
async function claimFresh(email, code) { await page.goto(APP); await claim(email, code); }

// Local calendar date n days from today, plus its day + month.
const dayPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, day: d.getDate(), month: d.getMonth() + 1 }; };
const T0 = dayPlus(0), T2 = dayPlus(2), T3 = dayPlus(3), T40 = dayPlus(40);
async function addPerson(kind, p) {
  await page.evaluate(async ([kind, p]) => {
    openPersonForm(kind);
    $('p_name').value = p.name; $('p_gender').value = p.gender; fillRanks(''); $('p_marital').value = 'Married';
    $('p_address').value = 'SECRET ADDRESS 1'; $('p_phone').value = p.phone || ''; $('p_email').value = p.email || '';
    $('p_dobDay').value = String(p.dob.day); $('p_dobMonth').value = String(p.dob.month); $('p_dobYear').value = '1980';
    if (p.wed) { $('p_wedDay').value = String(p.wed.day); $('p_wedMonth').value = String(p.wed.month); }
    if (p.anYear) { $('p_anDay').value = '1'; $('p_anMonth').value = '1'; $('p_anYear').value = String(p.anYear); }
    if (p.short) { $('p_rankShort').value = p.short; rankShortInput(); }
    $('p_nokName').value = 'SECRET KIN'; $('p_consent').checked = true;
    await savePerson();
  }, [kind, p]);
}

// Typed seed (owner token bypasses rules): an OLD record made before women were blocked from clergy.
const fsVal = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) }
  : typeof v === 'number' ? { doubleValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(fsVal) } }
  : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } } : { nullValue: null };
async function seedTyped(path, obj) {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsVal(v)])) }) });
  assert.ok(r.ok, 'seed ' + path + ' ' + await r.text());
}
async function readDoc(path) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return r.ok ? (await r.json()).fields : null;
}

// Three WhatsApp-style forms (FAKE people), copied as one paste with WhatsApp timestamps between them.
const PASTE = `[04/11/2026, 09:12] Tunde Fake: Name: Adebola Testperson
Gender Female
Marital Status: Married
Address: 4 Fake Close, Ijaye
Phone number: 0801 000 0001
Church Rank: M/C
Occupation: Trader
Date of birth: 15 April
Last Anointment date: 2005
Next of kin name: Kunle Testperson
Address: 4 Fake Close, Ijaye
Phone number: 08010000002
[04/11/2026, 09:14] Tunde Fake: Name: Chidi Sampleman
Gender: Male
Marital Status: Single
Address: 9 Demo Street
Phone number: 08010000003
Church Rank: E/B
Occupation: Driver
Date of birth: 2nd March 1990
Next of kin name: Ngozi Sampleman
Address: 9 Demo Street
Phone number: 08010000004
[04/11/2026, 09:20] Tunde Fake: Name: Funmi Placeholder
Gender: F
Address: 1 Mock Road
Phone number: 08010000005
Church Rank: Sister
Date of birth: 7 July
Next of kin name: Yemi Placeholder
Phone number: 08010000006`;

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const code = await createParish('TEST Ijaye Parish', 'Lagos', 'Nigeria', 'Africa', 'NGN', 'IJY', 'LAG', 'ijaye@test.local');
  await logout();

  // ---- 1. A brand-new parish admin sees "Get started" at the top: 0 of 6.
  await claimFresh('ijaye@test.local', code);
  await page.waitForSelector('#onboardCard:not(.hidden)');
  assert.equal(await page.locator('.ob-step').count(), 6);
  assert.equal(await page.locator('.ob-step.ob-done').count(), 0);
  const above = await page.evaluate(() => document.getElementById('onboardCard').getBoundingClientRect().top < document.getElementById('welcomeTitle').getBoundingClientRect().top);
  assert.ok(above, 'card at the top of the dashboard');
  await shot('b18-01-get-started');

  // ---- 2. Local parsers (no AI): birthday as day + month, rank short form, CSV with quotes + BOM.
  const unit = await page.evaluate(() => ({
    dm: parseDayMonth('15 April'), dm2: parseDayMonth('April 15th 1980'), yr: parseDayMonth('2005'),
    csv: parseCsv('﻿Name,Gender,Marital Status,Phone,Church Rank,Date of birth\r\n"Test, Person",Male,Single,0801,E/B,1 May\r\n')
  }));
  assert.deepEqual(unit.dm, { day: 15, month: 4, year: null });
  assert.deepEqual(unit.dm2, { day: 15, month: 4, year: 1980 });
  assert.deepEqual(unit.yr, { day: null, month: null, year: 2005 });
  assert.equal(unit.csv.length, 1); assert.equal(unit.csv[0].fullName, 'Test, Person'); assert.equal(unit.csv[0].rank, 'Elder Brother');

  // ---- 3. Import members from the checklist: paste 3 WhatsApp forms.
  await page.click('.ob-step[data-step="members"] .ob-btn');
  await page.waitForSelector('#importModal:not(.hidden)');
  // Stop the optional AI helper from ever being called in this test.
  await page.route('https://ccc-ai.aarinat-company-limited.workers.dev/**', r => r.abort());
  await page.fill('#imp_text', PASTE);
  await page.click('#imp_parseBtn');
  await page.waitForSelector('.imp-row');
  assert.equal(await page.locator('.imp-row').count(), 3);
  const rows = await page.evaluate(() => imp.rows.map(r => ({ n: r.fullName, g: r.gender, m: r.maritalStatus, rank: r.rank, d: r.dobDay, mo: r.dobMonth, y: r.dobYear,
    ay: r.anointYear, ph: r.phone, kn: r.nokName, ka: r.nokAddress, kp: r.nokPhone, pr: Object.keys(r.problems) })));
  assert.deepEqual(rows[0], { n: 'Adebola Testperson', g: 'Female', m: 'Married', rank: 'Mother Celestial', d: 15, mo: 4, y: null, ay: 2005, ph: '08010000001',
    kn: 'Kunle Testperson', ka: '4 Fake Close, Ijaye', kp: '08010000002', pr: [] });
  assert.equal(rows[1].rank, 'Elder Brother'); assert.equal(rows[1].y, 1990); assert.equal(rows[1].kp, '08010000004');
  assert.deepEqual(rows[2].pr, ['maritalStatus'], 'row 3 has no marital status');
  assert.equal(await page.locator('.imp-row').nth(2).locator('.imp-bad').count(), 1, 'problem highlighted');
  await page.evaluate(() => document.querySelector('.imp-bad').scrollIntoView({ inline: 'center', block: 'center' }));
  await shot('b18-02-import-preview');

  // Saving with a problem left: that row is held back, the others save (resumable).
  await page.check('#imp_consent');
  let d0 = dialogs.length;
  await page.click('#imp_saveBtn');
  await page.waitForFunction(() => /Saved 2 members/.test(document.getElementById('imp_status').textContent));
  assert.equal(await page.locator('.imp-saved').count(), 2);
  // Fix the red cell, Save all again: only the remaining row is saved.
  await page.locator('.imp-row').nth(2).locator('select[data-k="maritalStatus"]').selectOption('Single');
  await page.click('#imp_saveBtn');
  await page.waitForFunction(() => /Saved 1 member\./.test(document.getElementById('imp_status').textContent));
  noFail(d0);
  const nos = await page.evaluate(() => imp.rows.map(r => r.saved));
  assert.deepEqual(nos, ['CCC-IJY-LAG-MBR-001', 'CCC-IJY-LAG-MBR-002', 'CCC-IJY-LAG-MBR-003']);
  const m1 = await readDoc(`parishes/${await page.evaluate(() => localState.currentParishId)}/members/CCC-IJY-LAG-MBR-001`);
  const pid = await page.evaluate(() => localState.currentParishId);
  assert.equal(m1.rank.stringValue, 'Mother Celestial'); assert.equal(m1.dobDay.integerValue, '15'); assert.equal(m1.dobMonth.integerValue, '4');
  assert.equal(m1.status.stringValue, 'Active');
  assert.equal((await readDoc(`parishes/${pid}/importLog/CCC-IJY-LAG-MBR-001`)).source.stringValue, 'whatsapp');
  assert.equal((await readDoc(`auditLog/parishes_${pid}_importLog_CCC-IJY-LAG-MBR-003_v1`)).action.stringValue, 'import-member');
  assert.equal((await readDoc(`parishStats/${pid}`)).memberCount.integerValue, '3');

  // ---- 4. Passport photo afterwards: tap the imported member, pick a picture; it is compressed like a normal upload.
  await page.waitForSelector('.imp-photo');
  await page.locator('.imp-photo').first().locator('input[type=file]').setInputFiles(await makeImage('A', '#1e3a8a'));
  await page.waitForFunction(() => imp.rows[0].hasPhoto === true);
  const ph = await readDoc(`parishes/${pid}/members/CCC-IJY-LAG-MBR-001`);
  assert.ok(ph.photo.stringValue.startsWith('data:image/jpeg') && ph.photo.stringValue.length < 110000, 'compressed photo saved');
  assert.equal((await readDoc(`auditLog/parishes_${pid}_importLog_CCC-IJY-LAG-MBR-001_v2`)).action.stringValue, 'import-photo');

  // ---- 5. Pasting the same person again is flagged as a duplicate and not saved unless ticked.
  await page.click('text=Start over');
  await page.fill('#imp_text', PASTE.split('[04/11/2026, 09:14]')[0]);
  await page.click('#imp_parseBtn');
  await page.waitForSelector('.imp-dup');
  await page.click('#imp_saveBtn');
  await page.waitForFunction(() => /Saved 0 members/.test(document.getElementById('imp_status').textContent));
  assert.equal((await readDoc(`parishStats/${pid}`)).memberCount.integerValue, '3', 'duplicate not saved');
  await page.click('text=Start over');
  await page.click('#importModal button[aria-label="Close"]');

  // ---- 6. Members step ticks itself; Hide works; Settings brings the card back.
  await page.waitForFunction(() => !!document.querySelector('.ob-step[data-step="members"].ob-done'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('b18-03-get-started-progress');
  await page.click('#onboardCard >> text=Hide');
  await page.waitForSelector('#onboardCard.hidden', { state: 'attached' });
  await nav('settings');
  await page.click('#showOnboardBtn');
  await page.waitForSelector('#onboardCard:not(.hidden)');
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 18 PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'b18-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
