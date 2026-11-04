// Batch 16 (anointment / rank promotions, HQ certificates, rank short forms, printables) phone-size end-to-end test against the LOCAL Auth + Firestore
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
}).listen(5066, '127.0.0.1');
const APP = 'http://127.0.0.1:5066/?emulator=1';

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
  await page.fill('#np_name', name); await page.fill('#np_city', city); await page.fill('#np_country', country);
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

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const codeA = await createParish('TEST Ikeja Parish', 'Ikeja', 'Nigeria', 'Africa', 'NGN', 'TIP', 'IKJ', 'ikeja@test.local');
  await logout();
  await claimFresh('ikeja@test.local', codeA);
  await page.waitForFunction(() => typeof localState !== 'undefined' && !!(localState.parish && localState.parish.name));
  const Y = new Date().getFullYear();

  // ---- 1. Rank short forms: map to full names (gender-aware), member form short-form box.
  const ab = await page.evaluate(() => [rankFromText('M/C', 'Female'), rankFromText('m.c'), rankFromText('L/S/S/E', 'Female'), rankFromText('L/S/S/E/P'),
    rankFromText('Sup. Evang.'), rankFromText('S/E', 'Male'), rankFromText('A/M/C'), rankFromText('Evang.'), rankFromText('nonsense')]);
  assert.deepEqual(ab, ['Mother Celestial', 'Mother Celestial', 'Lace Superior Senior Elder Sister', 'Lace Superior Senior Elder Sister',
    'Superior Evangelist', 'Senior Evangelist', 'Assistant Mother Celestial', 'Evangelist', '']);
  let d0 = dialogs.length;
  await addPerson('members', { name: 'Adaeze Okafor', gender: 'Female', phone: '08030000001', dob: T40 });
  await addPerson('members', { name: 'Adebayo Kolawole', gender: 'Male', phone: '08030000002', dob: T40, short: 'S/E/B' });
  await addPerson('members', { name: 'Funke Bello', gender: 'Female', phone: '08030000003', dob: T40, anYear: Y - 1, short: 'E/S' });
  await addPerson('members', { name: 'Grace Eze', gender: 'Female', phone: '08030000004', dob: T40, short: 'M/C' });
  await addPerson('members', { name: 'Bisi Lawal', gender: 'Female', phone: '08030000005', dob: T40, short: 'L/S/S/E/P' });
  noFail(d0);
  // Prophet / Prophetess (P): a yes/no add-on to the rank, shown after the rank name.
  const pp = await page.evaluate(async () => { const m = (await parishRef().collection('members').where('fullName', '==', 'Bisi Lawal').get()).docs[0].data();
    const dir = (await db.collection('directory').doc(localState.currentParishId + '_' + m.memberNo).get()).data();
    return [m.rank, m.prophet, dir.prophet, rankText(m), rankText({ rank: 'Senior Evangelist', gender: 'Male', prophet: true }), rankText({ rank: 'Mother Celestial', gender: 'Female' }),
      rankFromText('S/E/P', 'Male'), hasProphet('L/S/S/E'), hasProphet('L/S/S/E/P')]; });
  assert.deepEqual(pp, ['Lace Superior Senior Elder Sister', true, true, 'Lace Superior Senior Elder Prophetess', 'Senior Evangelist Prophet',
    'Mother Celestial', 'Senior Evangelist', false, true]);
  assert.equal(await page.evaluate(() => rankText({ rank: 'Senior Elder Brother', gender: 'Male', prophet: true })), 'Senior Elder Prophet');
  // Women are never clergy: the clergy form refuses her, and a female member has no "Ordain" button.
  d0 = dialogs.length;
  await page.evaluate(async () => { openPersonForm('clergy'); $('p_name').value = 'Sade Clergy'; $('p_gender').value = 'Female'; fillRanks('');
    $('p_marital').value = 'Married'; $('p_phone').value = '08030000009'; $('p_email').value = 'sade@x.org'; $('p_dobDay').value = '1'; $('p_dobMonth').value = '1';
    $('p_consent').checked = true; await savePerson(); closeModal('personModal'); });
  assert.ok(dialogs.slice(d0).some(m => /cannot be clergy/.test(m)), 'female clergy refused');
  assert.equal(await page.evaluate(async () => (await parishRef().collection('clergy').where('fullName', '==', 'Sade Clergy').get()).size), 0);
  await page.evaluate(async () => { const no = (await parishRef().collection('members').where('fullName', '==', 'Bisi Lawal').get()).docs[0].id; await openRecord('members', no); });
  assert.equal(await page.locator('#recordActions button:has-text("Ordain")').count(), 0);
  await page.evaluate(() => closeModal('recordModal'));
  const ranks = await page.evaluate(async () => Object.fromEntries((await parishRef().collection('members').get()).docs.map(d => [d.data().fullName, d.data().rank])));
  assert.equal(ranks['Adebayo Kolawole'], 'Senior Elder Brother');
  assert.equal(ranks['Grace Eze'], 'Mother Celestial');
  // Search by short form shows the full rank.
  await page.fill('#globalSearch', 'M/C');
  await page.waitForSelector('#globalResults:not(.hidden):has-text("Grace Eze")');
  assert.match(await page.textContent('#globalResults'), /Mother Celestial/);
  await page.fill('#globalSearch', '');

  // ---- 2. Anointing event: candidates, amounts, 3-year flag, one tap marks anointed.
  await nav('anointing');
  await page.click('#newAnBtn');
  await page.fill('#an_date', T0.iso); await page.fill('#an_state', 'Lagos'); await page.fill('#an_pastor', 'Rev TEST Pastor'); await page.fill('#an_appr', 'TEST Shepherd');
  d0 = dialogs.length;
  await page.click('#saveAnBtn');
  await page.waitForSelector('#an_q');
  for (const [q, name] of [['adaeze', 'Adaeze'], ['adebayo', 'Adebayo'], ['funke', 'Funke']]) {
    await page.fill('#an_q', q);
    await page.click(`.an-match:has-text("${name}")`);
    await page.waitForSelector(`.an-cand:has-text("${name}")`);
  }
  noFail(d0);
  // Funke was anointed last year: flagged, not blocked.
  await page.waitForSelector('.an-cand:has-text("Funke") .an-flag');
  assert.equal(await page.locator('.an-cand:has-text("Adaeze") .an-flag').count(), 0);
  assert.equal(await page.inputValue('.an-cand:has-text("Adaeze") .an-to'), 'Elder Sister');
  assert.equal(await page.inputValue('.an-cand:has-text("Adebayo") .an-to'), 'Superior Senior Elder Brother');
  await page.fill('.an-cand:has-text("Adaeze") .an-amt', '15000');
  await page.fill('.an-cand:has-text("Adebayo") .an-amt', '20000');
  await page.click('#saveCandBtn');
  await page.waitForFunction(() => anState.sel.candidates.filter(c => c.amount).length === 2);
  await page.locator('.an-cand:has-text("Funke") .an-tick').uncheck();
  await shot('p16-01-anointing-candidates');
  await page.click('#anointBtn');
  await page.waitForSelector('.an-cand:has-text("Adebayo") .fa-circle-check');
  await page.waitForSelector('.an-cand:has-text("Adaeze") .fa-circle-check');
  noFail(d0, /Not saved|Stopped|Could not/);
  const after = await page.evaluate(async () => {
    const m = Object.fromEntries((await parishRef().collection('members').get()).docs.map(d => [d.data().fullName, d.data()]));
    const h = (await parishRef().collection('rankHistory').get()).docs.map(d => d.data());
    const a = await db.collection('auditLog').where('parishId', '==', localState.currentParishId).get();
    return { ada: m['Adaeze Okafor'].rank, adb: m['Adebayo Kolawole'].rank, fun: m['Funke Bello'].rank, anY: m['Adaeze Okafor'].anointYear,
      hist: h.map(x => [x.fullName, x.entries.map(e => e.to).join('>')]), audits: a.docs.filter(d => /anointings|rankHistory/.test(d.data().target)).length };
  });
  assert.equal(after.ada, 'Elder Sister'); assert.equal(after.adb, 'Superior Senior Elder Brother'); assert.equal(after.fun, 'Elder Sister');
  assert.equal(after.anY, Y);
  assert.deepEqual(after.hist.sort(), [['Adaeze Okafor', 'Sister>Elder Sister'], ['Adebayo Kolawole', 'Brother>Senior Elder Brother>Superior Senior Elder Brother']]);
  assert.ok(after.audits >= 8, 'audited: ' + after.audits);
  // HQ certificates requested for the two anointed.
  await page.click('#certReqBtn');
  await page.waitForSelector('.an-cand:has-text("Adaeze"):has-text("requested")');
  await page.waitForSelector('.an-cand:has-text("Adebayo"):has-text("requested")');
  await page.evaluate(() => closeModal('p9Modal'));

  // ---- 3. Rank history + printables.
  await page.evaluate(async () => { const no = (await parishRef().collection('members').where('nameLower', '==', 'adebayo kolawole').get()).docs[0].id; await openRecord('members', no); });
  await page.click('#recordActions button:has-text("Rank history")');
  await page.waitForSelector('#rh_list .rh-entry:has-text("Superior Senior Elder Brother")');
  assert.equal(await page.locator('#rh_list .rh-entry').count(), 3);
  await page.evaluate(() => closeModal('p9Modal'));
  await page.evaluate(() => printProfile());
  await page.waitForSelector('#printSheet:not(.hidden) .ps-name:has-text("Adebayo Kolawole")');
  assert.match(await page.textContent('#printSheet'), /Rev TEST Pastor|Superior Senior Elder Brother/);
  await shot('p16-02-print-profile');
  await page.click('#closePrintBtn');
  await page.evaluate(() => closeModal('recordModal'));
  await nav('members');
  await page.click('#printFormBtn');
  await page.waitForSelector('#printSheet:not(.hidden) h1:has-text("Member Data Form")');
  assert.ok(await page.locator('#printSheet .ps-photo').count() === 1);
  await fullShot('p16-03-print-blank-form');
  await page.click('#closePrintBtn');

  // ---- 4. Super Admin: Anointing card at the top of the dashboard; issue a certificate.
  await logout();
  await login('bayo@test.local');
  await page.waitForSelector('#anointDash:not(.hidden) .ad-state:has-text("Lagos")');
  assert.equal(await page.textContent('#ad_pending'), '2');
  await page.waitForSelector('#anointDash .ad-flag:has-text("Funke Bello")');
  const top = await page.evaluate(() => [document.getElementById('anointDash').getBoundingClientRect().top, document.getElementById('metricTotal').getBoundingClientRect().top]);
  assert.ok(top[0] < top[1], 'anointing card sits above the totals');
  await page.evaluate(() => { document.querySelector('#anointDash details').open = true; });
  await shot('p16-04-super-anointing');
  await nav('anointingAll');
  await page.click('.aa-cert:has-text("Adaeze") .aa-issue');
  await page.fill('#aa_no', 'HQ/AN/TEST/001');
  await page.click('#issueCertBtn');
  await page.waitForSelector('.aa-cert:has-text("Adaeze"):has-text("HQ/AN/TEST/001")');
  await page.waitForFunction(() => document.getElementById('ad_issued').textContent === '1');
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 16 PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p16-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
