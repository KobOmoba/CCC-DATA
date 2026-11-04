// Batch 14 (Letter of Introduction + HQ 1/3 base) phone-size end-to-end test against the LOCAL Auth + Firestore
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
}).listen(5064, '127.0.0.1');
const APP = 'http://127.0.0.1:5064/?emulator=1';

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
    $('p_nokName').value = 'SECRET KIN'; $('p_consent').checked = true;
    await savePerson();
  }, [kind, p]);
}

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const codeA = await createParish('TEST Ikeja Parish', 'Ikeja', 'Nigeria', 'Africa', 'NGN', 'TIP', 'IKJ', 'ikeja@test.local');
  await logout();
  await claimFresh('ikeja@test.local', codeA);
  let d0 = dialogs.length;
  await addPerson('members', { name: 'Adaeze Okafor', gender: 'Female', phone: '08030000001', dob: T40 });
  noFail(d0);
  const no = await page.evaluate(async () => (await parishRef().collection('members').get()).docs[0].id);

  // ---- 1. Letter of Introduction from the member's record.
  await page.evaluate(no => openRecord('members', no), no);
  await page.click('#recordActions button:has-text("Letter of introduction")');
  await page.waitForSelector('#letterModal:not(.hidden)');
  assert.equal(await page.inputValue('#l_sig0_title'), 'Head Shepherd');
  assert.equal(await page.inputValue('#l_sig1_title'), 'Parochial Chairman/Chairperson');
  assert.equal(await page.isChecked('#l_sig2_on'), false);
  await page.fill('#l_to', 'The Shepherd, CCC Bodija Parish, Ibadan');
  await page.fill('#l_purpose', 'to worship with your parish while she studies at the University of Ibadan');
  await page.fill('#l_date', T0.iso);
  await page.fill('#l_sig0_title', 'Shepherd-in-charge'); await page.fill('#l_sig0_name', 'Sup Evang Olumide Ajayi');
  await page.fill('#l_sig1_title', 'Parochial Chairperson'); await page.fill('#l_sig1_name', 'Mrs Bola Adeyemi');
  await page.check('#l_sig2_on'); await page.fill('#l_sig2_name', 'Bro Tunde Oke');
  await shot('p14-01-letter-form');
  d0 = dialogs.length;
  await page.click('#issueLetterBtn');
  await page.waitForSelector('#certModal:not(.hidden) #introLetter');
  noFail(d0, /not issued|needs/);
  const lt = await page.textContent('#introLetter');
  assert.equal((await page.textContent('#letterNo')).trim(), 'CCC-TIP-IKJ-LOI-001');
  for (const re of [/CELESTIAL CHURCH OF CHRIST/, /TEST Ikeja Parish/, /Halleluyah 🙌/, /Adaeze Okafor/, /Letter of Introduction/i, /CCC Bodija Parish/,
    /Sup Evang Olumide Ajayi[\s\S]*Shepherd-in-charge/, /Mrs Bola Adeyemi[\s\S]*Parochial Chairperson/, /Bro Tunde Oke[\s\S]*Church Secretary/]) assert.match(lt, re);
  assert.equal(await page.locator('#introLetter .letter-signer').count(), 3);
  assert.ok(await page.locator('#introLetter img.ccc-logo').count());
  await page.locator('#certPrint').screenshot({ path: join(SHOTS, 'p14-02-letter-of-introduction.png') });
  const saved = await page.evaluate(async () => {
    const l = (await parishRef().collection('letters').get()).docs.map(d => d.data());
    const a = await db.collection('auditLog').where('parishId', '==', localState.currentParishId).where('action', '==', 'issue-letter').get();
    return { l, audits: a.size };
  });
  assert.equal(saved.l.length, 1); assert.equal(saved.audits, 1);
  assert.equal(saved.l[0].signatories[2].title, 'Church Secretary');
  await page.evaluate(() => closeCertificate());
  // Names are remembered for the next letter.
  await page.evaluate(no => openRecord('members', no), no);
  await page.click('#recordActions button:has-text("Letter of introduction")');
  assert.equal(await page.inputValue('#l_sig0_name'), 'Sup Evang Olumide Ajayi');
  await page.click('#letterModal button:has-text("Cancel")');

  // ---- 2. Monthly return: tithes 1/3 by default; ticked lines count toward the 1/3 too.
  await nav('returns');
  await page.waitForFunction(() => /NGN/.test(document.getElementById('r_currencyNote').textContent));
  await page.fill('#r_month', '2026-10'); await page.dispatchEvent('#r_month', 'change');
  await page.waitForFunction(() => document.getElementById('saveReturnBtn').textContent === 'File return');
  await page.waitForTimeout(1000);
  await page.fill('#r_tithes', '90000'); await page.fill('#r_offerings', '30000'); await page.fill('#r_building', '6000');
  await page.waitForFunction(() => /30,000/.test(document.getElementById('r_due').textContent));
  await page.check('#rb_offerings');
  await page.waitForFunction(() => /40,000/.test(document.getElementById('r_due').textContent));
  assert.match(await page.textContent('#r_shareNote'), /Tithes 1\/3, Offerings 1\/3/);
  await page.locator('#r_due').scrollIntoViewIfNeeded();
  await shot('p14-03-return-hq-base');
  d0 = dialogs.length;
  await page.click('#saveReturnBtn');
  await page.waitForSelector('#r_payBox:not(.hidden)');
  noFail(d0);
  let r = await page.evaluate(async () => (await db.collection('returns').doc(localState.currentParishId + '_2026-10').get()).data());
  assert.equal(r.due, 40000); assert.deepEqual(r.hqBase, ['offerings']);
  // Old-style month (nothing ticked) computes as before: 1/3 of tithes.
  await page.fill('#r_month', '2026-09'); await page.dispatchEvent('#r_month', 'change');
  await page.waitForFunction(() => document.getElementById('saveReturnBtn').textContent === 'File return');
  await page.waitForTimeout(1000);
  assert.equal(await page.isChecked('#rb_offerings'), false);
  await page.fill('#r_tithes', '90000'); await page.fill('#r_offerings', '30000');
  await page.click('#saveReturnBtn'); await page.waitForSelector('#r_payBox:not(.hidden)');
  r = await page.evaluate(async () => (await db.collection('returns').doc(localState.currentParishId + '_2026-09').get()).data());
  assert.equal(r.due, 30000); assert.ok(!('hqBase' in r));
  // ---- 4. Overpayment: recorded as paid, no warning.
  d0 = dialogs.length;
  await page.fill('#pay_date', '2026-10-03'); await page.fill('#pay_amount', '45000'); await page.selectOption('#pay_method', 'Bank transfer');
  await page.fill('#pay_ref', 'TLR-1');
  await page.click('#payBtn');
  await page.waitForSelector('#r_payments .pay-row');
  assert.equal(dialogs.length, d0, 'no dialog on overpayment');
  r = await page.evaluate(async () => (await db.collection('returns').doc(localState.currentParishId + '_2026-09').get()).data());
  assert.equal(r.remitted, 45000); assert.equal(r.status, 'Paid');
  // ---- 3. Birthday template starts with Halleluyah.
  const tpl = await page.evaluate(() => TEMPLATES.birthday.text);
  assert.match(tpl, /^Halleluyah 🙌/); assert.doesNotMatch(tpl, /good morning/i);
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 14 PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p14-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
