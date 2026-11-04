// Batch 18 (p19): Data Intake agent + Archive, end-to-end test (phone size 390x844)
// against the LOCAL Auth + Firestore emulators (project demo-ccc). Never touches the live project.
// The ccc-ai worker (AI + R2) is MOCKED with page.route: no AI call, no bucket, no keys.
// Run: npm run test:e2e:p19
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
}).listen(5071, '127.0.0.1');
const APP = 'http://127.0.0.1:5071/?emulator=1';

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

// ---------------- Mock of the ccc-ai worker: /classify (AI) and /archive/* (R2). FAKE people only.
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx');
const WORKER = 'https://ccc-ai.aarinat-company-limited.workers.dev';
const calls = [], r2 = new Map();
const PEOPLE = {
  image: [{ fullName: 'Adebola Testperson', gender: 'Female', maritalStatus: 'Married', phone: '08010000001', rank: 'Mother Celestial', dobDay: 15, dobMonth: 4,
    track: 'member', prophet: true, departments: ['choir'], deptRole: 'Chorister', committees: [{ name: 'Harvest Committee 2026', role: 'Secretary' }] }],
  xlsx: [{ fullName: 'Kunle Clergyman', gender: 'Male', maritalStatus: 'Married', email: 'kunle@test.local', rank: 'Evangelist', dobDay: 2, dobMonth: 3,
    track: 'clergy', prophet: true, departments: [], committees: [{ name: 'Harvest Committee 2026', role: 'Member' }] }],
  txt: [{ fullName: 'Funmi Placeholder', gender: 'Female', maritalStatus: 'Single', dobDay: 7, dobMonth: 7, track: 'member', prophet: false,
    departments: ['sidemen'], deptRole: '', committees: [], placementNote: 'Women are never clergy: placed as a member.' }],
};
async function mockWorker(route) {
  const req = route.request(), url = new URL(req.url()), auth = req.headers()['authorization'] || '';
  const cors = { 'access-control-allow-origin': '*' };
  if (!auth.startsWith('Bearer ')) return route.fulfill({ status: 401, headers: cors, body: '{"error":"sign in first"}' });
  if (url.pathname === '/classify') {
    const b = JSON.parse(req.postData());
    calls.push(b);
    const kind = b.file ? 'image' : /XLSXMARK/.test(b.text) ? 'xlsx' : 'txt';
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ people: PEOPLE[kind], engine: 'mock' }) });
  }
  if (url.pathname === '/archive/upload') {
    const pid = req.headers()['x-parish-id'], mime = req.headers()['content-type'];
    const key = `${pid}/2026/${crypto.randomUUID()}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`, body = req.postDataBuffer();
    r2.set(key, { body, mime });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ key, size: body.length, mime }) });
  }
  if (url.pathname === '/archive/file') {
    const d = await readDoc('archive/' + url.searchParams.get('id'));
    const f = d && r2.get(d.fileKey.stringValue);
    return f ? route.fulfill({ status: 200, headers: cors, contentType: f.mime, body: f.body }) : route.fulfill({ status: 404, headers: cors, body: '{}' });
  }
  return route.fulfill({ status: 404, headers: cors, body: '{}' });
}

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const code = await createParish('TEST Ijaye Parish', 'Lagos', 'Nigeria', 'Africa', 'NGN', 'IJY', 'LAG', 'ijaye@test.local');
  await logout();
  await claimFresh('ijaye@test.local', code);
  await page.route(WORKER + '/**', mockWorker);
  const pid = await page.evaluate(() => localState.currentParishId);
  const uid = await page.evaluate(() => localState.user.uid);
  // A current parish committee to place people in (seeded straight into the emulator).
  await seedTyped(`parishes/${pid}/pcommittees/C1`, { name: 'Harvest Committee 2026', nameLower: 'harvest committee 2026', template: 'Harvest', purpose: '',
    termStart: '2026-01-01', termEnd: '2026-12-31', status: 'Active', members: [], version: 1, createdAt: 'c', createdBy: uid, updatedAt: 'u', updatedBy: uid });

  // ---- Onboarding step 6 now says the Ijaye parish admin issues website logins.
  await page.evaluate(() => obWebHelp());
  assert.match(await page.textContent('#p9Body'), /issued by the Ijaye parish admin on the website's Parish office/);
  await page.evaluate(() => closeModal('p9Modal'));

  // ---- 1. Data Intake: three files at once (photo, Excel, WhatsApp export).
  await nav('intake');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Rank', 'Note'], ['Kunle Clergyman', 'Evangelist', 'XLSXMARK']]), 'Sheet1');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await page.setInputFiles('#in_files', [await makeImage('REG', '#7c2d12'),
    { name: 'clergy.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxBuf },
    { name: 'WhatsApp Chat.txt', mimeType: 'text/plain', buffer: Buffer.from('[04/11/2026, 09:20] Tunde: Funmi Placeholder, sidesman, 7 July') }]);
  await page.click('#in_readBtn');
  await page.waitForFunction(() => document.querySelectorAll('.in-file[data-status="Done"]').length === 3, null, { timeout: 30000 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].mime, 'image/jpeg'); assert.ok(calls[0].file.length > 1000, 'photo sent as JPEG');
  assert.match(calls[1].text, /Kunle Clergyman,Evangelist,XLSXMARK/, 'Excel read on the phone (vendored SheetJS)');
  assert.ok(calls.every(c => c.units.some(u => u.id === 'choir') && c.committees.includes('Harvest Committee 2026')), 'parish units + committees sent');
  assert.equal(await page.locator('.in-person').count(), 3);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('p19-01-intake');

  // ---- 2. Preview: p18 table with placement columns; fix a red placement cell.
  await page.click('#in_previewBtn');
  await page.waitForSelector('#importModal:not(.hidden) .imp-row');
  assert.equal(await page.locator('.imp-row').count(), 3);
  assert.ok((await page.textContent('#imp_head')).includes('Member / Clergy'));
  const rows = await page.evaluate(() => imp.rows.map(r => ({ n: r.fullName, t: r.track, p: r.prophet, d: r.deptIds, c: r.cmts.map(c => c.name + ':' + c.role), pr: Object.keys(r.problems) })));
  assert.deepEqual(rows[0], { n: 'Adebola Testperson', t: 'Member', p: true, d: ['choir'], c: ['Harvest Committee 2026:Secretary'], pr: [] });
  assert.deepEqual(rows[1], { n: 'Kunle Clergyman', t: 'Clergy', p: true, d: [], c: ['Harvest Committee 2026:Member'], pr: [] });
  const dept = page.locator('.imp-row').nth(2).locator('input[data-k="deptText"]');
  await dept.fill('Drummers'); await dept.dispatchEvent('change');
  await page.waitForSelector('.imp-row >> nth=2 >> .imp-bad');
  // A woman set to Clergy is refused in the preview.
  await page.locator('.imp-row').nth(2).locator('select[data-k="track"]').selectOption('Clergy');
  assert.match(await page.evaluate(() => imp.rows[2].problems.track || ''), /never clergy/);
  await page.locator('.imp-row').nth(2).locator('select[data-k="track"]').selectOption('Member');
  await page.locator('.imp-row').nth(2).locator('input[data-k="deptText"]').fill('Sidemen');
  await page.locator('.imp-row').nth(2).locator('input[data-k="deptText"]').dispatchEvent('change');
  await page.waitForFunction(() => Object.keys(imp.rows[2].problems).length === 0 && imp.rows[2].deptIds[0] === 'sidemen');
  await page.evaluate(() => document.querySelector('.imp-row input[data-k="deptText"]').scrollIntoView({ inline: 'center', block: 'center' }));
  await shot('p19-02-intake-preview');

  // ---- 3. Save all: records, departments and committees in one go.
  await page.check('#imp_consent');
  const d0 = dialogs.length;
  await page.click('#imp_saveBtn');
  await page.waitForFunction(() => /Saved 3 members/.test(document.getElementById('imp_status').textContent), null, { timeout: 30000 });
  noFail(d0);
  assert.match(await page.textContent('#imp_status'), /Committee places saved \(1 committees\)/);
  const saved = await page.evaluate(() => imp.rows.map(r => r.saved));
  assert.deepEqual(saved, ['CCC-IJY-LAG-MBR-001', 'CCC-IJY-LAG-CLG-001', 'CCC-IJY-LAG-MBR-002']);
  const cl = await readDoc(`parishes/${pid}/clergy/CCC-IJY-LAG-CLG-001`);
  assert.equal(cl.prophet.booleanValue, true); assert.equal(cl.rank.stringValue, 'Evangelist');
  assert.equal((await readDoc(`parishes/${pid}/members/CCC-IJY-LAG-MBR-001`)).prophet.booleanValue, true);
  const dm = await readDoc(`parishes/${pid}/deptMembers/choir_CCC-IJY-LAG-MBR-001`);
  assert.equal(dm.status.stringValue, 'Current'); assert.equal(dm.role.stringValue, 'Chorister');
  assert.ok(await readDoc(`parishes/${pid}/deptMembers/sidemen_CCC-IJY-LAG-MBR-002`));
  const pc = await readDoc(`parishes/${pid}/pcommittees/C1`);
  assert.equal(pc.version.integerValue, '2');
  assert.deepEqual(pc.members.arrayValue.values.map(v => v.mapValue.fields.memberNo.stringValue + ':' + v.mapValue.fields.role.stringValue),
    ['CCC-IJY-LAG-MBR-001:Secretary', 'CCC-IJY-LAG-CLG-001:Member']);
  assert.equal((await readDoc(`parishes/${pid}/importLog/CCC-IJY-LAG-CLG-001`)).source.stringValue, 'intake');
  assert.equal((await readDoc(`auditLog/parishes_${pid}_pcommittees_C1_v2`)).action.stringValue, 'member-add');
  await page.click('#importModal button[aria-label="Close"]');

  // ---- 4. Archive: add a scanned page, find it, view it, hide it (never delete).
  await nav('archive');
  await page.click('#ar_addBtn');
  await page.setInputFiles('#af_file', await makeImage('1990', '#14532d'));
  await page.fill('#af_title', 'Parochial Committee minutes May 1990');
  await page.selectOption('#af_cat', 'Minutes');
  await page.fill('#af_date', '1990-05');
  await page.fill('#af_tags', 'Minutes, Founding');
  await page.fill('#af_desc', 'Handwritten minutes (TEST document).');
  await page.click('#af_saveBtn');
  await page.waitForSelector('.ar-row');
  const aid = await page.getAttribute('.ar-row', 'data-id');
  const ad = await readDoc('archive/' + aid);
  assert.equal(ad.parishId.stringValue, pid); assert.ok(ad.fileKey.stringValue.startsWith(pid + '/')); assert.equal(ad.year.integerValue, '1990');
  assert.equal(ad.mime.stringValue, 'image/jpeg');
  assert.equal((await readDoc(`auditLog/archive_${aid}_v1`)).action.stringValue, 'archive-add');
  await page.fill('#ar_q', 'founding'); assert.equal(await page.locator('.ar-row').count(), 1);
  await page.fill('#ar_q', 'nothing-like-this'); assert.equal(await page.locator('.ar-row').count(), 0);
  await page.fill('#ar_q', ''); await page.selectOption('#ar_cat', 'Photos'); assert.equal(await page.locator('.ar-row').count(), 0);
  await page.selectOption('#ar_cat', 'Minutes'); await page.fill('#ar_year', '1990'); assert.equal(await page.locator('.ar-row').count(), 1);
  await page.click('.ar-row');
  await page.waitForFunction(() => document.getElementById('ar_img')?.naturalWidth > 0);
  await shot('p19-03-archive-viewer');
  // Extract people from the archived page: goes to the intake agent.
  const before = calls.length;
  await page.click('#ar_extractBtn');
  await page.waitForFunction(() => document.querySelectorAll('.in-file[data-status="Done"]').length === 1, null, { timeout: 30000 });
  assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).mime, 'image/jpeg');
  // Hide with a reason.
  await nav('archive');
  await page.click('.ar-row');
  promptAnswer = 'Duplicate scan';
  await page.click('#ar_hideBtn');
  await page.waitForFunction(() => document.querySelectorAll('.ar-row').length === 0);
  assert.equal((await readDoc('archive/' + aid)).hidden.booleanValue, true);
  assert.equal((await readDoc(`auditLog/archive_${aid}_v2`)).action.stringValue, 'archive-hide');
  await page.check('#ar_showHidden'); assert.equal(await page.locator('.ar-row').count(), 1);
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 18 (P19) PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p19-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
