// Batch 15 (parish committees + harvests / unit anniversaries) phone-size end-to-end test against the LOCAL Auth + Firestore
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
}).listen(5065, '127.0.0.1');
const APP = 'http://127.0.0.1:5065/?emulator=1';

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
  await addPerson('members', { name: 'Adebayo Kolawole', gender: 'Male', phone: '08030000002', dob: T40 });
  noFail(d0);
  const Y = new Date().getFullYear();

  // ---- 1. Parish committee from a template, members from this parish, roles, history kept.
  await nav('pcommittees');
  await page.click('#newPcBtn');
  await page.selectOption('#pc_tpl', 'Harvest');
  assert.equal(await page.inputValue('#pc_name'), `Harvest Committee ${Y}`);
  await page.fill('#pc_start', T0.iso); await page.fill('#pc_end', `${Y}-12-31`);
  d0 = dialogs.length;
  await page.click('#savePcBtn');
  await page.waitForSelector('#pc_q');
  await page.fill('#pc_q', 'ada');
  await page.selectOption('#pc_role', 'Chairperson');
  await page.click('.pc-match:has-text("Adaeze")');
  await page.waitForSelector('#pc_current .pc-member:has-text("Chairperson")');
  promptAnswer = 'Financial Secretary';
  await page.fill('#pc_q', 'adeb');
  await page.selectOption('#pc_role', '__other');
  await page.click('.pc-match:has-text("Adebayo")');
  await page.waitForSelector('#pc_current .pc-member:has-text("Financial Secretary")');
  noFail(d0);
  await shot('p15-01-committee');
  page.once('dialog', () => {}); // confirm is auto-accepted by the global handler
  await page.locator('#pc_current .pc-member:has-text("Adebayo") button:has-text("Remove")').click();
  await page.waitForSelector('#pc_former .pc-member:has-text("Adebayo")');
  await page.evaluate(() => closeModal('p9Modal'));
  // An upcoming committee for next year, then a dissolved one goes to Past.
  await page.click('#newPcBtn');
  await page.fill('#pc_name', 'Building Committee'); await page.fill('#pc_start', `${Y + 1}-01-01`); await page.fill('#pc_end', `${Y + 2}-12-31`);
  await page.click('#savePcBtn'); await page.waitForSelector('#pc_q');
  await page.evaluate(() => closeModal('p9Modal'));
  await page.waitForSelector('.pc-upcoming .pc-row:has-text("Building Committee")');
  await page.waitForSelector('.pc-current .pc-row:has-text("Harvest Committee")');
  await page.click('.pc-upcoming .pc-row:has-text("Building Committee")');
  promptAnswer = 'Project postponed';
  await page.click('#dissolvePcBtn');
  await page.waitForSelector('#pc_phase:has-text("Past")');
  await page.evaluate(() => closeModal('p9Modal'));
  await page.waitForSelector('.pc-past .pc-row:has-text("Building Committee")');
  const cm = await page.evaluate(async () => {
    const c = (await parishRef().collection('pcommittees').get()).docs.map(d => d.data());
    const a = await db.collection('auditLog').where('parishId', '==', localState.currentParishId).get();
    return { n: c.length, audits: a.docs.filter(d => d.data().target.includes('/pcommittees/')).length };
  });
  assert.equal(cm.n, 2); assert.ok(cm.audits >= 6, 'audited: ' + cm.audits);

  // ---- 2. Harvests: Juvenile auto-created (1st Sunday of June); Adult window defaults to June.
  await nav('harvests');
  await page.waitForSelector(`.hv-row[data-id="${Y}_juvenile"] .hv-date`);
  const juv = await page.evaluate(y => nthSunday(y, 6, 1), Y);
  assert.match(await page.textContent(`.hv-row[data-id="${Y}_juvenile"]`), new RegExp(String(Number(juv.slice(8)))));
  assert.match(await page.textContent('#hv_window'), /June|Jun/);
  // Adult: a Saturday is refused, then the Sunday before Christmas is saved and linked to the committee.
  const xmas = await page.evaluate(y => sundayBeforeXmas(y), Y);
  await page.click(`.hv-row[data-id="${Y}_adult"]`);
  d0 = dialogs.length;
  await page.fill('#hv_date', addDaysIso(xmas, -1));
  await page.click('#saveHvBtn');
  assert.ok(dialogs.slice(d0).some(m => /Sunday/.test(m)), 'Saturday refused');
  await page.fill('#hv_date', addDaysIso(xmas, 7));
  await page.click('#saveHvBtn');
  assert.ok(dialogs.slice(d0).some(m => /Too late/.test(m)), 'after Sunday before Christmas refused');
  await page.fill('#hv_date', xmas);
  await page.selectOption('#hv_cm', { label: `Harvest Committee ${Y}` });
  await page.click('#saveHvBtn');
  await modalClosed('p9Modal');
  // Choir anniversary in 10 days -> dashboard reminder.
  const T10 = dayPlus(10);
  if (T10.iso.slice(0, 4) !== String(Y)) { await page.click('button[aria-label="Next year"]'); await page.waitForTimeout(800); }
  await page.click(`.hv-row[data-id="${T10.iso.slice(0, 4)}_unit-choir"]`);
  await page.fill('#hv_date', T10.iso); await page.click('#saveHvBtn'); await modalClosed('p9Modal');
  assert.equal(await page.locator('.hv-row[data-id$="_unit-sundayschool"], .hv-row[data-id$="_unit-parochial"]').count(), 0);
  if (T10.iso.slice(0, 4) !== String(Y)) { await page.click('button[aria-label="Previous year"]'); await page.waitForTimeout(800); }
  // Afterwards: record the Juvenile Harvest attendance + income (June has passed).
  if (juv <= T0.iso) {
    await page.click(`.hv-row[data-id="${Y}_juvenile"]`);
    await page.fill('#hv_att', '320'); await page.fill('#hv_inc', '450000');
    await page.click('#saveHvBtn'); await modalClosed('p9Modal');
    await page.waitForFunction(() => /320/.test(document.getElementById('hv_totals').textContent));
  }
  noFail(d0, /Not saved|Could not/);
  await fullShot('p15-02-harvests');
  // Dashboard reminder.
  await page.evaluate(() => { showSection('dashboard'); return renderCelebCard(); });
  await page.waitForSelector('#celebCard:not(.hidden) .celeb-due:has-text("Choir")');
  await page.locator('#celebCard').scrollIntoViewIfNeeded();
  await shot('p15-03-dashboard-reminder');

  // ---- 3. Super Admin: all parishes' Adult Harvest dates; start month defaults to June.
  await logout();
  await login('bayo@test.local');
  await nav('harvestsAll');
  await page.waitForSelector('#ha_list .ha-row:has-text("TEST Ikeja Parish")');
  assert.equal(await page.inputValue('#ha_month'), '6');
  await page.selectOption('#ha_month', '7');
  await page.click('#saveHaBtn');
  await page.waitForFunction(() => hqHarvest.startMonth === 7 && hqHarvest.version === 1);
  await shot('p15-04-hq-adult-harvests');
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 15 PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p15-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
function addDaysIso(s, n) { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
