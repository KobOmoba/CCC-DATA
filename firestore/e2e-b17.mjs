// Batch 17: Bible readings + monthly SERVICE ROSTER + public church info, end-to-end test (phone size 390x844)
// against the LOCAL Auth + Firestore emulators (project demo-ccc). Never touches the live project.
// Run: npm run test:e2e:b17
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
}).listen(5068, '127.0.0.1');
const APP = 'http://127.0.0.1:5068/?emulator=1';

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
  const code = await createParish('TEST Ijaye Parish', 'Lagos', 'Nigeria', 'Africa', 'NGN', 'IJY', 'LAG', 'ijaye@test.local');

  // ---- 1. Super Admin pastes the month's worldwide readings (one line per date) and edits one.
  const month = T0.iso.slice(0, 7);
  const dates = await page.evaluate(m => datesOf(m, [0, 3, 5]), month);
  let d0 = dialogs.length;
  await nav('readings');
  await page.waitForSelector('#rd_admin:not(.hidden)');
  await page.fill('#rd_bulk', dates.map((d, i) => `${d} | ${['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(d + 'T12:00').getDay()]} | 2 KINGS 23:${i + 1}-9; EPH. 4:17-32`).join('\n') + `\n${T0.iso} | Evening | Psalm 23`);
  await page.click('#rdBulkBtn');
  await page.waitForSelector('.rd-day');
  noFail(d0);
  assert.ok(dialogs.slice(d0).some(m => /Saved readings for/.test(m)));
  const r0 = await readDoc(`bibleReadings/${dates[0]}`);
  assert.equal(r0.services.arrayValue.values[0].mapValue.fields.readings.stringValue, '2 KINGS 23:1-9; EPH. 4:17-32');
  assert.equal((await readDoc(`auditLog/bibleReadings_${dates[0]}_v1`)).action.stringValue, 'readings-add');
  await page.locator('.rd-edit').first().click();
  await page.fill('#rd_edit', 'SUNDAY | GEN. 1:1-5; JOHN 1:1-14');
  await page.click('#rdEditBtn'); await modalClosed('p9Modal');
  noFail(d0);
  assert.equal((await readDoc(`bibleReadings/${dates[0]}`)).version.integerValue, '2');
  // The website reads them without login (no auth header -> rules apply).
  assert.ok((await fetch(`${FS}/bibleReadings/${dates[0]}`)).ok, 'readings public');
  await fullShot('b17-01-super-readings');
  await logout();

  // ---- 2. Parish admin: dashboard shows this week's readings; readings are read-only.
  await claimFresh('ijaye@test.local', code);
  await page.waitForFunction(() => typeof localState !== 'undefined' && !!(localState.parish && localState.parish.name));
  await page.waitForSelector('#readingsCard:not(.hidden)');
  await page.waitForFunction(() => /Psalm 23/.test(document.getElementById('readingsCard').textContent), null, { timeout: 15000 });
  await nav('readings');
  await page.waitForSelector('.rd-day');
  assert.ok(await page.evaluate(() => document.getElementById('rd_admin').classList.contains('hidden')));
  assert.equal(await page.locator('.rd-edit').count(), 0);
  const pid = await page.evaluate(() => localState.currentParishId);
  assert.ok(!(await fetch(`${FS}/bibleReadings/2099-01-01`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { date: { stringValue: '2099-01-01' } } }) })).ok, 'website cannot write readings');

  // People: a clergy (man), a man and a woman member.
  await addPerson('clergy', { name: 'Issac Babarinde', gender: 'Male', email: 'issac@test.local', dob: T40, short: 'V/M/S/E' });
  await addPerson('members', { name: 'John Labiran', gender: 'Male', dob: T40, short: 'C/E/B' });
  await addPerson('members', { name: 'Ada Okoro', gender: 'Female', dob: T40, short: 'S/E/S' });
  const clg = await page.evaluate(() => numberFor('CLG-', 1)), john = await page.evaluate(() => numberFor('MBR-', 1)), ada = await page.evaluate(() => numberFor('MBR-', 2));

  // ---- 3. Duty roster: Preacher marked clergy-only; the woman cannot be picked for it.
  d0 = dialogs.length;
  await nav('roster');
  await page.waitForSelector('#roNewBtn');
  await page.click('#roTypesBtn');
  await page.locator('.dt-row').nth(3).locator('.dt-clergy').check();
  await page.click('#dtSaveBtn'); await modalClosed('p9Modal');
  await page.click('#roNewBtn');
  await page.waitForSelector('.ro-row');
  noFail(d0);
  assert.equal(await page.locator('.ro-row').count(), dates.length);
  const last = dates.length - 1;
  assert.equal(await page.inputValue(`.ro-lesson[data-row="${last}"][data-k="lesson1"]`), `2 KINGS 23:${dates.length}-9`, 'lesson from worldwide readings');
  const sel = (row, duty) => `.ro-sel[data-row="${row}"][data-duty="${duty}"]`;
  const preacherOpts = await page.locator(sel(last, 'Preacher') + ' option').allTextContents();
  assert.ok(preacherOpts.some(t => /ISSAC BABARINDE/.test(t)) && !preacherOpts.some(t => /ADA|JOHN/.test(t)), 'preacher is clergy-only: ' + preacherOpts);
  await page.selectOption(sel(last, 'Service Conductor'), clg);
  await page.selectOption(sel(last, 'Lesson Reader 1'), john);
  await page.selectOption(sel(last, 'Lesson Reader 2'), ada);
  await page.selectOption(sel(last, 'Preacher'), clg);
  await page.fill('#ro_sec', 'S/L Boluwatife Afolabi'); await page.fill('#ro_shep', 'VEN/M/EVANG. Issac Babarinde');
  await page.click('#roSaveBtn');
  await page.waitForSelector('.ro-row');
  await page.waitForTimeout(1500);
  noFail(d0);
  d0 = dialogs.length;
  await page.click('#roPubBtn');
  await page.waitForSelector('#roFixBtn');
  noFail(d0);
  const r1 = await readDoc(`parishes/${pid}/rosters/${month}_r1`);
  assert.equal(r1.status.stringValue, 'Published');
  assert.equal(r1.secretary.stringValue, 'S/L BOLUWATIFE AFOLABI');
  const duties = r1.rows.arrayValue.values[last].mapValue.fields.duties.arrayValue.values.map(v => v.mapValue.fields);
  assert.equal(duties.find(x => x.duty.stringValue === 'Lesson Reader 1').name.stringValue, 'C/E/B JOHN LABIRAN');
  assert.equal((await readDoc(`auditLog/parishes_${pid}_rosters_${month}_r1_v3`)).action.stringValue, 'roster-publish');
  await shot('b17-02-roster-published');
  // Correction = new version (with reason); version 1 stays.
  promptAnswer = 'Reader changed';
  await page.click('#roFixBtn');
  await page.waitForSelector('#roPubBtn');
  const r2 = await readDoc(`parishes/${pid}/rosters/${month}_r2`);
  assert.equal(r2.status.stringValue, 'Draft'); assert.equal(r2.replaces.stringValue, `${month}_r1`);
  assert.equal((await readDoc(`parishes/${pid}/rosters/${month}_r1`)).status.stringValue, 'Published');
  await page.click('#roPubBtn'); await page.waitForSelector('#roFixBtn');

  // Printable SERVICE ROSTER (landscape A4).
  await page.evaluate(() => printRoster());
  await page.waitForSelector('#printSheet:not(.hidden) .sr-table');
  const sheet = await page.textContent('#printSheetBody');
  for (const t of ['SERVICE ROSTER', 'YEAR: ' + month.slice(0, 4), 'SERVICE CONDUCTOR', '1ST LESSON', '2ND LESSON', 'PREACHER', 'SECRETARY', 'SHEPHERD IN CHARGE', 'V/M/S/E ISSAC BABARINDE'])
    assert.ok(sheet.includes(t), 'print has ' + t);
  assert.match(await page.textContent('#pageSize'), /landscape/);
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.emulateMedia({ media: 'print' });
  await page.locator('#printSheetBody').screenshot({ path: join(SHOTS, 'b17-03-service-roster-print.png') });
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#closePrintBtn');

  // ---- 4. Profiles show upcoming duties.
  await page.evaluate(no => openRecord('members', no), ada);
  await page.waitForFunction(() => /Lesson Reader 2/.test(document.getElementById('recordDuties')?.textContent || ''), null, { timeout: 15000 });
  await page.evaluate(() => closeModal('recordModal'));
  await page.evaluate(no => openRecord('clergy', no), clg);
  await page.waitForFunction(() => /Preacher/.test(document.getElementById('recordDuties')?.textContent || ''), null, { timeout: 15000 });
  await page.evaluate(() => closeModal('recordModal'));

  // ---- 5. Public church info: saved by the parish admin, readable without login; the parish itself is not.
  await nav('settings');
  await page.waitForFunction(() => document.getElementById('pi_saved').textContent !== '');
  await page.fill('#pi_services', 'Sunday 10:00 Sunday Service\nWednesday 18:00 Mercy Service');
  await page.fill('#pi_address', '12 Ijaye Road, Lagos'); await page.fill('#pi_phone', '08030000000');
  await page.fill('#pi_maps', 'https://maps.app.goo.gl/ijaye'); await page.fill('#pi_about', 'All are welcome.');
  d0 = dialogs.length;
  await page.click('#piSaveBtn');
  await page.waitForFunction(() => /Last saved/.test(document.getElementById('pi_saved').textContent));
  noFail(d0);
  const pub = await fetch(`${FS}/publicInfo/${pid}`);
  assert.ok(pub.ok, 'public info readable without login');
  assert.equal((await pub.json()).fields.address.stringValue, '12 Ijaye Road, Lagos');
  assert.ok(!(await fetch(`${FS}/parishes/${pid}`)).ok, 'parish record stays private');
  assert.ok(!(await fetch(`${FS}/parishes/${pid}/rosters/${month}_r1`)).ok, 'roster not public');
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 17 PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'b17-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
