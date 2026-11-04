// Batch 16b: GBP (London) Monthly Return regression + women recorded as clergy (flag + convert to member) end-to-end test
// against the LOCAL Auth + Firestore emulators (project demo-ccc). Never touches the live project.
// Run: npm run test:e2e:p17
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
}).listen(5067, '127.0.0.1');
const APP = 'http://127.0.0.1:5067/?emulator=1';

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

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const code = await createParish('TEST Celestial Light Parish', 'London', 'United Kingdom', 'Europe', 'GBP', 'CLP', 'LDN', 'london@test.local');
  await logout();
  await claimFresh('london@test.local', code);
  await page.waitForFunction(() => typeof localState !== 'undefined' && !!(localState.parish && localState.parish.name));

  // ---- 1. London (GBP) files a Monthly Return whose 1/3 is not a whole number (3,200 / 3 = 1,066.67), then pays it.
  let d0 = dialogs.length;
  await nav('returns');
  const prev = await page.evaluate(() => lastMonth());
  await page.fill('#r_month', prev); await page.dispatchEvent('#r_month', 'change');
  await page.waitForFunction(() => document.getElementById('saveReturnBtn').textContent === 'File return');
  await page.waitForFunction(() => /GBP/.test(document.getElementById('r_currencyNote').textContent));
  await page.waitForTimeout(800); // let the month's load finish before typing (as the other return tests do)
  await page.fill('#r_tithes', '3200'); await page.fill('#r_offerings', '900');
  await page.click('#saveReturnBtn');
  await page.waitForSelector('#r_payBox:not(.hidden)', { timeout: 15000 });
  noFail(d0);
  await page.waitForFunction(() => /GBP 1,066\.67/.test(document.getElementById('r_sumDue')?.textContent || ''), null, { timeout: 15000 });
  await page.fill('#pay_date', T0.iso); await page.fill('#pay_amount', '1066.67');
  await page.selectOption('#pay_method', 'Bank transfer'); await page.fill('#pay_ref', 'TRF-LDN-1');
  await page.click('#payBtn'); await page.waitForSelector('#r_payments .pay-row');
  noFail(d0);
  const pid = await page.evaluate(() => localState.currentParishId);
  const ret = await readDoc(`returns/${pid}_${prev}`);
  assert.equal(ret.currency.stringValue, 'GBP');
  assert.equal(Number(ret.due.doubleValue), 1066.67);
  assert.equal(ret.status.stringValue, 'Paid');
  await fullShot('p17-01-london-gbp-return-paid');

  // ---- 2. Old data: a woman on the clergy register (made before the rule). Male clergy + Prophet stays allowed.
  const clgNo = await page.evaluate(() => numberFor('CLG-', 1));
  const her = { memberNo: clgNo, fullName: 'Grace Okafor', nameLower: 'grace okafor', gender: 'Female', maritalStatus: 'Married', address: '1 High St', phone: '07000000000',
    phoneDigits: '07000000000', email: 'grace@test.local', rank: 'Mother Celestial', prophet: true, occupation: 'Nurse', dobDay: 4, dobMonth: 5, dobYear: 1970,
    anointDay: 1, anointMonth: 8, anointYear: 2019, nokName: 'Kin', nokAddress: '', nokPhone: '', photo: '', important: false, status: 'Active',
    consentGiven: true, consentDate: '2015-01-10', createdAt: '2015-01-10T00:00:00Z', updatedAt: '2015-01-10T00:00:00Z', joinedDate: '2015-01-10',
    serviceRecord: [{ rank: 'Assistant Mother Celestial', from: '2015-01-10', to: '2019-08-01' }, { rank: 'Mother Celestial', from: '2019-08-01' }] };
  await seedTyped(`parishes/${pid}/clergy/${clgNo}`, her);
  await seedTyped(`clergyIndex/${her.email}`, { parishId: pid, clergyId: clgNo });
  await seedTyped(`parishes/${pid}/meta/counters`, { clg: 1, mbr: 0 });
  await seedTyped(`parishStats/${pid}`, { memberCount: 0, clergyCount: 1, formerClergyCount: 0 });
  // The rule for new records still holds: Prophet (man) can be clergy; the label reads "Mother Celestial Prophetess".
  assert.equal(await page.evaluate(() => rankText({ rank: 'Mother Celestial', prophet: true, gender: 'Female' })), 'Mother Celestial Prophetess');

  // ---- 3. Super Admin sees the warning list (no fix button: the parish fixes it).
  await logout();
  await login('bayo@test.local');
  await page.waitForSelector('#femaleClergySuper:not(.hidden) .fc-row:has-text("Grace Okafor")');
  assert.match(await page.textContent('#femaleClergySuper'), /Women recorded as clergy — please correct \(1\)/);
  assert.equal(await page.locator('#femaleClergySuper .fc-fix').count(), 0);
  await fullShot('p17-02-super-female-clergy-warning');

  // ---- 4. Parish admin sees it and converts her to a member record (rank history kept, audit-logged, nothing deleted).
  await logout();
  await login('london@test.local');
  await page.waitForSelector('#femaleClergyCard:not(.hidden) .fc-row:has-text("Grace Okafor")');
  await shot('p17-03-parish-female-clergy-warning');
  d0 = dialogs.length;
  await page.click('#femaleClergyCard .fc-fix');
  await page.waitForFunction(() => document.getElementById('femaleClergyCard').classList.contains('hidden'), null, { timeout: 15000 });
  noFail(d0, /Not converted/);
  const mbrNo = await page.evaluate(() => numberFor('MBR-', 1));
  const mem = await readDoc(`parishes/${pid}/members/${mbrNo}`);
  assert.equal(mem.status.stringValue, 'Active'); assert.equal(mem.gender.stringValue, 'Female');
  assert.equal(mem.formerClergyNo.stringValue, clgNo); assert.equal(mem.rank.stringValue, 'Mother Celestial'); assert.equal(mem.prophet.booleanValue, true);
  const old = await readDoc(`parishes/${pid}/clergy/${clgNo}`);
  assert.equal(old.status.stringValue, 'Former'); assert.equal(old.leaveReason.stringValue, 'Converted to member');
  assert.equal(old.fullName.stringValue, 'Grace Okafor', 'clergy record kept, not deleted');
  const rh = await readDoc(`parishes/${pid}/rankHistory/${mbrNo}`);
  const ranks = rh.entries.arrayValue.values.map(v => v.mapValue.fields.to.stringValue);
  assert.deepEqual(ranks, ['Sister', 'Assistant Mother Celestial', 'Mother Celestial']);
  const au = await readDoc(`auditLog/parishes_${pid}_rankHistory_${mbrNo}_v1`);
  assert.equal(au.action.stringValue, 'convert-clergy');
  assert.equal(au.before.mapValue.fields.clergyNo.stringValue, clgNo);
  const st = await readDoc(`parishStats/${pid}`);
  assert.deepEqual([st.memberCount.integerValue, st.clergyCount.integerValue, st.formerClergyCount.integerValue], ['1', '0', '1']);
  await shot('p17-04-parish-converted');

  // ---- 5. Super Admin: the warning list is gone.
  await logout();
  await login('bayo@test.local');
  await page.waitForFunction(() => typeof register !== 'undefined' && register.length > 0);
  assert.ok(await page.evaluate(() => document.getElementById('femaleClergySuper').classList.contains('hidden')));
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 16b PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p17-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
